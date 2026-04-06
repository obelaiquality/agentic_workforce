import { prisma } from "../db";
import { tokenize, cosineSimilarity } from "./memoryService";
import type {
  GlobalLearningRecord,
  GlobalPrincipleRecord,
  LearningEntry,
  SkillRecord,
  RepoGuidelineProfile,
  ProjectBlueprint,
} from "../../shared/contracts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MERGE_SIMILARITY_THRESHOLD = 0.55;
const MAX_GLOBAL_LEARNINGS = 500;
const MAX_GLOBAL_PRINCIPLES = 100;
const MIN_JACCARD_FOR_RELEVANCE = 0.1;
const PROMOTION_MIN_CONFIDENCE = 0.6;

// ---------------------------------------------------------------------------
// Tech Fingerprint
// ---------------------------------------------------------------------------

export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

export function extractTechFingerprint(
  guidelines: RepoGuidelineProfile | null,
  blueprint: ProjectBlueprint | null,
): string[] {
  const tokens = new Set<string>();

  if (guidelines?.languages) {
    for (const lang of guidelines.languages) {
      tokens.add(lang.toLowerCase());
    }
  }

  if (blueprint?.codingStandards?.principles) {
    const frameworkHints = [
      "react", "vue", "angular", "svelte", "next", "nuxt", "remix",
      "express", "fastify", "koa", "hono", "nest",
      "prisma", "drizzle", "sequelize", "typeorm",
      "vitest", "jest", "mocha", "pytest", "junit",
      "tailwind", "styled-components", "emotion",
      "django", "flask", "fastapi", "spring", "rails",
      "docker", "kubernetes", "terraform",
    ];
    const text = blueprint.codingStandards.principles.join(" ").toLowerCase();
    for (const hint of frameworkHints) {
      if (text.includes(hint)) tokens.add(hint);
    }
  }

  if (blueprint?.testingPolicy) {
    const testText = JSON.stringify(blueprint.testingPolicy).toLowerCase();
    for (const runner of ["vitest", "jest", "mocha", "pytest", "junit", "rspec", "cargo"]) {
      if (testText.includes(runner)) tokens.add(runner);
    }
  }

  return [...tokens].sort();
}

// ---------------------------------------------------------------------------
// GlobalKnowledgePool
// ---------------------------------------------------------------------------

export class GlobalKnowledgePool {
  /**
   * Promote a per-project learning to the global pool.
   * Deduplicates via cosine similarity on summary text.
   */
  async promoteLearning(
    learning: LearningEntry,
    techFingerprint: string[],
    projectId: string,
  ): Promise<void> {
    if (learning.confidence < PROMOTION_MIN_CONFIDENCE) return;

    const existing = await prisma.globalLearning.findMany({
      where: { category: learning.category },
    });

    const summaryTokens = tokenize(learning.summary);
    const match = existing.find(
      (gl) => cosineSimilarity(summaryTokens, tokenize(gl.summary)) >= MERGE_SIMILARITY_THRESHOLD,
    );

    if (match) {
      const sourceIds = (match.sourceProjectIds as string[]) || [];
      const updatedSourceIds = sourceIds.includes(projectId)
        ? sourceIds
        : [...sourceIds, projectId];
      const mergedFingerprint = [...new Set([
        ...((match.techFingerprint as string[]) || []),
        ...techFingerprint,
      ])];

      await prisma.globalLearning.update({
        where: { id: match.id },
        data: {
          occurrences: match.occurrences + 1,
          confidence: Math.min(1, match.confidence + 0.05),
          sourceProjectIds: updatedSourceIds,
          techFingerprint: mergedFingerprint,
          lastSeenAt: new Date(),
          detail: learning.detail || match.detail,
        },
      });
    } else {
      const count = await prisma.globalLearning.count();
      if (count >= MAX_GLOBAL_LEARNINGS) {
        const weakest = await prisma.globalLearning.findFirst({
          orderBy: [{ confidence: "asc" }, { lastSeenAt: "asc" }],
        });
        if (weakest) {
          await prisma.globalLearning.delete({ where: { id: weakest.id } });
        }
      }

      await prisma.globalLearning.create({
        data: {
          category: learning.category,
          summary: learning.summary,
          detail: learning.detail || "",
          techFingerprint,
          sourceProjectIds: [projectId],
          occurrences: 1,
          confidence: learning.confidence * 0.8, // Slight discount for first promotion
          relatedTools: learning.relatedTools || [],
          relatedFilePatterns: (learning.relatedFiles || []).map(
            (f) => f.replace(/^.*\//, "**/")), // Convert abs paths to glob patterns
        },
      });
    }
  }

  /**
   * Query global learnings relevant to a tech fingerprint.
   */
  async queryRelevant(
    techFingerprint: string[],
    opts?: { limit?: number; minConfidence?: number },
  ): Promise<GlobalLearningRecord[]> {
    const limit = opts?.limit ?? 30;
    const minConfidence = opts?.minConfidence ?? 0.3;

    const all = await prisma.globalLearning.findMany({
      where: { confidence: { gte: minConfidence } },
      orderBy: { confidence: "desc" },
    });

    const scored = all
      .map((gl) => {
        const fp = (gl.techFingerprint as string[]) || [];
        const overlap = jaccardSimilarity(techFingerprint, fp);
        const score = overlap * gl.confidence * (1 + gl.universality);
        return { ...gl, relevanceScore: score, techFingerprint: fp, sourceProjectIds: gl.sourceProjectIds as string[], relatedTools: gl.relatedTools as string[], relatedFilePatterns: gl.relatedFilePatterns as string[] };
      })
      .filter((gl) => gl.relevanceScore > 0 || techFingerprint.length === 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);

    return scored as unknown as GlobalLearningRecord[];
  }

  /**
   * Consolidate global learnings into global principles.
   */
  async consolidateGlobal(): Promise<GlobalPrincipleRecord[]> {
    const learnings = await prisma.globalLearning.findMany({
      where: { confidence: { gte: 0.5 } },
      orderBy: { confidence: "desc" },
    });

    const groups: Array<typeof learnings> = [];
    const used = new Set<string>();

    for (const learning of learnings) {
      if (used.has(learning.id)) continue;
      const group = [learning];
      used.add(learning.id);

      const tokens = tokenize(learning.summary);
      for (const other of learnings) {
        if (used.has(other.id)) continue;
        if (cosineSimilarity(tokens, tokenize(other.summary)) >= 0.4) {
          group.push(other);
          used.add(other.id);
        }
      }
      if (group.length >= 2) groups.push(group);
    }

    const principles: GlobalPrincipleRecord[] = [];

    for (const group of groups) {
      const isPattern = group.filter((g) => g.category === "pattern").length >=
        group.filter((g) => g.category === "antipattern").length;
      const prefix = isPattern ? "Prefer:" : "Avoid:";
      const principle = `${prefix} ${group[0].summary}`;
      const reasoning = group.map((g) => g.summary).join("; ");
      const allSourceIds = [...new Set(group.flatMap((g) => (g.sourceProjectIds as string[]) || []))];
      const allFingerprints = [...new Set(group.flatMap((g) => (g.techFingerprint as string[]) || []))];
      const minConfidence = Math.min(...group.map((g) => g.confidence));

      const existingPrinciples = await prisma.globalPrinciple.findMany();
      const principleTokens = tokenize(principle);
      const dup = existingPrinciples.find(
        (ep) => cosineSimilarity(principleTokens, tokenize(ep.principle)) >= MERGE_SIMILARITY_THRESHOLD,
      );

      if (dup) {
        await prisma.globalPrinciple.update({
          where: { id: dup.id },
          data: {
            confidence: Math.min(1, dup.confidence + 0.05),
            sourceProjectCount: allSourceIds.length,
            techFingerprint: allFingerprints,
          },
        });
      } else {
        const count = await prisma.globalPrinciple.count();
        if (count >= MAX_GLOBAL_PRINCIPLES) continue;

        const created = await prisma.globalPrinciple.create({
          data: {
            principle,
            reasoning,
            techFingerprint: allFingerprints,
            sourceProjectCount: allSourceIds.length,
            confidence: minConfidence,
          },
        });
        principles.push({
          ...created,
          techFingerprint: allFingerprints,
        } as unknown as GlobalPrincipleRecord);
      }
    }

    return principles;
  }

  /**
   * Format global principles for system prompt injection.
   * Filtered by tech fingerprint relevance.
   */
  async formatForSystemPrompt(
    techFingerprint: string[],
    maxTokens = 1500,
  ): Promise<string> {
    const principles = await prisma.globalPrinciple.findMany({
      where: { confidence: { gte: 0.4 } },
      orderBy: { confidence: "desc" },
    });

    const relevant = principles
      .map((p) => ({
        ...p,
        overlap: jaccardSimilarity(techFingerprint, (p.techFingerprint as string[]) || []),
      }))
      .filter((p) => p.overlap > MIN_JACCARD_FOR_RELEVANCE || techFingerprint.length === 0)
      .sort((a, b) => b.overlap * b.confidence - a.overlap * a.confidence)
      .slice(0, 15);

    if (relevant.length === 0) return "";

    const lines = relevant.map(
      (p) => `- ${p.principle} (${p.sourceProjectCount} project${p.sourceProjectCount !== 1 ? "s" : ""}, confidence: ${p.confidence.toFixed(2)})`,
    );

    let result = "## Cross-Project Learnings\nThese patterns have been validated across multiple projects with similar tech stacks:\n";
    let tokenEstimate = result.length / 4;

    const usable: string[] = [];
    for (const line of lines) {
      tokenEstimate += line.length / 4;
      if (tokenEstimate > maxTokens) break;
      usable.push(line);
    }

    if (usable.length === 0) return "";
    return result + usable.join("\n");
  }

  /**
   * Recompute universality scores across all global learnings.
   */
  async recomputeUniversality(): Promise<void> {
    const totalProjects = await prisma.repoRegistry.count();
    if (totalProjects === 0) return;

    const learnings = await prisma.globalLearning.findMany();
    for (const gl of learnings) {
      const sourceCount = ((gl.sourceProjectIds as string[]) || []).length;
      const universality = sourceCount / totalProjects;
      if (Math.abs(universality - gl.universality) > 0.01) {
        await prisma.globalLearning.update({
          where: { id: gl.id },
          data: { universality },
        });
      }
    }
  }

  /**
   * Rank skills by relevance to a tech fingerprint.
   */
  rankSkillsForProject(
    skills: SkillRecord[],
    techFingerprint: string[],
  ): Array<SkillRecord & { relevanceScore: number }> {
    if (techFingerprint.length === 0) {
      return skills.map((s) => ({ ...s, relevanceScore: s.builtIn ? 0.5 : 0.3 }));
    }

    return skills
      .map((skill) => {
        const skillFp = skill.techFingerprint || [];
        let score: number;

        if (skill.builtIn) {
          score = 0.5; // Built-ins are always moderately relevant
        } else if (skillFp.length === 0) {
          score = 0.2; // Untagged custom skills get base relevance
        } else {
          score = jaccardSimilarity(techFingerprint, skillFp);
        }

        // Boost skills that have been used across many projects
        const projectCount = (skill.sourceProjectIds || []).length;
        if (projectCount > 1) {
          score *= 1 + Math.log2(projectCount) * 0.1;
        }

        return { ...skill, relevanceScore: Math.min(1, score) };
      })
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }
}

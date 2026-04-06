import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  LearningEntry,
  SuggestedSkill,
} from "../../shared/contracts";
import { LearningsService } from "./learningsService";
import { tokenize, cosineSimilarity } from "./memoryService";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUGGESTED_SKILLS_FILE = "suggested-skills.json";
const MIN_CONFIDENCE_FOR_SYNTHESIS = 0.6;
const MIN_OCCURRENCES_FOR_SYNTHESIS = 3;
const MAX_SUGGESTED_SKILLS = 20;

// ---------------------------------------------------------------------------
// SkillSynthesizer
// ---------------------------------------------------------------------------

export class SkillSynthesizer {
  private readonly learningsService: LearningsService;
  private readonly suggestedSkillsPath: string;

  constructor(learningsService: LearningsService, worktreePath: string) {
    this.learningsService = learningsService;
    this.suggestedSkillsPath = path.join(
      worktreePath,
      ".agentic-workforce/learnings",
      SUGGESTED_SKILLS_FILE,
    );
  }

  /**
   * Analyze learnings and synthesize new skill suggestions.
   * Called during the dream cycle. Does NOT use LLM — uses heuristic synthesis.
   */
  synthesizeFromPatterns(projectId: string): SuggestedSkill[] {
    const patterns = this.learningsService.getLearnings({
      projectId,
      category: "pattern",
      minConfidence: MIN_CONFIDENCE_FOR_SYNTHESIS,
    }).filter((l) => l.occurrences >= MIN_OCCURRENCES_FOR_SYNTHESIS);

    if (patterns.length < 2) return [];

    const antipatterns = this.learningsService.getLearnings({
      projectId,
      category: "antipattern",
    });

    const existing = this.loadSuggestedSkills();
    const newSkills: SuggestedSkill[] = [];

    // Group patterns by tool overlap
    const groups = this.groupByToolOverlap(patterns);

    for (const group of groups) {
      if (group.length < 2) continue;

      const skillCandidate = this.buildSkillFromGroup(projectId, group, antipatterns);
      if (!skillCandidate) continue;

      // Check if similar suggestion already exists
      const skillTokens = tokenize(skillCandidate.name + " " + skillCandidate.description);
      const isDuplicate = existing.some(
        (s) =>
          s.projectId === projectId &&
          s.status !== "dismissed" &&
          cosineSimilarity(skillTokens, tokenize(s.name + " " + s.description)) >= 0.5,
      );

      if (isDuplicate) continue;

      existing.push(skillCandidate);
      newSkills.push(skillCandidate);
    }

    // Cap suggested skills
    if (existing.length > MAX_SUGGESTED_SKILLS) {
      // Keep approved, then newest pending, dismiss oldest
      existing.sort((a, b) => {
        if (a.status === "approved" && b.status !== "approved") return -1;
        if (b.status === "approved" && a.status !== "approved") return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      existing.length = MAX_SUGGESTED_SKILLS;
    }

    this.saveSuggestedSkills(existing);
    return newSkills;
  }

  // ---- CRUD for suggested skills ----

  listSuggestedSkills(projectId?: string): SuggestedSkill[] {
    let items = this.loadSuggestedSkills();
    if (projectId) items = items.filter((s) => s.projectId === projectId);
    return items.sort((a, b) => b.confidence - a.confidence);
  }

  getSuggestedSkill(id: string): SuggestedSkill | null {
    return this.loadSuggestedSkills().find((s) => s.id === id) || null;
  }

  approveSkill(id: string): SuggestedSkill | null {
    const skills = this.loadSuggestedSkills();
    const skill = skills.find((s) => s.id === id);
    if (!skill || skill.status !== "pending") return null;
    skill.status = "approved";
    this.saveSuggestedSkills(skills);
    return skill;
  }

  dismissSkill(id: string): SuggestedSkill | null {
    const skills = this.loadSuggestedSkills();
    const skill = skills.find((s) => s.id === id);
    if (!skill) return null;
    skill.status = "dismissed";
    this.saveSuggestedSkills(skills);
    return skill;
  }

  getPendingCount(projectId?: string): number {
    return this.listSuggestedSkills(projectId).filter((s) => s.status === "pending").length;
  }

  // ---- Private helpers ----

  private buildSkillFromGroup(
    projectId: string,
    patterns: LearningEntry[],
    antipatterns: LearningEntry[],
  ): SuggestedSkill | null {
    // Collect tools across patterns
    const allTools = new Set<string>();
    for (const p of patterns) {
      for (const t of p.relatedTools) allTools.add(t);
    }
    if (allTools.size === 0) return null;

    // Derive name from common tools and first pattern summary
    const toolList = Array.from(allTools).slice(0, 6);
    const primaryPattern = patterns[0];
    const name = this.deriveSkillName(toolList, primaryPattern.summary);

    // Build description from pattern summaries
    const description = patterns
      .slice(0, 3)
      .map((p) => p.summary)
      .join(". ");

    // Build system prompt with patterns and antipatterns
    const promptParts: string[] = [
      `You are a specialized agent for: ${description}`,
      "",
      "## Learned patterns (what works):",
    ];

    for (const p of patterns.slice(0, 5)) {
      promptParts.push(`- ${p.summary}`);
      if (p.detail) promptParts.push(`  Detail: ${p.detail}`);
    }

    // Include relevant antipatterns as warnings
    const relevantAntipatterns = antipatterns.filter((ap) =>
      ap.relatedTools.some((t) => allTools.has(t)),
    );

    if (relevantAntipatterns.length > 0) {
      promptParts.push("", "## Known pitfalls (avoid these):");
      for (const ap of relevantAntipatterns.slice(0, 3)) {
        promptParts.push(`- ${ap.summary}`);
      }
    }

    const avgConfidence =
      patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length;

    return {
      id: `suggested_${randomUUID().slice(0, 12)}`,
      projectId,
      name,
      description: description.slice(0, 300),
      systemPrompt: promptParts.join("\n").slice(0, 2000),
      allowedTools: toolList,
      tags: ["synthesized", "auto-generated"],
      derivedFromLearnings: patterns.map((p) => p.id),
      confidence: avgConfidence,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
  }

  private deriveSkillName(tools: string[], summary: string): string {
    // Extract action from summary — take first verb-like word
    const words = summary.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const action = words[0] || "auto";

    // Combine with primary tool
    const primaryTool = tools[0] || "task";
    return `${action}-${primaryTool}`.replace(/[^a-z0-9-]/g, "").slice(0, 40);
  }

  private groupByToolOverlap(patterns: LearningEntry[]): LearningEntry[][] {
    const used = new Set<string>();
    const groups: LearningEntry[][] = [];

    for (const pattern of patterns) {
      if (used.has(pattern.id)) continue;
      const group = [pattern];
      used.add(pattern.id);

      for (const candidate of patterns) {
        if (used.has(candidate.id)) continue;
        const toolOverlap = pattern.relatedTools.some((t) =>
          candidate.relatedTools.includes(t),
        );
        if (toolOverlap) {
          group.push(candidate);
          used.add(candidate.id);
        }
      }

      groups.push(group);
    }

    return groups.filter((g) => g.length >= 2);
  }

  private loadSuggestedSkills(): SuggestedSkill[] {
    try {
      if (!fs.existsSync(this.suggestedSkillsPath)) return [];
      return JSON.parse(fs.readFileSync(this.suggestedSkillsPath, "utf-8")) as SuggestedSkill[];
    } catch {
      return [];
    }
  }

  private saveSuggestedSkills(skills: SuggestedSkill[]): void {
    const dir = path.dirname(this.suggestedSkillsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.suggestedSkillsPath, JSON.stringify(skills, null, 2), "utf-8");
  }
}

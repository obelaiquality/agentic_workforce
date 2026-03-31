import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db";
import type { ProjectBlueprint, RepoGuidelineProfile } from "../../shared/contracts";
import { sanitizeUnicode } from "./sensitiveRedaction";

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toRecord(value: unknown) {
  return (value ?? {}) as Record<string, unknown>;
}

function readIfExists(filePath: string, maxChars = 24000) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return sanitizeUnicode(fs.readFileSync(filePath, "utf8")).slice(0, maxChars);
}

export function firstParagraph(text: string) {
  const cleaned = text
    .replace(/^#.+$/gm, "")
    .split(/\n\s*\n/g)
    .map((chunk) => chunk.replace(/\s+/g, " ").trim())
    .find((chunk) => chunk.length > 40);
  return cleaned || "";
}

function collectCandidateTexts(repoRoot: string) {
  const candidates = [
    "AGENTS.md",
    "README.md",
    "README",
    "docs/architecture.md",
    "docs/onboarding.md",
    "guidelines/Guidelines.md",
  ];

  const files: string[] = [];
  const texts: string[] = [];

  for (const relativePath of candidates) {
    const absolutePath = path.join(repoRoot, relativePath);
    const text = readIfExists(absolutePath);
    if (!text) continue;
    files.push(absolutePath);
    texts.push(text);
  }

  return { files, joined: texts.join("\n\n") };
}

function unique(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

export function inferProductIntent(text: string, fallbackName: string) {
  const paragraph = firstParagraph(text);
  if (paragraph) {
    return paragraph.slice(0, 280);
  }
  return `${fallbackName} should ship reliable code changes with verification and documentation discipline.`;
}

export function inferSuccessCriteria(guidelines: RepoGuidelineProfile | null) {
  const criteria = [
    "Implement the requested change with minimal diffs.",
    "Verify impacted behavior before promotion.",
  ];

  if ((guidelines?.requiredArtifacts || []).some((item) => /tests/i.test(item))) {
    criteria.push("Add or update tests when behavior changes.");
  }
  if ((guidelines?.requiredArtifacts || []).some((item) => /doc/i.test(item))) {
    criteria.push("Update documentation when user-facing or operational behavior changes.");
  }

  return unique(criteria);
}

export function inferConstraints(text: string) {
  const constraints: string[] = [];
  if (/minimal diffs?/i.test(text)) constraints.push("Prefer minimal diffs.");
  if (/worktree|safe copy|safe linked copy/i.test(text)) constraints.push("Operate inside the managed worktree only.");
  if (/review findings/i.test(text)) constraints.push("Use findings-first review style.");
  if (/performance/i.test(text)) constraints.push("Preserve performance-sensitive paths.");
  return unique(constraints);
}

export function classifyConfidence(input: { guidelineConfidence?: number | null; sourceRefs: string[] }) {
  const score = input.guidelineConfidence ?? 0;
  if (score >= 0.75 || input.sourceRefs.length >= 4) {
    return "high" as const;
  }
  if (score >= 0.45 || input.sourceRefs.length >= 2) {
    return "medium" as const;
  }
  return "low" as const;
}

function mapBlueprint(row: {
  id: string;
  repoId: string;
  version: number;
  sourceMode: string;
  charter: unknown;
  codingStandards: unknown;
  testingPolicy: unknown;
  documentationPolicy: unknown;
  executionPolicy: unknown;
  providerPolicy: unknown;
  extractedFrom: unknown;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): ProjectBlueprint {
  return {
    id: row.id,
    projectId: row.repoId,
    version: row.version,
    sourceMode: row.sourceMode as ProjectBlueprint["sourceMode"],
    confidence:
      (toRecord(row.metadata).confidence as ProjectBlueprint["confidence"] | undefined) ||
      (typeof toRecord(row.metadata).guideline_confidence === "number"
        ? classifyConfidence({
            guidelineConfidence: toRecord(row.metadata).guideline_confidence as number,
            sourceRefs: asStringArray(row.extractedFrom),
          })
        : undefined),
    charter: toRecord(row.charter) as ProjectBlueprint["charter"],
    codingStandards: toRecord(row.codingStandards) as ProjectBlueprint["codingStandards"],
    testingPolicy: toRecord(row.testingPolicy) as ProjectBlueprint["testingPolicy"],
    documentationPolicy: toRecord(row.documentationPolicy) as ProjectBlueprint["documentationPolicy"],
    executionPolicy: toRecord(row.executionPolicy) as ProjectBlueprint["executionPolicy"],
    providerPolicy: toRecord(row.providerPolicy) as ProjectBlueprint["providerPolicy"],
    extractedFrom: asStringArray(row.extractedFrom),
    metadata: toRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class ProjectBlueprintService {
  async get(repoId: string) {
    const row = await prisma.projectBlueprint.findUnique({ where: { repoId } });
    return row ? mapBlueprint(row) : null;
  }

  async getSources(repoId: string) {
    const blueprint = await prisma.projectBlueprint.findUnique({ where: { repoId } });
    return blueprint ? asStringArray(blueprint.extractedFrom) : [];
  }

  async generate(repoId: string) {
    const repo = await prisma.repoRegistry.findUnique({ where: { id: repoId } });
    if (!repo) {
      throw new Error(`Repo not found: ${repoId}`);
    }

    const repoRoot = path.join(repo.managedWorktreeRoot, "active");
    const guidelinesRow = await prisma.repoGuidelineProfile.findUnique({ where: { repoId } });
    const guidelines = guidelinesRow
      ? ({
          ...guidelinesRow,
          languages: asStringArray(guidelinesRow.languages),
          testCommands: asStringArray(guidelinesRow.testCommands),
          buildCommands: asStringArray(guidelinesRow.buildCommands),
          lintCommands: asStringArray(guidelinesRow.lintCommands),
          docRules: asStringArray(guidelinesRow.docRules),
          patchRules: asStringArray(guidelinesRow.patchRules),
          filePlacementRules: asStringArray(guidelinesRow.filePlacementRules),
          requiredArtifacts: asStringArray(guidelinesRow.requiredArtifacts),
          sourceRefs: asStringArray(guidelinesRow.sourceRefs),
        } as RepoGuidelineProfile)
      : null;

    const candidates = collectCandidateTexts(repoRoot);
    const sourceRefs = unique([...(guidelines?.sourceRefs || []), ...candidates.files]);
    const combinedText = [candidates.joined, ...(guidelines?.docRules || []), ...(guidelines?.patchRules || [])].join("\n\n");

    const current = await prisma.projectBlueprint.findUnique({ where: { repoId } });
    const nextVersion = (current?.version || 0) + 1;
    const confidence = classifyConfidence({
      guidelineConfidence: guidelines?.confidence ?? null,
      sourceRefs,
    });

    const row = await prisma.projectBlueprint.upsert({
      where: { repoId },
      update: {
        version: nextVersion,
        sourceMode: current?.sourceMode === "repo_plus_override" ? "repo_plus_override" : "repo_extracted",
        charter: {
          productIntent: inferProductIntent(combinedText, repo.displayName),
          successCriteria: inferSuccessCriteria(guidelines),
          constraints: inferConstraints(combinedText),
          riskPosture: "medium",
        },
        codingStandards: {
          principles: unique([
            ...(guidelines?.patchRules || []),
            "Prefer minimal diffs.",
            "Keep changes within the active project worktree.",
          ]),
          filePlacementRules: guidelines?.filePlacementRules || ["Place files in domain-appropriate folders."],
          architectureRules: unique([
            /service layer/i.test(combinedText) ? "Keep endpoint/controller layers thin." : "Keep implementation responsibilities separated.",
            /adapter/i.test(combinedText) ? "Use adapters for external integrations." : "Preserve established integration boundaries.",
          ]),
          dependencyRules: unique([
            /avoid overengineering/i.test(combinedText) ? "Avoid unnecessary dependencies." : "Add dependencies only when justified.",
          ]),
          reviewStyle: (guidelines?.reviewStyle || "summary_first") as "findings_first" | "summary_first",
        },
        testingPolicy: {
          requiredForBehaviorChange: true,
          defaultCommands: guidelines?.testCommands || [],
          impactedTestStrategy: "required",
          fullSuitePolicy: guidelines?.buildCommands?.length ? "on_major_change" : "manual",
        },
        documentationPolicy: {
          updateUserFacingDocs: true,
          updateRunbooksWhenOpsChange: true,
          requiredDocPaths: sourceRefs
            .filter((item) => /README|docs\//i.test(item))
            .map((item) => path.relative(repoRoot, item).replace(/\\/g, "/"))
            .slice(0, 10),
          changelogPolicy: /changelog/i.test(combinedText) ? "required" : "recommended",
        },
        executionPolicy: {
          approvalRequiredFor: ["provider_change", "file_apply", "run_command", "delete"],
          protectedPaths: [".git", ".env", "secrets", "keys"],
          maxChangedFilesBeforeReview: 8,
          allowParallelExecution: true,
        },
        providerPolicy: {
          preferredCoderRole: "coder_default",
          reviewRole: "review_deep",
          escalationPolicy: "high_risk_only",
        },
        extractedFrom: sourceRefs,
        metadata: {
          repo_root: repoRoot,
          repo_display_name: repo.displayName,
          guideline_confidence: guidelines?.confidence ?? 0.35,
          confidence,
        },
      },
      create: {
        repoId,
        version: nextVersion,
        sourceMode: "repo_extracted",
        charter: {
          productIntent: inferProductIntent(combinedText, repo.displayName),
          successCriteria: inferSuccessCriteria(guidelines),
          constraints: inferConstraints(combinedText),
          riskPosture: "medium",
        },
        codingStandards: {
          principles: unique([
            ...(guidelines?.patchRules || []),
            "Prefer minimal diffs.",
            "Keep changes within the active project worktree.",
          ]),
          filePlacementRules: guidelines?.filePlacementRules || ["Place files in domain-appropriate folders."],
          architectureRules: unique([
            /service layer/i.test(combinedText) ? "Keep endpoint/controller layers thin." : "Keep implementation responsibilities separated.",
            /adapter/i.test(combinedText) ? "Use adapters for external integrations." : "Preserve established integration boundaries.",
          ]),
          dependencyRules: unique([
            /avoid overengineering/i.test(combinedText) ? "Avoid unnecessary dependencies." : "Add dependencies only when justified.",
          ]),
          reviewStyle: (guidelines?.reviewStyle || "summary_first") as "findings_first" | "summary_first",
        },
        testingPolicy: {
          requiredForBehaviorChange: true,
          defaultCommands: guidelines?.testCommands || [],
          impactedTestStrategy: "required",
          fullSuitePolicy: guidelines?.buildCommands?.length ? "on_major_change" : "manual",
        },
        documentationPolicy: {
          updateUserFacingDocs: true,
          updateRunbooksWhenOpsChange: true,
          requiredDocPaths: sourceRefs
            .filter((item) => /README|docs\//i.test(item))
            .map((item) => path.relative(repoRoot, item).replace(/\\/g, "/"))
            .slice(0, 10),
          changelogPolicy: /changelog/i.test(combinedText) ? "required" : "recommended",
        },
        executionPolicy: {
          approvalRequiredFor: ["provider_change", "file_apply", "run_command", "delete"],
          protectedPaths: [".git", ".env", "secrets", "keys"],
          maxChangedFilesBeforeReview: 8,
          allowParallelExecution: true,
        },
        providerPolicy: {
          preferredCoderRole: "coder_default",
          reviewRole: "review_deep",
          escalationPolicy: "high_risk_only",
        },
        extractedFrom: sourceRefs,
        metadata: {
          repo_root: repoRoot,
          repo_display_name: repo.displayName,
          guideline_confidence: guidelines?.confidence ?? 0.35,
          confidence,
        },
      },
    });

    return mapBlueprint(row);
  }

  async update(repoId: string, patch: Partial<ProjectBlueprint>) {
    const current = await prisma.projectBlueprint.findUnique({ where: { repoId } });
    if (!current) {
      throw new Error(`Project blueprint not found: ${repoId}`);
    }

    const row = await prisma.projectBlueprint.update({
      where: { repoId },
      data: {
        version: current.version + 1,
        sourceMode: "repo_plus_override",
        charter: patch.charter ? { ...(toRecord(current.charter) || {}), ...patch.charter } : current.charter,
        codingStandards: patch.codingStandards ? { ...(toRecord(current.codingStandards) || {}), ...patch.codingStandards } : current.codingStandards,
        testingPolicy: patch.testingPolicy ? { ...(toRecord(current.testingPolicy) || {}), ...patch.testingPolicy } : current.testingPolicy,
        documentationPolicy: patch.documentationPolicy ? { ...(toRecord(current.documentationPolicy) || {}), ...patch.documentationPolicy } : current.documentationPolicy,
        executionPolicy: patch.executionPolicy ? { ...(toRecord(current.executionPolicy) || {}), ...patch.executionPolicy } : current.executionPolicy,
        providerPolicy: patch.providerPolicy ? { ...(toRecord(current.providerPolicy) || {}), ...patch.providerPolicy } : current.providerPolicy,
        extractedFrom: patch.extractedFrom || current.extractedFrom,
        metadata: {
          ...(toRecord(current.metadata) || {}),
          ...(patch.metadata || {}),
          updated_by_override: true,
        },
      },
    });

    return mapBlueprint(row);
  }
}

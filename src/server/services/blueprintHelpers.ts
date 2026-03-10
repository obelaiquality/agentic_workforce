import type { RepoGuidelineProfile } from "../../shared/contracts";

function unique(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

export function firstParagraph(text: string) {
  const cleaned = text
    .replace(/^#.+$/gm, "")
    .split(/\n\s*\n/g)
    .map((chunk) => chunk.replace(/\s+/g, " ").trim())
    .find((chunk) => chunk.length > 40);
  return cleaned || "";
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

export const CANDIDATE_SOURCES = [
  "AGENTS.md",
  "README.md",
  "README",
  "docs/architecture.md",
  "docs/onboarding.md",
  "guidelines/Guidelines.md",
];

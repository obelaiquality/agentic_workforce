import type { ProjectStarterDefinition, ProjectStarterId } from "../../shared/contracts";

export const DEFAULT_EMPTY_FOLDER_STARTER_ID: ProjectStarterId = "neutral_baseline";
export const DEFAULT_STACK_STARTER_ID: ProjectStarterId = "typescript_vite_react";

export const PROJECT_STARTERS: ProjectStarterDefinition[] = [
  {
    id: "neutral_baseline",
    label: "Neutral Baseline",
    description: "Create a minimal README, repo charter, and generic ignore file without choosing a stack.",
    kind: "generic",
    recommended: true,
    verificationMode: "none",
  },
  {
    id: "typescript_vite_react",
    label: "TypeScript App",
    description: "Scaffold the current Vite + React + TypeScript starter and verify it with install, test, and build commands.",
    kind: "stack",
    recommended: false,
    verificationMode: "commands",
  },
];

export function isProjectStarterId(value: unknown): value is ProjectStarterId {
  return typeof value === "string" && PROJECT_STARTERS.some((starter) => starter.id === value);
}

export function normalizeStarterMetadata(metadata: Record<string, unknown> | null | undefined) {
  const record = { ...(metadata ?? {}) };
  const starterId =
    typeof record.starter_id === "string"
      ? record.starter_id
      : typeof record.scaffold_template === "string"
      ? record.scaffold_template
      : typeof record.bootstrap_template === "string"
      ? record.bootstrap_template
      : null;

  if (isProjectStarterId(starterId)) {
    record.starter_id = starterId;
    if (typeof record.creation_mode !== "string") {
      record.creation_mode = "starter";
    }
  }

  return record;
}

export function getProjectStarterCatalog() {
  return PROJECT_STARTERS;
}

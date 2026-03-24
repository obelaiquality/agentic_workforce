import type { ProjectBlueprint, RepoGuidelineProfile } from "../../shared/contracts";
import { buildCommandPlan, type CommandPlan } from "./commandSpecs";

function unique(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

export interface VerificationCommandPlan {
  displayCommand: string;
  commandPlan: CommandPlan;
}

export interface VerificationPlanResolved {
  commands: VerificationCommandPlan[];
  docsRequired: string[];
  fullSuiteRun: boolean;
  reasons: string[];
  enforcedRules: string[];
}

export function buildVerificationCommandPlans(commands: string[]) {
  return unique(commands).map((command) => ({
    displayCommand: command,
    commandPlan: buildCommandPlan(command),
  }));
}

export function buildVerificationPlan(input: {
  blueprint: ProjectBlueprint | null;
  guidelines: RepoGuidelineProfile | null;
  includeInstall?: boolean;
}): VerificationPlanResolved {
  const commands = unique([
    ...(input.includeInstall ? ["npm install"] : []),
    ...(input.guidelines?.lintCommands || []),
    ...(input.blueprint?.testingPolicy.defaultCommands || []),
    ...(input.guidelines?.testCommands || []),
    ...(input.guidelines?.buildCommands || []),
  ]).slice(0, input.includeInstall ? 8 : 6);

  const reasons = unique([
    input.guidelines?.lintCommands?.length ? "Lint commands came from repo guidance and are always part of baseline verification." : "",
    input.blueprint?.testingPolicy.requiredForBehaviorChange
      ? "Tests were enforced because the project blueprint requires them on behavior changes."
      : "Tests were included only when the repo already defines them.",
    input.guidelines?.buildCommands?.length ? "Build verification was included because the repo defines a build command." : "",
    input.blueprint?.documentationPolicy.updateUserFacingDocs
      ? "Documentation checks were enforced because the project blueprint expects doc updates for user-facing changes."
      : "",
  ]);

  const enforcedRules = unique([
    input.blueprint?.testingPolicy.requiredForBehaviorChange ? "Tests required for behavior changes" : "",
    input.blueprint?.documentationPolicy.updateUserFacingDocs ? "User-facing docs updates expected" : "",
    input.blueprint?.documentationPolicy.updateRunbooksWhenOpsChange ? "Runbooks should change when operational behavior changes" : "",
    input.blueprint?.executionPolicy.allowParallelExecution ? "Parallel execution permitted" : "Single-agent execution preferred",
  ]);

  return {
    commands: buildVerificationCommandPlans(commands),
    docsRequired: unique(input.blueprint?.documentationPolicy.requiredDocPaths || []),
    fullSuiteRun: input.blueprint?.testingPolicy.fullSuitePolicy === "always",
    reasons,
    enforcedRules,
  };
}

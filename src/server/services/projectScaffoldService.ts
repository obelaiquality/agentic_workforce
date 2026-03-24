import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import type {
  ProjectBlueprint,
  ProjectStarterDefinition,
  ProjectStarterId,
  ScaffoldExecutionResult,
  ScaffoldPlan,
} from "../../shared/contracts";
import { ExecutionService } from "./executionService";
import { ProjectBlueprintService } from "./projectBlueprintService";
import { ProviderOrchestrator } from "./providerOrchestrator";
import { RepoService } from "./repoService";
import { buildVerificationCommandPlans, buildVerificationPlan } from "./verificationPolicy";
import { DEFAULT_STACK_STARTER_ID, PROJECT_STARTERS } from "./projectStarterCatalog";

const DEFAULT_OBJECTIVE = "Scaffold a TypeScript app with tests and documentation.";
const NEUTRAL_BASELINE_IGNORE_LINES = [
  ".DS_Store",
  "*.log",
  ".env",
  ".env.local",
  ".idea/",
  ".vscode/",
];

function unique(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

function asRecord(value: unknown) {
  return (value ?? {}) as Record<string, unknown>;
}

function buildTypeScriptPlan(projectId: string, blueprint: ProjectBlueprint | null): ScaffoldPlan {
  const verificationPlan = buildVerificationPlan({
    blueprint,
    guidelines: null,
    includeInstall: true,
  });
  const requiredDocs = unique(["README.md", "AGENTS.md", ...verificationPlan.docsRequired]).filter(Boolean);
  return {
    projectId,
    blueprintVersion: blueprint?.version || 1,
    targetFiles: [
      ".gitignore",
      "package.json",
      "tsconfig.json",
      "vite.config.ts",
      "eslint.config.js",
      "index.html",
      "src/main.tsx",
      "src/App.tsx",
      "src/App.css",
      "src/App.test.tsx",
      "src/test/setup.ts",
      "src/vite-env.d.ts",
      "README.md",
      "AGENTS.md",
    ],
    requiredTests: ["src/App.test.tsx"],
    requiredDocs,
    verificationCommands: unique([
      "npm install",
      "npm run lint",
      "npm test",
      "npm run build",
      ...verificationPlan.commands.map((item) => item.displayCommand),
    ]),
  };
}

function buildNeutralBaselinePlan(projectId: string, blueprint: ProjectBlueprint | null): ScaffoldPlan {
  const requiredDocs = unique(["README.md", "AGENTS.md", ...(blueprint?.documentationPolicy.requiredDocPaths || [])]).filter(Boolean);
  return {
    projectId,
    blueprintVersion: blueprint?.version || 1,
    targetFiles: [".gitignore", "README.md", "AGENTS.md"],
    requiredTests: [],
    requiredDocs,
    verificationCommands: [],
  };
}

function buildPlanForStarter(starterId: ProjectStarterId, projectId: string, blueprint: ProjectBlueprint | null): ScaffoldPlan {
  if (starterId === "neutral_baseline") {
    return buildNeutralBaselinePlan(projectId, blueprint);
  }
  return buildTypeScriptPlan(projectId, blueprint);
}

function ensureTextFile(filePath: string, content: string) {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
    return true;
  }

  const existing = fs.readFileSync(filePath, "utf8");
  if (existing.trim().length === 0) {
    fs.writeFileSync(filePath, content, "utf8");
    return true;
  }

  return false;
}

function ensureIgnoreFile(filePath: string, lines: string[]) {
  const normalizedLines = unique(lines);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${normalizedLines.join("\n")}\n`, "utf8");
    return true;
  }

  const existing = fs.readFileSync(filePath, "utf8");
  const existingLines = existing
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  const merged = unique([...existingLines, ...normalizedLines]);
  if (merged.length === existingLines.length) {
    return false;
  }
  fs.writeFileSync(filePath, `${merged.join("\n")}\n`, "utf8");
  return true;
}

function buildNeutralReadme(displayName: string) {
  return `# ${displayName}

This repository is ready for first-pass planning and implementation work.

## Next steps
- Describe what you want to build.
- Ask the agent to propose the initial architecture.
- Add stack-specific tooling only after the project direction is clear.
`;
}

function buildNeutralAgents(displayName: string) {
  return `# ${displayName} Charter

## Product intent
- Build the initial project deliberately before committing to a stack.

## Working agreements
- Prefer minimal diffs and clear file ownership.
- Add focused verification for behavior changes.
- Keep setup and user-facing docs current as the project takes shape.
`;
}

export class ProjectScaffoldService {
  constructor(
    private readonly repoService: RepoService,
    private readonly blueprintService: ProjectBlueprintService,
    private readonly executionService: ExecutionService,
    private readonly providerOrchestrator: ProviderOrchestrator,
  ) {}

  listStarters(): ProjectStarterDefinition[] {
    return PROJECT_STARTERS;
  }

  async bootstrapEmptyProject(input: {
    actor: string;
    folderPath: string;
    displayName?: string;
    starterId?: ProjectStarterId | null;
    initializeGit?: boolean;
  }) {
    const attached = await this.repoService.bootstrapEmptyProject({
      actor: input.actor,
      folderPath: input.folderPath,
      displayName: input.displayName,
      starterId: input.starterId ?? null,
      initializeGit: input.initializeGit ?? true,
    });

    const blueprint = attached.blueprint || (await this.blueprintService.generate(attached.repo.id));
    return {
      project: attached.repo,
      repo: attached.repo,
      blueprint,
      starterId: input.starterId ?? null,
    };
  }

  async plan(projectId: string, starterId: ProjectStarterId = DEFAULT_STACK_STARTER_ID) {
    const blueprint = await this.blueprintService.get(projectId);
    return buildPlanForStarter(starterId, projectId, blueprint);
  }

  async execute(input: {
    actor: string;
    projectId: string;
    starterId?: ProjectStarterId;
    objective?: string;
  }): Promise<{
    plan: ScaffoldPlan;
    result: ScaffoldExecutionResult;
    blueprint: ProjectBlueprint | null;
  }> {
    const starterId = input.starterId || DEFAULT_STACK_STARTER_ID;
    const repo = await this.repoService.getRepo(input.projectId);
    if (!repo) {
      throw new Error(`Repo not found: ${input.projectId}`);
    }

    const worktreePath = await this.repoService.getActiveWorktreePath(input.projectId);
    const blueprint = await this.blueprintService.get(input.projectId);
    const plan = buildPlanForStarter(starterId, input.projectId, blueprint);

    if (starterId === "neutral_baseline") {
      const appliedFiles: string[] = [];
      if (ensureIgnoreFile(path.join(worktreePath, ".gitignore"), NEUTRAL_BASELINE_IGNORE_LINES)) {
        appliedFiles.push(".gitignore");
      }
      if (ensureTextFile(path.join(worktreePath, "README.md"), buildNeutralReadme(repo.displayName))) {
        appliedFiles.push("README.md");
      }
      if (ensureTextFile(path.join(worktreePath, "AGENTS.md"), buildNeutralAgents(repo.displayName))) {
        appliedFiles.push("AGENTS.md");
      }

      await this.persistStarterMetadata(input.projectId, {
        starter_id: starterId,
        starter_applied_at: new Date().toISOString(),
        requested_starter_id: null,
        creation_mode: "starter",
        starter_last_result: {
          starter_id: starterId,
          run_id: null,
          applied_files: appliedFiles,
          verification_bundle_id: null,
          report_id: null,
          status: "completed",
        },
      });
      await this.repoService.refreshGuidelines(input.projectId);
      await this.repoService.refreshIndex(input.projectId);
      const refreshedBlueprint = await this.blueprintService.generate(input.projectId);

      return {
        plan,
        result: {
          projectId: input.projectId,
          runId: null,
          appliedFiles,
          verificationBundleId: null,
          reportId: null,
          status: "completed",
        },
        blueprint: refreshedBlueprint,
      };
    }

    const verificationPlan = buildVerificationPlan({
      blueprint,
      guidelines: null,
      includeInstall: true,
    });
    const runId = randomUUID();
    const buildRoleBinding = await this.providerOrchestrator.getModelRoleBinding("coder_default");

    const attempt = await this.executionService.startExecution({
      actor: input.actor,
      runId,
      repoId: input.projectId,
      projectId: input.projectId,
      worktreePath,
      objective: input.objective || DEFAULT_OBJECTIVE,
      projectKey: starterId,
      modelRole: "coder_default",
      providerId: buildRoleBinding.providerId,
      metadata: {
        scaffold_template: starterId,
        scaffold_objective: input.objective || DEFAULT_OBJECTIVE,
        blueprint_version: blueprint?.version || 1,
      },
    });

    const verification = await this.executionService.verifyExecution({
      actor: input.actor,
      runId,
      repoId: input.projectId,
      worktreePath,
      executionAttemptId: attempt.id,
      commands: buildVerificationCommandPlans(plan.verificationCommands),
      docsRequired: plan.requiredDocs,
      fullSuiteRun: true,
      metadata: {
        verification_commands: plan.verificationCommands,
        verification_reasons: unique([
          "Install dependencies before the first verification pass.",
          "Lint the scaffold baseline.",
          "Run the generated test suite.",
          "Build the production bundle to prove the scaffold compiles.",
          ...verificationPlan.reasons,
        ]),
        enforced_rules: verificationPlan.enforcedRules,
        blueprint_version: blueprint?.version || 1,
      },
    });

    await this.repoService.refreshGuidelines(input.projectId);
    await this.repoService.refreshIndex(input.projectId);
    const refreshedBlueprint = await this.blueprintService.generate(input.projectId);
    const report = await prisma.shareableRunReport.findUnique({ where: { runId } });
    const appliedFiles = Array.isArray(attempt.changedFiles) ? attempt.changedFiles : [];

    await this.persistStarterMetadata(input.projectId, {
      starter_id: starterId,
      starter_applied_at: new Date().toISOString(),
      requested_starter_id: null,
      creation_mode: "starter",
      starter_last_result: {
        starter_id: starterId,
        run_id: runId,
        applied_files: appliedFiles,
        verification_bundle_id: verification.id,
        report_id: report?.id || null,
        status: verification.pass ? "completed" : "needs_review",
      },
    });

    return {
      plan,
      result: {
        projectId: input.projectId,
        runId,
        appliedFiles,
        verificationBundleId: verification.id,
        reportId: report?.id || null,
        status: verification.pass ? "completed" : "needs_review",
      },
      blueprint: refreshedBlueprint,
    };
  }

  async getStatus(projectId: string) {
    const repo = await this.repoService.getRepo(projectId);
    const repoMetadata = asRecord(repo?.metadata);
    const starterResult = asRecord(repoMetadata.starter_last_result);
    if (Array.isArray(starterResult.applied_files) && typeof starterResult.status === "string") {
      const appliedAt =
        typeof repoMetadata.starter_applied_at === "string" ? repoMetadata.starter_applied_at : repo?.updatedAt || new Date().toISOString();
      return {
        runId: typeof starterResult.run_id === "string" ? starterResult.run_id : null,
        executionAttemptId: null,
        status: starterResult.status,
        appliedFiles: starterResult.applied_files.filter((item): item is string => typeof item === "string"),
        verificationBundleId: typeof starterResult.verification_bundle_id === "string" ? starterResult.verification_bundle_id : null,
        reportId: typeof starterResult.report_id === "string" ? starterResult.report_id : null,
        startedAt: appliedAt,
        completedAt: appliedAt,
      };
    }

    const attempts = await prisma.executionAttempt.findMany({
      where: { projectId },
      orderBy: { startedAt: "desc" },
      take: 20,
    });
    const latest = attempts.find((attempt) => {
      const metadata = asRecord(attempt.metadata);
      return typeof metadata.scaffold_template === "string";
    });

    if (!latest) {
      return null;
    }

    const verification = await prisma.verificationBundle.findFirst({
      where: { runId: latest.runId },
      orderBy: { createdAt: "desc" },
    });
    const report = await prisma.shareableRunReport.findUnique({ where: { runId: latest.runId } });

    return {
      runId: latest.runId,
      executionAttemptId: latest.id,
      status: verification ? (verification.pass ? "completed" : "needs_review") : latest.status,
      appliedFiles: Array.isArray(latest.changedFiles) ? latest.changedFiles.filter((item): item is string => typeof item === "string") : [],
      verificationBundleId: verification?.id || null,
      reportId: report?.id || null,
      startedAt: latest.startedAt.toISOString(),
      completedAt: latest.completedAt?.toISOString() || null,
    };
  }

  private async persistStarterMetadata(projectId: string, patch: Record<string, unknown>) {
    const row = await prisma.repoRegistry.findUnique({
      where: { id: projectId },
      select: { metadata: true },
    });
    await prisma.repoRegistry.update({
      where: { id: projectId },
      data: {
        metadata: {
          ...asRecord(row?.metadata),
          ...patch,
        },
      },
    });
  }
}

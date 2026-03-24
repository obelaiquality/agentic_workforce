import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import type { ProjectBlueprint, ScaffoldExecutionResult, ScaffoldPlan } from "../../shared/contracts";
import { ExecutionService } from "./executionService";
import { ProjectBlueprintService } from "./projectBlueprintService";
import { RepoService } from "./repoService";
import { buildVerificationCommandPlans, buildVerificationPlan } from "./verificationPolicy";

const DEFAULT_TEMPLATE = "typescript_vite_react" as const;
const DEFAULT_OBJECTIVE = "Scaffold a TypeScript app with tests and documentation.";

function unique(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

function buildDefaultPlan(projectId: string, blueprint: ProjectBlueprint | null): ScaffoldPlan {
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

export class ProjectScaffoldService {
  constructor(
    private readonly repoService: RepoService,
    private readonly blueprintService: ProjectBlueprintService,
    private readonly executionService: ExecutionService
  ) {}

  async bootstrapEmptyProject(input: {
    actor: string;
    folderPath: string;
    displayName?: string;
    template?: typeof DEFAULT_TEMPLATE;
    initializeGit?: boolean;
  }) {
    const template = input.template || DEFAULT_TEMPLATE;
    const attached = await this.repoService.bootstrapEmptyProject({
      actor: input.actor,
      folderPath: input.folderPath,
      displayName: input.displayName,
      template,
      initializeGit: input.initializeGit ?? true,
    });

    const blueprint = attached.blueprint || (await this.blueprintService.generate(attached.repo.id));
    return {
      project: attached.repo,
      repo: attached.repo,
      blueprint,
      template,
    };
  }

  async plan(projectId: string) {
    const blueprint = await this.blueprintService.get(projectId);
    return buildDefaultPlan(projectId, blueprint);
  }

  async execute(input: {
    actor: string;
    projectId: string;
    template?: typeof DEFAULT_TEMPLATE;
    objective?: string;
  }): Promise<{
    plan: ScaffoldPlan;
    result: ScaffoldExecutionResult;
    blueprint: ProjectBlueprint | null;
  }> {
    const template = input.template || DEFAULT_TEMPLATE;
    if (template !== DEFAULT_TEMPLATE) {
      throw new Error(`Unsupported scaffold template: ${template}`);
    }

    const repo = await this.repoService.getRepo(input.projectId);
    if (!repo) {
      throw new Error(`Repo not found: ${input.projectId}`);
    }

    const worktreePath = await this.repoService.getActiveWorktreePath(input.projectId);
    const blueprint = await this.blueprintService.get(input.projectId);
    const plan = buildDefaultPlan(input.projectId, blueprint);
    const verificationPlan = buildVerificationPlan({
      blueprint,
      guidelines: null,
      includeInstall: true,
    });
    const runId = randomUUID();

    const attempt = await this.executionService.startExecution({
      actor: input.actor,
      runId,
      repoId: input.projectId,
      projectId: input.projectId,
      worktreePath,
      objective: input.objective || DEFAULT_OBJECTIVE,
      projectKey: template,
      modelRole: "coder_default",
      providerId: "onprem-qwen",
      metadata: {
        scaffold_template: template,
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

    return {
      plan,
      result: {
        projectId: input.projectId,
        runId,
        appliedFiles: attempt.changedFiles,
        verificationBundleId: verification.id,
        reportId: report?.id || null,
        status: verification.pass ? "completed" : "needs_review",
      },
      blueprint: refreshedBlueprint,
    };
  }

  async getStatus(projectId: string) {
    const attempts = await prisma.executionAttempt.findMany({
      where: { projectId },
      orderBy: { startedAt: "desc" },
      take: 20,
    });
    const latest = attempts.find((attempt) => {
      const metadata = (attempt.metadata ?? {}) as Record<string, unknown>;
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
}

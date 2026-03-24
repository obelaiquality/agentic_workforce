import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { RepoService } from "../services/repoService";
import { BenchmarkService } from "../services/benchmarkService";
import { CodeGraphService } from "../services/codeGraphService";
import { ExecutionService } from "../services/executionService";
import { GitHubService } from "../services/githubService";
import { ProjectBlueprintService } from "../services/projectBlueprintService";
import { ProjectScaffoldService } from "../services/projectScaffoldService";
import { DEFAULT_EMPTY_FOLDER_STARTER_ID } from "../services/projectStarterCatalog";
import { buildVerificationCommandPlans } from "../services/verificationPolicy";
import { mapRepoToProjectBinding } from "./shared/projectBindings";

const projectStarterIdSchema = z.enum(["neutral_baseline", "typescript_vite_react"]);

const attachLocalRepoSchema = z.object({
  actor: z.string().min(1),
  source_path: z.string().min(1),
  display_name: z.string().optional(),
});

const cloneRepoSchema = z.object({
  actor: z.string().min(1),
  url: z.string().min(1),
  display_name: z.string().optional(),
  branch: z.string().optional(),
});

const importManagedPackSchema = z.object({
  actor: z.string().min(1),
  project_key: z.string().min(1),
  display_name: z.string().optional(),
});

const repoActivateSchema = z.object({
  actor: z.string().min(1),
  repo_id: z.string().min(1),
  state: z
    .object({
      activeBranch: z.string().optional(),
      activeWorktreePath: z.string().optional(),
      selectedTicketId: z.string().nullable().optional(),
      selectedRunId: z.string().nullable().optional(),
      recentChatSessionIds: z.array(z.string()).optional(),
      lastContextManifestId: z.string().nullable().optional(),
      retrievalCacheKeys: z.array(z.string()).optional(),
      providerSessions: z.array(z.record(z.unknown())).optional(),
      metadata: z.record(z.unknown()).optional(),
    })
    .optional(),
});

const repoSuspendSchema = z.object({
  actor: z.string().min(1),
  repo_id: z.string().min(1),
  state: repoActivateSchema.shape.state.optional(),
});

const repoSwitchPrepareSchema = z.object({
  actor: z.string().min(1),
  to_repo_id: z.string().min(1),
  state: repoActivateSchema.shape.state.optional(),
});

const benchmarkRunStartSchema = z.object({
  actor: z.string().min(1),
  project_id: z.string().min(1),
  task_id: z.string().min(1),
  mode: z.enum(["operator_e2e", "api_regression", "repo_headless"]).optional(),
  provider_role: z.enum(["utility_fast", "coder_default", "review_deep", "overseer_escalation"]).optional(),
  repo_id: z.string().optional(),
});

const benchmarkTaskExecuteSchema = z.object({
  actor: z.string().min(1),
  run_id: z.string().min(1),
});

const githubConnectSchema = z.object({
  actor: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  clone_url: z.string().url().optional(),
  display_name: z.string().optional(),
  default_branch: z.string().optional(),
  installation_id: z.string().optional(),
  github_repo_id: z.string().optional(),
});

const executionPlanSchema = z.object({
  actor: z.string().min(1),
  run_id: z.string().min(1),
  repo_id: z.string().min(1),
  objective: z.string().min(1),
  worktree_path: z.string().min(1),
  project_id: z.string().optional(),
  ticket_id: z.string().optional(),
  query_mode: z.enum(["basic", "impact", "review", "architecture", "cross_project"]).optional(),
  model_role: z.enum(["utility_fast", "coder_default", "review_deep", "overseer_escalation"]).optional(),
  provider_id: z.enum(["qwen-cli", "openai-compatible", "onprem-qwen", "openai-responses"]).optional(),
  routing_decision_id: z.string().optional(),
  verification_plan: z.array(z.string()).optional(),
  docs_required: z.array(z.string()).optional(),
});

const executionStartSchema = z.object({
  actor: z.string().min(1),
  run_id: z.string().min(1),
  repo_id: z.string().min(1),
  worktree_path: z.string().min(1),
  objective: z.string().min(1),
  project_id: z.string().optional(),
  project_key: z.string().optional(),
  model_role: z.enum(["utility_fast", "coder_default", "review_deep", "overseer_escalation"]),
  provider_id: z.enum(["qwen-cli", "openai-compatible", "onprem-qwen", "openai-responses"]),
  routing_decision_id: z.string().optional(),
  context_pack_id: z.string().optional(),
});

const executionVerifySchema = z.object({
  actor: z.string().min(1),
  run_id: z.string().min(1),
  repo_id: z.string().min(1),
  worktree_path: z.string().min(1),
  execution_attempt_id: z.string().optional(),
  commands: z.array(z.string()).min(1),
  docs_required: z.array(z.string()).optional(),
  full_suite_run: z.boolean().optional(),
});

const scaffoldBootstrapSchema = z.object({
  actor: z.string().min(1),
  folderPath: z.string().min(1),
  displayName: z.string().optional(),
  starterId: projectStarterIdSchema.nullable().optional(),
  initializeGit: z.boolean().default(true),
});

const scaffoldExecuteSchema = z.object({
  actor: z.string().min(1),
  objective: z.string().min(1).optional(),
  starterId: projectStarterIdSchema.optional(),
});

const blueprintUpdateSchema = z.object({
  charter: z
    .object({
      productIntent: z.string().optional(),
      successCriteria: z.array(z.string()).optional(),
      constraints: z.array(z.string()).optional(),
      riskPosture: z.enum(["low", "medium", "high"]).optional(),
    })
    .optional(),
  codingStandards: z
    .object({
      principles: z.array(z.string()).optional(),
      filePlacementRules: z.array(z.string()).optional(),
      architectureRules: z.array(z.string()).optional(),
      dependencyRules: z.array(z.string()).optional(),
      reviewStyle: z.enum(["findings_first", "summary_first"]).optional(),
    })
    .optional(),
  testingPolicy: z
    .object({
      requiredForBehaviorChange: z.boolean().optional(),
      defaultCommands: z.array(z.string()).optional(),
      impactedTestStrategy: z.enum(["required", "preferred"]).optional(),
      fullSuitePolicy: z.enum(["on_major_change", "manual", "always"]).optional(),
    })
    .optional(),
  documentationPolicy: z
    .object({
      updateUserFacingDocs: z.boolean().optional(),
      updateRunbooksWhenOpsChange: z.boolean().optional(),
      requiredDocPaths: z.array(z.string()).optional(),
      changelogPolicy: z.enum(["none", "recommended", "required"]).optional(),
    })
    .optional(),
  executionPolicy: z
    .object({
      approvalRequiredFor: z.array(z.string()).optional(),
      protectedPaths: z.array(z.string()).optional(),
      maxChangedFilesBeforeReview: z.number().int().positive().optional(),
      allowParallelExecution: z.boolean().optional(),
    })
    .optional(),
  providerPolicy: z
    .object({
      preferredCoderRole: z.literal("coder_default").optional(),
      reviewRole: z.literal("review_deep").optional(),
      escalationPolicy: z.enum(["manual", "high_risk_only", "auto"]).optional(),
      executionProfileId: z.string().nullable().optional(),
    })
    .optional(),
});

type RepoRecord = Awaited<ReturnType<RepoService["listRepos"]>>[number];

type ProjectRouteDeps = {
  app: FastifyInstance;
  repoService: RepoService;
  benchmarkService: BenchmarkService;
  codeGraphService: CodeGraphService;
  executionService: ExecutionService;
  githubService: GitHubService;
  projectBlueprintService: ProjectBlueprintService;
  projectScaffoldService: ProjectScaffoldService;
};

function asRecord(value: unknown) {
  return (value ?? {}) as Record<string, unknown>;
}

async function resolveManagedExecutionWorktreePath(repoService: RepoService, repoId: string) {
  return path.resolve(await repoService.getActiveWorktreePath(repoId));
}

async function getTicketBoundRunProjection(runId: string, repoId: string) {
  const runProjection = await prisma.runProjection.findUnique({
    where: { runId },
    select: { ticketId: true, metadata: true },
  });
  if (!runProjection) {
    return { ok: false as const, statusCode: 404, error: `Run not found: ${runId}` };
  }

  const metadata = asRecord(runProjection.metadata);
  const projectionRepoId = typeof metadata.repo_id === "string" ? metadata.repo_id : null;
  if (projectionRepoId && projectionRepoId !== repoId) {
    return {
      ok: false as const,
      statusCode: 400,
      error: `Run ${runId} does not belong to repo ${repoId}`,
    };
  }

  if (typeof runProjection.ticketId !== "string" || runProjection.ticketId.trim().length === 0) {
    return {
      ok: false as const,
      statusCode: 400,
      error: `Legacy execution route requires a ticket-bound run: ${runId}`,
    };
  }

  return {
    ok: true as const,
    ticketId: runProjection.ticketId,
  };
}

async function attachOrBootstrapLocal(
  input: z.infer<typeof attachLocalRepoSchema>,
  deps: Pick<ProjectRouteDeps, "repoService">
) {
  const inspection = await deps.repoService.inspectLocalPath(input.source_path);
  if (!inspection.isGitRepo) {
    if (inspection.isEmpty || !inspection.hasFiles) {
      return {
        bootstrapRequired: true as const,
        emptyFolder: true as const,
        folderPath: inspection.absolutePath,
        suggestedStarterId: DEFAULT_EMPTY_FOLDER_STARTER_ID,
        canStartBlank: true as const,
      };
    }
    throw new Error("Selected folder is not a Git repo. Choose an existing repo or an empty folder to initialize.");
  }

  const result = await deps.repoService.attachLocalRepo(input);
  const guidelines = await deps.repoService.getGuidelines(result.repo.id);
  return {
    bootstrapRequired: false as const,
    project: mapRepoToProjectBinding(result.repo, guidelines ? 1 : 0),
    ...result,
  };
}

export function registerProjectRoutes(deps: ProjectRouteDeps) {
  const {
    app,
    repoService,
    benchmarkService,
    codeGraphService,
    executionService,
    githubService,
    projectBlueprintService,
    projectScaffoldService,
  } = deps;

  app.post("/api/v4/commands/repo.attach-local", async (request) => {
    const input = attachLocalRepoSchema.parse(request.body);
    return repoService.attachLocalRepo(input);
  });

  app.post("/api/v4/commands/repo.clone", async (request) => {
    const input = cloneRepoSchema.parse(request.body);
    return repoService.cloneRepo(input);
  });

  app.post("/api/v4/commands/repo.register", async (request) => {
    const input = importManagedPackSchema.parse(request.body);
    return repoService.importManagedPack(input);
  });

  app.post("/api/v4/commands/repo.activate", async (request) => {
    const input = repoActivateSchema.parse(request.body);
    return repoService.activateRepo(input);
  });

  app.post("/api/v4/commands/repo.suspend", async (request) => {
    const input = repoSuspendSchema.parse(request.body);
    return repoService.suspendRepo(input.actor, input.repo_id, input.state);
  });

  app.post("/api/v4/commands/repo.refresh-guidelines", async (request) => {
    const input = z.object({ repo_id: z.string().min(1) }).parse(request.body);
    return {
      item: await repoService.refreshGuidelines(input.repo_id),
    };
  });

  app.post("/api/v4/commands/repo.refresh-index", async (request) => {
    const input = z.object({ repo_id: z.string().min(1) }).parse(request.body);
    return {
      item: await repoService.refreshIndex(input.repo_id),
    };
  });

  app.post("/api/v4/commands/repo.resume", async (request) => {
    const input = repoActivateSchema.parse(request.body);
    return repoService.activateRepo(input);
  });

  app.post("/api/v4/commands/repo.switch-prepare", async (request) => {
    const input = repoSwitchPrepareSchema.parse(request.body);
    return {
      item: await repoService.prepareSwitch(input),
    };
  });

  app.post("/api/v4/commands/repo.switch-commit", async (request) => {
    const input = z.object({ actor: z.string().min(1), checkpoint_id: z.string().min(1) }).parse(request.body);
    return repoService.commitSwitch(input.actor, input.checkpoint_id);
  });

  app.post("/api/v4/commands/benchmark.run.start", async (request) => {
    const input = benchmarkRunStartSchema.parse(request.body);
    return benchmarkService.startRun(input);
  });

  app.post("/api/v4/commands/benchmark.task.execute", async (request) => {
    const input = benchmarkTaskExecuteSchema.parse(request.body);
    return benchmarkService.executeTask(input.run_id, input.actor);
  });

  app.post("/api/v4/commands/benchmark.score.recompute", async (request) => {
    const input = benchmarkTaskExecuteSchema.parse(request.body);
    return benchmarkService.scoreRun(input.run_id, input.actor);
  });

  app.get("/api/v4/repos", async () => ({
    items: await repoService.listRepos(),
  }));

  app.get("/api/v4/repos/active", async () => ({
    item: await repoService.getActiveRepo(),
  }));

  app.get("/api/v4/repos/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await repoService.getRepo(id),
    };
  });

  app.get("/api/v4/repos/:id/state", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await repoService.getState(id),
    };
  });

  app.get("/api/v4/repos/:id/guidelines", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await repoService.getGuidelines(id),
    };
  });

  app.get("/api/v4/repos/:id/context", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await repoService.getLatestIndexSnapshot(id),
    };
  });

  app.get("/api/v4/repos/:id/benchmarks", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      items: await prisma.benchmarkProject.findMany({
        where: { repoId: id },
        orderBy: { displayName: "asc" },
      }),
    };
  });

  app.get("/api/v4/benchmarks/projects", async () => ({
    items: await benchmarkService.listProjects(),
  }));

  app.get("/api/v4/benchmarks/projects/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    return benchmarkService.getProject(id);
  });

  app.get("/api/v4/benchmarks/runs/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    return benchmarkService.getRun(id);
  });

  app.get("/api/v4/benchmarks/runs/:id/scorecard", async (request) => {
    const id = (request.params as { id: string }).id;
    const result = await benchmarkService.getRun(id);
    return {
      item: result?.scorecard || null,
    };
  });

  app.get("/api/v4/benchmarks/runs/:id/artifacts", async (request) => {
    const id = (request.params as { id: string }).id;
    const result = await benchmarkService.getRun(id);
    return {
      items: result?.evidence || [],
    };
  });

  app.get("/api/v4/benchmarks/leaderboard", async () => ({
    items: await benchmarkService.getLeaderboard(),
  }));

  app.get("/api/v4/benchmarks/failures", async () => ({
    items: await benchmarkService.listFailures(),
  }));

  app.post("/api/v5/commands/project.connect.local", async (request) => {
    const input = attachLocalRepoSchema.parse(request.body);
    const result = await repoService.attachLocalRepo(input);
    const guidelines = await repoService.getGuidelines(result.repo.id);
    return {
      project: mapRepoToProjectBinding(result.repo, guidelines ? 1 : 0),
      ...result,
    };
  });

  app.post("/api/v5/commands/project.connect.github", async (request) => {
    const input = githubConnectSchema.parse(request.body);
    return githubService.connectRepo(input);
  });

  app.post("/api/v5/commands/project.sync", async (request) => {
    const input = z.object({ actor: z.string().min(1), repo_id: z.string().min(1) }).parse(request.body);
    return githubService.syncRepo(input.actor, input.repo_id);
  });

  app.post("/api/v5/commands/project.activate", async (request) => {
    const input = repoActivateSchema.parse(request.body);
    const result = await repoService.activateRepo(input);
    const guidelines = await repoService.getGuidelines(result.repo.id);
    return {
      project: mapRepoToProjectBinding(result.repo, guidelines ? 1 : 0),
      ...result,
    };
  });

  app.post("/api/v5/commands/project.pause", async (request) => {
    const input = repoSuspendSchema.parse(request.body);
    const result = await repoService.suspendRepo(input.actor, input.repo_id, input.state);
    const guidelines = await repoService.getGuidelines(result.repo.id);
    return {
      project: mapRepoToProjectBinding(result.repo, guidelines ? 1 : 0),
      ...result,
    };
  });

  app.post("/api/v5/commands/codegraph.index.start", async (request) => {
    const input = z.object({ actor: z.string().min(1), repo_id: z.string().min(1) }).parse(request.body);
    const repo = await repoService.getRepo(input.repo_id);
    if (!repo) {
      throw new Error(`Repo not found: ${input.repo_id}`);
    }
    return {
      item: await codeGraphService.indexRepo(input.repo_id, path.join(repo.managedWorktreeRoot, "active"), input.actor),
    };
  });

  app.post("/api/v5/commands/codegraph.index.refresh", async (request) => {
    const input = z.object({ actor: z.string().min(1), repo_id: z.string().min(1) }).parse(request.body);
    const repo = await repoService.getRepo(input.repo_id);
    if (!repo) {
      throw new Error(`Repo not found: ${input.repo_id}`);
    }
    return {
      item: await codeGraphService.indexRepo(input.repo_id, path.join(repo.managedWorktreeRoot, "active"), input.actor),
    };
  });

  app.post("/api/v5/commands/context.pack.build", async (request) => {
    const input = z
      .object({
        actor: z.string().min(1),
        repo_id: z.string().min(1),
        objective: z.string().min(1),
        query_mode: z.enum(["basic", "impact", "review", "architecture", "cross_project"]).optional(),
        token_budget: z.number().int().positive().optional(),
        aggregate_id: z.string().optional(),
      })
      .parse(request.body);
    return codeGraphService.buildContextPack({
      actor: input.actor,
      repoId: input.repo_id,
      objective: input.objective,
      queryMode: input.query_mode,
      tokenBudget: input.token_budget,
      aggregateId: input.aggregate_id,
    });
  });

  app.post("/api/v5/commands/execution.plan", async (request, reply) => {
    const input = executionPlanSchema.parse(request.body);
    if (!input.ticket_id) {
      return reply.code(400).send({
        error: "Legacy execution planning requires ticket_id. Use mission execution routes for ad-hoc runs.",
      });
    }
    const worktreePath = await resolveManagedExecutionWorktreePath(repoService, input.repo_id);
    return executionService.planExecution({
      actor: input.actor,
      runId: input.run_id,
      repoId: input.repo_id,
      projectId: input.project_id,
      ticketId: input.ticket_id,
      objective: input.objective,
      worktreePath,
      queryMode: input.query_mode,
      modelRole: input.model_role,
      providerId: input.provider_id,
      routingDecisionId: input.routing_decision_id,
      verificationPlan: input.verification_plan,
      docsRequired: input.docs_required,
    });
  });

  app.post("/api/v5/commands/execution.start", async (request, reply) => {
    const input = executionStartSchema.parse(request.body);
    const runProjection = await getTicketBoundRunProjection(input.run_id, input.repo_id);
    if (!runProjection.ok) {
      return reply.code(runProjection.statusCode).send({ error: runProjection.error });
    }
    const worktreePath = await resolveManagedExecutionWorktreePath(repoService, input.repo_id);
    return {
      item: await executionService.startExecution({
        actor: input.actor,
        runId: input.run_id,
        repoId: input.repo_id,
        projectId: input.project_id,
        projectKey: input.project_key,
        worktreePath,
        objective: input.objective,
        modelRole: input.model_role,
        providerId: input.provider_id,
        routingDecisionId: input.routing_decision_id,
        contextPackId: input.context_pack_id,
      }),
    };
  });

  app.post("/api/v5/commands/execution.verify", async (request, reply) => {
    const input = executionVerifySchema.parse(request.body);
    const runProjection = await getTicketBoundRunProjection(input.run_id, input.repo_id);
    if (!runProjection.ok) {
      return reply.code(runProjection.statusCode).send({ error: runProjection.error });
    }
    const worktreePath = await resolveManagedExecutionWorktreePath(repoService, input.repo_id);
    return {
      item: await executionService.verifyExecution({
        actor: input.actor,
        runId: input.run_id,
        repoId: input.repo_id,
        worktreePath,
        executionAttemptId: input.execution_attempt_id,
        commands: buildVerificationCommandPlans(input.commands),
        docsRequired: input.docs_required,
        fullSuiteRun: input.full_suite_run,
      }),
    };
  });

  app.post("/api/v5/commands/benchmark.run.execute", async (request) => {
    const input = benchmarkTaskExecuteSchema.parse(request.body);
    const executed = await benchmarkService.executeTask(input.run_id, input.actor);
    const scored = await benchmarkService.scoreRun(input.run_id, input.actor);
    return {
      ...executed,
      scorecard: scored.scorecard,
      evidence: scored.evidence,
    };
  });

  app.post("/api/v5/commands/github.pr.open", async (request) => {
    const input = z
      .object({
        actor: z.string().min(1),
        repo_id: z.string().min(1),
        run_id: z.string().min(1),
        title: z.string().min(1),
        summary: z.string().min(1),
        branch: z.string().min(1),
        base_branch: z.string().min(1),
        evidence_urls: z.array(z.string()).optional(),
      })
      .parse(request.body);
    return githubService.createLocalDraftPr({
      actor: input.actor,
      repoId: input.repo_id,
      runId: input.run_id,
      title: input.title,
      summary: input.summary,
      branch: input.branch,
      baseBranch: input.base_branch,
      evidenceUrls: input.evidence_urls,
    });
  });

  app.get("/api/v5/projects", async () => {
    const repos = await repoService.listRepos();
    const guidelineRows = await prisma.repoGuidelineProfile.findMany();
    const versionByRepoId = new Map(guidelineRows.map((row) => [row.repoId, 1]));
    return {
      items: repos.map((repo) => mapRepoToProjectBinding(repo, versionByRepoId.get(repo.id) || 0)),
    };
  });

  app.get("/api/v5/projects/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    const repo = await repoService.getRepo(id);
    const guidelines = await repoService.getGuidelines(id);
    return {
      item: repo ? mapRepoToProjectBinding(repo, guidelines ? 1 : 0) : null,
      repo,
      github: await prisma.gitHubRepoBinding.findUnique({ where: { repoId: id } }),
    };
  });

  app.get("/api/v5/projects/:id/state", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await repoService.getState(id),
    };
  });

  app.get("/api/v5/projects/:id/guidelines", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await repoService.getGuidelines(id),
    };
  });

  app.get("/api/v5/projects/:id/codegraph/status", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await codeGraphService.getStatus(id),
    };
  });

  app.get("/api/v5/projects/:id/context-pack", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await codeGraphService.getLatestContextPack(id),
    };
  });

  app.get("/api/v5/projects/:id/pull-requests", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      items: await githubService.listPullRequests(id),
    };
  });

  app.get("/api/v5/runs/:id/attempts", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      items: await codeGraphService.getExecutionAttempts(id),
    };
  });

  app.get("/api/v5/runs/:id/verification", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await codeGraphService.getVerificationBundle(id),
    };
  });

  app.get("/api/v5/runs/:id/share", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await githubService.getShareReport(id),
    };
  });

  app.get("/api/v5/benchmarks/leaderboard", async () => ({
    items: await benchmarkService.getLeaderboard(),
  }));

  app.get("/api/v5/codegraph/query", async (request) => {
    const query = request.query as {
      repoId?: string;
      q?: string;
      mode?: "basic" | "impact" | "review" | "architecture" | "cross_project";
    };
    if (!query.repoId || !query.q) {
      return {
        item: null,
        items: [],
      };
    }
    return codeGraphService.query(query.repoId, query.q, query.mode || "basic");
  });

  app.get("/api/v8/projects/:id/blueprint", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await projectBlueprintService.get(id),
    };
  });

  app.get("/api/v8/projects/:id/blueprint/sources", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      items: await projectBlueprintService.getSources(id),
    };
  });

  app.get("/api/v8/project-starters", async () => ({
    items: projectScaffoldService.listStarters(),
  }));

  app.post("/api/v8/projects/connect/local", async (request) => {
    const input = attachLocalRepoSchema.parse(request.body);
    return attachOrBootstrapLocal(input, { repoService });
  });

  app.post("/api/v8/projects/connect/github", async (request) => {
    const input = githubConnectSchema.parse(request.body);
    return githubService.connectRepo(input);
  });

  app.post("/api/v8/projects/open-recent", async (request) => {
    const input = attachLocalRepoSchema.parse(request.body);
    return attachOrBootstrapLocal(input, { repoService });
  });

  app.post("/api/v8/projects/bootstrap/empty", async (request) => {
    const input = scaffoldBootstrapSchema.parse(request.body);
    const result = await projectScaffoldService.bootstrapEmptyProject(input);
    const guidelines = await repoService.getGuidelines(result.repo.id);
    return {
      project: mapRepoToProjectBinding(result.repo, guidelines ? 1 : 0),
      ...result,
    };
  });

  app.post("/api/v8/projects/:id/blueprint/generate", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await projectBlueprintService.generate(id),
    };
  });

  app.post("/api/v8/projects/:id/blueprint/update", async (request) => {
    const id = (request.params as { id: string }).id;
    const patch = blueprintUpdateSchema.parse(request.body);
    return {
      item: await projectBlueprintService.update(id, patch),
    };
  });

  app.post("/api/v8/projects/:id/scaffold/plan", async (request) => {
    const id = (request.params as { id: string }).id;
    const input = z.object({ starterId: projectStarterIdSchema.optional() }).parse(request.body ?? {});
    return {
      item: await projectScaffoldService.plan(id, input.starterId),
    };
  });

  app.post("/api/v8/projects/:id/scaffold/execute", async (request) => {
    const id = (request.params as { id: string }).id;
    const input = scaffoldExecuteSchema.parse(request.body);
    return projectScaffoldService.execute({
      actor: input.actor,
      projectId: id,
      starterId: input.starterId,
      objective: input.objective,
    });
  });

  app.get("/api/v8/projects/:id/scaffold/status", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await projectScaffoldService.getStatus(id),
    };
  });

  app.get("/api/v8/projects/:id/report/latest", async (request) => {
    const id = (request.params as { id: string }).id;
    const row = await prisma.shareableRunReport.findFirst({
      where: { repoId: id },
      orderBy: { createdAt: "desc" },
    });
    const metadata = (row?.metadata as Record<string, unknown> | undefined) ?? {};
    const changedFiles =
      Array.isArray(metadata.changed_files)
        ? (metadata.changed_files as string[])
        : Array.isArray(metadata.changedFiles)
        ? (metadata.changedFiles as string[])
        : [];
    const explicitDocsUpdated =
      Array.isArray(metadata.docs_updated)
        ? (metadata.docs_updated as string[])
        : Array.isArray(metadata.docsUpdated)
        ? (metadata.docsUpdated as string[])
        : [];
    const inferredDocsUpdated = changedFiles.filter(
      (file) => file === "AGENTS.md" || file === "README.md" || file.startsWith("docs/") || file.endsWith(".md")
    );
    const docsUpdated = explicitDocsUpdated.length > 0 ? explicitDocsUpdated : inferredDocsUpdated;
    return {
      item: row
        ? {
            id: row.id,
            runId: row.runId,
            projectId: row.repoId,
            summary: row.summary,
            changedFiles,
            testsPassed: Array.isArray(metadata.tests_passed)
              ? (metadata.tests_passed as string[])
              : Array.isArray(metadata.testsPassed)
              ? (metadata.testsPassed as string[])
              : [],
            docsUpdated,
            remainingRisks: Array.isArray(metadata.remaining_risks)
              ? (metadata.remaining_risks as string[])
              : Array.isArray(metadata.remainingRisks)
              ? (metadata.remainingRisks as string[])
              : [],
            pullRequestUrl: row.pullRequestUrl,
            createdAt: row.createdAt.toISOString(),
          }
        : null,
    };
  });
}

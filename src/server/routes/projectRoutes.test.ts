import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    runProjection: {
      findUnique: vi.fn(),
    },
    benchmarkProject: {
      findMany: vi.fn(),
    },
    repoGuidelineProfile: {
      findMany: vi.fn(),
    },
    gitHubRepoBinding: {
      findUnique: vi.fn(),
    },
    shareableRunReport: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("../db", () => ({
  prisma: mocks.prisma,
}));

import { registerProjectRoutes } from "./projectRoutes";

const fakeRepo = {
  id: "repo-1",
  displayName: "Test Repo",
  sourceKind: "local_attached",
  sourceUri: "/tmp/test",
  repoRoot: "/tmp/test",
  managedWorktreeRoot: "/managed/worktrees/repo-1",
  defaultBranch: "main",
  active: true,
  attachedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  metadata: {},
};

function createHarness() {
  const app = Fastify();
  const repoService = {
    getActiveWorktreePath: vi.fn().mockResolvedValue("/managed/worktrees/repo-1/active"),
    attachLocalRepo: vi.fn().mockResolvedValue({ repo: fakeRepo }),
    cloneRepo: vi.fn().mockResolvedValue({ repo: fakeRepo }),
    importManagedPack: vi.fn().mockResolvedValue({ repo: fakeRepo }),
    activateRepo: vi.fn().mockResolvedValue({ repo: fakeRepo }),
    suspendRepo: vi.fn().mockResolvedValue({ repo: fakeRepo }),
    refreshGuidelines: vi.fn().mockResolvedValue({ version: 1 }),
    refreshIndex: vi.fn().mockResolvedValue({ indexed: true }),
    prepareSwitch: vi.fn().mockResolvedValue({ checkpoint_id: "cp-1" }),
    commitSwitch: vi.fn().mockResolvedValue({ switched: true }),
    listRepos: vi.fn().mockResolvedValue([fakeRepo]),
    getActiveRepo: vi.fn().mockResolvedValue(fakeRepo),
    getRepo: vi.fn().mockResolvedValue(fakeRepo),
    getState: vi.fn().mockResolvedValue({ active: true }),
    getGuidelines: vi.fn().mockResolvedValue({ version: 1, rules: [] }),
    getLatestIndexSnapshot: vi.fn().mockResolvedValue({ files: [] }),
    inspectLocalPath: vi.fn(),
  };
  const benchmarkService = {
    startRun: vi.fn().mockResolvedValue({ id: "bench-run-1" }),
    executeTask: vi.fn().mockResolvedValue({ id: "bench-task-1" }),
    scoreRun: vi.fn().mockResolvedValue({ scorecard: { score: 85 }, evidence: [] }),
    listProjects: vi.fn().mockResolvedValue([{ id: "bproj-1", name: "BenchProject" }]),
    getProject: vi.fn().mockResolvedValue({ id: "bproj-1", name: "BenchProject" }),
    getRun: vi.fn().mockResolvedValue({ id: "bench-run-1", scorecard: { score: 85 }, evidence: [{ id: "ev-1" }] }),
    getLeaderboard: vi.fn().mockResolvedValue([{ rank: 1, id: "bproj-1" }]),
    listFailures: vi.fn().mockResolvedValue([{ id: "fail-1" }]),
  };
  const executionService = {
    planExecution: vi.fn().mockResolvedValue({ ok: true, contextPack: { id: "cp-1" } }),
    startExecution: vi.fn().mockResolvedValue({ id: "attempt-1" }),
    verifyExecution: vi.fn().mockResolvedValue({ id: "verification-1" }),
  };
  const codeGraphService = {
    indexRepo: vi.fn().mockResolvedValue({ indexed: true }),
    buildContextPack: vi.fn().mockResolvedValue({ pack: { files: [] }, retrievalTrace: { retrievalIds: [] } }),
    getStatus: vi.fn().mockResolvedValue({ status: "indexed" }),
    getLatestContextPack: vi.fn().mockResolvedValue({ id: "pack-1" }),
    getExecutionAttempts: vi.fn().mockResolvedValue([{ id: "attempt-1" }]),
    getVerificationBundle: vi.fn().mockResolvedValue({ id: "bundle-1" }),
    query: vi.fn().mockResolvedValue({ items: [] }),
  };
  const githubService = {
    connectRepo: vi.fn().mockResolvedValue({ connected: true }),
    syncRepo: vi.fn().mockResolvedValue({ synced: true }),
    createLocalDraftPr: vi.fn().mockResolvedValue({ pr_id: "pr-1" }),
    listPullRequests: vi.fn().mockResolvedValue([{ id: "pr-1" }]),
    getShareReport: vi.fn().mockResolvedValue({ id: "report-1" }),
  };
  const projectBlueprintService = {
    get: vi.fn().mockResolvedValue({ id: "bp-1", version: 1 }),
    getSources: vi.fn().mockResolvedValue([{ id: "src-1" }]),
    generate: vi.fn().mockResolvedValue({ id: "bp-1", version: 2 }),
    update: vi.fn().mockResolvedValue({ id: "bp-1", version: 2 }),
  };
  const projectScaffoldService = {
    listStarters: vi.fn().mockReturnValue([
      {
        id: "neutral_baseline",
        label: "Neutral Baseline",
        description: "Generic starter.",
        kind: "generic",
        recommended: true,
        verificationMode: "none",
      },
      {
        id: "typescript_vite_react",
        label: "TypeScript App",
        description: "Stack starter.",
        kind: "stack",
        recommended: false,
        verificationMode: "commands",
      },
    ]),
    bootstrapEmptyProject: vi.fn().mockResolvedValue({ repo: fakeRepo }),
    plan: vi.fn().mockResolvedValue({ steps: [] }),
    execute: vi.fn().mockResolvedValue({ executed: true }),
    getStatus: vi.fn().mockResolvedValue({ status: "ready" }),
  };

  registerProjectRoutes({
    app,
    repoService: repoService as never,
    benchmarkService: benchmarkService as never,
    codeGraphService: codeGraphService as never,
    executionService: executionService as never,
    githubService: githubService as never,
    projectBlueprintService: projectBlueprintService as never,
    projectScaffoldService: projectScaffoldService as never,
  });

  return { app, repoService, benchmarkService, executionService, codeGraphService, githubService, projectBlueprintService, projectScaffoldService };
}

describe("projectRoutes legacy execution hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // no-op placeholder so each test can own its Fastify instance
  });

  it("rejects v5 execution planning without a ticket id", async () => {
    const { app, executionService } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v5/commands/execution.plan",
      payload: {
        actor: "user",
        run_id: "run-1",
        repo_id: "repo-1",
        objective: "verify the build",
        worktree_path: "/tmp/evil",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Legacy execution planning requires ticket_id. Use mission execution routes for ad-hoc runs.",
    });
    expect(executionService.planExecution).not.toHaveBeenCalled();

    await app.close();
  });

  it("returns the starter catalog from the dedicated v8 endpoint", async () => {
    const { app, projectScaffoldService } = createHarness();

    const response = await app.inject({
      method: "GET",
      url: "/api/v8/project-starters",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: projectScaffoldService.listStarters(),
    });

    await app.close();
  });

  it("uses the managed worktree instead of the caller-supplied path for v5 execution start", async () => {
    mocks.prisma.runProjection.findUnique.mockResolvedValue({
      ticketId: "ticket-1",
      metadata: { repo_id: "repo-1" },
    });
    const { app, repoService, executionService } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v5/commands/execution.start",
      payload: {
        actor: "user",
        run_id: "run-1",
        repo_id: "repo-1",
        worktree_path: "/tmp/evil",
        objective: "make the patch",
        model_role: "coder_default",
        provider_id: "onprem-qwen",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(repoService.getActiveWorktreePath).toHaveBeenCalledWith("repo-1");
    expect(executionService.startExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        repoId: "repo-1",
        worktreePath: path.resolve("/managed/worktrees/repo-1/active"),
      })
    );

    await app.close();
  });

  it("rejects v5 execution verify for runs that are not ticket-bound", async () => {
    mocks.prisma.runProjection.findUnique.mockResolvedValue({
      ticketId: null,
      metadata: { repo_id: "repo-1" },
    });
    const { app, executionService } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v5/commands/execution.verify",
      payload: {
        actor: "user",
        run_id: "run-1",
        repo_id: "repo-1",
        worktree_path: "/tmp/evil",
        commands: ["npm test"],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Legacy execution route requires a ticket-bound run: run-1",
    });
    expect(executionService.verifyExecution).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects v5 execution start when run not found", async () => {
    mocks.prisma.runProjection.findUnique.mockResolvedValue(null);
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v5/commands/execution.start",
      payload: {
        actor: "user",
        run_id: "nonexistent",
        repo_id: "repo-1",
        worktree_path: "/tmp/test",
        objective: "do something",
        model_role: "coder_default",
        provider_id: "onprem-qwen",
      },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("rejects v5 execution start when run belongs to different repo", async () => {
    mocks.prisma.runProjection.findUnique.mockResolvedValue({
      ticketId: "ticket-1",
      metadata: { repo_id: "repo-other" },
    });
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v5/commands/execution.start",
      payload: {
        actor: "user",
        run_id: "run-1",
        repo_id: "repo-1",
        worktree_path: "/tmp/test",
        objective: "do something",
        model_role: "coder_default",
        provider_id: "onprem-qwen",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("does not belong to repo");
    await app.close();
  });

  it("proceeds with v5 execution plan when ticket_id is provided", async () => {
    const { app, executionService, repoService } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v5/commands/execution.plan",
      payload: {
        actor: "user",
        run_id: "run-1",
        repo_id: "repo-1",
        objective: "verify the build",
        worktree_path: "/tmp/evil",
        ticket_id: "ticket-1",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(repoService.getActiveWorktreePath).toHaveBeenCalledWith("repo-1");
    expect(executionService.planExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "ticket-1",
        worktreePath: path.resolve("/managed/worktrees/repo-1/active"),
      })
    );
    await app.close();
  });

  it("uses managed worktree for v5 execution verify with valid ticket-bound run", async () => {
    mocks.prisma.runProjection.findUnique.mockResolvedValue({
      ticketId: "ticket-1",
      metadata: { repo_id: "repo-1" },
    });
    const { app, executionService, repoService } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v5/commands/execution.verify",
      payload: {
        actor: "user",
        run_id: "run-1",
        repo_id: "repo-1",
        worktree_path: "/tmp/evil",
        commands: ["npm test"],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(repoService.getActiveWorktreePath).toHaveBeenCalledWith("repo-1");
    expect(executionService.verifyExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreePath: path.resolve("/managed/worktrees/repo-1/active"),
      })
    );
    await app.close();
  });
});

describe("projectRoutes v4 CRUD endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /api/v4/commands/repo.attach-local calls attachLocalRepo", async () => {
    const { app, repoService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v4/commands/repo.attach-local",
      payload: { actor: "user", source_path: "/tmp/repo" },
    });
    expect(response.statusCode).toBe(200);
    expect(repoService.attachLocalRepo).toHaveBeenCalledWith({ actor: "user", source_path: "/tmp/repo" });
    await app.close();
  });

  it("POST /api/v4/commands/repo.clone calls cloneRepo", async () => {
    const { app, repoService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v4/commands/repo.clone",
      payload: { actor: "user", url: "https://github.com/test/repo.git" },
    });
    expect(response.statusCode).toBe(200);
    expect(repoService.cloneRepo).toHaveBeenCalledWith({ actor: "user", url: "https://github.com/test/repo.git" });
    await app.close();
  });

  it("POST /api/v4/commands/repo.register calls importManagedPack", async () => {
    const { app, repoService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v4/commands/repo.register",
      payload: { actor: "user", project_key: "demo-pack" },
    });
    expect(response.statusCode).toBe(200);
    expect(repoService.importManagedPack).toHaveBeenCalledWith({ actor: "user", project_key: "demo-pack" });
    await app.close();
  });

  it("POST /api/v4/commands/repo.activate calls activateRepo", async () => {
    const { app, repoService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v4/commands/repo.activate",
      payload: { actor: "user", repo_id: "repo-1" },
    });
    expect(response.statusCode).toBe(200);
    expect(repoService.activateRepo).toHaveBeenCalledWith(expect.objectContaining({ actor: "user", repo_id: "repo-1" }));
    await app.close();
  });

  it("POST /api/v4/commands/repo.suspend calls suspendRepo", async () => {
    const { app, repoService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v4/commands/repo.suspend",
      payload: { actor: "user", repo_id: "repo-1" },
    });
    expect(response.statusCode).toBe(200);
    expect(repoService.suspendRepo).toHaveBeenCalledWith("user", "repo-1", undefined);
    await app.close();
  });

  it("POST /api/v4/commands/repo.refresh-guidelines calls refreshGuidelines", async () => {
    const { app, repoService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v4/commands/repo.refresh-guidelines",
      payload: { repo_id: "repo-1" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ item: { version: 1 } });
    expect(repoService.refreshGuidelines).toHaveBeenCalledWith("repo-1");
    await app.close();
  });

  it("POST /api/v4/commands/repo.refresh-index calls refreshIndex", async () => {
    const { app, repoService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v4/commands/repo.refresh-index",
      payload: { repo_id: "repo-1" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ item: { indexed: true } });
    expect(repoService.refreshIndex).toHaveBeenCalledWith("repo-1");
    await app.close();
  });

  it("POST /api/v4/commands/repo.resume calls activateRepo", async () => {
    const { app, repoService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v4/commands/repo.resume",
      payload: { actor: "user", repo_id: "repo-1" },
    });
    expect(response.statusCode).toBe(200);
    expect(repoService.activateRepo).toHaveBeenCalled();
    await app.close();
  });

  it("POST /api/v4/commands/repo.switch-prepare calls prepareSwitch", async () => {
    const { app, repoService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v4/commands/repo.switch-prepare",
      payload: { actor: "user", to_repo_id: "repo-2" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ item: { checkpoint_id: "cp-1" } });
    expect(repoService.prepareSwitch).toHaveBeenCalledWith(expect.objectContaining({ to_repo_id: "repo-2" }));
    await app.close();
  });

  it("POST /api/v4/commands/repo.switch-commit calls commitSwitch", async () => {
    const { app, repoService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v4/commands/repo.switch-commit",
      payload: { actor: "user", checkpoint_id: "cp-1" },
    });
    expect(response.statusCode).toBe(200);
    expect(repoService.commitSwitch).toHaveBeenCalledWith("user", "cp-1");
    await app.close();
  });

  it("GET /api/v4/repos lists all repos", async () => {
    const { app, repoService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v4/repos" });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(repoService.listRepos).toHaveBeenCalled();
    await app.close();
  });

  it("GET /api/v4/repos/active returns the active repo", async () => {
    const { app, repoService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v4/repos/active" });
    expect(response.statusCode).toBe(200);
    expect(response.json().item.id).toBe("repo-1");
    expect(repoService.getActiveRepo).toHaveBeenCalled();
    await app.close();
  });

  it("GET /api/v4/repos/:id returns a single repo", async () => {
    const { app, repoService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v4/repos/repo-1" });
    expect(response.statusCode).toBe(200);
    expect(response.json().item.id).toBe("repo-1");
    expect(repoService.getRepo).toHaveBeenCalledWith("repo-1");
    await app.close();
  });

  it("GET /api/v4/repos/:id/state returns repo state", async () => {
    const { app, repoService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v4/repos/repo-1/state" });
    expect(response.statusCode).toBe(200);
    expect(repoService.getState).toHaveBeenCalledWith("repo-1");
    await app.close();
  });

  it("GET /api/v4/repos/:id/guidelines returns guidelines", async () => {
    const { app, repoService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v4/repos/repo-1/guidelines" });
    expect(response.statusCode).toBe(200);
    expect(repoService.getGuidelines).toHaveBeenCalledWith("repo-1");
    await app.close();
  });

  it("GET /api/v4/repos/:id/context returns latest index snapshot", async () => {
    const { app, repoService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v4/repos/repo-1/context" });
    expect(response.statusCode).toBe(200);
    expect(repoService.getLatestIndexSnapshot).toHaveBeenCalledWith("repo-1");
    await app.close();
  });

  it("GET /api/v4/repos/:id/benchmarks returns benchmarks for a repo", async () => {
    const { app } = createHarness();
    mocks.prisma.benchmarkProject.findMany.mockResolvedValue([{ id: "bp-1" }]);
    const response = await app.inject({ method: "GET", url: "/api/v4/repos/repo-1/benchmarks" });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(mocks.prisma.benchmarkProject.findMany).toHaveBeenCalledWith({
      where: { repoId: "repo-1" },
      orderBy: { displayName: "asc" },
    });
    await app.close();
  });
});

describe("projectRoutes v4 benchmark endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /api/v4/commands/benchmark.run.start calls startRun", async () => {
    const { app, benchmarkService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v4/commands/benchmark.run.start",
      payload: { actor: "user", project_id: "bproj-1", task_id: "task-1" },
    });
    expect(response.statusCode).toBe(200);
    expect(benchmarkService.startRun).toHaveBeenCalled();
    await app.close();
  });

  it("POST /api/v4/commands/benchmark.task.execute calls executeTask", async () => {
    const { app, benchmarkService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v4/commands/benchmark.task.execute",
      payload: { actor: "user", run_id: "bench-run-1" },
    });
    expect(response.statusCode).toBe(200);
    expect(benchmarkService.executeTask).toHaveBeenCalledWith("bench-run-1", "user");
    await app.close();
  });

  it("POST /api/v4/commands/benchmark.score.recompute calls scoreRun", async () => {
    const { app, benchmarkService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v4/commands/benchmark.score.recompute",
      payload: { actor: "user", run_id: "bench-run-1" },
    });
    expect(response.statusCode).toBe(200);
    expect(benchmarkService.scoreRun).toHaveBeenCalledWith("bench-run-1", "user");
    await app.close();
  });

  it("GET /api/v4/benchmarks/projects lists benchmark projects", async () => {
    const { app, benchmarkService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v4/benchmarks/projects" });
    expect(response.statusCode).toBe(200);
    expect(benchmarkService.listProjects).toHaveBeenCalled();
    await app.close();
  });

  it("GET /api/v4/benchmarks/projects/:id returns a benchmark project", async () => {
    const { app, benchmarkService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v4/benchmarks/projects/bproj-1" });
    expect(response.statusCode).toBe(200);
    expect(benchmarkService.getProject).toHaveBeenCalledWith("bproj-1");
    await app.close();
  });

  it("GET /api/v4/benchmarks/runs/:id returns a benchmark run", async () => {
    const { app, benchmarkService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v4/benchmarks/runs/bench-run-1" });
    expect(response.statusCode).toBe(200);
    expect(benchmarkService.getRun).toHaveBeenCalledWith("bench-run-1");
    await app.close();
  });

  it("GET /api/v4/benchmarks/runs/:id/scorecard returns scorecard", async () => {
    const { app, benchmarkService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v4/benchmarks/runs/bench-run-1/scorecard" });
    expect(response.statusCode).toBe(200);
    expect(response.json().item).toEqual({ score: 85 });
    await app.close();
  });

  it("GET /api/v4/benchmarks/runs/:id/scorecard returns null when no scorecard", async () => {
    const { app, benchmarkService } = createHarness();
    benchmarkService.getRun.mockResolvedValue({ id: "bench-run-1" });
    const response = await app.inject({ method: "GET", url: "/api/v4/benchmarks/runs/bench-run-1/scorecard" });
    expect(response.statusCode).toBe(200);
    expect(response.json().item).toBeNull();
    await app.close();
  });

  it("GET /api/v4/benchmarks/runs/:id/artifacts returns evidence", async () => {
    const { app } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v4/benchmarks/runs/bench-run-1/artifacts" });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    await app.close();
  });

  it("GET /api/v4/benchmarks/runs/:id/artifacts returns empty when no evidence", async () => {
    const { app, benchmarkService } = createHarness();
    benchmarkService.getRun.mockResolvedValue({ id: "bench-run-1" });
    const response = await app.inject({ method: "GET", url: "/api/v4/benchmarks/runs/bench-run-1/artifacts" });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([]);
    await app.close();
  });

  it("GET /api/v4/benchmarks/leaderboard returns leaderboard", async () => {
    const { app, benchmarkService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v4/benchmarks/leaderboard" });
    expect(response.statusCode).toBe(200);
    expect(benchmarkService.getLeaderboard).toHaveBeenCalled();
    await app.close();
  });

  it("GET /api/v4/benchmarks/failures lists failures", async () => {
    const { app, benchmarkService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v4/benchmarks/failures" });
    expect(response.statusCode).toBe(200);
    expect(benchmarkService.listFailures).toHaveBeenCalled();
    await app.close();
  });
});

describe("projectRoutes v5 endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /api/v5/commands/project.connect.local attaches repo and returns project binding", async () => {
    const { app, repoService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v5/commands/project.connect.local",
      payload: { actor: "user", source_path: "/tmp/repo" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.project).toBeDefined();
    expect(body.project.id).toBe("repo-1");
    expect(repoService.attachLocalRepo).toHaveBeenCalled();
    expect(repoService.getGuidelines).toHaveBeenCalledWith("repo-1");
    await app.close();
  });

  it("POST /api/v5/commands/project.connect.local sets guidelineProfileVersion=0 when no guidelines", async () => {
    const { app, repoService } = createHarness();
    repoService.getGuidelines.mockResolvedValue(null);
    const response = await app.inject({
      method: "POST",
      url: "/api/v5/commands/project.connect.local",
      payload: { actor: "user", source_path: "/tmp/repo" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().project.guidelineProfileVersion).toBe(0);
    await app.close();
  });

  it("POST /api/v5/commands/project.connect.github connects github repo", async () => {
    const { app, githubService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v5/commands/project.connect.github",
      payload: { actor: "user", owner: "test", repo: "myrepo" },
    });
    expect(response.statusCode).toBe(200);
    expect(githubService.connectRepo).toHaveBeenCalled();
    await app.close();
  });

  it("POST /api/v5/commands/project.sync syncs a github repo", async () => {
    const { app, githubService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v5/commands/project.sync",
      payload: { actor: "user", repo_id: "repo-1" },
    });
    expect(response.statusCode).toBe(200);
    expect(githubService.syncRepo).toHaveBeenCalledWith("user", "repo-1");
    await app.close();
  });

  it("POST /api/v5/commands/project.activate activates and returns project binding", async () => {
    const { app, repoService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v5/commands/project.activate",
      payload: { actor: "user", repo_id: "repo-1" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().project).toBeDefined();
    expect(repoService.activateRepo).toHaveBeenCalled();
    await app.close();
  });

  it("POST /api/v5/commands/project.pause suspends and returns project binding", async () => {
    const { app, repoService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v5/commands/project.pause",
      payload: { actor: "user", repo_id: "repo-1" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().project).toBeDefined();
    expect(repoService.suspendRepo).toHaveBeenCalledWith("user", "repo-1", undefined);
    await app.close();
  });

  it("POST /api/v5/commands/codegraph.index.start indexes a repo", async () => {
    const { app, repoService, codeGraphService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v5/commands/codegraph.index.start",
      payload: { actor: "user", repo_id: "repo-1" },
    });
    expect(response.statusCode).toBe(200);
    expect(codeGraphService.indexRepo).toHaveBeenCalledWith("repo-1", expect.stringContaining("active"), "user");
    await app.close();
  });

  it("POST /api/v5/commands/codegraph.index.start errors when repo not found", async () => {
    const { app, repoService } = createHarness();
    repoService.getRepo.mockResolvedValue(null);
    const response = await app.inject({
      method: "POST",
      url: "/api/v5/commands/codegraph.index.start",
      payload: { actor: "user", repo_id: "nonexistent" },
    });
    expect(response.statusCode).toBe(500);
    await app.close();
  });

  it("POST /api/v5/commands/codegraph.index.refresh indexes a repo", async () => {
    const { app, codeGraphService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v5/commands/codegraph.index.refresh",
      payload: { actor: "user", repo_id: "repo-1" },
    });
    expect(response.statusCode).toBe(200);
    expect(codeGraphService.indexRepo).toHaveBeenCalled();
    await app.close();
  });

  it("POST /api/v5/commands/codegraph.index.refresh errors when repo not found", async () => {
    const { app, repoService } = createHarness();
    repoService.getRepo.mockResolvedValue(null);
    const response = await app.inject({
      method: "POST",
      url: "/api/v5/commands/codegraph.index.refresh",
      payload: { actor: "user", repo_id: "nonexistent" },
    });
    expect(response.statusCode).toBe(500);
    await app.close();
  });

  it("POST /api/v5/commands/context.pack.build builds context pack", async () => {
    const { app, codeGraphService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v5/commands/context.pack.build",
      payload: { actor: "user", repo_id: "repo-1", objective: "fix the bug" },
    });
    expect(response.statusCode).toBe(200);
    expect(codeGraphService.buildContextPack).toHaveBeenCalledWith(
      expect.objectContaining({ repoId: "repo-1", objective: "fix the bug" })
    );
    await app.close();
  });

  it("POST /api/v5/commands/benchmark.run.execute executes and scores a benchmark", async () => {
    const { app, benchmarkService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v5/commands/benchmark.run.execute",
      payload: { actor: "user", run_id: "bench-run-1" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.scorecard).toEqual({ score: 85 });
    expect(benchmarkService.executeTask).toHaveBeenCalledWith("bench-run-1", "user");
    expect(benchmarkService.scoreRun).toHaveBeenCalledWith("bench-run-1", "user");
    await app.close();
  });

  it("POST /api/v5/commands/github.pr.open creates a local draft PR", async () => {
    const { app, githubService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v5/commands/github.pr.open",
      payload: {
        actor: "user",
        repo_id: "repo-1",
        run_id: "run-1",
        title: "My PR",
        summary: "Summary",
        branch: "feature-1",
        base_branch: "main",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(githubService.createLocalDraftPr).toHaveBeenCalledWith(
      expect.objectContaining({ title: "My PR", branch: "feature-1" })
    );
    await app.close();
  });

  it("GET /api/v5/projects lists all projects with bindings", async () => {
    const { app, repoService } = createHarness();
    mocks.prisma.repoGuidelineProfile.findMany.mockResolvedValue([{ repoId: "repo-1" }]);
    const response = await app.inject({ method: "GET", url: "/api/v5/projects" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe("repo-1");
    expect(body.items[0].guidelineProfileVersion).toBe(1);
    await app.close();
  });

  it("GET /api/v5/projects lists projects with 0 guideline version when not found", async () => {
    const { app } = createHarness();
    mocks.prisma.repoGuidelineProfile.findMany.mockResolvedValue([]);
    const response = await app.inject({ method: "GET", url: "/api/v5/projects" });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].guidelineProfileVersion).toBe(0);
    await app.close();
  });

  it("GET /api/v5/projects/:id returns project with repo and github binding", async () => {
    const { app } = createHarness();
    mocks.prisma.gitHubRepoBinding.findUnique.mockResolvedValue({ id: "ghb-1" });
    const response = await app.inject({ method: "GET", url: "/api/v5/projects/repo-1" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.item.id).toBe("repo-1");
    expect(body.repo.id).toBe("repo-1");
    expect(body.github.id).toBe("ghb-1");
    await app.close();
  });

  it("GET /api/v5/projects/:id returns null item when repo not found", async () => {
    const { app, repoService } = createHarness();
    repoService.getRepo.mockResolvedValue(null);
    mocks.prisma.gitHubRepoBinding.findUnique.mockResolvedValue(null);
    const response = await app.inject({ method: "GET", url: "/api/v5/projects/nonexistent" });
    expect(response.statusCode).toBe(200);
    expect(response.json().item).toBeNull();
    await app.close();
  });

  it("GET /api/v5/projects/:id/state returns project state", async () => {
    const { app, repoService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v5/projects/repo-1/state" });
    expect(response.statusCode).toBe(200);
    expect(repoService.getState).toHaveBeenCalledWith("repo-1");
    await app.close();
  });

  it("GET /api/v5/projects/:id/guidelines returns guidelines", async () => {
    const { app, repoService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v5/projects/repo-1/guidelines" });
    expect(response.statusCode).toBe(200);
    expect(repoService.getGuidelines).toHaveBeenCalledWith("repo-1");
    await app.close();
  });

  it("GET /api/v5/projects/:id/codegraph/status returns codegraph status", async () => {
    const { app, codeGraphService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v5/projects/repo-1/codegraph/status" });
    expect(response.statusCode).toBe(200);
    expect(codeGraphService.getStatus).toHaveBeenCalledWith("repo-1");
    await app.close();
  });

  it("GET /api/v5/projects/:id/context-pack returns latest context pack", async () => {
    const { app, codeGraphService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v5/projects/repo-1/context-pack" });
    expect(response.statusCode).toBe(200);
    expect(codeGraphService.getLatestContextPack).toHaveBeenCalledWith("repo-1");
    await app.close();
  });

  it("GET /api/v5/projects/:id/pull-requests returns PRs", async () => {
    const { app, githubService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v5/projects/repo-1/pull-requests" });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(githubService.listPullRequests).toHaveBeenCalledWith("repo-1");
    await app.close();
  });

  it("GET /api/v5/runs/:id/attempts returns execution attempts", async () => {
    const { app, codeGraphService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v5/runs/run-1/attempts" });
    expect(response.statusCode).toBe(200);
    expect(codeGraphService.getExecutionAttempts).toHaveBeenCalledWith("run-1");
    await app.close();
  });

  it("GET /api/v5/runs/:id/verification returns verification bundle", async () => {
    const { app, codeGraphService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v5/runs/run-1/verification" });
    expect(response.statusCode).toBe(200);
    expect(codeGraphService.getVerificationBundle).toHaveBeenCalledWith("run-1");
    await app.close();
  });

  it("GET /api/v5/runs/:id/share returns share report", async () => {
    const { app, githubService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v5/runs/run-1/share" });
    expect(response.statusCode).toBe(200);
    expect(githubService.getShareReport).toHaveBeenCalledWith("run-1");
    await app.close();
  });

  it("GET /api/v5/benchmarks/leaderboard returns leaderboard", async () => {
    const { app, benchmarkService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v5/benchmarks/leaderboard" });
    expect(response.statusCode).toBe(200);
    expect(benchmarkService.getLeaderboard).toHaveBeenCalled();
    await app.close();
  });

  it("GET /api/v5/codegraph/query returns empty when missing params", async () => {
    const { app } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v5/codegraph/query" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ item: null, items: [] });
    await app.close();
  });

  it("GET /api/v5/codegraph/query performs query with valid params", async () => {
    const { app, codeGraphService } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/v5/codegraph/query?repoId=repo-1&q=find+imports",
    });
    expect(response.statusCode).toBe(200);
    expect(codeGraphService.query).toHaveBeenCalledWith("repo-1", "find imports", "basic");
    await app.close();
  });

  it("GET /api/v5/codegraph/query uses supplied mode", async () => {
    const { app, codeGraphService } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/v5/codegraph/query?repoId=repo-1&q=check&mode=architecture",
    });
    expect(response.statusCode).toBe(200);
    expect(codeGraphService.query).toHaveBeenCalledWith("repo-1", "check", "architecture");
    await app.close();
  });
});

describe("projectRoutes v8 endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/v8/projects/:id/blueprint returns blueprint", async () => {
    const { app, projectBlueprintService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v8/projects/repo-1/blueprint" });
    expect(response.statusCode).toBe(200);
    expect(response.json().item.id).toBe("bp-1");
    expect(projectBlueprintService.get).toHaveBeenCalledWith("repo-1");
    await app.close();
  });

  it("GET /api/v8/projects/:id/blueprint/sources returns sources", async () => {
    const { app, projectBlueprintService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v8/projects/repo-1/blueprint/sources" });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(projectBlueprintService.getSources).toHaveBeenCalledWith("repo-1");
    await app.close();
  });

  it("POST /api/v8/projects/connect/local attaches a local repo with bootstrapRequired=false for git repos", async () => {
    const { app, repoService } = createHarness();
    repoService.inspectLocalPath.mockResolvedValue({
      isGitRepo: true,
      absolutePath: "/tmp/repo",
      isEmpty: false,
      hasFiles: true,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v8/projects/connect/local",
      payload: { actor: "user", source_path: "/tmp/repo" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.bootstrapRequired).toBe(false);
    expect(body.project).toBeDefined();
    await app.close();
  });

  it("POST /api/v8/projects/connect/local returns bootstrapRequired=true for empty non-git folder", async () => {
    const { app, repoService } = createHarness();
    repoService.inspectLocalPath.mockResolvedValue({
      isGitRepo: false,
      absolutePath: "/tmp/empty",
      isEmpty: true,
      hasFiles: false,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v8/projects/connect/local",
      payload: { actor: "user", source_path: "/tmp/empty" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.bootstrapRequired).toBe(true);
    expect(body.emptyFolder).toBe(true);
    expect(body.canStartBlank).toBe(true);
    await app.close();
  });

  it("POST /api/v8/projects/connect/local throws for non-git folder with files", async () => {
    const { app, repoService } = createHarness();
    repoService.inspectLocalPath.mockResolvedValue({
      isGitRepo: false,
      absolutePath: "/tmp/nonempty",
      isEmpty: false,
      hasFiles: true,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v8/projects/connect/local",
      payload: { actor: "user", source_path: "/tmp/nonempty" },
    });
    expect(response.statusCode).toBe(500);
    await app.close();
  });

  it("POST /api/v8/projects/connect/github connects github repo", async () => {
    const { app, githubService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v8/projects/connect/github",
      payload: { actor: "user", owner: "test", repo: "myrepo" },
    });
    expect(response.statusCode).toBe(200);
    expect(githubService.connectRepo).toHaveBeenCalled();
    await app.close();
  });

  it("POST /api/v8/projects/open-recent attaches or bootstraps", async () => {
    const { app, repoService } = createHarness();
    repoService.inspectLocalPath.mockResolvedValue({
      isGitRepo: true,
      absolutePath: "/tmp/repo",
      isEmpty: false,
      hasFiles: true,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v8/projects/open-recent",
      payload: { actor: "user", source_path: "/tmp/repo" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().bootstrapRequired).toBe(false);
    await app.close();
  });

  it("POST /api/v8/projects/bootstrap/empty bootstraps empty project", async () => {
    const { app, projectScaffoldService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v8/projects/bootstrap/empty",
      payload: { actor: "user", folderPath: "/tmp/empty" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().project).toBeDefined();
    expect(projectScaffoldService.bootstrapEmptyProject).toHaveBeenCalled();
    await app.close();
  });

  it("POST /api/v8/projects/:id/blueprint/generate generates blueprint", async () => {
    const { app, projectBlueprintService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v8/projects/repo-1/blueprint/generate",
    });
    expect(response.statusCode).toBe(200);
    expect(projectBlueprintService.generate).toHaveBeenCalledWith("repo-1");
    await app.close();
  });

  it("POST /api/v8/projects/:id/blueprint/update updates blueprint", async () => {
    const { app, projectBlueprintService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v8/projects/repo-1/blueprint/update",
      payload: { charter: { productIntent: "Build something" } },
    });
    expect(response.statusCode).toBe(200);
    expect(projectBlueprintService.update).toHaveBeenCalledWith(
      "repo-1",
      expect.objectContaining({ charter: { productIntent: "Build something" } })
    );
    await app.close();
  });

  it("POST /api/v8/projects/:id/scaffold/plan plans scaffold", async () => {
    const { app, projectScaffoldService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v8/projects/repo-1/scaffold/plan",
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(projectScaffoldService.plan).toHaveBeenCalledWith("repo-1", undefined);
    await app.close();
  });

  it("POST /api/v8/projects/:id/scaffold/execute executes scaffold", async () => {
    const { app, projectScaffoldService } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v8/projects/repo-1/scaffold/execute",
      payload: { actor: "user" },
    });
    expect(response.statusCode).toBe(200);
    expect(projectScaffoldService.execute).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "repo-1", actor: "user" })
    );
    await app.close();
  });

  it("GET /api/v8/projects/:id/scaffold/status returns scaffold status", async () => {
    const { app, projectScaffoldService } = createHarness();
    const response = await app.inject({ method: "GET", url: "/api/v8/projects/repo-1/scaffold/status" });
    expect(response.statusCode).toBe(200);
    expect(projectScaffoldService.getStatus).toHaveBeenCalledWith("repo-1");
    await app.close();
  });
});

describe("projectRoutes GET /api/v8/projects/:id/report/latest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no report exists", async () => {
    const { app } = createHarness();
    mocks.prisma.shareableRunReport.findFirst.mockResolvedValue(null);
    const response = await app.inject({ method: "GET", url: "/api/v8/projects/repo-1/report/latest" });
    expect(response.statusCode).toBe(200);
    expect(response.json().item).toBeNull();
    await app.close();
  });

  it("returns report with changed_files from metadata", async () => {
    const { app } = createHarness();
    mocks.prisma.shareableRunReport.findFirst.mockResolvedValue({
      id: "report-1",
      runId: "run-1",
      repoId: "repo-1",
      summary: "Changes made",
      pullRequestUrl: "https://github.com/pr/1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      metadata: {
        changed_files: ["src/index.ts"],
        tests_passed: ["npm test"],
        remaining_risks: ["risk-1"],
      },
    });
    const response = await app.inject({ method: "GET", url: "/api/v8/projects/repo-1/report/latest" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.item.changedFiles).toEqual(["src/index.ts"]);
    expect(body.item.testsPassed).toEqual(["npm test"]);
    expect(body.item.remainingRisks).toEqual(["risk-1"]);
    expect(body.item.pullRequestUrl).toBe("https://github.com/pr/1");
    await app.close();
  });

  it("returns report with camelCase metadata keys", async () => {
    const { app } = createHarness();
    mocks.prisma.shareableRunReport.findFirst.mockResolvedValue({
      id: "report-1",
      runId: "run-1",
      repoId: "repo-1",
      summary: "Changes made",
      pullRequestUrl: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      metadata: {
        changedFiles: ["src/app.ts"],
        testsPassed: ["vitest run"],
        remainingRisks: [],
      },
    });
    const response = await app.inject({ method: "GET", url: "/api/v8/projects/repo-1/report/latest" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.item.changedFiles).toEqual(["src/app.ts"]);
    expect(body.item.testsPassed).toEqual(["vitest run"]);
    expect(body.item.remainingRisks).toEqual([]);
    await app.close();
  });

  it("infers docs_updated from changed_files when not explicit", async () => {
    const { app } = createHarness();
    mocks.prisma.shareableRunReport.findFirst.mockResolvedValue({
      id: "report-1",
      runId: "run-1",
      repoId: "repo-1",
      summary: "Updated docs",
      pullRequestUrl: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      metadata: {
        changed_files: ["src/index.ts", "README.md", "AGENTS.md", "docs/setup.md", "notes.md"],
      },
    });
    const response = await app.inject({ method: "GET", url: "/api/v8/projects/repo-1/report/latest" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.item.docsUpdated).toEqual(["README.md", "AGENTS.md", "docs/setup.md", "notes.md"]);
    await app.close();
  });

  it("uses explicit docs_updated over inferred when present", async () => {
    const { app } = createHarness();
    mocks.prisma.shareableRunReport.findFirst.mockResolvedValue({
      id: "report-1",
      runId: "run-1",
      repoId: "repo-1",
      summary: "Explicit docs",
      pullRequestUrl: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      metadata: {
        changed_files: ["README.md", "src/main.ts"],
        docs_updated: ["README.md"],
      },
    });
    const response = await app.inject({ method: "GET", url: "/api/v8/projects/repo-1/report/latest" });
    expect(response.statusCode).toBe(200);
    expect(response.json().item.docsUpdated).toEqual(["README.md"]);
    await app.close();
  });

  it("handles report with empty/missing metadata", async () => {
    const { app } = createHarness();
    mocks.prisma.shareableRunReport.findFirst.mockResolvedValue({
      id: "report-1",
      runId: "run-1",
      repoId: "repo-1",
      summary: "Minimal",
      pullRequestUrl: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      metadata: null,
    });
    const response = await app.inject({ method: "GET", url: "/api/v8/projects/repo-1/report/latest" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.item.changedFiles).toEqual([]);
    expect(body.item.testsPassed).toEqual([]);
    expect(body.item.docsUpdated).toEqual([]);
    expect(body.item.remainingRisks).toEqual([]);
    await app.close();
  });

  it("uses camelCase docsUpdated when present", async () => {
    const { app } = createHarness();
    mocks.prisma.shareableRunReport.findFirst.mockResolvedValue({
      id: "report-1",
      runId: "run-1",
      repoId: "repo-1",
      summary: "Docs",
      pullRequestUrl: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      metadata: {
        docsUpdated: ["API.md"],
      },
    });
    const response = await app.inject({ method: "GET", url: "/api/v8/projects/repo-1/report/latest" });
    expect(response.statusCode).toBe(200);
    expect(response.json().item.docsUpdated).toEqual(["API.md"]);
    await app.close();
  });
});

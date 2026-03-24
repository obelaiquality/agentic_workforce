import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    runProjection: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../db", () => ({
  prisma: mocks.prisma,
}));

import { registerProjectRoutes } from "./projectRoutes";

function createHarness() {
  const app = Fastify();
  const repoService = {
    getActiveWorktreePath: vi.fn().mockResolvedValue("/managed/worktrees/repo-1/active"),
  };
  const executionService = {
    planExecution: vi.fn().mockResolvedValue({ ok: true }),
    startExecution: vi.fn().mockResolvedValue({ id: "attempt-1" }),
    verifyExecution: vi.fn().mockResolvedValue({ id: "verification-1" }),
  };

  registerProjectRoutes({
    app,
    repoService: repoService as never,
    benchmarkService: {} as never,
    codeGraphService: {} as never,
    executionService: executionService as never,
    githubService: {} as never,
    projectBlueprintService: {} as never,
    projectScaffoldService: {} as never,
  });

  return { app, repoService, executionService };
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
});

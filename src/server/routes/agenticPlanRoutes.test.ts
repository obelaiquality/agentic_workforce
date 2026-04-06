import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanService } from "../plans/planService";
import { registerAgenticRoutes } from "./agenticRoutes";

const dbMocks = vi.hoisted(() => ({
  prisma: {
    runProjection: {
      upsert: vi.fn().mockResolvedValue(undefined),
      findUnique: vi.fn(),
    },
    runEvent: {
      create: vi.fn().mockResolvedValue(undefined),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("../db", () => ({
  prisma: dbMocks.prisma,
}));

vi.mock("./shared/ticketProjection", () => ({
  syncTaskProjectionFromTicket: vi.fn().mockResolvedValue(undefined),
}));

function createHarness() {
  const app = Fastify();
  const executionService = {
    executeAgentic: vi.fn(async function* () {
      yield { type: "execution_complete", finalMessage: "done", totalIterations: 1, totalToolCalls: 0 };
    }),
  };
  const repoService = {
    getRepo: vi.fn().mockResolvedValue({
      id: "proj-1",
      managedWorktreeRoot: "/tmp/project",
    }),
    getActiveWorktreePath: vi.fn().mockResolvedValue("/tmp/project/active"),
    activateRepo: vi.fn().mockResolvedValue(undefined),
  };
  const ticketService = {
    getTicket: vi.fn().mockResolvedValue({
      id: "ticket-1",
      repoId: "proj-1",
      title: "Ticket",
      description: "Task",
      status: "in_progress",
      priority: "p2",
      risk: "medium",
      acceptanceCriteria: [],
      dependencies: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    createTicket: vi.fn(),
    moveTicket: vi.fn(),
  };
  const planService = new PlanService();

  registerAgenticRoutes({
    app,
    toolRegistry: {} as any,
    executionService: executionService as any,
    repoService: repoService as any,
    ticketService: ticketService as any,
    planService,
  });

  return { app, executionService, repoService, ticketService, planService };
}

describe("agentic plan routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.prisma.runProjection.findUnique.mockResolvedValue({
      runId: "run-plan",
      ticketId: "ticket-1",
      providerId: null,
      status: "running",
      startedAt: new Date(),
      metadata: {
        repo_id: "proj-1",
        project_id: "proj-1",
        objective: "Ship the feature",
        worktree_path: "/tmp/project/active",
        provider_id: null,
        budget: null,
        plan_mode: true,
      },
    });
  });

  it("returns the active plan for a run", async () => {
    const { app, planService } = createHarness();
    await planService.startPlanningPhase("run-plan");
    await planService.submitPlan("run-plan", "# Plan\n\nDo the work.");

    const response = await app.inject({
      method: "GET",
      url: "/api/agentic/runs/run-plan/plan",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().item.phase).toBe("plan_review");
    await app.close();
  });

  it("approves a plan and resumes execution with the approved plan in context", async () => {
    const { app, planService, executionService } = createHarness();
    await planService.startPlanningPhase("run-plan");
    await planService.submitPlan("run-plan", "# Plan\n\nImplement approved work.");

    const response = await app.inject({
      method: "POST",
      url: "/api/agentic/runs/run-plan/plan/approve",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().item.phase).toBe("executing");
    expect(executionService.executeAgentic).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runId: "run-plan",
        planMode: false,
        systemPromptSuffix: expect.stringContaining("Implement approved work"),
      }),
      undefined,
    );

    await app.close();
  });

  it("answers a plan question and resumes planning", async () => {
    const { app, planService, executionService } = createHarness();
    await planService.startPlanningPhase("run-plan");
    const { questionId } = await planService.askQuestion("run-plan", "Which target?");

    const response = await app.inject({
      method: "POST",
      url: "/api/agentic/runs/run-plan/plan/answer",
      payload: {
        questionId,
        answer: "Staging first",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().item.questions[0].answer).toBe("Staging first");
    expect(executionService.executeAgentic).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runId: "run-plan",
        planMode: true,
        systemPromptSuffix: expect.stringContaining("Staging first"),
      }),
      undefined,
    );

    await app.close();
  });
});

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerAgenticRoutes } from "./agenticRoutes";

vi.mock("../db", () => ({
  prisma: {
    runProjection: {
      upsert: vi.fn().mockResolvedValue(undefined),
      findUnique: vi.fn().mockResolvedValue({ metadata: {} }),
    },
    runEvent: {
      create: vi.fn().mockResolvedValue(undefined),
      findMany: vi.fn().mockResolvedValue([]),
    },
    appSetting: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("./shared/ticketProjection", () => ({
  syncTaskProjectionFromTicket: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../eventBus", async (importOriginal) => {
  const original = await importOriginal<typeof import("../eventBus")>();
  return {
    ...original,
    publishEvent: vi.fn(),
  };
});

// Access the mocked prisma after vi.mock hoisting
import { prisma } from "../db";
const mockPrisma = vi.mocked(prisma);

function createHarness() {
  const app = Fastify();

  const toolRegistry = {} as any;
  const executionService = {
    executeAgentic: vi.fn(),
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
      status: "backlog",
      priority: "p2",
      risk: "medium",
      acceptanceCriteria: [],
      dependencies: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    createTicket: vi.fn().mockResolvedValue({
      id: "ticket-1",
      repoId: "proj-1",
      title: "Ticket",
      description: "Task",
      status: "backlog",
      priority: "p2",
      risk: "medium",
      acceptanceCriteria: [],
      dependencies: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    moveTicket: vi.fn().mockImplementation(async (id: string, status: string) => ({
      id,
      repoId: "proj-1",
      title: "Ticket",
      description: "Task",
      status,
      priority: "p2",
      risk: "medium",
      acceptanceCriteria: [],
      dependencies: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
  };
  const planService = {
    getPlan: vi.fn().mockResolvedValue(null),
    approvePlan: vi.fn().mockResolvedValue({ planContent: "The plan" }),
    rejectPlan: vi.fn().mockResolvedValue({ planContent: "rejected" }),
    refinePlan: vi.fn().mockResolvedValue({ planContent: "refined" }),
    answerQuestion: vi.fn().mockResolvedValue({ planContent: "answered" }),
  };

  registerAgenticRoutes({
    app,
    toolRegistry,
    executionService: executionService as any,
    repoService: repoService as any,
    ticketService: ticketService as any,
    planService: planService as any,
  });

  return { app, executionService, repoService, ticketService, planService };
}

describe("agenticRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/agentic/execute", () => {
    it("returns 400 when actor is missing", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/execute",
        payload: { project_id: "proj-1", objective: "do something" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("Invalid request body");

      await app.close();
    });

    it("returns 400 when objective is missing", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/execute",
        payload: { actor: "test-user", project_id: "proj-1" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("Invalid request body");

      await app.close();
    });

    it("returns SSE content type for valid request", async () => {
      const { app, executionService } = createHarness();

      async function* fakeExecute() {
        yield { type: "iteration_start", iteration: 1, messageCount: 2 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/execute",
        payload: { actor: "test-user", project_id: "proj-1", objective: "build a feature" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe("text/event-stream");

      await app.close();
    });

    it("streams events in SSE format", async () => {
      const { app, executionService } = createHarness();

      async function* fakeExecute() {
        yield { type: "iteration_start", iteration: 1, messageCount: 2 };
        yield { type: "execution_complete", finalMessage: "Done", totalIterations: 1, totalToolCalls: 0 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/execute",
        payload: { actor: "test-user", project_id: "proj-1", objective: "build a feature" },
      });

      expect(response.body).toContain("event: agentic");
      expect(response.body).toContain("event: done");
      expect(response.body).toContain('"event_type":"iteration_start"');

      await app.close();
    });

    it("sends error event when execution service throws", async () => {
      const { app, executionService } = createHarness();

      async function* failingExecute() {
        throw new Error("provider exploded");
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(failingExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/execute",
        payload: { actor: "test-user", project_id: "proj-1", objective: "build a feature" },
      });

      expect(response.body).toContain("event: error");
      expect(response.body).toContain("provider exploded");

      await app.close();
    });

    it("validates optional fields correctly", async () => {
      const { app, executionService } = createHarness();

      async function* fakeExecute() {
        yield { type: "execution_complete", finalMessage: "ok", totalIterations: 1, totalToolCalls: 0 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/execute",
        payload: {
          actor: "test-user",
          project_id: "proj-1",
          objective: "build something",
          max_iterations: 10,
          initial_model_role: "coder_default",
          budget: {
            max_tokens: 5000,
            max_cost_usd: 1,
            max_duration_ms: 60000,
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(executionService.executeAgentic).toHaveBeenCalledTimes(1);

      await app.close();
    });
  });

  describe("POST /api/agentic/start", () => {
    it("starts a tracked run", async () => {
      const { app, executionService } = createHarness();

      async function* fakeExecute() {
        yield { type: "iteration_start", iteration: 1, messageCount: 2 };
        yield { type: "execution_complete", finalMessage: "Done", totalIterations: 1, totalToolCalls: 0 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const startResponse = await app.inject({
        method: "POST",
        url: "/api/agentic/start",
        payload: { actor: "test-user", project_id: "proj-1", objective: "ship it" },
      });

      expect(startResponse.statusCode).toBe(200);
      const started = startResponse.json();
      expect(typeof started.runId).toBe("string");
      expect(started.ticket.id).toBe("ticket-1");

      await app.close();
    });

    it("returns 400 for invalid body", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/start",
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("Invalid request body");

      await app.close();
    });

    it("passes coordinator options through to execution", async () => {
      const { app, executionService } = createHarness();

      async function* fakeExecute() {
        yield { type: "execution_complete", finalMessage: "Done", totalIterations: 1, totalToolCalls: 0 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/start",
        payload: {
          actor: "test-user",
          project_id: "proj-1",
          objective: "coordinate tasks",
          coordinator: true,
          coordinator_options: {
            max_agents: 3,
            max_concurrent: 2,
            allow_respawn: true,
            conflict_resolution: "merge",
          },
          budget: {
            max_tokens: 10000,
            max_cost_usd: 5.0,
            max_duration_ms: 120000,
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.runId).toMatch(/^agentic_/);

      await app.close();
    });

    it("creates a new ticket when no ticket_id is provided and no existing ticket", async () => {
      const { app, executionService, ticketService } = createHarness();

      // Return null for getTicket to force createTicket path
      vi.mocked(ticketService.getTicket).mockResolvedValue(null);

      async function* fakeExecute() {
        yield { type: "execution_complete", finalMessage: "Done", totalIterations: 1, totalToolCalls: 0 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/start",
        payload: { actor: "test-user", project_id: "proj-1", objective: "new feature" },
      });

      expect(response.statusCode).toBe(200);
      expect(ticketService.createTicket).toHaveBeenCalled();

      await app.close();
    });

    it("skips moveTicket to in_progress when ticket is already in_progress", async () => {
      const { app, executionService, ticketService } = createHarness();

      vi.mocked(ticketService.getTicket).mockResolvedValue({
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
      });

      async function* fakeExecute() {
        yield { type: "iteration_start", iteration: 1, messageCount: 2 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/start",
        payload: { actor: "test-user", project_id: "proj-1", objective: "continue", ticket_id: "ticket-1" },
      });

      expect(response.statusCode).toBe(200);
      // moveTicket should not have been called for "in_progress" transition
      // (the background execution might call it for "review" later, but not for initial transition)
      const inProgressCalls = vi.mocked(ticketService.moveTicket).mock.calls.filter(
        (c: any) => c[1] === "in_progress"
      );
      expect(inProgressCalls).toHaveLength(0);

      await app.close();
    });

    it("handles error in background execution", async () => {
      const { app, executionService } = createHarness();

      async function* failExecute() {
        throw new Error("background crash");
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(failExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/start",
        payload: { actor: "test-user", project_id: "proj-1", objective: "crash test" },
      });

      // The start endpoint returns success immediately; the error is handled in background
      expect(response.statusCode).toBe(200);

      // Wait a tick for the background catch to fire
      await new Promise((r) => setTimeout(r, 50));

      // The upsert should have been called with "failed" status
      expect(mockPrisma.runProjection.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            status: "failed",
          }),
        })
      );

      await app.close();
    });

    it("handles non-Error thrown in background execution", async () => {
      const { app, executionService } = createHarness();

      async function* failExecute() {
        throw "string error";
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(failExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/start",
        payload: { actor: "test-user", project_id: "proj-1", objective: "string throw" },
      });

      expect(response.statusCode).toBe(200);
      await new Promise((r) => setTimeout(r, 50));

      await app.close();
    });

    it("returns 500 when project not found", async () => {
      const { app, executionService, repoService } = createHarness();

      vi.mocked(repoService.getRepo).mockResolvedValue(null);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/start",
        payload: { actor: "test-user", project_id: "nonexistent", objective: "test" },
      });

      // prepareAgenticExecution throws, which Fastify converts to 500
      expect(response.statusCode).toBe(500);

      await app.close();
    });
  });

  describe("POST /api/agentic/execute additional paths", () => {
    it("streams plan events in SSE format", async () => {
      const { app, executionService } = createHarness();

      async function* fakeExecute() {
        yield { type: "plan_started" };
        yield { type: "plan_submitted", planContent: "# My Plan" };
        yield { type: "plan_question_asked", questionId: "q1", question: "What framework?" };
        yield { type: "plan_question_answered", questionId: "q1", answer: "React" };
        yield { type: "plan_refine_requested", feedback: "Add tests" };
        yield { type: "plan_approved", reviewedBy: "user" };
        yield { type: "execution_complete", finalMessage: "Done", totalIterations: 1, totalToolCalls: 0 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/execute",
        payload: { actor: "test-user", project_id: "proj-1", objective: "plan and build" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('"event_type":"plan_started"');
      expect(response.body).toContain('"event_type":"plan_submitted"');
      expect(response.body).toContain('"event_type":"plan_question_asked"');
      expect(response.body).toContain('"event_type":"plan_question_answered"');
      expect(response.body).toContain('"event_type":"plan_refine_requested"');
      expect(response.body).toContain('"event_type":"plan_approved"');

      await app.close();
    });

    it("streams plan_rejected event", async () => {
      const { app, executionService } = createHarness();

      async function* fakeExecute() {
        yield { type: "plan_rejected", reason: "Too complex", reviewedBy: "user" };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/execute",
        payload: { actor: "test-user", project_id: "proj-1", objective: "rejected plan" },
      });

      expect(response.body).toContain('"event_type":"plan_rejected"');

      await app.close();
    });

    it("streams execution_aborted event", async () => {
      const { app, executionService } = createHarness();

      async function* fakeExecute() {
        yield { type: "execution_aborted", reason: "user requested abort" };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/execute",
        payload: { actor: "test-user", project_id: "proj-1", objective: "aborted run" },
      });

      expect(response.body).toContain('"event_type":"execution_aborted"');

      await app.close();
    });

    it("streams tool_approval_needed event", async () => {
      const { app, executionService } = createHarness();

      async function* fakeExecute() {
        yield { type: "tool_approval_needed", id: "t1", name: "shell", approvalId: "ap1", message: "approve?" };
        yield { type: "execution_complete", finalMessage: "Done", totalIterations: 1, totalToolCalls: 1 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/execute",
        payload: { actor: "test-user", project_id: "proj-1", objective: "approve test" },
      });

      expect(response.body).toContain('"event_type":"tool_approval_needed"');

      await app.close();
    });

    it("streams memory_extracted event", async () => {
      const { app, executionService } = createHarness();

      async function* fakeExecute() {
        yield { type: "memory_extracted", memoryId: "mem1", summary: "learned something" };
        yield { type: "execution_complete", finalMessage: "Done", totalIterations: 1, totalToolCalls: 0 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/execute",
        payload: { actor: "test-user", project_id: "proj-1", objective: "extract memory" },
      });

      expect(response.body).toContain('"event_type":"memory_extracted"');

      await app.close();
    });

    it("skips persisting assistant_token and assistant_thinking events", async () => {
      const { app, executionService } = createHarness();

      async function* fakeExecute() {
        yield { type: "assistant_token", value: "hello" };
        yield { type: "assistant_thinking", value: "thinking..." };
        yield { type: "execution_complete", finalMessage: "Done", totalIterations: 1, totalToolCalls: 0 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/execute",
        payload: { actor: "test-user", project_id: "proj-1", objective: "streaming test" },
      });

      expect(response.statusCode).toBe(200);
      // assistant_token and assistant_thinking should not be persisted to runEvent
      // execution_complete should be persisted (3 events total, only 1 persisted)
      const persistCalls = vi.mocked(mockPrisma.runEvent.create).mock.calls;
      const persistedTypes = persistCalls.map((c: any) => c[0].data.kind);
      expect(persistedTypes).not.toContain("assistant_token");
      expect(persistedTypes).not.toContain("assistant_thinking");

      await app.close();
    });

    it("moves ticket to review on execution_complete if not already", async () => {
      const { app, executionService, ticketService } = createHarness();

      // Return a ticket in in_progress status
      vi.mocked(ticketService.getTicket).mockResolvedValue({
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
      });

      async function* fakeExecute() {
        yield { type: "execution_complete", finalMessage: "Done", totalIterations: 1, totalToolCalls: 0 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/execute",
        payload: { actor: "test-user", project_id: "proj-1", objective: "complete test" },
      });

      expect(response.statusCode).toBe(200);
      // Should have moved ticket to review
      expect(ticketService.moveTicket).toHaveBeenCalledWith("ticket-1", "review");

      await app.close();
    });

    it("does not move ticket to review on completion if already in review", async () => {
      const { app, executionService, ticketService } = createHarness();

      // getTicket always returns "review" status - even the ensureAgenticTicket path
      // uses the existing ticket with ticket_id specified
      vi.mocked(ticketService.getTicket).mockResolvedValue({
        id: "ticket-1",
        repoId: "proj-1",
        title: "Ticket",
        description: "Task",
        status: "review",
        priority: "p2",
        risk: "medium",
        acceptanceCriteria: [],
        dependencies: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      async function* fakeExecute() {
        yield { type: "execution_complete", finalMessage: "Done", totalIterations: 1, totalToolCalls: 0 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      await app.inject({
        method: "POST",
        url: "/api/agentic/execute",
        payload: { actor: "test-user", project_id: "proj-1", objective: "already reviewed", ticket_id: "ticket-1" },
      });

      // moveTicket should have been called for review -> in_progress (via ensureAgenticTicket since status != in_progress)
      // but NOT for review transition in execution_complete handler
      const reviewMoves = vi.mocked(ticketService.moveTicket).mock.calls.filter(
        (c: any) => c[1] === "review"
      );
      expect(reviewMoves).toHaveLength(0);

      await app.close();
    });

    it("handles non-recoverable error events", async () => {
      const { app, executionService } = createHarness();

      async function* fakeExecute() {
        yield { type: "error", error: "fatal issue", recoverable: false };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/execute",
        payload: { actor: "test-user", project_id: "proj-1", objective: "error test" },
      });

      expect(response.body).toContain('"event_type":"error"');
      // Should have updated projection to "failed"
      expect(mockPrisma.runProjection.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            status: "failed",
          }),
        })
      );

      await app.close();
    });

    it("handles recoverable error events without failing run", async () => {
      const { app, executionService } = createHarness();

      async function* fakeExecute() {
        yield { type: "error", error: "temporary issue", recoverable: true };
        yield { type: "execution_complete", finalMessage: "Recovered", totalIterations: 1, totalToolCalls: 0 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/execute",
        payload: { actor: "test-user", project_id: "proj-1", objective: "recover test" },
      });

      expect(response.body).toContain("event: done");

      await app.close();
    });

    it("passes use_deferred_tools and plan_mode options", async () => {
      const { app, executionService } = createHarness();

      async function* fakeExecute() {
        yield { type: "execution_complete", finalMessage: "ok", totalIterations: 1, totalToolCalls: 0 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/execute",
        payload: {
          actor: "test-user",
          project_id: "proj-1",
          objective: "deferred tools test",
          use_deferred_tools: false,
          plan_mode: true,
          provider_id: "openai-responses",
        },
      });

      expect(response.statusCode).toBe(200);
      const call = vi.mocked(executionService.executeAgentic).mock.calls[0];
      const input = call[1];
      expect(input.useDeferredTools).toBe(false);
      expect(input.planMode).toBe(true);
      expect(input.providerId).toBe("openai-responses");

      await app.close();
    });
  });

  describe("GET /api/agentic/runs/:id/plan", () => {
    it("returns plan data", async () => {
      const { app, planService } = createHarness();

      vi.mocked(planService.getPlan).mockResolvedValue({
        runId: "run-1",
        phase: "planning",
        planContent: "# Plan",
        questions: [],
        approved: false,
        reviewedBy: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/agentic/runs/run-1/plan",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.item.runId).toBe("run-1");
      expect(body.item.planContent).toBe("# Plan");

      await app.close();
    });

    it("returns null item when no plan exists", async () => {
      const { app, planService } = createHarness();

      vi.mocked(planService.getPlan).mockResolvedValue(null);

      const response = await app.inject({
        method: "GET",
        url: "/api/agentic/runs/run-1/plan",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().item).toBeNull();

      await app.close();
    });
  });

  describe("POST /api/agentic/runs/:id/plan/approve", () => {
    it("approves plan and starts execution", async () => {
      const { app, planService, executionService } = createHarness();

      mockPrisma.runProjection.findUnique.mockResolvedValue({
        runId: "run-1",
        ticketId: "ticket-1",
        status: "running",
        metadata: {
          repo_id: "proj-1",
          objective: "build feature",
          worktree_path: "/tmp/project/active",
          model_role: "coder_default",
          provider_id: "qwen-cli",
          use_deferred_tools: true,
          plan_mode: true,
          coordinator: false,
        },
      });

      async function* fakeExecute() {
        yield { type: "execution_complete", finalMessage: "Done", totalIterations: 1, totalToolCalls: 0 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/runs/run-1/plan/approve",
      });

      expect(response.statusCode).toBe(200);
      expect(planService.approvePlan).toHaveBeenCalledWith("run-1", "user");
      expect(executionService.executeAgentic).toHaveBeenCalled();

      await app.close();
    });
  });

  describe("POST /api/agentic/runs/:id/plan/reject", () => {
    it("rejects plan and updates projection to failed", async () => {
      const { app, planService } = createHarness();

      mockPrisma.runProjection.findUnique.mockResolvedValue({
        runId: "run-1",
        ticketId: "ticket-1",
        status: "running",
        metadata: {
          repo_id: "proj-1",
          objective: "build feature",
          worktree_path: "/tmp/project/active",
          model_role: "coder_default",
        },
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/runs/run-1/plan/reject",
        payload: { reason: "Not aligned with requirements" },
      });

      expect(response.statusCode).toBe(200);
      expect(planService.rejectPlan).toHaveBeenCalledWith("run-1", "Not aligned with requirements", "user");

      await app.close();
    });
  });

  describe("POST /api/agentic/runs/:id/plan/refine", () => {
    it("refines plan and re-starts execution", async () => {
      const { app, planService, executionService } = createHarness();

      mockPrisma.runProjection.findUnique.mockResolvedValue({
        runId: "run-1",
        ticketId: "ticket-1",
        status: "running",
        metadata: {
          repo_id: "proj-1",
          objective: "build feature",
          worktree_path: "/tmp/project/active",
          model_role: "coder_default",
        },
      });

      async function* fakeExecute() {
        yield { type: "execution_complete", finalMessage: "Done", totalIterations: 1, totalToolCalls: 0 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/runs/run-1/plan/refine",
        payload: { feedback: "Add more error handling" },
      });

      expect(response.statusCode).toBe(200);
      expect(planService.refinePlan).toHaveBeenCalledWith("run-1", "Add more error handling");

      await app.close();
    });
  });

  describe("POST /api/agentic/runs/:id/plan/answer", () => {
    it("answers plan question and continues execution", async () => {
      const { app, planService, executionService } = createHarness();

      mockPrisma.runProjection.findUnique.mockResolvedValue({
        runId: "run-1",
        ticketId: "ticket-1",
        status: "running",
        metadata: {
          repo_id: "proj-1",
          objective: "build feature",
          worktree_path: "/tmp/project/active",
          model_role: "coder_default",
        },
      });

      async function* fakeExecute() {
        yield { type: "execution_complete", finalMessage: "Done", totalIterations: 1, totalToolCalls: 0 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/runs/run-1/plan/answer",
        payload: { questionId: "q1", answer: "Use React" },
      });

      expect(response.statusCode).toBe(200);
      expect(planService.answerQuestion).toHaveBeenCalledWith("run-1", "q1", "Use React");

      await app.close();
    });
  });

  describe("POST /api/agentic/runs/:id/resume", () => {
    it("returns 404 when run not found", async () => {
      const { app } = createHarness();

      mockPrisma.runProjection.findUnique.mockResolvedValue(null);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/runs/nonexistent/resume",
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe("Run not found");

      await app.close();
    });

    it("returns 400 when run is not in a resumable state", async () => {
      const { app } = createHarness();

      mockPrisma.runProjection.findUnique.mockResolvedValue({
        runId: "run-1",
        ticketId: "ticket-1",
        status: "running",
        metadata: {},
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/runs/run-1/resume",
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain("not resumable");

      await app.close();
    });

    it("returns 400 for completed runs", async () => {
      const { app } = createHarness();

      mockPrisma.runProjection.findUnique.mockResolvedValue({
        runId: "run-1",
        ticketId: "ticket-1",
        status: "completed",
        metadata: {},
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/runs/run-1/resume",
      });

      expect(response.statusCode).toBe(400);

      await app.close();
    });

    it("returns 404 when no checkpoint exists", async () => {
      const { app } = createHarness();

      mockPrisma.runProjection.findUnique.mockResolvedValue({
        runId: "run-1",
        ticketId: "ticket-1",
        status: "aborted",
        metadata: {},
      });
      mockPrisma.appSetting.findUnique.mockResolvedValue(null);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/runs/run-1/resume",
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain("No checkpoint found");

      await app.close();
    });

    it("resumes a failed run with checkpoint", async () => {
      const { app, executionService } = createHarness();

      // First call: resume route checks run status
      mockPrisma.runProjection.findUnique
        .mockResolvedValueOnce({
          runId: "run-1",
          ticketId: "ticket-1",
          status: "failed",
          metadata: {
            repo_id: "proj-1",
            objective: "build feature",
            worktree_path: "/tmp/project/active",
            model_role: "coder_default",
          },
        })
        // Second call: loadPreparedAgenticRun reads run
        .mockResolvedValueOnce({
          runId: "run-1",
          ticketId: "ticket-1",
          status: "failed",
          metadata: {
            repo_id: "proj-1",
            objective: "build feature",
            worktree_path: "/tmp/project/active",
            model_role: "coder_default",
          },
        })
        // Third call: handleAgenticEvent reads metadata
        .mockResolvedValue({ metadata: {} });

      mockPrisma.appSetting.findUnique.mockResolvedValue({
        key: "agentic.checkpoint.run-1",
        value: {
          runId: "run-1",
          messages: [{ role: "user", content: "hello", timestamp: new Date().toISOString() }],
          iterationCount: 3,
          budgetUsed: { tokens: 1000, cost: 0.05 },
          currentRole: "coder_default",
          toolCallsTotal: 5,
          recentlyReadFiles: [],
          timestamp: new Date().toISOString(),
        },
      });

      async function* fakeExecute() {
        yield { type: "execution_complete", finalMessage: "Resumed OK", totalIterations: 4, totalToolCalls: 6 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/runs/run-1/resume",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.runId).toBe("run-1");
      expect(body.resumedFromIteration).toBe(3);

      await app.close();
    });

    it("resumes an aborted run", async () => {
      const { app, executionService } = createHarness();

      mockPrisma.runProjection.findUnique
        .mockResolvedValueOnce({
          runId: "run-2",
          ticketId: "ticket-1",
          status: "aborted",
          metadata: {
            repo_id: "proj-1",
            objective: "aborted task",
            worktree_path: "/tmp/project/active",
            model_role: "coder_default",
          },
        })
        .mockResolvedValueOnce({
          runId: "run-2",
          ticketId: "ticket-1",
          status: "aborted",
          metadata: {
            repo_id: "proj-1",
            objective: "aborted task",
            worktree_path: "/tmp/project/active",
            model_role: "coder_default",
          },
        })
        .mockResolvedValue({ metadata: {} });

      mockPrisma.appSetting.findUnique.mockResolvedValue({
        key: "agentic.checkpoint.run-2",
        value: {
          runId: "run-2",
          messages: [],
          iterationCount: 1,
          budgetUsed: { tokens: 500, cost: 0.01 },
          currentRole: "coder_default",
          toolCallsTotal: 2,
          recentlyReadFiles: [],
          timestamp: new Date().toISOString(),
        },
      });

      async function* fakeExecute() {
        yield { type: "execution_complete", finalMessage: "Resumed", totalIterations: 2, totalToolCalls: 3 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/runs/run-2/resume",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().resumedFromIteration).toBe(1);

      await app.close();
    });

    it("handles error during resumed execution", async () => {
      const { app, executionService } = createHarness();

      mockPrisma.runProjection.findUnique
        .mockResolvedValueOnce({
          runId: "run-3",
          ticketId: "ticket-1",
          status: "failed",
          metadata: {
            repo_id: "proj-1",
            objective: "fail resume",
            worktree_path: "/tmp/project/active",
          },
        })
        .mockResolvedValueOnce({
          runId: "run-3",
          ticketId: "ticket-1",
          status: "failed",
          metadata: {
            repo_id: "proj-1",
            objective: "fail resume",
            worktree_path: "/tmp/project/active",
          },
        })
        .mockResolvedValue({ metadata: {} });

      mockPrisma.appSetting.findUnique.mockResolvedValue({
        key: "agentic.checkpoint.run-3",
        value: {
          runId: "run-3",
          messages: [],
          iterationCount: 2,
          budgetUsed: { tokens: 0, cost: 0 },
          currentRole: "coder_default",
          toolCallsTotal: 0,
          recentlyReadFiles: [],
          timestamp: new Date().toISOString(),
        },
      });

      async function* failExecute() {
        throw new Error("resume crash");
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(failExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/runs/run-3/resume",
      });

      expect(response.statusCode).toBe(200);

      // Wait for background error handler
      await new Promise((r) => setTimeout(r, 50));

      // Should have updated to failed
      const failedCalls = mockPrisma.runProjection.upsert.mock.calls.filter(
        (c: any) => c[0].update.status === "failed"
      );
      expect(failedCalls.length).toBeGreaterThan(0);

      await app.close();
    });
  });

  describe("loadPreparedAgenticRun edge cases", () => {
    it("errors when run is missing ticket binding", async () => {
      const { app } = createHarness();

      mockPrisma.runProjection.findUnique.mockResolvedValue({
        runId: "run-1",
        ticketId: null,
        status: "running",
        metadata: {},
      });

      // Use plan/approve which calls loadPreparedAgenticRun
      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/runs/run-1/plan/approve",
      });

      expect(response.statusCode).toBe(500);

      await app.close();
    });

    it("errors when run metadata is missing repo_id", async () => {
      const { app } = createHarness();

      mockPrisma.runProjection.findUnique.mockResolvedValue({
        runId: "run-1",
        ticketId: "ticket-1",
        status: "running",
        metadata: {
          // Missing repo_id, objective, and worktree_path
        },
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/runs/run-1/plan/approve",
      });

      expect(response.statusCode).toBe(500);

      await app.close();
    });

    it("errors when repo or ticket cannot be resolved", async () => {
      const { app, repoService, ticketService } = createHarness();

      mockPrisma.runProjection.findUnique.mockResolvedValue({
        runId: "run-1",
        ticketId: "ticket-1",
        status: "running",
        metadata: {
          repo_id: "proj-missing",
          objective: "test",
          worktree_path: "/tmp/test",
        },
      });

      vi.mocked(repoService.getRepo).mockResolvedValue(null);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/runs/run-1/plan/approve",
      });

      expect(response.statusCode).toBe(500);

      await app.close();
    });

    it("loads coordinator metadata from saved run", async () => {
      const { app, executionService, repoService } = createHarness();

      mockPrisma.runProjection.findUnique.mockResolvedValue({
        runId: "run-1",
        ticketId: "ticket-1",
        status: "running",
        metadata: {
          repo_id: "proj-1",
          project_id: "proj-1",
          objective: "coordinate tasks",
          worktree_path: "/tmp/project/active",
          model_role: "coder_default",
          provider_id: "openai-compatible",
          use_deferred_tools: true,
          plan_mode: false,
          coordinator: true,
          coordinator_options: {
            maxAgents: 3,
            maxConcurrent: 2,
            allowRespawn: true,
            conflictResolution: "merge",
          },
          budget: {
            maxTokens: 10000,
            maxCostUsd: 5.0,
            maxDurationMs: 120000,
          },
        },
      });

      async function* fakeExecute() {
        yield { type: "execution_complete", finalMessage: "Done", totalIterations: 1, totalToolCalls: 0 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/runs/run-1/plan/approve",
      });

      expect(response.statusCode).toBe(200);

      // Verify the execution input has coordinator options
      const callArgs = vi.mocked(executionService.executeAgentic).mock.calls[0];
      const input = callArgs[1];
      expect(input.coordinator).toBe(true);
      expect(input.coordinatorOptions?.maxAgents).toBe(3);
      expect(input.coordinatorOptions?.conflictResolution).toBe("merge");
      expect(input.budget?.maxTokens).toBe(10000);
      expect(input.providerId).toBe("openai-compatible");

      await app.close();
    });

    it("handles metadata with project_id instead of repo_id", async () => {
      const { app, executionService } = createHarness();

      mockPrisma.runProjection.findUnique.mockResolvedValue({
        runId: "run-1",
        ticketId: "ticket-1",
        status: "running",
        metadata: {
          // No repo_id, but has project_id
          project_id: "proj-1",
          objective: "test fallback",
          worktree_path: "/tmp/project/active",
          model_role: "utility_fast",
          provider_id: "onprem-qwen",
        },
      });

      async function* fakeExecute() {
        yield { type: "execution_complete", finalMessage: "Done", totalIterations: 1, totalToolCalls: 0 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/runs/run-1/plan/approve",
      });

      expect(response.statusCode).toBe(200);

      const callArgs = vi.mocked(executionService.executeAgentic).mock.calls[0];
      const input = callArgs[1];
      expect(input.initialModelRole).toBe("utility_fast");
      expect(input.providerId).toBe("onprem-qwen");

      await app.close();
    });

    it("handles invalid model_role and provider_id gracefully", async () => {
      const { app, executionService } = createHarness();

      mockPrisma.runProjection.findUnique.mockResolvedValue({
        runId: "run-1",
        ticketId: "ticket-1",
        status: "running",
        metadata: {
          repo_id: "proj-1",
          objective: "test invalid roles",
          worktree_path: "/tmp/project/active",
          model_role: "invalid_role",
          provider_id: "invalid_provider",
          use_deferred_tools: false,
          plan_mode: true,
          coordinator: false,
        },
      });

      async function* fakeExecute() {
        yield { type: "execution_complete", finalMessage: "Done", totalIterations: 1, totalToolCalls: 0 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/runs/run-1/plan/approve",
      });

      expect(response.statusCode).toBe(200);

      const callArgs = vi.mocked(executionService.executeAgentic).mock.calls[0];
      const input = callArgs[1];
      // Invalid roles should be undefined
      expect(input.initialModelRole).toBeUndefined();
      expect(input.providerId).toBeUndefined();

      await app.close();
    });
  });

  describe("GET /api/agentic/runs/:id/stream", () => {
    it("registers the stream route", async () => {
      const { app } = createHarness();

      // The stream endpoint uses reply.hijack() which prevents inject() from resolving.
      // Verify the route exists by checking the route table.
      const routes = app.printRoutes();
      expect(routes).toContain("stream (GET");

      await app.close();
    });
  });

  describe("POST /api/agentic/execute - execution_complete when ticket is already done", () => {
    it("does not move ticket to review when already done", async () => {
      const { app, executionService, ticketService } = createHarness();

      vi.mocked(ticketService.getTicket).mockResolvedValue({
        id: "ticket-1",
        repoId: "proj-1",
        title: "Ticket",
        description: "Task",
        status: "done",
        priority: "p2",
        risk: "medium",
        acceptanceCriteria: [],
        dependencies: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      async function* fakeExecute() {
        yield { type: "execution_complete", finalMessage: "Done", totalIterations: 1, totalToolCalls: 0 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      await app.inject({
        method: "POST",
        url: "/api/agentic/execute",
        payload: { actor: "test-user", project_id: "proj-1", objective: "already done test", ticket_id: "ticket-1" },
      });

      const reviewMoves = vi.mocked(ticketService.moveTicket).mock.calls.filter(
        (c: any) => c[1] === "review"
      );
      expect(reviewMoves).toHaveLength(0);

      await app.close();
    });
  });

  describe("POST /api/agentic/start - ensureAgenticTicket creates ticket when getTicket returns null and no ticket_id", () => {
    it("creates ticket with truncated title from long objective", async () => {
      const { app, executionService, ticketService } = createHarness();

      vi.mocked(ticketService.getTicket).mockResolvedValue(null);

      async function* fakeExecute() {
        yield { type: "execution_complete", finalMessage: "Done", totalIterations: 1, totalToolCalls: 0 };
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(fakeExecute() as any);

      const longObjective = "A".repeat(200) + "\nSecond line";
      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/start",
        payload: { actor: "test-user", project_id: "proj-1", objective: longObjective },
      });

      expect(response.statusCode).toBe(200);
      expect(ticketService.createTicket).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.any(String),
          repoId: "proj-1",
        }),
      );
      // Title should be truncated to 96 chars
      const createCall = vi.mocked(ticketService.createTicket).mock.calls[0][0];
      expect(createCall.title.length).toBeLessThanOrEqual(96);

      await app.close();
    });
  });

  describe("POST /api/agentic/execute - non-Error thrown during streaming", () => {
    it("handles non-Error thrown during execute streaming", async () => {
      const { app, executionService } = createHarness();

      async function* failExecute() {
        throw "string error in stream";
      }
      vi.mocked(executionService.executeAgentic).mockReturnValue(failExecute() as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/agentic/execute",
        payload: { actor: "test-user", project_id: "proj-1", objective: "string throw stream" },
      });

      expect(response.body).toContain("event: error");
      expect(response.body).toContain("string error in stream");

      await app.close();
    });
  });
});

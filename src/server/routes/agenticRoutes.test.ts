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
  },
}));

vi.mock("./shared/ticketProjection", () => ({
  syncTaskProjectionFromTicket: vi.fn().mockResolvedValue(undefined),
}));

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

  registerAgenticRoutes({
    app,
    toolRegistry,
    executionService: executionService as any,
    repoService: repoService as any,
    ticketService: ticketService as any,
  });

  return { app, executionService, repoService, ticketService };
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
  });
});

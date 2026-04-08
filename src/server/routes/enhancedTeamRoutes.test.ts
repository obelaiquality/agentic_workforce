import Fastify from "fastify";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderOrchestrator } from "../services/providerOrchestrator";

// ---------------------------------------------------------------------------
// Mock Prisma (vi.hoisted so vi.mock factory can reference it)
// ---------------------------------------------------------------------------

const mockPrisma = vi.hoisted(() => ({
  teamSession: {
    create: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
  },
  teamWorker: {
    create: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  teamTask: {
    create: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  teamMessage: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock("../db", () => ({
  prisma: mockPrisma,
}));

// Mock the EnhancedTeamOrchestrator to avoid real DB calls during route tests
vi.mock("../execution/enhancedTeamMode", async (importOriginal) => {
  const original = await importOriginal<typeof import("../execution/enhancedTeamMode")>();
  return {
    ...original,
    EnhancedTeamOrchestrator: class {
      constructor(_deps: unknown) {}
      async *execute(_input: unknown) {
        yield {
          type: "team_session_started" as const,
          sessionId: "test-session-id",
          workerCount: 2,
          phase: "team_plan",
        };
        yield {
          type: "team_phase_changed" as const,
          from: "team_plan",
          to: "team_exec",
        };
        yield {
          type: "execution_complete" as const,
          finalMessage: "Done",
          totalIterations: 0,
          totalToolCalls: 0,
        };
      }
    },
  };
});

import {
  registerEnhancedTeamRoutes,
  clearActiveGenerators,
} from "./enhancedTeamRoutes";

// ---------------------------------------------------------------------------
// Mock Provider Orchestrator
// ---------------------------------------------------------------------------

function createMockProviderOrchestrator(): ProviderOrchestrator {
  return {
    async streamChatWithRetry() {
      return { usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
    },
  } as unknown as ProviderOrchestrator;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function createHarness() {
  const app = Fastify();
  const providerOrchestrator = createMockProviderOrchestrator();
  registerEnhancedTeamRoutes({ app, providerOrchestrator });
  return { app };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("enhancedTeamRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearActiveGenerators();
  });

  // -----------------------------------------------------------------------
  // POST /api/enhanced-team/start
  // -----------------------------------------------------------------------

  describe("POST /api/enhanced-team/start", () => {
    it("validates required fields — rejects empty body", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/enhanced-team/start",
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBe("Invalid request body");
      expect(body.details).toBeDefined();

      await app.close();
    });

    it("rejects missing actor", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/enhanced-team/start",
        payload: {
          repoId: "repo-1",
          objective: "Build feature X",
          worktreePath: "/tmp/test",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.details.some((d: { path: string[] }) => d.path.includes("actor"))).toBe(
        true,
      );

      await app.close();
    });

    it("rejects missing repoId", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/enhanced-team/start",
        payload: {
          actor: "user-1",
          objective: "Build feature X",
          worktreePath: "/tmp/test",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.details.some((d: { path: string[] }) => d.path.includes("repoId"))).toBe(
        true,
      );

      await app.close();
    });

    it("rejects missing objective", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/enhanced-team/start",
        payload: {
          actor: "user-1",
          repoId: "repo-1",
          worktreePath: "/tmp/test",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.details.some((d: { path: string[] }) => d.path.includes("objective"))).toBe(
        true,
      );

      await app.close();
    });

    it("accepts valid input and returns sessionId", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/enhanced-team/start",
        payload: {
          actor: "user-1",
          repoId: "repo-1",
          objective: "Build feature X",
          worktreePath: "/tmp/test",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.sessionId).toBe("test-session-id");
      expect(body.status).toBe("active");

      await app.close();
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/enhanced-team/:id/message
  // -----------------------------------------------------------------------

  describe("POST /api/enhanced-team/:id/message", () => {
    it("returns 404 for unknown session", async () => {
      const { app } = createHarness();
      mockPrisma.teamSession.findUnique.mockResolvedValueOnce(null);

      const response = await app.inject({
        method: "POST",
        url: "/api/enhanced-team/nonexistent/message",
        payload: {
          fromWorkerId: "worker-1",
          content: "Hello",
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe("Session not found");

      await app.close();
    });

    it("validates required fields — rejects empty body", async () => {
      const { app } = createHarness();
      mockPrisma.teamSession.findUnique.mockResolvedValueOnce({ id: "session-1" });

      const response = await app.inject({
        method: "POST",
        url: "/api/enhanced-team/session-1/message",
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBe("Invalid request body");

      await app.close();
    });

    it("validates content is required", async () => {
      const { app } = createHarness();
      mockPrisma.teamSession.findUnique.mockResolvedValueOnce({ id: "session-1" });

      const response = await app.inject({
        method: "POST",
        url: "/api/enhanced-team/session-1/message",
        payload: {
          fromWorkerId: "worker-1",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.details.some((d: { path: string[] }) => d.path.includes("content"))).toBe(
        true,
      );

      await app.close();
    });

    it("creates a message and returns messageId", async () => {
      const { app } = createHarness();
      mockPrisma.teamSession.findUnique.mockResolvedValueOnce({ id: "session-1" });
      mockPrisma.teamMessage.create.mockResolvedValueOnce({ id: "msg-123" });

      const response = await app.inject({
        method: "POST",
        url: "/api/enhanced-team/session-1/message",
        payload: {
          fromWorkerId: "worker-1",
          toWorkerId: "worker-2",
          content: "Please review this",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.messageId).toBe("msg-123");

      await app.close();
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/enhanced-team/:id/phase
  // -----------------------------------------------------------------------

  describe("POST /api/enhanced-team/:id/phase", () => {
    it("returns 404 for unknown session", async () => {
      const { app } = createHarness();
      mockPrisma.teamSession.findUnique.mockResolvedValueOnce(null);

      const response = await app.inject({
        method: "POST",
        url: "/api/enhanced-team/nonexistent/phase",
        payload: { phase: "team_exec" },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe("Session not found");

      await app.close();
    });

    it("rejects invalid phase value", async () => {
      const { app } = createHarness();
      mockPrisma.teamSession.findUnique.mockResolvedValueOnce({
        id: "session-1",
        currentPhase: "team_plan",
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/enhanced-team/session-1/phase",
        payload: { phase: "invalid_phase" },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBe("Invalid request body");

      await app.close();
    });

    it("rejects invalid phase transition", async () => {
      const { app } = createHarness();
      mockPrisma.teamSession.findUnique.mockResolvedValueOnce({
        id: "session-1",
        currentPhase: "team_plan",
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/enhanced-team/session-1/phase",
        payload: { phase: "team_complete" },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toContain("Invalid phase transition");

      await app.close();
    });

    it("accepts valid phase transition", async () => {
      const { app } = createHarness();
      mockPrisma.teamSession.findUnique.mockResolvedValueOnce({
        id: "session-1",
        currentPhase: "team_plan",
      });
      mockPrisma.teamSession.update.mockResolvedValueOnce({});

      const response = await app.inject({
        method: "POST",
        url: "/api/enhanced-team/session-1/phase",
        payload: { phase: "team_exec" },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.previousPhase).toBe("team_plan");
      expect(body.currentPhase).toBe("team_exec");

      await app.close();
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/enhanced-team/:id/workers
  // -----------------------------------------------------------------------

  describe("GET /api/enhanced-team/:id/workers", () => {
    it("returns 404 for unknown session", async () => {
      const { app } = createHarness();
      mockPrisma.teamSession.findUnique.mockResolvedValueOnce(null);

      const response = await app.inject({
        method: "GET",
        url: "/api/enhanced-team/nonexistent/workers",
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe("Session not found");

      await app.close();
    });

    it("returns worker list for existing session", async () => {
      const { app } = createHarness();
      mockPrisma.teamSession.findUnique.mockResolvedValueOnce({ id: "session-1" });
      mockPrisma.teamWorker.findMany.mockResolvedValueOnce([
        {
          id: "w1",
          workerId: "worker-1",
          role: "implementer",
          status: "idle",
          currentTaskId: null,
          lastHeartbeatAt: new Date("2026-01-01T00:00:00Z"),
          createdAt: new Date(),
        },
        {
          id: "w2",
          workerId: "worker-2",
          role: "tester",
          status: "executing",
          currentTaskId: "task-1",
          lastHeartbeatAt: new Date("2026-01-01T00:00:00Z"),
          createdAt: new Date(),
        },
      ]);

      const response = await app.inject({
        method: "GET",
        url: "/api/enhanced-team/session-1/workers",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.sessionId).toBe("session-1");
      expect(body.workers).toHaveLength(2);
      expect(body.workers[0].workerId).toBe("worker-1");
      expect(body.workers[0].role).toBe("implementer");
      expect(body.workers[0].status).toBe("idle");
      expect(body.workers[1].workerId).toBe("worker-2");
      expect(body.workers[1].status).toBe("executing");
      expect(body.workers[1].currentTaskId).toBe("task-1");

      await app.close();
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/enhanced-team/:id
  // -----------------------------------------------------------------------

  describe("GET /api/enhanced-team/:id", () => {
    it("returns 404 for unknown session", async () => {
      const { app } = createHarness();
      mockPrisma.teamSession.findUnique.mockResolvedValueOnce(null);

      const response = await app.inject({
        method: "GET",
        url: "/api/enhanced-team/nonexistent",
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe("Session not found");

      await app.close();
    });

    it("returns 200 with session data and worker count", async () => {
      const { app } = createHarness();
      mockPrisma.teamSession.findUnique.mockResolvedValueOnce({
        id: "session-1",
        objective: "Build feature X",
        currentPhase: "team_exec",
        status: "active",
        maxWorkers: 5,
        maxConcurrent: 3,
        createdAt: new Date("2026-04-07T12:00:00Z"),
      });
      mockPrisma.teamWorker.count.mockResolvedValueOnce(3);

      const response = await app.inject({
        method: "GET",
        url: "/api/enhanced-team/session-1",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.session).toBeDefined();
      expect(body.session.id).toBe("session-1");
      expect(body.session.objective).toBe("Build feature X");
      expect(body.session.phase).toBe("team_exec");
      expect(body.session.status).toBe("active");
      expect(body.session.maxWorkers).toBe(5);
      expect(body.session.maxConcurrent).toBe(3);
      expect(body.session.workerCount).toBe(3);
      expect(body.session.createdAt).toBe("2026-04-07T12:00:00.000Z");

      // Verify the correct Prisma calls were made
      expect(mockPrisma.teamSession.findUnique).toHaveBeenCalledWith({
        where: { id: "session-1" },
      });
      expect(mockPrisma.teamWorker.count).toHaveBeenCalledWith({
        where: { sessionId: "session-1" },
      });

      await app.close();
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/enhanced-team/:id/messages (all messages)
  // -----------------------------------------------------------------------

  describe("GET /api/enhanced-team/:id/messages", () => {
    it("returns 404 for unknown session", async () => {
      const { app } = createHarness();
      mockPrisma.teamSession.findUnique.mockResolvedValueOnce(null);

      const response = await app.inject({
        method: "GET",
        url: "/api/enhanced-team/nonexistent/messages",
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe("Session not found");

      await app.close();
    });

    it("returns all messages for valid session", async () => {
      const { app } = createHarness();
      mockPrisma.teamSession.findUnique.mockResolvedValueOnce({ id: "session-1" });
      mockPrisma.teamMessage.findMany.mockResolvedValueOnce([
        {
          id: "msg-1",
          fromWorkerId: "worker-1",
          toWorkerId: "worker-2",
          content: "Hello from worker 1",
          read: false,
          createdAt: new Date("2026-04-07T10:00:00Z"),
        },
        {
          id: "msg-2",
          fromWorkerId: "worker-2",
          toWorkerId: null,
          content: "Broadcast message",
          read: true,
          createdAt: new Date("2026-04-07T10:01:00Z"),
        },
      ]);

      const response = await app.inject({
        method: "GET",
        url: "/api/enhanced-team/session-1/messages",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.sessionId).toBe("session-1");
      expect(body.messages).toHaveLength(2);

      expect(body.messages[0].id).toBe("msg-1");
      expect(body.messages[0].fromWorkerId).toBe("worker-1");
      expect(body.messages[0].toWorkerId).toBe("worker-2");
      expect(body.messages[0].content).toBe("Hello from worker 1");
      expect(body.messages[0].read).toBe(false);
      expect(body.messages[0].createdAt).toBe("2026-04-07T10:00:00.000Z");

      expect(body.messages[1].id).toBe("msg-2");
      expect(body.messages[1].fromWorkerId).toBe("worker-2");
      expect(body.messages[1].toWorkerId).toBeNull();
      expect(body.messages[1].content).toBe("Broadcast message");
      expect(body.messages[1].read).toBe(true);
      expect(body.messages[1].createdAt).toBe("2026-04-07T10:01:00.000Z");

      await app.close();
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/enhanced-team/:id/messages/:workerId (per-worker)
  // -----------------------------------------------------------------------

  describe("GET /api/enhanced-team/:id/messages/:workerId", () => {
    it("returns 404 for unknown session", async () => {
      const { app } = createHarness();
      mockPrisma.teamSession.findUnique.mockResolvedValueOnce(null);

      const response = await app.inject({
        method: "GET",
        url: "/api/enhanced-team/nonexistent/messages/worker-1",
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe("Session not found");

      await app.close();
    });

    it("returns filtered messages for valid session and workerId", async () => {
      const { app } = createHarness();
      mockPrisma.teamSession.findUnique.mockResolvedValueOnce({ id: "session-1" });
      mockPrisma.teamMessage.findMany.mockResolvedValueOnce([
        {
          id: "msg-1",
          fromWorkerId: "worker-2",
          toWorkerId: "worker-1",
          content: "Direct message to worker-1",
          read: false,
          createdAt: new Date("2026-04-07T10:00:00Z"),
        },
        {
          id: "msg-3",
          fromWorkerId: "worker-3",
          toWorkerId: null,
          content: "Broadcast",
          read: true,
          createdAt: new Date("2026-04-07T10:05:00Z"),
        },
      ]);

      const response = await app.inject({
        method: "GET",
        url: "/api/enhanced-team/session-1/messages/worker-1",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.sessionId).toBe("session-1");
      expect(body.workerId).toBe("worker-1");
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].id).toBe("msg-1");
      expect(body.messages[0].content).toBe("Direct message to worker-1");
      expect(body.messages[1].id).toBe("msg-3");
      expect(body.messages[1].toWorkerId).toBeNull();

      // Verify the Prisma query used the correct filter
      expect(mockPrisma.teamMessage.findMany).toHaveBeenCalledWith({
        where: {
          sessionId: "session-1",
          OR: [{ toWorkerId: "worker-1" }, { toWorkerId: null }],
        },
        orderBy: { createdAt: "asc" },
      });

      await app.close();
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/enhanced-team/:id/tasks
  // -----------------------------------------------------------------------

  describe("GET /api/enhanced-team/:id/tasks", () => {
    it("returns 404 for unknown session", async () => {
      const { app } = createHarness();
      mockPrisma.teamSession.findUnique.mockResolvedValueOnce(null);

      const response = await app.inject({
        method: "GET",
        url: "/api/enhanced-team/nonexistent/tasks",
      });

      expect(response.statusCode).toBe(404);

      await app.close();
    });

    it("returns task list for existing session", async () => {
      const { app } = createHarness();
      mockPrisma.teamSession.findUnique.mockResolvedValueOnce({ id: "session-1" });
      mockPrisma.teamTask.findMany.mockResolvedValueOnce([
        {
          id: "t1",
          taskName: "Task 1",
          description: "Build component",
          status: "completed",
          assignedTo: "worker-1",
          priority: 1,
          result: "Done",
          claimedAt: new Date("2026-01-01T00:00:00Z"),
          leaseExpires: null,
        },
      ]);

      const response = await app.inject({
        method: "GET",
        url: "/api/enhanced-team/session-1/tasks",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.sessionId).toBe("session-1");
      expect(body.tasks).toHaveLength(1);
      expect(body.tasks[0].name).toBe("Task 1");
      expect(body.tasks[0].status).toBe("completed");

      await app.close();
    });
  });
});

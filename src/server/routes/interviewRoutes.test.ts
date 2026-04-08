import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerInterviewRoutes, clearActiveOrchestrators } from "./interviewRoutes";

// ---------------------------------------------------------------------------
// Mock prisma
// ---------------------------------------------------------------------------

vi.mock("../db", () => ({
  prisma: {
    interviewSession: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: "session-1",
        runId: "run-1",
        objective: "Build X",
        isGreenfield: true,
        currentRound: 1,
        maxRounds: 10,
        ambiguityThreshold: 0.15,
        handoffMode: null,
        questions: [],
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    interviewQuestion: {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    interviewAmbiguityScore: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

// ---------------------------------------------------------------------------
// Mock InterviewModeOrchestrator
// ---------------------------------------------------------------------------

vi.mock("../execution/interviewMode", () => ({
  InterviewModeOrchestrator: vi.fn().mockImplementation(() => ({
    execute: vi.fn(async function* () {
      yield { type: "interview_started", sessionId: "session-1", maxRounds: 10 };
    }),
    submitAnswer: vi.fn(async function* () {
      yield { type: "interview_answered", questionId: "q-1", answer: "test" };
    }),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createHarness() {
  const app = Fastify();
  const providerOrchestrator = {} as any;
  registerInterviewRoutes({ app, providerOrchestrator });
  return { app };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("interviewRoutes", () => {
  afterEach(() => {
    clearActiveOrchestrators();
  });

  // -------------------------------------------------------------------------
  // POST /api/interview/start
  // -------------------------------------------------------------------------

  describe("POST /api/interview/start", () => {
    it("validates required fields — rejects empty body", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/interview/start",
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBe("Invalid request body");
      expect(body.details).toBeDefined();

      await app.close();
    });

    it("validates required fields — rejects missing objective", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/interview/start",
        payload: {
          actor: "user-1",
          repo_id: "repo-1",
          worktree_path: "/tmp/work",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.details.some((d: { path: string[] }) => d.path.includes("objective"))).toBe(true);

      await app.close();
    });

    it("validates required fields — rejects missing actor", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/interview/start",
        payload: {
          repo_id: "repo-1",
          objective: "Build feature",
          worktree_path: "/tmp/work",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.details.some((d: { path: string[] }) => d.path.includes("actor"))).toBe(true);

      await app.close();
    });

    it("accepts valid input and returns events", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/interview/start",
        payload: {
          actor: "user-1",
          repo_id: "repo-1",
          objective: "Build a login page",
          worktree_path: "/tmp/work",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.run_id).toBeDefined();
      expect(body.session_id).toBeDefined();
      expect(body.events).toBeInstanceOf(Array);
      expect(body.events.length).toBeGreaterThan(0);
      expect(body.events[0].type).toBe("interview_started");

      await app.close();
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/interview/:id/answer
  // -------------------------------------------------------------------------

  describe("POST /api/interview/:id/answer", () => {
    it("validates answer body — rejects empty body", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/interview/session-1/answer",
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBe("Invalid request body");

      await app.close();
    });

    it("validates answer body — rejects missing question_id", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/interview/session-1/answer",
        payload: {
          answer: "My answer",
        },
      });

      expect(response.statusCode).toBe(400);

      await app.close();
    });

    it("validates answer body — rejects missing answer", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/interview/session-1/answer",
        payload: {
          question_id: "q-1",
        },
      });

      expect(response.statusCode).toBe(400);

      await app.close();
    });

    it("returns 404 for non-existent session", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/interview/nonexistent/answer",
        payload: {
          question_id: "q-1",
          answer: "My answer",
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error).toBe("Session not found");

      await app.close();
    });

    it("returns 400 when session is already completed", async () => {
      const { prisma } = await import("../db");
      (prisma.interviewSession.findUnique as any).mockResolvedValueOnce({
        id: "session-1",
        runId: "run-1",
        status: "completed",
        objective: "Build X",
        isGreenfield: true,
        currentRound: 5,
        maxRounds: 10,
        ambiguityThreshold: 0.15,
        handoffMode: null,
        finalSpec: "some spec",
        questions: [],
      });

      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/interview/session-1/answer",
        payload: {
          question_id: "q-1",
          answer: "test",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBe("Session is already completed");

      await app.close();
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/interview/:id/handoff
  // -------------------------------------------------------------------------

  describe("POST /api/interview/:id/handoff", () => {
    it("hands off session to target mode and returns spec", async () => {
      const { prisma } = await import("../db");
      (prisma.interviewSession.findUnique as any).mockResolvedValueOnce({
        id: "session-1",
        runId: "run-1",
        status: "completed",
        objective: "Build X",
        isGreenfield: true,
        currentRound: 5,
        maxRounds: 10,
        ambiguityThreshold: 0.15,
        handoffMode: null,
        finalSpec: "Crystallized specification content",
        questions: [],
      });
      (prisma.interviewSession.update as any).mockResolvedValueOnce({});

      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/interview/session-1/handoff",
        payload: {
          target_mode: "ralph",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.session_id).toBe("session-1");
      expect(body.target_mode).toBe("ralph");
      expect(body.spec).toBe("Crystallized specification content");

      await app.close();
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/interview/:id/status
  // -------------------------------------------------------------------------

  describe("GET /api/interview/:id/status", () => {
    it("returns 404 for non-existent session", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "GET",
        url: "/api/interview/nonexistent/status",
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error).toBe("Session not found");

      await app.close();
    });

    it("returns session data for existing session", async () => {
      const { prisma } = await import("../db");
      (prisma.interviewSession.findUnique as any).mockResolvedValueOnce({
        id: "session-1",
        runId: "run-1",
        status: "active",
        currentRound: 2,
        maxRounds: 10,
        ambiguityThreshold: 0.15,
        isGreenfield: true,
        objective: "Build feature X",
        finalSpec: null,
        handoffMode: null,
        questions: [
          {
            id: "q-1",
            round: 1,
            question: "What is the goal?",
            answer: "Build login",
            challengeMode: null,
            targetDimension: "intent",
            answeredAt: new Date(),
          },
        ],
        ambiguityScores: [
          {
            round: 0,
            overallAmbiguity: 0.75,
            intentScore: 0.5,
            outcomeScore: 0.3,
            scopeScore: 0.4,
            constraintsScore: 0.2,
            successScore: 0.1,
            contextScore: null,
          },
        ],
      });

      const { app } = createHarness();

      const response = await app.inject({
        method: "GET",
        url: "/api/interview/session-1/status",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.session_id).toBe("session-1");
      expect(body.status).toBe("active");
      expect(body.current_round).toBe(2);
      expect(body.questions).toHaveLength(1);
      expect(body.ambiguity_scores).toHaveLength(1);
      expect(body.ambiguity_scores[0].dimensions.intent).toBe(0.5);

      await app.close();
    });
  });
});

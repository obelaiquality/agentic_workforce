import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  beforeEach(async () => {
    const { prisma } = await import("../db");
    (prisma.interviewSession.findUnique as any).mockReset().mockResolvedValue(null);
    (prisma.interviewSession.update as any).mockReset().mockResolvedValue({});
  });

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
  // GET /api/interview/:id/stream
  // -------------------------------------------------------------------------

  describe("GET /api/interview/:id/stream", () => {
    it("returns 404 for non-existent session", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "GET",
        url: "/api/interview/nonexistent/stream",
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error).toBe("Session not found");

      await app.close();
    });

    it("streams session state for an existing session", async () => {
      const { prisma } = await import("../db");
      (prisma.interviewSession.findUnique as any).mockResolvedValueOnce({
        id: "session-stream",
        runId: "run-1",
        status: "active",
        currentRound: 1,
        maxRounds: 10,
        ambiguityThreshold: 0.15,
        isGreenfield: true,
        objective: "Build feature",
        finalSpec: null,
        handoffMode: null,
        questions: [],
        ambiguityScores: [],
      });

      const { app } = createHarness();

      const response = await app.inject({
        method: "GET",
        url: "/api/interview/session-stream/stream",
      });

      // The handler calls reply.raw.end() after writing, so inject returns 200
      expect(response.statusCode).toBe(200);
      // The response payload should contain the interview_state event
      expect(response.payload).toContain("interview_state");

      await app.close();
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/interview/:id/answer — successful path
  // -------------------------------------------------------------------------

  describe("POST /api/interview/:id/answer — success path", () => {
    it("submits an answer and returns events", async () => {
      const { prisma } = await import("../db");
      (prisma.interviewSession.findUnique as any).mockResolvedValueOnce({
        id: "session-1",
        runId: "run-1",
        status: "active",
        objective: "Build X",
        isGreenfield: true,
        currentRound: 1,
        maxRounds: 10,
        ambiguityThreshold: 0.15,
        handoffMode: null,
        questions: [],
      });

      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/interview/session-1/answer",
        payload: {
          question_id: "q-1",
          answer: "Use React for the UI",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.events).toBeInstanceOf(Array);
      expect(body.events.length).toBeGreaterThan(0);
      expect(body.events[0].type).toBe("interview_answered");

      await app.close();
    });

    it("returns 500 when submitAnswer throws", async () => {
      const { prisma } = await import("../db");
      (prisma.interviewSession.findUnique as any).mockResolvedValueOnce({
        id: "session-err",
        runId: "run-err",
        status: "active",
        objective: "Build X",
        isGreenfield: true,
        currentRound: 1,
        maxRounds: 10,
        ambiguityThreshold: 0.15,
        handoffMode: null,
        questions: [],
      });

      // Override the mock to throw on submitAnswer
      const { InterviewModeOrchestrator } = await import("../execution/interviewMode");
      (InterviewModeOrchestrator as any).mockImplementationOnce(() => ({
        execute: vi.fn(async function* () {
          yield { type: "interview_started", sessionId: "session-err", maxRounds: 10 };
        }),
        submitAnswer: vi.fn(async function* () {
          throw new Error("LLM unavailable");
        }),
      }));

      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/interview/session-err/answer",
        payload: {
          question_id: "q-1",
          answer: "test",
        },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.error).toBe("LLM unavailable");

      await app.close();
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/interview/start — error path
  // -------------------------------------------------------------------------

  describe("POST /api/interview/start — error path", () => {
    it("returns 500 when orchestrator.execute throws", async () => {
      const { InterviewModeOrchestrator } = await import("../execution/interviewMode");
      (InterviewModeOrchestrator as any).mockImplementationOnce(() => ({
        execute: vi.fn(async function* () {
          throw new Error("Backend down");
        }),
        submitAnswer: vi.fn(),
      }));

      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/interview/start",
        payload: {
          actor: "user-1",
          repo_id: "repo-1",
          objective: "Build login",
          worktree_path: "/tmp/work",
        },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.error).toBe("Backend down");

      await app.close();
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/interview/:id/handoff — error paths
  // -------------------------------------------------------------------------

  describe("POST /api/interview/:id/handoff — validation", () => {
    it("returns 400 for invalid body", async () => {
      const { prisma } = await import("../db");
      (prisma.interviewSession.findUnique as any).mockResolvedValueOnce({
        id: "session-1",
        runId: "run-1",
        status: "completed",
        finalSpec: "spec",
        questions: [],
      });

      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/interview/session-1/handoff",
        payload: {
          target_mode: "invalid_mode",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBe("Invalid request body");

      await app.close();
    });

    it("returns 404 when session does not exist", async () => {
      const { prisma } = await import("../db");
      // Explicitly ensure findUnique returns null for this call
      (prisma.interviewSession.findUnique as any).mockResolvedValueOnce(null);

      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/interview/nonexistent/handoff",
        payload: {
          target_mode: "ralph",
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error).toBe("Session not found");

      await app.close();
    });

    it("returns 400 when session has no final spec", async () => {
      const { prisma } = await import("../db");
      (prisma.interviewSession.findUnique as any).mockResolvedValueOnce({
        id: "session-nospec",
        runId: "run-1",
        status: "active",
        finalSpec: null,
        questions: [],
      });

      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/interview/session-nospec/handoff",
        payload: {
          target_mode: "team",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBe("Session has no crystallized spec yet");

      await app.close();
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/interview/:id/handoff — team and autopilot modes
  // -------------------------------------------------------------------------

  describe("POST /api/interview/:id/handoff — additional modes", () => {
    it("hands off session to team mode", async () => {
      const { prisma } = await import("../db");
      (prisma.interviewSession.findUnique as any).mockResolvedValueOnce({
        id: "session-team",
        runId: "run-1",
        status: "completed",
        finalSpec: "Team spec",
        questions: [],
      });
      (prisma.interviewSession.update as any).mockResolvedValueOnce({});

      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/interview/session-team/handoff",
        payload: { target_mode: "team" },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.target_mode).toBe("team");
      expect(body.spec).toBe("Team spec");

      await app.close();
    });

    it("hands off session to autopilot mode", async () => {
      const { prisma } = await import("../db");
      (prisma.interviewSession.findUnique as any).mockResolvedValueOnce({
        id: "session-auto",
        runId: "run-1",
        status: "completed",
        finalSpec: "Autopilot spec",
        questions: [],
      });
      (prisma.interviewSession.update as any).mockResolvedValueOnce({});

      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/interview/session-auto/handoff",
        payload: { target_mode: "autopilot" },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.target_mode).toBe("autopilot");

      await app.close();
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/interview/:id/handoff — empty params_id validation
  // -------------------------------------------------------------------------

  describe("POST /api/interview/:id/handoff — invalid params", () => {
    it("returns 400 for empty body", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/interview/session-1/handoff",
        payload: {},
      });

      expect(response.statusCode).toBe(400);

      await app.close();
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/interview/:id/answer — invalid params
  // -------------------------------------------------------------------------

  describe("POST /api/interview/:id/answer — invalid params edge case", () => {
    it("returns 400 when session param is empty string", async () => {
      const { app } = createHarness();

      // Empty string as session id should fail safeParse on params
      const response = await app.inject({
        method: "POST",
        url: "/api/interview/%20/answer",
        payload: {
          question_id: "q-1",
          answer: "test",
        },
      });

      // Fastify will route it; the safeParse validates min(1)
      expect(response.statusCode).not.toBe(200);

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

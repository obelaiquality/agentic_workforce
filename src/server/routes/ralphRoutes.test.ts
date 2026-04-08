import Fastify from "fastify";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { registerRalphRoutes } from "./ralphRoutes";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../db", () => ({
  prisma: {
    ralphSession: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: "session-mock",
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      update: vi.fn().mockResolvedValue({}),
    },
    ralphPhaseExecution: {
      create: vi.fn().mockResolvedValue({}),
    },
    ralphVerification: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("../logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function createHarness() {
  const app = Fastify();

  const providerOrchestrator = {
    streamChatWithRetry: vi.fn().mockResolvedValue({
      text: '["src/file.ts"]',
      accountId: "test",
      providerId: "onprem-qwen",
    }),
  };

  const executionService = {};

  registerRalphRoutes({
    app,
    providerOrchestrator: providerOrchestrator as never,
    executionService: executionService as never,
  });

  return { app, providerOrchestrator };
}

// ---------------------------------------------------------------------------
// Route validation tests
// ---------------------------------------------------------------------------

describe("POST /api/ralph/start", () => {
  it("validates required fields — rejects missing spec_content", async () => {
    const { app } = createHarness();
    const res = await app.inject({
      method: "POST",
      url: "/api/ralph/start",
      payload: { actor: "user", project_id: "proj-1" },
    });
    expect(res.statusCode).toBe(500); // zod parse error becomes 500
  });

  it("validates required fields — rejects missing actor", async () => {
    const { app } = createHarness();
    const res = await app.inject({
      method: "POST",
      url: "/api/ralph/start",
      payload: { spec_content: "Build X", project_id: "proj-1" },
    });
    expect(res.statusCode).toBe(500);
  });

  it("validates required fields — rejects missing project_id", async () => {
    const { app } = createHarness();
    const res = await app.inject({
      method: "POST",
      url: "/api/ralph/start",
      payload: { spec_content: "Build X", actor: "user" },
    });
    expect(res.statusCode).toBe(500);
  });

  it("returns 201 with session info on valid input", async () => {
    const { app } = createHarness();
    const res = await app.inject({
      method: "POST",
      url: "/api/ralph/start",
      payload: {
        spec_content: "Build a widget",
        actor: "test-user",
        project_id: "proj-1",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.session_id).toBeDefined();
    expect(body.run_id).toBeDefined();
    expect(body.status).toBe("started");
    expect(body.stream_url).toContain("/api/ralph/");
  });
});

describe("GET /api/ralph/:id/status", () => {
  it("returns 404 for unknown session", async () => {
    const { app } = createHarness();
    const res = await app.inject({
      method: "GET",
      url: "/api/ralph/nonexistent-id/status",
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns session data when found", async () => {
    const { prisma } = await import("../db");
    (prisma.ralphSession.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "sess-1",
      runId: "run-1",
      currentPhase: "execute",
      currentIteration: 2,
      status: "active",
      verificationTier: "STANDARD",
      progressLedger: { completedPhases: ["intake"] },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { app } = createHarness();
    // Re-mock after harness creation
    (prisma.ralphSession.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "sess-1",
      runId: "run-1",
      currentPhase: "execute",
      currentIteration: 2,
      status: "active",
      verificationTier: "STANDARD",
      progressLedger: { completedPhases: ["intake"] },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/ralph/sess-1/status",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.session_id).toBe("sess-1");
    expect(body.current_phase).toBe("execute");
    expect(body.iteration).toBe(2);
  });
});

describe("POST /api/ralph/:id/pause", () => {
  beforeEach(async () => {
    const { prisma } = await import("../db");
    // Reset all mocks to ensure clean state
    (prisma.ralphSession.findUnique as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(null);
  });

  it("returns 404 when session not found anywhere", async () => {
    const { app } = createHarness();

    const res = await app.inject({
      method: "POST",
      url: "/api/ralph/nonexistent/pause",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/ralph/:id/ledger", () => {
  beforeEach(async () => {
    const { prisma } = await import("../db");
    (prisma.ralphSession.findUnique as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(null);
  });

  it("returns 404 for unknown session", async () => {
    const { app } = createHarness();

    const res = await app.inject({
      method: "GET",
      url: "/api/ralph/nonexistent-id/ledger",
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns ledger data with phase executions and verifications", async () => {
    const { prisma } = await import("../db");

    const now = new Date();
    const mockSession = {
      id: "sess-ledger",
      runId: "run-ledger",
      status: "active",
      progressLedger: { completedPhases: ["intake", "blueprint"] },
      phases: [
        {
          id: "phase-1",
          phase: "intake",
          iteration: 1,
          status: "completed",
          output: "Parsed spec successfully",
          filesChanged: ["src/spec.ts"],
          startedAt: now,
          completedAt: now,
        },
        {
          id: "phase-2",
          phase: "blueprint",
          iteration: 1,
          status: "completed",
          output: "Blueprint generated",
          filesChanged: ["src/blueprint.json"],
          startedAt: now,
          completedAt: now,
        },
      ],
      verifications: [
        {
          id: "ver-1",
          iteration: 1,
          verificationTier: "STANDARD",
          testsPassed: true,
          lintsPassed: true,
          regressionsPassed: true,
          deslopPassed: false,
          details: { failedChecks: ["style-consistency"] },
          performedAt: now,
        },
      ],
    };

    (prisma.ralphSession.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockSession);

    const { app } = createHarness();

    (prisma.ralphSession.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockSession);

    const res = await app.inject({
      method: "GET",
      url: "/api/ralph/sess-ledger/ledger",
    });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.payload);
    expect(body.session_id).toBe("sess-ledger");
    expect(body.progress_ledger).toEqual({ completedPhases: ["intake", "blueprint"] });

    // Phase executions
    expect(body.phase_executions).toHaveLength(2);
    expect(body.phase_executions[0].phase).toBe("intake");
    expect(body.phase_executions[0].iteration).toBe(1);
    expect(body.phase_executions[0].status).toBe("completed");
    expect(body.phase_executions[0].output).toBe("Parsed spec successfully");
    expect(body.phase_executions[0].files_changed).toEqual(["src/spec.ts"]);
    expect(body.phase_executions[0].started_at).toBeDefined();
    expect(body.phase_executions[0].completed_at).toBeDefined();
    expect(body.phase_executions[1].phase).toBe("blueprint");

    // Verifications
    expect(body.verifications).toHaveLength(1);
    expect(body.verifications[0].iteration).toBe(1);
    expect(body.verifications[0].tier).toBe("STANDARD");
    expect(body.verifications[0].tests_passed).toBe(true);
    expect(body.verifications[0].lints_passed).toBe(true);
    expect(body.verifications[0].regressions_passed).toBe(true);
    expect(body.verifications[0].deslop_passed).toBe(false);
    expect(body.verifications[0].details).toEqual({ failedChecks: ["style-consistency"] });
    expect(body.verifications[0].created_at).toBeDefined();
  });
});

describe("POST /api/ralph/:id/resume", () => {
  beforeEach(async () => {
    const { prisma } = await import("../db");
    (prisma.ralphSession.findUnique as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(null);
  });

  it("returns 404 for unknown session", async () => {
    const { app } = createHarness();

    const res = await app.inject({
      method: "POST",
      url: "/api/ralph/nonexistent/resume",
    });
    expect(res.statusCode).toBe(404);
  });
});

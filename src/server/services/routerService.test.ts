import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../db";
import { publishEvent } from "../eventBus";
import { RouterService } from "./routerService";

vi.mock("../db", () => ({
  prisma: {
    commandLog: {
      create: vi.fn(),
      update: vi.fn(),
    },
    routingDecisionProjection: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    workflowStateProjection: {
      create: vi.fn(),
    },
  },
}));

vi.mock("../eventBus", () => ({
  publishEvent: vi.fn(),
}));

// ── helpers ────────────────────────────────────────────────────────────

function makeSidecar() {
  return { planRoute: vi.fn() } as any;
}

function makeEvents() {
  return { appendEvent: vi.fn() } as any;
}

function makeOrchestrator() {
  return { getModelRoleBindings: vi.fn() } as any;
}

const baseSidecarDecision = {
  execution_mode: "single_agent" as const,
  model_role: "coder_default" as const,
  provider_id: "qwen-cli" as const,
  max_lanes: 1,
  risk: "medium" as const,
  verification_depth: "standard" as const,
  decomposition_score: 0.3,
  estimated_file_overlap: 0.1,
  rationale: ["single file change", "low complexity"],
};

const baseInput = {
  actor: "agent-1",
  repo_id: "repo-1",
  ticket_id: "ticket-1",
  run_id: "run-1",
  prompt: "add a button",
  risk_level: "medium" as const,
  workspace_path: "/tmp/workspace",
  retrieval_context_ids: ["ctx-1"],
  active_files: ["src/main.ts"],
};

const fakeCommandLog = { id: "cmd-1" };
const NOW = new Date("2026-01-15T00:00:00.000Z");

function fakeProjectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rd-1",
    repoId: "repo-1",
    ticketId: "ticket-1",
    runId: "run-1",
    executionMode: "single_agent",
    modelRole: "coder_default",
    providerId: "openai-compatible",
    maxLanes: 1,
    risk: "medium",
    verificationDepth: "standard",
    decompositionScore: 0.3,
    estimatedFileOverlap: 0.1,
    rationale: ["single file change", "low complexity"],
    metadata: { prompt: "add a button" },
    createdAt: NOW,
    ...overrides,
  };
}

/** Wire up all the happy-path mocks so planRoute() runs end-to-end. */
function setupPlanRouteMocks(
  sidecar: ReturnType<typeof makeSidecar>,
  orchestrator: ReturnType<typeof makeOrchestrator>,
  sidecarOverrides: Record<string, unknown> = {},
  roleBindings: Record<string, unknown> = {}
) {
  sidecar.planRoute.mockResolvedValue({ ...baseSidecarDecision, ...sidecarOverrides });
  orchestrator.getModelRoleBindings.mockResolvedValue({
    coder_default: { providerId: "openai-compatible" },
    ...roleBindings,
  });
  (prisma.commandLog.create as ReturnType<typeof vi.fn>).mockResolvedValue(fakeCommandLog);
  (prisma.commandLog.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (prisma.routingDecisionProjection.create as ReturnType<typeof vi.fn>).mockResolvedValue(fakeProjectionRow());
  (prisma.workflowStateProjection.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
}

// ── tests ──────────────────────────────────────────────────────────────

describe("RouterService", () => {
  let sidecar: ReturnType<typeof makeSidecar>;
  let events: ReturnType<typeof makeEvents>;
  let orchestrator: ReturnType<typeof makeOrchestrator>;
  let svc: RouterService;

  beforeEach(() => {
    vi.clearAllMocks();
    sidecar = makeSidecar();
    events = makeEvents();
    orchestrator = makeOrchestrator();
    svc = new RouterService(sidecar, events, orchestrator);
  });

  // ── planRoute ────────────────────────────────────────────────────────

  describe("planRoute", () => {
    it("creates command log entry", async () => {
      setupPlanRouteMocks(sidecar, orchestrator);

      await svc.planRoute(baseInput);

      expect(prisma.commandLog.create).toHaveBeenCalledWith({
        data: {
          commandType: "router.plan",
          actor: "agent-1",
          aggregateId: "run-1",
          payload: baseInput,
          status: "queued",
        },
      });
    });

    it("calls sidecar with correct payload", async () => {
      setupPlanRouteMocks(sidecar, orchestrator);

      await svc.planRoute(baseInput);

      expect(sidecar.planRoute).toHaveBeenCalledWith({
        ticket_id: "ticket-1",
        run_id: "run-1",
        actor: "agent-1",
        prompt: "add a button",
        risk_level: "medium",
        workspace_path: "/tmp/workspace",
        retrieval_context_count: 1,
        active_files_count: 1,
      });
    });

    it("resolves provider from role bindings", async () => {
      setupPlanRouteMocks(sidecar, orchestrator, {}, {
        coder_default: { providerId: "onprem-qwen" },
      });

      await svc.planRoute(baseInput);

      const projectionCall = (prisma.routingDecisionProjection.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(projectionCall.data.providerId).toBe("onprem-qwen");
    });

    it("creates routing decision projection", async () => {
      setupPlanRouteMocks(sidecar, orchestrator);

      await svc.planRoute(baseInput);

      expect(prisma.routingDecisionProjection.create).toHaveBeenCalledWith({
        data: {
          ticketId: "ticket-1",
          repoId: "repo-1",
          runId: "run-1",
          executionMode: "single_agent",
          modelRole: "coder_default",
          providerId: "openai-compatible",
          maxLanes: 1,
          risk: "medium",
          verificationDepth: "standard",
          decompositionScore: 0.3,
          estimatedFileOverlap: 0.1,
          rationale: ["single file change", "low complexity"],
          metadata: {
            prompt: "add a button",
            retrieval_context_ids: ["ctx-1"],
            active_files: ["src/main.ts"],
          },
        },
      });
    });

    it("creates workflow state projection with correct next steps for single_agent", async () => {
      setupPlanRouteMocks(sidecar, orchestrator);

      await svc.planRoute(baseInput);

      expect(prisma.workflowStateProjection.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          phase: "routing",
          status: "planned",
          nextSteps: ["materialize_context", "queue_execution"],
        }),
      });
    });

    it("creates workflow state with spawn_lanes steps for multi_agent", async () => {
      setupPlanRouteMocks(sidecar, orchestrator, {
        execution_mode: "centralized_parallel",
        max_lanes: 3,
      });

      await svc.planRoute(baseInput);

      const wsCall = (prisma.workflowStateProjection.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(wsCall.data.nextSteps).toEqual([
        "materialize_context",
        "spawn_lanes",
        "prepare_merge_verification",
      ]);
    });

    it("publishes router.planned event via V2EventService", async () => {
      setupPlanRouteMocks(sidecar, orchestrator);

      await svc.planRoute(baseInput);

      expect(events.appendEvent).toHaveBeenCalledWith({
        type: "router.planned",
        aggregateId: "run-1",
        actor: "agent-1",
        payload: {
          routing_decision_id: "rd-1",
          repo_id: "repo-1",
          ticket_id: "ticket-1",
          run_id: "run-1",
          execution_mode: "single_agent",
          model_role: "coder_default",
          provider_id: "openai-compatible",
          max_lanes: 1,
          rationale: ["single file change", "low complexity"],
        },
        correlationId: "cmd-1",
      });
    });

    it("publishes to global event bus", async () => {
      setupPlanRouteMocks(sidecar, orchestrator);

      await svc.planRoute(baseInput);

      expect(publishEvent).toHaveBeenCalledWith("global", "router.planned", {
        routingDecisionId: "rd-1",
        ticketId: "ticket-1",
        repoId: "repo-1",
        runId: "run-1",
        executionMode: "single_agent",
        modelRole: "coder_default",
        providerId: "openai-compatible",
        maxLanes: 1,
      });
    });

    it("completes command log with executed status", async () => {
      setupPlanRouteMocks(sidecar, orchestrator);

      await svc.planRoute(baseInput);

      expect(prisma.commandLog.update).toHaveBeenCalledWith({
        where: { id: "cmd-1" },
        data: {
          status: "executed",
          result: {
            routing_decision: expect.objectContaining({
              id: "rd-1",
              executionMode: "single_agent",
              modelRole: "coder_default",
              providerId: "openai-compatible",
            }),
          },
        },
      });
    });
  });

  // ── getDecision ──────────────────────────────────────────────────────

  describe("getDecision", () => {
    it("returns null for unknown id", async () => {
      (prisma.routingDecisionProjection.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await svc.getDecision("nonexistent");

      expect(prisma.routingDecisionProjection.findUnique).toHaveBeenCalledWith({
        where: { id: "nonexistent" },
      });
      expect(result).toBeNull();
    });

    it("returns mapped decision", async () => {
      const row = fakeProjectionRow();
      (prisma.routingDecisionProjection.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(row);

      const result = await svc.getDecision("rd-1");

      expect(result).toEqual({
        id: "rd-1",
        repoId: "repo-1",
        ticketId: "ticket-1",
        runId: "run-1",
        executionMode: "single_agent",
        modelRole: "coder_default",
        providerId: "openai-compatible",
        maxLanes: 1,
        risk: "medium",
        verificationDepth: "standard",
        decompositionScore: 0.3,
        estimatedFileOverlap: 0.1,
        rationale: ["single file change", "low complexity"],
        metadata: { prompt: "add a button" },
        createdAt: "2026-01-15T00:00:00.000Z",
      });
    });
  });

  // ── listRecentForAggregate ───────────────────────────────────────────

  describe("listRecentForAggregate", () => {
    it("returns ordered decisions", async () => {
      const rows = [
        fakeProjectionRow({ id: "rd-2", createdAt: new Date("2026-01-16T00:00:00.000Z") }),
        fakeProjectionRow({ id: "rd-1", createdAt: NOW }),
      ];
      (prisma.routingDecisionProjection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

      const result = await svc.listRecentForAggregate("ticket-1");

      expect(prisma.routingDecisionProjection.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ ticketId: "ticket-1" }, { runId: "ticket-1" }],
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("rd-2");
      expect(result[1].id).toBe("rd-1");
    });
  });
});

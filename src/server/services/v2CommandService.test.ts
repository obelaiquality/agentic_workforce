import { describe, expect, it, vi, beforeEach } from "vitest";
import { V2CommandService } from "./v2CommandService";

// ── Mock dependencies ──────────────────────────────────────────────────────

const { mockPublishEvent, mockPrisma } = vi.hoisted(() => ({
  mockPublishEvent: vi.fn(),
  mockPrisma: {
    commandLog: {
      create: vi.fn(),
      update: vi.fn(),
    },
    ticket: {
      updateMany: vi.fn(),
    },
    runProjection: {
      upsert: vi.fn(),
    },
    workflowStateProjection: {
      create: vi.fn(),
    },
    approvalRequest: {
      create: vi.fn(),
    },
    executionRun: {
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("../eventBus", () => ({
  publishEvent: mockPublishEvent,
}));

vi.mock("../db", () => ({
  prisma: mockPrisma,
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSidecar() {
  return {
    evaluatePolicy: vi.fn(),
    allocateTask: vi.fn(),
  };
}

function makeProviderOrchestrator() {
  return {
    checkProviderHealth: vi.fn(),
    setActiveProvider: vi.fn(),
    getModelRoleBinding: vi.fn().mockResolvedValue({
      role: "coder_default",
      providerId: "onprem-qwen",
      pluginId: "qwen3.5-4b",
      model: "mlx-community/Qwen3.5-4B-4bit",
    }),
  };
}

function makeEvents() {
  return {
    appendEvent: vi.fn().mockResolvedValue({ event_id: "evt-1" }),
  };
}

function makeRouterService() {
  return {
    getDecision: vi.fn().mockResolvedValue(null),
    listRecentForAggregate: vi.fn().mockResolvedValue([]),
    planRoute: vi.fn().mockResolvedValue({
      id: "rd-1",
      ticketId: "ticket-1",
      runId: null,
      executionMode: "single_agent",
      modelRole: "coder_default",
      providerId: "onprem-qwen",
      maxLanes: 1,
      risk: "medium",
      verificationDepth: "standard",
      decompositionScore: 0.5,
      estimatedFileOverlap: 0.1,
      rationale: ["Default route"],
      createdAt: new Date().toISOString(),
    }),
  };
}

function allowPolicy() {
  return {
    decision: "allow" as const,
    requires_approval: false,
    reasons: [],
    required_scopes: [],
    policy_version: "v2-test",
  };
}

function denyPolicy(reason = "Denied by policy") {
  return {
    decision: "deny" as const,
    requires_approval: false,
    reasons: [reason],
    required_scopes: [],
    policy_version: "v2-test",
  };
}

function approvalPolicy() {
  return {
    decision: "allow" as const,
    requires_approval: true,
    reasons: ["Requires approval for high-risk action"],
    required_scopes: ["write"],
    policy_version: "v2-test",
  };
}

let sidecar: ReturnType<typeof makeSidecar>;
let providerOrchestrator: ReturnType<typeof makeProviderOrchestrator>;
let events: ReturnType<typeof makeEvents>;
let routerService: ReturnType<typeof makeRouterService>;
let service: V2CommandService;

beforeEach(() => {
  vi.clearAllMocks();

  sidecar = makeSidecar();
  providerOrchestrator = makeProviderOrchestrator();
  events = makeEvents();
  routerService = makeRouterService();

  service = new V2CommandService(
    sidecar as any,
    providerOrchestrator as any,
    events as any,
    routerService as any,
  );

  mockPrisma.commandLog.create.mockResolvedValue({
    id: "cmd-1",
    commandType: "test",
    actor: "agent",
    aggregateId: null,
    payload: {},
    status: "queued",
  });
  mockPrisma.commandLog.update.mockResolvedValue({ id: "cmd-1" });
  mockPrisma.ticket.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.runProjection.upsert.mockResolvedValue({ runId: "run-1" });
  mockPrisma.workflowStateProjection.create.mockResolvedValue({ id: "ws-1" });
  mockPrisma.approvalRequest.create.mockResolvedValue({ id: "apr-1" });
  mockPrisma.executionRun.updateMany.mockResolvedValue({ count: 1 });
});

// ── evaluatePolicy ─────────────────────────────────────────────────────────

describe("evaluatePolicy", () => {
  it("calls sidecar with correct payload and returns decision", async () => {
    const decision = allowPolicy();
    sidecar.evaluatePolicy.mockResolvedValue(decision);

    const result = await service.evaluatePolicy({
      action_type: "run_command",
      actor: "agent-1",
      risk_level: "low",
      workspace_path: "/repo",
      payload: { key: "value" },
    });

    expect(sidecar.evaluatePolicy).toHaveBeenCalledWith({
      action_type: "run_command",
      actor: "agent-1",
      risk_level: "low",
      workspace_path: "/repo",
      payload_json: JSON.stringify({ key: "value" }),
      dry_run: false,
    });
    expect(result.decision).toEqual(decision);
    expect(result.command_id).toBe("cmd-1");
  });

  it("dry-run mode passes dry_run=true to sidecar", async () => {
    sidecar.evaluatePolicy.mockResolvedValue(allowPolicy());

    await service.evaluatePolicy({
      action_type: "run_command",
      actor: "agent-1",
      risk_level: "low",
      workspace_path: "/repo",
      payload: {},
      dry_run: true,
    });

    expect(sidecar.evaluatePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ dry_run: true }),
    );
  });

  it("handles sidecar deny decision gracefully", async () => {
    const decision = denyPolicy("Not permitted");
    sidecar.evaluatePolicy.mockResolvedValue(decision);

    const result = await service.evaluatePolicy({
      action_type: "run_command",
      actor: "agent-1",
      risk_level: "high",
      workspace_path: "/repo",
      payload: {},
    });

    expect(result.decision.decision).toBe("deny");
    expect(mockPrisma.commandLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "rejected" }),
      }),
    );
  });
});

// ── intakeTask ──────────────────────────────────────────────────────────────

describe("intakeTask", () => {
  it("allocates task when policy allows", async () => {
    sidecar.evaluatePolicy.mockResolvedValue(allowPolicy());
    const allocation = {
      found: true,
      ticket_id: "ticket-42",
      strategy: "weighted-random-next",
      score: 0.85,
      reservation_expires_at: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
      message: "Allocated",
    };
    sidecar.allocateTask.mockResolvedValue(allocation);

    const result = await service.intakeTask({
      strategy: "weighted-random-next",
      actor: "agent-1",
    });

    expect(result.allocation).toEqual(allocation);
    expect(sidecar.allocateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: "weighted-random-next",
        actor: "agent-1",
        reservation_ttl_seconds: 4 * 60 * 60,
      }),
    );
    expect(mockPublishEvent).toHaveBeenCalledWith(
      "global",
      "v2.command.task.intake",
      expect.objectContaining({ command_id: "cmd-1" }),
    );
  });

  it("rejects when policy denies with correct error/reason", async () => {
    sidecar.evaluatePolicy.mockResolvedValue(denyPolicy("Capacity exceeded"));

    const result = await service.intakeTask({
      strategy: "deterministic-next",
      actor: "agent-1",
    });

    expect(result.allocation).toBeNull();
    expect(result.decision.decision).toBe("deny");
    expect(sidecar.allocateTask).not.toHaveBeenCalled();
    expect(mockPrisma.commandLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "rejected" }),
      }),
    );
  });

  it("creates correct command log record", async () => {
    sidecar.evaluatePolicy.mockResolvedValue(allowPolicy());
    sidecar.allocateTask.mockResolvedValue({ found: true, ticket_id: "t-1", strategy: "deterministic-next", score: 1, reservation_expires_at: "", message: "" });

    await service.intakeTask({
      strategy: "deterministic-next",
      actor: "agent-1",
      seed: "seed-value",
      reservation_ttl_seconds: 7200,
    });

    expect(mockPrisma.commandLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        commandType: "task.intake",
        actor: "agent-1",
      }),
    });
  });
});

// ── reserveTask ────────────────────────────────────────────────────────────

describe("reserveTask", () => {
  it("reserves with TTL and returns reservation record", async () => {
    const result = await service.reserveTask({
      ticket_id: "ticket-1",
      actor: "agent-1",
      reservation_ttl_seconds: 3600,
    });

    expect(result.command_id).toBe("cmd-1");
    expect(result.reservation_expires_at).toBeTruthy();
    const expiresAt = new Date(result.reservation_expires_at).getTime();
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(events.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "task.reserve",
        aggregateId: "ticket-1",
      }),
    );
  });

  it("uses default TTL of 4 hours when not specified", async () => {
    const before = Date.now();
    const result = await service.reserveTask({
      ticket_id: "ticket-1",
      actor: "agent-1",
    });
    const after = Date.now();

    const expiresAt = new Date(result.reservation_expires_at).getTime();
    const expectedMin = before + 4 * 60 * 60 * 1000;
    const expectedMax = after + 4 * 60 * 60 * 1000;
    expect(expiresAt).toBeGreaterThanOrEqual(expectedMin);
    expect(expiresAt).toBeLessThanOrEqual(expectedMax);
  });

  it("creates task.reserve event with correct payload", async () => {
    await service.reserveTask({
      ticket_id: "ticket-2",
      actor: "agent-2",
      reservation_ttl_seconds: 1800,
    });

    expect(events.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "task.reserve",
        aggregateId: "ticket-2",
        actor: "agent-2",
        payload: expect.objectContaining({
          ticket_id: "ticket-2",
          agent_id: "agent-2",
        }),
      }),
    );
  });
});

// ── transitionTask ─────────────────────────────────────────────────────────

describe("transitionTask", () => {
  it("valid transition in_progress -> review succeeds", async () => {
    sidecar.evaluatePolicy.mockResolvedValue(allowPolicy());

    const result = await service.transitionTask({
      ticket_id: "ticket-1",
      actor: "agent-1",
      status: "in_progress",
    });

    expect(result.transitioned).toBe(true);
    expect(result.command_id).toBe("cmd-1");
  });

  it("rejects invalid transitions when policy denies", async () => {
    sidecar.evaluatePolicy.mockResolvedValue(denyPolicy("Invalid transition"));

    const result = await service.transitionTask({
      ticket_id: "ticket-1",
      actor: "agent-1",
      status: "completed",
    });

    expect(result.transitioned).toBe(false);
    expect(result.decision.decision).toBe("deny");
    expect(events.appendEvent).not.toHaveBeenCalled();
  });

  it("syncs legacy ticket status on transition", async () => {
    sidecar.evaluatePolicy.mockResolvedValue(allowPolicy());

    await service.transitionTask({
      ticket_id: "ticket-1",
      actor: "agent-1",
      status: "in_progress",
    });

    expect(mockPrisma.ticket.updateMany).toHaveBeenCalledWith({
      where: { id: "ticket-1" },
      data: { status: "in_progress" },
    });
  });

  it("maps inactive to backlog for legacy status", async () => {
    sidecar.evaluatePolicy.mockResolvedValue(allowPolicy());

    await service.transitionTask({
      ticket_id: "ticket-1",
      actor: "agent-1",
      status: "inactive",
    });

    expect(mockPrisma.ticket.updateMany).toHaveBeenCalledWith({
      where: { id: "ticket-1" },
      data: { status: "backlog" },
    });
  });

  it("maps completed to done for legacy status", async () => {
    sidecar.evaluatePolicy.mockResolvedValue(allowPolicy());

    await service.transitionTask({
      ticket_id: "ticket-1",
      actor: "agent-1",
      status: "completed",
    });

    expect(mockPrisma.ticket.updateMany).toHaveBeenCalledWith({
      where: { id: "ticket-1" },
      data: { status: "done" },
    });
  });

  it("creates transition event with correct payload", async () => {
    sidecar.evaluatePolicy.mockResolvedValue(allowPolicy());

    await service.transitionTask({
      ticket_id: "ticket-5",
      actor: "agent-3",
      status: "blocked",
    });

    expect(events.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "task.transition",
        aggregateId: "ticket-5",
        actor: "agent-3",
        payload: expect.objectContaining({
          ticket_id: "ticket-5",
          status: "blocked",
          agent_id: "agent-3",
        }),
      }),
    );
  });
});

// ── requestExecution ───────────────────────────────────────────────────────

describe("requestExecution", () => {
  const baseInput = {
    ticket_id: "ticket-1",
    actor: "agent-1",
    prompt: "Implement login form",
    retrieval_context_ids: ["ctx-1", "ctx-2"],
    workspace_path: "/repo",
    risk_level: "medium" as const,
  };

  it("routes to correct provider/model based on routing decision", async () => {
    sidecar.evaluatePolicy.mockResolvedValue(allowPolicy());

    const result = await service.requestExecution(baseInput);

    expect(result.status).toBe("queued");
    expect(result.model_role).toBe("coder_default");
    expect(result.provider_id).toBe("onprem-qwen");
    expect(result.run_id).toBeTruthy();
    expect(mockPrisma.runProjection.upsert).toHaveBeenCalled();
    expect(mockPrisma.workflowStateProjection.create).toHaveBeenCalled();
  });

  it("reuses existing routing decision when available", async () => {
    const existingDecision = {
      id: "rd-existing",
      ticketId: "ticket-1",
      runId: null,
      executionMode: "single_agent",
      modelRole: "review_deep",
      providerId: "openai-responses",
      maxLanes: 1,
      risk: "high",
      verificationDepth: "deep",
      decompositionScore: 0.9,
      estimatedFileOverlap: 0.2,
      rationale: ["Existing route"],
      createdAt: new Date().toISOString(),
    };
    routerService.getDecision.mockResolvedValue(existingDecision);
    sidecar.evaluatePolicy.mockResolvedValue(allowPolicy());

    const result = await service.requestExecution({
      ...baseInput,
      routing_decision_id: "rd-existing",
    });

    expect(result.routing_decision_id).toBe("rd-existing");
    expect(result.model_role).toBe("review_deep");
    expect(result.provider_id).toBe("openai-responses");
    expect(routerService.planRoute).not.toHaveBeenCalled();
  });

  it("plans new route when no existing decision", async () => {
    routerService.getDecision.mockResolvedValue(null);
    routerService.listRecentForAggregate.mockResolvedValue([]);
    sidecar.evaluatePolicy.mockResolvedValue(allowPolicy());

    await service.requestExecution(baseInput);

    expect(routerService.planRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "agent-1",
        ticket_id: "ticket-1",
        prompt: "Implement login form",
      }),
    );
  });

  it("creates approval request when policy requires_approval", async () => {
    sidecar.evaluatePolicy.mockResolvedValue(approvalPolicy());

    const result = await service.requestExecution(baseInput);

    expect(result.status).toBe("approval_required");
    expect(result.approval_id).toBe("apr-1");
    expect(mockPrisma.approvalRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actionType: "execution_request",
      }),
    });
  });

  it("creates run projection with correct status", async () => {
    sidecar.evaluatePolicy.mockResolvedValue(allowPolicy());

    await service.requestExecution(baseInput);

    expect(mockPrisma.runProjection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "queued",
          ticketId: "ticket-1",
        }),
      }),
    );
  });

  it("rejects when policy denies", async () => {
    sidecar.evaluatePolicy.mockResolvedValue(denyPolicy("Too risky"));

    const result = await service.requestExecution(baseInput);

    expect(result.status).toBe("rejected");
    expect(mockPrisma.commandLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "rejected" }),
      }),
    );
  });

  it("throws when retrieval_context_ids is empty", async () => {
    await expect(
      service.requestExecution({
        ...baseInput,
        retrieval_context_ids: [],
      }),
    ).rejects.toThrow("retrieval_context_ids");
  });

  it("falls back to aggregate-based routing when no direct decision found", async () => {
    const aggregateDecision = {
      id: "rd-agg",
      ticketId: "ticket-1",
      runId: null,
      executionMode: "single_agent",
      modelRole: "utility_fast",
      providerId: "onprem-qwen",
      maxLanes: 1,
      risk: "low",
      verificationDepth: "light",
      decompositionScore: 0.3,
      estimatedFileOverlap: 0.0,
      rationale: ["Aggregate route"],
      createdAt: new Date().toISOString(),
    };
    routerService.getDecision.mockResolvedValue(null);
    routerService.listRecentForAggregate.mockResolvedValue([aggregateDecision]);
    sidecar.evaluatePolicy.mockResolvedValue(allowPolicy());

    const result = await service.requestExecution(baseInput);

    expect(result.routing_decision_id).toBe("rd-agg");
    expect(routerService.planRoute).not.toHaveBeenCalled();
  });
});

// ── activateProvider ───────────────────────────────────────────────────────

describe("activateProvider", () => {
  it("performs health check and activates", async () => {
    providerOrchestrator.checkProviderHealth.mockResolvedValue({ ok: true });
    sidecar.evaluatePolicy.mockResolvedValue(allowPolicy());

    const result = await service.activateProvider({
      provider_id: "onprem-qwen",
      actor: "agent-1",
    });

    expect(result.status).toBe("activated");
    expect(providerOrchestrator.setActiveProvider).toHaveBeenCalledWith("onprem-qwen");
    expect(events.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "provider.activated",
        aggregateId: "onprem-qwen",
      }),
    );
  });

  it("rejects when health check fails", async () => {
    providerOrchestrator.checkProviderHealth.mockResolvedValue({
      ok: false,
      reason: "Provider unreachable",
    });

    const result = await service.activateProvider({
      provider_id: "openai-compatible",
      actor: "agent-1",
    });

    expect(result.status).toBe("rejected");
    expect(providerOrchestrator.setActiveProvider).not.toHaveBeenCalled();
    expect(sidecar.evaluatePolicy).not.toHaveBeenCalled();
  });

  it("creates approval when policy requires it", async () => {
    providerOrchestrator.checkProviderHealth.mockResolvedValue({ ok: true });
    sidecar.evaluatePolicy.mockResolvedValue(approvalPolicy());

    const result = await service.activateProvider({
      provider_id: "openai-responses",
      actor: "agent-1",
    });

    expect(result.status).toBe("approval_required");
    expect((result as any).approval_id).toBe("apr-1");
    expect(providerOrchestrator.setActiveProvider).not.toHaveBeenCalled();
  });

  it("rejects when policy denies", async () => {
    providerOrchestrator.checkProviderHealth.mockResolvedValue({ ok: true });
    sidecar.evaluatePolicy.mockResolvedValue(denyPolicy("Provider banned"));

    const result = await service.activateProvider({
      provider_id: "qwen-cli",
      actor: "agent-1",
    });

    expect(result.status).toBe("rejected");
    expect(providerOrchestrator.setActiveProvider).not.toHaveBeenCalled();
  });
});

// ── stopExecution ──────────────────────────────────────────────────────────

describe("stopExecution", () => {
  it("cancels running execution", async () => {
    const result = await service.stopExecution({
      run_id: "run-1",
      repo_id: "repo-1",
      actor: "agent-1",
      reason: "User requested stop",
    });

    expect(result.stopped).toBe(true);
    expect(result.command_id).toBe("cmd-1");
    expect(events.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "execution.stopped",
        aggregateId: "run-1",
        payload: expect.objectContaining({
          run_id: "run-1",
          reason: "User requested stop",
        }),
      }),
    );
    expect(mockPrisma.executionRun.updateMany).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({ status: "failed" }),
    });
  });

  it("uses default reason when none provided", async () => {
    await service.stopExecution({
      run_id: "run-2",
      repo_id: "repo-1",
      actor: "agent-1",
    });

    expect(events.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          reason: "Stopped by operator",
        }),
      }),
    );
  });
});

// ── requeueTask ────────────────────────────────────────────────────────────

describe("requeueTask", () => {
  it("requeues with correct status reset", async () => {
    const result = await service.requeueTask({
      ticket_id: "ticket-1",
      actor: "agent-1",
      reason: "Retry needed",
    });

    expect(result.command_id).toBe("cmd-1");
    expect(result.requeued).toBe(true);
    expect(mockPrisma.ticket.updateMany).toHaveBeenCalledWith({
      where: { id: "ticket-1" },
      data: { status: "ready" },
    });
    expect(events.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "task.requeued",
        aggregateId: "ticket-1",
        payload: expect.objectContaining({
          ticket_id: "ticket-1",
          reason: "Retry needed",
        }),
      }),
    );
  });

  it("uses default reason when none provided", async () => {
    await service.requeueTask({
      ticket_id: "ticket-2",
      actor: "agent-1",
    });

    expect(events.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          reason: "Requeued by operator",
        }),
      }),
    );
  });
});

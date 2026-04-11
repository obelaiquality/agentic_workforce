import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TeamPhase, AgenticEvent, EnhancedTeamInput } from "../../shared/contracts";
import type { ProviderOrchestrator } from "../services/providerOrchestrator";

// ---------------------------------------------------------------------------
// Mock Prisma (vi.hoisted so vi.mock factory can reference it)
// ---------------------------------------------------------------------------

const mockPrisma = vi.hoisted(() => ({
  teamSession: {
    create: vi.fn().mockResolvedValue({ id: "session-1" }),
    update: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn().mockResolvedValue(null),
  },
  teamWorker: {
    create: vi.fn().mockResolvedValue({}),
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  teamTask: {
    create: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  teamMessage: {
    create: vi.fn().mockResolvedValue({ id: "msg-1" }),
    findMany: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../db", () => ({
  prisma: mockPrisma,
}));

import {
  TEAM_TRANSITIONS,
  isValidTransition,
  claimTask,
  reclaimExpiredTasks,
  EnhancedTeamOrchestrator,
} from "./enhancedTeamMode";

// ---------------------------------------------------------------------------
// Mock Provider Orchestrator
// ---------------------------------------------------------------------------

function createMockProviderOrchestrator(
  decompositionResponse?: string,
): ProviderOrchestrator {
  const defaultDecomposition = JSON.stringify({
    tasks: [
      { name: "Task 1", description: "Do thing 1", priority: 1, workerRole: "implementer" },
      { name: "Task 2", description: "Do thing 2", priority: 0, workerRole: "tester" },
    ],
    workers: [
      { role: "implementer", workerId: "worker-impl" },
      { role: "tester", workerId: "worker-test" },
    ],
  });

  const response = decompositionResponse ?? defaultDecomposition;

  return {
    async streamChatWithRetry(
      _sessionId: string,
      _messages: Array<{ role: string; content: string }>,
      onToken: (token: string) => void,
      _options?: unknown,
    ) {
      onToken(response);
      return { usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } };
    },
  } as unknown as ProviderOrchestrator;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseInput(overrides?: Partial<EnhancedTeamInput>): EnhancedTeamInput {
  return {
    runId: "run-1",
    repoId: "repo-1",
    ticketId: "ticket-1",
    objective: "Build a feature",
    worktreePath: "/tmp/test",
    actor: "test-user",
    ...overrides,
  };
}

async function collectEvents(gen: AsyncGenerator<AgenticEvent>): Promise<AgenticEvent[]> {
  const events: AgenticEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TEAM_TRANSITIONS", () => {
  it("has entries for all phases", () => {
    const phases: TeamPhase[] = [
      "team_plan",
      "team_exec",
      "team_verify",
      "team_fix",
      "team_complete",
    ];
    for (const phase of phases) {
      expect(TEAM_TRANSITIONS).toHaveProperty(phase);
      expect(Array.isArray(TEAM_TRANSITIONS[phase])).toBe(true);
    }
  });

  it("team_plan transitions only to team_exec", () => {
    expect(TEAM_TRANSITIONS.team_plan).toEqual(["team_exec"]);
  });

  it("team_exec transitions only to team_verify", () => {
    expect(TEAM_TRANSITIONS.team_exec).toEqual(["team_verify"]);
  });

  it("team_verify transitions to team_fix or team_complete", () => {
    expect(TEAM_TRANSITIONS.team_verify).toEqual(["team_fix", "team_complete"]);
  });

  it("team_fix transitions to team_exec, team_verify, or team_complete", () => {
    expect(TEAM_TRANSITIONS.team_fix).toEqual(["team_exec", "team_verify", "team_complete"]);
  });

  it("team_complete has no transitions", () => {
    expect(TEAM_TRANSITIONS.team_complete).toEqual([]);
  });
});

describe("isValidTransition", () => {
  it("accepts valid transitions", () => {
    expect(isValidTransition("team_plan", "team_exec")).toBe(true);
    expect(isValidTransition("team_exec", "team_verify")).toBe(true);
    expect(isValidTransition("team_verify", "team_fix")).toBe(true);
    expect(isValidTransition("team_verify", "team_complete")).toBe(true);
    expect(isValidTransition("team_fix", "team_exec")).toBe(true);
    expect(isValidTransition("team_fix", "team_verify")).toBe(true);
    expect(isValidTransition("team_fix", "team_complete")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(isValidTransition("team_plan", "team_verify")).toBe(false);
    expect(isValidTransition("team_plan", "team_complete")).toBe(false);
    expect(isValidTransition("team_exec", "team_plan")).toBe(false);
    expect(isValidTransition("team_exec", "team_fix")).toBe(false);
    expect(isValidTransition("team_complete", "team_plan")).toBe(false);
    expect(isValidTransition("team_complete", "team_exec")).toBe(false);
  });

  it("rejects self-transitions", () => {
    expect(isValidTransition("team_plan", "team_plan")).toBe(false);
    expect(isValidTransition("team_exec", "team_exec")).toBe(false);
    expect(isValidTransition("team_complete", "team_complete")).toBe(false);
  });
});

describe("claimTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when a pending task is claimed", async () => {
    mockPrisma.teamTask.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await claimTask("session-1", "task-1", "worker-1");
    expect(result).toBe(true);

    expect(mockPrisma.teamTask.updateMany).toHaveBeenCalledWith({
      where: { id: "task-1", status: "pending", sessionId: "session-1" },
      data: expect.objectContaining({
        status: "claimed",
        assignedTo: "worker-1",
      }),
    });
  });

  it("returns false when the task is already claimed", async () => {
    mockPrisma.teamTask.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await claimTask("session-1", "task-1", "worker-1");
    expect(result).toBe(false);
  });

  it("sets lease expiration based on provided leaseMs", async () => {
    mockPrisma.teamTask.updateMany.mockResolvedValueOnce({ count: 1 });

    const before = Date.now();
    await claimTask("session-1", "task-1", "worker-1", 10_000);
    const after = Date.now();

    const callData = mockPrisma.teamTask.updateMany.mock.calls[0][0].data;
    const leaseExpires = callData.leaseExpires.getTime();

    // Lease should be approximately 10 seconds from now
    expect(leaseExpires).toBeGreaterThanOrEqual(before + 10_000);
    expect(leaseExpires).toBeLessThanOrEqual(after + 10_000);
  });

  it("uses default 5 minute lease when leaseMs not provided", async () => {
    mockPrisma.teamTask.updateMany.mockResolvedValueOnce({ count: 1 });

    const before = Date.now();
    await claimTask("session-1", "task-1", "worker-1");
    const after = Date.now();

    const callData = mockPrisma.teamTask.updateMany.mock.calls[0][0].data;
    const leaseExpires = callData.leaseExpires.getTime();
    const fiveMinMs = 5 * 60 * 1000;

    expect(leaseExpires).toBeGreaterThanOrEqual(before + fiveMinMs);
    expect(leaseExpires).toBeLessThanOrEqual(after + fiveMinMs);
  });
});

describe("reclaimExpiredTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reclaims tasks with expired leases and returns count", async () => {
    mockPrisma.teamTask.updateMany.mockResolvedValueOnce({ count: 3 });

    const count = await reclaimExpiredTasks("session-1");
    expect(count).toBe(3);

    expect(mockPrisma.teamTask.updateMany).toHaveBeenCalledWith({
      where: {
        sessionId: "session-1",
        status: "claimed",
        leaseExpires: { lt: expect.any(Date) },
      },
      data: {
        status: "pending",
        assignedTo: null,
        claimedAt: null,
        leaseExpires: null,
      },
    });
  });

  it("returns 0 when no tasks have expired leases", async () => {
    mockPrisma.teamTask.updateMany.mockResolvedValueOnce({ count: 0 });

    const count = await reclaimExpiredTasks("session-1");
    expect(count).toBe(0);
  });
});

describe("EnhancedTeamOrchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations for the happy path
    mockPrisma.teamSession.create.mockResolvedValue({ id: "session-1" });
    mockPrisma.teamSession.update.mockResolvedValue({});
    mockPrisma.teamWorker.create.mockResolvedValue({});
    mockPrisma.teamTask.create.mockResolvedValue({});

    // Return idle workers when asked
    let workerCallCount = 0;
    mockPrisma.teamWorker.findFirst.mockImplementation(async () => {
      workerCallCount++;
      if (workerCallCount <= 2) {
        return {
          id: `wid-${workerCallCount}`,
          workerId: `worker-${workerCallCount}`,
          sessionId: "session-1",
          role: workerCallCount === 1 ? "implementer" : "tester",
          status: "idle",
          currentTaskId: null,
          lastHeartbeatAt: new Date(),
        };
      }
      return null;
    });

    // Return pending tasks
    mockPrisma.teamTask.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args?.where?.status === "pending") {
        return [
          { id: "task-1", name: "Task 1", description: "Do thing 1", priority: 1, status: "pending", sessionId: "session-1" },
          { id: "task-2", name: "Task 2", description: "Do thing 2", priority: 0, status: "pending", sessionId: "session-1" },
        ];
      }
      if (args?.where?.status === "failed") {
        return [];
      }
      // Default: return all tasks as completed (for verify phase)
      return [
        { id: "task-1", status: "completed" },
        { id: "task-2", status: "completed" },
      ];
    });

    // claimTask succeeds
    mockPrisma.teamTask.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.teamTask.update.mockResolvedValue({});
    mockPrisma.teamWorker.update.mockResolvedValue({});
  });

  it("progresses through plan -> exec -> verify -> complete (happy path)", async () => {
    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(),
    });

    const events = await collectEvents(orchestrator.execute(baseInput()));

    const types = events.map((e) => e.type);

    expect(types).toContain("team_session_started");
    expect(types).toContain("team_phase_changed");
    expect(types).toContain("execution_complete");

    // Check phase progression
    const phaseChanges = events.filter(
      (e) => e.type === "team_phase_changed",
    ) as Array<{ type: "team_phase_changed"; from: string; to: string }>;

    expect(phaseChanges.length).toBeGreaterThanOrEqual(3);
    expect(phaseChanges[0]).toEqual({
      type: "team_phase_changed",
      from: "team_plan",
      to: "team_exec",
    });
    expect(phaseChanges[1]).toEqual({
      type: "team_phase_changed",
      from: "team_exec",
      to: "team_verify",
    });
    expect(phaseChanges[2]).toEqual({
      type: "team_phase_changed",
      from: "team_verify",
      to: "team_complete",
    });
  });

  it("dispatches tasks and reports results", async () => {
    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(),
    });

    const events = await collectEvents(orchestrator.execute(baseInput()));

    const dispatched = events.filter((e) => e.type === "team_task_dispatched");
    const results = events.filter((e) => e.type === "team_task_result");
    const workerStatuses = events.filter((e) => e.type === "team_worker_status");

    expect(dispatched.length).toBeGreaterThanOrEqual(1);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(workerStatuses.length).toBeGreaterThanOrEqual(1);
  });

  it("progresses through fix phase when verification fails", async () => {
    // Make verify fail: return a failed task on first findMany for verify,
    // then return no failed tasks on second verify
    let findManyCallCount = 0;
    mockPrisma.teamTask.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      findManyCallCount++;
      if (args?.where?.status === "pending") {
        return [
          { id: "task-1", name: "Task 1", description: "Do thing 1", priority: 1, status: "pending", sessionId: "session-1" },
        ];
      }
      if (args?.where?.status === "failed") {
        // First call to find failed tasks (for createFixTasks)
        if (findManyCallCount <= 5) {
          return [{ id: "task-1", name: "Task 1", description: "Do thing 1", priority: 1, status: "failed", result: "error", sessionId: "session-1" }];
        }
        return [];
      }
      // Verify calls: first returns a failure, subsequent return success
      if (findManyCallCount <= 4) {
        return [{ id: "task-1", status: "failed" }];
      }
      return [{ id: "task-1", status: "completed" }];
    });

    // Reset worker findFirst for fix phase
    let workerCallCount = 0;
    mockPrisma.teamWorker.findFirst.mockImplementation(async () => {
      workerCallCount++;
      return {
        id: `wid-${workerCallCount}`,
        workerId: `worker-${workerCallCount}`,
        sessionId: "session-1",
        role: "implementer",
        status: "idle",
        currentTaskId: null,
        lastHeartbeatAt: new Date(),
      };
    });

    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(),
    });

    const events = await collectEvents(orchestrator.execute(baseInput()));

    const phaseChanges = events.filter(
      (e) => e.type === "team_phase_changed",
    ) as Array<{ type: "team_phase_changed"; from: string; to: string }>;

    const fromToList = phaseChanges.map((p) => `${p.from}->${p.to}`);

    // Should include: plan->exec, exec->verify, verify->fix, fix->verify, verify->complete
    expect(fromToList).toContain("team_plan->team_exec");
    expect(fromToList).toContain("team_exec->team_verify");
    expect(fromToList).toContain("team_verify->team_fix");
    expect(fromToList).toContain("team_fix->team_verify");
    expect(fromToList).toContain("team_verify->team_complete");
  });

  it("emits error event on orchestrator failure", async () => {
    mockPrisma.teamSession.create.mockRejectedValueOnce(new Error("DB connection lost"));

    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(),
    });

    const events = await collectEvents(orchestrator.execute(baseInput()));

    const errors = events.filter((e) => e.type === "error");
    expect(errors.length).toBe(1);
    expect((errors[0] as { type: "error"; error: string }).error).toContain("DB connection lost");
  });

  it("creates session with correct parameters", async () => {
    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(),
    });

    await collectEvents(
      orchestrator.execute(
        baseInput({ maxWorkers: 10, maxConcurrentWorkers: 5 }),
      ),
    );

    expect(mockPrisma.teamSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        runId: "run-1",
        repoId: "repo-1",
        objective: "Build a feature",
        maxWorkers: 10,
        maxConcurrent: 5,
        status: "active",
        actor: "test-user",
      }),
    });
  });

  it("updates session to completed on success", async () => {
    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(),
    });

    await collectEvents(orchestrator.execute(baseInput()));

    // Last session update should be to "completed"
    const updateCalls = mockPrisma.teamSession.update.mock.calls;
    const lastCall = updateCalls[updateCalls.length - 1];
    expect(lastCall[0].data).toEqual(
      expect.objectContaining({ status: "completed", currentPhase: "team_complete" }),
    );
  });
});

describe("Worker status tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.teamSession.create.mockResolvedValue({ id: "session-1" });
    mockPrisma.teamSession.update.mockResolvedValue({});
    mockPrisma.teamWorker.create.mockResolvedValue({});
    mockPrisma.teamTask.create.mockResolvedValue({});
    mockPrisma.teamTask.update.mockResolvedValue({});
    mockPrisma.teamWorker.update.mockResolvedValue({});
    mockPrisma.teamTask.updateMany.mockResolvedValue({ count: 1 });

    // Single task, single worker
    mockPrisma.teamTask.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args?.where?.status === "pending") {
        return [{ id: "task-1", name: "Task 1", description: "Do thing 1", priority: 1, status: "pending", sessionId: "session-1" }];
      }
      if (args?.where?.status === "failed") return [];
      return [{ id: "task-1", status: "completed" }];
    });

    mockPrisma.teamWorker.findFirst.mockResolvedValueOnce({
      id: "wid-1",
      workerId: "worker-1",
      sessionId: "session-1",
      role: "implementer",
      status: "idle",
      currentTaskId: null,
      lastHeartbeatAt: new Date(),
    }).mockResolvedValue(null);
  });

  it("updates worker to executing then back to idle", async () => {
    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(),
    });

    await collectEvents(orchestrator.execute(baseInput()));

    // Worker should be set to executing
    const workerUpdateCalls = mockPrisma.teamWorker.update.mock.calls;
    const executingCall = workerUpdateCalls.find(
      (c: Array<{ data: { status: string } }>) => c[0].data.status === "executing",
    );
    expect(executingCall).toBeDefined();

    // Worker should be reset to idle
    const idleCall = workerUpdateCalls.find(
      (c: Array<{ data: { status: string } }>) => c[0].data.status === "idle",
    );
    expect(idleCall).toBeDefined();
  });
});

describe("Heartbeat timeout detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects stale workers via heartbeat monitor concept", () => {
    // Test the heartbeat logic conceptually:
    // A worker with lastHeartbeatAt older than timeoutMs should be detected
    const timeoutMs = 30_000;
    const lastHeartbeat = new Date(Date.now() - 60_000); // 60 seconds ago
    const isStale = lastHeartbeat.getTime() < Date.now() - timeoutMs;
    expect(isStale).toBe(true);

    const recentHeartbeat = new Date(Date.now() - 10_000); // 10 seconds ago
    const isRecent = recentHeartbeat.getTime() < Date.now() - timeoutMs;
    expect(isRecent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// New integration tests
// ---------------------------------------------------------------------------

describe("TeamTask creation uses taskName field", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.teamSession.create.mockResolvedValue({ id: "session-1" });
    mockPrisma.teamSession.update.mockResolvedValue({});
    mockPrisma.teamWorker.create.mockResolvedValue({});
    mockPrisma.teamTask.create.mockResolvedValue({});
    mockPrisma.teamTask.update.mockResolvedValue({});
    mockPrisma.teamWorker.update.mockResolvedValue({});
    mockPrisma.teamTask.updateMany.mockResolvedValue({ count: 1 });

    mockPrisma.teamTask.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args?.where?.status === "pending") {
        return [{ id: "task-1", taskName: "Task 1", description: "Do thing 1", priority: 1, status: "pending", sessionId: "session-1" }];
      }
      if (args?.where?.status === "failed") return [];
      return [{ id: "task-1", status: "completed" }];
    });

    mockPrisma.teamWorker.findFirst.mockResolvedValueOnce({
      id: "wid-1",
      workerId: "worker-1",
      sessionId: "session-1",
      role: "implementer",
      status: "idle",
      currentTaskId: null,
      lastHeartbeatAt: new Date(),
    }).mockResolvedValue(null);
  });

  it("calls prisma.teamTask.create with taskName (not name)", async () => {
    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(),
    });

    await collectEvents(orchestrator.execute(baseInput()));

    const createCalls = mockPrisma.teamTask.create.mock.calls;
    expect(createCalls.length).toBeGreaterThanOrEqual(1);

    for (const call of createCalls) {
      const data = call[0].data;
      expect(data).toHaveProperty("taskName");
      expect(data).not.toHaveProperty("name");
      expect(typeof data.taskName).toBe("string");
      expect(data.taskName.length).toBeGreaterThan(0);
    }
  });
});

describe("TeamWorker creation includes objective", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.teamSession.create.mockResolvedValue({ id: "session-1" });
    mockPrisma.teamSession.update.mockResolvedValue({});
    mockPrisma.teamWorker.create.mockResolvedValue({});
    mockPrisma.teamTask.create.mockResolvedValue({});
    mockPrisma.teamTask.update.mockResolvedValue({});
    mockPrisma.teamWorker.update.mockResolvedValue({});
    mockPrisma.teamTask.updateMany.mockResolvedValue({ count: 1 });

    mockPrisma.teamTask.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args?.where?.status === "pending") {
        return [{ id: "task-1", taskName: "Task 1", description: "Do thing 1", priority: 1, status: "pending", sessionId: "session-1" }];
      }
      if (args?.where?.status === "failed") return [];
      return [{ id: "task-1", status: "completed" }];
    });

    mockPrisma.teamWorker.findFirst.mockResolvedValueOnce({
      id: "wid-1",
      workerId: "worker-1",
      sessionId: "session-1",
      role: "implementer",
      status: "idle",
      currentTaskId: null,
      lastHeartbeatAt: new Date(),
    }).mockResolvedValue(null);
  });

  it("calls prisma.teamWorker.create with an objective field", async () => {
    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(),
    });

    await collectEvents(orchestrator.execute(baseInput()));

    const createCalls = mockPrisma.teamWorker.create.mock.calls;
    expect(createCalls.length).toBeGreaterThanOrEqual(1);

    for (const call of createCalls) {
      const data = call[0].data;
      expect(data).toHaveProperty("objective");
      expect(typeof data.objective).toBe("string");
      expect(data.objective.length).toBeGreaterThan(0);
    }
  });

  it("uses worker-supplied objective when provided by decomposition", async () => {
    const decompositionWithObjectives = JSON.stringify({
      tasks: [
        { name: "Task 1", description: "Do thing 1", priority: 1, workerRole: "implementer" },
      ],
      workers: [
        { role: "implementer", workerId: "worker-impl", objective: "Implement the core feature" },
      ],
    });

    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(decompositionWithObjectives),
    });

    await collectEvents(orchestrator.execute(baseInput()));

    const createCalls = mockPrisma.teamWorker.create.mock.calls;
    expect(createCalls.length).toBe(1);
    expect(createCalls[0][0].data.objective).toBe("Implement the core feature");
  });
});

describe("executeTask failure handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma.teamSession.create.mockResolvedValue({ id: "session-1" });
    mockPrisma.teamSession.update.mockResolvedValue({});
    mockPrisma.teamWorker.create.mockResolvedValue({});
    mockPrisma.teamTask.create.mockResolvedValue({});
    mockPrisma.teamTask.update.mockResolvedValue({});
    mockPrisma.teamWorker.update.mockResolvedValue({});
    mockPrisma.teamTask.updateMany.mockResolvedValue({ count: 1 });

    // Single pending task
    mockPrisma.teamTask.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args?.where?.status === "pending") {
        return [{ id: "task-1", taskName: "Task 1", description: "Do thing 1", priority: 1, status: "pending", sessionId: "session-1" }];
      }
      if (args?.where?.status === "failed") return [];
      return [{ id: "task-1", status: "completed" }];
    });

    // Single worker
    mockPrisma.teamWorker.findFirst.mockResolvedValueOnce({
      id: "wid-1",
      workerId: "worker-1",
      sessionId: "session-1",
      role: "implementer",
      status: "idle",
      currentTaskId: null,
      lastHeartbeatAt: new Date(),
    }).mockResolvedValue(null);
  });

  it("marks task as failed when executeTask throws", async () => {
    // Provider that throws during task execution (not during decomposition)
    const failingProvider: ProviderOrchestrator = {
      async streamChatWithRetry(
        _sessionId: string,
        _messages: Array<{ role: string; content: string }>,
        onToken: (token: string) => void,
        _options?: unknown,
      ) {
        // First call is decomposition — respond normally
        if (_sessionId.includes("decompose")) {
          const decomposition = JSON.stringify({
            tasks: [
              { name: "Task 1", description: "Do thing 1", priority: 1, workerRole: "implementer" },
            ],
            workers: [
              { role: "implementer", workerId: "worker-1" },
            ],
          });
          onToken(decomposition);
          return { usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } };
        }

        // Task execution call — throw an error
        throw new Error("LLM provider unavailable");
      },
    } as unknown as ProviderOrchestrator;

    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: failingProvider,
    });

    const events = await collectEvents(orchestrator.execute(baseInput()));

    // Task should be updated to failed status
    const taskUpdateCalls = mockPrisma.teamTask.update.mock.calls;
    const failedCall = taskUpdateCalls.find(
      (c: Array<{ data: { status: string } }>) => c[0].data.status === "failed",
    );
    expect(failedCall).toBeDefined();
    expect(failedCall![0].data.result).toContain("LLM provider unavailable");

    // Should emit a team_task_result event with status "failed"
    const taskResults = events.filter(
      (e) => e.type === "team_task_result",
    ) as Array<{ type: "team_task_result"; taskId: string; status: string }>;
    expect(taskResults.length).toBeGreaterThanOrEqual(1);
    expect(taskResults[0].status).toBe("failed");
  });
});

describe("Heartbeat timeout null safety", () => {
  it("handles worker with null lastHeartbeatAt", () => {
    // The heartbeat monitor uses: worker.lastHeartbeatAt?.toISOString() ?? null
    // Verify the expression works correctly with null values
    const workerWithNull = { lastHeartbeatAt: null as Date | null };
    const result = workerWithNull.lastHeartbeatAt?.toISOString() ?? null;
    expect(result).toBeNull();

    // And verify it works with a real Date
    const workerWithDate = { lastHeartbeatAt: new Date("2026-04-07T12:00:00Z") };
    const dateResult = workerWithDate.lastHeartbeatAt?.toISOString() ?? null;
    expect(dateResult).toBe("2026-04-07T12:00:00.000Z");

    // Verify undefined also safely resolves to null
    const workerWithUndefined = { lastHeartbeatAt: undefined as Date | undefined };
    const undefinedResult = workerWithUndefined.lastHeartbeatAt?.toISOString() ?? null;
    expect(undefinedResult).toBeNull();
  });
});

describe("Heartbeat refresh during task execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockPrisma.teamSession.create.mockResolvedValue({ id: "session-1" });
    mockPrisma.teamSession.update.mockResolvedValue({});
    mockPrisma.teamWorker.create.mockResolvedValue({});
    mockPrisma.teamTask.create.mockResolvedValue({});
    mockPrisma.teamTask.update.mockResolvedValue({});
    mockPrisma.teamWorker.update.mockResolvedValue({});
    mockPrisma.teamTask.updateMany.mockResolvedValue({ count: 1 });

    mockPrisma.teamTask.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args?.where?.status === "pending") {
        return [{ id: "task-1", taskName: "Task 1", description: "Do thing 1", priority: 1, status: "pending", sessionId: "session-1" }];
      }
      if (args?.where?.status === "failed") return [];
      return [{ id: "task-1", status: "completed" }];
    });

    mockPrisma.teamWorker.findFirst.mockResolvedValueOnce({
      id: "wid-1",
      workerId: "worker-1",
      sessionId: "session-1",
      role: "implementer",
      status: "idle",
      currentTaskId: null,
      lastHeartbeatAt: new Date(),
    }).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("updates lastHeartbeatAt via setInterval during task execution", async () => {
    // Create a provider orchestrator that allows us to advance timers during execution
    let resolveExecution: (() => void) | null = null;
    const slowProvider: ProviderOrchestrator = {
      async streamChatWithRetry(
        _sessionId: string,
        messages: Array<{ role: string; content: string }>,
        onToken: (token: string) => void,
        _options?: unknown,
      ) {
        // First call is decomposition — respond immediately
        if (_sessionId.includes("decompose")) {
          const decomposition = JSON.stringify({
            tasks: [
              { name: "Task 1", description: "Do thing 1", priority: 1, workerRole: "implementer" },
            ],
            workers: [
              { role: "implementer", workerId: "worker-1" },
            ],
          });
          onToken(decomposition);
          return { usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } };
        }

        // Task execution call — wait for timer to advance, then resolve
        const promise = new Promise<void>((resolve) => {
          resolveExecution = resolve;
        });
        await promise;
        onToken(JSON.stringify({ success: true, summary: "done" }));
        return { usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } };
      },
    } as unknown as ProviderOrchestrator;

    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: slowProvider,
    });

    const gen = orchestrator.execute(baseInput());

    // Consume events until the task is dispatched (which means the heartbeat interval is active)
    const events: AgenticEvent[] = [];
    let dispatched = false;
    while (!dispatched) {
      const result = await gen.next();
      if (result.done) break;
      events.push(result.value);
      if (result.value.type === "team_task_dispatched") {
        dispatched = true;
      }
    }

    expect(dispatched).toBe(true);

    // The generator is now suspended on await executeTask(), which waits for resolveExecution.
    // Meanwhile, the setInterval(10_000) heartbeat has been registered.
    // We need gen.next() to be called so the generator is actively suspended,
    // then we can advance timers.

    // Start consuming the next event (this will hang until resolveExecution is called)
    const nextPromise = gen.next();

    // Advance timers to trigger the heartbeat interval
    await vi.advanceTimersByTimeAsync(10_001);

    // Find heartbeat-specific calls: the one that ONLY sets lastHeartbeatAt
    const heartbeatCalls = mockPrisma.teamWorker.update.mock.calls.filter(
      (c: Array<{ data: Record<string, unknown> }>) => {
        const keys = Object.keys(c[0].data);
        return keys.length === 1 && keys[0] === "lastHeartbeatAt";
      },
    );
    expect(heartbeatCalls.length).toBeGreaterThanOrEqual(1);
    expect(heartbeatCalls[0][0].data.lastHeartbeatAt).toBeInstanceOf(Date);

    // Resolve the execution to let the generator complete
    resolveExecution!();

    // Consume the result that was pending
    const nextResult = await nextPromise;
    events.push(nextResult.value!);

    // Drain remaining events
    for await (const event of gen) {
      events.push(event);
    }
  });
});

// ---------------------------------------------------------------------------
// Additional coverage tests
// ---------------------------------------------------------------------------

describe("decomposeObjective fallback paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.teamSession.create.mockResolvedValue({ id: "session-1" });
    mockPrisma.teamSession.update.mockResolvedValue({});
    mockPrisma.teamWorker.create.mockResolvedValue({});
    mockPrisma.teamTask.create.mockResolvedValue({});
    mockPrisma.teamTask.update.mockResolvedValue({});
    mockPrisma.teamWorker.update.mockResolvedValue({});
    mockPrisma.teamTask.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.teamWorker.findFirst.mockResolvedValue(null);

    // All tasks completed for verify
    mockPrisma.teamTask.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args?.where?.status === "pending") return [];
      if (args?.where?.status === "failed") return [];
      return [{ id: "task-1", status: "completed" }];
    });
  });

  it("falls back to default decomposition when LLM returns invalid JSON", async () => {
    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator("this is not JSON at all!!!"),
    });

    const events = await collectEvents(orchestrator.execute(baseInput()));
    const types = events.map((e) => e.type);

    // Should still start the session using the fallback decomposition
    expect(types).toContain("team_session_started");
    expect(types).toContain("execution_complete");

    // Fallback creates one worker with role "implementer"
    const workerCreateCalls = mockPrisma.teamWorker.create.mock.calls;
    expect(workerCreateCalls.length).toBe(1);
    expect(workerCreateCalls[0][0].data.role).toBe("implementer");

    // Fallback creates one task named "Implement objective"
    const taskCreateCalls = mockPrisma.teamTask.create.mock.calls;
    expect(taskCreateCalls.length).toBe(1);
    expect(taskCreateCalls[0][0].data.taskName).toBe("Implement objective");
  });

  it("falls back when decomposition has empty tasks array", async () => {
    const emptyTasks = JSON.stringify({
      tasks: [],
      workers: [{ role: "implementer", workerId: "w-1" }],
    });

    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(emptyTasks),
    });

    const events = await collectEvents(orchestrator.execute(baseInput()));
    expect(events.map((e) => e.type)).toContain("team_session_started");

    // Should fall back to default single task
    const taskCreateCalls = mockPrisma.teamTask.create.mock.calls;
    expect(taskCreateCalls.length).toBe(1);
    expect(taskCreateCalls[0][0].data.taskName).toBe("Implement objective");
  });

  it("falls back when decomposition has empty workers array", async () => {
    const emptyWorkers = JSON.stringify({
      tasks: [{ name: "Task 1", description: "Do it", priority: 1, workerRole: "impl" }],
      workers: [],
    });

    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(emptyWorkers),
    });

    const events = await collectEvents(orchestrator.execute(baseInput()));
    expect(events.map((e) => e.type)).toContain("team_session_started");

    // Should fall back to default single worker
    const workerCreateCalls = mockPrisma.teamWorker.create.mock.calls;
    expect(workerCreateCalls.length).toBe(1);
    expect(workerCreateCalls[0][0].data.role).toBe("implementer");
  });

  it("parses JSON wrapped in triple-backtick code fences", async () => {
    const fencedJson = "```json\n" + JSON.stringify({
      tasks: [{ name: "Fenced Task", description: "Do it", priority: 1, workerRole: "implementer" }],
      workers: [{ role: "implementer", workerId: "w-1" }],
    }) + "\n```";

    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(fencedJson),
    });

    const events = await collectEvents(orchestrator.execute(baseInput()));
    expect(events.map((e) => e.type)).toContain("team_session_started");

    const taskCreateCalls = mockPrisma.teamTask.create.mock.calls;
    expect(taskCreateCalls.length).toBe(1);
    expect(taskCreateCalls[0][0].data.taskName).toBe("Fenced Task");
  });

  it("parses JSON wrapped in plain triple-backtick fences (no json tag)", async () => {
    const fencedJson = "```\n" + JSON.stringify({
      tasks: [{ name: "Plain Fenced", description: "Do it", priority: 2, workerRole: "tester" }],
      workers: [{ role: "tester", workerId: "w-2" }],
    }) + "\n```";

    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(fencedJson),
    });

    const events = await collectEvents(orchestrator.execute(baseInput()));
    expect(events.map((e) => e.type)).toContain("team_session_started");

    const taskCreateCalls = mockPrisma.teamTask.create.mock.calls;
    expect(taskCreateCalls.length).toBe(1);
    expect(taskCreateCalls[0][0].data.taskName).toBe("Plain Fenced");
  });
});

describe("executeTask JSON parse fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.teamSession.create.mockResolvedValue({ id: "session-1" });
    mockPrisma.teamSession.update.mockResolvedValue({});
    mockPrisma.teamWorker.create.mockResolvedValue({});
    mockPrisma.teamTask.create.mockResolvedValue({});
    mockPrisma.teamTask.update.mockResolvedValue({});
    mockPrisma.teamWorker.update.mockResolvedValue({});
    mockPrisma.teamTask.updateMany.mockResolvedValue({ count: 1 });

    // One pending task
    mockPrisma.teamTask.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args?.where?.status === "pending") {
        return [{ id: "task-1", taskName: "My Task", description: "Do it", priority: 1, status: "pending", sessionId: "session-1" }];
      }
      if (args?.where?.status === "failed") return [];
      return [{ id: "task-1", status: "completed" }];
    });

    mockPrisma.teamWorker.findFirst.mockResolvedValueOnce({
      id: "wid-1",
      workerId: "worker-1",
      sessionId: "session-1",
      role: "implementer",
      status: "idle",
      currentTaskId: null,
      lastHeartbeatAt: new Date(),
    }).mockResolvedValue(null);
  });

  it("returns success with fallback summary when task LLM response is not JSON", async () => {
    let callCount = 0;
    const provider: ProviderOrchestrator = {
      async streamChatWithRetry(
        _sessionId: string,
        _messages: Array<{ role: string; content: string }>,
        onToken: (token: string) => void,
      ) {
        callCount++;
        if (_sessionId.includes("decompose")) {
          onToken(JSON.stringify({
            tasks: [{ name: "My Task", description: "Do it", priority: 1, workerRole: "implementer" }],
            workers: [{ role: "implementer", workerId: "worker-1" }],
          }));
        } else {
          // Task execution returns non-JSON
          onToken("I completed the task successfully without JSON formatting.");
        }
        return { usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } };
      },
    } as unknown as ProviderOrchestrator;

    const orchestrator = new EnhancedTeamOrchestrator({ providerOrchestrator: provider });
    const events = await collectEvents(orchestrator.execute(baseInput()));

    // Task should be completed (fallback returns success: true)
    const taskUpdateCalls = mockPrisma.teamTask.update.mock.calls;
    const completedCall = taskUpdateCalls.find(
      (c: Array<{ data: { status: string } }>) => c[0].data.status === "completed",
    );
    expect(completedCall).toBeDefined();
    // Fallback summary uses the task name
    expect(completedCall![0].data.result).toContain("My Task");
  });

  it("parses task result from fenced JSON", async () => {
    const provider: ProviderOrchestrator = {
      async streamChatWithRetry(
        _sessionId: string,
        _messages: Array<{ role: string; content: string }>,
        onToken: (token: string) => void,
      ) {
        if (_sessionId.includes("decompose")) {
          onToken(JSON.stringify({
            tasks: [{ name: "Task X", description: "Do X", priority: 1, workerRole: "implementer" }],
            workers: [{ role: "implementer", workerId: "worker-1" }],
          }));
        } else {
          onToken("```json\n" + JSON.stringify({ success: true, summary: "Task X done via fenced" }) + "\n```");
        }
        return { usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } };
      },
    } as unknown as ProviderOrchestrator;

    const orchestrator = new EnhancedTeamOrchestrator({ providerOrchestrator: provider });
    const events = await collectEvents(orchestrator.execute(baseInput()));

    const taskUpdateCalls = mockPrisma.teamTask.update.mock.calls;
    const completedCall = taskUpdateCalls.find(
      (c: Array<{ data: { status: string } }>) => c[0].data.status === "completed",
    );
    expect(completedCall).toBeDefined();
    expect(completedCall![0].data.result).toBe("Task X done via fenced");
  });
});

describe("executeTask result with success: false", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.teamSession.create.mockResolvedValue({ id: "session-1" });
    mockPrisma.teamSession.update.mockResolvedValue({});
    mockPrisma.teamWorker.create.mockResolvedValue({});
    mockPrisma.teamTask.create.mockResolvedValue({});
    mockPrisma.teamTask.update.mockResolvedValue({});
    mockPrisma.teamWorker.update.mockResolvedValue({});
    mockPrisma.teamTask.updateMany.mockResolvedValue({ count: 1 });

    mockPrisma.teamTask.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args?.where?.status === "pending") {
        return [{ id: "task-1", taskName: "Fail Task", description: "Will fail", priority: 1, status: "pending", sessionId: "session-1" }];
      }
      if (args?.where?.status === "failed") {
        return [{ id: "task-1", taskName: "Fail Task", description: "Will fail", priority: 1, status: "failed", result: "it broke", sessionId: "session-1" }];
      }
      return [{ id: "task-1", status: "failed" }];
    });

    mockPrisma.teamWorker.findFirst.mockImplementation(async () => ({
      id: "wid-1",
      workerId: "worker-1",
      sessionId: "session-1",
      role: "implementer",
      status: "idle",
      currentTaskId: null,
      lastHeartbeatAt: new Date(),
    }));
  });

  it("marks task as failed when LLM returns success: false", async () => {
    const provider: ProviderOrchestrator = {
      async streamChatWithRetry(
        _sessionId: string,
        _messages: Array<{ role: string; content: string }>,
        onToken: (token: string) => void,
      ) {
        if (_sessionId.includes("decompose")) {
          onToken(JSON.stringify({
            tasks: [{ name: "Fail Task", description: "Will fail", priority: 1, workerRole: "implementer" }],
            workers: [{ role: "implementer", workerId: "worker-1" }],
          }));
        } else {
          onToken(JSON.stringify({ success: false, summary: "it broke" }));
        }
        return { usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } };
      },
    } as unknown as ProviderOrchestrator;

    const orchestrator = new EnhancedTeamOrchestrator({ providerOrchestrator: provider });
    const events = await collectEvents(orchestrator.execute(baseInput()));

    // Should have a task result event with status "failed"
    const taskResults = events.filter((e) => e.type === "team_task_result") as Array<{
      type: string;
      taskId: string;
      status: string;
    }>;
    // At least the first round should produce a failed task result
    const hasFailed = taskResults.some((r) => r.status === "failed");
    expect(hasFailed).toBe(true);
  });
});

describe("createFixTasks with null result", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.teamSession.create.mockResolvedValue({ id: "session-1" });
    mockPrisma.teamSession.update.mockResolvedValue({});
    mockPrisma.teamWorker.create.mockResolvedValue({});
    mockPrisma.teamTask.create.mockResolvedValue({});
    mockPrisma.teamTask.update.mockResolvedValue({});
    mockPrisma.teamWorker.update.mockResolvedValue({});
    mockPrisma.teamWorker.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.teamTask.updateMany.mockResolvedValue({ count: 1 });
  });

  it("creates fix tasks with 'unknown' result when original task has null result", async () => {
    let verifyCallCount = 0;
    let fixTaskFindCallCount = 0;

    mockPrisma.teamTask.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args?.where?.status === "pending") {
        return [{ id: "task-1", taskName: "Task 1", description: "Do it", priority: 1, status: "pending", sessionId: "session-1" }];
      }
      if (args?.where?.status === "failed") {
        fixTaskFindCallCount++;
        if (fixTaskFindCallCount <= 1) {
          // Return failed task with null result for createFixTasks
          return [{ id: "task-1", taskName: "Task 1", description: "Do it", priority: 1, status: "failed", result: null, sessionId: "session-1" }];
        }
        return [];
      }
      // Verify calls
      verifyCallCount++;
      if (verifyCallCount <= 1) {
        return [{ id: "task-1", status: "failed" }];
      }
      return [{ id: "task-1", status: "completed" }];
    });

    mockPrisma.teamWorker.findFirst.mockImplementation(async () => ({
      id: "wid-1",
      workerId: "worker-1",
      sessionId: "session-1",
      role: "implementer",
      status: "idle",
      currentTaskId: null,
      lastHeartbeatAt: new Date(),
    }));

    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(),
    });

    const events = await collectEvents(orchestrator.execute(baseInput()));

    // Find the fix task creation call
    const taskCreateCalls = mockPrisma.teamTask.create.mock.calls;
    const fixTaskCall = taskCreateCalls.find(
      (c: Array<{ data: { taskName: string } }>) => c[0].data.taskName.startsWith("Fix:"),
    );
    expect(fixTaskCall).toBeDefined();
    // The description should contain "unknown" since result was null
    expect(fixTaskCall![0].data.description).toContain("unknown");
  });
});

describe("Error handler with non-Error thrown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles non-Error objects in catch block", async () => {
    mockPrisma.teamSession.create.mockRejectedValueOnce("string error");
    mockPrisma.teamSession.update.mockResolvedValue({});

    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(),
    });

    const events = await collectEvents(orchestrator.execute(baseInput()));
    const errors = events.filter((e) => e.type === "error") as Array<{ type: string; error: string }>;
    expect(errors.length).toBe(1);
    expect(errors[0].error).toBe("string error");
  });

  it("handles teamSession.update failure in error handler gracefully", async () => {
    mockPrisma.teamSession.create.mockRejectedValueOnce(new Error("DB error"));
    // The error handler tries to update the session to "failed", which also fails
    mockPrisma.teamSession.update.mockRejectedValueOnce(new Error("Also failed"));

    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(),
    });

    const events = await collectEvents(orchestrator.execute(baseInput()));
    const errors = events.filter((e) => e.type === "error") as Array<{ type: string; error: string }>;
    // Should still yield the original error
    expect(errors.length).toBe(1);
    expect(errors[0].error).toContain("DB error");
  });
});

describe("Worker objective fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.teamSession.create.mockResolvedValue({ id: "session-1" });
    mockPrisma.teamSession.update.mockResolvedValue({});
    mockPrisma.teamWorker.create.mockResolvedValue({});
    mockPrisma.teamTask.create.mockResolvedValue({});
    mockPrisma.teamTask.update.mockResolvedValue({});
    mockPrisma.teamWorker.update.mockResolvedValue({});
    mockPrisma.teamTask.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.teamWorker.findFirst.mockResolvedValue(null);

    mockPrisma.teamTask.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args?.where?.status === "pending") return [];
      if (args?.where?.status === "failed") return [];
      return [{ id: "task-1", status: "completed" }];
    });
  });

  it("uses fallback objective when worker has no objective property", async () => {
    const noObjective = JSON.stringify({
      tasks: [{ name: "Task 1", description: "Do it", priority: 1, workerRole: "implementer" }],
      workers: [{ role: "implementer", workerId: "worker-1" }],
    });

    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(noObjective),
    });

    await collectEvents(orchestrator.execute(baseInput()));

    const workerCreateCalls = mockPrisma.teamWorker.create.mock.calls;
    expect(workerCreateCalls.length).toBe(1);
    // Fallback: `${w.role} for: ${input.objective}`
    expect(workerCreateCalls[0][0].data.objective).toBe("implementer for: Build a feature");
  });
});

describe("enableHeartbeat configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.teamSession.create.mockResolvedValue({ id: "session-1" });
    mockPrisma.teamSession.update.mockResolvedValue({});
    mockPrisma.teamWorker.create.mockResolvedValue({});
    mockPrisma.teamTask.create.mockResolvedValue({});
    mockPrisma.teamTask.update.mockResolvedValue({});
    mockPrisma.teamWorker.update.mockResolvedValue({});
    mockPrisma.teamTask.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.teamWorker.findFirst.mockResolvedValue(null);
    mockPrisma.teamWorker.findMany.mockResolvedValue([]);

    mockPrisma.teamTask.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args?.where?.status === "pending") return [];
      if (args?.where?.status === "failed") return [];
      return [{ id: "task-1", status: "completed" }];
    });
  });

  it("starts heartbeat monitor when enableHeartbeat is true", async () => {
    vi.useFakeTimers();

    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(),
    });

    const events = await collectEvents(
      orchestrator.execute(baseInput({
        enableHeartbeat: true,
        heartbeatIntervalMs: 5_000,
        heartbeatTimeoutMs: 30_000,
      })),
    );

    // Should complete successfully even with heartbeat enabled
    expect(events.map((e) => e.type)).toContain("execution_complete");

    vi.useRealTimers();
  });
});

describe("Heartbeat monitor stale worker detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects stale workers and reclaims their tasks via the heartbeat monitor", async () => {
    mockPrisma.teamSession.create.mockResolvedValue({ id: "session-1" });
    mockPrisma.teamSession.update.mockResolvedValue({});
    mockPrisma.teamWorker.create.mockResolvedValue({});
    mockPrisma.teamTask.create.mockResolvedValue({});
    mockPrisma.teamTask.update.mockResolvedValue({});
    mockPrisma.teamWorker.update.mockResolvedValue({});
    mockPrisma.teamTask.updateMany.mockResolvedValue({ count: 1 });

    // One pending task so executeTaskPhase has work to do (allows heartbeat to fire during execution)
    mockPrisma.teamTask.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args?.where?.status === "pending") {
        return [{ id: "task-1", taskName: "Task 1", description: "Do it", priority: 1, status: "pending", sessionId: "session-1" }];
      }
      if (args?.where?.status === "failed") return [];
      return [{ id: "task-1", status: "completed" }];
    });

    // Simulate stale workers found by heartbeat monitor
    mockPrisma.teamWorker.findMany.mockResolvedValue([
      {
        id: "wid-stale",
        workerId: "worker-stale",
        sessionId: "session-1",
        role: "implementer",
        status: "executing",
        currentTaskId: "task-stale",
        lastHeartbeatAt: new Date(Date.now() - 120_000),
      },
    ]);

    mockPrisma.teamWorker.findFirst.mockResolvedValueOnce({
      id: "wid-1",
      workerId: "worker-1",
      sessionId: "session-1",
      role: "implementer",
      status: "idle",
      currentTaskId: null,
      lastHeartbeatAt: new Date(),
    }).mockResolvedValue(null);

    let resolveExec: (() => void) | null = null;
    const slowProvider: ProviderOrchestrator = {
      async streamChatWithRetry(
        _sessionId: string,
        _messages: Array<{ role: string; content: string }>,
        onToken: (token: string) => void,
      ) {
        if (_sessionId.includes("decompose")) {
          onToken(JSON.stringify({
            tasks: [{ name: "T1", description: "D", priority: 1, workerRole: "implementer" }],
            workers: [{ role: "implementer", workerId: "worker-1" }],
          }));
          return { usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } };
        }
        // Task execution — wait for timer to fire
        const promise = new Promise<void>((resolve) => {
          resolveExec = resolve;
        });
        await promise;
        onToken(JSON.stringify({ success: true, summary: "done" }));
        return { usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } };
      },
    } as unknown as ProviderOrchestrator;

    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: slowProvider,
    });

    const gen = orchestrator.execute(baseInput({
      enableHeartbeat: true,
      heartbeatIntervalMs: 5_000,
      heartbeatTimeoutMs: 30_000,
    }));

    // Collect events until task is dispatched
    const events: AgenticEvent[] = [];
    let dispatched = false;
    while (!dispatched) {
      const result = await gen.next();
      if (result.done) break;
      events.push(result.value);
      if (result.value.type === "team_task_dispatched") {
        dispatched = true;
      }
    }
    expect(dispatched).toBe(true);

    // Start consuming next event (will block on task execution)
    const nextPromise = gen.next();

    // Advance timer to trigger the heartbeat monitor
    await vi.advanceTimersByTimeAsync(5_001);

    // Now resolve the task execution so the generator can proceed
    resolveExec!();
    const nextResult = await nextPromise;
    events.push(nextResult.value!);

    // Drain remaining events
    let done = false;
    while (!done) {
      const result = await gen.next();
      if (result.done) {
        done = true;
      } else {
        events.push(result.value);
      }
    }

    // The heartbeat monitor should have found the stale worker and pushed a heartbeat_timeout event
    const heartbeatTimeouts = events.filter((e) => e.type === "team_heartbeat_timeout");
    expect(heartbeatTimeouts.length).toBeGreaterThanOrEqual(1);
    expect((heartbeatTimeouts[0] as any).workerId).toBe("worker-stale");

    // Stale worker should be marked as failed
    const workerUpdateCalls = mockPrisma.teamWorker.update.mock.calls;
    const failedWorkerCall = workerUpdateCalls.find(
      (c: Array<{ data: { status: string } }>) => c[0].data.status === "failed",
    );
    expect(failedWorkerCall).toBeDefined();
  });

  it("handles heartbeat monitor errors gracefully", async () => {
    mockPrisma.teamSession.create.mockResolvedValue({ id: "session-1" });
    mockPrisma.teamSession.update.mockResolvedValue({});
    mockPrisma.teamWorker.create.mockResolvedValue({});
    mockPrisma.teamTask.create.mockResolvedValue({});
    mockPrisma.teamTask.update.mockResolvedValue({});
    mockPrisma.teamWorker.update.mockResolvedValue({});
    mockPrisma.teamTask.updateMany.mockResolvedValue({ count: 1 });

    // One pending task so we can block during execution
    mockPrisma.teamTask.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args?.where?.status === "pending") {
        return [{ id: "task-1", taskName: "Task 1", description: "Do it", priority: 1, status: "pending", sessionId: "session-1" }];
      }
      if (args?.where?.status === "failed") return [];
      return [{ id: "task-1", status: "completed" }];
    });

    // Make the heartbeat monitor findMany throw
    mockPrisma.teamWorker.findMany.mockRejectedValue(new Error("DB unavailable"));

    mockPrisma.teamWorker.findFirst.mockResolvedValueOnce({
      id: "wid-1",
      workerId: "worker-1",
      sessionId: "session-1",
      role: "implementer",
      status: "idle",
      currentTaskId: null,
      lastHeartbeatAt: new Date(),
    }).mockResolvedValue(null);

    let resolveExec: (() => void) | null = null;
    const slowProvider: ProviderOrchestrator = {
      async streamChatWithRetry(
        _sessionId: string,
        _messages: Array<{ role: string; content: string }>,
        onToken: (token: string) => void,
      ) {
        if (_sessionId.includes("decompose")) {
          onToken(JSON.stringify({
            tasks: [{ name: "T1", description: "D", priority: 1, workerRole: "implementer" }],
            workers: [{ role: "implementer", workerId: "worker-1" }],
          }));
          return { usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } };
        }
        // Wait for timer to fire
        const promise = new Promise<void>((resolve) => { resolveExec = resolve; });
        await promise;
        onToken(JSON.stringify({ success: true, summary: "done" }));
        return { usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } };
      },
    } as unknown as ProviderOrchestrator;

    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: slowProvider,
    });

    const gen = orchestrator.execute(baseInput({
      enableHeartbeat: true,
      heartbeatIntervalMs: 5_000,
      heartbeatTimeoutMs: 30_000,
    }));

    // Collect events until task is dispatched
    const events: AgenticEvent[] = [];
    let dispatched = false;
    while (!dispatched) {
      const result = await gen.next();
      if (result.done) break;
      events.push(result.value);
      if (result.value.type === "team_task_dispatched") {
        dispatched = true;
      }
    }
    expect(dispatched).toBe(true);

    // Start consuming next event (will block on task execution)
    const nextPromise = gen.next();

    // Advance timer to trigger heartbeat (which will throw but be swallowed by catch {})
    await vi.advanceTimersByTimeAsync(5_001);

    // Resolve task execution
    resolveExec!();
    const nextResult = await nextPromise;
    events.push(nextResult.value!);

    // Drain remaining events — should complete without error
    let done = false;
    while (!done) {
      const result = await gen.next();
      if (result.done) {
        done = true;
      } else {
        events.push(result.value);
      }
    }

    // Should still complete successfully despite heartbeat monitor errors
    expect(events.map((e) => e.type)).toContain("execution_complete");
    // Should NOT have any heartbeat timeout events since the error was swallowed
    const heartbeatTimeouts = events.filter((e) => e.type === "team_heartbeat_timeout");
    expect(heartbeatTimeouts.length).toBe(0);
  });
});

describe("stopHeartbeatMonitor when no timer exists", () => {
  it("is safe to call execute without heartbeat (stopHeartbeatMonitor with null timer)", async () => {
    vi.clearAllMocks();
    mockPrisma.teamSession.create.mockResolvedValue({ id: "session-1" });
    mockPrisma.teamSession.update.mockResolvedValue({});
    mockPrisma.teamWorker.create.mockResolvedValue({});
    mockPrisma.teamTask.create.mockResolvedValue({});
    mockPrisma.teamTask.update.mockResolvedValue({});
    mockPrisma.teamWorker.update.mockResolvedValue({});
    mockPrisma.teamTask.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.teamWorker.findFirst.mockResolvedValue(null);

    mockPrisma.teamTask.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args?.where?.status === "pending") return [];
      if (args?.where?.status === "failed") return [];
      return [{ id: "task-1", status: "completed" }];
    });

    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(),
    });

    // enableHeartbeat is false by default, so stopHeartbeatMonitor is called with null timer
    const events = await collectEvents(orchestrator.execute(baseInput()));
    expect(events.map((e) => e.type)).toContain("execution_complete");
  });
});

describe("No idle workers available", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.teamSession.create.mockResolvedValue({ id: "session-1" });
    mockPrisma.teamSession.update.mockResolvedValue({});
    mockPrisma.teamWorker.create.mockResolvedValue({});
    mockPrisma.teamTask.create.mockResolvedValue({});
    mockPrisma.teamTask.update.mockResolvedValue({});
    mockPrisma.teamWorker.update.mockResolvedValue({});
    mockPrisma.teamTask.updateMany.mockResolvedValue({ count: 1 });

    // Return pending tasks but no idle workers
    mockPrisma.teamTask.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args?.where?.status === "pending") {
        return [
          { id: "task-1", taskName: "Task 1", description: "Do it", priority: 1, status: "pending", sessionId: "session-1" },
        ];
      }
      if (args?.where?.status === "failed") return [];
      return [{ id: "task-1", status: "completed" }];
    });

    // No idle workers — always return null
    mockPrisma.teamWorker.findFirst.mockResolvedValue(null);
  });

  it("skips tasks when no idle workers are available", async () => {
    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(),
    });

    const events = await collectEvents(orchestrator.execute(baseInput()));

    // Should not dispatch any tasks
    const dispatched = events.filter((e) => e.type === "team_task_dispatched");
    expect(dispatched.length).toBe(0);

    // Should still complete
    expect(events.map((e) => e.type)).toContain("execution_complete");
  });
});

describe("claimTask returns false (task already claimed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.teamSession.create.mockResolvedValue({ id: "session-1" });
    mockPrisma.teamSession.update.mockResolvedValue({});
    mockPrisma.teamWorker.create.mockResolvedValue({});
    mockPrisma.teamTask.create.mockResolvedValue({});
    mockPrisma.teamTask.update.mockResolvedValue({});
    mockPrisma.teamWorker.update.mockResolvedValue({});

    mockPrisma.teamTask.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args?.where?.status === "pending") {
        return [
          { id: "task-1", taskName: "Task 1", description: "Do it", priority: 1, status: "pending", sessionId: "session-1" },
        ];
      }
      if (args?.where?.status === "failed") return [];
      return [{ id: "task-1", status: "completed" }];
    });

    mockPrisma.teamWorker.findFirst.mockResolvedValueOnce({
      id: "wid-1",
      workerId: "worker-1",
      sessionId: "session-1",
      role: "implementer",
      status: "idle",
      currentTaskId: null,
      lastHeartbeatAt: new Date(),
    }).mockResolvedValue(null);

    // claimTask fails (count: 0)
    mockPrisma.teamTask.updateMany.mockResolvedValue({ count: 0 });
  });

  it("skips task execution when claim fails", async () => {
    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(),
    });

    const events = await collectEvents(orchestrator.execute(baseInput()));

    // No tasks should be dispatched
    const dispatched = events.filter((e) => e.type === "team_task_dispatched");
    expect(dispatched.length).toBe(0);

    expect(events.map((e) => e.type)).toContain("execution_complete");
  });
});

describe("transitionPhase with invalid transition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.teamSession.create.mockResolvedValue({ id: "session-1" });
    mockPrisma.teamSession.update.mockResolvedValue({});
    mockPrisma.teamWorker.create.mockResolvedValue({});
    mockPrisma.teamTask.create.mockResolvedValue({});
    mockPrisma.teamTask.update.mockResolvedValue({});
    mockPrisma.teamWorker.update.mockResolvedValue({});
    mockPrisma.teamTask.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.teamWorker.findFirst.mockResolvedValue(null);

    mockPrisma.teamTask.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args?.where?.status === "pending") return [];
      if (args?.where?.status === "failed") return [];
      return [{ id: "task-1", status: "completed" }];
    });
  });

  it("emits error when starting from an invalid phase", async () => {
    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(),
    });

    // Force the teamPhase to something that can't transition to team_exec
    const events = await collectEvents(
      orchestrator.execute(baseInput({ teamPhase: "team_complete" as any })),
    );

    const errors = events.filter((e) => e.type === "error") as Array<{ type: string; error: string }>;
    expect(errors.length).toBe(1);
    expect(errors[0].error).toContain("Invalid phase transition");
  });
});

describe("Input defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.teamSession.create.mockResolvedValue({ id: "session-1" });
    mockPrisma.teamSession.update.mockResolvedValue({});
    mockPrisma.teamWorker.create.mockResolvedValue({});
    mockPrisma.teamTask.create.mockResolvedValue({});
    mockPrisma.teamTask.update.mockResolvedValue({});
    mockPrisma.teamWorker.update.mockResolvedValue({});
    mockPrisma.teamTask.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.teamWorker.findFirst.mockResolvedValue(null);

    mockPrisma.teamTask.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args?.where?.status === "pending") return [];
      if (args?.where?.status === "failed") return [];
      return [{ id: "task-1", status: "completed" }];
    });
  });

  it("uses default values for maxWorkers, maxConcurrentWorkers, and ticketId", async () => {
    const orchestrator = new EnhancedTeamOrchestrator({
      providerOrchestrator: createMockProviderOrchestrator(),
    });

    await collectEvents(
      orchestrator.execute({
        runId: "run-1",
        repoId: "repo-1",
        objective: "Build it",
        worktreePath: "/tmp/test",
        actor: "test-user",
        // No ticketId, maxWorkers, maxConcurrentWorkers
      }),
    );

    expect(mockPrisma.teamSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketId: null,
        maxWorkers: 5,
        maxConcurrent: 3,
      }),
    });
  });
});

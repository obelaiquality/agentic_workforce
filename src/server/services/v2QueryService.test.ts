import { describe, expect, it, vi, beforeEach } from "vitest";
import { V2QueryService } from "./v2QueryService";

// ── Mock dependencies ──────────────────────────────────────────────────────

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    taskProjection: {
      findMany: vi.fn(),
    },
    eventLog: {
      findMany: vi.fn(),
    },
    approvalProjection: {
      findMany: vi.fn(),
    },
    knowledgeIndexMetadata: {
      findMany: vi.fn(),
    },
    commandLog: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../db", () => ({
  prisma: mockPrisma,
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSidecar() {
  return {
    replay: vi.fn(),
  };
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    ticketId: "ticket-1",
    title: "Fix bug",
    description: "Fix a bug in auth",
    status: "in_progress",
    priority: "medium",
    risk: "low",
    assigneeAgentId: "agent-1",
    lastTransitionAt: new Date("2026-03-20T10:00:00Z"),
    updatedAt: new Date("2026-03-20T10:00:00Z"),
    reservation: null,
    ...overrides,
  };
}

function makeReservation(overrides: Record<string, unknown> = {}) {
  return {
    reservedBy: "agent-1",
    reservedAt: new Date("2026-03-20T08:00:00Z"),
    expiresAt: new Date(Date.now() + 3600_000),
    ...overrides,
  };
}

let sidecar: ReturnType<typeof makeSidecar>;
let service: V2QueryService;

beforeEach(() => {
  vi.clearAllMocks();
  sidecar = makeSidecar();
  service = new V2QueryService(sidecar as any);
});

// ── getTaskBoard ───────────────────────────────────────────────────────────

describe("getTaskBoard", () => {
  it("groups tasks by lifecycle status correctly", async () => {
    mockPrisma.taskProjection.findMany.mockResolvedValue([
      makeTask({ ticketId: "t-1", status: "in_progress" }),
      makeTask({ ticketId: "t-2", status: "blocked" }),
      makeTask({ ticketId: "t-3", status: "completed" }),
      makeTask({ ticketId: "t-4", status: "in_progress" }),
    ]);

    const board = await service.getTaskBoard();

    expect(board.columns.in_progress).toHaveLength(2);
    expect(board.columns.blocked).toHaveLength(1);
    expect(board.columns.completed).toHaveLength(1);
    expect(board.columns.inactive).toHaveLength(0);
    expect(board.total_tasks).toBe(4);
    expect(board.ordered_statuses).toEqual([
      "inactive",
      "reserved",
      "active",
      "in_progress",
      "blocked",
      "completed",
    ]);
  });

  it("detects stale reservations (TTL expired)", async () => {
    const expiredReservation = makeReservation({
      expiresAt: new Date(Date.now() - 1000),
    });
    mockPrisma.taskProjection.findMany.mockResolvedValue([
      makeTask({ ticketId: "t-1", status: "reserved", reservation: expiredReservation }),
      makeTask({ ticketId: "t-2", status: "reserved", reservation: makeReservation() }),
    ]);

    const board = await service.getTaskBoard();

    expect(board.stale_reservations).toBe(1);
    const staleTask = board.columns.reserved.find((t: any) => t.ticket_id === "t-1");
    expect(staleTask?.reservation?.stale).toBe(true);
  });

  it("includes reservation metadata in task entries", async () => {
    const reservation = makeReservation();
    mockPrisma.taskProjection.findMany.mockResolvedValue([
      makeTask({ ticketId: "t-1", status: "reserved", reservation }),
    ]);

    const board = await service.getTaskBoard();

    const task = board.columns.reserved[0];
    expect(task.reservation).toBeTruthy();
    expect(task.reservation!.reserved_by).toBe("agent-1");
    expect(task.reservation!.reserved_at).toBeTruthy();
    expect(task.reservation!.expires_at).toBeTruthy();
  });

  it("counts stale reservations separately", async () => {
    const expiredRes = makeReservation({ expiresAt: new Date(Date.now() - 60_000) });
    const validRes = makeReservation({ expiresAt: new Date(Date.now() + 60_000) });

    mockPrisma.taskProjection.findMany.mockResolvedValue([
      makeTask({ ticketId: "t-1", status: "reserved", reservation: expiredRes }),
      makeTask({ ticketId: "t-2", status: "reserved", reservation: expiredRes }),
      makeTask({ ticketId: "t-3", status: "reserved", reservation: validRes }),
    ]);

    const board = await service.getTaskBoard();

    expect(board.stale_reservations).toBe(2);
    expect(board.columns.reserved).toHaveLength(3);
  });
});

// ── getTaskTimeline ────────────────────────────────────────────────────────

describe("getTaskTimeline", () => {
  it("returns events ordered by timestamp", async () => {
    const events = [
      {
        eventId: "e-1",
        aggregateId: "ticket-1",
        causationId: "c-1",
        correlationId: "cor-1",
        actor: "agent-1",
        createdAt: new Date("2026-03-20T10:00:00Z"),
        eventType: "task.transition",
        payload: {},
        schemaVersion: 1,
      },
      {
        eventId: "e-2",
        aggregateId: "ticket-1",
        causationId: "c-2",
        correlationId: "cor-2",
        actor: "agent-1",
        createdAt: new Date("2026-03-20T09:00:00Z"),
        eventType: "task.reserve",
        payload: {},
        schemaVersion: 1,
      },
    ];
    mockPrisma.eventLog.findMany.mockResolvedValue(events);

    const timeline = await service.getTaskTimeline("ticket-1");

    expect(timeline).toHaveLength(2);
    expect(timeline[0].event_id).toBe("e-1");
    expect(timeline[0].type).toBe("task.transition");
    expect(timeline[0].timestamp).toBe("2026-03-20T10:00:00.000Z");
  });

  it("respects limit parameter", async () => {
    mockPrisma.eventLog.findMany.mockResolvedValue([]);

    await service.getTaskTimeline("ticket-1", 50);

    expect(mockPrisma.eventLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });

  it("returns empty for unknown task", async () => {
    mockPrisma.eventLog.findMany.mockResolvedValue([]);

    const timeline = await service.getTaskTimeline("nonexistent");

    expect(timeline).toHaveLength(0);
  });
});

// ── getRunReplay ───────────────────────────────────────────────────────────

describe("getRunReplay", () => {
  it("delegates to sidecar correctly", async () => {
    const events = [
      { event_id: "e-1", aggregate_id: "run-1", type: "execution.started", timestamp: "2026-03-20T10:00:00Z" },
      { event_id: "e-2", aggregate_id: "run-1", type: "execution.completed", timestamp: "2026-03-20T10:05:00Z" },
    ];
    sidecar.replay.mockResolvedValue(events);

    const result = await service.getRunReplay("run-1");

    expect(sidecar.replay).toHaveBeenCalledWith({
      aggregate_id: "run-1",
      limit: 1000,
    });
    expect(result).toEqual(events);
  });

  it("respects custom limit", async () => {
    sidecar.replay.mockResolvedValue([]);

    await service.getRunReplay("run-1", 500);

    expect(sidecar.replay).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 500 }),
    );
  });
});

// ── getPendingPolicy ───────────────────────────────────────────────────────

describe("getPendingPolicy", () => {
  it("returns only pending approval projections", async () => {
    const pending = [
      {
        approvalId: "apr-1",
        actionType: "run_command",
        status: "pending",
        reason: "High risk",
        payload: { run_id: "run-1" },
        requestedAt: new Date("2026-03-20T10:00:00Z"),
        decidedAt: null,
      },
    ];
    mockPrisma.approvalProjection.findMany.mockResolvedValue(pending);

    const result = await service.getPendingPolicy();

    expect(result).toHaveLength(1);
    expect(result[0].approval_id).toBe("apr-1");
    expect(result[0].status).toBe("pending");
    expect(result[0].decided_at).toBeNull();
  });

  it("excludes decided approvals via query filter", async () => {
    mockPrisma.approvalProjection.findMany.mockResolvedValue([]);

    await service.getPendingPolicy();

    expect(mockPrisma.approvalProjection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "pending" },
      }),
    );
  });
});

// ── searchKnowledge ────────────────────────────────────────────────────────

describe("searchKnowledge", () => {
  it("ranks results by score and recency", async () => {
    const rows = [
      { id: "k-1", source: "file", path: "src/auth.ts", snippet: "auth logic", score: 0.95, embeddingId: "emb-1", updatedAt: new Date() },
      { id: "k-2", source: "file", path: "src/login.ts", snippet: "login form", score: 0.85, embeddingId: "emb-2", updatedAt: new Date() },
    ];
    mockPrisma.knowledgeIndexMetadata.findMany.mockResolvedValue(rows);

    const results = await service.searchKnowledge("auth");

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("k-1");
    expect(results[0].score).toBe(0.95);
    expect(mockPrisma.knowledgeIndexMetadata.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
      }),
    );
  });

  it("respects limit parameter", async () => {
    mockPrisma.knowledgeIndexMetadata.findMany.mockResolvedValue([]);

    await service.searchKnowledge("test");

    expect(mockPrisma.knowledgeIndexMetadata.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 30 }),
    );
  });

  it("returns empty for blank query", async () => {
    const results = await service.searchKnowledge("   ");

    expect(results).toHaveLength(0);
    expect(mockPrisma.knowledgeIndexMetadata.findMany).not.toHaveBeenCalled();
  });
});

// ── getRecentCommands ──────────────────────────────────────────────────────

describe("getRecentCommands", () => {
  it("returns commands ordered by timestamp desc", async () => {
    const rows = [
      {
        id: "cmd-1",
        commandType: "task.intake",
        aggregateId: "ticket-1",
        status: "executed",
        payload: {},
        result: {},
        actor: "agent-1",
        createdAt: new Date("2026-03-20T10:00:00Z"),
        updatedAt: new Date("2026-03-20T10:00:00Z"),
      },
      {
        id: "cmd-2",
        commandType: "execution.request",
        aggregateId: "ticket-2",
        status: "rejected",
        payload: {},
        result: {},
        actor: "agent-2",
        createdAt: new Date("2026-03-20T09:00:00Z"),
        updatedAt: new Date("2026-03-20T09:00:00Z"),
      },
    ];
    mockPrisma.commandLog.findMany.mockResolvedValue(rows);

    const commands = await service.getRecentCommands();

    expect(commands).toHaveLength(2);
    expect(commands[0].id).toBe("cmd-1");
    expect(commands[0].command_type).toBe("task.intake");
    expect(commands[0].created_at).toBe("2026-03-20T10:00:00.000Z");
    expect(mockPrisma.commandLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  it("respects limit parameter", async () => {
    mockPrisma.commandLog.findMany.mockResolvedValue([]);

    await service.getRecentCommands(25);

    expect(mockPrisma.commandLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 25 }),
    );
  });

  it("uses default limit of 100", async () => {
    mockPrisma.commandLog.findMany.mockResolvedValue([]);

    await service.getRecentCommands();

    expect(mockPrisma.commandLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });
});

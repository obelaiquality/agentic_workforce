import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    ticket: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    ticketEvent: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    ticketComment: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../db", () => ({
  prisma: mocks.prisma,
}));

import { TicketService } from "./ticketService";

describe("TicketService execution policy", () => {
  const service = new TicketService();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.ticket.findUnique.mockResolvedValue({ id: "ticket-1" });
    mocks.prisma.ticketEvent.findFirst.mockResolvedValue(null);
    mocks.prisma.ticketEvent.create.mockResolvedValue({});
    mocks.prisma.auditEvent.create.mockResolvedValue({});
  });

  it("returns a mapped ticket when getTicket finds one", async () => {
    mocks.prisma.ticket.findUnique.mockResolvedValue({
      id: "ticket-1",
      repoId: "repo-1",
      title: "Investigate approvals",
      description: "Reproduce command approval flow",
      status: "blocked",
      laneOrder: 2000,
      priority: "p1",
      acceptanceCriteria: ["approval is recorded"],
      dependencies: [],
      risk: "medium",
      metadata: { area: "mission-control" },
      createdAt: new Date("2026-03-23T10:00:00.000Z"),
      updatedAt: new Date("2026-03-23T10:05:00.000Z"),
    });

    await expect(service.getTicket("ticket-1")).resolves.toEqual({
      id: "ticket-1",
      repoId: "repo-1",
      title: "Investigate approvals",
      description: "Reproduce command approval flow",
      status: "blocked",
      laneOrder: 2000,
      priority: "p1",
      acceptanceCriteria: ["approval is recorded"],
      dependencies: [],
      risk: "medium",
      metadata: { area: "mission-control" },
      createdAt: "2026-03-23T10:00:00.000Z",
      updatedAt: "2026-03-23T10:05:00.000Z",
    });
  });

  it("returns the balanced default when no execution policy event exists", async () => {
    await expect(service.getTicketExecutionPolicy("ticket-1")).resolves.toEqual({
      ticketId: "ticket-1",
      mode: "balanced",
      allowInstallCommands: false,
      allowNetworkCommands: false,
      requireApprovalFor: ["repo.install", "network", "destructive"],
      updatedAt: "1970-01-01T00:00:00.000Z",
      updatedBy: "system",
    });
  });

  it("writes strict mode with approval-required wildcard", async () => {
    const policy = await service.setTicketExecutionPolicy({
      ticketId: "ticket-1",
      mode: "strict",
      actor: "reviewer",
    });

    expect(policy).toMatchObject({
      ticketId: "ticket-1",
      mode: "strict",
      allowInstallCommands: false,
      allowNetworkCommands: false,
      requireApprovalFor: ["*"],
      updatedBy: "reviewer",
    });
    expect(mocks.prisma.ticketEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ticketId: "ticket-1",
          type: "ticket.execution_policy_set",
        }),
      })
    );
  });

  it("rejects new full_access writes", async () => {
    await expect(
      service.setTicketExecutionPolicy({
      ticketId: "ticket-1",
      mode: "full_access",
      actor: "reviewer",
      })
    ).rejects.toThrow("full_access is a legacy internal-only execution mode");
  });

  it("returns null when getTicket finds nothing", async () => {
    mocks.prisma.ticket.findUnique.mockResolvedValue(null);
    const result = await service.getTicket("nonexistent");
    expect(result).toBeNull();
  });

  it("mapTicket handles null metadata by returning undefined", async () => {
    mocks.prisma.ticket.findUnique.mockResolvedValue({
      id: "t-meta",
      repoId: null,
      title: "No metadata",
      description: "",
      status: "backlog",
      laneOrder: 1000,
      priority: "p2",
      acceptanceCriteria: [],
      dependencies: [],
      risk: "low",
      metadata: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const ticket = await service.getTicket("t-meta");
    expect(ticket).toBeDefined();
    expect(ticket!.metadata).toBeUndefined();
  });

  it("setTicketExecutionPolicy with balanced mode and custom params", async () => {
    const policy = await service.setTicketExecutionPolicy({
      ticketId: "ticket-1",
      mode: "balanced",
      allowInstallCommands: true,
      allowNetworkCommands: true,
      requireApprovalFor: ["destructive"],
    });
    expect(policy).toMatchObject({
      ticketId: "ticket-1",
      mode: "balanced",
      allowInstallCommands: true,
      allowNetworkCommands: true,
      requireApprovalFor: ["destructive"],
      updatedBy: "user",
    });
  });

  it("setTicketExecutionPolicy defaults requireApprovalFor for balanced mode when empty", async () => {
    const policy = await service.setTicketExecutionPolicy({
      ticketId: "ticket-1",
      mode: "balanced",
      requireApprovalFor: [],
    });
    expect(policy.requireApprovalFor).toEqual(["repo.install", "network", "destructive"]);
  });

  it("setTicketExecutionPolicy throws when ticket not found", async () => {
    mocks.prisma.ticket.findUnique.mockResolvedValue(null);
    await expect(
      service.setTicketExecutionPolicy({ ticketId: "missing", mode: "balanced" })
    ).rejects.toThrow("Ticket not found: missing");
  });

  it("getTicketExecutionPolicy reconstructs policy from stored event", async () => {
    mocks.prisma.ticketEvent.findFirst.mockResolvedValue({
      ticketId: "ticket-1",
      type: "ticket.execution_policy_set",
      createdAt: new Date("2026-03-20T12:00:00Z"),
      payload: {
        mode: "strict",
        allowInstallCommands: true,
        allowNetworkCommands: false,
        requireApprovalFor: ["*"],
        updatedBy: "admin",
      },
    });
    const policy = await service.getTicketExecutionPolicy("ticket-1");
    expect(policy).toEqual({
      ticketId: "ticket-1",
      mode: "strict",
      allowInstallCommands: true,
      allowNetworkCommands: false,
      requireApprovalFor: ["*"],
      updatedAt: "2026-03-20T12:00:00.000Z",
      updatedBy: "admin",
    });
  });

  it("getTicketExecutionPolicy falls back to balanced when mode is invalid", async () => {
    mocks.prisma.ticketEvent.findFirst.mockResolvedValue({
      ticketId: "ticket-1",
      type: "ticket.execution_policy_set",
      createdAt: new Date("2026-03-20T12:00:00Z"),
      payload: {
        mode: "invalid_mode",
        allowInstallCommands: false,
        allowNetworkCommands: false,
        requireApprovalFor: "not-an-array",
        updatedBy: "",
      },
    });
    const policy = await service.getTicketExecutionPolicy("ticket-1");
    expect(policy.mode).toBe("balanced");
    expect(policy.requireApprovalFor).toEqual(["repo.install", "network", "destructive"]);
    expect(policy.updatedBy).toBe("user");
  });

  it("getTicketExecutionPolicy filters non-string items from requireApprovalFor", async () => {
    mocks.prisma.ticketEvent.findFirst.mockResolvedValue({
      ticketId: "ticket-1",
      type: "ticket.execution_policy_set",
      createdAt: new Date("2026-03-20T12:00:00Z"),
      payload: {
        mode: "balanced",
        requireApprovalFor: ["network", 42, null, "destructive"],
      },
    });
    const policy = await service.getTicketExecutionPolicy("ticket-1");
    expect(policy.requireApprovalFor).toEqual(["network", "destructive"]);
  });

  it("getTicketExecutionPolicy handles null payload gracefully", async () => {
    mocks.prisma.ticketEvent.findFirst.mockResolvedValue({
      ticketId: "ticket-1",
      type: "ticket.execution_policy_set",
      createdAt: new Date("2026-03-20T12:00:00Z"),
      payload: null,
    });
    const policy = await service.getTicketExecutionPolicy("ticket-1");
    expect(policy.mode).toBe("balanced");
    expect(policy.updatedBy).toBe("user");
  });
});

describe("TicketService listTickets", () => {
  const service = new TicketService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns sorted tickets from findMany", async () => {
    const now = new Date("2026-04-01T00:00:00Z");
    mocks.prisma.ticket.findMany.mockResolvedValue([
      {
        id: "t-2",
        repoId: "repo-1",
        title: "Second",
        description: "",
        status: "in_progress",
        laneOrder: 1000,
        priority: "p2",
        acceptanceCriteria: [],
        dependencies: [],
        risk: "low",
        metadata: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "t-1",
        repoId: "repo-1",
        title: "First",
        description: "",
        status: "backlog",
        laneOrder: 1000,
        priority: "p1",
        acceptanceCriteria: [],
        dependencies: [],
        risk: "low",
        metadata: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const tickets = await service.listTickets("repo-1");
    expect(tickets).toHaveLength(2);
    // backlog lane (rank 0) should come before in_progress (rank 1)
    expect(tickets[0].status).toBe("backlog");
    expect(tickets[1].status).toBe("in_progress");
    expect(mocks.prisma.ticket.findMany).toHaveBeenCalledWith({
      where: { repoId: "repo-1" },
      orderBy: [{ laneOrder: "asc" }, { updatedAt: "desc" }],
    });
  });

  it("lists all tickets when no repoId given", async () => {
    mocks.prisma.ticket.findMany.mockResolvedValue([]);
    const tickets = await service.listTickets();
    expect(tickets).toEqual([]);
    expect(mocks.prisma.ticket.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: [{ laneOrder: "asc" }, { updatedAt: "desc" }],
    });
  });

  it("sorts by laneOrder when same lane", async () => {
    const now = new Date("2026-04-01T00:00:00Z");
    mocks.prisma.ticket.findMany.mockResolvedValue([
      {
        id: "t-b",
        repoId: null,
        title: "B",
        description: "",
        status: "backlog",
        laneOrder: 2000,
        priority: "p2",
        acceptanceCriteria: [],
        dependencies: [],
        risk: "low",
        metadata: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "t-a",
        repoId: null,
        title: "A",
        description: "",
        status: "backlog",
        laneOrder: 1000,
        priority: "p2",
        acceptanceCriteria: [],
        dependencies: [],
        risk: "low",
        metadata: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const tickets = await service.listTickets();
    expect(tickets[0].id).toBe("t-a");
    expect(tickets[1].id).toBe("t-b");
  });

  it("breaks ties by updatedAt descending", async () => {
    mocks.prisma.ticket.findMany.mockResolvedValue([
      {
        id: "t-old",
        repoId: null,
        title: "Old",
        description: "",
        status: "backlog",
        laneOrder: 1000,
        priority: "p2",
        acceptanceCriteria: [],
        dependencies: [],
        risk: "low",
        metadata: null,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
      {
        id: "t-new",
        repoId: null,
        title: "New",
        description: "",
        status: "backlog",
        laneOrder: 1000,
        priority: "p2",
        acceptanceCriteria: [],
        dependencies: [],
        risk: "low",
        metadata: null,
        createdAt: new Date("2026-04-01"),
        updatedAt: new Date("2026-04-01"),
      },
    ]);
    const tickets = await service.listTickets();
    // Newer updatedAt first when laneOrder is the same
    expect(tickets[0].id).toBe("t-new");
    expect(tickets[1].id).toBe("t-old");
  });
});

describe("TicketService getBoard", () => {
  const service = new TicketService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns tickets grouped by status columns", async () => {
    const now = new Date("2026-04-01T00:00:00Z");
    mocks.prisma.ticket.findMany.mockResolvedValue([
      {
        id: "t-1",
        repoId: null,
        title: "Backlog ticket",
        description: "",
        status: "backlog",
        laneOrder: 1000,
        priority: "p2",
        acceptanceCriteria: [],
        dependencies: [],
        risk: "low",
        metadata: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "t-2",
        repoId: null,
        title: "Done ticket",
        description: "",
        status: "done",
        laneOrder: 1000,
        priority: "p2",
        acceptanceCriteria: [],
        dependencies: [],
        risk: "low",
        metadata: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const board = await service.getBoard();
    expect(board.backlog).toHaveLength(1);
    expect(board.backlog[0].id).toBe("t-1");
    expect(board.done).toHaveLength(1);
    expect(board.done[0].id).toBe("t-2");
    expect(board.in_progress).toHaveLength(0);
    expect(board.review).toHaveLength(0);
    expect(board.blocked).toHaveLength(0);
    expect(board.ready).toHaveLength(0);
  });
});

describe("TicketService createTicket", () => {
  const service = new TicketService();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.ticketEvent.create.mockResolvedValue({});
    mocks.prisma.auditEvent.create.mockResolvedValue({});
  });

  it("creates a ticket with defaults and appends after latest in lane", async () => {
    mocks.prisma.ticket.findFirst.mockResolvedValue({ laneOrder: 2000 });
    mocks.prisma.ticket.create.mockResolvedValue({
      id: "new-1",
      repoId: null,
      title: "New task",
      description: "",
      status: "backlog",
      laneOrder: 3000,
      priority: "p2",
      acceptanceCriteria: [],
      dependencies: [],
      risk: "medium",
      metadata: null,
      createdAt: new Date("2026-04-01T00:00:00Z"),
      updatedAt: new Date("2026-04-01T00:00:00Z"),
    });

    const ticket = await service.createTicket({ title: "New task" });
    expect(ticket.id).toBe("new-1");
    expect(ticket.status).toBe("backlog");
    expect(mocks.prisma.ticket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "New task",
        laneOrder: 3000,
        status: "backlog",
        priority: "p2",
        risk: "medium",
      }),
    });
    expect(mocks.prisma.ticketEvent.create).toHaveBeenCalled();
    expect(mocks.prisma.auditEvent.create).toHaveBeenCalled();
  });

  it("creates a ticket at laneOrder 1000 when lane is empty", async () => {
    mocks.prisma.ticket.findFirst.mockResolvedValue(null);
    mocks.prisma.ticket.create.mockResolvedValue({
      id: "first-1",
      repoId: "repo-1",
      title: "First task",
      description: "Desc",
      status: "in_progress",
      laneOrder: 1000,
      priority: "p1",
      acceptanceCriteria: ["done"],
      dependencies: ["dep-1"],
      risk: "high",
      metadata: null,
      createdAt: new Date("2026-04-01T00:00:00Z"),
      updatedAt: new Date("2026-04-01T00:00:00Z"),
    });

    const ticket = await service.createTicket({
      repoId: "repo-1",
      title: "First task",
      description: "Desc",
      status: "in_progress",
      priority: "p1",
      risk: "high",
      acceptanceCriteria: ["done"],
      dependencies: ["dep-1"],
    });
    expect(ticket.status).toBe("in_progress");
    expect(ticket.priority).toBe("p1");
    expect(mocks.prisma.ticket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        laneOrder: 1000,
        status: "in_progress",
      }),
    });
  });

  it("creates ticket with latestInLane having laneOrder 0 (falsy)", async () => {
    mocks.prisma.ticket.findFirst.mockResolvedValue({ laneOrder: 0 });
    mocks.prisma.ticket.create.mockResolvedValue({
      id: "zero-lane",
      repoId: null,
      title: "Zero lane",
      description: "",
      status: "backlog",
      laneOrder: 1000,
      priority: "p2",
      acceptanceCriteria: [],
      dependencies: [],
      risk: "medium",
      metadata: null,
      createdAt: new Date("2026-04-01"),
      updatedAt: new Date("2026-04-01"),
    });

    await service.createTicket({ title: "Zero lane" });
    expect(mocks.prisma.ticket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ laneOrder: 1000 }),
    });
  });
});

describe("TicketService updateTicket", () => {
  const service = new TicketService();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.ticketEvent.create.mockResolvedValue({});
    mocks.prisma.auditEvent.create.mockResolvedValue({});
  });

  it("updates ticket fields and emits events", async () => {
    mocks.prisma.ticket.update.mockResolvedValue({
      id: "t-1",
      repoId: null,
      title: "Updated title",
      description: "Updated desc",
      status: "backlog",
      laneOrder: 1000,
      priority: "p0",
      acceptanceCriteria: ["ac1"],
      dependencies: ["d1"],
      risk: "high",
      metadata: null,
      createdAt: new Date("2026-04-01"),
      updatedAt: new Date("2026-04-02"),
    });

    const ticket = await service.updateTicket("t-1", {
      title: "Updated title",
      description: "Updated desc",
      priority: "p0",
      risk: "high",
      acceptanceCriteria: ["ac1"],
      dependencies: ["d1"],
    });

    expect(ticket.title).toBe("Updated title");
    expect(ticket.priority).toBe("p0");
    expect(mocks.prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "t-1" },
      data: {
        title: "Updated title",
        description: "Updated desc",
        priority: "p0",
        risk: "high",
        acceptanceCriteria: ["ac1"],
        dependencies: ["d1"],
      },
    });
    expect(mocks.prisma.ticketEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketId: "t-1",
        type: "ticket.updated",
      }),
    });
    expect(mocks.prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor: "user",
        eventType: "ticket.updated",
      }),
    });
  });
});

describe("TicketService moveTicket", () => {
  const service = new TicketService();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.ticketEvent.create.mockResolvedValue({});
    mocks.prisma.auditEvent.create.mockResolvedValue({});
  });

  it("moves a ticket to a new status via transaction", async () => {
    const movedTicket = {
      id: "t-1",
      repoId: null,
      title: "Task",
      description: "",
      status: "review",
      laneOrder: 1000,
      priority: "p2",
      acceptanceCriteria: [],
      dependencies: [],
      risk: "low",
      metadata: null,
      createdAt: new Date("2026-04-01"),
      updatedAt: new Date("2026-04-02"),
    };

    mocks.prisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        ticket: {
          findUnique: vi.fn().mockResolvedValue({
            id: "t-1",
            repoId: null,
            status: "in_progress",
            laneOrder: 1000,
          }),
          findFirst: vi.fn().mockResolvedValue({ laneOrder: 3000 }),
          update: vi.fn().mockResolvedValue(movedTicket),
        },
      };
      return fn(tx);
    });

    const ticket = await service.moveTicket("t-1", "review");
    expect(ticket.status).toBe("review");
    expect(mocks.prisma.ticketEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketId: "t-1",
        type: "ticket.moved",
        payload: { status: "review" },
      }),
    });
  });

  it("throws when ticket not found in transaction", async () => {
    mocks.prisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        ticket: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      };
      return fn(tx);
    });

    await expect(service.moveTicket("missing", "done")).rejects.toThrow(
      "Ticket not found: missing"
    );
  });

  it("uses laneOrder 1000 when no other tickets exist in lane", async () => {
    const movedTicket = {
      id: "t-1",
      repoId: null,
      title: "Task",
      description: "",
      status: "done",
      laneOrder: 1000,
      priority: "p2",
      acceptanceCriteria: [],
      dependencies: [],
      risk: "low",
      metadata: null,
      createdAt: new Date("2026-04-01"),
      updatedAt: new Date("2026-04-02"),
    };

    mocks.prisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        ticket: {
          findUnique: vi.fn().mockResolvedValue({
            id: "t-1",
            repoId: null,
            status: "backlog",
            laneOrder: 1000,
          }),
          findFirst: vi.fn().mockResolvedValue(null),
          update: vi.fn().mockResolvedValue(movedTicket),
        },
      };
      return fn(tx);
    });

    const ticket = await service.moveTicket("t-1", "done");
    expect(ticket.status).toBe("done");
  });
});

describe("TicketService moveWorkflow", () => {
  const service = new TicketService();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.ticketEvent.create.mockResolvedValue({});
    mocks.prisma.auditEvent.create.mockResolvedValue({});
  });

  it("moves a ticket to a different lane with resequencing", async () => {
    const resultTicket = {
      id: "t-1",
      repoId: null,
      title: "Task",
      description: "",
      status: "review",
      laneOrder: 1000,
      priority: "p2",
      acceptanceCriteria: [],
      dependencies: [],
      risk: "low",
      metadata: null,
      createdAt: new Date("2026-04-01"),
      updatedAt: new Date("2026-04-02"),
    };

    mocks.prisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        ticket: {
          findUnique: vi.fn().mockResolvedValue(resultTicket),
          findMany: vi.fn().mockResolvedValue([]),
          update: vi.fn().mockResolvedValue(resultTicket),
        },
      };
      return fn(tx);
    });

    const ticket = await service.moveWorkflow("t-1", "needs_review");
    expect(ticket.status).toBe("review");
    expect(mocks.prisma.ticketEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "ticket.workflow_moved",
        payload: { lane: "needs_review", beforeTicketId: null },
      }),
    });
    expect(mocks.prisma.auditEvent.create).toHaveBeenCalled();
  });

  it("throws when ticket not found in moveWorkflow", async () => {
    mocks.prisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        ticket: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      };
      return fn(tx);
    });

    await expect(service.moveWorkflow("missing", "backlog")).rejects.toThrow(
      "Ticket not found: missing"
    );
  });

  it("inserts before a specific ticket", async () => {
    const resultTicket = {
      id: "t-move",
      repoId: null,
      title: "Moving",
      description: "",
      status: "backlog",
      laneOrder: 1000,
      priority: "p2",
      acceptanceCriteria: [],
      dependencies: [],
      risk: "low",
      metadata: null,
      createdAt: new Date("2026-04-01"),
      updatedAt: new Date("2026-04-01"),
    };

    const targetTicket = {
      id: "t-target",
      repoId: null,
      title: "Target",
      description: "",
      status: "backlog",
      laneOrder: 2000,
      priority: "p2",
      acceptanceCriteria: [],
      dependencies: [],
      risk: "low",
      metadata: null,
      createdAt: new Date("2026-04-01"),
      updatedAt: new Date("2026-04-01"),
    };

    mocks.prisma.$transaction.mockImplementation(async (fn: any) => {
      const findUniqueFn = vi.fn()
        .mockResolvedValueOnce({
          id: "t-move",
          repoId: null,
          status: "backlog",
          laneOrder: 3000,
        })
        .mockResolvedValueOnce(resultTicket);
      const tx = {
        ticket: {
          findUnique: findUniqueFn,
          findMany: vi.fn().mockResolvedValue([targetTicket]),
          update: vi.fn().mockResolvedValue(resultTicket),
        },
      };
      return fn(tx);
    });

    const ticket = await service.moveWorkflow("t-move", "backlog", "t-target");
    expect(ticket).toBeDefined();
    expect(mocks.prisma.ticketEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: { lane: "backlog", beforeTicketId: "t-target" },
      }),
    });
  });

  it("resequences source lane when moving across lanes", async () => {
    const resultTicket = {
      id: "t-cross",
      repoId: null,
      title: "Cross-lane",
      description: "",
      status: "done",
      laneOrder: 1000,
      priority: "p2",
      acceptanceCriteria: [],
      dependencies: [],
      risk: "low",
      metadata: null,
      createdAt: new Date("2026-04-01"),
      updatedAt: new Date("2026-04-01"),
    };

    const sourceTicket = {
      id: "t-remain",
      repoId: null,
      title: "Remain",
      description: "",
      status: "in_progress",
      laneOrder: 2000,
      priority: "p2",
      acceptanceCriteria: [],
      dependencies: [],
      risk: "low",
      metadata: null,
      createdAt: new Date("2026-04-01"),
      updatedAt: new Date("2026-04-01"),
    };

    mocks.prisma.$transaction.mockImplementation(async (fn: any) => {
      const updateFn = vi.fn().mockResolvedValue(resultTicket);
      const findManyFn = vi.fn()
        .mockResolvedValueOnce([]) // target lane tickets
        .mockResolvedValueOnce([sourceTicket]); // source lane tickets
      const findUniqueFn = vi.fn()
        .mockResolvedValueOnce({
          id: "t-cross",
          repoId: null,
          status: "in_progress",
          laneOrder: 1000,
        })
        .mockResolvedValueOnce(resultTicket);
      const tx = {
        ticket: {
          findUnique: findUniqueFn,
          findMany: findManyFn,
          update: updateFn,
        },
      };
      return fn(tx);
    });

    const ticket = await service.moveWorkflow("t-cross", "completed");
    expect(ticket.status).toBe("done");
  });
});

describe("TicketService listTicketComments", () => {
  const service = new TicketService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns threaded comments with nested replies", async () => {
    const root = {
      id: "c-1",
      ticketId: "t-1",
      parentCommentId: null,
      author: "alice",
      body: "Root comment",
      createdAt: new Date("2026-04-01T10:00:00Z"),
      updatedAt: new Date("2026-04-01T10:00:00Z"),
    };
    const reply = {
      id: "c-2",
      ticketId: "t-1",
      parentCommentId: "c-1",
      author: "bob",
      body: "Reply",
      createdAt: new Date("2026-04-01T10:05:00Z"),
      updatedAt: new Date("2026-04-01T10:05:00Z"),
    };
    const nestedReply = {
      id: "c-3",
      ticketId: "t-1",
      parentCommentId: "c-2",
      author: "charlie",
      body: "Nested reply",
      createdAt: new Date("2026-04-01T10:10:00Z"),
      updatedAt: new Date("2026-04-01T10:10:00Z"),
    };

    mocks.prisma.ticketComment.findMany.mockResolvedValue([root, reply, nestedReply]);

    const threads = await service.listTicketComments("t-1");
    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe("c-1");
    expect(threads[0].body).toBe("Root comment");
    expect(threads[0].replies).toHaveLength(1);
    expect(threads[0].replies[0].id).toBe("c-2");
    expect(threads[0].replies[0].replies).toHaveLength(1);
    expect(threads[0].replies[0].replies[0].id).toBe("c-3");
  });

  it("returns empty array when no comments exist", async () => {
    mocks.prisma.ticketComment.findMany.mockResolvedValue([]);
    const threads = await service.listTicketComments("t-1");
    expect(threads).toEqual([]);
  });

  it("respects custom limit parameter", async () => {
    mocks.prisma.ticketComment.findMany.mockResolvedValue([]);
    await service.listTicketComments("t-1", 10);
    expect(mocks.prisma.ticketComment.findMany).toHaveBeenCalledWith({
      where: { ticketId: "t-1" },
      orderBy: [{ createdAt: "asc" }],
      take: 10,
    });
  });
});

describe("TicketService addTicketComment", () => {
  const service = new TicketService();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.ticketEvent.create.mockResolvedValue({});
    mocks.prisma.auditEvent.create.mockResolvedValue({});
  });

  it("adds a root comment", async () => {
    mocks.prisma.ticket.findUnique.mockResolvedValue({ id: "t-1" });
    mocks.prisma.ticketComment.create.mockResolvedValue({
      id: "c-new",
      ticketId: "t-1",
      parentCommentId: null,
      author: "operator",
      body: "Hello",
      createdAt: new Date("2026-04-01T12:00:00Z"),
      updatedAt: new Date("2026-04-01T12:00:00Z"),
    });

    const result = await service.addTicketComment({
      ticketId: "t-1",
      body: "Hello",
    });

    expect(result.id).toBe("c-new");
    expect(result.author).toBe("operator");
    expect(result.body).toBe("Hello");
    expect(result.parentCommentId).toBeNull();
    expect(result.replies).toEqual([]);
    expect(mocks.prisma.ticketComment.create).toHaveBeenCalledWith({
      data: {
        ticketId: "t-1",
        parentCommentId: null,
        author: "operator",
        body: "Hello",
      },
    });
  });

  it("adds a reply comment with valid parent", async () => {
    mocks.prisma.ticket.findUnique.mockResolvedValue({ id: "t-1" });
    mocks.prisma.ticketComment.findUnique.mockResolvedValue({
      id: "c-parent",
      ticketId: "t-1",
    });
    mocks.prisma.ticketComment.create.mockResolvedValue({
      id: "c-reply",
      ticketId: "t-1",
      parentCommentId: "c-parent",
      author: "alice",
      body: "Reply text",
      createdAt: new Date("2026-04-01T12:00:00Z"),
      updatedAt: new Date("2026-04-01T12:00:00Z"),
    });

    const result = await service.addTicketComment({
      ticketId: "t-1",
      author: "alice",
      body: "Reply text",
      parentCommentId: "c-parent",
    });

    expect(result.parentCommentId).toBe("c-parent");
    expect(result.author).toBe("alice");
  });

  it("throws when ticket not found", async () => {
    mocks.prisma.ticket.findUnique.mockResolvedValue(null);
    await expect(
      service.addTicketComment({ ticketId: "missing", body: "Nope" })
    ).rejects.toThrow("Ticket not found: missing");
  });

  it("throws when parent comment not found", async () => {
    mocks.prisma.ticket.findUnique.mockResolvedValue({ id: "t-1" });
    mocks.prisma.ticketComment.findUnique.mockResolvedValue(null);
    await expect(
      service.addTicketComment({
        ticketId: "t-1",
        body: "Orphan reply",
        parentCommentId: "c-ghost",
      })
    ).rejects.toThrow("Parent comment not found on ticket: c-ghost");
  });

  it("throws when parent comment belongs to different ticket", async () => {
    mocks.prisma.ticket.findUnique.mockResolvedValue({ id: "t-1" });
    mocks.prisma.ticketComment.findUnique.mockResolvedValue({
      id: "c-other",
      ticketId: "t-other",
    });
    await expect(
      service.addTicketComment({
        ticketId: "t-1",
        body: "Wrong parent",
        parentCommentId: "c-other",
      })
    ).rejects.toThrow("Parent comment not found on ticket: c-other");
  });

  it("uses 'operator' when author is empty or whitespace", async () => {
    mocks.prisma.ticket.findUnique.mockResolvedValue({ id: "t-1" });
    mocks.prisma.ticketComment.create.mockResolvedValue({
      id: "c-default-author",
      ticketId: "t-1",
      parentCommentId: null,
      author: "operator",
      body: "Test",
      createdAt: new Date("2026-04-01T12:00:00Z"),
      updatedAt: new Date("2026-04-01T12:00:00Z"),
    });

    await service.addTicketComment({
      ticketId: "t-1",
      author: "  ",
      body: "Test",
    });

    expect(mocks.prisma.ticketComment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ author: "operator" }),
    });
  });
});

describe("TicketService getTicketExecutionProfileOverride", () => {
  const service = new TicketService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns undefined when no event exists", async () => {
    mocks.prisma.ticketEvent.findFirst.mockResolvedValue(null);
    const result = await service.getTicketExecutionProfileOverride("t-1");
    expect(result).toBeUndefined();
  });

  it("returns the executionProfileId from the event payload", async () => {
    mocks.prisma.ticketEvent.findFirst.mockResolvedValue({
      payload: { executionProfileId: "profile-abc" },
    });
    const result = await service.getTicketExecutionProfileOverride("t-1");
    expect(result).toBe("profile-abc");
  });

  it("returns null when executionProfileId is not a string", async () => {
    mocks.prisma.ticketEvent.findFirst.mockResolvedValue({
      payload: { executionProfileId: 123 },
    });
    const result = await service.getTicketExecutionProfileOverride("t-1");
    expect(result).toBeNull();
  });

  it("returns null when payload is null", async () => {
    mocks.prisma.ticketEvent.findFirst.mockResolvedValue({
      payload: null,
    });
    const result = await service.getTicketExecutionProfileOverride("t-1");
    expect(result).toBeNull();
  });
});

describe("TicketService setTicketExecutionProfileOverride", () => {
  const service = new TicketService();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.ticketEvent.create.mockResolvedValue({});
    mocks.prisma.auditEvent.create.mockResolvedValue({});
  });

  it("sets a non-null execution profile override", async () => {
    mocks.prisma.ticket.findUnique.mockResolvedValue({ id: "t-1" });
    const result = await service.setTicketExecutionProfileOverride({
      ticketId: "t-1",
      executionProfileId: "profile-xyz",
      actor: "admin",
    });
    expect(result).toEqual({
      ticketId: "t-1",
      executionProfileId: "profile-xyz",
    });
    expect(mocks.prisma.ticketEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketId: "t-1",
        type: "ticket.execution_profile_set",
        payload: { executionProfileId: "profile-xyz" },
      }),
    });
    expect(mocks.prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor: "admin",
        eventType: "ticket.execution_profile_set",
      }),
    });
  });

  it("clears the execution profile override when null", async () => {
    mocks.prisma.ticket.findUnique.mockResolvedValue({ id: "t-1" });
    const result = await service.setTicketExecutionProfileOverride({
      ticketId: "t-1",
      executionProfileId: null,
    });
    expect(result.executionProfileId).toBeNull();
    expect(mocks.prisma.ticketEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "ticket.execution_profile_cleared",
      }),
    });
    expect(mocks.prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor: "user",
        eventType: "ticket.execution_profile_cleared",
      }),
    });
  });

  it("clears profile when executionProfileId is whitespace", async () => {
    mocks.prisma.ticket.findUnique.mockResolvedValue({ id: "t-1" });
    const result = await service.setTicketExecutionProfileOverride({
      ticketId: "t-1",
      executionProfileId: "   ",
    });
    expect(result.executionProfileId).toBeNull();
    expect(mocks.prisma.ticketEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "ticket.execution_profile_cleared",
      }),
    });
  });

  it("throws when ticket not found", async () => {
    mocks.prisma.ticket.findUnique.mockResolvedValue(null);
    await expect(
      service.setTicketExecutionProfileOverride({
        ticketId: "missing",
        executionProfileId: "p-1",
      })
    ).rejects.toThrow("Ticket not found: missing");
  });

  it("defaults actor to 'user' when not provided", async () => {
    mocks.prisma.ticket.findUnique.mockResolvedValue({ id: "t-1" });
    await service.setTicketExecutionProfileOverride({
      ticketId: "t-1",
      executionProfileId: "p-1",
    });
    expect(mocks.prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actor: "user" }),
    });
  });
});

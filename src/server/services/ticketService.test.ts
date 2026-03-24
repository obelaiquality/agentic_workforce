import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    ticket: {
      findUnique: vi.fn(),
    },
    ticketEvent: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
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
});

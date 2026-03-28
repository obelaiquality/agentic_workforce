import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    appSetting: {
      findUnique: vi.fn(),
    },
    approvalRequest: {
      create: vi.fn(),
    },
    approvalProjection: {
      upsert: vi.fn(),
    },
    runEvent: {
      findMany: vi.fn(),
    },
  },
  publishEvent: vi.fn(),
  handleCommandInvocationApprovalDecision: vi.fn(),
  syncTaskProjectionFromTicket: vi.fn(),
  mapLegacyToLifecycle: vi.fn((status: string) => {
    if (status === "backlog") return "inactive";
    if (status === "ready" || status === "review") return "active";
    if (status === "done") return "completed";
    return status;
  }),
}));

vi.mock("../db", () => ({
  prisma: mocks.prisma,
}));

vi.mock("../eventBus", () => ({
  eventBus: {
    subscribe: vi.fn(() => () => {}),
  },
  publishEvent: mocks.publishEvent,
}));

vi.mock("./shared/commandApproval", () => ({
  handleCommandInvocationApprovalDecision: mocks.handleCommandInvocationApprovalDecision,
}));

vi.mock("./shared/ticketProjection", () => ({
  mapLegacyToLifecycle: mocks.mapLegacyToLifecycle,
  syncTaskProjectionFromTicket: mocks.syncTaskProjectionFromTicket,
}));

import { registerLegacyRoutes } from "./legacyRoutes";

function createHarness() {
  const app = Fastify();
  const approvalService = {
    listApprovals: vi.fn().mockResolvedValue([]),
    decideApproval: vi.fn().mockResolvedValue({
      id: "approval-1",
      actionType: "provider_change",
      status: "approved",
      reason: null,
      decidedBy: "ops-bot",
      requestedAt: new Date("2026-03-24T07:00:00.000Z"),
      decidedAt: new Date("2026-03-24T07:05:00.000Z"),
      payload: {
        providerId: "openai-responses",
      },
    }),
  };
  const auditService = {
    listEvents: vi.fn().mockResolvedValue([]),
  };
  const chatService = {
    listSessions: vi.fn().mockResolvedValue([]),
    createSession: vi.fn().mockImplementation(async (title: string, repoId: string | null) => ({
      id: "session-1",
      title,
      repoId,
    })),
    listMessages: vi.fn().mockResolvedValue([]),
    createUserMessage: vi.fn().mockResolvedValue({
      id: "message-1",
    }),
  };
  const commandEngine = {
    invoke: vi.fn(),
  };
  const providerOrchestrator = {
    listProviders: vi.fn().mockResolvedValue([]),
    setActiveProvider: vi.fn().mockResolvedValue(undefined),
    listQwenAccounts: vi.fn().mockResolvedValue([]),
    createQwenAccount: vi.fn(),
    updateQwenAccount: vi.fn(),
    markQwenAccountReauthed: vi.fn(),
    getQwenQuotaOverview: vi.fn().mockResolvedValue([]),
  };
  const qwenAccountSetupService = {
    bootstrapAccount: vi.fn(),
    startAuth: vi.fn(),
    listAuthSessions: vi.fn().mockResolvedValue([]),
  };
  const ticketService = {
    listTickets: vi.fn().mockResolvedValue([]),
    createTicket: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ({
      id: "ticket-1",
      repoId: (input.repoId as string | null | undefined) ?? null,
      title: input.title,
      description: (input.description as string | undefined) ?? "",
      status: (input.status as string | undefined) ?? "backlog",
      priority: (input.priority as string | undefined) ?? "p2",
      risk: (input.risk as string | undefined) ?? "medium",
      acceptanceCriteria: (input.acceptanceCriteria as string[] | undefined) ?? [],
      dependencies: (input.dependencies as string[] | undefined) ?? [],
    })),
    updateTicket: vi.fn(),
    moveTicket: vi.fn(),
    listTicketComments: vi.fn().mockResolvedValue([]),
    addTicketComment: vi.fn(),
    getBoard: vi.fn().mockResolvedValue([]),
    getTicket: vi.fn().mockResolvedValue({
      id: "ticket-1",
      repoId: "repo-active",
      status: "in_progress",
    }),
  };
  const v2EventService = {
    appendEvent: vi.fn().mockResolvedValue(undefined),
  };

  registerLegacyRoutes({
    app,
    approvalService: approvalService as never,
    auditService: auditService as never,
    chatService: chatService as never,
    commandEngine: commandEngine as never,
    providerOrchestrator: providerOrchestrator as never,
    qwenAccountSetupService: qwenAccountSetupService as never,
    ticketService: ticketService as never,
    v2EventService: v2EventService as never,
  });

  return {
    app,
    approvalService,
    chatService,
    providerOrchestrator,
    ticketService,
    v2EventService,
  };
}

describe("legacyRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "active_repo") {
        return { value: "repo-active" };
      }
      return null;
    });
    mocks.prisma.approvalRequest.create.mockResolvedValue({
      id: "approval-1",
      actionType: "provider_change",
    });
    mocks.prisma.approvalProjection.upsert.mockResolvedValue(undefined);
    mocks.prisma.runEvent.findMany.mockResolvedValue([]);
    mocks.handleCommandInvocationApprovalDecision.mockResolvedValue({
      commandExecution: null,
      requeue: null,
    });
    mocks.syncTaskProjectionFromTicket.mockResolvedValue(undefined);
  });

  it("queues provider changes when the safety policy requires approval", async () => {
    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "safety_policy") {
        return {
          value: {
            requireApprovalForProviderChanges: true,
          },
        };
      }
      return null;
    });
    const { app, providerOrchestrator, v2EventService } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/providers/active",
      payload: {
        providerId: "openai-responses",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      requiresApproval: true,
      approvalId: "approval-1",
    });
    expect(mocks.prisma.approvalRequest.create).toHaveBeenCalledWith({
      data: {
        actionType: "provider_change",
        payload: {
          providerId: "openai-responses",
        },
      },
    });
    expect(providerOrchestrator.setActiveProvider).not.toHaveBeenCalled();
    expect(v2EventService.appendEvent).not.toHaveBeenCalled();

    await app.close();
  });

  it("activates provider changes immediately when approvals are not required", async () => {
    const { app, providerOrchestrator, v2EventService } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/providers/active",
      payload: {
        providerId: "onprem-qwen",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(providerOrchestrator.setActiveProvider).toHaveBeenCalledWith("onprem-qwen");
    expect(v2EventService.appendEvent).toHaveBeenCalledWith({
      type: "provider.activated",
      aggregateId: "onprem-qwen",
      actor: "user",
      payload: {
        provider_id: "onprem-qwen",
      },
    });

    await app.close();
  });

  it("defaults new chat sessions to the active repo when repoId is omitted", async () => {
    const { app, chatService } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/chat/sessions",
      payload: {
        title: "Review current work",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(chatService.createSession).toHaveBeenCalledWith("Review current work", "repo-active");
    expect(response.json()).toEqual({
      ok: true,
      item: {
        id: "session-1",
        title: "Review current work",
        repoId: "repo-active",
      },
    });

    await app.close();
  });

  it("creates tickets against the active repo and syncs task projections", async () => {
    const { app, ticketService, v2EventService } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tickets",
      payload: {
        title: "Stabilize onboarding flow",
        acceptanceCriteria: ["Keep the empty repo flow intact"],
        dependencies: ["ticket-0"],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(ticketService.createTicket).toHaveBeenCalledWith({
      title: "Stabilize onboarding flow",
      repoId: "repo-active",
      acceptanceCriteria: ["Keep the empty repo flow intact"],
      dependencies: ["ticket-0"],
    });
    expect(mocks.syncTaskProjectionFromTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "ticket-1",
        repoId: "repo-active",
      })
    );
    expect(v2EventService.appendEvent).toHaveBeenCalledWith({
      type: "task.created",
      aggregateId: "ticket-1",
      actor: "user",
      payload: {
        ticket_id: "ticket-1",
        title: "Stabilize onboarding flow",
        description: "",
        priority: "p2",
        risk: "medium",
        acceptance_criteria: ["Keep the empty repo flow intact"],
        dependencies: ["ticket-0"],
      },
    });

    await app.close();
  });

  it("replays approved provider change decisions through the activation path", async () => {
    const { app, approvalService, providerOrchestrator, v2EventService } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/approvals/approval-1/decide",
      payload: {
        decision: "approved",
        decidedBy: "ops-bot",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(approvalService.decideApproval).toHaveBeenCalledWith("approval-1", {
      decision: "approved",
      decidedBy: "ops-bot",
    });
    expect(providerOrchestrator.setActiveProvider).toHaveBeenCalledWith("openai-responses");
    expect(mocks.prisma.approvalProjection.upsert).toHaveBeenCalledWith({
      where: {
        approvalId: "approval-1",
      },
      update: expect.objectContaining({
        actionType: "provider_change",
        status: "approved",
      }),
      create: expect.objectContaining({
        approvalId: "approval-1",
        actionType: "provider_change",
        status: "approved",
      }),
    });
    expect(v2EventService.appendEvent).toHaveBeenNthCalledWith(1, {
      type: "provider.activated",
      aggregateId: "openai-responses",
      actor: "ops-bot",
      payload: {
        provider_id: "openai-responses",
        approval_id: "approval-1",
      },
      correlationId: "approval-1",
    });
    expect(v2EventService.appendEvent).toHaveBeenNthCalledWith(2, {
      type: "policy.decision",
      aggregateId: "approval-1",
      actor: "ops-bot",
      payload: {
        approval_id: "approval-1",
        action_type: "provider_change",
        status: "approved",
        reason: null,
      },
      correlationId: "approval-1",
    });
    expect(response.json()).toEqual({
      ok: true,
      item: expect.objectContaining({
        id: "approval-1",
        actionType: "provider_change",
      }),
      commandExecution: null,
      lifecycleRequeue: null,
    });

    await app.close();
  });
});

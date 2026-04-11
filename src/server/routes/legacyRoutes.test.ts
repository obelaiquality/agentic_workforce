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
    auditService,
    chatService,
    providerOrchestrator,
    qwenAccountSetupService,
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

  it("lists providers", async () => {
    const { app, providerOrchestrator } = createHarness();
    providerOrchestrator.listProviders.mockResolvedValueOnce([{ id: "qwen-cli", label: "Qwen CLI" }]);

    const response = await app.inject({ method: "GET", url: "/api/v1/providers" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{ id: "qwen-cli", label: "Qwen CLI" }]);

    await app.close();
  });

  it("lists qwen accounts with date fields serialized", async () => {
    const { app, providerOrchestrator } = createHarness();
    providerOrchestrator.listQwenAccounts.mockResolvedValueOnce([
      {
        id: "acc-1",
        label: "Main",
        profilePath: "/home/user/.qwen",
        enabled: true,
        state: "ready",
        cooldownUntil: new Date("2026-01-01T00:00:00.000Z"),
        quotaNextUsableAt: new Date("2026-01-02T00:00:00.000Z"),
        quotaEtaConfidence: 0.95,
        lastQuotaErrorAt: new Date("2025-12-31T00:00:00.000Z"),
        lastUsedAt: new Date("2026-01-01T12:00:00.000Z"),
      },
      {
        id: "acc-2",
        label: "Disabled",
        profilePath: "/home/user/.qwen2",
        enabled: false,
        state: "ready",
        cooldownUntil: null,
        quotaNextUsableAt: null,
        quotaEtaConfidence: null,
        lastQuotaErrorAt: null,
        lastUsedAt: null,
      },
    ]);

    const response = await app.inject({ method: "GET", url: "/api/v1/providers/qwen/accounts" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(2);
    expect(body.items[0].id).toBe("acc-1");
    expect(body.items[0].state).toBe("ready");
    expect(body.items[0].cooldownUntil).toBe("2026-01-01T00:00:00.000Z");
    expect(body.items[0].quotaNextUsableAt).toBe("2026-01-02T00:00:00.000Z");
    expect(body.items[0].lastQuotaErrorAt).toBe("2025-12-31T00:00:00.000Z");
    expect(body.items[0].lastUsedAt).toBe("2026-01-01T12:00:00.000Z");
    // disabled account shows "disabled" state
    expect(body.items[1].state).toBe("disabled");
    expect(body.items[1].cooldownUntil).toBeNull();

    await app.close();
  });

  it("creates a qwen account", async () => {
    const { app, providerOrchestrator } = createHarness();
    providerOrchestrator.createQwenAccount.mockResolvedValueOnce({ id: "acc-new", label: "New" });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/providers/qwen/accounts",
      payload: { label: "New", profilePath: "/path" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, item: { id: "acc-new", label: "New" } });

    await app.close();
  });

  it("bootstraps a qwen account", async () => {
    const harness = createHarness();
    (harness as any).qwenAccountSetupService = undefined; // won't be used from harness
    const { app } = harness;
    // qwenAccountSetupService is already mocked in createHarness
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/providers/qwen/accounts/bootstrap",
      payload: { label: "Bootstrapped" },
    });
    // The route calls qwenAccountSetupService.bootstrapAccount
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("patches a qwen account", async () => {
    const { app, providerOrchestrator } = createHarness();
    providerOrchestrator.updateQwenAccount.mockResolvedValueOnce({ id: "acc-1", label: "Updated" });

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/providers/qwen/accounts/acc-1",
      payload: { label: "Updated" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, item: { id: "acc-1", label: "Updated" } });
    expect(providerOrchestrator.updateQwenAccount).toHaveBeenCalledWith("acc-1", { label: "Updated" });

    await app.close();
  });

  it("reauths a qwen account", async () => {
    const { app, providerOrchestrator } = createHarness();
    providerOrchestrator.markQwenAccountReauthed.mockResolvedValueOnce({ id: "acc-1", state: "ready" });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/providers/qwen/accounts/acc-1/reauth",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, item: { id: "acc-1", state: "ready" } });

    await app.close();
  });

  it("starts auth for a qwen account", async () => {
    const harness = createHarness();
    const { app } = harness;

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/providers/qwen/accounts/acc-1/auth/start",
    });
    expect(response.statusCode).toBe(200);

    await app.close();
  });

  it("lists qwen auth sessions", async () => {
    const harness = createHarness();
    const { app } = harness;

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/providers/qwen/accounts/auth-sessions",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });

    await app.close();
  });

  it("gets qwen quota overview", async () => {
    const { app, providerOrchestrator } = createHarness();
    providerOrchestrator.getQwenQuotaOverview.mockResolvedValueOnce([{ accountId: "acc-1", remaining: 100 }]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/providers/qwen/quota",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [{ accountId: "acc-1", remaining: 100 }] });

    await app.close();
  });

  it("lists chat sessions", async () => {
    const { app, chatService } = createHarness();
    chatService.listSessions.mockResolvedValueOnce([{ id: "sess-1", title: "Test" }]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/chat/sessions",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [{ id: "sess-1", title: "Test" }] });

    await app.close();
  });

  it("lists chat sessions filtered by repoId", async () => {
    const { app, chatService } = createHarness();
    chatService.listSessions.mockResolvedValueOnce([]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/chat/sessions?repoId=repo-1",
    });
    expect(response.statusCode).toBe(200);
    expect(chatService.listSessions).toHaveBeenCalledWith("repo-1");

    await app.close();
  });

  it("lists chat messages for a session", async () => {
    const { app, chatService } = createHarness();
    chatService.listMessages.mockResolvedValueOnce([{ id: "msg-1", content: "Hello" }]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/chat/sessions/sess-1/messages",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [{ id: "msg-1", content: "Hello" }] });
    expect(chatService.listMessages).toHaveBeenCalledWith("sess-1");

    await app.close();
  });

  it("creates a chat message with optional model role", async () => {
    const { app, chatService } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/chat/sessions/sess-1/messages",
      payload: {
        content: "Explain this code",
        modelRole: "review_deep",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, item: { id: "message-1" } });
    expect(chatService.createUserMessage).toHaveBeenCalledWith("sess-1", "Explain this code", {
      modelRole: "review_deep",
    });

    await app.close();
  });

  it("creates a chat session with Untitled title when omitted", async () => {
    const { app, chatService } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/chat/sessions",
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(chatService.createSession).toHaveBeenCalledWith("Untitled Session", "repo-active");

    await app.close();
  });

  it("lists tickets", async () => {
    const { app, ticketService } = createHarness();
    ticketService.listTickets.mockResolvedValueOnce([{ id: "t-1" }]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/tickets",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [{ id: "t-1" }] });

    await app.close();
  });

  it("lists tickets filtered by repoId", async () => {
    const { app, ticketService } = createHarness();
    ticketService.listTickets.mockResolvedValueOnce([]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/tickets?repoId=repo-x",
    });
    expect(response.statusCode).toBe(200);
    expect(ticketService.listTickets).toHaveBeenCalledWith("repo-x");

    await app.close();
  });

  it("updates a ticket and syncs task projection", async () => {
    const { app, ticketService } = createHarness();
    ticketService.updateTicket.mockResolvedValueOnce({ id: "t-1", title: "Updated" });

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/tickets/t-1",
      payload: { title: "Updated" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, item: { id: "t-1", title: "Updated" } });
    expect(ticketService.updateTicket).toHaveBeenCalledWith("t-1", { title: "Updated" });
    expect(mocks.syncTaskProjectionFromTicket).toHaveBeenCalledWith({ id: "t-1", title: "Updated" });
    expect(mocks.publishEvent).toHaveBeenCalledWith("global", "ticket.updated", { ticketId: "t-1" });

    await app.close();
  });

  it("moves a ticket and emits events", async () => {
    const { app, ticketService, v2EventService } = createHarness();
    ticketService.moveTicket.mockResolvedValueOnce({ id: "t-1", status: "done" });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tickets/t-1/move",
      payload: { status: "done" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, item: { id: "t-1", status: "done" } });
    expect(ticketService.moveTicket).toHaveBeenCalledWith("t-1", "done");
    expect(mocks.syncTaskProjectionFromTicket).toHaveBeenCalled();
    expect(v2EventService.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "task.transition",
        aggregateId: "t-1",
        actor: "user",
      })
    );
    expect(mocks.publishEvent).toHaveBeenCalledWith("global", "ticket.moved", {
      ticketId: "t-1",
      status: "done",
    });

    await app.close();
  });

  it("lists ticket comments", async () => {
    const { app, ticketService } = createHarness();
    ticketService.listTicketComments.mockResolvedValueOnce([{ id: "c-1", body: "LGTM" }]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/tickets/t-1/comments",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [{ id: "c-1", body: "LGTM" }] });

    await app.close();
  });

  it("adds a ticket comment and publishes event", async () => {
    const { app, ticketService } = createHarness();
    ticketService.addTicketComment.mockResolvedValueOnce({ id: "c-2", body: "Needs review" });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tickets/t-1/comments",
      payload: { body: "Needs review", author: "dev" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, item: { id: "c-2", body: "Needs review" } });
    expect(ticketService.addTicketComment).toHaveBeenCalledWith({
      ticketId: "t-1",
      author: "dev",
      body: "Needs review",
      parentCommentId: undefined,
    });
    expect(mocks.publishEvent).toHaveBeenCalledWith("global", "ticket.comment_added", {
      ticketId: "t-1",
      commentId: "c-2",
    });

    await app.close();
  });

  it("gets the board", async () => {
    const { app, ticketService } = createHarness();
    ticketService.getBoard.mockResolvedValueOnce([{ status: "backlog", tickets: [] }]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/board",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [{ status: "backlog", tickets: [] }] });

    await app.close();
  });

  it("gets the board filtered by repoId", async () => {
    const { app, ticketService } = createHarness();
    ticketService.getBoard.mockResolvedValueOnce([]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/board?repoId=repo-x",
    });
    expect(response.statusCode).toBe(200);
    expect(ticketService.getBoard).toHaveBeenCalledWith("repo-x");

    await app.close();
  });

  it("lists approvals", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/approvals",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });

    await app.close();
  });

  it("lists audit events with serialized dates", async () => {
    const harness = createHarness();
    const { app } = harness;
    // need to re-create harness so auditService is accessible
    await app.close();

    const app2 = Fastify();
    const auditService2 = {
      listEvents: vi.fn().mockResolvedValue([
        {
          id: "evt-1",
          actor: "user",
          eventType: "task.created",
          payload: { foo: "bar" },
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ]),
    };
    registerLegacyRoutes({
      app: app2,
      approvalService: { listApprovals: vi.fn().mockResolvedValue([]) } as never,
      auditService: auditService2 as never,
      chatService: { listSessions: vi.fn() } as never,
      commandEngine: {} as never,
      providerOrchestrator: { listProviders: vi.fn() } as never,
      qwenAccountSetupService: {} as never,
      ticketService: {} as never,
      v2EventService: { appendEvent: vi.fn() } as never,
    });

    const response = await app2.inject({
      method: "GET",
      url: "/api/v1/audit/events",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe("evt-1");
    expect(body.items[0].actor).toBe("user");
    expect(body.items[0].eventType).toBe("task.created");
    expect(body.items[0].createdAt).toBe("2026-01-01T00:00:00.000Z");

    await app2.close();
  });

  it("lists run events with serialized dates", async () => {
    mocks.prisma.runEvent.findMany.mockResolvedValueOnce([
      {
        id: "re-1",
        runId: "run-1",
        kind: "started",
        payload: {},
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    ]);

    const { app } = createHarness();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/runs/events",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe("re-1");
    expect(body.items[0].runId).toBe("run-1");
    expect(body.items[0].kind).toBe("started");
    expect(body.items[0].createdAt).toBe("2026-02-01T00:00:00.000Z");

    await app.close();
  });

  it("has the SSE stream route registered", async () => {
    const { app } = createHarness();

    // Verify the route exists by checking Fastify's route table
    const routes = app.printRoutes({ commonPrefix: false });
    expect(routes).toContain("/:id/stream");

    await app.close();
  });

  it("handles approved execution_request approvals", async () => {
    const { app, approvalService, v2EventService } = createHarness();
    approvalService.decideApproval.mockResolvedValueOnce({
      id: "approval-2",
      actionType: "execution_request",
      status: "approved",
      reason: null,
      decidedBy: "user",
      requestedAt: new Date("2026-03-24T07:00:00.000Z"),
      decidedAt: new Date("2026-03-24T07:05:00.000Z"),
      payload: {
        run_id: "run-42",
        prompt: "Build feature",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/approvals/approval-2/decide",
      payload: {
        decision: "approved",
        decidedBy: "user",
      },
    });

    expect(response.statusCode).toBe(200);
    // Should have appended execution.requested event
    expect(v2EventService.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "execution.requested",
        aggregateId: "run-42",
        actor: "user",
        payload: expect.objectContaining({
          status: "queued",
          approved_via: "approval-2",
        }),
      })
    );

    await app.close();
  });

  it("uses approval.id as runId when payload.run_id is missing for execution_request", async () => {
    const { app, approvalService, v2EventService } = createHarness();
    approvalService.decideApproval.mockResolvedValueOnce({
      id: "approval-3",
      actionType: "execution_request",
      status: "approved",
      reason: null,
      decidedBy: "user",
      requestedAt: new Date("2026-03-24T07:00:00.000Z"),
      decidedAt: new Date("2026-03-24T07:05:00.000Z"),
      payload: {
        prompt: "Build feature",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/approvals/approval-3/decide",
      payload: {
        decision: "approved",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(v2EventService.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "execution.requested",
        aggregateId: "approval-3",
      })
    );

    await app.close();
  });

  it("does not fire execution_request path for rejected decisions", async () => {
    const { app, approvalService, v2EventService } = createHarness();
    approvalService.decideApproval.mockResolvedValueOnce({
      id: "approval-4",
      actionType: "execution_request",
      status: "rejected",
      reason: "not needed",
      decidedBy: "user",
      requestedAt: new Date("2026-03-24T07:00:00.000Z"),
      decidedAt: new Date("2026-03-24T07:05:00.000Z"),
      payload: { run_id: "run-99" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/approvals/approval-4/decide",
      payload: {
        decision: "rejected",
        reason: "not needed",
      },
    });

    expect(response.statusCode).toBe(200);
    // Should NOT have fired execution.requested
    const executionRequestedCalls = v2EventService.appendEvent.mock.calls.filter(
      (call: unknown[]) => (call[0] as { type: string }).type === "execution.requested"
    );
    expect(executionRequestedCalls).toHaveLength(0);

    await app.close();
  });

  it("creates tickets with explicit repoId overriding active repo", async () => {
    const { app, ticketService } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tickets",
      payload: {
        title: "Explicit repo ticket",
        repoId: "repo-explicit",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(ticketService.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: "repo-explicit",
      }),
    );

    await app.close();
  });

  it("creates chat session with explicit repoId overriding active repo", async () => {
    const { app, chatService } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/chat/sessions",
      payload: {
        title: "Session in specific repo",
        repoId: "repo-explicit",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(chatService.createSession).toHaveBeenCalledWith("Session in specific repo", "repo-explicit");

    await app.close();
  });

  it("adds a ticket comment without author and publishes event", async () => {
    const { app, ticketService } = createHarness();
    ticketService.addTicketComment.mockResolvedValueOnce({ id: "c-3", body: "Auto comment" });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tickets/t-1/comments",
      payload: { body: "Auto comment" },
    });
    expect(response.statusCode).toBe(200);
    expect(ticketService.addTicketComment).toHaveBeenCalledWith(
      expect.objectContaining({
        author: undefined,
        parentCommentId: undefined,
      }),
    );

    await app.close();
  });

  it("adds a ticket comment with parentCommentId", async () => {
    const { app, ticketService } = createHarness();
    ticketService.addTicketComment.mockResolvedValueOnce({ id: "c-4", body: "Reply" });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tickets/t-1/comments",
      payload: { body: "Reply", parentCommentId: "c-1" },
    });
    expect(response.statusCode).toBe(200);
    expect(ticketService.addTicketComment).toHaveBeenCalledWith(
      expect.objectContaining({
        parentCommentId: "c-1",
      }),
    );

    await app.close();
  });

  it("handles approval decision where provider_change payload has no providerId", async () => {
    const { app, approvalService, providerOrchestrator } = createHarness();
    approvalService.decideApproval.mockResolvedValueOnce({
      id: "approval-no-pid",
      actionType: "provider_change",
      status: "approved",
      reason: null,
      decidedBy: "user",
      requestedAt: new Date("2026-03-24T07:00:00.000Z"),
      decidedAt: new Date("2026-03-24T07:05:00.000Z"),
      payload: {},
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/approvals/approval-no-pid/decide",
      payload: {
        decision: "approved",
      },
    });

    expect(response.statusCode).toBe(200);
    // Should NOT call setActiveProvider since payload.providerId is not a string
    expect(providerOrchestrator.setActiveProvider).not.toHaveBeenCalled();

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

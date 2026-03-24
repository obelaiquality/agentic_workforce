import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { eventBus, publishEvent } from "../eventBus";
import { ApprovalService } from "../services/approvalService";
import { AuditService } from "../services/auditService";
import { ChatService } from "../services/chatService";
import { CommandEngine } from "../services/commandEngine";
import { ProviderOrchestrator } from "../services/providerOrchestrator";
import { QwenAccountSetupService } from "../services/qwenAccountSetupService";
import { TicketService } from "../services/ticketService";
import { V2EventService } from "../services/v2EventService";
import { handleCommandInvocationApprovalDecision } from "./shared/commandApproval";
import { buildStreamHeaders } from "./shared/http";
import { mapLegacyToLifecycle, syncTaskProjectionFromTicket } from "./shared/ticketProjection";
import type { TicketStatus } from "../../shared/contracts";

const createTicketSchema = z.object({
  repoId: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["backlog", "ready", "in_progress", "review", "blocked", "done"]).optional(),
  priority: z.enum(["p0", "p1", "p2", "p3"]).optional(),
  risk: z.enum(["low", "medium", "high"]).optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
});

const updateTicketSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  priority: z.enum(["p0", "p1", "p2", "p3"]).optional(),
  risk: z.enum(["low", "medium", "high"]).optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
});

const moveTicketSchema = z.object({
  status: z.enum(["backlog", "ready", "in_progress", "review", "blocked", "done"]),
});

const createTicketCommentSchema = z.object({
  author: z.string().trim().min(1).max(80).optional(),
  body: z.string().trim().min(1),
  parentCommentId: z.string().trim().min(1).optional(),
});

const createChatSessionSchema = z.object({
  title: z.string().min(1).optional(),
  repoId: z.string().optional(),
});

const createMessageSchema = z.object({
  content: z.string().min(1),
  modelRole: z.enum(["utility_fast", "coder_default", "review_deep", "overseer_escalation"]).optional(),
});

const setActiveProviderSchema = z.object({
  providerId: z.enum(["qwen-cli", "openai-compatible", "onprem-qwen", "openai-responses"]),
});

const createAccountSchema = z.object({
  label: z.string().min(1),
  profilePath: z.string().min(1),
  keychainRef: z.string().optional(),
});

const updateAccountSchema = z.object({
  label: z.string().optional(),
  profilePath: z.string().optional(),
  enabled: z.boolean().optional(),
  state: z.enum(["ready", "cooldown", "auth_required", "disabled"]).optional(),
});

const bootstrapQwenAccountSchema = z.object({
  label: z.string().min(1),
  importCurrentAuth: z.boolean().optional(),
});

const decideApprovalSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().optional(),
  decidedBy: z.string().optional(),
});

type LegacyRouteDeps = {
  app: FastifyInstance;
  approvalService: ApprovalService;
  auditService: AuditService;
  chatService: ChatService;
  commandEngine: CommandEngine;
  providerOrchestrator: ProviderOrchestrator;
  qwenAccountSetupService: QwenAccountSetupService;
  ticketService: TicketService;
  v2EventService: V2EventService;
};

export function registerLegacyRoutes(deps: LegacyRouteDeps) {
  const {
    app,
    approvalService,
    auditService,
    chatService,
    commandEngine,
    providerOrchestrator,
    qwenAccountSetupService,
    ticketService,
    v2EventService,
  } = deps;

  app.get("/api/v1/providers", async () => providerOrchestrator.listProviders());

  app.post("/api/v1/providers/active", async (request, reply) => {
    const input = setActiveProviderSchema.parse(request.body);
    const safety = await prisma.appSetting.findUnique({ where: { key: "safety_policy" } });
    const policy = (safety?.value as Record<string, unknown>) || {};

    if (policy.requireApprovalForProviderChanges === true) {
      const approval = await prisma.approvalRequest.create({
        data: {
          actionType: "provider_change",
          payload: {
            providerId: input.providerId,
          },
        },
      });

      publishEvent("global", "approval.requested", {
        approvalId: approval.id,
        actionType: approval.actionType,
      });

      return reply.send({ ok: true, requiresApproval: true, approvalId: approval.id });
    }

    await providerOrchestrator.setActiveProvider(input.providerId);
    await v2EventService.appendEvent({
      type: "provider.activated",
      aggregateId: input.providerId,
      actor: "user",
      payload: {
        provider_id: input.providerId,
      },
    });

    publishEvent("global", "provider.switched", {
      providerId: input.providerId,
    });

    return reply.send({ ok: true });
  });

  app.get("/api/v1/providers/qwen/accounts", async () => {
    const accounts = await providerOrchestrator.listQwenAccounts();
    return {
      items: accounts.map((account) => ({
        id: account.id,
        label: account.label,
        profilePath: account.profilePath,
        enabled: account.enabled,
        state: account.enabled ? account.state : "disabled",
        cooldownUntil: account.cooldownUntil?.toISOString() ?? null,
        quotaNextUsableAt: account.quotaNextUsableAt?.toISOString() ?? null,
        quotaEtaConfidence: account.quotaEtaConfidence,
        lastQuotaErrorAt: account.lastQuotaErrorAt?.toISOString() ?? null,
        lastUsedAt: account.lastUsedAt?.toISOString() ?? null,
      })),
    };
  });

  app.post("/api/v1/providers/qwen/accounts", async (request) => {
    const input = createAccountSchema.parse(request.body);
    const account = await providerOrchestrator.createQwenAccount(input);
    return { ok: true, item: account };
  });

  app.post("/api/v1/providers/qwen/accounts/bootstrap", async (request) => {
    const input = bootstrapQwenAccountSchema.parse(request.body);
    const account = await qwenAccountSetupService.bootstrapAccount(input);
    return { ok: true, item: account };
  });

  app.patch("/api/v1/providers/qwen/accounts/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    const patch = updateAccountSchema.parse(request.body);
    const account = await providerOrchestrator.updateQwenAccount(id, patch);
    return { ok: true, item: account };
  });

  app.post("/api/v1/providers/qwen/accounts/:id/reauth", async (request) => {
    const id = (request.params as { id: string }).id;
    const account = await providerOrchestrator.markQwenAccountReauthed(id);
    return { ok: true, item: account };
  });

  app.post("/api/v1/providers/qwen/accounts/:id/auth/start", async (request) => {
    const id = (request.params as { id: string }).id;
    const item = await qwenAccountSetupService.startAuth(id);
    return { ok: true, item };
  });

  app.get("/api/v1/providers/qwen/accounts/auth-sessions", async () => {
    return {
      items: await qwenAccountSetupService.listAuthSessions(),
    };
  });

  app.get("/api/v1/providers/qwen/quota", async () => {
    return {
      items: await providerOrchestrator.getQwenQuotaOverview(),
    };
  });

  app.get("/api/v1/chat/sessions", async (request) => {
    const query = request.query as { repoId?: string };
    return {
      items: await chatService.listSessions(query?.repoId),
    };
  });

  app.post("/api/v1/chat/sessions", async (request) => {
    const input = createChatSessionSchema.parse(request.body);
    const activeRepoSetting = await prisma.appSetting.findUnique({ where: { key: "active_repo" } });
    const session = await chatService.createSession(
      input.title || "Untitled Session",
      input.repoId || (typeof activeRepoSetting?.value === "string" ? activeRepoSetting.value : null)
    );
    return { ok: true, item: session };
  });

  app.get("/api/v1/chat/sessions/:id/messages", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      items: await chatService.listMessages(id),
    };
  });

  app.post("/api/v1/chat/sessions/:id/messages", async (request) => {
    const id = (request.params as { id: string }).id;
    const input = createMessageSchema.parse(request.body);
    const message = await chatService.createUserMessage(id, input.content, {
      modelRole: input.modelRole,
    });
    return {
      ok: true,
      item: message,
    };
  });

  app.get("/api/v1/chat/sessions/:id/stream", async (request, reply) => {
    const id = (request.params as { id: string }).id;

    reply.hijack();
    reply.raw.writeHead(200, buildStreamHeaders(typeof request.headers.origin === "string" ? request.headers.origin : null));

    const send = (eventName: string, payload: unknown) => {
      reply.raw.write(`event: ${eventName}\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    send("connected", { sessionId: id });

    const stopSession = eventBus.subscribe(`session:${id}`, (event) => {
      send(event.type, event);
    });

    const stopGlobal = eventBus.subscribe("global", (event) => {
      send(event.type, event);
    });

    const heartbeat = setInterval(() => {
      send("heartbeat", { now: new Date().toISOString() });
    }, 15000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      stopSession();
      stopGlobal();
      reply.raw.end();
    });

    return reply;
  });

  app.get("/api/v1/tickets", async (request) => {
    const query = request.query as { repoId?: string };
    return {
      items: await ticketService.listTickets(query.repoId),
    };
  });

  app.post("/api/v1/tickets", async (request) => {
    const input = createTicketSchema.parse(request.body);
    const activeRepoSetting = await prisma.appSetting.findUnique({ where: { key: "active_repo" } });
    const ticket = await ticketService.createTicket({
      ...input,
      repoId: input.repoId || (typeof activeRepoSetting?.value === "string" ? activeRepoSetting.value : null),
    });
    await syncTaskProjectionFromTicket(ticket);
    await v2EventService.appendEvent({
      type: "task.created",
      aggregateId: ticket.id,
      actor: "user",
      payload: {
        ticket_id: ticket.id,
        title: ticket.title,
        description: ticket.description,
        priority: ticket.priority,
        risk: ticket.risk,
        acceptance_criteria: ticket.acceptanceCriteria,
        dependencies: ticket.dependencies,
      },
    });

    publishEvent("global", "ticket.created", { ticketId: ticket.id, status: ticket.status });

    return {
      ok: true,
      item: ticket,
    };
  });

  app.patch("/api/v1/tickets/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    const patch = updateTicketSchema.parse(request.body);
    const ticket = await ticketService.updateTicket(id, patch);
    await syncTaskProjectionFromTicket(ticket);

    publishEvent("global", "ticket.updated", { ticketId: id });

    return {
      ok: true,
      item: ticket,
    };
  });

  app.post("/api/v1/tickets/:id/move", async (request) => {
    const id = (request.params as { id: string }).id;
    const input = moveTicketSchema.parse(request.body);

    const ticket = await ticketService.moveTicket(id, input.status as TicketStatus);
    await syncTaskProjectionFromTicket(ticket);
    await v2EventService.appendEvent({
      type: "task.transition",
      aggregateId: id,
      actor: "user",
      payload: {
        ticket_id: id,
        status: mapLegacyToLifecycle(ticket.status),
      },
    });

    publishEvent("global", "ticket.moved", {
      ticketId: id,
      status: input.status,
    });

    return {
      ok: true,
      item: ticket,
    };
  });

  app.get("/api/v1/tickets/:id/comments", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      items: await ticketService.listTicketComments(id),
    };
  });

  app.post("/api/v1/tickets/:id/comments", async (request) => {
    const id = (request.params as { id: string }).id;
    const input = createTicketCommentSchema.parse(request.body);
    const comment = await ticketService.addTicketComment({
      ticketId: id,
      author: input.author,
      body: input.body,
      parentCommentId: input.parentCommentId,
    });

    publishEvent("global", "ticket.comment_added", {
      ticketId: id,
      commentId: comment.id,
    });

    return {
      ok: true,
      item: comment,
    };
  });

  app.get("/api/v1/board", async (request) => {
    const query = request.query as { repoId?: string };
    return {
      items: await ticketService.getBoard(query.repoId),
    };
  });

  app.get("/api/v1/approvals", async () => ({
    items: await approvalService.listApprovals(),
  }));

  app.post("/api/v1/approvals/:id/decide", async (request) => {
    const id = (request.params as { id: string }).id;
    const input = decideApprovalSchema
      .extend({
        executeApprovedCommand: z.boolean().optional(),
        requeueBlockedStage: z.boolean().optional(),
      })
      .parse(request.body);
    const approval = await approvalService.decideApproval(id, input);

    if (input.decision === "approved" && approval.actionType === "provider_change") {
      const payload = approval.payload as Record<string, unknown>;
      if (typeof payload.providerId === "string") {
        await providerOrchestrator.setActiveProvider(payload.providerId as "qwen-cli" | "openai-compatible" | "onprem-qwen" | "openai-responses");
        await v2EventService.appendEvent({
          type: "provider.activated",
          aggregateId: payload.providerId,
          actor: input.decidedBy ?? "user",
          payload: {
            provider_id: payload.providerId,
            approval_id: approval.id,
          },
          correlationId: approval.id,
        });
      }
    }

    if (input.decision === "approved" && approval.actionType === "execution_request") {
      const payload = approval.payload as Record<string, unknown>;
      const runId = typeof payload.run_id === "string" ? payload.run_id : approval.id;
      await v2EventService.appendEvent({
        type: "execution.requested",
        aggregateId: runId,
        actor: input.decidedBy ?? "user",
        payload: {
          ...payload,
          status: "queued",
          approved_via: approval.id,
        },
        correlationId: approval.id,
      });
    }

    const followup = await handleCommandInvocationApprovalDecision({
      approval,
      decision: input.decision,
      actor: input.decidedBy ?? "user",
      executeApprovedCommand: input.executeApprovedCommand !== false,
      requeueBlockedStage: input.requeueBlockedStage !== false,
      ticketService,
      commandEngine,
      v2EventService,
    });

    await prisma.approvalProjection.upsert({
      where: { approvalId: approval.id },
      update: {
        actionType: approval.actionType,
        status: approval.status,
        reason: approval.reason,
        payload: approval.payload,
        requestedAt: approval.requestedAt,
        decidedAt: approval.decidedAt,
      },
      create: {
        approvalId: approval.id,
        actionType: approval.actionType,
        status: approval.status,
        reason: approval.reason,
        payload: approval.payload,
        requestedAt: approval.requestedAt,
        decidedAt: approval.decidedAt,
      },
    });

    await v2EventService.appendEvent({
      type: "policy.decision",
      aggregateId: approval.id,
      actor: input.decidedBy ?? "user",
      payload: {
        approval_id: approval.id,
        action_type: approval.actionType,
        status: input.decision,
        reason: input.reason ?? null,
      },
      correlationId: approval.id,
    });

    publishEvent("global", "approval.decided", {
      approvalId: id,
      decision: input.decision,
    });

    return {
      ok: true,
      item: approval,
      commandExecution: followup.commandExecution,
      lifecycleRequeue: followup.requeue,
    };
  });

  app.get("/api/v1/audit/events", async () => {
    const events = await auditService.listEvents();
    return {
      items: events.map((event) => ({
        id: event.id,
        actor: event.actor,
        eventType: event.eventType,
        payload: event.payload,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  });

  app.get("/api/v1/runs/events", async () => {
    const events = await prisma.runEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return {
      items: events.map((event) => ({
        id: event.id,
        runId: event.runId,
        kind: event.kind,
        payload: event.payload,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  });
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { publishEvent } from "../eventBus";
import { ApprovalService } from "../services/approvalService";
import { ChannelService } from "../services/channelService";
import { CommandEngine } from "../services/commandEngine";
import { ExecutionService } from "../services/executionService";
import { ProjectBlueprintService } from "../services/projectBlueprintService";
import { RepoService } from "../services/repoService";
import { TicketService } from "../services/ticketService";
import { V2EventService } from "../services/v2EventService";
import { decideApprovalWithCommandFollowup } from "./shared/commandApproval";

const experimentalChannelSourceSchema = z.enum(["webhook", "telegram", "ci_monitoring"]);

const experimentalChannelEventSchema = z.object({
  source: experimentalChannelSourceSchema,
  sender_id: z.string().min(1),
  content: z.string().min(1),
  project_id: z.string().optional(),
  ticket_id: z.string().optional(),
  run_id: z.string().optional(),
  session_id: z.string().optional(),
  reply_supported: z.boolean().optional(),
});

const experimentalApprovalRelaySchema = z.object({
  source: experimentalChannelSourceSchema,
  sender_id: z.string().min(1),
  replay_id: z.string().min(1),
  approval_id: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().optional(),
});

type ChannelRouteDeps = {
  app: FastifyInstance;
  approvalService: ApprovalService;
  channelService: ChannelService;
  commandEngine: CommandEngine;
  executionService: ExecutionService;
  projectBlueprintService: ProjectBlueprintService;
  repoService: RepoService;
  ticketService: TicketService;
  v2EventService: V2EventService;
};

export function registerChannelRoutes(deps: ChannelRouteDeps) {
  const {
    app,
    approvalService,
    channelService,
    commandEngine,
    executionService,
    projectBlueprintService,
    repoService,
    ticketService,
    v2EventService,
  } = deps;

  app.get("/api/v1/experimental/channels/activity", async (request) => {
    const query = z.object({ projectId: z.string().optional() }).parse(request.query);
    return {
      items: await channelService.listRecentActivity(query.projectId || null),
    };
  });

  app.post("/api/v1/experimental/channels/events", async (request) => {
    const body = experimentalChannelEventSchema.parse(request.body);
    const signingSecret = typeof request.headers["x-channel-secret"] === "string" ? request.headers["x-channel-secret"] : null;
    return {
      item: await channelService.ingestEvent({
        source: body.source,
        senderId: body.sender_id,
        content: body.content,
        projectId: body.project_id || null,
        ticketId: body.ticket_id || null,
        runId: body.run_id || null,
        sessionId: body.session_id || null,
        replySupported: body.reply_supported,
        signingSecret,
      }),
    };
  });

  app.post("/api/v1/experimental/channels/approval/relay", async (request) => {
    const body = experimentalApprovalRelaySchema.parse(request.body);
    const signingSecret = typeof request.headers["x-channel-secret"] === "string" ? request.headers["x-channel-secret"] : null;
    const actor = `channel:${body.source}:${body.sender_id}`;

    await channelService.validateApprovalRelay({
      source: body.source,
      senderId: body.sender_id,
      replayId: body.replay_id,
      signingSecret,
    });

    try {
      const result = await decideApprovalWithCommandFollowup({
        approvalId: body.approval_id,
        decision: body.decision,
        reason: body.reason,
        actor,
        executeApprovedCommand: true,
        requeueBlockedStage: true,
        approvalService,
        executionService,
        projectBlueprintService,
        repoService,
        ticketService,
        commandEngine,
        v2EventService,
      });

      publishEvent("global", "approval.relayed", {
        approvalId: body.approval_id,
        senderId: body.sender_id,
        source: body.source,
        decision: body.decision,
      });

      return {
        item: result.item,
        command_execution: result.commandExecution,
        lifecycle_requeue: result.lifecycleRequeue,
      };
    } catch (error) {
      publishEvent("global", "approval.relay.failed", {
        approvalId: body.approval_id,
        senderId: body.sender_id,
        source: body.source,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });
}

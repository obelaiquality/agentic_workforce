import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerChannelRoutes } from "./channelRoutes";
import { registerLegacyRoutes } from "./legacyRoutes";

function createLegacyHarness() {
  const app = Fastify();
  registerLegacyRoutes({
    app,
    approvalService: {} as never,
    auditService: {} as never,
    chatService: {} as never,
    commandEngine: {} as never,
    providerOrchestrator: {} as never,
    qwenAccountSetupService: {} as never,
    ticketService: {} as never,
    v2EventService: {} as never,
  });
  return { app };
}

function createChannelHarness() {
  const app = Fastify();
  const approvalService = {
    decideApproval: vi.fn().mockResolvedValue({
      id: "approval-1",
      actionType: "command_tool_invocation",
      status: "approved",
      reason: null,
      decidedBy: "channel:webhook:ops-bot",
      requestedAt: new Date("2026-03-24T07:00:00.000Z"),
      decidedAt: new Date("2026-03-24T07:05:00.000Z"),
      payload: {
        run_id: "run-1",
        ticket_id: "ticket-1",
        repo_id: "repo-1",
        stage: "build",
        display_command: "npm test",
        worktree_path: "/repo",
      },
    }),
  };
  const channelService = {
    listRecentActivity: vi.fn().mockResolvedValue({ channels: [], subagents: [] }),
    ingestEvent: vi.fn().mockResolvedValue({ event: { id: "event-1" }, subagents: [] }),
    validateApprovalRelay: vi.fn().mockResolvedValue(undefined),
  };
  const commandEngine = {
    invoke: vi.fn().mockResolvedValue({
      event: {
        id: "tool-1",
        policyDecision: "allowed",
        exitCode: 0,
        summary: "Command completed.",
      },
    }),
  };
  const ticketService = {
    getTicket: vi.fn().mockResolvedValue({
      id: "ticket-1",
      repoId: "repo-1",
      status: "in_progress",
    }),
  };
  const v2EventService = {
    appendEvent: vi.fn().mockResolvedValue(undefined),
  };

  registerChannelRoutes({
    app,
    approvalService: approvalService as never,
    channelService: channelService as never,
    commandEngine: commandEngine as never,
    ticketService: ticketService as never,
    v2EventService: v2EventService as never,
  });

  return { app, approvalService, channelService, commandEngine, v2EventService };
}

describe("channel route extraction", () => {
  it("keeps experimental channels out of legacy routes", async () => {
    const { app } = createLegacyHarness();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/experimental/channels/activity",
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it("handles approval relay directly from the dedicated channel routes", async () => {
    const { app, approvalService, channelService, commandEngine, v2EventService } = createChannelHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/experimental/channels/approval/relay",
      headers: {
        "x-channel-secret": "shared-secret",
      },
      payload: {
        source: "webhook",
        sender_id: "ops-bot",
        replay_id: "replay-1",
        approval_id: "approval-1",
        decision: "approved",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(channelService.validateApprovalRelay).toHaveBeenCalledWith({
      source: "webhook",
      senderId: "ops-bot",
      replayId: "replay-1",
      signingSecret: "shared-secret",
    });
    expect(approvalService.decideApproval).toHaveBeenCalledWith("approval-1", {
      decision: "approved",
      reason: undefined,
      decidedBy: "channel:webhook:ops-bot",
    });
    expect(commandEngine.invoke).toHaveBeenCalled();
    expect(v2EventService.appendEvent).toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      item: { id: "approval-1" },
      command_execution: { toolEventId: "tool-1" },
      lifecycle_requeue: null,
    });

    await app.close();
  });
});

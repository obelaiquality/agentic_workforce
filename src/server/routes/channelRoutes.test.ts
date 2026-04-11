import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  publishEvent: vi.fn(),
  decideApprovalWithCommandFollowup: vi.fn(),
}));

vi.mock("../eventBus", () => ({
  publishEvent: mocks.publishEvent,
}));

vi.mock("./shared/commandApproval", () => ({
  decideApprovalWithCommandFollowup: mocks.decideApprovalWithCommandFollowup,
}));

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

  const executionService = {};
  const projectBlueprintService = {};
  const repoService = {};

  registerChannelRoutes({
    app,
    approvalService: approvalService as never,
    channelService: channelService as never,
    commandEngine: commandEngine as never,
    executionService: executionService as never,
    projectBlueprintService: projectBlueprintService as never,
    repoService: repoService as never,
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
    const { app, channelService } = createChannelHarness();

    mocks.decideApprovalWithCommandFollowup.mockResolvedValueOnce({
      item: { id: "approval-1", actionType: "command_tool_invocation", status: "approved" },
      commandExecution: { toolEventId: "tool-1" },
      lifecycleRequeue: null,
    });

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
    expect(mocks.decideApprovalWithCommandFollowup).toHaveBeenCalled();
    expect(mocks.publishEvent).toHaveBeenCalledWith("global", "approval.relayed", expect.objectContaining({
      approvalId: "approval-1",
      decision: "approved",
    }));
    expect(response.json()).toMatchObject({
      item: { id: "approval-1" },
      command_execution: { toolEventId: "tool-1" },
      lifecycle_requeue: null,
    });

    await app.close();
  });

  it("lists recent channel activity", async () => {
    const { app, channelService } = createChannelHarness();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/experimental/channels/activity",
    });

    expect(response.statusCode).toBe(200);
    expect(channelService.listRecentActivity).toHaveBeenCalledWith(null);
    expect(response.json()).toEqual({ items: { channels: [], subagents: [] } });

    await app.close();
  });

  it("lists recent channel activity filtered by projectId", async () => {
    const { app, channelService } = createChannelHarness();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/experimental/channels/activity?projectId=proj-1",
    });

    expect(response.statusCode).toBe(200);
    expect(channelService.listRecentActivity).toHaveBeenCalledWith("proj-1");

    await app.close();
  });

  it("ingests a channel event with all optional fields", async () => {
    const { app, channelService } = createChannelHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/experimental/channels/events",
      headers: {
        "x-channel-secret": "my-secret",
      },
      payload: {
        source: "telegram",
        sender_id: "user-42",
        content: "Deploy to staging",
        project_id: "proj-1",
        ticket_id: "ticket-5",
        run_id: "run-3",
        session_id: "sess-7",
        reply_supported: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(channelService.ingestEvent).toHaveBeenCalledWith({
      source: "telegram",
      senderId: "user-42",
      content: "Deploy to staging",
      projectId: "proj-1",
      ticketId: "ticket-5",
      runId: "run-3",
      sessionId: "sess-7",
      replySupported: true,
      signingSecret: "my-secret",
    });
    expect(response.json()).toEqual({
      item: { event: { id: "event-1" }, subagents: [] },
    });

    await app.close();
  });

  it("ingests a channel event with minimal fields and no secret", async () => {
    const { app, channelService } = createChannelHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/experimental/channels/events",
      payload: {
        source: "ci_monitoring",
        sender_id: "ci-bot",
        content: "Build failed",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(channelService.ingestEvent).toHaveBeenCalledWith({
      source: "ci_monitoring",
      senderId: "ci-bot",
      content: "Build failed",
      projectId: null,
      ticketId: null,
      runId: null,
      sessionId: null,
      replySupported: undefined,
      signingSecret: null,
    });

    await app.close();
  });

  it("publishes approval.relay.failed event on relay error and rethrows", async () => {
    const { app, channelService } = createChannelHarness();

    mocks.decideApprovalWithCommandFollowup.mockRejectedValueOnce(new Error("Approval not found"));

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
        approval_id: "approval-missing",
        decision: "approved",
      },
    });

    expect(response.statusCode).toBe(500);
    expect(mocks.publishEvent).toHaveBeenCalledWith("global", "approval.relay.failed", {
      approvalId: "approval-missing",
      senderId: "ops-bot",
      source: "webhook",
      error: "Approval not found",
    });

    await app.close();
  });

  it("publishes approval.relay.failed with stringified non-Error objects", async () => {
    const { app } = createChannelHarness();

    mocks.decideApprovalWithCommandFollowup.mockRejectedValueOnce("string error");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/experimental/channels/approval/relay",
      headers: {
        "x-channel-secret": "shared-secret",
      },
      payload: {
        source: "telegram",
        sender_id: "ops-bot",
        replay_id: "replay-2",
        approval_id: "approval-x",
        decision: "rejected",
        reason: "nope",
      },
    });

    expect(response.statusCode).toBe(500);
    expect(mocks.publishEvent).toHaveBeenCalledWith("global", "approval.relay.failed", expect.objectContaining({
      error: "string error",
    }));

    await app.close();
  });
});

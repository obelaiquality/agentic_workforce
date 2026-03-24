import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { publishEvent } from "../eventBus";
import { ChatService } from "./chatService";
import type {
  ChannelEventRecord,
  ChannelSource,
  ExperimentalChannelsConfig,
  SubagentActivityRecord,
  SubagentRole,
} from "../../shared/contracts";

const CHANNEL_CONFIG_KEY = "experimental_channels_config";
const CHANNEL_REPLAY_GUARD_KEY = "experimental_channel_approval_replay_guard";

function asRecord(value: unknown) {
  return (value ?? {}) as Record<string, unknown>;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function defaultConfig(): ExperimentalChannelsConfig {
  return {
    enabled: false,
    senderAllowlist: [],
    defaultProjectId: null,
    defaultSessionId: null,
    allowRemoteApprovals: false,
    allowUnattendedReadOnly: false,
    webhook: {
      enabled: false,
      signingSecret: "",
    },
    telegram: {
      enabled: false,
      signingSecret: "",
    },
    ciMonitoring: {
      enabled: false,
      signingSecret: "",
    },
  };
}

function normalizeConfig(value: unknown): ExperimentalChannelsConfig {
  const raw = asRecord(value);
  const webhook = asRecord(raw.webhook);
  const telegram = asRecord(raw.telegram);
  const ciMonitoring = asRecord(raw.ciMonitoring);

  return {
    enabled: Boolean(raw.enabled),
    senderAllowlist: asStringArray(raw.senderAllowlist),
    defaultProjectId: typeof raw.defaultProjectId === "string" && raw.defaultProjectId.trim() ? raw.defaultProjectId : null,
    defaultSessionId: typeof raw.defaultSessionId === "string" && raw.defaultSessionId.trim() ? raw.defaultSessionId : null,
    allowRemoteApprovals: Boolean(raw.allowRemoteApprovals),
    allowUnattendedReadOnly: Boolean(raw.allowUnattendedReadOnly),
    webhook: {
      enabled: Boolean(webhook.enabled),
      signingSecret: typeof webhook.signingSecret === "string" ? webhook.signingSecret : "",
    },
    telegram: {
      enabled: Boolean(telegram.enabled),
      signingSecret: typeof telegram.signingSecret === "string" ? telegram.signingSecret : "",
    },
    ciMonitoring: {
      enabled: Boolean(ciMonitoring.enabled),
      signingSecret: typeof ciMonitoring.signingSecret === "string" ? ciMonitoring.signingSecret : "",
    },
  };
}

function channelEnabled(config: ExperimentalChannelsConfig, source: ChannelSource) {
  if (!config.enabled) return false;
  if (source === "webhook") return config.webhook.enabled;
  if (source === "telegram") return config.telegram.enabled;
  return config.ciMonitoring.enabled;
}

function channelSecret(config: ExperimentalChannelsConfig, source: ChannelSource) {
  if (source === "webhook") return config.webhook.signingSecret;
  if (source === "telegram") return config.telegram.signingSecret;
  return config.ciMonitoring.signingSecret;
}

function planSubagentRoles(input: {
  source: ChannelSource;
  content: string;
  allowUnattendedReadOnly: boolean;
}): Array<{ role: SubagentRole; status: SubagentActivityRecord["status"]; summary: string }> {
  const content = input.content.toLowerCase();
  const roles: Array<{ role: SubagentRole; status: SubagentActivityRecord["status"]; summary: string }> = [
    {
      role: "repo_scout",
      status: "planned",
      summary: "Inspect affected files and repository state for the inbound event.",
    },
    {
      role: "planner",
      status: "planned",
      summary: "Translate the inbound event into a bounded execution or review plan.",
    },
  ];

  if (input.source === "ci_monitoring" || /test|build|lint|failing|failure|regression/.test(content)) {
    roles.push({
      role: "verifier",
      status: "planned",
      summary: "Analyze verification evidence and identify the narrowest safe follow-up.",
    });
  }

  if (input.allowUnattendedReadOnly && /docs|documentation|readme|release notes/.test(content)) {
    roles.push({
      role: "doc_updater",
      status: "planned",
      summary: "Draft documentation follow-ups only after the planning pass completes.",
    });
  }

  return roles;
}

function toChannelPrompt(event: ChannelEventRecord, subagents: SubagentActivityRecord[]) {
  const target = [event.projectId ? `project=${event.projectId}` : null, event.ticketId ? `ticket=${event.ticketId}` : null, event.runId ? `run=${event.runId}` : null]
    .filter(Boolean)
    .join(" ");
  const roleSummary = subagents.map((item) => item.role).join(", ");
  return [
    `<channel source="${event.source}" sender="${event.senderId}" trust="${event.trustLevel}" ${target}>`,
    event.content,
    "</channel>",
    "",
    `Planned subagents: ${roleSummary || "none"}.`,
    "Stay within the active mission/ticket scope. Treat this as an experimental channel event.",
  ].join("\n");
}

export class ChannelService {
  constructor(private readonly chatService: ChatService) {}

  async getConfig(): Promise<ExperimentalChannelsConfig> {
    const row = await prisma.appSetting.findUnique({ where: { key: CHANNEL_CONFIG_KEY } });
    return row ? normalizeConfig(row.value) : defaultConfig();
  }

  private async resolveProjectForRun(runId: string | null | undefined) {
    if (!runId) return null;
    const projection = await prisma.runProjection.findUnique({
      where: { runId },
      select: { metadata: true },
    });
    const metadata = asRecord(projection?.metadata);
    return typeof metadata.repo_id === "string" && metadata.repo_id.trim() ? metadata.repo_id : null;
  }

  private async resolveSessionId(projectId: string | null, requestedSessionId: string | null, config: ExperimentalChannelsConfig) {
    if (requestedSessionId) return requestedSessionId;
    if (config.defaultSessionId) return config.defaultSessionId;
    if (!projectId) return null;
    const sessions = await this.chatService.listSessions(projectId);
    if (sessions[0]?.id) return sessions[0].id;
    const created = await this.chatService.createSession("Channel Inbox", projectId);
    return created.id;
  }

  async ingestEvent(input: {
    source: ChannelSource;
    senderId: string;
    content: string;
    projectId?: string | null;
    ticketId?: string | null;
    runId?: string | null;
    sessionId?: string | null;
    replySupported?: boolean;
    signingSecret?: string | null;
  }): Promise<{ event: ChannelEventRecord; subagents: SubagentActivityRecord[] }> {
    const config = await this.getConfig();
    if (!channelEnabled(config, input.source)) {
      throw new Error(`Channel source '${input.source}' is disabled.`);
    }

    const expectedSecret = channelSecret(config, input.source);
    if (expectedSecret && input.signingSecret !== expectedSecret) {
      throw new Error("Invalid channel signing secret.");
    }

    if (config.senderAllowlist.length > 0 && !config.senderAllowlist.includes(input.senderId)) {
      throw new Error(`Sender '${input.senderId}' is not allowlisted for experimental channels.`);
    }

    const resolvedProjectId = input.projectId || config.defaultProjectId || (await this.resolveProjectForRun(input.runId)) || null;
    const resolvedSessionId = await this.resolveSessionId(resolvedProjectId, input.sessionId || null, config);
    const now = new Date().toISOString();
    const eventId = randomUUID();
    const event: ChannelEventRecord = {
      id: eventId,
      source: input.source,
      senderId: input.senderId,
      content: input.content,
      trustLevel: config.senderAllowlist.length === 0 || config.senderAllowlist.includes(input.senderId) ? "trusted" : "restricted",
      projectId: resolvedProjectId,
      ticketId: input.ticketId || null,
      runId: input.runId || null,
      sessionId: resolvedSessionId,
      replySupported: Boolean(input.replySupported),
      deliveredToSession: Boolean(config.allowUnattendedReadOnly && resolvedSessionId),
      createdAt: now,
    };

    await prisma.auditEvent.create({
      data: {
        actor: `channel:${input.source}`,
        eventType: "channel.event.received",
        payload: event,
      },
    });

    if (event.runId) {
      await prisma.runEvent.create({
        data: {
          runId: event.runId,
          kind: "channel_event",
          payload: event,
        },
      });
    }

    publishEvent("global", "channel.received", {
      projectId: event.projectId,
      ticketId: event.ticketId,
      runId: event.runId,
      source: event.source,
      senderId: event.senderId,
      trustLevel: event.trustLevel,
    });

    const subagents = planSubagentRoles({
      source: input.source,
      content: input.content,
      allowUnattendedReadOnly: config.allowUnattendedReadOnly,
    }).map((plan) => ({
      id: randomUUID(),
      role: plan.role,
      status: plan.status,
      summary: plan.summary,
      sourceEventId: event.id,
      projectId: event.projectId,
      ticketId: event.ticketId,
      runId: event.runId,
      createdAt: now,
    } satisfies SubagentActivityRecord));

    for (const activity of subagents) {
      await prisma.runEvent.create({
        data: {
          runId: activity.runId || null,
          kind: "subagent_activity",
          payload: activity,
        },
      });
      publishEvent("global", "subagent.spawned", {
        projectId: activity.projectId,
        ticketId: activity.ticketId,
        runId: activity.runId,
        role: activity.role,
        summary: activity.summary,
      });
    }

    if (event.deliveredToSession && event.sessionId) {
      await this.chatService.createUserMessage(event.sessionId, toChannelPrompt(event, subagents), {
        modelRole: "utility_fast",
        metadata: {
          channelEventId: event.id,
          channelSource: event.source,
          senderId: event.senderId,
          trustLevel: event.trustLevel,
          subagentRoles: subagents.map((item) => item.role),
        },
      });

      publishEvent("global", "subagent.completed", {
        projectId: event.projectId,
        ticketId: event.ticketId,
        runId: event.runId,
        role: "planner",
        summary: "Delivered channel event into the active overseer session.",
      });
    }

    return {
      event,
      subagents,
    };
  }

  async validateApprovalRelay(input: {
    senderId: string;
    source: ChannelSource;
    signingSecret?: string | null;
    replayId: string;
  }) {
    const config = await this.getConfig();
    if (!config.enabled || !config.allowRemoteApprovals) {
      throw new Error("Remote approval relay is disabled.");
    }
    if (!channelEnabled(config, input.source)) {
      throw new Error(`Channel source '${input.source}' is disabled.`);
    }
    const expectedSecret = channelSecret(config, input.source);
    if (expectedSecret && input.signingSecret !== expectedSecret) {
      throw new Error("Invalid channel signing secret.");
    }
    if (config.senderAllowlist.length === 0 || !config.senderAllowlist.includes(input.senderId)) {
      throw new Error(`Sender '${input.senderId}' is not allowlisted for remote approvals.`);
    }

    const replayRow = await prisma.appSetting.findUnique({ where: { key: CHANNEL_REPLAY_GUARD_KEY } });
    const replayState = asRecord(replayRow?.value);
    const seenIds = asStringArray(replayState.ids);
    if (seenIds.includes(input.replayId)) {
      throw new Error(`Replay id '${input.replayId}' has already been used.`);
    }

    const nextIds = [input.replayId, ...seenIds].slice(0, 200);
    await prisma.appSetting.upsert({
      where: { key: CHANNEL_REPLAY_GUARD_KEY },
      update: { value: { ids: nextIds, updatedAt: new Date().toISOString() } },
      create: { key: CHANNEL_REPLAY_GUARD_KEY, value: { ids: nextIds, updatedAt: new Date().toISOString() } },
    });

    return config;
  }

  async listRecentActivity(projectId?: string | null): Promise<{ channels: ChannelEventRecord[]; subagents: SubagentActivityRecord[] }> {
    const [auditEvents, runEvents] = await Promise.all([
      prisma.auditEvent.findMany({
        where: {
          eventType: "channel.event.received",
          ...(projectId
            ? {
                payload: {
                  path: ["projectId"],
                  equals: projectId,
                },
              }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.runEvent.findMany({
        where: {
          kind: "subagent_activity",
          ...(projectId
            ? {
                payload: {
                  path: ["projectId"],
                  equals: projectId,
                },
              }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
    ]);

    return {
      channels: auditEvents
        .map((row) => row.payload as ChannelEventRecord)
        .filter((row) => row && typeof row.id === "string"),
      subagents: runEvents
        .map((row) => row.payload as SubagentActivityRecord)
        .filter((row) => row && typeof row.id === "string"),
    };
  }
}

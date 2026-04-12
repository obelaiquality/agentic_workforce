/**
 * Notification service — dispatches webhook notifications to Slack, Discord,
 * and generic HTTP endpoints. Channels are persisted as a JSON array in
 * the `notification.channels` AppSetting key.
 */

import { prisma } from "../db";
import { createLogger } from "../logger";

const log = createLogger("Notifications");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationChannelType = "slack" | "discord" | "webhook";

export type NotificationEventType =
  | "task_completed"
  | "task_failed"
  | "approval_needed"
  | "agent_blocked"
  | "execution_started"
  | "execution_aborted";

export interface NotificationChannel {
  id: string;
  type: NotificationChannelType;
  name: string;
  url: string;
  enabled: boolean;
  events: NotificationEventType[];
  metadata?: Record<string, unknown>;
}

export interface NotificationPayload {
  runId?: string;
  projectName?: string;
  summary: string;
  details?: string;
}

const SETTING_KEY = "notification.channels";

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class NotificationService {
  /** List all configured notification channels. */
  async listChannels(): Promise<NotificationChannel[]> {
    const row = await prisma.appSetting.findUnique({
      where: { key: SETTING_KEY },
    });
    if (!row?.value) {
      return [];
    }
    const channels = row.value as unknown;
    return Array.isArray(channels) ? (channels as NotificationChannel[]) : [];
  }

  /** Create or update a notification channel. */
  async upsertChannel(channel: NotificationChannel): Promise<void> {
    const channels = await this.listChannels();
    const idx = channels.findIndex((c) => c.id === channel.id);
    if (idx >= 0) {
      channels[idx] = channel;
    } else {
      channels.push(channel);
    }
    await prisma.appSetting.upsert({
      where: { key: SETTING_KEY },
      update: { value: channels as unknown as Record<string, unknown> },
      create: { key: SETTING_KEY, value: channels as unknown as Record<string, unknown> },
    });
  }

  /** Delete a notification channel by id. */
  async deleteChannel(channelId: string): Promise<void> {
    const channels = await this.listChannels();
    const filtered = channels.filter((c) => c.id !== channelId);
    await prisma.appSetting.upsert({
      where: { key: SETTING_KEY },
      update: { value: filtered as unknown as Record<string, unknown> },
      create: { key: SETTING_KEY, value: filtered as unknown as Record<string, unknown> },
    });
  }

  /**
   * Dispatch a notification to all enabled channels that subscribe to the
   * given event type. Best-effort delivery — errors are logged but never thrown.
   */
  async dispatch(
    event: NotificationEventType,
    payload: NotificationPayload,
  ): Promise<void> {
    let channels: NotificationChannel[];
    try {
      channels = await this.listChannels();
    } catch (err) {
      log.error("Failed to load notification channels:", err);
      return;
    }

    const targets = channels.filter(
      (c) => c.enabled && c.events.includes(event),
    );

    if (targets.length === 0) {
      return;
    }

    const text = this.formatText(event, payload);

    await Promise.allSettled(
      targets.map((channel) => this.sendToChannel(channel, event, payload, text)),
    );
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private formatText(
    event: NotificationEventType,
    payload: NotificationPayload,
  ): string {
    const prefix = payload.projectName ? `[${payload.projectName}] ` : "";
    const runInfo = payload.runId ? ` (run: ${payload.runId})` : "";
    const details = payload.details ? `\n${payload.details}` : "";
    return `${prefix}${event}: ${payload.summary}${runInfo}${details}`;
  }

  private async sendToChannel(
    channel: NotificationChannel,
    event: NotificationEventType,
    payload: NotificationPayload,
    text: string,
  ): Promise<void> {
    try {
      let body: unknown;

      switch (channel.type) {
        case "slack":
          body = { text };
          break;
        case "discord":
          body = { content: text };
          break;
        case "webhook":
          body = {
            event,
            ...payload,
            timestamp: new Date().toISOString(),
          };
          break;
        default:
          log.warn(`Unknown channel type: ${(channel as NotificationChannel).type}`);
          return;
      }

      const response = await fetch(channel.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        log.warn(
          `Notification to "${channel.name}" (${channel.type}) returned ${response.status}`,
        );
      }
    } catch (err) {
      log.error(`Failed to send notification to "${channel.name}":`, err);
    }
  }
}

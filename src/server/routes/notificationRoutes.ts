/**
 * Notification channel routes — CRUD for webhook notification channels
 * and test dispatch endpoint.
 *
 * Endpoints:
 *   GET    /api/v1/notifications/channels      — list channels
 *   POST   /api/v1/notifications/channels      — create/update channel
 *   DELETE /api/v1/notifications/channels/:id   — delete channel
 *   POST   /api/v1/notifications/test           — send a test notification
 */

import type { FastifyInstance } from "fastify";
import {
  NotificationService,
  type NotificationChannel,
  type NotificationChannelType,
  type NotificationEventType,
} from "../services/notificationService";

const VALID_CHANNEL_TYPES = new Set<NotificationChannelType>(["slack", "discord", "webhook"]);
const VALID_EVENT_TYPES = new Set<NotificationEventType>([
  "task_completed",
  "task_failed",
  "approval_needed",
  "agent_blocked",
  "execution_started",
  "execution_aborted",
]);

export function registerNotificationRoutes(app: FastifyInstance): void {
  const service = new NotificationService();

  // List channels
  app.get("/api/v1/notifications/channels", async () => {
    const channels = await service.listChannels();
    return { items: channels };
  });

  // Create / update channel
  app.post("/api/v1/notifications/channels", async (request, reply) => {
    const body = request.body as Partial<NotificationChannel>;

    if (!body.id || typeof body.id !== "string" || !body.id.trim()) {
      return reply.code(400).send({ error: "id is required" });
    }
    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return reply.code(400).send({ error: "name is required" });
    }
    if (!body.type || !VALID_CHANNEL_TYPES.has(body.type)) {
      return reply.code(400).send({ error: `type must be one of: ${Array.from(VALID_CHANNEL_TYPES).join(", ")}` });
    }
    if (!body.url || typeof body.url !== "string" || !body.url.trim()) {
      return reply.code(400).send({ error: "url is required" });
    }
    if (!Array.isArray(body.events) || body.events.some((e) => !VALID_EVENT_TYPES.has(e as NotificationEventType))) {
      return reply.code(400).send({
        error: `events must be an array of: ${Array.from(VALID_EVENT_TYPES).join(", ")}`,
      });
    }

    const channel: NotificationChannel = {
      id: body.id.trim(),
      name: body.name.trim(),
      type: body.type,
      url: body.url.trim(),
      enabled: body.enabled !== false,
      events: body.events as NotificationEventType[],
      metadata: body.metadata,
    };

    await service.upsertChannel(channel);
    return { ok: true, item: channel };
  });

  // Delete channel
  app.delete("/api/v1/notifications/channels/:id", async (request) => {
    const { id } = request.params as { id: string };
    await service.deleteChannel(id);
    return { ok: true };
  });

  // Test notification
  app.post("/api/v1/notifications/test", async (request, reply) => {
    const body = request.body as { channelId: string };
    if (!body.channelId) {
      return reply.code(400).send({ error: "channelId is required" });
    }

    const channels = await service.listChannels();
    const target = channels.find((c) => c.id === body.channelId);
    if (!target) {
      return reply.code(404).send({ error: `Channel not found: ${body.channelId}` });
    }

    // Temporarily force the channel to be enabled and subscribe to "task_completed"
    // so we can send a test regardless of current settings.
    const testChannel: NotificationChannel = {
      ...target,
      enabled: true,
      events: ["task_completed"],
    };

    // Replace channels list temporarily with just the test channel
    const originalChannels = await service.listChannels();
    await service.upsertChannel(testChannel);

    try {
      await service.dispatch("task_completed", {
        summary: "This is a test notification from the Agentic Workforce app.",
        projectName: "Test Project",
      });
    } finally {
      // Restore original channel settings
      const original = originalChannels.find((c) => c.id === body.channelId);
      if (original) {
        await service.upsertChannel(original);
      }
    }

    return { ok: true };
  });
}

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock NotificationService
// ---------------------------------------------------------------------------

const notificationServiceMocks = {
  listChannels: vi.fn().mockResolvedValue([]),
  upsertChannel: vi.fn().mockResolvedValue(undefined),
  deleteChannel: vi.fn().mockResolvedValue(undefined),
  dispatch: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../services/notificationService", () => ({
  NotificationService: vi.fn().mockImplementation(() => notificationServiceMocks),
}));

import { registerNotificationRoutes } from "./notificationRoutes";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleChannel = {
  id: "ch-test",
  type: "slack" as const,
  name: "Test Slack",
  url: "https://hooks.slack.com/services/T00/B00/xxx",
  enabled: true,
  events: ["task_completed", "task_failed"],
};

function createHarness() {
  const app = Fastify();
  registerNotificationRoutes(app);
  return { app };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("notification routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationServiceMocks.listChannels.mockResolvedValue([]);
    notificationServiceMocks.upsertChannel.mockResolvedValue(undefined);
    notificationServiceMocks.deleteChannel.mockResolvedValue(undefined);
    notificationServiceMocks.dispatch.mockResolvedValue(undefined);
  });

  // ── GET /api/v1/notifications/channels ──

  it("GET /api/v1/notifications/channels returns channel list", async () => {
    notificationServiceMocks.listChannels.mockResolvedValue([sampleChannel]);
    const { app } = createHarness();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/notifications/channels",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe("ch-test");
    await app.close();
  });

  it("GET /api/v1/notifications/channels returns empty list", async () => {
    const { app } = createHarness();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/notifications/channels",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
    await app.close();
  });

  // ── POST /api/v1/notifications/channels ──

  it("POST /api/v1/notifications/channels creates a channel", async () => {
    const { app } = createHarness();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/channels",
      payload: sampleChannel,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.item.id).toBe("ch-test");
    expect(notificationServiceMocks.upsertChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "ch-test",
        name: "Test Slack",
        type: "slack",
        url: sampleChannel.url,
        enabled: true,
        events: ["task_completed", "task_failed"],
      }),
    );
    await app.close();
  });

  it("POST /api/v1/notifications/channels rejects missing id", async () => {
    const { app } = createHarness();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/channels",
      payload: { ...sampleChannel, id: "" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("id");
    await app.close();
  });

  it("POST /api/v1/notifications/channels rejects missing name", async () => {
    const { app } = createHarness();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/channels",
      payload: { ...sampleChannel, name: "" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("name");
    await app.close();
  });

  it("POST /api/v1/notifications/channels rejects invalid type", async () => {
    const { app } = createHarness();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/channels",
      payload: { ...sampleChannel, type: "sms" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("type");
    await app.close();
  });

  it("POST /api/v1/notifications/channels rejects missing url", async () => {
    const { app } = createHarness();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/channels",
      payload: { ...sampleChannel, url: "" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("url");
    await app.close();
  });

  it("POST /api/v1/notifications/channels rejects invalid events", async () => {
    const { app } = createHarness();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/channels",
      payload: { ...sampleChannel, events: ["invalid_event"] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("events");
    await app.close();
  });

  it("POST /api/v1/notifications/channels defaults enabled to true", async () => {
    const { app } = createHarness();
    const { enabled: _, ...channelWithoutEnabled } = sampleChannel;

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/channels",
      payload: channelWithoutEnabled,
    });

    expect(res.statusCode).toBe(200);
    expect(notificationServiceMocks.upsertChannel).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
    await app.close();
  });

  // ── DELETE /api/v1/notifications/channels/:id ──

  it("DELETE /api/v1/notifications/channels/:id removes channel", async () => {
    const { app } = createHarness();

    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/notifications/channels/ch-test",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(notificationServiceMocks.deleteChannel).toHaveBeenCalledWith("ch-test");
    await app.close();
  });

  // ── POST /api/v1/notifications/test ──

  it("POST /api/v1/notifications/test sends test notification", async () => {
    notificationServiceMocks.listChannels.mockResolvedValue([sampleChannel]);
    const { app } = createHarness();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/test",
      payload: { channelId: "ch-test" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(notificationServiceMocks.dispatch).toHaveBeenCalledWith(
      "task_completed",
      expect.objectContaining({
        summary: expect.stringContaining("test notification"),
      }),
    );
    await app.close();
  });

  it("POST /api/v1/notifications/test returns 400 when channelId missing", async () => {
    const { app } = createHarness();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/test",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("channelId");
    await app.close();
  });

  it("POST /api/v1/notifications/test returns 404 when channel not found", async () => {
    notificationServiceMocks.listChannels.mockResolvedValue([]);
    const { app } = createHarness();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/test",
      payload: { channelId: "nonexistent" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain("nonexistent");
    await app.close();
  });
});

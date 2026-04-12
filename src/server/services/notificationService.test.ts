import { describe, it, expect, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({
  prisma: {
    appSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
  fetchMock: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: hoisted.prisma,
}));

// Mock global fetch
vi.stubGlobal("fetch", hoisted.fetchMock);

import {
  NotificationService,
  type NotificationChannel,
  type NotificationEventType,
} from "./notificationService";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const slackChannel: NotificationChannel = {
  id: "ch-slack",
  type: "slack",
  name: "Slack Alerts",
  url: "https://hooks.slack.com/services/T00/B00/xxx",
  enabled: true,
  events: ["task_completed", "task_failed"] as NotificationEventType[],
};

const discordChannel: NotificationChannel = {
  id: "ch-discord",
  type: "discord",
  name: "Discord Updates",
  url: "https://discord.com/api/webhooks/123/abc",
  enabled: true,
  events: ["task_completed", "approval_needed"] as NotificationEventType[],
};

const webhookChannel: NotificationChannel = {
  id: "ch-webhook",
  type: "webhook",
  name: "Custom Webhook",
  url: "https://example.com/webhook",
  enabled: true,
  events: ["execution_aborted"] as NotificationEventType[],
};

const disabledChannel: NotificationChannel = {
  id: "ch-disabled",
  type: "slack",
  name: "Disabled Channel",
  url: "https://hooks.slack.com/services/T00/B00/disabled",
  enabled: false,
  events: ["task_completed"] as NotificationEventType[],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NotificationService", () => {
  let service: NotificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new NotificationService();
    hoisted.fetchMock.mockResolvedValue({ ok: true, status: 200 });
  });

  // ── Channel CRUD ────────────────────────────────────────────────

  describe("listChannels", () => {
    it("returns empty array when no setting exists", async () => {
      hoisted.prisma.appSetting.findUnique.mockResolvedValue(null);
      const result = await service.listChannels();
      expect(result).toEqual([]);
    });

    it("returns empty array when value is null", async () => {
      hoisted.prisma.appSetting.findUnique.mockResolvedValue({ value: null });
      const result = await service.listChannels();
      expect(result).toEqual([]);
    });

    it("returns channels from stored setting", async () => {
      hoisted.prisma.appSetting.findUnique.mockResolvedValue({
        value: [slackChannel, discordChannel],
      });
      const result = await service.listChannels();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("ch-slack");
      expect(result[1].id).toBe("ch-discord");
    });
  });

  describe("upsertChannel", () => {
    it("adds a new channel", async () => {
      hoisted.prisma.appSetting.findUnique.mockResolvedValue({ value: [] });
      hoisted.prisma.appSetting.upsert.mockResolvedValue({});

      await service.upsertChannel(slackChannel);

      expect(hoisted.prisma.appSetting.upsert).toHaveBeenCalledWith({
        where: { key: "notification.channels" },
        update: { value: [slackChannel] },
        create: { key: "notification.channels", value: [slackChannel] },
      });
    });

    it("updates an existing channel", async () => {
      hoisted.prisma.appSetting.findUnique.mockResolvedValue({
        value: [slackChannel],
      });
      hoisted.prisma.appSetting.upsert.mockResolvedValue({});

      const updated = { ...slackChannel, name: "Updated Slack" };
      await service.upsertChannel(updated);

      expect(hoisted.prisma.appSetting.upsert).toHaveBeenCalledWith({
        where: { key: "notification.channels" },
        update: { value: [updated] },
        create: { key: "notification.channels", value: [updated] },
      });
    });
  });

  describe("deleteChannel", () => {
    it("removes a channel by id", async () => {
      hoisted.prisma.appSetting.findUnique.mockResolvedValue({
        value: [slackChannel, discordChannel],
      });
      hoisted.prisma.appSetting.upsert.mockResolvedValue({});

      await service.deleteChannel("ch-slack");

      expect(hoisted.prisma.appSetting.upsert).toHaveBeenCalledWith({
        where: { key: "notification.channels" },
        update: { value: [discordChannel] },
        create: { key: "notification.channels", value: [discordChannel] },
      });
    });

    it("is a no-op when channel id does not exist", async () => {
      hoisted.prisma.appSetting.findUnique.mockResolvedValue({
        value: [slackChannel],
      });
      hoisted.prisma.appSetting.upsert.mockResolvedValue({});

      await service.deleteChannel("nonexistent");

      expect(hoisted.prisma.appSetting.upsert).toHaveBeenCalledWith({
        where: { key: "notification.channels" },
        update: { value: [slackChannel] },
        create: { key: "notification.channels", value: [slackChannel] },
      });
    });
  });

  // ── Dispatch ────────────────────────────────────────────────────

  describe("dispatch", () => {
    it("sends Slack notification with { text } body", async () => {
      hoisted.prisma.appSetting.findUnique.mockResolvedValue({
        value: [slackChannel],
      });

      await service.dispatch("task_completed", {
        summary: "Build finished",
        projectName: "MyApp",
        runId: "run-123",
      });

      expect(hoisted.fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = hoisted.fetchMock.mock.calls[0];
      expect(url).toBe(slackChannel.url);
      const body = JSON.parse(options.body);
      expect(body.text).toContain("[MyApp]");
      expect(body.text).toContain("task_completed");
      expect(body.text).toContain("Build finished");
      expect(body.text).toContain("run-123");
    });

    it("sends Discord notification with { content } body", async () => {
      hoisted.prisma.appSetting.findUnique.mockResolvedValue({
        value: [discordChannel],
      });

      await service.dispatch("task_completed", {
        summary: "Build finished",
      });

      expect(hoisted.fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = hoisted.fetchMock.mock.calls[0];
      expect(url).toBe(discordChannel.url);
      const body = JSON.parse(options.body);
      expect(body.content).toContain("task_completed");
      expect(body.content).toContain("Build finished");
      // Should not have "text" key
      expect(body.text).toBeUndefined();
    });

    it("sends generic webhook with full payload", async () => {
      hoisted.prisma.appSetting.findUnique.mockResolvedValue({
        value: [webhookChannel],
      });

      await service.dispatch("execution_aborted", {
        summary: "Max iterations reached",
        runId: "run-456",
        projectName: "TestProject",
        details: "Budget exhausted after 50 iterations",
      });

      expect(hoisted.fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = hoisted.fetchMock.mock.calls[0];
      expect(url).toBe(webhookChannel.url);
      const body = JSON.parse(options.body);
      expect(body.event).toBe("execution_aborted");
      expect(body.summary).toBe("Max iterations reached");
      expect(body.runId).toBe("run-456");
      expect(body.projectName).toBe("TestProject");
      expect(body.details).toBe("Budget exhausted after 50 iterations");
      expect(body.timestamp).toBeDefined();
    });

    it("does not send to disabled channels", async () => {
      hoisted.prisma.appSetting.findUnique.mockResolvedValue({
        value: [disabledChannel],
      });

      await service.dispatch("task_completed", {
        summary: "Build finished",
      });

      expect(hoisted.fetchMock).not.toHaveBeenCalled();
    });

    it("does not send when event type is not subscribed", async () => {
      hoisted.prisma.appSetting.findUnique.mockResolvedValue({
        value: [slackChannel], // only subscribes to task_completed and task_failed
      });

      await service.dispatch("execution_aborted", {
        summary: "Aborted",
      });

      expect(hoisted.fetchMock).not.toHaveBeenCalled();
    });

    it("sends to multiple matching channels", async () => {
      hoisted.prisma.appSetting.findUnique.mockResolvedValue({
        value: [slackChannel, discordChannel],
      });

      await service.dispatch("task_completed", {
        summary: "All done",
      });

      // Both slack and discord subscribe to task_completed
      expect(hoisted.fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not throw when fetch fails", async () => {
      hoisted.prisma.appSetting.findUnique.mockResolvedValue({
        value: [slackChannel],
      });
      hoisted.fetchMock.mockRejectedValue(new Error("Network error"));

      // Should not throw
      await expect(
        service.dispatch("task_completed", { summary: "test" }),
      ).resolves.toBeUndefined();
    });

    it("does not throw when fetch returns non-ok status", async () => {
      hoisted.prisma.appSetting.findUnique.mockResolvedValue({
        value: [slackChannel],
      });
      hoisted.fetchMock.mockResolvedValue({ ok: false, status: 500 });

      await expect(
        service.dispatch("task_completed", { summary: "test" }),
      ).resolves.toBeUndefined();
    });

    it("does not throw when loading channels fails", async () => {
      hoisted.prisma.appSetting.findUnique.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(
        service.dispatch("task_completed", { summary: "test" }),
      ).resolves.toBeUndefined();
    });

    it("formats text with details when provided", async () => {
      hoisted.prisma.appSetting.findUnique.mockResolvedValue({
        value: [slackChannel],
      });

      await service.dispatch("task_completed", {
        summary: "Done",
        details: "Extra info here",
      });

      const [, options] = hoisted.fetchMock.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.text).toContain("Extra info here");
    });
  });
});

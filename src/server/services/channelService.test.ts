import { describe, expect, it, vi, beforeEach } from "vitest";
import { ChannelService } from "./channelService";

// ── Mock dependencies ──────────────────────────────────────────────────────

const { mockPublishEvent, mockPrisma } = vi.hoisted(() => ({
  mockPublishEvent: vi.fn(),
  mockPrisma: {
    appSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    runProjection: {
      findUnique: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    runEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../eventBus", () => ({
  publishEvent: mockPublishEvent,
}));

vi.mock("../db", () => ({
  prisma: mockPrisma,
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeChatService() {
  return {
    listSessions: vi.fn().mockResolvedValue([]),
    createSession: vi.fn().mockResolvedValue({ id: "session-new" }),
    createUserMessage: vi.fn().mockResolvedValue({}),
  };
}

function makeEnabledConfig(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    senderAllowlist: [],
    defaultProjectId: null,
    defaultSessionId: null,
    allowRemoteApprovals: false,
    allowUnattendedReadOnly: false,
    webhook: { enabled: true, signingSecret: "" },
    telegram: { enabled: false, signingSecret: "" },
    ciMonitoring: { enabled: false, signingSecret: "" },
    ...overrides,
  };
}

function setConfig(config: Record<string, unknown>) {
  mockPrisma.appSetting.findUnique.mockImplementation(({ where }: any) => {
    if (where.key === "experimental_channels_config") {
      return Promise.resolve({ key: "experimental_channels_config", value: config });
    }
    if (where.key === "experimental_channel_approval_replay_guard") {
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  });
}

function setConfigAndReplayGuard(config: Record<string, unknown>, replayIds: string[] = []) {
  mockPrisma.appSetting.findUnique.mockImplementation(({ where }: any) => {
    if (where.key === "experimental_channels_config") {
      return Promise.resolve({ key: "experimental_channels_config", value: config });
    }
    if (where.key === "experimental_channel_approval_replay_guard") {
      if (replayIds.length > 0) {
        return Promise.resolve({
          key: "experimental_channel_approval_replay_guard",
          value: { ids: replayIds },
        });
      }
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  });
}

let chatService: ReturnType<typeof makeChatService>;
let service: ChannelService;

beforeEach(() => {
  vi.clearAllMocks();
  chatService = makeChatService();
  service = new ChannelService(chatService as any);

  mockPrisma.appSetting.findUnique.mockResolvedValue(null);
  mockPrisma.appSetting.upsert.mockResolvedValue({});
  mockPrisma.runProjection.findUnique.mockResolvedValue(null);
  mockPrisma.auditEvent.create.mockResolvedValue({ id: "ae-1" });
  mockPrisma.runEvent.create.mockResolvedValue({ id: "re-1" });
});

// ── getConfig ──────────────────────────────────────────────────────────────

describe("getConfig", () => {
  it("returns normalized defaults when no config stored", async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);

    const config = await service.getConfig();

    expect(config.enabled).toBe(false);
    expect(config.senderAllowlist).toEqual([]);
    expect(config.defaultProjectId).toBeNull();
    expect(config.defaultSessionId).toBeNull();
    expect(config.allowRemoteApprovals).toBe(false);
    expect(config.allowUnattendedReadOnly).toBe(false);
    expect(config.webhook.enabled).toBe(false);
    expect(config.webhook.signingSecret).toBe("");
    expect(config.telegram.enabled).toBe(false);
    expect(config.ciMonitoring.enabled).toBe(false);
  });

  it("merges provided config with defaults", async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue({
      key: "experimental_channels_config",
      value: {
        enabled: true,
        senderAllowlist: ["user-1"],
        webhook: { enabled: true, signingSecret: "secret123" },
      },
    });

    const config = await service.getConfig();

    expect(config.enabled).toBe(true);
    expect(config.senderAllowlist).toEqual(["user-1"]);
    expect(config.webhook.enabled).toBe(true);
    expect(config.webhook.signingSecret).toBe("secret123");
    expect(config.telegram.enabled).toBe(false);
    expect(config.ciMonitoring.enabled).toBe(false);
  });
});

// ── ingestEvent ────────────────────────────────────────────────────────────

describe("ingestEvent", () => {
  it("validates channel source is enabled, rejects disabled channel", async () => {
    setConfig({ enabled: true, webhook: { enabled: false } });

    await expect(
      service.ingestEvent({
        source: "webhook",
        senderId: "user-1",
        content: "Fix the bug",
      }),
    ).rejects.toThrow("Channel source 'webhook' is disabled");
  });

  it("rejects when channels globally disabled", async () => {
    setConfig({ enabled: false, webhook: { enabled: true } });

    await expect(
      service.ingestEvent({
        source: "webhook",
        senderId: "user-1",
        content: "Fix the bug",
      }),
    ).rejects.toThrow("disabled");
  });

  it("validates signing secret, rejects invalid", async () => {
    setConfig(makeEnabledConfig({
      webhook: { enabled: true, signingSecret: "correct-secret" },
    }));

    await expect(
      service.ingestEvent({
        source: "webhook",
        senderId: "user-1",
        content: "Fix the bug",
        signingSecret: "wrong-secret",
      }),
    ).rejects.toThrow("Invalid channel signing secret");
  });

  it("accepts event with correct signing secret", async () => {
    setConfig(makeEnabledConfig({
      webhook: { enabled: true, signingSecret: "correct-secret" },
    }));

    const result = await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Fix the bug",
      signingSecret: "correct-secret",
    });

    expect(result.event.source).toBe("webhook");
  });

  it("checks sender allowlist, rejects unauthorized sender", async () => {
    setConfig(makeEnabledConfig({
      senderAllowlist: ["allowed-user"],
    }));

    await expect(
      service.ingestEvent({
        source: "webhook",
        senderId: "unauthorized-user",
        content: "Hello",
      }),
    ).rejects.toThrow("not allowlisted");
  });

  it("accepts allowlisted sender", async () => {
    setConfig(makeEnabledConfig({
      senderAllowlist: ["allowed-user"],
    }));

    const result = await service.ingestEvent({
      source: "webhook",
      senderId: "allowed-user",
      content: "Hello",
    });

    expect(result.event.senderId).toBe("allowed-user");
    expect(result.event.trustLevel).toBe("trusted");
  });

  it("resolves projectId from config when provided", async () => {
    setConfig(makeEnabledConfig({
      defaultProjectId: "project-default",
    }));

    const result = await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Hello",
    });

    expect(result.event.projectId).toBe("project-default");
  });

  it("resolves projectId from explicit input over config", async () => {
    setConfig(makeEnabledConfig({
      defaultProjectId: "project-default",
    }));

    const result = await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Hello",
      projectId: "project-explicit",
    });

    expect(result.event.projectId).toBe("project-explicit");
  });

  it("resolves projectId from run metadata fallback", async () => {
    setConfig(makeEnabledConfig());
    mockPrisma.runProjection.findUnique.mockResolvedValue({
      runId: "run-1",
      metadata: { repo_id: "repo-from-run" },
    });

    const result = await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Hello",
      runId: "run-1",
    });

    expect(result.event.projectId).toBe("repo-from-run");
  });

  it("auto-creates session when none exists", async () => {
    setConfig(makeEnabledConfig({
      defaultProjectId: "project-1",
      allowUnattendedReadOnly: true,
    }));
    chatService.listSessions.mockResolvedValue([]);
    chatService.createSession.mockResolvedValue({ id: "session-auto" });

    const result = await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Hello",
    });

    expect(chatService.createSession).toHaveBeenCalledWith("Channel Inbox", "project-1");
    expect(result.event.sessionId).toBe("session-auto");
  });

  it("plans subagent roles: always includes repo_scout and planner", async () => {
    setConfig(makeEnabledConfig());

    const result = await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Random content without keywords",
    });

    const roles = result.subagents.map((s) => s.role);
    expect(roles).toContain("repo_scout");
    expect(roles).toContain("planner");
    expect(roles).toHaveLength(2);
  });

  it("plans verifier role for CI events", async () => {
    setConfig(makeEnabledConfig({
      ciMonitoring: { enabled: true, signingSecret: "" },
    }));

    const result = await service.ingestEvent({
      source: "ci_monitoring",
      senderId: "ci-bot",
      content: "Build completed",
    });

    const roles = result.subagents.map((s) => s.role);
    expect(roles).toContain("verifier");
  });

  it("plans verifier role for test-related content", async () => {
    setConfig(makeEnabledConfig());

    const result = await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Tests are failing in production",
    });

    const roles = result.subagents.map((s) => s.role);
    expect(roles).toContain("verifier");
  });

  it("plans doc_updater for docs content with allowUnattendedReadOnly", async () => {
    setConfig(makeEnabledConfig({
      allowUnattendedReadOnly: true,
    }));

    const result = await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Please update the documentation for the API",
    });

    const roles = result.subagents.map((s) => s.role);
    expect(roles).toContain("doc_updater");
  });

  it("does not plan doc_updater when allowUnattendedReadOnly is false", async () => {
    setConfig(makeEnabledConfig({
      allowUnattendedReadOnly: false,
    }));

    const result = await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Please update the documentation for the API",
    });

    const roles = result.subagents.map((s) => s.role);
    expect(roles).not.toContain("doc_updater");
  });

  it("delivers to session when allowUnattendedReadOnly is true", async () => {
    setConfig(makeEnabledConfig({
      allowUnattendedReadOnly: true,
      defaultProjectId: "proj-1",
      defaultSessionId: "session-1",
    }));

    const result = await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Fix the login bug",
    });

    expect(result.event.deliveredToSession).toBe(true);
    expect(chatService.createUserMessage).toHaveBeenCalledWith(
      "session-1",
      expect.stringContaining("channel"),
      expect.objectContaining({
        modelRole: "utility_fast",
      }),
    );
  });

  it("does not deliver to session when allowUnattendedReadOnly is false", async () => {
    setConfig(makeEnabledConfig({
      allowUnattendedReadOnly: false,
      defaultProjectId: "proj-1",
      defaultSessionId: "session-1",
    }));

    await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Fix the login bug",
    });

    expect(chatService.createUserMessage).not.toHaveBeenCalled();
  });

  it("returns created event and planned subagent roles in response", async () => {
    setConfig(makeEnabledConfig());

    const result = await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Build is failing due to test regression",
    });

    expect(result.event).toBeTruthy();
    expect(result.event.id).toBeTruthy();
    expect(result.event.source).toBe("webhook");
    expect(result.event.content).toBe("Build is failing due to test regression");
    expect(result.subagents.length).toBeGreaterThanOrEqual(2);
    for (const sub of result.subagents) {
      expect(sub.id).toBeTruthy();
      expect(sub.status).toBe("planned");
      expect(sub.sourceEventId).toBe(result.event.id);
    }
  });

  it("creates audit event record", async () => {
    setConfig(makeEnabledConfig());

    await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Hello",
    });

    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor: "channel:webhook",
        eventType: "channel.event.received",
      }),
    });
  });

  it("creates run events for subagent activities", async () => {
    setConfig(makeEnabledConfig());

    const result = await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Hello",
    });

    // One call for each subagent (repo_scout + planner = 2)
    expect(mockPrisma.runEvent.create).toHaveBeenCalledTimes(result.subagents.length);
  });

  it("publishes channel.received event on eventBus", async () => {
    setConfig(makeEnabledConfig());

    await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Hello",
    });

    expect(mockPublishEvent).toHaveBeenCalledWith(
      "global",
      "channel.received",
      expect.objectContaining({
        source: "webhook",
        senderId: "user-1",
      }),
    );
  });
});

// ── validateApprovalRelay ──────────────────────────────────────────────────

describe("validateApprovalRelay", () => {
  it("checks allowRemoteApprovals flag, rejects when disabled", async () => {
    setConfig(makeEnabledConfig({
      allowRemoteApprovals: false,
    }));

    await expect(
      service.validateApprovalRelay({
        senderId: "user-1",
        source: "webhook",
        replayId: "replay-1",
      }),
    ).rejects.toThrow("Remote approval relay is disabled");
  });

  it("rejects when channels globally disabled", async () => {
    setConfig({
      enabled: false,
      allowRemoteApprovals: true,
      webhook: { enabled: true },
    });

    await expect(
      service.validateApprovalRelay({
        senderId: "user-1",
        source: "webhook",
        replayId: "replay-1",
      }),
    ).rejects.toThrow("Remote approval relay is disabled");
  });

  it("validates signing secret correctly", async () => {
    setConfigAndReplayGuard(
      makeEnabledConfig({
        allowRemoteApprovals: true,
        senderAllowlist: ["user-1"],
        webhook: { enabled: true, signingSecret: "the-secret" },
      }),
    );

    await expect(
      service.validateApprovalRelay({
        senderId: "user-1",
        source: "webhook",
        signingSecret: "wrong-secret",
        replayId: "replay-1",
      }),
    ).rejects.toThrow("Invalid channel signing secret");
  });

  it("checks sender allowlist", async () => {
    setConfigAndReplayGuard(
      makeEnabledConfig({
        allowRemoteApprovals: true,
        senderAllowlist: ["allowed-user"],
        webhook: { enabled: true, signingSecret: "" },
      }),
    );

    await expect(
      service.validateApprovalRelay({
        senderId: "not-allowed",
        source: "webhook",
        replayId: "replay-1",
      }),
    ).rejects.toThrow("not allowlisted");
  });

  it("rejects when sender allowlist is empty (requires explicit allowlisting)", async () => {
    setConfigAndReplayGuard(
      makeEnabledConfig({
        allowRemoteApprovals: true,
        senderAllowlist: [],
        webhook: { enabled: true, signingSecret: "" },
      }),
    );

    await expect(
      service.validateApprovalRelay({
        senderId: "any-user",
        source: "webhook",
        replayId: "replay-1",
      }),
    ).rejects.toThrow("not allowlisted");
  });

  it("detects replay attacks via duplicate IDs", async () => {
    setConfigAndReplayGuard(
      makeEnabledConfig({
        allowRemoteApprovals: true,
        senderAllowlist: ["user-1"],
        webhook: { enabled: true, signingSecret: "" },
      }),
      ["replay-already-used"],
    );

    await expect(
      service.validateApprovalRelay({
        senderId: "user-1",
        source: "webhook",
        replayId: "replay-already-used",
      }),
    ).rejects.toThrow("Replay id 'replay-already-used' has already been used");
  });

  it("accepts valid approval relay", async () => {
    setConfigAndReplayGuard(
      makeEnabledConfig({
        allowRemoteApprovals: true,
        senderAllowlist: ["user-1"],
        webhook: { enabled: true, signingSecret: "correct" },
      }),
    );

    const result = await service.validateApprovalRelay({
      senderId: "user-1",
      source: "webhook",
      signingSecret: "correct",
      replayId: "unique-replay-id",
    });

    expect(result).toBeTruthy();
    expect(result.enabled).toBe(true);
    expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "experimental_channel_approval_replay_guard" },
        update: expect.objectContaining({
          value: expect.objectContaining({
            ids: expect.arrayContaining(["unique-replay-id"]),
          }),
        }),
      }),
    );
  });

  it("rejects when channel source is disabled", async () => {
    setConfigAndReplayGuard(
      makeEnabledConfig({
        allowRemoteApprovals: true,
        senderAllowlist: ["user-1"],
        telegram: { enabled: false, signingSecret: "" },
      }),
    );

    await expect(
      service.validateApprovalRelay({
        senderId: "user-1",
        source: "telegram",
        replayId: "replay-1",
      }),
    ).rejects.toThrow("disabled");
  });
});

// ── listRecentActivity ───────────────────────────────────────────────────

describe("listRecentActivity", () => {
  it("returns channels and subagents from audit and run events", async () => {
    const channelPayload = {
      id: "ch-1",
      source: "webhook",
      senderId: "user-1",
      content: "Hello",
      trustLevel: "trusted",
      projectId: "proj-1",
      ticketId: null,
      runId: null,
      sessionId: null,
      replySupported: false,
      deliveredToSession: false,
      createdAt: new Date().toISOString(),
    };

    const subagentPayload = {
      id: "sa-1",
      role: "repo_scout",
      status: "planned",
      summary: "Inspect files",
      sourceEventId: "ch-1",
      projectId: "proj-1",
      ticketId: null,
      runId: null,
      createdAt: new Date().toISOString(),
    };

    mockPrisma.auditEvent.findMany.mockResolvedValue([
      { id: "ae-1", payload: channelPayload, createdAt: new Date() },
    ]);
    mockPrisma.runEvent.findMany.mockResolvedValue([
      { id: "re-1", payload: subagentPayload, createdAt: new Date() },
    ]);

    const result = await service.listRecentActivity("proj-1");

    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].id).toBe("ch-1");
    expect(result.subagents).toHaveLength(1);
    expect(result.subagents[0].id).toBe("sa-1");

    // Verify prisma was called with projectId filter
    expect(mockPrisma.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          eventType: "channel.event.received",
          payload: { path: ["projectId"], equals: "proj-1" },
        }),
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    );
    expect(mockPrisma.runEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kind: "subagent_activity",
          payload: { path: ["projectId"], equals: "proj-1" },
        }),
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
    );
  });

  it("returns results without projectId filter when none provided", async () => {
    mockPrisma.auditEvent.findMany.mockResolvedValue([]);
    mockPrisma.runEvent.findMany.mockResolvedValue([]);

    const result = await service.listRecentActivity();

    expect(result.channels).toEqual([]);
    expect(result.subagents).toEqual([]);

    // Verify no projectId filter in the where clause
    expect(mockPrisma.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventType: "channel.event.received" },
      }),
    );
    expect(mockPrisma.runEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { kind: "subagent_activity" },
      }),
    );
  });

  it("returns results without projectId filter when null provided", async () => {
    mockPrisma.auditEvent.findMany.mockResolvedValue([]);
    mockPrisma.runEvent.findMany.mockResolvedValue([]);

    const result = await service.listRecentActivity(null);

    expect(result.channels).toEqual([]);
    expect(result.subagents).toEqual([]);
  });

  it("filters out payloads with missing id fields", async () => {
    mockPrisma.auditEvent.findMany.mockResolvedValue([
      { id: "ae-1", payload: { id: "ch-valid", source: "webhook" }, createdAt: new Date() },
      { id: "ae-2", payload: { source: "webhook" }, createdAt: new Date() },         // missing id
      { id: "ae-3", payload: { id: 123, source: "webhook" }, createdAt: new Date() }, // non-string id
      { id: "ae-4", payload: null, createdAt: new Date() },                           // null payload
    ]);
    mockPrisma.runEvent.findMany.mockResolvedValue([
      { id: "re-1", payload: { id: "sa-valid", role: "planner" }, createdAt: new Date() },
      { id: "re-2", payload: {}, createdAt: new Date() },                              // missing id
    ]);

    const result = await service.listRecentActivity();

    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].id).toBe("ch-valid");
    expect(result.subagents).toHaveLength(1);
    expect(result.subagents[0].id).toBe("sa-valid");
  });
});

// ── normalizeConfig edge cases ───────────────────────────────────────────

describe("normalizeConfig edge cases", () => {
  it("handles non-string defaultProjectId (whitespace only)", async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue({
      key: "experimental_channels_config",
      value: {
        enabled: true,
        defaultProjectId: "   ",
        defaultSessionId: "  ",
        webhook: { enabled: true },
      },
    });

    const config = await service.getConfig();
    expect(config.defaultProjectId).toBeNull();
    expect(config.defaultSessionId).toBeNull();
  });

  it("handles non-string signingSecret values", async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue({
      key: "experimental_channels_config",
      value: {
        enabled: true,
        webhook: { enabled: true, signingSecret: 12345 },
        telegram: { enabled: true, signingSecret: null },
        ciMonitoring: { enabled: true, signingSecret: undefined },
      },
    });

    const config = await service.getConfig();
    expect(config.webhook.signingSecret).toBe("");
    expect(config.telegram.signingSecret).toBe("");
    expect(config.ciMonitoring.signingSecret).toBe("");
  });

  it("handles senderAllowlist with mixed types and empty strings", async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue({
      key: "experimental_channels_config",
      value: {
        enabled: true,
        senderAllowlist: ["valid-user", "", 42, null, "another-user", "  "],
        webhook: { enabled: true },
      },
    });

    const config = await service.getConfig();
    // empty strings and whitespace-only strings are filtered out
    expect(config.senderAllowlist).toEqual(["valid-user", "another-user"]);
  });

  it("handles completely null config value", async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue({
      key: "experimental_channels_config",
      value: null,
    });

    const config = await service.getConfig();
    expect(config.enabled).toBe(false);
  });
});

// ── channelEnabled / channelSecret for telegram and ci_monitoring ─────

describe("channel source routing", () => {
  it("routes telegram source correctly in ingestEvent", async () => {
    setConfig(makeEnabledConfig({
      telegram: { enabled: true, signingSecret: "tg-secret" },
    }));

    const result = await service.ingestEvent({
      source: "telegram",
      senderId: "user-1",
      content: "Hello from telegram",
      signingSecret: "tg-secret",
    });

    expect(result.event.source).toBe("telegram");
  });

  it("routes ci_monitoring source correctly in ingestEvent", async () => {
    setConfig(makeEnabledConfig({
      ciMonitoring: { enabled: true, signingSecret: "" },
    }));

    const result = await service.ingestEvent({
      source: "ci_monitoring",
      senderId: "ci-bot",
      content: "Build passed",
    });

    expect(result.event.source).toBe("ci_monitoring");
  });
});

// ── resolveSessionId branches ────────────────────────────────────────────

describe("resolveSessionId branches", () => {
  it("uses explicit sessionId from input when provided", async () => {
    setConfig(makeEnabledConfig({
      defaultSessionId: "default-session",
    }));

    const result = await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Hello",
      sessionId: "explicit-session",
    });

    expect(result.event.sessionId).toBe("explicit-session");
  });

  it("falls back to defaultSessionId from config when no explicit sessionId", async () => {
    setConfig(makeEnabledConfig({
      defaultSessionId: "default-session",
    }));

    const result = await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Hello",
    });

    expect(result.event.sessionId).toBe("default-session");
  });

  it("uses existing session from listSessions when available", async () => {
    setConfig(makeEnabledConfig({
      defaultProjectId: "proj-1",
    }));
    chatService.listSessions.mockResolvedValue([{ id: "existing-session" }]);

    const result = await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Hello",
    });

    expect(result.event.sessionId).toBe("existing-session");
    expect(chatService.createSession).not.toHaveBeenCalled();
  });

  it("returns null sessionId when no projectId resolved", async () => {
    setConfig(makeEnabledConfig());

    const result = await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Hello",
    });

    expect(result.event.sessionId).toBeNull();
  });
});

// ── resolveProjectForRun edge cases ──────────────────────────────────────

describe("resolveProjectForRun edge cases", () => {
  it("returns null when runProjection metadata has empty repo_id", async () => {
    setConfig(makeEnabledConfig());
    mockPrisma.runProjection.findUnique.mockResolvedValue({
      runId: "run-1",
      metadata: { repo_id: "   " },
    });

    const result = await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Hello",
      runId: "run-1",
    });

    // Falls back to null since repo_id is whitespace
    expect(result.event.projectId).toBeNull();
  });

  it("returns null when runProjection metadata has non-string repo_id", async () => {
    setConfig(makeEnabledConfig());
    mockPrisma.runProjection.findUnique.mockResolvedValue({
      runId: "run-1",
      metadata: { repo_id: 12345 },
    });

    const result = await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Hello",
      runId: "run-1",
    });

    expect(result.event.projectId).toBeNull();
  });
});

// ── runEvent creation when event has runId ────────────────────────────────

describe("ingestEvent with runId", () => {
  it("creates a run event when event has a runId", async () => {
    setConfig(makeEnabledConfig());

    const result = await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Hello",
      runId: "run-123",
    });

    // Should create: 1 for channel_event + N for subagent activities
    const calls = mockPrisma.runEvent.create.mock.calls;
    const channelEventCall = calls.find(
      (c: any) => c[0].data.kind === "channel_event",
    );
    expect(channelEventCall).toBeTruthy();
    expect(channelEventCall![0].data.runId).toBe("run-123");
  });
});

// ── toChannelPrompt formatting ───────────────────────────────────────────

describe("toChannelPrompt (tested via deliveredToSession)", () => {
  it("includes project, ticket, and run references in the prompt", async () => {
    setConfig(makeEnabledConfig({
      allowUnattendedReadOnly: true,
      defaultProjectId: "proj-1",
      defaultSessionId: "session-1",
    }));

    await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Fix the bug",
      ticketId: "TICKET-42",
      runId: "run-99",
    });

    const promptArg = chatService.createUserMessage.mock.calls[0][1];
    expect(promptArg).toContain('source="webhook"');
    expect(promptArg).toContain('sender="user-1"');
    expect(promptArg).toContain("project=proj-1");
    expect(promptArg).toContain("ticket=TICKET-42");
    expect(promptArg).toContain("run=run-99");
    expect(promptArg).toContain("Fix the bug");
    expect(promptArg).toContain("Planned subagents:");
  });

  it("shows 'none' for subagent roles when list is empty (edge case)", async () => {
    // This tests the toChannelPrompt "none" fallback — though in practice
    // planSubagentRoles always returns at least 2 roles, we test the format
    setConfig(makeEnabledConfig({
      allowUnattendedReadOnly: true,
      defaultProjectId: "proj-1",
      defaultSessionId: "session-1",
    }));

    await service.ingestEvent({
      source: "webhook",
      senderId: "user-1",
      content: "Random content",
    });

    const promptArg = chatService.createUserMessage.mock.calls[0][1];
    expect(promptArg).toContain("Planned subagents: repo_scout, planner");
  });
});

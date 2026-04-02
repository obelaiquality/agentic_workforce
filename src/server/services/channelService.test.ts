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

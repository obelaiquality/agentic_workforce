/**
 * Unit tests for bootstrap.ts
 * Tests seedIfEmpty, seedV2ReadModels, and seedModelPluginRegistry.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({
  prisma: {
    ticket: { count: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
    chatSession: { count: vi.fn(), create: vi.fn() },
    taskProjection: { count: vi.fn(), upsert: vi.fn() },
    approvalRequest: { findMany: vi.fn() },
    approvalProjection: { upsert: vi.fn() },
    knowledgeIndexMetadata: { count: vi.fn(), create: vi.fn() },
    appSetting: { findUnique: vi.fn() },
    modelPluginRegistry: { upsert: vi.fn() },
  },
}));

vi.mock("./providers/modelPlugins", () => ({
  listOnPremQwenModelPlugins: vi.fn().mockReturnValue([
    {
      id: "qwen3.5-4b",
      runtimeModel: "mlx-community/Qwen3.5-4B-4bit",
      paramsB: 4,
      maxContext: 32768,
      recommendedBackend: "mlx-lm",
      notes: "",
    },
  ]),
}));

vi.mock("./routes/shared/ticketProjection", () => ({
  mapLegacyToLifecycle: vi.fn().mockReturnValue("backlog"),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn(),
  },
}));

import { prisma } from "./db";
import { seedIfEmpty, seedV2ReadModels, seedModelPluginRegistry } from "./bootstrap";
import { listOnPremQwenModelPlugins } from "./providers/modelPlugins";
import { mapLegacyToLifecycle } from "./routes/shared/ticketProjection";
import fs from "node:fs";

describe("seedIfEmpty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips ticket creation when count > 0", async () => {
    vi.mocked(prisma.ticket.count).mockResolvedValue(5);
    vi.mocked(prisma.chatSession.count).mockResolvedValue(1);

    await seedIfEmpty();

    expect(prisma.ticket.createMany).not.toHaveBeenCalled();
  });

  it("creates 3 tickets when count is 0", async () => {
    vi.mocked(prisma.ticket.count).mockResolvedValue(0);
    vi.mocked(prisma.ticket.createMany).mockResolvedValue({ count: 3 });
    vi.mocked(prisma.chatSession.count).mockResolvedValue(1);

    await seedIfEmpty();

    expect(prisma.ticket.createMany).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.ticket.createMany).mock.calls[0][0];
    expect(call?.data).toHaveLength(3);
  });

  it("skips session creation when count > 0", async () => {
    vi.mocked(prisma.ticket.count).mockResolvedValue(1);
    vi.mocked(prisma.chatSession.count).mockResolvedValue(2);

    await seedIfEmpty();

    expect(prisma.chatSession.create).not.toHaveBeenCalled();
  });

  it("creates session when count is 0", async () => {
    vi.mocked(prisma.ticket.count).mockResolvedValue(1);
    vi.mocked(prisma.chatSession.count).mockResolvedValue(0);
    vi.mocked(prisma.chatSession.create).mockResolvedValue({} as never);

    await seedIfEmpty();

    expect(prisma.chatSession.create).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.chatSession.create).mock.calls[0][0];
    expect(call?.data).toEqual(
      expect.objectContaining({
        title: "Overseer Session",
        providerId: "onprem-qwen",
      }),
    );
  });
});

describe("seedV2ReadModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips projection creation when count > 0", async () => {
    vi.mocked(prisma.taskProjection.count).mockResolvedValue(5);
    vi.mocked(prisma.approvalRequest.findMany).mockResolvedValue([]);
    vi.mocked(prisma.knowledgeIndexMetadata.count).mockResolvedValue(1);

    await seedV2ReadModels();

    expect(prisma.ticket.findMany).not.toHaveBeenCalled();
    expect(prisma.taskProjection.upsert).not.toHaveBeenCalled();
  });

  it("creates projections for legacy tickets when count is 0", async () => {
    vi.mocked(prisma.taskProjection.count).mockResolvedValue(0);
    vi.mocked(prisma.ticket.findMany).mockResolvedValue([
      {
        id: "t1",
        title: "Test Ticket",
        description: "desc",
        status: "ready",
        priority: "p1",
        risk: "low",
        acceptanceCriteria: ["a"],
        dependencies: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);
    vi.mocked(prisma.taskProjection.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.approvalRequest.findMany).mockResolvedValue([]);
    vi.mocked(prisma.knowledgeIndexMetadata.count).mockResolvedValue(1);

    await seedV2ReadModels();

    expect(prisma.ticket.findMany).toHaveBeenCalledOnce();
    expect(mapLegacyToLifecycle).toHaveBeenCalledWith("ready");
    expect(prisma.taskProjection.upsert).toHaveBeenCalledOnce();
    expect(prisma.taskProjection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ticketId: "t1" },
      }),
    );
  });

  it("processes pending approval rows", async () => {
    vi.mocked(prisma.taskProjection.count).mockResolvedValue(1);
    vi.mocked(prisma.approvalRequest.findMany).mockResolvedValue([
      {
        id: "a1",
        actionType: "code_apply",
        status: "pending",
        reason: "needs review",
        payload: {},
        requestedAt: new Date(),
        decidedAt: null,
      },
    ] as never);
    vi.mocked(prisma.approvalProjection.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.knowledgeIndexMetadata.count).mockResolvedValue(1);

    await seedV2ReadModels();

    expect(prisma.approvalProjection.upsert).toHaveBeenCalledOnce();
    expect(prisma.approvalProjection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { approvalId: "a1" },
      }),
    );
  });

  it("skips knowledge seeding when count > 0", async () => {
    vi.mocked(prisma.taskProjection.count).mockResolvedValue(1);
    vi.mocked(prisma.approvalRequest.findMany).mockResolvedValue([]);
    vi.mocked(prisma.knowledgeIndexMetadata.count).mockResolvedValue(5);

    await seedV2ReadModels();

    expect(fs.existsSync).not.toHaveBeenCalled();
    expect(prisma.knowledgeIndexMetadata.create).not.toHaveBeenCalled();
  });
});

describe("seedModelPluginRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts plugins from listOnPremQwenModelPlugins", async () => {
    vi.mocked(prisma.appSetting.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.modelPluginRegistry.upsert).mockResolvedValue({} as never);

    await seedModelPluginRegistry();

    expect(listOnPremQwenModelPlugins).toHaveBeenCalledOnce();
    expect(prisma.modelPluginRegistry.upsert).toHaveBeenCalledOnce();
    expect(prisma.modelPluginRegistry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pluginId: "qwen3.5-4b" },
        create: expect.objectContaining({
          pluginId: "qwen3.5-4b",
          providerId: "onprem-qwen",
          modelId: "mlx-community/Qwen3.5-4B-4bit",
          paramsB: 4,
          active: true,
        }),
      }),
    );
  });

  it("uses default pluginId when no stored config", async () => {
    vi.mocked(prisma.appSetting.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.modelPluginRegistry.upsert).mockResolvedValue({} as never);

    await seedModelPluginRegistry();

    // Default pluginId is "qwen3.5-4b", so active should be true for matching plugin
    const call = vi.mocked(prisma.modelPluginRegistry.upsert).mock.calls[0][0];
    expect(call.create).toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  it("uses stored pluginId when config exists", async () => {
    vi.mocked(prisma.appSetting.findUnique).mockResolvedValue({
      key: "onprem_qwen_config",
      value: { pluginId: "some-other-plugin" },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(prisma.modelPluginRegistry.upsert).mockResolvedValue({} as never);

    await seedModelPluginRegistry();

    // Since stored pluginId is "some-other-plugin" and the plugin id is "qwen3.5-4b",
    // active should be false
    const call = vi.mocked(prisma.modelPluginRegistry.upsert).mock.calls[0][0];
    expect(call.create).toEqual(
      expect.objectContaining({ active: false }),
    );
  });
});

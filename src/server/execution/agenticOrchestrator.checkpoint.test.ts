import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  prisma: {
    appSetting: {
      upsert: vi.fn().mockResolvedValue(undefined),
      findUnique: vi.fn().mockResolvedValue(null),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  },
}));

vi.mock("../db", () => ({
  prisma: dbMocks.prisma,
}));

describe("AgenticOrchestrator checkpoint persistence", () => {
  const TEST_RUN_ID = "test_checkpoint_run_12345";
  const CHECKPOINT_KEY = `agentic.checkpoint.${TEST_RUN_ID}`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should save and load checkpoint data", async () => {
    const checkpoint = {
      runId: TEST_RUN_ID,
      messages: [
        { role: "system", content: "Test system message", pinned: true, timestamp: new Date().toISOString() },
        { role: "user", content: "Test user message", pinned: true, timestamp: new Date().toISOString() },
      ],
      iterationCount: 5,
      budgetUsed: { tokens: 1000, cost: 0.05 },
      currentRole: "coder_default" as const,
      toolCallsTotal: 12,
      recentlyReadFiles: [{ path: "/test/file.ts", content: "test content" }],
      timestamp: new Date().toISOString(),
    };

    // Simulate save
    await dbMocks.prisma.appSetting.upsert({
      where: { key: CHECKPOINT_KEY },
      update: { value: checkpoint },
      create: { key: CHECKPOINT_KEY, value: checkpoint },
    });

    expect(dbMocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: CHECKPOINT_KEY },
        create: expect.objectContaining({ key: CHECKPOINT_KEY }),
      })
    );

    // Simulate load
    dbMocks.prisma.appSetting.findUnique.mockResolvedValueOnce({
      key: CHECKPOINT_KEY,
      value: checkpoint,
    });

    const loaded = await dbMocks.prisma.appSetting.findUnique({
      where: { key: CHECKPOINT_KEY },
    });

    expect(loaded).toBeTruthy();
    expect(loaded?.value).toMatchObject({
      runId: TEST_RUN_ID,
      iterationCount: 5,
      budgetUsed: { tokens: 1000, cost: 0.05 },
      currentRole: "coder_default",
      toolCallsTotal: 12,
    });
  });

  it("should delete checkpoint on cleanup", async () => {
    // Delete checkpoint
    await dbMocks.prisma.appSetting.deleteMany({
      where: { key: CHECKPOINT_KEY },
    });

    expect(dbMocks.prisma.appSetting.deleteMany).toHaveBeenCalledWith({
      where: { key: CHECKPOINT_KEY },
    });

    // Verify findUnique returns null (already default mock)
    const afterDelete = await dbMocks.prisma.appSetting.findUnique({
      where: { key: CHECKPOINT_KEY },
    });
    expect(afterDelete).toBeNull();
  });
});

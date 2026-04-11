import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DreamScheduler, type DreamSchedulerConfig } from "./dreamScheduler";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockPromoteLearning = vi.fn().mockResolvedValue(undefined);
const mockConsolidateGlobal = vi.fn().mockResolvedValue(undefined);
const mockRecomputeUniversality = vi.fn().mockResolvedValue(undefined);
const mockGetLearnings = vi.fn().mockReturnValue([]);

vi.mock("./autoExtractor", () => ({
  AutoMemoryExtractor: vi.fn().mockImplementation(() => ({
    runDream: vi.fn().mockResolvedValue({ learningsExtracted: 3, skillsSuggested: 1 }),
  })),
}));

vi.mock("../services/memoryService", () => ({
  MemoryService: vi.fn().mockImplementation(() => ({
    loadEpisodicMemory: vi.fn(),
  })),
}));

vi.mock("../services/learningsService", () => ({
  LearningsService: vi.fn().mockImplementation(() => ({
    getLearnings: mockGetLearnings,
  })),
}));

vi.mock("../services/skillSynthesizer", () => ({
  SkillSynthesizer: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../services/globalKnowledgePool", () => ({
  GlobalKnowledgePool: vi.fn().mockImplementation(() => ({
    promoteLearning: mockPromoteLearning,
    consolidateGlobal: mockConsolidateGlobal,
    recomputeUniversality: mockRecomputeUniversality,
  })),
}));

import { AutoMemoryExtractor } from "./autoExtractor";
import { MemoryService } from "../services/memoryService";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeConfig(
  overrides?: Partial<DreamSchedulerConfig>,
): DreamSchedulerConfig {
  return {
    intervalHours: 24,
    getProjectWorktrees: vi.fn().mockResolvedValue([
      { projectId: "proj-1", worktreePath: "/tmp/proj1" },
      { projectId: "proj-2", worktreePath: "/tmp/proj2" },
    ]),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("DreamScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 1. starts timer with correct interval
  it("starts timer with correct interval", () => {
    const scheduler = new DreamScheduler(makeConfig({ intervalHours: 6 }));
    const spy = vi.spyOn(globalThis, "setInterval");

    scheduler.start();

    expect(spy).toHaveBeenCalledOnce();
    const intervalMs = spy.mock.calls[0][1];
    expect(intervalMs).toBe(6 * 60 * 60 * 1000);

    scheduler.stop();
    spy.mockRestore();
  });

  // 2. stop clears timer
  it("stop clears timer", () => {
    const spy = vi.spyOn(globalThis, "clearInterval");
    const scheduler = new DreamScheduler(makeConfig());

    scheduler.start();
    scheduler.stop();

    expect(spy).toHaveBeenCalledOnce();
    expect(scheduler.isRunning).toBe(false);

    spy.mockRestore();
  });

  // 3. isRunning reflects timer state
  it("isRunning reflects timer state", () => {
    const scheduler = new DreamScheduler(makeConfig());

    expect(scheduler.isRunning).toBe(false);

    scheduler.start();
    expect(scheduler.isRunning).toBe(true);

    scheduler.stop();
    expect(scheduler.isRunning).toBe(false);
  });

  // 4. stats returns initial values
  it("stats returns initial values", () => {
    const scheduler = new DreamScheduler(makeConfig());
    const { lastDreamAt, dreamCount } = scheduler.stats;

    expect(lastDreamAt).toBeNull();
    expect(dreamCount).toBe(0);
  });

  // 5. runDreamCycle iterates all projects
  it("runDreamCycle iterates all projects", async () => {
    const config = makeConfig();
    const scheduler = new DreamScheduler(config);

    await scheduler.runDreamCycle();

    expect(config.getProjectWorktrees).toHaveBeenCalledOnce();
    // MemoryService constructed once per project
    expect(MemoryService).toHaveBeenCalledTimes(2);
    expect(MemoryService).toHaveBeenCalledWith("/tmp/proj1");
    expect(MemoryService).toHaveBeenCalledWith("/tmp/proj2");
    // AutoMemoryExtractor constructed once per project
    expect(AutoMemoryExtractor).toHaveBeenCalledTimes(2);
  });

  // 6. runDreamCycle continues on individual project failure
  it("runDreamCycle continues on individual project failure", async () => {
    const runDreamFailing = vi
      .fn()
      .mockRejectedValueOnce(new Error("project 1 boom"))
      .mockResolvedValueOnce({ consolidated: 1, removed: 0 });

    (AutoMemoryExtractor as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ runDream: runDreamFailing }),
    );

    const config = makeConfig();
    const scheduler = new DreamScheduler(config);

    await scheduler.runDreamCycle();

    // Both projects attempted despite first one throwing
    expect(runDreamFailing).toHaveBeenCalledTimes(2);
    // Stats still updated because the outer try succeeded
    expect(scheduler.stats.dreamCount).toBe(1);
  });

  // 7. runDreamCycle updates stats after success
  it("runDreamCycle updates stats after success", async () => {
    const scheduler = new DreamScheduler(makeConfig());

    const before = Date.now();
    await scheduler.runDreamCycle();

    expect(scheduler.stats.dreamCount).toBe(1);
    expect(scheduler.stats.lastDreamAt).not.toBeNull();

    const timestamp = new Date(scheduler.stats.lastDreamAt!).getTime();
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(Date.now());

    // A second cycle increments further
    await scheduler.runDreamCycle();
    expect(scheduler.stats.dreamCount).toBe(2);
  });

  // 8. runDreamCycle handles getProjectWorktrees failure silently
  it("runDreamCycle handles getProjectWorktrees failure silently", async () => {
    const config = makeConfig({
      getProjectWorktrees: vi
        .fn()
        .mockRejectedValue(new Error("db connection lost")),
    });
    const scheduler = new DreamScheduler(config);

    // Should not throw
    await expect(scheduler.runDreamCycle()).resolves.toBeUndefined();

    // Stats unchanged — outer catch swallowed the error
    expect(scheduler.stats.dreamCount).toBe(0);
    expect(scheduler.stats.lastDreamAt).toBeNull();
  });

  // 9. start is idempotent (calling twice doesn't create duplicate timers)
  it("start is idempotent", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    const scheduler = new DreamScheduler(makeConfig());

    scheduler.start();
    scheduler.start(); // second call should be a no-op

    expect(spy).toHaveBeenCalledOnce();
    expect(scheduler.isRunning).toBe(true);

    scheduler.stop();
    spy.mockRestore();
  });

  // 10. stop is idempotent
  it("stop is idempotent", () => {
    const spy = vi.spyOn(globalThis, "clearInterval");
    const scheduler = new DreamScheduler(makeConfig());

    // Stopping before start should not throw or call clearInterval
    scheduler.stop();
    expect(spy).not.toHaveBeenCalled();

    // Start then stop twice
    scheduler.start();
    scheduler.stop();
    scheduler.stop(); // second call should be a no-op

    expect(spy).toHaveBeenCalledOnce();
    expect(scheduler.isRunning).toBe(false);

    spy.mockRestore();
  });

  // 11. runDreamCycle tracks learningsExtracted and skillsSuggested
  it("runDreamCycle tracks learnings and skills counts from extractor", async () => {
    (AutoMemoryExtractor as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ runDream: vi.fn().mockResolvedValue({ learningsExtracted: 3, skillsSuggested: 1 }) }),
    );

    const scheduler = new DreamScheduler(makeConfig());

    await scheduler.runDreamCycle();

    // Each project returns { learningsExtracted: 3, skillsSuggested: 1 }
    // Two projects = 6 learnings, 2 skills
    expect(scheduler.stats.learningsCount).toBe(6);
    expect(scheduler.stats.suggestedSkillsCount).toBe(2);
  });

  // 12. runDreamCycle promotes high-confidence learnings to global pool
  it("runDreamCycle promotes learnings to global pool", async () => {
    (AutoMemoryExtractor as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ runDream: vi.fn().mockResolvedValue({ learningsExtracted: 1, skillsSuggested: 0 }) }),
    );
    mockGetLearnings.mockReturnValue([
      { id: "l1", summary: "Learning 1", confidence: 0.8 },
      { id: "l2", summary: "Learning 2", confidence: 0.7 },
    ]);

    const scheduler = new DreamScheduler(makeConfig());

    await scheduler.runDreamCycle();

    // 2 learnings per project x 2 projects = 4 promotions
    expect(mockPromoteLearning).toHaveBeenCalledTimes(4);
    expect(scheduler.stats.globalLearningsPromoted).toBe(4);
  });

  // 13. runDreamCycle uses getTechFingerprint callback when provided
  it("runDreamCycle calls getTechFingerprint when provided", async () => {
    (AutoMemoryExtractor as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ runDream: vi.fn().mockResolvedValue({ learningsExtracted: 1, skillsSuggested: 0 }) }),
    );
    mockGetLearnings.mockReturnValue([
      { id: "l1", summary: "Test", confidence: 0.9 },
    ]);

    const mockGetFingerprint = vi.fn().mockResolvedValue(["typescript", "react"]);
    const config = makeConfig({
      getTechFingerprint: mockGetFingerprint,
    });
    const scheduler = new DreamScheduler(config);

    await scheduler.runDreamCycle();

    expect(mockGetFingerprint).toHaveBeenCalledWith("proj-1");
    expect(mockGetFingerprint).toHaveBeenCalledWith("proj-2");
    expect(mockPromoteLearning).toHaveBeenCalledWith(
      expect.anything(),
      ["typescript", "react"],
      expect.any(String),
    );
  });

  // 14. runDreamCycle uses empty array when getTechFingerprint is not provided
  it("runDreamCycle passes empty fingerprint array when getTechFingerprint not provided", async () => {
    (AutoMemoryExtractor as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ runDream: vi.fn().mockResolvedValue({ learningsExtracted: 1, skillsSuggested: 0 }) }),
    );
    mockGetLearnings.mockReturnValue([
      { id: "l1", summary: "Test", confidence: 0.9 },
    ]);

    const config = makeConfig();
    // Ensure no getTechFingerprint is set
    delete (config as any).getTechFingerprint;

    const scheduler = new DreamScheduler(config);

    await scheduler.runDreamCycle();

    expect(mockPromoteLearning).toHaveBeenCalledWith(
      expect.anything(),
      [],
      expect.any(String),
    );
  });

  // 15. runDreamCycle handles promoteLearning failure gracefully
  it("runDreamCycle continues when promoteLearning throws", async () => {
    (AutoMemoryExtractor as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ runDream: vi.fn().mockResolvedValue({ learningsExtracted: 1, skillsSuggested: 0 }) }),
    );
    mockGetLearnings.mockReturnValue([
      { id: "l1", summary: "Fail", confidence: 0.9 },
      { id: "l2", summary: "Succeed", confidence: 0.8 },
    ]);
    mockPromoteLearning
      .mockRejectedValueOnce(new Error("promotion failed"))
      .mockResolvedValue(undefined);

    const scheduler = new DreamScheduler(makeConfig());

    await scheduler.runDreamCycle();

    // Should still complete the dream cycle
    expect(scheduler.stats.dreamCount).toBe(1);
    // One failure + three successes = 3 promoted
    expect(scheduler.stats.globalLearningsPromoted).toBe(3);
  });

  // 16. runDreamCycle handles global consolidation failure silently
  it("runDreamCycle handles global consolidation failure silently", async () => {
    mockConsolidateGlobal.mockRejectedValueOnce(new Error("consolidation failed"));

    const scheduler = new DreamScheduler(makeConfig());

    await scheduler.runDreamCycle();

    // Dream cycle should still complete
    expect(scheduler.stats.dreamCount).toBe(1);
  });

  // 17. runDreamCycle handles recomputeUniversality failure silently
  it("runDreamCycle handles recomputeUniversality failure silently", async () => {
    mockRecomputeUniversality.mockRejectedValueOnce(new Error("recompute failed"));

    const scheduler = new DreamScheduler(makeConfig());

    await scheduler.runDreamCycle();

    expect(scheduler.stats.dreamCount).toBe(1);
  });

  // 18. runDreamCycle calls consolidateGlobal and recomputeUniversality
  it("runDreamCycle calls global consolidation after processing projects", async () => {
    const scheduler = new DreamScheduler(makeConfig());

    await scheduler.runDreamCycle();

    expect(mockConsolidateGlobal).toHaveBeenCalledOnce();
    expect(mockRecomputeUniversality).toHaveBeenCalledOnce();
  });
});

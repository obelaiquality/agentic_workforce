import { describe, it, expect, beforeEach, vi } from "vitest";
import { AutoMemoryExtractor, type MemoryExtractionInput } from "./autoExtractor";
import type { MemoryService } from "../services/memoryService";

// ---------------------------------------------------------------------------
// Mock MemoryService
// ---------------------------------------------------------------------------

function createMockMemoryService(): MemoryService {
  let idCounter = 0;
  return {
    addEpisodicMemory: vi.fn((input) => ({
      id: `mem-${++idCounter}`,
      taskDescription: input.taskDescription,
      summary: input.summary,
      outcome: input.outcome,
      keyFiles: input.keyFiles ?? [],
      lessons: input.lessons ?? [],
      createdAt: new Date().toISOString(),
    })),
    getRelevantEpisodicMemories: vi.fn(() => []),
  } as unknown as MemoryService;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides?: Partial<MemoryExtractionInput>): MemoryExtractionInput {
  return {
    runId: "run-1",
    projectId: "proj-1",
    ticketId: "ticket-1",
    iteration: 10,
    conversationHistory: [],
    toolCalls: [
      {
        name: "file_edit",
        args: { path: "src/server/app.ts" },
        resultType: "success" as const,
        durationMs: 100,
      },
    ],
    objective: "Fix the login bug",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AutoMemoryExtractor", () => {
  let memoryService: MemoryService;

  beforeEach(() => {
    memoryService = createMockMemoryService();
  });

  // ── enabled getter ──────────────────────────────────────────────────

  describe("enabled", () => {
    it("returns true when config.enabled is true (default)", () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      expect(extractor.enabled).toBe(true);
    });

    it("returns false when config.enabled is false", () => {
      const extractor = new AutoMemoryExtractor(memoryService, { enabled: false });
      expect(extractor.enabled).toBe(false);
    });
  });

  // ── shouldExtract ───────────────────────────────────────────────────

  describe("shouldExtract", () => {
    it("returns false when disabled", () => {
      const extractor = new AutoMemoryExtractor(memoryService, { enabled: false });
      expect(extractor.shouldExtract("run-1", 100)).toBe(false);
    });

    it("returns false before threshold iteration", () => {
      const extractor = new AutoMemoryExtractor(memoryService, { extractAfterIterations: 5 });
      expect(extractor.shouldExtract("run-1", 3)).toBe(false);
    });

    it("returns true at threshold iteration", () => {
      const extractor = new AutoMemoryExtractor(memoryService, { extractAfterIterations: 5 });
      expect(extractor.shouldExtract("run-1", 5)).toBe(true);
    });

    it("respects last extraction tracking", async () => {
      const extractor = new AutoMemoryExtractor(memoryService, { extractAfterIterations: 5 });

      // First extraction at iteration 5
      expect(extractor.shouldExtract("run-1", 5)).toBe(true);
      await extractor.extractFromIteration(makeInput({ iteration: 5 }));

      // Should not extract again at iteration 7 (only 2 since last)
      expect(extractor.shouldExtract("run-1", 7)).toBe(false);

      // Should extract again at iteration 10 (5 since last)
      expect(extractor.shouldExtract("run-1", 10)).toBe(true);
    });
  });

  // ── extractFromIteration ────────────────────────────────────────────

  describe("extractFromIteration", () => {
    it("returns null when disabled", async () => {
      const extractor = new AutoMemoryExtractor(memoryService, { enabled: false });
      const result = await extractor.extractFromIteration(makeInput());
      expect(result).toBeNull();
    });

    it("returns null when no tool calls", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      const result = await extractor.extractFromIteration(makeInput({ toolCalls: [] }));
      expect(result).toBeNull();
    });

    it("extracts file paths from tool args", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      const input = makeInput({
        toolCalls: [
          { name: "file_read", args: { path: "src/utils/helper.ts" }, resultType: "success", durationMs: 50 },
          { name: "file_edit", args: { path: "src/utils/helper.ts" }, resultType: "success", durationMs: 80 },
          { name: "file_read", args: { path: "lib/config.json" }, resultType: "success", durationMs: 30 },
        ],
      });

      await extractor.extractFromIteration(input);

      const addCall = (memoryService.addEpisodicMemory as ReturnType<typeof vi.fn>).mock.calls[0][0];
      // Deduplicated file list
      expect(addCall.keyFiles).toContain("src/utils/helper.ts");
      expect(addCall.keyFiles).toContain("lib/config.json");
      expect(addCall.keyFiles).toHaveLength(2);
    });

    it("determines success outcome when no errors", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      const input = makeInput({
        toolCalls: [
          { name: "file_read", args: {}, resultType: "success", durationMs: 50 },
          { name: "file_edit", args: {}, resultType: "success", durationMs: 80 },
        ],
      });

      await extractor.extractFromIteration(input);

      const addCall = (memoryService.addEpisodicMemory as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(addCall.outcome).toBe("success");
    });

    it("determines failure outcome when all calls error", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      const input = makeInput({
        toolCalls: [
          { name: "file_edit", args: {}, resultType: "error", durationMs: 50 },
          { name: "shell_exec", args: {}, resultType: "error", durationMs: 80 },
        ],
      });

      await extractor.extractFromIteration(input);

      const addCall = (memoryService.addEpisodicMemory as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(addCall.outcome).toBe("failure");
    });

    it("determines partial outcome with mixed results", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      const input = makeInput({
        toolCalls: [
          { name: "file_edit", args: {}, resultType: "success", durationMs: 50 },
          { name: "shell_exec", args: {}, resultType: "error", durationMs: 80 },
        ],
      });

      await extractor.extractFromIteration(input);

      const addCall = (memoryService.addEpisodicMemory as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(addCall.outcome).toBe("partial");
    });

    it("builds summary with tool names", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      const input = makeInput({
        iteration: 7,
        toolCalls: [
          { name: "file_read", args: { path: "src/app.ts" }, resultType: "success", durationMs: 50 },
          { name: "shell_exec", args: {}, resultType: "success", durationMs: 80 },
        ],
      });

      await extractor.extractFromIteration(input);

      const addCall = (memoryService.addEpisodicMemory as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(addCall.summary).toContain("Iteration 7");
      expect(addCall.summary).toContain("file_read");
      expect(addCall.summary).toContain("shell_exec");
      expect(addCall.summary).toContain("All operations succeeded");
    });

    it("extracts lessons from errors", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      const input = makeInput({
        toolCalls: [
          { name: "file_edit", args: {}, resultType: "error", durationMs: 50 },
          { name: "shell_exec", args: {}, resultType: "success", durationMs: 80 },
        ],
      });

      await extractor.extractFromIteration(input);

      const addCall = (memoryService.addEpisodicMemory as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(addCall.lessons.length).toBeGreaterThan(0);
      expect(addCall.lessons[0]).toContain("file_edit");
    });
  });

  // ── extractFromCompletion ───────────────────────────────────────────

  describe("extractFromCompletion", () => {
    it("stores completion memory with correct fields", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      const result = await extractor.extractFromCompletion({
        runId: "run-1",
        projectId: "proj-1",
        ticketId: "ticket-1",
        objective: "Add user authentication",
        totalIterations: 8,
        totalToolCalls: 15,
        finalMessage: "Successfully added JWT auth to the application.",
        success: true,
      });

      expect(result).not.toBeNull();
      expect(result!.id).toBeTruthy();
      expect(result!.summary).toBeTruthy();

      const addCall = (memoryService.addEpisodicMemory as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(addCall.taskDescription).toBe("Add user authentication");
      expect(addCall.outcome).toBe("success");
    });

    it("extracts file paths from final message", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      await extractor.extractFromCompletion({
        runId: "run-1",
        projectId: "proj-1",
        ticketId: "ticket-1",
        objective: "Refactor components",
        totalIterations: 5,
        totalToolCalls: 10,
        finalMessage: "Updated src/components/Login.tsx and test/auth.test.ts for the refactor.",
        success: true,
      });

      const addCall = (memoryService.addEpisodicMemory as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(addCall.keyFiles).toContain("src/components/Login.tsx");
      expect(addCall.keyFiles).toContain("test/auth.test.ts");
    });

    it("adds lesson for long iterations", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      await extractor.extractFromCompletion({
        runId: "run-1",
        projectId: "proj-1",
        ticketId: "ticket-1",
        objective: "Complex migration",
        totalIterations: 25,
        totalToolCalls: 60,
        finalMessage: "Done.",
        success: true,
      });

      const addCall = (memoryService.addEpisodicMemory as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(addCall.lessons.some((l: string) => l.includes("25 iterations"))).toBe(true);
      expect(addCall.lessons.some((l: string) => l.includes("decomposing"))).toBe(true);
    });

    it("returns null when disabled", async () => {
      const extractor = new AutoMemoryExtractor(memoryService, { enabled: false });
      const result = await extractor.extractFromCompletion({
        runId: "run-1",
        projectId: "proj-1",
        ticketId: "ticket-1",
        objective: "Task",
        totalIterations: 5,
        totalToolCalls: 10,
        finalMessage: "Done.",
        success: true,
      });

      expect(result).toBeNull();
    });
  });

  // ── runDream ────────────────────────────────────────────────────────

  describe("runDream", () => {
    it("returns early with few memories", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      (memoryService.getRelevantEpisodicMemories as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: "1", summary: "Memory one", taskDescription: "Task 1", outcome: "success", keyFiles: [], lessons: [], createdAt: new Date().toISOString() },
        { id: "2", summary: "Memory two", taskDescription: "Task 2", outcome: "success", keyFiles: [], lessons: [], createdAt: new Date().toISOString() },
      ]);

      const result = await extractor.runDream("proj-1");

      expect(result.consolidated).toBe(0);
      expect(result.removed).toBe(0);
    });

    it("detects duplicate memories", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      (memoryService.getRelevantEpisodicMemories as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: "1", summary: "Iteration 5: Used file_read on 2 files.", taskDescription: "Task", outcome: "success", keyFiles: [], lessons: [], createdAt: new Date().toISOString() },
        { id: "2", summary: "Iteration 5: Used file_read on 2 files.", taskDescription: "Task", outcome: "success", keyFiles: [], lessons: [], createdAt: new Date().toISOString() },
        { id: "3", summary: "Different summary entirely.", taskDescription: "Other task", outcome: "success", keyFiles: [], lessons: [], createdAt: new Date().toISOString() },
        { id: "4", summary: "Another unique summary here.", taskDescription: "Another task", outcome: "partial", keyFiles: [], lessons: [], createdAt: new Date().toISOString() },
        { id: "5", summary: "Fifth unique summary content.", taskDescription: "Fifth task", outcome: "success", keyFiles: [], lessons: [], createdAt: new Date().toISOString() },
      ]);

      const result = await extractor.runDream("proj-1");

      expect(result.removed).toBe(1); // one duplicate
      expect(result.consolidated).toBe(4); // 4 unique
    });
  });

  // ── resetRun ────────────────────────────────────────────────────────

  describe("resetRun", () => {
    it("clears tracking for a run", async () => {
      const extractor = new AutoMemoryExtractor(memoryService, { extractAfterIterations: 5 });

      // Extract at iteration 5 to set tracking
      await extractor.extractFromIteration(makeInput({ iteration: 5 }));

      // Iteration 6 should not trigger (only 1 since last)
      expect(extractor.shouldExtract("run-1", 6)).toBe(false);

      // Reset the run
      extractor.resetRun("run-1");

      // Now iteration 6 should trigger (tracking cleared, 6 >= threshold)
      expect(extractor.shouldExtract("run-1", 6)).toBe(true);
    });
  });
});

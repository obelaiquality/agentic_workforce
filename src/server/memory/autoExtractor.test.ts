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

  // ── extractFromCompletion - failure path ─────────────────────────────

  describe("extractFromCompletion - failure lessons", () => {
    it("adds lesson when task was not successful", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      await extractor.extractFromCompletion({
        runId: "run-1",
        projectId: "proj-1",
        ticketId: "ticket-1",
        objective: "Deploy new feature",
        totalIterations: 10,
        totalToolCalls: 20,
        finalMessage: "Failed to deploy due to dependency issues.",
        success: false,
      });

      const addCall = (memoryService.addEpisodicMemory as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(addCall.outcome).toBe("failure");
      expect(addCall.lessons.some((l: string) => l.includes("did not complete successfully"))).toBe(true);
    });

    it("adds both lessons when long iterations and failure", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      await extractor.extractFromCompletion({
        runId: "run-1",
        projectId: "proj-1",
        ticketId: "ticket-1",
        objective: "Long failing task",
        totalIterations: 30,
        totalToolCalls: 100,
        finalMessage: "Could not complete the task.",
        success: false,
      });

      const addCall = (memoryService.addEpisodicMemory as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(addCall.lessons).toHaveLength(2);
      expect(addCall.lessons.some((l: string) => l.includes("30 iterations"))).toBe(true);
      expect(addCall.lessons.some((l: string) => l.includes("did not complete"))).toBe(true);
    });

    it("returns null when addEpisodicMemory throws", async () => {
      const throwingMemoryService = {
        ...createMockMemoryService(),
        addEpisodicMemory: vi.fn(() => { throw new Error("persist failure"); }),
      } as unknown as MemoryService;

      const extractor = new AutoMemoryExtractor(throwingMemoryService);
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

    it("extractFromIteration returns null when addEpisodicMemory throws", async () => {
      const throwingMemoryService = {
        ...createMockMemoryService(),
        addEpisodicMemory: vi.fn(() => { throw new Error("persist failure"); }),
      } as unknown as MemoryService;

      const extractor = new AutoMemoryExtractor(throwingMemoryService);
      const result = await extractor.extractFromIteration(makeInput());
      expect(result).toBeNull();
    });

    it("extractFromCompletion handles finalMessage with no file paths", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      await extractor.extractFromCompletion({
        runId: "run-1",
        projectId: "proj-1",
        ticketId: "ticket-1",
        objective: "Simple task",
        totalIterations: 3,
        totalToolCalls: 5,
        finalMessage: "Done, nothing special.",
        success: true,
      });

      const addCall = (memoryService.addEpisodicMemory as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(addCall.keyFiles).toEqual([]);
      expect(addCall.lessons).toEqual([]);
    });

    it("extractFromCompletion truncates long objective and finalMessage", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      const longObjective = "A".repeat(300);
      const longMessage = "B".repeat(600);

      await extractor.extractFromCompletion({
        runId: "run-1",
        projectId: "proj-1",
        ticketId: "ticket-1",
        objective: longObjective,
        totalIterations: 5,
        totalToolCalls: 10,
        finalMessage: longMessage,
        success: true,
      });

      const addCall = (memoryService.addEpisodicMemory as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(addCall.taskDescription.length).toBeLessThanOrEqual(200);
      expect(addCall.summary.length).toBeLessThanOrEqual(500);
    });
  });

  // ── buildMemoryFromContext edge cases ──────────────────────────────

  describe("buildMemoryFromContext edge cases", () => {
    it("includes error count in summary when errors exist", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      const input = makeInput({
        iteration: 12,
        toolCalls: [
          { name: "file_edit", args: {}, resultType: "error", durationMs: 50 },
          { name: "shell_exec", args: {}, resultType: "success", durationMs: 80 },
          { name: "file_read", args: {}, resultType: "error", durationMs: 30 },
        ],
      });

      await extractor.extractFromIteration(input);

      const addCall = (memoryService.addEpisodicMemory as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(addCall.summary).toContain("2 errors encountered");
    });

    it("truncates objective in taskDescription to 200 chars", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      const longObjective = "X".repeat(300);
      const input = makeInput({ objective: longObjective });

      await extractor.extractFromIteration(input);

      const addCall = (memoryService.addEpisodicMemory as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(addCall.taskDescription.length).toBeLessThanOrEqual(200);
    });

    it("limits keyFiles to 10 entries", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      const toolCalls = [];
      for (let i = 0; i < 15; i++) {
        toolCalls.push({
          name: "file_edit",
          args: { path: `src/file${i}.ts` },
          resultType: "success" as const,
          durationMs: 50,
        });
      }

      const input = makeInput({ toolCalls });
      await extractor.extractFromIteration(input);

      const addCall = (memoryService.addEpisodicMemory as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(addCall.keyFiles.length).toBeLessThanOrEqual(10);
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

    it("extracts learnings from successes and failures when learningsService is provided", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      (memoryService.getRelevantEpisodicMemories as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: "1", summary: "Success memory one", taskDescription: "Task 1", outcome: "success", keyFiles: ["src/a.ts"], lessons: ["Pattern A works well"], createdAt: new Date().toISOString() },
        { id: "2", summary: "Failure memory two", taskDescription: "Task 2", outcome: "failure", keyFiles: ["src/b.ts"], lessons: ["Anti-pattern B causes issues"], createdAt: new Date().toISOString() },
        { id: "3", summary: "Another success three", taskDescription: "Task 3", outcome: "success", keyFiles: [], lessons: [], createdAt: new Date().toISOString() },
        { id: "4", summary: "Fourth unique memory", taskDescription: "Task 4", outcome: "partial", keyFiles: [], lessons: [], createdAt: new Date().toISOString() },
      ]);

      const learningsService = {
        recordPattern: vi.fn(),
        recordAntipattern: vi.fn(),
        consolidate: vi.fn(),
        pruneStale: vi.fn(),
      };

      const result = await extractor.runDream("proj-1", { learningsService: learningsService as any });

      expect(result.consolidated).toBe(4);
      expect(result.removed).toBe(0);
      expect(result.learningsExtracted).toBe(2); // 1 success pattern + 1 failure antipattern
      expect(learningsService.recordPattern).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "proj-1",
          summary: expect.stringContaining("Pattern A"),
          source: "auto_extraction",
        }),
      );
      expect(learningsService.recordAntipattern).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "proj-1",
          summary: expect.stringContaining("Anti-pattern B"),
          source: "auto_extraction",
        }),
      );
      expect(learningsService.consolidate).toHaveBeenCalledWith("proj-1");
      expect(learningsService.pruneStale).toHaveBeenCalledWith("proj-1");
    });

    it("synthesizes skills when skillSynthesizer is provided", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      (memoryService.getRelevantEpisodicMemories as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: "1", summary: "Memory A content", taskDescription: "Task 1", outcome: "success", keyFiles: [], lessons: [], createdAt: new Date().toISOString() },
        { id: "2", summary: "Memory B content", taskDescription: "Task 2", outcome: "success", keyFiles: [], lessons: [], createdAt: new Date().toISOString() },
        { id: "3", summary: "Memory C content", taskDescription: "Task 3", outcome: "success", keyFiles: [], lessons: [], createdAt: new Date().toISOString() },
      ]);

      const skillSynthesizer = {
        synthesizeFromPatterns: vi.fn().mockReturnValue([{ name: "auto-skill-1" }, { name: "auto-skill-2" }]),
      };

      const result = await extractor.runDream("proj-1", { skillSynthesizer: skillSynthesizer as any });

      expect(result.skillsSuggested).toBe(2);
      expect(skillSynthesizer.synthesizeFromPatterns).toHaveBeenCalledWith("proj-1");
    });

    it("does not record learnings for memories with no lessons", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      (memoryService.getRelevantEpisodicMemories as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: "1", summary: "Memory A no lessons", taskDescription: "Task 1", outcome: "success", keyFiles: [], lessons: [], createdAt: new Date().toISOString() },
        { id: "2", summary: "Memory B no lessons", taskDescription: "Task 2", outcome: "failure", keyFiles: [], lessons: [], createdAt: new Date().toISOString() },
        { id: "3", summary: "Memory C no lessons", taskDescription: "Task 3", outcome: "partial", keyFiles: [], lessons: [], createdAt: new Date().toISOString() },
      ]);

      const learningsService = {
        recordPattern: vi.fn(),
        recordAntipattern: vi.fn(),
        consolidate: vi.fn(),
        pruneStale: vi.fn(),
      };

      const result = await extractor.runDream("proj-1", { learningsService: learningsService as any });

      expect(result.learningsExtracted).toBe(0);
      expect(learningsService.recordPattern).not.toHaveBeenCalled();
      expect(learningsService.recordAntipattern).not.toHaveBeenCalled();
    });

    it("runDream without optional services returns zero for learnings and skills", async () => {
      const extractor = new AutoMemoryExtractor(memoryService);
      (memoryService.getRelevantEpisodicMemories as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: "1", summary: "Deployed the React frontend to production with nginx proxy config.", taskDescription: "Deploy frontend", outcome: "success", keyFiles: [], lessons: ["lesson"], createdAt: new Date().toISOString() },
        { id: "2", summary: "Refactored database migration scripts to use Prisma ORM conventions.", taskDescription: "Refactor migrations", outcome: "success", keyFiles: [], lessons: [], createdAt: new Date().toISOString() },
        { id: "3", summary: "Fixed authentication JWT token refresh logic in the middleware layer.", taskDescription: "Fix auth bug", outcome: "success", keyFiles: [], lessons: [], createdAt: new Date().toISOString() },
      ]);

      const result = await extractor.runDream("proj-1");
      expect(result.learningsExtracted).toBe(0);
      expect(result.skillsSuggested).toBe(0);
      expect(result.consolidated).toBe(3);
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

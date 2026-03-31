import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  tokenize,
  cosineSimilarity,
  truncateToChars,
  MemoryService,
} from "./memoryService";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "memory-test-"));
}

function cleanUp(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── tokenize ────────────────────────────────────────────────────────────────

describe("tokenize", () => {
  it("lowercases and splits on non-alphanumeric", () => {
    expect(tokenize("Hello World")).toEqual(["hello", "world"]);
  });

  it("filters tokens shorter than 2 chars", () => {
    expect(tokenize("I am a dev")).toEqual(["am", "dev"]);
  });

  it("deduplicates tokens", () => {
    expect(tokenize("test test test")).toEqual(["test"]);
  });

  it("handles empty string", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("handles mixed delimiters", () => {
    const result = tokenize("fix_bug--fast!! 123");
    expect(result).toEqual(["fix", "bug", "fast", "123"]);
  });
});

// ── cosineSimilarity ────────────────────────────────────────────────────────

describe("cosineSimilarity", () => {
  it("returns 0 when either array is empty", () => {
    expect(cosineSimilarity([], ["hello"])).toBe(0);
    expect(cosineSimilarity(["hello"], [])).toBe(0);
  });

  it("returns 1 for identical single-element arrays", () => {
    expect(cosineSimilarity(["hello"], ["hello"])).toBe(1);
  });

  it("returns 0 for non-overlapping sets", () => {
    expect(cosineSimilarity(["foo", "bar"], ["baz", "qux"])).toBe(0);
  });

  it("computes correct similarity for partial overlap", () => {
    // intersection = 1 ("hello"), sqrt(2 * 2) = 2 => 0.5
    const score = cosineSimilarity(["hello", "world"], ["hello", "there"]);
    expect(score).toBeCloseTo(0.5);
  });
});

// ── truncateToChars ─────────────────────────────────────────────────────────

describe("truncateToChars", () => {
  it("returns text unchanged when within limit", () => {
    expect(truncateToChars("short", 10)).toBe("short");
  });

  it("truncates and appends ellipsis", () => {
    expect(truncateToChars("abcdefghij", 5)).toBe("abcde...");
  });

  it("handles exact boundary", () => {
    expect(truncateToChars("exact", 5)).toBe("exact");
  });
});

// ── MemoryService ───────────────────────────────────────────────────────────

describe("MemoryService", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanUp(tmpDir);
  });

  // ── addEpisodicMemory ───────────────────────────────────────────────

  it("addEpisodicMemory creates and stores a memory", () => {
    const svc = new MemoryService(tmpDir);
    const mem = svc.addEpisodicMemory({
      taskDescription: "Add login form",
      summary: "Implemented login form with validation",
      outcome: "success",
      keyFiles: ["src/Login.tsx"],
      lessons: ["Use controlled inputs"],
    });

    expect(mem.id).toBeTruthy();
    expect(mem.taskDescription).toBe("Add login form");
    expect(mem.outcome).toBe("success");
    expect(mem.keyFiles).toEqual(["src/Login.tsx"]);
    expect(mem.lessons).toEqual(["Use controlled inputs"]);
    expect(mem.createdAt).toBeTruthy();

    // Verify persisted to disk
    const filePath = path.join(tmpDir, ".agentic-workforce/memory/episodic.json");
    expect(fs.existsSync(filePath)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0].id).toBe(mem.id);
  });

  it("addEpisodicMemory truncates summary to 500 chars", () => {
    const svc = new MemoryService(tmpDir);
    const longSummary = "x".repeat(600);
    const mem = svc.addEpisodicMemory({
      taskDescription: "Task",
      summary: longSummary,
      outcome: "partial",
    });

    expect(mem.summary.length).toBe(503); // 500 + "..."
    expect(mem.summary.endsWith("...")).toBe(true);
  });

  it("addEpisodicMemory evicts oldest when exceeding max", () => {
    const svc = new MemoryService(tmpDir, { maxEpisodicMemories: 3 });

    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const mem = svc.addEpisodicMemory({
        taskDescription: `Task ${i}`,
        summary: `Summary ${i}`,
        outcome: "success",
      });
      ids.push(mem.id);
    }

    // First memory should have been evicted
    const filePath = path.join(tmpDir, ".agentic-workforce/memory/episodic.json");
    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(onDisk).toHaveLength(3);
    expect(onDisk.map((m: { id: string }) => m.id)).not.toContain(ids[0]);
  });

  // ── addWorkingMessage ───────────────────────────────────────────────

  it("addWorkingMessage respects window size", () => {
    const svc = new MemoryService(tmpDir, { workingWindowSize: 3 });

    for (let i = 0; i < 5; i++) {
      svc.addWorkingMessage({ role: "user", content: `msg ${i}` });
    }

    const comp = svc.compose("anything");
    expect(comp.workingMessages).toHaveLength(3);
    // Should keep the last 3 messages
    expect(comp.workingMessages[0].content).toBe("msg 2");
    expect(comp.workingMessages[2].content).toBe("msg 4");
  });

  // ── getRelevantEpisodicMemories ─────────────────────────────────────

  it("getRelevantEpisodicMemories returns most relevant", () => {
    const svc = new MemoryService(tmpDir, { relevanceTopK: 2 });

    svc.addEpisodicMemory({
      taskDescription: "Fix database migration",
      summary: "Updated prisma schema and ran migration",
      outcome: "success",
    });
    svc.addEpisodicMemory({
      taskDescription: "Add login form component",
      summary: "Created React login form with hooks",
      outcome: "success",
    });
    svc.addEpisodicMemory({
      taskDescription: "Fix database connection pool",
      summary: "Adjusted pool size for database connections",
      outcome: "partial",
    });

    const results = svc.getRelevantEpisodicMemories(
      "database migration issue"
    );

    expect(results).toHaveLength(2);
    // The two database-related memories should rank higher than the login form one
    const descriptions = results.map((r) => r.taskDescription);
    expect(descriptions).toContain("Fix database migration");
    expect(descriptions).toContain("Fix database connection pool");
  });

  // ── compose ────────────────────────────────────────────────────────

  it("compose produces formatted output with stats", () => {
    const svc = new MemoryService(tmpDir);

    svc.addEpisodicMemory({
      taskDescription: "Build API endpoint",
      summary: "Created REST endpoint for users",
      outcome: "success",
      lessons: ["Validate input", "Add rate limiting"],
    });

    svc.addWorkingMessage({ role: "user", content: "Build the API" });
    svc.addWorkingMessage({
      role: "assistant",
      content: "I will create the endpoint",
    });

    const comp = svc.compose("Build API endpoint");

    expect(comp.episodicContext).toContain("## Previous Task Experience");
    expect(comp.episodicContext).toContain(
      "Created REST endpoint for users"
    );
    expect(comp.episodicContext).toContain("Validate input");
    expect(comp.episodicContext).toContain("Add rate limiting");
    expect(comp.workingMessages).toHaveLength(2);
    expect(comp.stats.episodicCount).toBe(1);
    expect(comp.stats.workingCount).toBe(2);
    expect(comp.stats.totalTokenEstimate).toBeGreaterThan(0);
  });

  it("compose returns empty episodicContext when no memories exist", () => {
    const svc = new MemoryService(tmpDir);
    const comp = svc.compose("anything");
    expect(comp.episodicContext).toBe("");
    expect(comp.stats.episodicCount).toBe(0);
  });

  // ── load/save round-trip ──────────────────────────────────────────

  it("loadEpisodicMemory / saveEpisodicMemory round-trips", () => {
    const svc1 = new MemoryService(tmpDir);
    svc1.addEpisodicMemory({
      taskDescription: "Round-trip test",
      summary: "Testing persistence",
      outcome: "success",
      keyFiles: ["a.ts", "b.ts"],
      lessons: ["Works"],
    });

    // Create a new service instance and load from disk
    const svc2 = new MemoryService(tmpDir);
    svc2.loadEpisodicMemory();

    const results = svc2.getRelevantEpisodicMemories("Round-trip test");
    expect(results).toHaveLength(1);
    expect(results[0].taskDescription).toBe("Round-trip test");
    expect(results[0].keyFiles).toEqual(["a.ts", "b.ts"]);
    expect(results[0].lessons).toEqual(["Works"]);
  });

  // ── clearAll ──────────────────────────────────────────────────────

  it("clearAll removes everything", () => {
    const svc = new MemoryService(tmpDir);

    svc.addEpisodicMemory({
      taskDescription: "Task to clear",
      summary: "Will be cleared",
      outcome: "failure",
    });
    svc.addWorkingMessage({ role: "user", content: "hello" });

    svc.clearAll();

    const comp = svc.compose("anything");
    expect(comp.episodicContext).toBe("");
    expect(comp.workingMessages).toHaveLength(0);
    expect(comp.stats.episodicCount).toBe(0);
    expect(comp.stats.workingCount).toBe(0);

    const filePath = path.join(tmpDir, ".agentic-workforce/memory/episodic.json");
    expect(fs.existsSync(filePath)).toBe(false);
  });

  // ── evictOldestEpisodic ────────────────────────────────────────────

  describe("evictOldestEpisodic", () => {
    it("evicts the oldest N episodic memories", () => {
      const svc = new MemoryService(tmpDir);

      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const mem = svc.addEpisodicMemory({
          taskDescription: `Task ${i}`,
          summary: `Summary ${i}`,
          outcome: "success",
        });
        ids.push(mem.id);
      }

      expect(svc.episodicCount()).toBe(5);

      const result = svc.evictOldestEpisodic(2);
      expect(result.evicted).toBe(2);
      expect(result.tokensFreed).toBeGreaterThan(0);
      expect(svc.episodicCount()).toBe(3);

      // Oldest two should be gone
      const filePath = path.join(tmpDir, ".agentic-workforce/memory/episodic.json");
      const onDisk = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const diskIds = onDisk.map((m: { id: string }) => m.id);
      expect(diskIds).not.toContain(ids[0]);
      expect(diskIds).not.toContain(ids[1]);
      expect(diskIds).toContain(ids[2]);
    });

    it("returns zero when count is zero", () => {
      const svc = new MemoryService(tmpDir);
      svc.addEpisodicMemory({
        taskDescription: "Task",
        summary: "Summary",
        outcome: "success",
      });

      const result = svc.evictOldestEpisodic(0);
      expect(result.evicted).toBe(0);
      expect(result.tokensFreed).toBe(0);
      expect(svc.episodicCount()).toBe(1);
    });

    it("returns zero when no episodic memories exist", () => {
      const svc = new MemoryService(tmpDir);
      const result = svc.evictOldestEpisodic(5);
      expect(result.evicted).toBe(0);
      expect(result.tokensFreed).toBe(0);
    });

    it("evicts all if count exceeds available memories", () => {
      const svc = new MemoryService(tmpDir);
      svc.addEpisodicMemory({
        taskDescription: "Task 1",
        summary: "Summary 1",
        outcome: "success",
      });
      svc.addEpisodicMemory({
        taskDescription: "Task 2",
        summary: "Summary 2",
        outcome: "success",
      });

      expect(svc.episodicCount()).toBe(2);

      const result = svc.evictOldestEpisodic(10);
      expect(result.evicted).toBe(2);
      expect(svc.episodicCount()).toBe(0);
    });

    it("estimates tokens freed correctly", () => {
      const svc = new MemoryService(tmpDir);

      svc.addEpisodicMemory({
        taskDescription: "Task",
        summary: "x".repeat(100),
        outcome: "success",
        lessons: ["lesson1", "lesson2"],
      });

      const result = svc.evictOldestEpisodic(1);
      expect(result.evicted).toBe(1);
      // ~100 chars summary + ~14 chars lessons = ~114 chars / 4 ~= 29 tokens
      expect(result.tokensFreed).toBeGreaterThan(20);
    });

    it("persists changes to disk", () => {
      const svc = new MemoryService(tmpDir);
      svc.addEpisodicMemory({
        taskDescription: "Task 1",
        summary: "Summary 1",
        outcome: "success",
      });
      svc.addEpisodicMemory({
        taskDescription: "Task 2",
        summary: "Summary 2",
        outcome: "success",
      });

      svc.evictOldestEpisodic(1);

      const filePath = path.join(tmpDir, ".agentic-workforce/memory/episodic.json");
      const onDisk = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(onDisk).toHaveLength(1);
      expect(onDisk[0].taskDescription).toBe("Task 2");
    });
  });

  // ── trimWorking ────────────────────────────────────────────────────

  describe("trimWorking", () => {
    it("trims working memory to keep last N messages", () => {
      const svc = new MemoryService(tmpDir);

      for (let i = 0; i < 10; i++) {
        svc.addWorkingMessage({ role: "user", content: `msg ${i}` });
      }

      expect(svc.workingCount()).toBe(10);

      const result = svc.trimWorking(3);
      expect(result.trimmed).toBe(7);
      expect(result.tokensFreed).toBeGreaterThan(0);
      expect(svc.workingCount()).toBe(3);

      const comp = svc.compose("anything");
      expect(comp.workingMessages[0].content).toBe("msg 7");
      expect(comp.workingMessages[1].content).toBe("msg 8");
      expect(comp.workingMessages[2].content).toBe("msg 9");
    });

    it("returns zero when already within limit", () => {
      const svc = new MemoryService(tmpDir);
      svc.addWorkingMessage({ role: "user", content: "msg 1" });
      svc.addWorkingMessage({ role: "user", content: "msg 2" });

      const result = svc.trimWorking(5);
      expect(result.trimmed).toBe(0);
      expect(result.tokensFreed).toBe(0);
      expect(svc.workingCount()).toBe(2);
    });

    it("returns zero when keepLast equals current count", () => {
      const svc = new MemoryService(tmpDir);
      svc.addWorkingMessage({ role: "user", content: "msg 1" });
      svc.addWorkingMessage({ role: "user", content: "msg 2" });

      const result = svc.trimWorking(2);
      expect(result.trimmed).toBe(0);
      expect(result.tokensFreed).toBe(0);
      expect(svc.workingCount()).toBe(2);
    });

    it("estimates tokens freed correctly", () => {
      const svc = new MemoryService(tmpDir);
      svc.addWorkingMessage({ role: "user", content: "x".repeat(100) });
      svc.addWorkingMessage({ role: "user", content: "x".repeat(200) });

      const result = svc.trimWorking(1);
      expect(result.trimmed).toBe(1);
      // 100 chars / 4 = 25 tokens
      expect(result.tokensFreed).toBeGreaterThanOrEqual(25);
    });

    it("can trim to zero messages", () => {
      const svc = new MemoryService(tmpDir);
      svc.addWorkingMessage({ role: "user", content: "msg 1" });
      svc.addWorkingMessage({ role: "user", content: "msg 2" });

      const result = svc.trimWorking(0);
      expect(result.trimmed).toBe(2);
      expect(svc.workingCount()).toBe(0);
    });
  });

  // ── episodicCount / workingCount ───────────────────────────────────

  describe("episodicCount / workingCount", () => {
    it("episodicCount returns correct count", () => {
      const svc = new MemoryService(tmpDir);
      expect(svc.episodicCount()).toBe(0);

      svc.addEpisodicMemory({
        taskDescription: "Task 1",
        summary: "Summary 1",
        outcome: "success",
      });
      expect(svc.episodicCount()).toBe(1);

      svc.addEpisodicMemory({
        taskDescription: "Task 2",
        summary: "Summary 2",
        outcome: "success",
      });
      expect(svc.episodicCount()).toBe(2);
    });

    it("workingCount returns correct count", () => {
      const svc = new MemoryService(tmpDir);
      expect(svc.workingCount()).toBe(0);

      svc.addWorkingMessage({ role: "user", content: "msg 1" });
      expect(svc.workingCount()).toBe(1);

      svc.addWorkingMessage({ role: "assistant", content: "msg 2" });
      expect(svc.workingCount()).toBe(2);
    });

    it("clearWorking updates workingCount", () => {
      const svc = new MemoryService(tmpDir);
      svc.addWorkingMessage({ role: "user", content: "msg 1" });
      svc.addWorkingMessage({ role: "user", content: "msg 2" });
      expect(svc.workingCount()).toBe(2);

      svc.clearWorking();
      expect(svc.workingCount()).toBe(0);
    });
  });
});

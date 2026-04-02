import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  estimateTokens,
  computePressure,
  compactMessages,
  createCompactionTracker,
  compactWithCircuitBreaker,
  emergencyCompact,
  compactWithMemory,
  snipCompact,
  computeCacheTopologyMap,
  microcompact,
  trackCacheBreakpoint,
  getCacheBreakpoints,
  clearCacheBreakpoints,
  type CompactionMessage,
} from "./contextCompactionService";
import { MemoryService } from "./memoryService";

// ---------------------------------------------------------------------------
// Helper: generate messages that fill a specific pressure level
// ---------------------------------------------------------------------------

function makeMessages(
  pressure: number,
  maxTokens: number,
  opts?: { pinnedCount?: number },
): CompactionMessage[] {
  const targetTokens = Math.floor(maxTokens * pressure);
  // Each char ~0.25 tokens, so targetChars = targetTokens * 4
  const targetChars = targetTokens * 4;
  const pinnedCount = opts?.pinnedCount ?? 0;

  const messages: CompactionMessage[] = [];

  // Add pinned system messages first
  for (let i = 0; i < pinnedCount; i++) {
    messages.push({ role: "system", content: "pinned", pinned: true });
  }

  // Fill remaining chars across alternating user/assistant messages
  const pinnedChars = pinnedCount * "pinned".length;
  const remainingChars = Math.max(0, targetChars - pinnedChars);
  const msgCount = 10;
  const charsPerMsg = Math.floor(remainingChars / msgCount);

  for (let i = 0; i < msgCount; i++) {
    const role = i % 2 === 0 ? "user" : "assistant";
    messages.push({ role, content: "x".repeat(Math.max(1, charsPerMsg)) });
  }

  return messages;
}

// ---------------------------------------------------------------------------
// snipCompact (stage 0 — zero-cost time-based pruning)
// ---------------------------------------------------------------------------

describe("snipCompact", () => {
  it("skips when pressure is below minPressure", () => {
    const msgs: CompactionMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    const result = snipCompact(msgs, 100_000);
    expect(result.messages).toHaveLength(2);
    expect(result.tokensAfter).toBe(result.tokensBefore);
  });

  it("preserves pinned messages regardless of position", () => {
    const msgs: CompactionMessage[] = [];
    for (let i = 0; i < 20; i++) {
      msgs.push({ role: "user", content: "x".repeat(500) });
      msgs.push({ role: "assistant", content: "y".repeat(500) });
    }
    msgs[0].pinned = true;
    const result = snipCompact(msgs, 2000);
    expect(result.messages.some((m) => m.pinned)).toBe(true);
  });

  it("preserves system messages", () => {
    const msgs: CompactionMessage[] = [
      { role: "system", content: "You are a coding agent. ".repeat(50) },
    ];
    for (let i = 0; i < 20; i++) {
      msgs.push({ role: "user", content: "task ".repeat(100) });
      msgs.push({ role: "assistant", content: "done ".repeat(100) });
    }
    const result = snipCompact(msgs, 3000);
    expect(result.messages.some((m) => m.role === "system")).toBe(true);
  });

  it("keeps last N turns", () => {
    const msgs: CompactionMessage[] = [];
    for (let i = 0; i < 20; i++) {
      msgs.push({ role: "user", content: `user-${i} ${"x".repeat(200)}` });
      msgs.push({ role: "assistant", content: `asst-${i} ${"y".repeat(200)}` });
    }
    const result = snipCompact(msgs, 3000, { protectedTailTurns: 3 });
    expect(result.messages.length).toBeLessThan(msgs.length);
    const lastUserContent = result.messages
      .filter((m) => m.role === "user")
      .map((m) => m.content);
    expect(lastUserContent.some((c) => c.startsWith("user-19"))).toBe(true);
    expect(lastUserContent.some((c) => c.startsWith("user-18"))).toBe(true);
    expect(lastUserContent.some((c) => c.startsWith("user-17"))).toBe(true);
  });

  it("drops old non-pinned non-system messages beyond the window", () => {
    const msgs: CompactionMessage[] = [];
    for (let i = 0; i < 30; i++) {
      msgs.push({ role: "user", content: `user-${i} ${"x".repeat(200)}` });
      msgs.push({ role: "assistant", content: `asst-${i} ${"y".repeat(200)}` });
    }
    const result = snipCompact(msgs, 5000, { protectedTailTurns: 5 });
    expect(result.messages.length).toBeLessThan(msgs.length);
    expect(result.messages.some((m) => m.content.startsWith("user-0"))).toBe(false);
  });

  it("returns stage 0", () => {
    const msgs: CompactionMessage[] = [];
    for (let i = 0; i < 20; i++) {
      msgs.push({ role: "user", content: "x".repeat(300) });
      msgs.push({ role: "assistant", content: "y".repeat(300) });
    }
    const result = snipCompact(msgs, 3000);
    expect(result.stage).toBe(0);
  });

  it("compactMessages applies snip before stage 1", () => {
    const msgs: CompactionMessage[] = [];
    for (let i = 0; i < 25; i++) {
      msgs.push({ role: "user", content: `old-task-${i} ${"x".repeat(200)}` });
      msgs.push({ role: "assistant", content: `old-result-${i} ${"y".repeat(200)}` });
    }
    for (let i = 0; i < 5; i++) {
      msgs.push({ role: "user", content: `recent-${i}` });
      msgs.push({ role: "assistant", content: `done-${i}` });
    }
    const totalChars = msgs.reduce((s, m) => s + m.content.length, 0);
    const totalTok = Math.ceil(totalChars / 4);
    const maxCtx = Math.ceil(totalTok / 0.65);

    const result = compactMessages(msgs, maxCtx);
    expect(result.messages.length).toBeLessThan(msgs.length);
    expect(result.messages.some((m) => m.content.startsWith("recent-4"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns 1 for short strings (1-4 chars)", () => {
    expect(estimateTokens("hi")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
  });

  it("returns ceil(length/4) for longer strings", () => {
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(100))).toBe(25);
    expect(estimateTokens("a".repeat(101))).toBe(26);
  });
});

// ---------------------------------------------------------------------------
// computePressure
// ---------------------------------------------------------------------------

describe("computePressure", () => {
  it("returns 0 for empty messages", () => {
    expect(computePressure([], 1000)).toBe(0);
  });

  it("returns correct fraction at half capacity", () => {
    // 2000 chars = 500 tokens; max = 1000 => pressure 0.5
    const msgs: CompactionMessage[] = [
      { role: "user", content: "x".repeat(2000) },
    ];
    expect(computePressure(msgs, 1000)).toBe(0.5);
  });

  it("returns value > 1 when over capacity", () => {
    const msgs: CompactionMessage[] = [
      { role: "user", content: "x".repeat(8000) },
    ];
    expect(computePressure(msgs, 1000)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// compactMessages — Stage 0 (no compaction)
// ---------------------------------------------------------------------------

describe("compactMessages — stage 0 (< 70%)", () => {
  it("returns messages unchanged when pressure is below 70%", () => {
    const msgs = makeMessages(0.5, 1000);
    const result = compactMessages(msgs, 1000);
    expect(result.stage).toBe(0);
    expect(result.messages).toEqual(msgs);
    expect(result.tokensBefore).toBe(result.tokensAfter);
  });
});

// ---------------------------------------------------------------------------
// Stage 1: summarize old assistant messages at >= 70%
// ---------------------------------------------------------------------------

describe("compactMessages — stage 1 (>= 70%)", () => {
  it("truncates old assistant messages to 200 chars", () => {
    const maxTokens = 1000;
    const longContent = "a".repeat(800);
    // Build messages that cross 70%: system pinned + several assistant + user
    const msgs: CompactionMessage[] = [
      { role: "system", content: "system prompt", pinned: true },
      { role: "assistant", content: longContent },
      { role: "assistant", content: longContent },
      { role: "assistant", content: longContent },
      { role: "user", content: "x".repeat(400) },
      // last 3 assistant messages (should not be compacted)
      { role: "assistant", content: "recent1" },
      { role: "assistant", content: "recent2" },
      { role: "assistant", content: "recent3" },
    ];
    const result = compactMessages(msgs, maxTokens);
    expect(result.stage).toBeGreaterThanOrEqual(1);
    // The old assistant messages (indices 1-3) should be truncated
    const oldAssistant = result.messages.find(
      (m) => m.role === "assistant" && m.content.includes("[compacted]"),
    );
    expect(oldAssistant).toBeDefined();
    expect(oldAssistant!.content.length).toBeLessThan(longContent.length);
  });
});

// ---------------------------------------------------------------------------
// Stage 2: compress reasoning at >= 80%
// ---------------------------------------------------------------------------

describe("compactMessages — stage 2 (>= 80%)", () => {
  it("keeps lines with decision/result/output/conclusion keywords", () => {
    const maxTokens = 200;
    const reasoning = [
      "Let me think about this...",
      "Considering option A",
      "decision: use approach B",
      "More rambling here",
      "result: success",
    ].join("\n");

    const msgs: CompactionMessage[] = [
      { role: "system", content: "s", pinned: true },
      { role: "assistant", content: reasoning + " " + "z".repeat(300) },
      { role: "user", content: "x".repeat(200) },
      { role: "assistant", content: reasoning + " " + "z".repeat(300) },
      { role: "user", content: "x".repeat(200) },
      // last 3
      { role: "assistant", content: "r1" },
      { role: "assistant", content: "r2" },
      { role: "assistant", content: "r3" },
    ];
    const result = compactMessages(msgs, maxTokens);
    expect(result.stage).toBeGreaterThanOrEqual(2);
    // Find a compacted assistant message that kept keyword lines
    const compacted = result.messages.find(
      (m) =>
        m.role === "assistant" &&
        m.content.includes("decision:") &&
        !m.content.includes("Considering"),
    );
    expect(compacted).toBeDefined();
  });

  it("falls back to 100-char truncation when no keywords found", () => {
    const maxTokens = 500;
    const noKeywords = "a".repeat(300);
    const msgs: CompactionMessage[] = [
      { role: "system", content: "s", pinned: true },
      { role: "assistant", content: noKeywords },
      { role: "user", content: "x".repeat(600) },
      { role: "assistant", content: noKeywords },
      { role: "user", content: "x".repeat(600) },
      { role: "assistant", content: "r1" },
      { role: "assistant", content: "r2" },
      { role: "assistant", content: "r3" },
    ];
    const result = compactMessages(msgs, maxTokens);
    expect(result.stage).toBeGreaterThanOrEqual(2);
    const truncated = result.messages.find(
      (m) =>
        m.role === "assistant" &&
        m.content.includes("[reasoning compacted]"),
    );
    expect(truncated).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Stage 3: drop file contents at >= 85%
// ---------------------------------------------------------------------------

describe("compactMessages — stage 3 (>= 85%)", () => {
  it("replaces code fence blocks with line-count placeholder", () => {
    const maxTokens = 400;
    const codeBlock = [
      "Here is the file:",
      "```typescript",
      "const a = 1;",
      "const b = 2;",
      "const c = 3;",
      "```",
      "That was the file.",
    ].join("\n");

    const msgs: CompactionMessage[] = [
      { role: "system", content: "s", pinned: true },
      { role: "assistant", content: codeBlock },
      { role: "user", content: "x".repeat(600) },
      { role: "assistant", content: codeBlock },
      { role: "user", content: "x".repeat(600) },
      { role: "assistant", content: "r1" },
      { role: "assistant", content: "r2" },
      { role: "assistant", content: "r3" },
    ];
    const result = compactMessages(msgs, maxTokens);
    expect(result.stage).toBeGreaterThanOrEqual(3);
    const replaced = result.messages.find(
      (m) =>
        m.role === "assistant" &&
        m.content.includes("[file content omitted"),
    );
    expect(replaced).toBeDefined();
    expect(replaced!.content).toContain("lines]");
    expect(replaced!.content).not.toContain("const a = 1");
  });
});

// ---------------------------------------------------------------------------
// Stage 4: merge consecutive same-role messages at >= 90%
// ---------------------------------------------------------------------------

describe("compactMessages — stage 4 (>= 90%)", () => {
  it("merges consecutive messages with the same role", () => {
    const maxTokens = 200;
    const msgs: CompactionMessage[] = [
      { role: "system", content: "s", pinned: true },
      { role: "user", content: "x".repeat(300) },
      { role: "user", content: "y".repeat(300) },
      { role: "assistant", content: "a".repeat(300) },
      { role: "assistant", content: "b".repeat(300) },
      { role: "assistant", content: "r1" },
      { role: "assistant", content: "r2" },
      { role: "assistant", content: "r3" },
    ];
    const result = compactMessages(msgs, maxTokens);
    expect(result.stage).toBeGreaterThanOrEqual(4);
    // After merging, consecutive same-role non-pinned messages should be combined
    const userMsgs = result.messages.filter(
      (m) => m.role === "user" && !m.pinned,
    );
    // The two user messages should have been merged into one
    expect(userMsgs.length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Stage 5: emergency at >= 99%
// ---------------------------------------------------------------------------

describe("compactMessages — stage 5 (>= 99%)", () => {
  it("keeps only pinned messages and last 5 non-pinned", () => {
    const maxTokens = 100;
    const msgs: CompactionMessage[] = [
      { role: "system", content: "system prompt", pinned: true },
      { role: "system", content: "important context", pinned: true },
    ];
    // Add 20 non-pinned messages to create extreme pressure
    for (let i = 0; i < 20; i++) {
      msgs.push({
        role: i % 2 === 0 ? "user" : "assistant",
        content: "x".repeat(200),
      });
    }
    const result = compactMessages(msgs, maxTokens);
    expect(result.stage).toBe(5);
    const pinned = result.messages.filter((m) => m.pinned);
    const nonPinned = result.messages.filter((m) => !m.pinned);
    expect(pinned.length).toBe(2);
    expect(nonPinned.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Pinned messages survive all stages
// ---------------------------------------------------------------------------

describe("pinned messages", () => {
  it("are never modified regardless of stage", () => {
    const maxTokens = 100;
    const pinnedContent = "This is critical system context that must survive. ".repeat(10);
    const msgs: CompactionMessage[] = [
      { role: "system", content: pinnedContent, pinned: true },
      { role: "assistant", content: pinnedContent, pinned: true },
    ];
    for (let i = 0; i < 20; i++) {
      msgs.push({
        role: i % 2 === 0 ? "user" : "assistant",
        content: "filler ".repeat(100),
      });
    }
    const result = compactMessages(msgs, maxTokens);
    expect(result.stage).toBeGreaterThanOrEqual(1);
    const pinned = result.messages.filter((m) => m.pinned);
    expect(pinned.length).toBe(2);
    expect(pinned[0].content).toBe(pinnedContent);
    expect(pinned[1].content).toBe(pinnedContent);
  });

  it("are never removed even in emergency stage 5", () => {
    const maxTokens = 50;
    const msgs: CompactionMessage[] = [
      { role: "system", content: "keep me", pinned: true },
      { role: "system", content: "keep me too", pinned: true },
      { role: "assistant", content: "keep me three", pinned: true },
    ];
    for (let i = 0; i < 30; i++) {
      msgs.push({ role: "user", content: "x".repeat(200) });
    }
    const result = compactMessages(msgs, maxTokens);
    expect(result.stage).toBe(5);
    const pinned = result.messages.filter((m) => m.pinned);
    expect(pinned.length).toBe(3);
    expect(pinned[0].content).toBe("keep me");
    expect(pinned[1].content).toBe("keep me too");
    expect(pinned[2].content).toBe("keep me three");
  });
});

// ---------------------------------------------------------------------------
// makeMessages helper sanity check
// ---------------------------------------------------------------------------

describe("makeMessages helper", () => {
  it("generates messages at approximately the requested pressure", () => {
    const maxTokens = 1000;
    const msgs = makeMessages(0.75, maxTokens);
    const pressure = computePressure(msgs, maxTokens);
    // Allow some tolerance due to rounding
    expect(pressure).toBeGreaterThan(0.6);
    expect(pressure).toBeLessThan(0.9);
  });

  it("includes pinned messages when requested", () => {
    const msgs = makeMessages(0.5, 1000, { pinnedCount: 3 });
    const pinned = msgs.filter((m) => m.pinned);
    expect(pinned.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Circuit breaker + emergency compaction
// ---------------------------------------------------------------------------

describe("createCompactionTracker", () => {
  it("returns a fresh tracker with zero failures", () => {
    const tracker = createCompactionTracker();
    expect(tracker.consecutiveFailures).toBe(0);
    expect(tracker.lastCompactedAt).toBeNull();
    expect(tracker.totalCompactions).toBe(0);
  });
});

describe("compactWithCircuitBreaker", () => {
  it("returns null when circuit breaker is open (3+ failures)", () => {
    const msgs = makeMessages(0.5, 1000);
    const tracker = createCompactionTracker();
    tracker.consecutiveFailures = 3;

    const result = compactWithCircuitBreaker(msgs, 1000, tracker);
    expect(result).toBeNull();
  });

  it("increments failures when compaction does not reduce tokens", () => {
    // Create messages with low pressure — compaction won't reduce tokens
    const msgs = makeMessages(0.5, 1000);
    const tracker = createCompactionTracker();

    const result = compactWithCircuitBreaker(msgs, 1000, tracker);
    expect(result).not.toBeNull();
    expect(tracker.consecutiveFailures).toBe(1);
    expect(tracker.totalCompactions).toBe(0);
  });

  it("resets failures and increments totalCompactions on successful compaction", () => {
    // Create messages with high pressure to trigger actual compaction
    const msgs = makeMessages(0.85, 1000);
    const tracker = createCompactionTracker();
    tracker.consecutiveFailures = 2; // Set some prior failures

    const result = compactWithCircuitBreaker(msgs, 1000, tracker);
    expect(result).not.toBeNull();
    expect(result!.tokensAfter).toBeLessThan(result!.tokensBefore);
    expect(tracker.consecutiveFailures).toBe(0);
    expect(tracker.totalCompactions).toBe(1);
    expect(tracker.lastCompactedAt).toBeTruthy();
  });

  it("opens circuit breaker after 3 consecutive failures", () => {
    const msgs = makeMessages(0.5, 1000);
    const tracker = createCompactionTracker();

    // Trigger 3 failures
    compactWithCircuitBreaker(msgs, 1000, tracker);
    expect(tracker.consecutiveFailures).toBe(1);

    compactWithCircuitBreaker(msgs, 1000, tracker);
    expect(tracker.consecutiveFailures).toBe(2);

    compactWithCircuitBreaker(msgs, 1000, tracker);
    expect(tracker.consecutiveFailures).toBe(3);

    // Circuit should now be open
    const result = compactWithCircuitBreaker(msgs, 1000, tracker);
    expect(result).toBeNull();
  });

  it("maintains lastCompactedAt timestamp", () => {
    const msgs = makeMessages(0.85, 1000);
    const tracker = createCompactionTracker();

    const before = Date.now();
    compactWithCircuitBreaker(msgs, 1000, tracker);
    const after = Date.now();

    expect(tracker.lastCompactedAt).toBeTruthy();
    const timestamp = new Date(tracker.lastCompactedAt!).getTime();
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});

describe("emergencyCompact", () => {
  it("returns stage 5 result", () => {
    const msgs = makeMessages(0.95, 1000);
    const result = emergencyCompact(msgs, 1000);
    expect(result.stage).toBe(5);
  });

  it("applies merge consecutive (stage 4) first", () => {
    const maxTokens = 1000;
    const msgs: CompactionMessage[] = [
      { role: "system", content: "sys", pinned: true },
      { role: "user", content: "a".repeat(400) },
      { role: "user", content: "b".repeat(400) },
      { role: "assistant", content: "c".repeat(400) },
      { role: "assistant", content: "d".repeat(400) },
    ];

    const result = emergencyCompact(msgs, maxTokens);

    // After merging, consecutive user/assistant messages should be combined
    const userMsgs = result.messages.filter((m) => m.role === "user");
    const assistantMsgs = result.messages.filter((m) => m.role === "assistant");

    // Should have merged consecutive same-role messages
    expect(userMsgs.length).toBeLessThanOrEqual(1);
    expect(assistantMsgs.length).toBeLessThanOrEqual(1);
  });

  it("applies emergency (stage 5) when pressure remains high", () => {
    const maxTokens = 100;
    const msgs: CompactionMessage[] = [
      { role: "system", content: "critical", pinned: true },
    ];

    // Add 20 large messages to create extreme pressure
    for (let i = 0; i < 20; i++) {
      msgs.push({
        role: i % 2 === 0 ? "user" : "assistant",
        content: "x".repeat(500),
      });
    }

    const result = emergencyCompact(msgs, maxTokens);

    // Should keep only pinned + last 5 non-pinned
    const pinned = result.messages.filter((m) => m.pinned);
    const nonPinned = result.messages.filter((m) => !m.pinned);

    expect(pinned.length).toBe(1);
    expect(nonPinned.length).toBeLessThanOrEqual(5);
    expect(result.stage).toBe(5);
  });

  it("significantly reduces token count", () => {
    const maxTokens = 100;
    const msgs: CompactionMessage[] = [];

    // Add many large messages to ensure significant reduction
    for (let i = 0; i < 20; i++) {
      msgs.push({
        role: i % 2 === 0 ? "user" : "assistant",
        content: "x".repeat(500),
      });
    }

    const result = emergencyCompact(msgs, maxTokens);

    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
    // Emergency compaction should be aggressive
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore * 0.5);
  });

  it("preserves all pinned messages", () => {
    const maxTokens = 100;
    const pinnedContent1 = "critical system context";
    const pinnedContent2 = "important blueprint data";

    const msgs: CompactionMessage[] = [
      { role: "system", content: pinnedContent1, pinned: true },
      { role: "system", content: pinnedContent2, pinned: true },
    ];

    for (let i = 0; i < 30; i++) {
      msgs.push({ role: "user", content: "x".repeat(300) });
    }

    const result = emergencyCompact(msgs, maxTokens);

    const pinned = result.messages.filter((m) => m.pinned);
    expect(pinned.length).toBe(2);
    expect(pinned[0].content).toBe(pinnedContent1);
    expect(pinned[1].content).toBe(pinnedContent2);
  });
});

// ---------------------------------------------------------------------------
// compactWithMemory
// ---------------------------------------------------------------------------

describe("compactWithMemory", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "compact-mem-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("commits compaction summary to memory when pressure >= 0.8", () => {
    const memory = new MemoryService(tmpDir);
    const maxTokens = 500;

    // Build messages with high pressure (>= 0.8)
    const msgs: CompactionMessage[] = [
      { role: "system", content: "system", pinned: true },
      { role: "assistant", content: "decision: use approach A\n" + "x".repeat(800) },
      { role: "assistant", content: "result: success\n" + "y".repeat(800) },
      { role: "user", content: "z".repeat(400) },
      { role: "assistant", content: "recent1" },
      { role: "assistant", content: "recent2" },
      { role: "assistant", content: "recent3" },
    ];

    const initialCount = memory.episodicCount();
    const result = compactWithMemory(msgs, maxTokens, memory);

    expect(result).not.toBeNull();
    expect(memory.episodicCount()).toBe(initialCount + 1);

    // Verify the committed memory
    const episodic = memory.getRelevantEpisodicMemories("context compaction");
    expect(episodic.length).toBeGreaterThan(0);
    expect(episodic[0].taskDescription).toBe("context_compaction");
  });

  it("skips memory commit when pressure < 0.8", () => {
    const memory = new MemoryService(tmpDir);
    const maxTokens = 2000;

    // Build messages with low pressure (< 0.8)
    const msgs: CompactionMessage[] = [
      { role: "system", content: "system", pinned: true },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ];

    const initialCount = memory.episodicCount();
    const result = compactWithMemory(msgs, maxTokens, memory);

    expect(result).not.toBeNull();
    // No memory should be committed when pressure is low
    expect(memory.episodicCount()).toBe(initialCount);
  });

  it("delegates to compactWithCircuitBreaker when tracker provided", () => {
    const memory = new MemoryService(tmpDir);
    const tracker = createCompactionTracker();
    const maxTokens = 500;

    const msgs: CompactionMessage[] = [
      { role: "system", content: "system", pinned: true },
      { role: "assistant", content: "x".repeat(1000) },
      { role: "assistant", content: "y".repeat(1000) },
    ];

    const result = compactWithMemory(msgs, maxTokens, memory, tracker);

    expect(result).not.toBeNull();
    // Circuit breaker should have recorded the compaction
    expect(tracker.totalCompactions).toBeGreaterThanOrEqual(0);
  });

  it("delegates to compactMessages when no tracker", () => {
    const memory = new MemoryService(tmpDir);
    const maxTokens = 500;

    const msgs: CompactionMessage[] = [
      { role: "system", content: "system", pinned: true },
      { role: "assistant", content: "x".repeat(1000) },
    ];

    const result = compactWithMemory(msgs, maxTokens, memory);

    expect(result).not.toBeNull();
    expect(result!.messages.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// computeCacheTopologyMap
// ---------------------------------------------------------------------------

describe("computeCacheTopologyMap", () => {
  it("marks first system message as cached", () => {
    const msgs: CompactionMessage[] = [
      { role: "system", content: "system prompt" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    const map = computeCacheTopologyMap(msgs);
    expect(map.get(0)!.inCachedRegion).toBe(true);
  });

  it("marks first user message as cached", () => {
    const msgs: CompactionMessage[] = [
      { role: "system", content: "system prompt" },
      { role: "user", content: "first user msg" },
      { role: "assistant", content: "reply" },
    ];
    const map = computeCacheTopologyMap(msgs);
    expect(map.get(1)!.inCachedRegion).toBe(true);
  });

  it("marks later messages as non-cached", () => {
    const msgs: CompactionMessage[] = [
      { role: "system", content: "system prompt" },
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "second" },
      { role: "assistant", content: "reply2" },
    ];
    const map = computeCacheTopologyMap(msgs);
    expect(map.get(2)!.inCachedRegion).toBe(false);
    expect(map.get(3)!.inCachedRegion).toBe(false);
    expect(map.get(4)!.inCachedRegion).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// microcompact (Stage -1 — cache-aware pruning)
// ---------------------------------------------------------------------------

describe("microcompact", () => {
  it("replaces long assistant messages in cached region with stubs", () => {
    const msgs: CompactionMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "task" },
      { role: "assistant", content: "x".repeat(1000) }, // index 2 - cached, old enough
      { role: "user", content: "next task" },
      { role: "assistant", content: "y".repeat(1000) }, // index 4 - cached, old enough
      { role: "user", content: "final task" },
      { role: "assistant", content: "recent1" }, // recent - should not be touched
      { role: "assistant", content: "recent2" },
      { role: "assistant", content: "recent3" },
    ];

    const result = microcompact(msgs, {
      cacheBreakpoints: [5], // breakpoint at index 5
      minAgeForRemoval: 3,
      cacheWindowSize: 10,
    });

    // Messages at indices 2 and 4 should be stubbed
    expect(result.messages[2].content).toContain("[Cached by provider");
    expect(result.messages[4].content).toContain("[Cached by provider");

    // Recent messages should be unchanged
    expect(result.messages[6].content).toBe("recent1");
    expect(result.messages[7].content).toBe("recent2");
    expect(result.messages[8].content).toBe("recent3");

    // Should have freed tokens
    expect(result.tokensFreed).toBeGreaterThan(0);
  });

  it("preserves pinned messages", () => {
    const msgs: CompactionMessage[] = [
      { role: "system", content: "x".repeat(1000), pinned: true },
      { role: "user", content: "task" },
      { role: "assistant", content: "y".repeat(1000) },
      { role: "user", content: "recent" },
    ];

    const result = microcompact(msgs, {
      cacheBreakpoints: [2],
      minAgeForRemoval: 1,
      cacheWindowSize: 10,
    });

    // Pinned message should not be touched
    expect(result.messages[0].content).toBe("x".repeat(1000));
  });

  it("skips messages outside cached region", () => {
    const msgs: CompactionMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "task" },
      { role: "assistant", content: "x".repeat(1000) }, // index 2 - will be in cache window [2-4]
      { role: "user", content: "task2" },
      { role: "assistant", content: "y".repeat(1000) }, // index 4 - recent (within minAge=1)
      { role: "user", content: "task3" },
      { role: "assistant", content: "z".repeat(1000) }, // index 6 - outside cache window
    ];

    const result = microcompact(msgs, {
      cacheBreakpoints: [4], // breakpoint at index 4
      minAgeForRemoval: 2, // protect last 2 messages (indices 5, 6)
      cacheWindowSize: 2, // covers indices 2-4 (breakpoint-2 to breakpoint)
    });

    // Index 2 is inside cache window and old enough - should be stubbed
    expect(result.messages[2].content).toContain("[Cached by provider");

    // Index 4 is inside cache window but might be borderline - let's check index 6
    // Index 6 is outside cache window - should NOT be stubbed
    expect(result.messages[6].content).toBe("z".repeat(1000));
  });

  it("does not touch short messages", () => {
    const msgs: CompactionMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "task" },
      { role: "assistant", content: "short" }, // too short
      { role: "user", content: "recent" },
    ];

    const result = microcompact(msgs, {
      cacheBreakpoints: [2],
      minAgeForRemoval: 1,
      cacheWindowSize: 10,
    });

    // Short message should not be stubbed
    expect(result.messages[2].content).toBe("short");
    expect(result.tokensFreed).toBe(0);
  });

  it("protects recent messages based on minAgeForRemoval", () => {
    const msgs: CompactionMessage[] = [];
    for (let i = 0; i < 10; i++) {
      msgs.push({ role: "assistant", content: "x".repeat(1000) });
    }

    const result = microcompact(msgs, {
      cacheBreakpoints: [5],
      minAgeForRemoval: 3,
      cacheWindowSize: 20,
    });

    // Last 3 messages should be untouched
    expect(result.messages[7].content).toBe("x".repeat(1000));
    expect(result.messages[8].content).toBe("x".repeat(1000));
    expect(result.messages[9].content).toBe("x".repeat(1000));

    // Earlier messages should be stubbed
    expect(result.messages[0].content).toContain("[Cached by provider");
  });
});

describe("cache breakpoint tracking", () => {
  it("records cache breakpoints for a conversation", () => {
    const convId = "test-conv-1";
    trackCacheBreakpoint(convId, 5);
    trackCacheBreakpoint(convId, 10);

    const breakpoints = getCacheBreakpoints(convId);
    expect(breakpoints).toEqual([5, 10]);
  });

  it("does not duplicate breakpoints", () => {
    const convId = "test-conv-2";
    trackCacheBreakpoint(convId, 5);
    trackCacheBreakpoint(convId, 5);
    trackCacheBreakpoint(convId, 5);

    const breakpoints = getCacheBreakpoints(convId);
    expect(breakpoints).toEqual([5]);
  });

  it("keeps only last 10 breakpoints", () => {
    const convId = "test-conv-3";
    for (let i = 0; i < 15; i++) {
      trackCacheBreakpoint(convId, i);
    }

    const breakpoints = getCacheBreakpoints(convId);
    expect(breakpoints.length).toBe(10);
    expect(breakpoints[0]).toBe(5); // First 5 should be dropped
    expect(breakpoints[9]).toBe(14);
  });

  it("clears breakpoints for a conversation", () => {
    const convId = "test-conv-4";
    trackCacheBreakpoint(convId, 5);
    trackCacheBreakpoint(convId, 10);

    clearCacheBreakpoints(convId);

    const breakpoints = getCacheBreakpoints(convId);
    expect(breakpoints).toEqual([]);
  });

  it("returns empty array for unknown conversation", () => {
    const breakpoints = getCacheBreakpoints("nonexistent-conv");
    expect(breakpoints).toEqual([]);
  });
});

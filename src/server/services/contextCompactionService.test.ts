import { describe, expect, it } from "vitest";
import {
  estimateTokens,
  computePressure,
  compactMessages,
  createCompactionTracker,
  compactWithCircuitBreaker,
  emergencyCompact,
  type CompactionMessage,
} from "./contextCompactionService";

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

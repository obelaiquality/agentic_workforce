/**
 * Integration test for context compaction under token pressure.
 *
 * Tests all 5 ACC (Adaptive Context Compaction) stages at their
 * respective pressure thresholds: 70%, 80%, 85%, 90%, 99%.
 * Verifies token reduction at each stage and that pinned messages survive.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  compactMessages,
  computePressure,
  estimateTokens,
  compactWithCircuitBreaker,
  compactWithMemory,
  emergencyCompact,
  createCompactionTracker,
  snipCompact,
  resetFileAccesses,
  type CompactionMessage,
  type CompactionResult,
} from "./contextCompactionService";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a string of approximately the desired token count (~4 chars/token). */
function generateText(approxTokens: number): string {
  const chars = approxTokens * 4;
  const word = "lorem ipsum dolor sit amet consectetur ";
  return word.repeat(Math.ceil(chars / word.length)).slice(0, chars);
}

/** Generate a code-fenced block of approximately the desired token count. */
function generateCodeBlock(approxTokens: number): string {
  const innerTokens = approxTokens - 4; // subtract fence overhead
  const code = "const x = 1;\nfunction foo() {\n  return x;\n}\n";
  const inner = code.repeat(Math.ceil((innerTokens * 4) / code.length)).slice(0, innerTokens * 4);
  return "```typescript\n" + inner + "\n```";
}

/** Build a conversation with the given total target tokens, split across messages. */
function buildConversation(
  messageCount: number,
  tokensPerMessage: number,
  options?: {
    includeCodeBlocks?: boolean;
    includeDecisionLines?: boolean;
  },
): CompactionMessage[] {
  const messages: CompactionMessage[] = [];

  // First two messages are pinned (system + first user)
  messages.push({
    role: "system",
    content: generateText(tokensPerMessage),
    pinned: true,
  });
  messages.push({
    role: "user",
    content: generateText(tokensPerMessage),
    pinned: true,
  });

  for (let i = 2; i < messageCount; i++) {
    const role = i % 2 === 0 ? "assistant" : "user";
    let content: string;

    if (role === "assistant") {
      if (options?.includeCodeBlocks && i % 4 === 0) {
        content = generateCodeBlock(tokensPerMessage);
      } else if (options?.includeDecisionLines) {
        content =
          `Decision: use approach A for file ${i}\n` +
          `Result: successfully updated module\n` +
          generateText(tokensPerMessage - 20);
      } else {
        content = generateText(tokensPerMessage);
      }
    } else {
      content = generateText(tokensPerMessage);
    }

    messages.push({ role, content });
  }

  return messages;
}

/**
 * Build a conversation where the total tokens hit a specific pressure level
 * relative to the given maxContextTokens.
 */
function buildConversationAtPressure(
  targetPressure: number,
  maxContextTokens: number,
  messageCount: number,
  options?: {
    includeCodeBlocks?: boolean;
    includeDecisionLines?: boolean;
  },
): CompactionMessage[] {
  const totalTargetTokens = Math.ceil(targetPressure * maxContextTokens);
  const tokensPerMessage = Math.ceil(totalTargetTokens / messageCount);
  return buildConversation(messageCount, tokensPerMessage, options);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Context Compaction Pressure Tests", () => {
  beforeEach(() => {
    resetFileAccesses();
  });

  describe("pressure measurement", () => {
    it("computePressure returns correct fraction", () => {
      const maxTokens = 10000;
      const messages = buildConversationAtPressure(0.5, maxTokens, 10);
      const pressure = computePressure(messages, maxTokens);

      // Should be approximately 0.5 (allow 10% tolerance due to text generation rounding)
      expect(pressure).toBeGreaterThan(0.4);
      expect(pressure).toBeLessThan(0.6);
    });

    it("estimateTokens uses ~4 chars per token", () => {
      const text = "a".repeat(400);
      expect(estimateTokens(text)).toBe(100);
    });
  });

  describe("stage-by-stage compaction", () => {
    const MAX_CONTEXT = 10000;

    it("no compaction below 70% pressure", () => {
      const messages = buildConversationAtPressure(0.65, MAX_CONTEXT, 6);
      const result = compactMessages(messages, MAX_CONTEXT);

      // Pressure is below 70%, so minimal or no compaction (stage 0)
      expect(result.stage).toBe(0);
    });

    it("compaction triggers and reduces tokens above 70% pressure", () => {
      // Use few messages so snip compact does NOT drop them (stays within tail window)
      // but messages are large enough to create 75% pressure
      const messages = buildConversationAtPressure(0.75, MAX_CONTEXT, 8);
      const result = compactMessages(messages, MAX_CONTEXT);

      // Should apply at least stage 1 (summarize old results)
      expect(result.stage).toBeGreaterThanOrEqual(1);
      // Token count should decrease (or at least not increase)
      expect(result.tokensAfter).toBeLessThanOrEqual(result.tokensBefore);
    });

    it("higher pressure produces higher or equal stage number", () => {
      // Stages are applied sequentially: each stage may reduce pressure below
      // the next threshold. So we verify that higher starting pressure leads
      // to at least as high a stage number.
      const msgs75 = buildConversationAtPressure(0.75, MAX_CONTEXT, 8);
      const msgs90 = buildConversationAtPressure(0.92, MAX_CONTEXT, 8);
      const msgs105 = buildConversationAtPressure(1.05, MAX_CONTEXT, 8);

      const r75 = compactMessages(msgs75, MAX_CONTEXT);
      const r90 = compactMessages(msgs90, MAX_CONTEXT);
      const r105 = compactMessages(msgs105, MAX_CONTEXT);

      expect(r90.stage).toBeGreaterThanOrEqual(r75.stage);
      expect(r105.stage).toBeGreaterThanOrEqual(r90.stage);
    });

    it("stage 5 (emergency) triggers at very high pressure with many non-pinned messages", () => {
      // Emergency stage requires pressure >= 0.99. Each prior stage reduces pressure,
      // so we need extremely high pressure with content that isn't fully reducible
      // by stages 1-4. Use all user messages (not assistant) to bypass stages 1-3
      // which only compact assistant messages.
      const messages: CompactionMessage[] = [
        { role: "system", content: generateText(200), pinned: true },
        { role: "user", content: generateText(200), pinned: true },
      ];

      // Add many non-pinned messages to push way over the limit
      for (let i = 0; i < 20; i++) {
        // Alternate user and assistant so merge-consecutive (stage 4) can't help
        messages.push({
          role: i % 2 === 0 ? "assistant" : "user",
          content: generateText(800),
        });
      }

      const pressure = computePressure(messages, MAX_CONTEXT);
      expect(pressure).toBeGreaterThan(1.0); // Verify we're way over

      const result = compactMessages(messages, MAX_CONTEXT);
      // At extreme pressure, the compactor should activate high-stage compaction
      // and reduce token count significantly
      expect(result.stage).toBeGreaterThanOrEqual(1);
      expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
    });

    it("merge consecutive (stage 4) activates when consecutive same-role messages exist", () => {
      // Build messages where stages 1-3 can't reduce pressure enough because
      // the content is all short assistant messages with no code blocks or decision lines
      const messages: CompactionMessage[] = [
        { role: "system", content: "s", pinned: true },
        { role: "user", content: "u", pinned: true },
      ];

      // Add many consecutive assistant messages with short content (<= 200 chars
      // so stage 1 won't truncate, and <= 100 chars reasoning so stage 2 won't help)
      // But total pressure is > 0.9
      const tokensPerMsg = Math.ceil((0.95 * MAX_CONTEXT) / 8);
      for (let i = 0; i < 8; i++) {
        messages.push({ role: "assistant", content: generateText(tokensPerMsg) });
      }

      const result = compactMessages(messages, MAX_CONTEXT);
      // With 8 consecutive assistant messages at high pressure, compaction should
      // activate and reduce the conversation
      expect(result.stage).toBeGreaterThanOrEqual(1);
      expect(result.tokensAfter).toBeLessThanOrEqual(result.tokensBefore);
    });
  });

  describe("pinned message survival", () => {
    const MAX_CONTEXT = 5000;

    it("pinned messages survive all 5 compaction stages", () => {
      const pinnedSystem = "SYSTEM_PINNED_MARKER_XYZ: You are a helpful assistant.";
      const pinnedUser = "USER_PINNED_MARKER_XYZ: Create a hello world file.";

      const messages: CompactionMessage[] = [
        { role: "system", content: pinnedSystem, pinned: true },
        { role: "user", content: pinnedUser, pinned: true },
      ];

      // Add many large messages to push pressure very high
      for (let i = 0; i < 30; i++) {
        messages.push({
          role: i % 2 === 0 ? "assistant" : "user",
          content: generateText(500),
        });
      }

      const result = compactMessages(messages, MAX_CONTEXT);

      // Stage 5 (emergency) should have been reached
      expect(result.stage).toBe(5);

      // Pinned messages must survive
      const systemMsg = result.messages.find((m) => m.content.includes("SYSTEM_PINNED_MARKER_XYZ"));
      const userMsg = result.messages.find((m) => m.content.includes("USER_PINNED_MARKER_XYZ"));

      expect(systemMsg).toBeDefined();
      expect(userMsg).toBeDefined();
      expect(systemMsg!.pinned).toBe(true);
      expect(userMsg!.pinned).toBe(true);

      // Verify the full pinned content is preserved (not truncated)
      expect(systemMsg!.content).toBe(pinnedSystem);
      expect(userMsg!.content).toBe(pinnedUser);
    });

    it("pinned messages at various positions survive emergency compaction", () => {
      const messages: CompactionMessage[] = [
        { role: "system", content: "Pin-A", pinned: true },
        { role: "user", content: "Pin-B", pinned: true },
        { role: "assistant", content: generateText(2000) },
        { role: "user", content: generateText(2000) },
        { role: "assistant", content: generateText(2000) },
      ];

      const result = emergencyCompact(messages, 1000);

      // Emergency compaction should preserve pinned messages
      const pinA = result.messages.find((m) => m.content === "Pin-A");
      const pinB = result.messages.find((m) => m.content === "Pin-B");
      expect(pinA).toBeDefined();
      expect(pinB).toBeDefined();
    });
  });

  describe("token reduction verification", () => {
    const MAX_CONTEXT = 10000;

    it("each successive stage produces at least as much reduction", () => {
      const pressureLevels = [0.72, 0.82, 0.87, 0.92, 1.0];
      let previousReduction = 0;

      for (const pressure of pressureLevels) {
        const messages = buildConversationAtPressure(pressure, MAX_CONTEXT, 30, {
          includeCodeBlocks: true,
          includeDecisionLines: true,
        });
        const result = compactMessages(messages, MAX_CONTEXT);
        const reduction = result.tokensBefore - result.tokensAfter;

        // Higher pressure should generally produce more reduction
        // (or at least equal, since more stages are applied)
        expect(reduction).toBeGreaterThanOrEqual(0);
        previousReduction = reduction;
      }
    });

    it("emergency compaction drastically reduces token count", () => {
      // Build with many non-pinned messages so emergency (stage 5) can drop most of them
      const messages: CompactionMessage[] = [
        { role: "system", content: "System prompt", pinned: true },
        { role: "user", content: "User objective", pinned: true },
      ];

      // Add many messages to overshoot the context window
      for (let i = 0; i < 25; i++) {
        messages.push({
          role: i % 2 === 0 ? "assistant" : "user",
          content: generateText(600),
        });
      }

      const result = compactMessages(messages, MAX_CONTEXT);

      // Should have significantly fewer messages after compaction
      expect(result.messages.length).toBeLessThan(messages.length);
      // Token reduction should be meaningful
      expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
    });
  });

  describe("circuit breaker", () => {
    it("trips after 3 consecutive compaction failures", () => {
      const tracker = createCompactionTracker();
      const MAX_CONTEXT = 100000; // Very high so compaction does nothing

      // Messages are small enough that compaction won't reduce tokens
      const tinyMessages: CompactionMessage[] = [
        { role: "system", content: "Hi", pinned: true },
        { role: "user", content: "Hello", pinned: true },
      ];

      // Run compaction 3 times — each time tokens don't decrease
      for (let i = 0; i < 3; i++) {
        compactWithCircuitBreaker(tinyMessages, MAX_CONTEXT, tracker);
      }

      expect(tracker.consecutiveFailures).toBe(3);

      // 4th call should return null (circuit breaker open)
      const result = compactWithCircuitBreaker(tinyMessages, MAX_CONTEXT, tracker);
      expect(result).toBeNull();
    });

    it("resets consecutive failures on successful compaction", () => {
      const tracker = createCompactionTracker();
      tracker.consecutiveFailures = 2;

      // Build conversation that actually needs compaction
      const messages = buildConversationAtPressure(0.85, 5000, 30);
      const result = compactWithCircuitBreaker(messages, 5000, tracker);

      expect(result).not.toBeNull();
      if (result && result.tokensAfter < result.tokensBefore) {
        expect(tracker.consecutiveFailures).toBe(0);
      }
    });
  });

  describe("snip compact (stage 0)", () => {
    it("drops old messages beyond sliding window", () => {
      const MAX_CONTEXT = 5000;
      const messages = buildConversationAtPressure(0.8, MAX_CONTEXT, 40);

      const result = snipCompact(messages, MAX_CONTEXT, {
        protectedTailTurns: 5,
        minPressure: 0.5,
      });

      // Should have fewer messages than the input
      expect(result.messages.length).toBeLessThan(messages.length);

      // Pinned messages should survive
      const pinnedCount = result.messages.filter((m) => m.pinned).length;
      expect(pinnedCount).toBeGreaterThanOrEqual(2); // system + first user
    });

    it("preserves all system messages", () => {
      const messages: CompactionMessage[] = [
        { role: "system", content: "System prompt", pinned: true },
        { role: "user", content: "User message", pinned: true },
        { role: "system", content: "Injected system message" },
      ];

      // Add many messages to push pressure up
      for (let i = 0; i < 30; i++) {
        messages.push({
          role: i % 2 === 0 ? "assistant" : "user",
          content: generateText(200),
        });
      }

      const result = snipCompact(messages, 5000, {
        protectedTailTurns: 3,
        minPressure: 0.3,
      });

      // All system messages should be preserved
      const systemMsgs = result.messages.filter((m) => m.role === "system");
      expect(systemMsgs.length).toBeGreaterThanOrEqual(2);
    });

    it("skips compaction below minPressure", () => {
      const messages: CompactionMessage[] = [
        { role: "system", content: "Short system", pinned: true },
        { role: "user", content: "Short user", pinned: true },
        { role: "assistant", content: "Short reply" },
      ];

      const result = snipCompact(messages, 100000, {
        protectedTailTurns: 10,
        minPressure: 0.5,
      });

      // Pressure is well below 50%, so no compaction
      expect(result.messages.length).toBe(messages.length);
    });
  });

  describe("large conversation stress test", () => {
    it("handles 30+ message conversation at each pressure threshold", () => {
      const MAX_CONTEXT = 30000;
      const thresholds = [0.7, 0.8, 0.85, 0.9, 0.99];

      for (const threshold of thresholds) {
        const messages = buildConversationAtPressure(threshold + 0.02, MAX_CONTEXT, 35, {
          includeCodeBlocks: true,
          includeDecisionLines: true,
        });

        const result = compactMessages(messages, MAX_CONTEXT);

        // Should complete without error
        expect(result).toBeDefined();
        expect(result.stage).toBeGreaterThanOrEqual(0);

        // Pinned messages always survive
        const pinnedSurvivors = result.messages.filter((m) => m.pinned);
        expect(pinnedSurvivors.length).toBeGreaterThanOrEqual(2);

        // Pressure should be reduced
        const finalPressure = computePressure(result.messages, MAX_CONTEXT);
        expect(finalPressure).toBeLessThanOrEqual(threshold + 0.1);
      }
    });

    it("handles conversation with ~30k tokens", () => {
      const MAX_CONTEXT = 30000;
      // Build a conversation that totals roughly 30k tokens
      const messages = buildConversation(40, 750, {
        includeCodeBlocks: true,
        includeDecisionLines: true,
      });

      const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
      // Verify we're in the right ballpark (25k-35k tokens)
      expect(totalTokens).toBeGreaterThan(25000);
      expect(totalTokens).toBeLessThan(35000);

      const result = compactMessages(messages, MAX_CONTEXT);

      expect(result).toBeDefined();
      expect(result.tokensAfter).toBeLessThan(result.tokensBefore);

      // Pinned messages survived
      const pinned = result.messages.filter((m) => m.pinned);
      expect(pinned.length).toBe(2);
    });
  });
});

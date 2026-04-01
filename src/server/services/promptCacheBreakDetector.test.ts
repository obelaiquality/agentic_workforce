import { describe, it, expect } from "vitest";
import {
  createDetectorState,
  recordObservation,
  detectBreak,
  resetBaseline,
  markCompaction,
  simpleHash,
} from "./promptCacheBreakDetector";

describe("promptCacheBreakDetector", () => {
  describe("createDetectorState", () => {
    it("returns valid initial state", () => {
      const state = createDetectorState();
      expect(state.baselineCacheReadTokens).toBe(0);
      expect(state.sampleCount).toBe(0);
      expect(state.lastSystemPromptHash).toBeNull();
      expect(state.lastToolSchemaHash).toBeNull();
      expect(state.lastMessageCount).toBe(0);
      expect(state.compactionSinceLastCheck).toBe(false);
    });
  });

  describe("recordObservation", () => {
    it("updates baseline on first call", () => {
      const state = createDetectorState();
      recordObservation(state, 1000);
      expect(state.baselineCacheReadTokens).toBe(1000);
      expect(state.sampleCount).toBe(1);
    });

    it("accumulates sample count", () => {
      const state = createDetectorState();
      recordObservation(state, 1000);
      recordObservation(state, 1000);
      recordObservation(state, 1000);
      expect(state.sampleCount).toBe(3);
    });

    it("updates hashes and message count", () => {
      const state = createDetectorState();
      recordObservation(state, 1000, "hash1", "schema1", 10);
      expect(state.lastSystemPromptHash).toBe("hash1");
      expect(state.lastToolSchemaHash).toBe("schema1");
      expect(state.lastMessageCount).toBe(10);
    });

    it("uses EMA for baseline after first observation", () => {
      const state = createDetectorState();
      recordObservation(state, 1000);
      expect(state.baselineCacheReadTokens).toBe(1000);
      recordObservation(state, 2000);
      // EMA: 0.3 * 2000 + 0.7 * 1000 = 1300
      expect(state.baselineCacheReadTokens).toBeCloseTo(1300, 0);
    });
  });

  describe("detectBreak", () => {
    it("returns null when not enough samples", () => {
      const state = createDetectorState();
      recordObservation(state, 1000);
      recordObservation(state, 1000);
      expect(detectBreak(state, 100)).toBeNull();
    });

    it("returns null when cache tokens are stable", () => {
      const state = createDetectorState();
      recordObservation(state, 1000);
      recordObservation(state, 1000);
      recordObservation(state, 1000);
      expect(detectBreak(state, 900)).toBeNull();
    });

    it("returns event when tokens drop > 50%", () => {
      const state = createDetectorState();
      recordObservation(state, 1000);
      recordObservation(state, 1000);
      recordObservation(state, 1000);
      const event = detectBreak(state, 100);
      expect(event).not.toBeNull();
      expect(event!.dropPercent).toBeGreaterThan(0.5);
      expect(event!.currentTokens).toBe(100);
      expect(event!.possibleCauses).toContain("unknown");
    });

    it("identifies system_prompt_changed cause", () => {
      const state = createDetectorState();
      recordObservation(state, 1000, "hash1");
      recordObservation(state, 1000, "hash1");
      recordObservation(state, 1000, "hash1");
      const event = detectBreak(state, 100, {
        currentSystemPromptHash: "hash2",
      });
      expect(event).not.toBeNull();
      expect(event!.possibleCauses).toContain("system_prompt_changed");
    });

    it("identifies tool_schema_changed cause", () => {
      const state = createDetectorState();
      recordObservation(state, 1000, undefined, "schema1");
      recordObservation(state, 1000, undefined, "schema1");
      recordObservation(state, 1000, undefined, "schema1");
      const event = detectBreak(state, 100, {
        currentToolSchemaHash: "schema2",
      });
      expect(event).not.toBeNull();
      expect(event!.possibleCauses).toContain("tool_schema_changed");
    });

    it("identifies message_ordering_changed cause", () => {
      const state = createDetectorState();
      recordObservation(state, 1000, undefined, undefined, 20);
      recordObservation(state, 1000, undefined, undefined, 20);
      recordObservation(state, 1000, undefined, undefined, 20);
      const event = detectBreak(state, 100, {
        currentMessageCount: 10,
      });
      expect(event).not.toBeNull();
      expect(event!.possibleCauses).toContain("message_ordering_changed");
    });

    it("identifies compaction_occurred cause", () => {
      const state = createDetectorState();
      recordObservation(state, 1000);
      recordObservation(state, 1000);
      recordObservation(state, 1000);
      markCompaction(state);
      const event = detectBreak(state, 100);
      expect(event).not.toBeNull();
      expect(event!.possibleCauses).toContain("compaction_occurred");
    });

    it("respects custom threshold", () => {
      const state = createDetectorState();
      recordObservation(state, 1000);
      recordObservation(state, 1000);
      recordObservation(state, 1000);
      // With default 50% threshold, 600 tokens wouldn't trigger
      expect(detectBreak(state, 600)).toBeNull();
      // With 30% threshold, it should trigger
      const event = detectBreak(state, 600, { threshold: 0.3 });
      expect(event).not.toBeNull();
    });
  });

  describe("resetBaseline", () => {
    it("clears baseline and prevents false positives", () => {
      const state = createDetectorState();
      recordObservation(state, 1000);
      recordObservation(state, 1000);
      recordObservation(state, 1000);
      expect(detectBreak(state, 100)).not.toBeNull();
      resetBaseline(state);
      expect(state.baselineCacheReadTokens).toBe(0);
      expect(state.sampleCount).toBe(0);
      expect(detectBreak(state, 100)).toBeNull();
    });
  });

  describe("simpleHash", () => {
    it("produces consistent output", () => {
      expect(simpleHash("hello")).toBe(simpleHash("hello"));
      expect(simpleHash("hello")).not.toBe(simpleHash("world"));
    });

    it("returns a string", () => {
      expect(typeof simpleHash("test")).toBe("string");
    });
  });
});

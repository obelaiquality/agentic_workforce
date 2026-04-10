import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  ProviderOrchestrator,
  isContextOverflowError,
  isTransientCapacityError,
  isStaleConnectionError,
} from "./providerOrchestrator";
import { ProviderFactory } from "../providers/factory";
import { ModelInferenceError } from "../errors";

/**
 * Error-path integration tests for ProviderOrchestrator.
 *
 * Covers:
 *  - Full fallback chain: coder_default -> utility_fast -> overseer_escalation
 *  - Transient errors trigger retries with backoff
 *  - Non-retryable errors skip retries, go straight to fallback
 *  - Interaction of stale connection + capacity errors
 *  - All providers down scenario
 */

// Mock dependencies
const { mockEmergencyCompact, mockPublishEvent, mockGetTelemetry } = vi.hoisted(() => ({
  mockEmergencyCompact: vi.fn(),
  mockPublishEvent: vi.fn(),
  mockGetTelemetry: vi.fn(() => ({
    incrementCounter: vi.fn(),
    recordMetric: vi.fn(),
  })),
}));

vi.mock("./contextCompactionService", () => ({
  emergencyCompact: mockEmergencyCompact,
}));

vi.mock("../eventBus", () => ({
  publishEvent: mockPublishEvent,
}));

vi.mock("../telemetry/tracer", () => ({
  getTelemetry: mockGetTelemetry,
}));

describe("ProviderOrchestrator — error path integration", () => {
  let orchestrator: ProviderOrchestrator;
  let mockFactory: ProviderFactory;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFactory = {} as ProviderFactory;
    orchestrator = new ProviderOrchestrator(mockFactory);
  });

  // -------------------------------------------------------------------------
  // Full fallback chain
  // -------------------------------------------------------------------------

  describe("full fallback chain", () => {
    it("falls back coder_default -> utility_fast -> overseer_escalation on capacity errors", async () => {
      const callHistory: string[] = [];

      vi.spyOn(orchestrator, "streamChat").mockImplementation(
        async (_sessionId, _messages, _onToken, options) => {
          const role = options?.modelRole ?? "coder_default";
          callHistory.push(role);

          if (role === "overseer_escalation") {
            return {
              text: "Overseer handled it",
              accountId: "acc1",
              providerId: "openai-responses" as const,
            };
          }
          throw new Error("rate_limit exceeded");
        },
      );

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        { querySource: "execution", modelRole: "coder_default" },
      );

      expect(result.text).toBe("Overseer handled it");

      // Should have tried: coder_default (4 times = 1 initial + 3 retries),
      // then utility_fast (1 fallback attempt), then overseer_escalation (1)
      expect(callHistory.filter((r) => r === "coder_default").length).toBe(4);
      expect(callHistory).toContain("utility_fast");
      expect(callHistory).toContain("overseer_escalation");
    });

    it("succeeds on model fallback without reaching overseer", async () => {
      const callHistory: string[] = [];

      vi.spyOn(orchestrator, "streamChat").mockImplementation(
        async (_sessionId, _messages, _onToken, options) => {
          const role = options?.modelRole ?? "coder_default";
          callHistory.push(role);

          if (role === "utility_fast") {
            return {
              text: "Utility handled it",
              accountId: "acc1",
              providerId: "onprem-qwen" as const,
            };
          }
          throw new Error("rate_limit exceeded");
        },
      );

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        { querySource: "execution", modelRole: "coder_default" },
      );

      expect(result.text).toBe("Utility handled it");

      // Should publish model_fallback event
      expect(mockPublishEvent).toHaveBeenCalledWith("global", "provider.model_fallback", {
        sessionId: "session1",
        originalRole: "coder_default",
        fallbackRole: "utility_fast",
        reason: expect.stringContaining("rate_limit"),
      });

      // Should NOT have attempted overseer
      expect(callHistory).not.toContain("overseer_escalation");
    });

    it("review_deep -> coder_default -> utility_fast -> overseer_escalation complete chain", async () => {
      const callHistory: string[] = [];

      vi.spyOn(orchestrator, "streamChat").mockImplementation(
        async (_sessionId, _messages, _onToken, options) => {
          const role = options?.modelRole ?? "coder_default";
          callHistory.push(role);

          if (role === "overseer_escalation") {
            return {
              text: "Final fallback success",
              accountId: "acc1",
              providerId: "openai-responses" as const,
            };
          }
          throw new Error("capacity exhausted");
        },
      );

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        { querySource: "execution", modelRole: "review_deep" },
      );

      expect(result.text).toBe("Final fallback success");

      // Should have tried review_deep, then coder_default (fallback from review_deep),
      // then overseer_escalation
      expect(callHistory).toContain("review_deep");
      expect(callHistory).toContain("coder_default");
      expect(callHistory).toContain("overseer_escalation");
    });

    it("throws ModelInferenceError when entire chain fails", async () => {
      vi.spyOn(orchestrator, "streamChat").mockRejectedValue(
        new Error("All backends unreachable"),
      );

      await expect(
        orchestrator.streamChatWithRetry(
          "session1",
          [{ role: "user", content: "test" }],
          vi.fn(),
          { querySource: "execution", modelRole: "coder_default" },
        ),
      ).rejects.toThrow(ModelInferenceError);
    });
  });

  // -------------------------------------------------------------------------
  // Transient errors trigger retries with backoff
  // -------------------------------------------------------------------------

  describe("transient error retries with backoff", () => {
    it("retries rate_limit errors with increasing delays", async () => {
      const timestamps: number[] = [];

      vi.spyOn(orchestrator, "streamChat").mockImplementation(async () => {
        timestamps.push(Date.now());
        if (timestamps.length < 3) {
          throw new Error("rate_limit exceeded");
        }
        return {
          text: "Success after retries",
          accountId: "acc1",
          providerId: "onprem-qwen" as const,
        };
      });

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        { querySource: "execution" },
      );

      expect(result.text).toBe("Success after retries");

      // There should be delays between attempts (backoff)
      if (timestamps.length >= 3) {
        const delay1 = timestamps[1] - timestamps[0];
        const delay2 = timestamps[2] - timestamps[1];
        // First retry should have at least 500ms backoff
        expect(delay1).toBeGreaterThanOrEqual(450);
        // Second retry should have at least 1000ms backoff
        expect(delay2).toBeGreaterThanOrEqual(900);
      }
    });

    it("retries 429 errors for execution source", async () => {
      let attempts = 0;

      vi.spyOn(orchestrator, "streamChat").mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error("HTTP 429 Too Many Requests");
        }
        return {
          text: "Recovered from 429",
          accountId: "acc1",
          providerId: "onprem-qwen" as const,
        };
      });

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        { querySource: "execution" },
      );

      expect(result.text).toBe("Recovered from 429");
      expect(attempts).toBe(2);
    });

    it("does not retry transient errors for background (reporting) source", async () => {
      vi.spyOn(orchestrator, "streamChat").mockRejectedValue(
        new Error("rate_limit exceeded"),
      );

      await expect(
        orchestrator.streamChatWithRetry(
          "session1",
          [{ role: "user", content: "test" }],
          vi.fn(),
          { querySource: "reporting" },
        ),
      ).rejects.toThrow(ModelInferenceError);

      // Should have tried: initial + fallback to overseer_escalation (no retries)
      expect(orchestrator.streamChat).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // Non-retryable errors skip retries and go straight to fallback
  // -------------------------------------------------------------------------

  describe("non-retryable errors go straight to fallback", () => {
    it("auth error skips retries and attempts fallback", async () => {
      const callHistory: string[] = [];

      vi.spyOn(orchestrator, "streamChat").mockImplementation(
        async (_sessionId, _messages, _onToken, options) => {
          const role = options?.modelRole ?? "coder_default";
          callHistory.push(role);

          if (role === "overseer_escalation") {
            return {
              text: "Overseer took over",
              accountId: "acc1",
              providerId: "openai-responses" as const,
            };
          }
          throw new Error("Invalid API key");
        },
      );

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        { querySource: "execution", modelRole: "coder_default" },
      );

      expect(result.text).toBe("Overseer took over");

      // Should NOT have retried coder_default — only 1 attempt then fallback
      // Non-retryable error: initial call + fallback to overseer_escalation = 2
      expect(callHistory.filter((r) => r === "coder_default").length).toBe(1);
      expect(callHistory).toContain("overseer_escalation");
    });

    it("model validation error skips retries and goes to fallback", async () => {
      vi.spyOn(orchestrator, "streamChat").mockImplementation(
        async (_sessionId, _messages, _onToken, options) => {
          const role = options?.modelRole ?? "coder_default";
          if (role === "overseer_escalation") {
            return {
              text: "Handled by overseer",
              accountId: "acc1",
              providerId: "openai-responses" as const,
            };
          }
          throw new Error("Model 'nonexistent' not found");
        },
      );

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
      );

      expect(result.text).toBe("Handled by overseer");

      // Initial call + fallback to overseer_escalation
      expect(orchestrator.streamChat).toHaveBeenCalledTimes(2);
    });

    it("non-retryable error on overseer_escalation throws immediately", async () => {
      vi.spyOn(orchestrator, "streamChat").mockRejectedValue(
        new Error("Service permanently unavailable"),
      );

      await expect(
        orchestrator.streamChatWithRetry(
          "session1",
          [{ role: "user", content: "test" }],
          vi.fn(),
          { modelRole: "overseer_escalation" },
        ),
      ).rejects.toThrow(ModelInferenceError);

      // Only 1 call — no retries, no further fallback since already on overseer
      expect(orchestrator.streamChat).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Stale connection recovery
  // -------------------------------------------------------------------------

  describe("stale connection recovery", () => {
    it("retries once on ECONNRESET then succeeds", async () => {
      let attempts = 0;

      vi.spyOn(orchestrator, "streamChat").mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error("ECONNRESET");
        }
        return {
          text: "Recovered from stale connection",
          accountId: "acc1",
          providerId: "onprem-qwen" as const,
        };
      });

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
      );

      expect(result.text).toBe("Recovered from stale connection");
      expect(attempts).toBe(2);
    });

    it("falls back after repeated ECONNRESET on stale retry", async () => {
      vi.spyOn(orchestrator, "streamChat").mockRejectedValue(
        new Error("ECONNRESET"),
      );

      await expect(
        orchestrator.streamChatWithRetry(
          "session1",
          [{ role: "user", content: "test" }],
          vi.fn(),
        ),
      ).rejects.toThrow(ModelInferenceError);

      // Initial + stale retry + fallback to overseer_escalation = 3
      expect(orchestrator.streamChat).toHaveBeenCalledTimes(3);
    });

    it("retries socket hang up once, then falls back on second failure", async () => {
      const callHistory: string[] = [];

      vi.spyOn(orchestrator, "streamChat").mockImplementation(
        async (_sessionId, _messages, _onToken, options) => {
          const role = options?.modelRole ?? "coder_default";
          callHistory.push(role);

          if (role === "overseer_escalation") {
            return {
              text: "Overseer recovery",
              accountId: "acc1",
              providerId: "openai-responses" as const,
            };
          }
          throw new Error("socket hang up");
        },
      );

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
      );

      expect(result.text).toBe("Overseer recovery");
      expect(callHistory).toContain("overseer_escalation");
    });
  });

  // -------------------------------------------------------------------------
  // Context overflow handling
  // -------------------------------------------------------------------------

  describe("context overflow with emergency compaction", () => {
    it("compacts and retries on context_length_exceeded error", async () => {
      const messages = [{ role: "user" as const, content: "very long prompt" }];

      mockEmergencyCompact.mockReturnValue({
        messages: [{ role: "user" as const, content: "compacted prompt" }],
        tokensBefore: 10000,
        tokensAfter: 3000,
        stage: "stage4",
      });

      vi.spyOn(orchestrator, "streamChat")
        .mockRejectedValueOnce(new Error("context_length_exceeded"))
        .mockResolvedValueOnce({
          text: "Succeeded after compaction",
          accountId: "acc1",
          providerId: "onprem-qwen" as const,
        });

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        messages,
        vi.fn(),
        { maxContextTokens: 8000 },
      );

      expect(result.text).toBe("Succeeded after compaction");
      expect(mockEmergencyCompact).toHaveBeenCalledWith(messages, 8000);
    });

    it("throws when compaction retry also hits context overflow", async () => {
      mockEmergencyCompact.mockReturnValue({
        messages: [{ role: "user" as const, content: "still too long" }],
        tokensBefore: 10000,
        tokensAfter: 5000,
        stage: "stage5",
      });

      vi.spyOn(orchestrator, "streamChat")
        .mockRejectedValueOnce(new Error("prompt_too_long"))
        .mockRejectedValueOnce(new Error("prompt_too_long"));

      await expect(
        orchestrator.streamChatWithRetry(
          "session1",
          [{ role: "user", content: "test" }],
          vi.fn(),
          { maxContextTokens: 4096, modelRole: "coder_default" },
        ),
      ).rejects.toThrow(ModelInferenceError);
    });
  });

  // -------------------------------------------------------------------------
  // Edge: mixed error types in sequence
  // -------------------------------------------------------------------------

  describe("mixed error sequences", () => {
    it("handles stale connection followed by capacity error — both retried", async () => {
      let attempt = 0;

      vi.spyOn(orchestrator, "streamChat").mockImplementation(async () => {
        attempt++;
        if (attempt === 1) throw new Error("ECONNRESET");
        if (attempt === 2) throw new Error("rate_limit");
        return {
          text: "Recovered from mixed errors",
          accountId: "acc1",
          providerId: "onprem-qwen" as const,
        };
      });

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        { querySource: "execution" },
      );

      expect(result.text).toBe("Recovered from mixed errors");
      expect(attempt).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Error classification utility tests
  // -------------------------------------------------------------------------

  describe("error classification utilities", () => {
    it("isContextOverflowError detects all overflow patterns", () => {
      const patterns = [
        "prompt_too_long",
        "context_length_exceeded",
        "maximum context length",
        "context window exceeded",
        "too many tokens",
      ];

      for (const pattern of patterns) {
        expect(isContextOverflowError(new Error(pattern))).toBe(true);
      }
    });

    it("isTransientCapacityError detects all transient patterns", () => {
      const patterns = [
        "rate_limit exceeded",
        "HTTP 429",
        "HTTP 529",
        "Server overloaded",
        "Insufficient capacity",
      ];

      for (const pattern of patterns) {
        expect(isTransientCapacityError(new Error(pattern))).toBe(true);
      }
    });

    it("isStaleConnectionError detects connection patterns", () => {
      const patterns = ["ECONNRESET", "write EPIPE", "socket hang up"];

      for (const pattern of patterns) {
        expect(isStaleConnectionError(new Error(pattern))).toBe(true);
      }
    });

    it("none of the classifiers match unrelated errors", () => {
      const error = new Error("Unexpected null pointer");
      expect(isContextOverflowError(error)).toBe(false);
      expect(isTransientCapacityError(error)).toBe(false);
      expect(isStaleConnectionError(error)).toBe(false);
    });

    it("none of the classifiers match non-Error values", () => {
      for (const val of [null, undefined, "string", 42, { message: "foo" }]) {
        expect(isContextOverflowError(val)).toBe(false);
        expect(isTransientCapacityError(val)).toBe(false);
        expect(isStaleConnectionError(val)).toBe(false);
      }
    });
  });
});

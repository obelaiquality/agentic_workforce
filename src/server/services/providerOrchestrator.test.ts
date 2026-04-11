import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ModelRole, ModelRoleBinding } from "../../shared/contracts";
import {
  applyEscalationPolicy,
  isContextOverflowError,
  isContextOverflow400Error,
  isTransientCapacityError,
  isStaleConnectionError,
  isStreamingRecoverableError,
  retryDelayMs,
  ProviderOrchestrator,
} from "./providerOrchestrator";
import { ProviderFactory } from "../providers/factory";
import { ModelInferenceError } from "../errors";

// Mock dependencies using vi.hoisted
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

// Test the default model role binding structure without database
// These mirror the defaults in ProviderOrchestrator.getModelRoleBindings

const DEFAULT_BINDINGS: Record<ModelRole, ModelRoleBinding> = {
  utility_fast: {
    role: "utility_fast",
    providerId: "onprem-qwen",
    pluginId: "qwen3.5-0.8b",
    model: "Qwen/Qwen3.5-0.8B",
    temperature: 0.1,
    maxTokens: 900,
    reasoningMode: "off",
  },
  coder_default: {
    role: "coder_default",
    providerId: "onprem-qwen",
    pluginId: "qwen3.5-4b",
    model: "mlx-community/Qwen3.5-4B-4bit",
    temperature: 0.12,
    maxTokens: 1800,
    reasoningMode: "off",
  },
  review_deep: {
    role: "review_deep",
    providerId: "onprem-qwen",
    pluginId: "qwen3.5-4b",
    model: "mlx-community/Qwen3.5-4B-4bit",
    temperature: 0.08,
    maxTokens: 2200,
    reasoningMode: "on",
  },
  overseer_escalation: {
    role: "overseer_escalation",
    providerId: "openai-responses",
    pluginId: null,
    model: "gpt-5-nano",
    temperature: 0.1,
    maxTokens: 2200,
  },
};

describe("Provider role bindings", () => {
  it("Fast maps to 0.8B local model", () => {
    const binding = DEFAULT_BINDINGS.utility_fast;
    expect(binding.providerId).toBe("onprem-qwen");
    expect(binding.model).toBe("Qwen/Qwen3.5-0.8B");
    expect(binding.reasoningMode).toBe("off");
  });

  it("Build maps to 4B local model", () => {
    const binding = DEFAULT_BINDINGS.coder_default;
    expect(binding.providerId).toBe("onprem-qwen");
    expect(binding.model).toBe("mlx-community/Qwen3.5-4B-4bit");
    expect(binding.reasoningMode).toBe("off");
  });

  it("Review maps to 4B with deeper reasoning", () => {
    const binding = DEFAULT_BINDINGS.review_deep;
    expect(binding.providerId).toBe("onprem-qwen");
    expect(binding.model).toBe("mlx-community/Qwen3.5-4B-4bit");
    expect(binding.reasoningMode).toBe("on");
    expect(binding.temperature).toBeLessThan(DEFAULT_BINDINGS.coder_default.temperature);
  });

  it("Escalate maps to OpenAI", () => {
    const binding = DEFAULT_BINDINGS.overseer_escalation;
    expect(binding.providerId).toBe("openai-responses");
    expect(binding.reasoningMode).toBeUndefined();
  });

  it("all four roles are defined", () => {
    const roles: ModelRole[] = ["utility_fast", "coder_default", "review_deep", "overseer_escalation"];
    for (const role of roles) {
      expect(DEFAULT_BINDINGS[role]).toBeDefined();
      expect(DEFAULT_BINDINGS[role].role).toBe(role);
    }
  });

  it("local models use lower temperatures than cloud", () => {
    expect(DEFAULT_BINDINGS.utility_fast.temperature).toBeLessThanOrEqual(0.15);
    expect(DEFAULT_BINDINGS.coder_default.temperature).toBeLessThanOrEqual(0.15);
    expect(DEFAULT_BINDINGS.review_deep.temperature).toBeLessThanOrEqual(0.15);
  });

  it("review has higher maxTokens than fast", () => {
    expect(DEFAULT_BINDINGS.review_deep.maxTokens).toBeGreaterThan(DEFAULT_BINDINGS.utility_fast.maxTokens);
  });

  it("coder has a plugin ID referencing 4B", () => {
    expect(DEFAULT_BINDINGS.coder_default.pluginId).toContain("4b");
  });

  it("fast has a plugin ID referencing 0.8B", () => {
    expect(DEFAULT_BINDINGS.utility_fast.pluginId).toContain("0.8b");
  });
});

describe("applyEscalationPolicy", () => {
  it("passes through non-escalation roles unchanged", () => {
    expect(applyEscalationPolicy("coder_default", "manual")).toBe("coder_default");
    expect(applyEscalationPolicy("utility_fast", "manual")).toBe("utility_fast");
    expect(applyEscalationPolicy("review_deep", "manual")).toBe("review_deep");
  });

  it("auto policy always allows escalation", () => {
    expect(applyEscalationPolicy("overseer_escalation", "auto")).toBe("overseer_escalation");
    expect(applyEscalationPolicy("overseer_escalation", "auto", "low")).toBe("overseer_escalation");
    expect(applyEscalationPolicy("overseer_escalation", "auto", "high")).toBe("overseer_escalation");
  });

  it("manual policy always blocks escalation", () => {
    expect(applyEscalationPolicy("overseer_escalation", "manual")).toBe("review_deep");
    expect(applyEscalationPolicy("overseer_escalation", "manual", "high")).toBe("review_deep");
    expect(applyEscalationPolicy("overseer_escalation", "manual", "low")).toBe("review_deep");
  });

  it("high_risk_only allows escalation when risk is high", () => {
    expect(applyEscalationPolicy("overseer_escalation", "high_risk_only", "high")).toBe("overseer_escalation");
  });

  it("high_risk_only blocks escalation when risk is not high", () => {
    expect(applyEscalationPolicy("overseer_escalation", "high_risk_only", "low")).toBe("review_deep");
    expect(applyEscalationPolicy("overseer_escalation", "high_risk_only", "medium")).toBe("review_deep");
    expect(applyEscalationPolicy("overseer_escalation", "high_risk_only")).toBe("review_deep");
  });

  it("defaults to high_risk_only when no policy is provided", () => {
    expect(applyEscalationPolicy("overseer_escalation", undefined, "high")).toBe("overseer_escalation");
    expect(applyEscalationPolicy("overseer_escalation", undefined, "medium")).toBe("review_deep");
    expect(applyEscalationPolicy("overseer_escalation", undefined)).toBe("review_deep");
  });
});

describe("isContextOverflowError", () => {
  it("returns true for prompt_too_long error message", () => {
    const error = new Error("Request failed: prompt_too_long");
    expect(isContextOverflowError(error)).toBe(true);
  });

  it("returns true for context_length_exceeded error message", () => {
    const error = new Error("context_length_exceeded for this model");
    expect(isContextOverflowError(error)).toBe(true);
  });

  it("returns true for maximum context length error message", () => {
    const error = new Error("maximum context length exceeded");
    expect(isContextOverflowError(error)).toBe(true);
  });

  it("returns true for context window error message", () => {
    const error = new Error("Request exceeds context window");
    expect(isContextOverflowError(error)).toBe(true);
  });

  it("returns true for too many tokens error message", () => {
    const error = new Error("too many tokens in request");
    expect(isContextOverflowError(error)).toBe(true);
  });

  it("is case insensitive", () => {
    const error = new Error("PROMPT_TOO_LONG");
    expect(isContextOverflowError(error)).toBe(true);
  });

  it("returns false for non-Error types", () => {
    expect(isContextOverflowError("string error")).toBe(false);
    expect(isContextOverflowError(null)).toBe(false);
    expect(isContextOverflowError(undefined)).toBe(false);
    expect(isContextOverflowError({ message: "prompt_too_long" })).toBe(false);
  });

  it("returns false for unrelated error messages", () => {
    const error = new Error("Network timeout");
    expect(isContextOverflowError(error)).toBe(false);
  });
});

describe("isTransientCapacityError", () => {
  it("returns true for rate_limit error message", () => {
    const error = new Error("rate_limit exceeded");
    expect(isTransientCapacityError(error)).toBe(true);
  });

  it("returns true for 429 error message", () => {
    const error = new Error("HTTP 429 Too Many Requests");
    expect(isTransientCapacityError(error)).toBe(true);
  });

  it("returns true for 529 error message", () => {
    const error = new Error("HTTP 529 service overloaded");
    expect(isTransientCapacityError(error)).toBe(true);
  });

  it("returns true for overloaded error message", () => {
    const error = new Error("Server is overloaded");
    expect(isTransientCapacityError(error)).toBe(true);
  });

  it("returns true for capacity error message", () => {
    const error = new Error("Insufficient capacity");
    expect(isTransientCapacityError(error)).toBe(true);
  });

  it("is case insensitive", () => {
    const error = new Error("RATE_LIMIT exceeded");
    expect(isTransientCapacityError(error)).toBe(true);
  });

  it("returns false for non-Error types", () => {
    expect(isTransientCapacityError("rate_limit")).toBe(false);
    expect(isTransientCapacityError(null)).toBe(false);
    expect(isTransientCapacityError(undefined)).toBe(false);
    expect(isTransientCapacityError({ message: "429" })).toBe(false);
  });

  it("returns false for unrelated error messages", () => {
    const error = new Error("Invalid API key");
    expect(isTransientCapacityError(error)).toBe(false);
  });
});

describe("isStaleConnectionError", () => {
  it("returns true for ECONNRESET error message", () => {
    const error = new Error("ECONNRESET");
    expect(isStaleConnectionError(error)).toBe(true);
  });

  it("returns true for EPIPE error message", () => {
    const error = new Error("write EPIPE");
    expect(isStaleConnectionError(error)).toBe(true);
  });

  it("returns true for socket hang up error message", () => {
    const error = new Error("socket hang up");
    expect(isStaleConnectionError(error)).toBe(true);
  });

  it("is case sensitive (matches real system errors)", () => {
    const error = new Error("econnreset");
    expect(isStaleConnectionError(error)).toBe(false);
  });

  it("returns false for non-Error types", () => {
    expect(isStaleConnectionError("ECONNRESET")).toBe(false);
    expect(isStaleConnectionError(null)).toBe(false);
    expect(isStaleConnectionError(undefined)).toBe(false);
    expect(isStaleConnectionError({ message: "EPIPE" })).toBe(false);
  });

  it("returns false for unrelated error messages", () => {
    const error = new Error("Connection timeout");
    expect(isStaleConnectionError(error)).toBe(false);
  });
});

describe("retryDelayMs", () => {
  it("returns exponential backoff for attempt 0", () => {
    const delay = retryDelayMs(0);
    expect(delay).toBeGreaterThanOrEqual(500);
    expect(delay).toBeLessThanOrEqual(1000);
  });

  it("returns exponential backoff for attempt 1", () => {
    const delay = retryDelayMs(1);
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThanOrEqual(1500);
  });

  it("returns exponential backoff for attempt 2", () => {
    const delay = retryDelayMs(2);
    expect(delay).toBeGreaterThanOrEqual(2000);
    expect(delay).toBeLessThanOrEqual(2500);
  });

  it("caps at 30000ms for large attempts", () => {
    const delay = retryDelayMs(10);
    expect(delay).toBeLessThanOrEqual(30000);
  });

  it("adds jitter to prevent thundering herd", () => {
    const delays = Array.from({ length: 10 }, () => retryDelayMs(1));
    const uniqueDelays = new Set(delays);
    expect(uniqueDelays.size).toBeGreaterThan(1);
  });

  it("formula: BASE * 2^attempt + jitter, capped at 30000", () => {
    const BASE = 500;
    for (let attempt = 0; attempt < 5; attempt++) {
      const delay = retryDelayMs(attempt);
      const minExpected = BASE * Math.pow(2, attempt);
      const maxExpected = Math.min(minExpected + BASE, 30000);
      expect(delay).toBeGreaterThanOrEqual(minExpected);
      expect(delay).toBeLessThanOrEqual(maxExpected);
    }
  });
});

describe("streamChatWithRetry", () => {
  let orchestrator: ProviderOrchestrator;
  let mockFactory: ProviderFactory;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFactory = {} as ProviderFactory;
    orchestrator = new ProviderOrchestrator(mockFactory);
  });

  describe("success cases", () => {
    it("returns result immediately on first success", async () => {
      const mockResult = {
        text: "Success",
        accountId: "acc1",
        providerId: "onprem-qwen" as const,
      };

      vi.spyOn(orchestrator, "streamChat").mockResolvedValue(mockResult);

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
      );

      expect(result).toBe(mockResult);
      expect(orchestrator.streamChat).toHaveBeenCalledTimes(1);
    });

    it("passes through all options to streamChat", async () => {
      const mockResult = {
        text: "Success",
        accountId: "acc1",
        providerId: "openai-responses" as const,
      };

      const streamChatSpy = vi.spyOn(orchestrator, "streamChat").mockResolvedValue(mockResult);
      const onToken = vi.fn();

      await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        onToken,
        {
          providerId: "openai-responses",
          modelRole: "coder_default",
          metadata: { key: "value" },
          querySource: "verification",
          maxContextTokens: 4096,
        },
      );

      expect(streamChatSpy).toHaveBeenCalledWith(
        "session1",
        [{ role: "user", content: "test" }],
        onToken,
        {
          providerId: "openai-responses",
          modelRole: "coder_default",
          metadata: { key: "value" },
          querySource: "verification",
          maxContextTokens: 4096,
        },
      );
    });
  });

  describe("context overflow handling", () => {
    it("calls emergencyCompact and retries once on context overflow", async () => {
      const messages = [{ role: "user" as const, content: "long message" }];
      const compactedMessages = [{ role: "user" as const, content: "short" }];

      mockEmergencyCompact.mockReturnValue({
        messages: compactedMessages,
        tokensBefore: 5000,
        tokensAfter: 2000,
        stage: "stage3",
      });

      const streamChatSpy = vi
        .spyOn(orchestrator, "streamChat")
        .mockRejectedValueOnce(new Error("prompt_too_long"))
        .mockResolvedValueOnce({
          text: "Success",
          accountId: "acc1",
          providerId: "onprem-qwen" as const,
        });

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        messages,
        vi.fn(),
        {
          maxContextTokens: 4096,
        },
      );

      expect(mockEmergencyCompact).toHaveBeenCalledWith(messages, 4096);
      expect(streamChatSpy).toHaveBeenCalledTimes(2);
      expect(streamChatSpy).toHaveBeenNthCalledWith(2, "session1", compactedMessages, expect.any(Function), {
        maxContextTokens: 4096,
      });
      expect(mockPublishEvent).toHaveBeenCalledWith("global", "compaction.reactive", {
        sessionId: "session1",
        tokensBefore: 5000,
        tokensAfter: 2000,
        stage: "stage3",
      });
      expect(result.text).toBe("Success");
    });

    it("throws if compaction retry also fails", async () => {
      mockEmergencyCompact.mockReturnValue({
        messages: [{ role: "user", content: "short" }],
        tokensBefore: 5000,
        tokensAfter: 2000,
        stage: "stage3",
      });

      vi.spyOn(orchestrator, "streamChat")
        .mockRejectedValueOnce(new Error("context_length_exceeded"))
        .mockRejectedValueOnce(new Error("still too long"));

      await expect(
        orchestrator.streamChatWithRetry(
          "session1",
          [{ role: "user", content: "test" }],
          vi.fn(),
          {
            maxContextTokens: 4096,
            modelRole: "coder_default",
          },
        ),
      ).rejects.toThrow(ModelInferenceError);
    });

    it("skips compaction if maxContextTokens is not provided", async () => {
      vi.spyOn(orchestrator, "streamChat").mockRejectedValue(new Error("prompt_too_long"));

      await expect(
        orchestrator.streamChatWithRetry(
          "session1",
          [{ role: "user", content: "test" }],
          vi.fn(),
        ),
      ).rejects.toThrow(ModelInferenceError);

      expect(mockEmergencyCompact).not.toHaveBeenCalled();
    });
  });

  describe("stale connection handling", () => {
    it("retries once without delay on ECONNRESET", async () => {
      vi.spyOn(orchestrator, "streamChat")
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValueOnce({
          text: "Success",
          accountId: "acc1",
          providerId: "onprem-qwen" as const,
        });

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
      );

      expect(result.text).toBe("Success");
      expect(orchestrator.streamChat).toHaveBeenCalledTimes(2);
    });

    it("retries once without delay on EPIPE", async () => {
      vi.spyOn(orchestrator, "streamChat")
        .mockRejectedValueOnce(new Error("write EPIPE"))
        .mockResolvedValueOnce({
          text: "Success",
          accountId: "acc1",
          providerId: "onprem-qwen" as const,
        });

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
      );

      expect(result.text).toBe("Success");
      expect(orchestrator.streamChat).toHaveBeenCalledTimes(2);
    });

    it("retries once without delay on socket hang up", async () => {
      vi.spyOn(orchestrator, "streamChat")
        .mockRejectedValueOnce(new Error("socket hang up"))
        .mockResolvedValueOnce({
          text: "Success",
          accountId: "acc1",
          providerId: "onprem-qwen" as const,
        });

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
      );

      expect(result.text).toBe("Success");
      expect(orchestrator.streamChat).toHaveBeenCalledTimes(2);
    });

    it("only retries stale connection once, then tries fallback", async () => {
      vi.spyOn(orchestrator, "streamChat")
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockRejectedValueOnce(new Error("ECONNRESET"));

      await expect(
        orchestrator.streamChatWithRetry(
          "session1",
          [{ role: "user", content: "test" }],
          vi.fn(),
        ),
      ).rejects.toThrow(ModelInferenceError);

      // Initial call + 1 stale retry + fallback to overseer_escalation
      expect(orchestrator.streamChat).toHaveBeenCalledTimes(3);
    });
  });

  describe("transient capacity handling - foreground sources", () => {
    it("retries with backoff for execution source on rate_limit", async () => {
      vi.spyOn(orchestrator, "streamChat")
        .mockRejectedValueOnce(new Error("rate_limit exceeded"))
        .mockResolvedValueOnce({
          text: "Success",
          accountId: "acc1",
          providerId: "onprem-qwen" as const,
        });

      const start = Date.now();
      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        { querySource: "execution" },
      );

      const elapsed = Date.now() - start;
      expect(result.text).toBe("Success");
      expect(elapsed).toBeGreaterThanOrEqual(500);
    });

    it("retries with backoff for verification source on 429", async () => {
      vi.spyOn(orchestrator, "streamChat")
        .mockRejectedValueOnce(new Error("HTTP 429"))
        .mockResolvedValueOnce({
          text: "Success",
          accountId: "acc1",
          providerId: "onprem-qwen" as const,
        });

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        { querySource: "verification" },
      );

      expect(result.text).toBe("Success");
    });

    it("retries with backoff for context_building source on overloaded", async () => {
      vi.spyOn(orchestrator, "streamChat")
        .mockRejectedValueOnce(new Error("Server overloaded"))
        .mockResolvedValueOnce({
          text: "Success",
          accountId: "acc1",
          providerId: "onprem-qwen" as const,
        });

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        { querySource: "context_building" },
      );

      expect(result.text).toBe("Success");
    });

    it("retries up to MAX_RETRIES (3) times for capacity errors", async () => {
      vi.spyOn(orchestrator, "streamChat")
        .mockRejectedValueOnce(new Error("rate_limit"))
        .mockRejectedValueOnce(new Error("rate_limit"))
        .mockRejectedValueOnce(new Error("rate_limit"))
        .mockResolvedValueOnce({
          text: "Success",
          accountId: "acc1",
          providerId: "onprem-qwen" as const,
        });

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        { querySource: "execution" },
      );

      expect(result.text).toBe("Success");
      expect(orchestrator.streamChat).toHaveBeenCalledTimes(4);
    });
  });

  describe("transient capacity handling - background sources", () => {
    it("does not retry for reporting source on capacity error but tries fallback", async () => {
      vi.spyOn(orchestrator, "streamChat").mockRejectedValue(new Error("rate_limit exceeded"));

      await expect(
        orchestrator.streamChatWithRetry(
          "session1",
          [{ role: "user", content: "test" }],
          vi.fn(),
          { querySource: "reporting" },
        ),
      ).rejects.toThrow(ModelInferenceError);

      // Initial call + fallback to overseer_escalation (no retries for background)
      expect(orchestrator.streamChat).toHaveBeenCalledTimes(2);
    });

    it("does not retry for reporting source on 429 but tries fallback", async () => {
      vi.spyOn(orchestrator, "streamChat").mockRejectedValue(new Error("HTTP 429"));

      await expect(
        orchestrator.streamChatWithRetry(
          "session1",
          [{ role: "user", content: "test" }],
          vi.fn(),
          { querySource: "reporting" },
        ),
      ).rejects.toThrow(ModelInferenceError);

      // Initial call + fallback to overseer_escalation (no retries for background)
      expect(orchestrator.streamChat).toHaveBeenCalledTimes(2);
    });

    it("skips retry and fallback if already using overseer_escalation", async () => {
      vi.spyOn(orchestrator, "streamChat").mockRejectedValue(new Error("rate_limit exceeded"));

      await expect(
        orchestrator.streamChatWithRetry(
          "session1",
          [{ role: "user", content: "test" }],
          vi.fn(),
          { querySource: "reporting", modelRole: "overseer_escalation" },
        ),
      ).rejects.toThrow(ModelInferenceError);

      // Only initial call, no retry or fallback since already on overseer_escalation
      expect(orchestrator.streamChat).toHaveBeenCalledTimes(1);
    });
  });

  describe("overseer_escalation fallback", () => {
    it("falls back through model chain then overseer_escalation after MAX_RETRIES", async () => {
      vi.spyOn(orchestrator, "streamChat")
        .mockRejectedValueOnce(new Error("rate_limit"))
        .mockRejectedValueOnce(new Error("rate_limit"))
        .mockRejectedValueOnce(new Error("rate_limit"))
        .mockRejectedValueOnce(new Error("rate_limit"))
        // model fallback to utility_fast succeeds
        .mockResolvedValueOnce({
          text: "Fallback success",
          accountId: "acc1",
          providerId: "onprem-qwen" as const,
        });

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        { querySource: "execution", modelRole: "coder_default" },
      );

      expect(result.text).toBe("Fallback success");
      // Model fallback chain fires before overseer_escalation
      expect(mockPublishEvent).toHaveBeenCalledWith("global", "provider.model_fallback", {
        sessionId: "session1",
        originalRole: "coder_default",
        fallbackRole: "utility_fast",
        reason: expect.stringContaining("rate_limit"),
      });
    });

    it("falls back to overseer_escalation when model chain also fails", async () => {
      vi.spyOn(orchestrator, "streamChat")
        .mockRejectedValueOnce(new Error("rate_limit"))
        .mockRejectedValueOnce(new Error("rate_limit"))
        .mockRejectedValueOnce(new Error("rate_limit"))
        .mockRejectedValueOnce(new Error("rate_limit"))
        // model fallback (utility_fast) also fails
        .mockRejectedValueOnce(new Error("rate_limit"))
        // overseer_escalation succeeds
        .mockResolvedValueOnce({
          text: "Overseer success",
          accountId: "acc1",
          providerId: "openai-responses" as const,
        });

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        { querySource: "execution", modelRole: "coder_default" },
      );

      expect(result.text).toBe("Overseer success");
      expect(mockPublishEvent).toHaveBeenCalledWith("global", "provider.fallback", {
        sessionId: "session1",
        originalRole: "coder_default",
        reason: expect.stringContaining("rate_limit"),
      });
    });

    it("skips fallback if already using overseer_escalation", async () => {
      vi.spyOn(orchestrator, "streamChat").mockRejectedValue(new Error("rate_limit"));

      await expect(
        orchestrator.streamChatWithRetry(
          "session1",
          [{ role: "user", content: "test" }],
          vi.fn(),
          { querySource: "execution", modelRole: "overseer_escalation" },
        ),
      ).rejects.toThrow(ModelInferenceError);

      expect(orchestrator.streamChat).toHaveBeenCalledTimes(4);
      expect(mockPublishEvent).not.toHaveBeenCalledWith("global", "provider.fallback", expect.anything());
    });

    it("throws ModelInferenceError if all fallbacks fail", async () => {
      vi.spyOn(orchestrator, "streamChat").mockRejectedValue(new Error("rate_limit"));

      await expect(
        orchestrator.streamChatWithRetry(
          "session1",
          [{ role: "user", content: "test" }],
          vi.fn(),
          { querySource: "execution", modelRole: "coder_default" },
        ),
      ).rejects.toThrow(ModelInferenceError);

      // 4 retries + 1 model fallback (utility_fast) + 1 overseer_escalation = 6
      expect(orchestrator.streamChat).toHaveBeenCalledTimes(6);
    });

    it("includes providerId and modelRole in ModelInferenceError", async () => {
      vi.spyOn(orchestrator, "streamChat").mockRejectedValue(new Error("Something went wrong"));

      try {
        await orchestrator.streamChatWithRetry(
          "session1",
          [{ role: "user", content: "test" }],
          vi.fn(),
          {
            providerId: "onprem-qwen",
            modelRole: "coder_default",
            querySource: "execution",
          },
        );
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ModelInferenceError);
        const inferenceError = error as ModelInferenceError;
        expect(inferenceError.providerId).toBe("onprem-qwen");
        expect(inferenceError.modelRole).toBe("coder_default");
        expect(inferenceError.message).toContain("Inference failed after retries");
      }
    });
  });

  describe("non-retriable errors", () => {
    it("breaks immediately on non-retriable error but tries fallback", async () => {
      vi.spyOn(orchestrator, "streamChat").mockRejectedValue(new Error("Invalid API key"));

      await expect(
        orchestrator.streamChatWithRetry(
          "session1",
          [{ role: "user", content: "test" }],
          vi.fn(),
        ),
      ).rejects.toThrow(ModelInferenceError);

      // Initial call + fallback to overseer_escalation
      expect(orchestrator.streamChat).toHaveBeenCalledTimes(2);
    });

    it("breaks immediately on auth error but tries fallback", async () => {
      vi.spyOn(orchestrator, "streamChat").mockRejectedValue(new Error("Authentication failed"));

      await expect(
        orchestrator.streamChatWithRetry(
          "session1",
          [{ role: "user", content: "test" }],
          vi.fn(),
        ),
      ).rejects.toThrow(ModelInferenceError);

      // Initial call + fallback to overseer_escalation
      expect(orchestrator.streamChat).toHaveBeenCalledTimes(2);
    });

    it("skips fallback if already using overseer_escalation", async () => {
      vi.spyOn(orchestrator, "streamChat").mockRejectedValue(new Error("Invalid API key"));

      await expect(
        orchestrator.streamChatWithRetry(
          "session1",
          [{ role: "user", content: "test" }],
          vi.fn(),
          { modelRole: "overseer_escalation" },
        ),
      ).rejects.toThrow(ModelInferenceError);

      // Only initial call, no fallback since already on overseer_escalation
      expect(orchestrator.streamChat).toHaveBeenCalledTimes(1);
    });
  });

  describe("default querySource", () => {
    it("defaults to execution source when not provided", async () => {
      vi.spyOn(orchestrator, "streamChat")
        .mockRejectedValueOnce(new Error("rate_limit"))
        .mockResolvedValueOnce({
          text: "Success",
          accountId: "acc1",
          providerId: "onprem-qwen" as const,
        });

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
      );

      expect(result.text).toBe("Success");
      expect(orchestrator.streamChat).toHaveBeenCalledTimes(2);
    });
  });

  describe("stale keepalive flag lifecycle", () => {
    it("clears disableKeepAlive flag after STALE_KEEPALIVE_CLEAR_MS timeout", async () => {
      vi.useFakeTimers();
      const mockAdapter = {
        disableKeepAlive: false,
        stream: vi.fn(),
        send: vi.fn(),
        classifyError: vi.fn(),
        estimateAvailability: vi.fn(),
      };
      mockFactory.resolve = vi.fn().mockReturnValue(mockAdapter);

      vi.spyOn(orchestrator, "streamChat")
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValueOnce({
          text: "Recovered",
          accountId: "acc1",
          providerId: "onprem-qwen" as const,
        });

      await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        { providerId: "onprem-qwen" },
      );

      // Flag should be set after ECONNRESET
      expect(mockAdapter.disableKeepAlive).toBe(true);

      // Advance past the clear timeout (60 seconds)
      vi.advanceTimersByTime(60_001);

      expect(mockAdapter.disableKeepAlive).toBe(false);
      vi.useRealTimers();
    });
  });

  describe("context overflow 400 handling", () => {
    it("shrinks maxContextTokens by 20% and retries on overflow 400 error", async () => {
      const streamChatSpy = vi
        .spyOn(orchestrator, "streamChat")
        .mockRejectedValueOnce(new Error("400 bad request: max_tokens exceeded"))
        .mockResolvedValueOnce({
          text: "Success after shrink",
          accountId: "acc1",
          providerId: "onprem-qwen" as const,
        });

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        { maxContextTokens: 10000 },
      );

      expect(result.text).toBe("Success after shrink");
      // Second call should have reduced maxContextTokens (10000 * 0.8 = 8000)
      expect(streamChatSpy).toHaveBeenCalledTimes(2);
      expect(mockPublishEvent).toHaveBeenCalledWith(
        "global",
        "provider.context_overflow_recovery",
        expect.objectContaining({
          originalLimit: 10000,
          reducedLimit: 8000,
        }),
      );
    });

    it("does not shrink below CONTEXT_OVERFLOW_FLOOR (3000)", async () => {
      vi.spyOn(orchestrator, "streamChat")
        .mockRejectedValueOnce(new Error("400 context too long"))
        .mockResolvedValueOnce({
          text: "Floored",
          accountId: "acc1",
          providerId: "onprem-qwen" as const,
        });

      await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        { maxContextTokens: 3500 },
      );

      expect(mockPublishEvent).toHaveBeenCalledWith(
        "global",
        "provider.context_overflow_recovery",
        expect.objectContaining({
          reducedLimit: 3000,
        }),
      );
    });

    it("only retries overflow 400 once", async () => {
      vi.spyOn(orchestrator, "streamChat")
        .mockRejectedValueOnce(new Error("400 bad request: max_tokens exceeded"))
        .mockRejectedValueOnce(new Error("400 bad request: context too long"))
        .mockRejectedValueOnce(new Error("fallback"));

      await expect(
        orchestrator.streamChatWithRetry(
          "session1",
          [{ role: "user", content: "test" }],
          vi.fn(),
          { maxContextTokens: 10000 },
        ),
      ).rejects.toThrow(ModelInferenceError);
    });
  });

  describe("streaming fallback via streamChatWithRetryStreaming", () => {
    it("falls back to non-streaming send on stream error in streamChatWithRetryStreaming", async () => {
      const mockTelemetry = { incrementCounter: vi.fn(), recordMetric: vi.fn() };
      mockGetTelemetry.mockReturnValue(mockTelemetry);

      const mockAdapter = {
        id: "onprem-qwen" as const,
        label: "On-Prem Qwen",
        supportsStreaming: true,
        supportsTools: true,
        capabilities: {},
        stream: vi.fn().mockImplementation(async function* () {
          throw new Error("ECONNRESET");
        }),
        send: vi.fn().mockResolvedValue({
          text: "Non-streaming fallback result",
          session: { provider: "onprem-qwen" },
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        }),
        classifyError: vi.fn().mockReturnValue("unknown"),
        estimateAvailability: vi.fn(),
      };
      mockFactory.resolve = vi.fn().mockReturnValue(mockAdapter);

      // Mock getActiveProvider via the internal method
      vi.spyOn(orchestrator, "getModelRoleBinding" as any).mockResolvedValue(null);
      vi.spyOn(orchestrator, "getActiveProvider" as any).mockResolvedValue("onprem-qwen");

      const onToken = vi.fn();
      const events: any[] = [];

      for await (const event of orchestrator.streamChatWithRetryStreaming(
        "run1",
        [{ role: "user", content: "test" }],
        onToken,
        {},
      )) {
        events.push(event);
      }

      expect(mockAdapter.send).toHaveBeenCalled();
      expect(onToken).toHaveBeenCalledWith("Non-streaming fallback result");
      expect(events.some((e) => e.type === "token" && e.value === "Non-streaming fallback result")).toBe(true);
      expect(events.some((e) => e.type === "done")).toBe(true);
      expect(mockTelemetry.incrementCounter).toHaveBeenCalledWith("provider.streaming_fallback.count");
      expect(mockPublishEvent).toHaveBeenCalledWith(
        "global",
        "provider.streaming_fallback",
        expect.objectContaining({ runId: "run1" }),
      );
    });

    it("triggers emergency compaction on context overflow during streaming", async () => {
      const compactedMessages = [{ role: "user" as const, content: "compacted" }];
      mockEmergencyCompact.mockReturnValue({
        messages: compactedMessages,
        tokensBefore: 8000,
        tokensAfter: 3000,
        stage: "stage4",
      });

      // Use the non-streaming path since streamChatWithRetryStreaming delegates
      // overflow handling to streamChatWithRetry when called through orchestrator
      vi.spyOn(orchestrator, "streamChat")
        .mockRejectedValueOnce(new Error("context_length_exceeded"))
        .mockResolvedValueOnce({
          text: "Compacted success",
          accountId: "acc1",
          providerId: "onprem-qwen" as const,
        });

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "long context" }],
        vi.fn(),
        { maxContextTokens: 8000, modelRole: "coder_default" },
      );

      expect(mockEmergencyCompact).toHaveBeenCalled();
      expect(result.text).toBe("Compacted success");
      expect(mockPublishEvent).toHaveBeenCalledWith(
        "global",
        "compaction.reactive",
        expect.objectContaining({ stage: "stage4" }),
      );
    });
  });

  describe("concurrent retry isolation", () => {
    it("handles concurrent retry attempts without interference", async () => {
      let callCount = 0;
      vi.spyOn(orchestrator, "streamChat").mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          throw new Error("rate_limit");
        }
        return {
          text: `Result-${callCount}`,
          accountId: "acc1",
          providerId: "onprem-qwen" as const,
        };
      });

      const [result1, result2] = await Promise.all([
        orchestrator.streamChatWithRetry(
          "session-a",
          [{ role: "user", content: "test A" }],
          vi.fn(),
          { querySource: "execution" },
        ),
        orchestrator.streamChatWithRetry(
          "session-b",
          [{ role: "user", content: "test B" }],
          vi.fn(),
          { querySource: "execution" },
        ),
      ]);

      // Both should eventually succeed (exact text depends on scheduling)
      expect(result1.text).toBeDefined();
      expect(result2.text).toBeDefined();
    });
  });

  describe("full model fallback chain", () => {
    it("falls back through full model chain: review_deep -> coder_default -> utility_fast", async () => {
      const streamChatSpy = vi
        .spyOn(orchestrator, "streamChat")
        // Initial attempt + MAX_RETRIES for review_deep
        .mockRejectedValueOnce(new Error("rate_limit"))
        .mockRejectedValueOnce(new Error("rate_limit"))
        .mockRejectedValueOnce(new Error("rate_limit"))
        .mockRejectedValueOnce(new Error("rate_limit"))
        // Fallback to coder_default (via FALLBACK_CHAIN from review_deep) succeeds
        .mockResolvedValueOnce({
          text: "Coder fallback success",
          accountId: "acc1",
          providerId: "onprem-qwen" as const,
        });

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        { querySource: "execution", modelRole: "review_deep" },
      );

      expect(result.text).toBe("Coder fallback success");
      expect(mockPublishEvent).toHaveBeenCalledWith("global", "provider.model_fallback", {
        sessionId: "session1",
        originalRole: "review_deep",
        fallbackRole: "coder_default",
        reason: expect.stringContaining("rate_limit"),
      });
    });

    it("escalates to overseer after exhausting fallback chain", async () => {
      vi.spyOn(orchestrator, "streamChat")
        // review_deep: 4 attempts (initial + 3 retries)
        .mockRejectedValueOnce(new Error("rate_limit"))
        .mockRejectedValueOnce(new Error("rate_limit"))
        .mockRejectedValueOnce(new Error("rate_limit"))
        .mockRejectedValueOnce(new Error("rate_limit"))
        // coder_default fallback fails
        .mockRejectedValueOnce(new Error("rate_limit"))
        // overseer_escalation succeeds
        .mockResolvedValueOnce({
          text: "Overseer handled it",
          accountId: "acc1",
          providerId: "openai-responses" as const,
        });

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        { querySource: "execution", modelRole: "review_deep" },
      );

      expect(result.text).toBe("Overseer handled it");
      // Should have attempted model_fallback and then provider.fallback
      expect(mockPublishEvent).toHaveBeenCalledWith(
        "global",
        "provider.model_fallback",
        expect.objectContaining({
          originalRole: "review_deep",
          fallbackRole: "coder_default",
        }),
      );
      expect(mockPublishEvent).toHaveBeenCalledWith(
        "global",
        "provider.fallback",
        expect.objectContaining({
          originalRole: "review_deep",
        }),
      );
    });

    it("utility_fast has no further fallback in the chain — goes straight to overseer", async () => {
      vi.spyOn(orchestrator, "streamChat")
        // utility_fast exhausts retries
        .mockRejectedValueOnce(new Error("rate_limit"))
        .mockRejectedValueOnce(new Error("rate_limit"))
        .mockRejectedValueOnce(new Error("rate_limit"))
        .mockRejectedValueOnce(new Error("rate_limit"))
        // No FALLBACK_CHAIN entry for utility_fast, so goes to overseer
        .mockResolvedValueOnce({
          text: "Overseer from utility",
          accountId: "acc1",
          providerId: "openai-responses" as const,
        });

      const result = await orchestrator.streamChatWithRetry(
        "session1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        { querySource: "execution", modelRole: "utility_fast" },
      );

      expect(result.text).toBe("Overseer from utility");
      // Should NOT have a model_fallback event since utility_fast has no chain entry
      expect(mockPublishEvent).not.toHaveBeenCalledWith(
        "global",
        "provider.model_fallback",
        expect.anything(),
      );
      expect(mockPublishEvent).toHaveBeenCalledWith(
        "global",
        "provider.fallback",
        expect.objectContaining({
          originalRole: "utility_fast",
        }),
      );
    });
  });
});

describe("isContextOverflow400Error", () => {
  it("returns true for 400 with max_tokens", () => {
    expect(isContextOverflow400Error(new Error("400 bad request: max_tokens exceeded"))).toBe(true);
  });

  it("returns true for bad request with context", () => {
    expect(isContextOverflow400Error(new Error("Bad Request: context too long"))).toBe(true);
  });

  it("returns true for invalid with too long", () => {
    expect(isContextOverflow400Error(new Error("Invalid request: input too long"))).toBe(true);
  });

  it("returns false for plain 400 without context keywords", () => {
    expect(isContextOverflow400Error(new Error("400 missing parameter"))).toBe(false);
  });

  it("returns false for non-Error types", () => {
    expect(isContextOverflow400Error("400 max_tokens")).toBe(false);
    expect(isContextOverflow400Error(null)).toBe(false);
  });
});

describe("isStreamingRecoverableError", () => {
  it("returns true for ECONNRESET", () => {
    expect(isStreamingRecoverableError(new Error("ECONNRESET"))).toBe(true);
  });

  it("returns true for ECONNREFUSED", () => {
    expect(isStreamingRecoverableError(new Error("ECONNREFUSED"))).toBe(true);
  });

  it("returns true for ETIMEDOUT", () => {
    expect(isStreamingRecoverableError(new Error("ETIMEDOUT"))).toBe(true);
  });

  it("returns true for ERR_STREAM_PREMATURE_CLOSE", () => {
    expect(isStreamingRecoverableError(new Error("ERR_STREAM_PREMATURE_CLOSE"))).toBe(true);
  });

  it("returns true for generic stream error", () => {
    expect(isStreamingRecoverableError(new Error("stream error during read"))).toBe(true);
  });

  it("returns false for auth errors", () => {
    expect(isStreamingRecoverableError(new Error("401 Unauthorized"))).toBe(false);
  });

  it("returns false for non-Error types", () => {
    expect(isStreamingRecoverableError("ECONNRESET")).toBe(false);
    expect(isStreamingRecoverableError(null)).toBe(false);
  });
});

describe("applyEscalationPolicy edge cases", () => {
  it("applies escalation policy with low risk under high_risk_only — blocks", () => {
    expect(applyEscalationPolicy("overseer_escalation", "high_risk_only", "low")).toBe("review_deep");
  });

  it("applies escalation policy with medium risk under high_risk_only — blocks", () => {
    expect(applyEscalationPolicy("overseer_escalation", "high_risk_only", "medium")).toBe("review_deep");
  });

  it("applies escalation policy with high risk under auto — allows", () => {
    expect(applyEscalationPolicy("overseer_escalation", "auto", "high")).toBe("overseer_escalation");
  });

  it("applies escalation policy with low risk under auto — allows (auto permits all)", () => {
    expect(applyEscalationPolicy("overseer_escalation", "auto", "low")).toBe("overseer_escalation");
  });
});

// ---------------------------------------------------------------------------
// Mock prisma for database-backed method tests
// ---------------------------------------------------------------------------
const mockPrisma = vi.hoisted(() => ({
  appSetting: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  auditEvent: {
    create: vi.fn(),
  },
  providerAccount: {
    count: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  providerAccountEvent: {
    create: vi.fn(),
    createMany: vi.fn(),
  },
  providerUsageSample: {
    create: vi.fn(),
  },
  providerBudgetProjection: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock("../db", () => ({
  prisma: mockPrisma,
}));

vi.mock("./quotaEstimator", () => ({
  estimateNextUsableAt: vi.fn().mockResolvedValue({
    nextUsableAt: new Date("2026-01-01T01:00:00Z"),
    confidence: 0.8,
  }),
}));

vi.mock("./promptCacheBreakDetector", () => ({
  createDetectorState: vi.fn(() => ({
    baselineCacheReadTokens: 0,
    observations: [],
    compactionJustOccurred: false,
  })),
  recordObservation: vi.fn(),
  detectBreak: vi.fn(),
  resetBaseline: vi.fn(),
  markCompaction: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Tests for database-backed methods
// ---------------------------------------------------------------------------

describe("ProviderOrchestrator — database-backed methods", () => {
  let orchestrator: ProviderOrchestrator;
  let factory: ProviderFactory;

  const makeAdapter = (overrides: Partial<any> = {}) => ({
    id: "onprem-qwen" as const,
    label: "On-Prem Qwen",
    supportsStreaming: true,
    supportsTools: false,
    capabilities: { jsonMode: true },
    createSession: vi.fn(),
    send: vi.fn(),
    stream: vi.fn(),
    classifyError: vi.fn().mockReturnValue("unknown"),
    estimateAvailability: vi.fn(),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    factory = new ProviderFactory();
    orchestrator = new ProviderOrchestrator(factory);
  });

  // -----------------------------------------------------------------------
  // getProviderAdapter
  // -----------------------------------------------------------------------
  describe("getProviderAdapter", () => {
    it("delegates to factory.resolve and returns the adapter", () => {
      const adapter = makeAdapter();
      factory.register(adapter as any);
      expect(orchestrator.getProviderAdapter("onprem-qwen")).toBe(adapter);
    });

    it("throws when the provider is not registered", () => {
      expect(() => orchestrator.getProviderAdapter("nonexistent" as any)).toThrow(
        "Provider 'nonexistent' is not registered",
      );
    });
  });

  // -----------------------------------------------------------------------
  // checkProviderHealth
  // -----------------------------------------------------------------------
  describe("checkProviderHealth", () => {
    it("returns ok:true for qwen-cli when an enabled account exists", async () => {
      mockPrisma.providerAccount.count.mockResolvedValue(1);
      const result = await orchestrator.checkProviderHealth("qwen-cli");
      expect(result.ok).toBe(true);
      expect(result.reason).toBe("provider health check passed");
    });

    it("returns ok:false for qwen-cli when no enabled account exists", async () => {
      mockPrisma.providerAccount.count.mockResolvedValue(0);
      const result = await orchestrator.checkProviderHealth("qwen-cli");
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("No enabled Qwen CLI account");
    });

    it("returns ok:true for non-qwen-cli provider when adapter reports ready", async () => {
      const adapter = makeAdapter({
        id: "onprem-qwen",
        estimateAvailability: vi.fn().mockResolvedValue({ state: "ready" }),
      });
      factory.register(adapter as any);
      const result = await orchestrator.checkProviderHealth("onprem-qwen");
      expect(result.ok).toBe(true);
    });

    it("returns ok:false for non-qwen-cli provider when adapter reports non-ready state", async () => {
      const adapter = makeAdapter({
        id: "onprem-qwen",
        estimateAvailability: vi.fn().mockResolvedValue({ state: "cooldown" }),
      });
      factory.register(adapter as any);
      const result = await orchestrator.checkProviderHealth("onprem-qwen");
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("cooldown");
    });
  });

  // -----------------------------------------------------------------------
  // listProviders
  // -----------------------------------------------------------------------
  describe("listProviders", () => {
    it("returns activeProvider and mapped provider descriptors", async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValue({ key: "active_provider", value: "onprem-qwen" });
      const adapter1 = makeAdapter({ id: "onprem-qwen", label: "On-Prem" });
      const adapter2 = makeAdapter({
        id: "openai-responses",
        label: "OpenAI Responses",
        supportsTools: true,
        capabilities: {},
      });
      factory.register(adapter1 as any);
      factory.register(adapter2 as any);

      const result = await orchestrator.listProviders();
      expect(result.activeProvider).toBe("onprem-qwen");
      expect(result.providers).toHaveLength(2);
      expect(result.providers[0].id).toBe("onprem-qwen");
      expect(result.providers[0].kind).toBe("local");
      expect(result.providers[1].id).toBe("openai-responses");
      expect(result.providers[1].kind).toBe("cloud");
    });
  });

  // -----------------------------------------------------------------------
  // getActiveProvider / setActiveProvider
  // -----------------------------------------------------------------------
  describe("getActiveProvider", () => {
    it("returns the stored active provider", async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValue({ key: "active_provider", value: "openai-responses" });
      const result = await orchestrator.getActiveProvider();
      expect(result).toBe("openai-responses");
    });

    it("defaults to onprem-qwen when no setting is stored", async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValue(null);
      const result = await orchestrator.getActiveProvider();
      expect(result).toBe("onprem-qwen");
    });

    it("defaults to onprem-qwen when stored value is not a string", async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValue({ key: "active_provider", value: 123 });
      const result = await orchestrator.getActiveProvider();
      expect(result).toBe("onprem-qwen");
    });
  });

  describe("setActiveProvider", () => {
    it("upserts the active_provider setting and creates an audit event", async () => {
      const adapter = makeAdapter({ id: "onprem-qwen" });
      factory.register(adapter as any);
      mockPrisma.appSetting.upsert.mockResolvedValue({});
      mockPrisma.auditEvent.create.mockResolvedValue({});

      await orchestrator.setActiveProvider("onprem-qwen");

      expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "active_provider" },
          update: { value: "onprem-qwen" },
          create: { key: "active_provider", value: "onprem-qwen" },
        }),
      );
      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actor: "user",
            eventType: "provider.switched",
            payload: { providerId: "onprem-qwen" },
          }),
        }),
      );
    });

    it("throws if the provider is not registered", async () => {
      await expect(orchestrator.setActiveProvider("nonexistent" as any)).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // getModelRoleBindings / getModelRoleBinding
  // -----------------------------------------------------------------------
  describe("getModelRoleBindings", () => {
    it("returns default bindings when no DB override exists", async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValue(null);
      const bindings = await orchestrator.getModelRoleBindings();
      expect(bindings.utility_fast.model).toBe("Qwen/Qwen3.5-0.8B");
      expect(bindings.coder_default.model).toBe("mlx-community/Qwen3.5-4B-4bit");
      expect(bindings.review_deep.reasoningMode).toBe("on");
      expect(bindings.overseer_escalation.providerId).toBe("openai-responses");
    });

    it("merges DB overrides for individual roles", async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValue({
        key: "model_role_bindings",
        value: {
          utility_fast: {
            role: "utility_fast",
            providerId: "onprem-qwen",
            pluginId: "custom",
            model: "CustomModel",
            temperature: 0.2,
            maxTokens: 500,
            reasoningMode: "off",
          },
        },
      });
      const bindings = await orchestrator.getModelRoleBindings();
      expect(bindings.utility_fast.model).toBe("CustomModel");
      // Other roles remain default
      expect(bindings.coder_default.model).toBe("mlx-community/Qwen3.5-4B-4bit");
    });
  });

  describe("getModelRoleBinding", () => {
    it("returns the binding for a specific role", async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValue(null);
      const binding = await orchestrator.getModelRoleBinding("review_deep");
      expect(binding.role).toBe("review_deep");
      expect(binding.reasoningMode).toBe("on");
    });
  });

  // -----------------------------------------------------------------------
  // Qwen account management
  // -----------------------------------------------------------------------
  describe("listQwenAccounts", () => {
    it("refreshes cooldown accounts and returns sorted list", async () => {
      mockPrisma.providerAccount.updateMany.mockResolvedValue({ count: 1 });
      const accounts = [
        { id: "a1", label: "Account 1", state: "ready", enabled: true },
        { id: "a2", label: "Account 2", state: "cooldown", enabled: true },
      ];
      mockPrisma.providerAccount.findMany.mockResolvedValue(accounts);

      const result = await orchestrator.listQwenAccounts();
      expect(mockPrisma.providerAccount.updateMany).toHaveBeenCalled();
      expect(result).toEqual(accounts);
    });
  });

  describe("createQwenAccount", () => {
    it("creates an account and logs an event", async () => {
      const account = { id: "new-1", providerId: "qwen-cli", label: "New", profilePath: "/p" };
      mockPrisma.providerAccount.create.mockResolvedValue(account);
      mockPrisma.providerAccountEvent.create.mockResolvedValue({});

      const result = await orchestrator.createQwenAccount({ label: "New", profilePath: "/p" });
      expect(result).toEqual(account);
      expect(mockPrisma.providerAccountEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: "account.created" }),
        }),
      );
    });

    it("passes keychainRef when provided", async () => {
      const account = { id: "kc-1", providerId: "qwen-cli", label: "KC", profilePath: "/p", keychainRef: "ref" };
      mockPrisma.providerAccount.create.mockResolvedValue(account);
      mockPrisma.providerAccountEvent.create.mockResolvedValue({});

      await orchestrator.createQwenAccount({ label: "KC", profilePath: "/p", keychainRef: "ref" });
      expect(mockPrisma.providerAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ keychainRef: "ref" }),
        }),
      );
    });
  });

  describe("updateQwenAccount", () => {
    it("updates an account and logs an event", async () => {
      const account = { id: "u1", label: "Updated" };
      mockPrisma.providerAccount.update.mockResolvedValue(account);
      mockPrisma.providerAccountEvent.create.mockResolvedValue({});

      const result = await orchestrator.updateQwenAccount("u1", { label: "Updated" });
      expect(result).toEqual(account);
      expect(mockPrisma.providerAccountEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: "account.updated" }),
        }),
      );
    });

    it("sets state to disabled when enabled is false", async () => {
      const account = { id: "u2", state: "disabled", enabled: false };
      mockPrisma.providerAccount.update.mockResolvedValue(account);
      mockPrisma.providerAccountEvent.create.mockResolvedValue({});

      await orchestrator.updateQwenAccount("u2", { enabled: false });
      expect(mockPrisma.providerAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ state: "disabled" }),
        }),
      );
    });

    it("preserves explicit state when enabled is not false", async () => {
      const account = { id: "u3", state: "cooldown" };
      mockPrisma.providerAccount.update.mockResolvedValue(account);
      mockPrisma.providerAccountEvent.create.mockResolvedValue({});

      await orchestrator.updateQwenAccount("u3", { state: "cooldown" });
      expect(mockPrisma.providerAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ state: "cooldown" }),
        }),
      );
    });
  });

  describe("markQwenAccountReauthed", () => {
    it("resets account to ready state, logs event, and publishes recovery", async () => {
      const account = { id: "r1" };
      mockPrisma.providerAccount.update.mockResolvedValue(account);
      mockPrisma.providerAccountEvent.create.mockResolvedValue({});

      const result = await orchestrator.markQwenAccountReauthed("r1");
      expect(result).toEqual(account);
      expect(mockPrisma.providerAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ state: "ready", enabled: true, cooldownUntil: null }),
        }),
      );
      expect(mockPrisma.providerAccountEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: "account.reauthed" }),
        }),
      );
      expect(mockPublishEvent).toHaveBeenCalledWith("global", "account.recovered", {
        accountId: "r1",
        reason: "manual_reauth",
      });
    });
  });

  // -----------------------------------------------------------------------
  // getQwenQuotaOverview
  // -----------------------------------------------------------------------
  describe("getQwenQuotaOverview", () => {
    it("maps account fields to quota overview objects", async () => {
      mockPrisma.providerAccount.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.providerAccount.findMany.mockResolvedValue([
        {
          id: "a1",
          label: "Acct1",
          state: "ready",
          enabled: true,
          cooldownUntil: new Date("2026-01-01T00:00:00Z"),
          quotaNextUsableAt: new Date("2026-01-01T01:00:00Z"),
          quotaEtaConfidence: 0.9,
          lastQuotaErrorAt: new Date("2025-12-31T23:50:00Z"),
          lastUsedAt: new Date("2025-12-31T23:55:00Z"),
        },
      ]);

      const overview = await orchestrator.getQwenQuotaOverview();
      expect(overview).toHaveLength(1);
      expect(overview[0].id).toBe("a1");
      expect(overview[0].state).toBe("ready");
      expect(overview[0].cooldownUntil).toBe("2026-01-01T00:00:00.000Z");
      expect(overview[0].quotaNextUsableAt).toBe("2026-01-01T01:00:00.000Z");
      expect(overview[0].quotaEtaConfidence).toBe(0.9);
    });

    it("shows disabled state when account is not enabled", async () => {
      mockPrisma.providerAccount.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.providerAccount.findMany.mockResolvedValue([
        {
          id: "a2",
          label: "Disabled",
          state: "ready",
          enabled: false,
          cooldownUntil: null,
          quotaNextUsableAt: null,
          quotaEtaConfidence: null,
          lastQuotaErrorAt: null,
          lastUsedAt: null,
        },
      ]);

      const overview = await orchestrator.getQwenQuotaOverview();
      expect(overview[0].state).toBe("disabled");
      expect(overview[0].cooldownUntil).toBeNull();
      expect(overview[0].quotaNextUsableAt).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // ensureOpenAiBudget (via streamChat for non-qwen-cli)
  // -----------------------------------------------------------------------
  describe("ensureOpenAiBudget — tested through streamChat", () => {
    it("does nothing when providerId is not openai-responses", async () => {
      const adapter = makeAdapter({
        id: "onprem-qwen",
        stream: vi.fn(async function* () {
          yield { type: "token", value: "hello" };
          yield { type: "done", usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } };
        }),
      });
      factory.register(adapter as any);
      mockPrisma.appSetting.findUnique.mockResolvedValue({ key: "active_provider", value: "onprem-qwen" });

      const result = await orchestrator.streamChat(
        "s1",
        [{ role: "user", content: "hi" }],
        vi.fn(),
      );
      expect(result.text).toBe("hello");
      // Should NOT have checked budget projection
      expect(mockPrisma.providerBudgetProjection.findFirst).not.toHaveBeenCalled();
    });

    it("throws when openai-responses budget is in cooldown", async () => {
      const adapter = makeAdapter({ id: "openai-responses" });
      factory.register(adapter as any);
      mockPrisma.appSetting.findUnique.mockResolvedValue(null);
      mockPrisma.providerBudgetProjection.findFirst.mockResolvedValue({
        cooldownUntil: new Date(Date.now() + 100_000),
        usedUsd: 10,
      });

      await expect(
        orchestrator.streamChat("s1", [{ role: "user", content: "hi" }], vi.fn(), {
          providerId: "openai-responses",
        }),
      ).rejects.toThrow("cooling down");
    });

    it("throws when openai-responses daily budget is exhausted", async () => {
      const adapter = makeAdapter({ id: "openai-responses" });
      factory.register(adapter as any);
      mockPrisma.appSetting.findUnique.mockResolvedValue({
        key: "openai_responses_config",
        value: { dailyBudgetUsd: 10 },
      });
      mockPrisma.providerBudgetProjection.findFirst.mockResolvedValue({
        cooldownUntil: null,
        usedUsd: 12,
      });

      await expect(
        orchestrator.streamChat("s1", [{ role: "user", content: "hi" }], vi.fn(), {
          providerId: "openai-responses",
        }),
      ).rejects.toThrow("daily budget exhausted");
    });

    it("allows request when budget still has room", async () => {
      const adapter = makeAdapter({
        id: "openai-responses",
        stream: vi.fn(async function* () {
          yield { type: "token", value: "ok" };
          yield { type: "done", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
        }),
      });
      factory.register(adapter as any);
      mockPrisma.appSetting.findUnique.mockResolvedValue({
        key: "openai_responses_config",
        value: { dailyBudgetUsd: 25 },
      });
      mockPrisma.providerBudgetProjection.findFirst.mockResolvedValue({
        cooldownUntil: null,
        usedUsd: 5,
      });
      mockPrisma.providerBudgetProjection.upsert.mockResolvedValue({});

      const result = await orchestrator.streamChat(
        "s1",
        [{ role: "user", content: "hi" }],
        vi.fn(),
        { providerId: "openai-responses" },
      );
      expect(result.text).toBe("ok");
    });
  });

  // -----------------------------------------------------------------------
  // streamChat — non-qwen-cli path
  // -----------------------------------------------------------------------
  describe("streamChat — non-qwen-cli provider path", () => {
    it("collects token events and returns joined text", async () => {
      const adapter = makeAdapter({
        id: "onprem-qwen",
        stream: vi.fn(async function* () {
          yield { type: "token", value: "Hello " };
          yield { type: "token", value: "world" };
          yield { type: "done", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
        }),
      });
      factory.register(adapter as any);
      mockPrisma.appSetting.findUnique.mockResolvedValue({ key: "active_provider", value: "onprem-qwen" });

      const tokens: string[] = [];
      const result = await orchestrator.streamChat(
        "s1",
        [{ role: "user", content: "hi" }],
        (t) => tokens.push(t),
      );

      expect(result.text).toBe("Hello world");
      expect(tokens).toEqual(["Hello ", "world"]);
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    });

    it("captures session events from the stream", async () => {
      const adapter = makeAdapter({
        id: "onprem-qwen",
        stream: vi.fn(async function* () {
          yield { type: "session", session: { provider: "onprem-qwen", previousResponseId: "resp-1" } };
          yield { type: "token", value: "data" };
          yield { type: "done" };
        }),
      });
      factory.register(adapter as any);
      mockPrisma.appSetting.findUnique.mockResolvedValue({ key: "active_provider", value: "onprem-qwen" });

      const result = await orchestrator.streamChat(
        "s1",
        [{ role: "user", content: "hi" }],
        vi.fn(),
      );
      expect(result.session).toEqual(
        expect.objectContaining({ provider: "onprem-qwen", previousResponseId: "resp-1" }),
      );
    });

    it("uses role binding parameters when modelRole is specified", async () => {
      const adapter = makeAdapter({
        id: "onprem-qwen",
        stream: vi.fn(async function* () {
          yield { type: "token", value: "role-test" };
          yield { type: "done" };
        }),
      });
      factory.register(adapter as any);
      mockPrisma.appSetting.findUnique.mockResolvedValue(null);

      await orchestrator.streamChat(
        "s1",
        [{ role: "user", content: "hi" }],
        vi.fn(),
        { modelRole: "coder_default" },
      );

      const callArgs = adapter.stream.mock.calls[0][0];
      expect(callArgs.metadata).toEqual(
        expect.objectContaining({
          model: "mlx-community/Qwen3.5-4B-4bit",
          temperature: 0.12,
          maxTokens: 1800,
        }),
      );
    });

    it("records cache break detection when cacheReadInputTokens is present in usage", async () => {
      const { recordObservation: mockRecordObservation, detectBreak: mockDetectBreak } =
        await import("./promptCacheBreakDetector");

      const adapter = makeAdapter({
        id: "onprem-qwen",
        stream: vi.fn(async function* () {
          yield { type: "token", value: "cached" };
          yield { type: "done", usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110, cacheReadInputTokens: 80 } };
        }),
      });
      factory.register(adapter as any);
      mockPrisma.appSetting.findUnique.mockResolvedValue({ key: "active_provider", value: "onprem-qwen" });

      await orchestrator.streamChat("s1", [{ role: "user", content: "hi" }], vi.fn());

      expect(mockRecordObservation).toHaveBeenCalled();
      expect(mockDetectBreak).toHaveBeenCalled();
    });

    it("publishes cache break event when detectBreak returns a result", async () => {
      const { detectBreak: mockDetectBreak } = await import("./promptCacheBreakDetector");
      (mockDetectBreak as any).mockReturnValueOnce({
        previousBaseline: 100,
        currentTokens: 5,
        dropPercent: 0.95,
        possibleCauses: ["unknown"],
        timestamp: "2026-01-01T00:00:00Z",
      });

      const adapter = makeAdapter({
        id: "onprem-qwen",
        stream: vi.fn(async function* () {
          yield { type: "token", value: "break" };
          yield { type: "done", usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110, cacheReadInputTokens: 5 } };
        }),
      });
      factory.register(adapter as any);
      mockPrisma.appSetting.findUnique.mockResolvedValue({ key: "active_provider", value: "onprem-qwen" });

      await orchestrator.streamChat("s1", [{ role: "user", content: "hi" }], vi.fn());

      expect(mockPublishEvent).toHaveBeenCalledWith("global", "cache.break.detected", expect.objectContaining({
        previousBaseline: 100,
        currentTokens: 5,
      }));
    });
  });

  // -----------------------------------------------------------------------
  // recordProviderUsage (via streamChat with openai-responses)
  // -----------------------------------------------------------------------
  describe("recordProviderUsage — tested through streamChat", () => {
    it("upserts budget projection and publishes escalated event for openai-responses", async () => {
      const adapter = makeAdapter({
        id: "openai-responses",
        stream: vi.fn(async function* () {
          yield { type: "token", value: "expensive" };
          yield { type: "done", usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } };
        }),
      });
      factory.register(adapter as any);
      mockPrisma.appSetting.findUnique.mockResolvedValue(null);
      // First call is ensureOpenAiBudget, second is recordProviderUsage
      mockPrisma.providerBudgetProjection.findFirst
        .mockResolvedValueOnce({ cooldownUntil: null, usedUsd: 5 })
        .mockResolvedValueOnce({ usedUsd: 5, requestCount: 10, cooldownUntil: null, metadata: {} });
      mockPrisma.providerBudgetProjection.upsert.mockResolvedValue({});

      await orchestrator.streamChat(
        "s1",
        [{ role: "user", content: "hi" }],
        vi.fn(),
        { providerId: "openai-responses" },
      );

      // recordProviderUsage metadata does not include estimatedUsd from options,
      // so usedUsd stays the same (estimatedUsd defaults to 0)
      expect(mockPrisma.providerBudgetProjection.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerId: "openai-responses" },
          update: expect.objectContaining({
            requestCount: 11,
          }),
        }),
      );
      expect(mockPublishEvent).toHaveBeenCalledWith("global", "provider.escalated", expect.objectContaining({
        providerId: "openai-responses",
      }));
    });

    it("sets cooldown when budget threshold is crossed", async () => {
      const adapter = makeAdapter({
        id: "openai-responses",
        stream: vi.fn(async function* () {
          yield { type: "token", value: "over" };
          yield { type: "done", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
        }),
      });
      factory.register(adapter as any);
      mockPrisma.appSetting.findUnique.mockResolvedValue({
        key: "openai_responses_config",
        value: { dailyBudgetUsd: 10 },
      });
      // ensureOpenAiBudget sees usedUsd < budget so it passes;
      // recordProviderUsage sees usedUsd already at budget level (estimatedUsd defaults to 0,
      // so usedUsd = current.usedUsd + 0 = 10 >= 10 triggers cooldown)
      mockPrisma.providerBudgetProjection.findFirst
        .mockResolvedValueOnce({ cooldownUntil: null, usedUsd: 5 })    // ensureOpenAiBudget
        .mockResolvedValueOnce({ usedUsd: 10, requestCount: 20, cooldownUntil: null, metadata: {} }); // recordProviderUsage
      mockPrisma.providerBudgetProjection.upsert.mockResolvedValue({});

      await orchestrator.streamChat(
        "s1",
        [{ role: "user", content: "hi" }],
        vi.fn(),
        { providerId: "openai-responses" },
      );

      // usedUsd = 10 + 0 = 10, which >= dailyBudgetUsd(10), so cooldownUntil should be set
      expect(mockPrisma.providerBudgetProjection.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            usedUsd: 10,
            cooldownUntil: expect.any(Date),
          }),
        }),
      );
    });

    it("creates budget record when none exists yet", async () => {
      const adapter = makeAdapter({
        id: "openai-responses",
        stream: vi.fn(async function* () {
          yield { type: "token", value: "new" };
          yield { type: "done", usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } };
        }),
      });
      factory.register(adapter as any);
      mockPrisma.appSetting.findUnique.mockResolvedValue(null);
      mockPrisma.providerBudgetProjection.findFirst.mockResolvedValue(null);
      mockPrisma.providerBudgetProjection.upsert.mockResolvedValue({});

      await orchestrator.streamChat(
        "s1",
        [{ role: "user", content: "hi" }],
        vi.fn(),
        { providerId: "openai-responses" },
      );

      expect(mockPrisma.providerBudgetProjection.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            providerId: "openai-responses",
            usedUsd: 0,
            requestCount: 1,
          }),
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // streamChat — qwen-cli path
  // -----------------------------------------------------------------------
  describe("streamChat — qwen-cli provider path", () => {
    let qwenAdapter: ReturnType<typeof makeAdapter>;

    beforeEach(() => {
      qwenAdapter = makeAdapter({
        id: "qwen-cli",
        stream: vi.fn(async function* () {
          yield { type: "token", value: "qwen-response" };
        }),
        classifyError: vi.fn().mockReturnValue("unknown"),
      });
      factory.register(qwenAdapter as any);
    });

    it("picks a ready account and returns text on success", async () => {
      mockPrisma.providerAccount.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.providerAccount.findFirst.mockResolvedValue({
        id: "acct1",
        state: "ready",
        enabled: true,
      });
      mockPrisma.providerUsageSample.create.mockResolvedValue({});
      mockPrisma.providerAccount.update.mockResolvedValue({ id: "acct1", state: "ready" });

      const tokens: string[] = [];
      const result = await orchestrator.streamChat(
        "s1",
        [{ role: "user", content: "hi" }],
        (t) => tokens.push(t),
        { providerId: "qwen-cli" },
      );

      expect(result.text).toBe("qwen-response");
      expect(result.accountId).toBe("acct1");
      expect(result.providerId).toBe("qwen-cli");
      expect(tokens).toEqual(["qwen-response"]);
    });

    it("throws when no ready account is available", async () => {
      mockPrisma.providerAccount.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.providerAccount.findFirst.mockResolvedValue(null);

      await expect(
        orchestrator.streamChat("s1", [{ role: "user", content: "hi" }], vi.fn(), {
          providerId: "qwen-cli",
        }),
      ).rejects.toThrow("No ready Qwen CLI account");
    });

    it("rotates to next account on quota_exhausted error", async () => {
      const { estimateNextUsableAt: mockEstimate } = await import("./quotaEstimator");

      qwenAdapter.classifyError.mockReturnValue("quota_exhausted");
      qwenAdapter.stream = vi.fn()
        .mockImplementationOnce(async function* () {
          throw new Error("quota exhausted");
        })
        .mockImplementationOnce(async function* () {
          yield { type: "token", value: "ok" };
        });

      mockPrisma.providerAccount.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.providerAccount.findFirst
        .mockResolvedValueOnce({ id: "acct1", state: "ready", enabled: true })
        .mockResolvedValueOnce({ id: "acct2", state: "ready", enabled: true });
      mockPrisma.providerAccount.update.mockResolvedValue({});
      mockPrisma.providerAccountEvent.createMany.mockResolvedValue({ count: 2 });
      mockPrisma.providerAccountEvent.create.mockResolvedValue({});
      mockPrisma.providerUsageSample.create.mockResolvedValue({});

      const result = await orchestrator.streamChat(
        "s1",
        [{ role: "user", content: "hi" }],
        vi.fn(),
        { providerId: "qwen-cli" },
      );

      expect(result.text).toBe("ok");
      expect(result.accountId).toBe("acct2");
      // Should have published account.exhausted and account.switched
      expect(mockPublishEvent).toHaveBeenCalledWith("global", "account.exhausted", expect.objectContaining({
        accountId: "acct1",
      }));
      expect(mockPublishEvent).toHaveBeenCalledWith("global", "account.switched", expect.objectContaining({
        fromAccountId: "acct1",
        toAccountId: "acct2",
      }));
    });

    it("rotates to next account on auth_required error", async () => {
      qwenAdapter.classifyError.mockReturnValue("auth_required");
      qwenAdapter.stream = vi.fn()
        .mockImplementationOnce(async function* () {
          throw new Error("auth required");
        })
        .mockImplementationOnce(async function* () {
          yield { type: "token", value: "after-auth" };
        });

      mockPrisma.providerAccount.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.providerAccount.findFirst
        .mockResolvedValueOnce({ id: "acct1", state: "ready", enabled: true })
        .mockResolvedValueOnce({ id: "acct2", state: "ready", enabled: true });
      mockPrisma.providerAccount.update.mockResolvedValue({});
      mockPrisma.providerAccountEvent.create.mockResolvedValue({});
      mockPrisma.providerUsageSample.create.mockResolvedValue({});

      const result = await orchestrator.streamChat(
        "s1",
        [{ role: "user", content: "hi" }],
        vi.fn(),
        { providerId: "qwen-cli" },
      );

      expect(result.text).toBe("after-auth");
      expect(mockPrisma.providerAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ state: "auth_required" }),
        }),
      );
    });

    it("rethrows unclassified errors from qwen-cli path", async () => {
      qwenAdapter.classifyError.mockReturnValue("unknown");
      qwenAdapter.stream = vi.fn(async function* () {
        throw new Error("Unexpected failure");
      });

      mockPrisma.providerAccount.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.providerAccount.findFirst.mockResolvedValue({
        id: "acct1",
        state: "ready",
        enabled: true,
      });

      await expect(
        orchestrator.streamChat("s1", [{ role: "user", content: "hi" }], vi.fn(), {
          providerId: "qwen-cli",
        }),
      ).rejects.toThrow("Unexpected failure");
    });

    it("publishes recovery event when a previously-cooldown account succeeds", async () => {
      qwenAdapter.stream = vi.fn(async function* () {
        yield { type: "token", value: "recovered" };
      });

      mockPrisma.providerAccount.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.providerAccount.findFirst.mockResolvedValue({
        id: "acct1",
        state: "cooldown",
        enabled: true,
      });
      mockPrisma.providerUsageSample.create.mockResolvedValue({});
      mockPrisma.providerAccount.update.mockResolvedValue({ id: "acct1", state: "ready" });
      mockPrisma.providerAccountEvent.create.mockResolvedValue({});

      await orchestrator.streamChat(
        "s1",
        [{ role: "user", content: "hi" }],
        vi.fn(),
        { providerId: "qwen-cli" },
      );

      expect(mockPrisma.providerAccountEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: "account.recovered" }),
        }),
      );
      expect(mockPublishEvent).toHaveBeenCalledWith("global", "account.recovered", expect.objectContaining({
        accountId: "acct1",
        reason: "successful_call",
      }));
    });

    it("publishes session-scoped account.switched event on rotation", async () => {
      qwenAdapter.classifyError.mockReturnValue("rate_limited");
      qwenAdapter.stream = vi.fn()
        .mockImplementationOnce(async function* () {
          throw new Error("rate limited");
        })
        .mockImplementationOnce(async function* () {
          yield { type: "token", value: "switched" };
        });

      mockPrisma.providerAccount.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.providerAccount.findFirst
        .mockResolvedValueOnce({ id: "a1", state: "ready", enabled: true })
        .mockResolvedValueOnce({ id: "a2", state: "ready", enabled: true });
      mockPrisma.providerAccount.update.mockResolvedValue({});
      mockPrisma.providerAccountEvent.createMany.mockResolvedValue({ count: 2 });
      mockPrisma.providerAccountEvent.create.mockResolvedValue({});
      mockPrisma.providerUsageSample.create.mockResolvedValue({});

      await orchestrator.streamChat(
        "s1",
        [{ role: "user", content: "hi" }],
        vi.fn(),
        { providerId: "qwen-cli" },
      );

      expect(mockPublishEvent).toHaveBeenCalledWith("session:s1", "account.switched", expect.objectContaining({
        fromAccountId: "a1",
        toAccountId: "a2",
      }));
    });

    it("records usage sample with estimated token counts on success", async () => {
      qwenAdapter.stream = vi.fn(async function* () {
        yield { type: "token", value: "some output text" };
      });

      mockPrisma.providerAccount.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.providerAccount.findFirst.mockResolvedValue({
        id: "acct1",
        state: "ready",
        enabled: true,
      });
      mockPrisma.providerUsageSample.create.mockResolvedValue({});
      mockPrisma.providerAccount.update.mockResolvedValue({});

      await orchestrator.streamChat(
        "s1",
        [{ role: "user", content: "hello" }],
        vi.fn(),
        { providerId: "qwen-cli" },
      );

      expect(mockPrisma.providerUsageSample.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            accountId: "acct1",
            inputTokens: expect.any(Number),
            outputTokens: expect.any(Number),
            totalTokens: expect.any(Number),
          }),
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // streamChatWithRetryStreaming — additional paths
  // -----------------------------------------------------------------------
  describe("streamChatWithRetryStreaming — additional paths", () => {
    it("yields all stream events including thinking and session events", async () => {
      const adapter = makeAdapter({
        id: "onprem-qwen",
        stream: vi.fn(async function* () {
          yield { type: "thinking", value: "reasoning step" };
          yield { type: "token", value: "result" };
          yield { type: "session", session: { provider: "onprem-qwen" } };
          yield { type: "done", usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } };
        }),
      });
      factory.register(adapter as any);
      mockPrisma.appSetting.findUnique.mockResolvedValue({ key: "active_provider", value: "onprem-qwen" });

      const tokens: string[] = [];
      const events: any[] = [];

      for await (const event of orchestrator.streamChatWithRetryStreaming(
        "run1",
        [{ role: "user", content: "test" }],
        (t) => tokens.push(t),
        {},
      )) {
        events.push(event);
      }

      expect(events.some((e) => e.type === "thinking")).toBe(true);
      expect(events.some((e) => e.type === "token")).toBe(true);
      expect(events.some((e) => e.type === "session")).toBe(true);
      expect(events.some((e) => e.type === "done")).toBe(true);
      expect(tokens).toContain("result");
    });

    it("calls onHeartbeat for token and thinking events", async () => {
      const adapter = makeAdapter({
        id: "onprem-qwen",
        stream: vi.fn(async function* () {
          yield { type: "thinking", value: "step" };
          yield { type: "token", value: "tok" };
          yield { type: "session", session: {} };
          yield { type: "done" };
        }),
      });
      factory.register(adapter as any);
      mockPrisma.appSetting.findUnique.mockResolvedValue({ key: "active_provider", value: "onprem-qwen" });

      const heartbeat = vi.fn();
      const events: any[] = [];

      for await (const event of orchestrator.streamChatWithRetryStreaming(
        "run1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        { onHeartbeat: heartbeat },
      )) {
        events.push(event);
      }

      // Should have been called for thinking + token but NOT for session
      expect(heartbeat).toHaveBeenCalledTimes(2);
    });

    it("rethrows non-streaming-recoverable errors without fallback", async () => {
      const adapter = makeAdapter({
        id: "onprem-qwen",
        stream: vi.fn(async function* () {
          throw new Error("401 Unauthorized");
        }),
      });
      factory.register(adapter as any);
      mockPrisma.appSetting.findUnique.mockResolvedValue({ key: "active_provider", value: "onprem-qwen" });

      const gen = orchestrator.streamChatWithRetryStreaming(
        "run1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        {},
      );

      await expect(async () => {
        for await (const _event of gen) {
          // consume
        }
      }).rejects.toThrow("401 Unauthorized");
    });

    it("throws original streaming error when send() also fails", async () => {
      const mockTelemetry = { incrementCounter: vi.fn(), recordMetric: vi.fn() };
      mockGetTelemetry.mockReturnValue(mockTelemetry);

      const adapter = makeAdapter({
        id: "onprem-qwen",
        stream: vi.fn(async function* () {
          throw new Error("ECONNRESET");
        }),
        send: vi.fn().mockRejectedValue(new Error("send also failed")),
      });
      factory.register(adapter as any);
      mockPrisma.appSetting.findUnique.mockResolvedValue({ key: "active_provider", value: "onprem-qwen" });

      const gen = orchestrator.streamChatWithRetryStreaming(
        "run1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        {},
      );

      await expect(async () => {
        for await (const _event of gen) {
          // consume
        }
      }).rejects.toThrow("ECONNRESET");
    });

    it("yields session event from non-streaming fallback", async () => {
      const mockTelemetry = { incrementCounter: vi.fn(), recordMetric: vi.fn() };
      mockGetTelemetry.mockReturnValue(mockTelemetry);

      const adapter = makeAdapter({
        id: "onprem-qwen",
        stream: vi.fn(async function* () {
          throw new Error("socket hang up");
        }),
        send: vi.fn().mockResolvedValue({
          text: "fallback",
          session: { provider: "onprem-qwen", id: "sess-1" },
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        }),
      });
      factory.register(adapter as any);
      mockPrisma.appSetting.findUnique.mockResolvedValue({ key: "active_provider", value: "onprem-qwen" });

      const events: any[] = [];
      for await (const event of orchestrator.streamChatWithRetryStreaming(
        "run1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        {},
      )) {
        events.push(event);
      }

      expect(events.some((e) => e.type === "session")).toBe(true);
      expect(events.some((e) => e.type === "token" && e.value === "fallback")).toBe(true);
      expect(events.some((e) => e.type === "done")).toBe(true);
    });

    it("passes role binding metadata into sendInput", async () => {
      const adapter = makeAdapter({
        id: "onprem-qwen",
        stream: vi.fn(async function* () {
          yield { type: "token", value: "data" };
          yield { type: "done" };
        }),
      });
      factory.register(adapter as any);
      mockPrisma.appSetting.findUnique.mockResolvedValue(null);

      const events: any[] = [];
      for await (const event of orchestrator.streamChatWithRetryStreaming(
        "run1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        { modelRole: "review_deep" },
      )) {
        events.push(event);
      }

      const sendInputMetadata = adapter.stream.mock.calls[0][0].metadata;
      expect(sendInputMetadata.model).toBe("mlx-community/Qwen3.5-4B-4bit");
      expect(sendInputMetadata.reasoningMode).toBe("on");
    });

    it("ensures OpenAI budget check before streaming", async () => {
      const adapter = makeAdapter({
        id: "openai-responses",
        stream: vi.fn(async function* () {
          yield { type: "token", value: "x" };
          yield { type: "done" };
        }),
      });
      factory.register(adapter as any);
      mockPrisma.appSetting.findUnique.mockResolvedValue(null);
      mockPrisma.providerBudgetProjection.findFirst.mockResolvedValue({
        cooldownUntil: new Date(Date.now() + 100_000),
        usedUsd: 30,
      });

      const gen = orchestrator.streamChatWithRetryStreaming(
        "run1",
        [{ role: "user", content: "test" }],
        vi.fn(),
        { providerId: "openai-responses" },
      );

      await expect(async () => {
        for await (const _event of gen) {
          // consume
        }
      }).rejects.toThrow("cooling down");
    });
  });
});

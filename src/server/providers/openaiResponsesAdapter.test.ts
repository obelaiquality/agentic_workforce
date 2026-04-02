import { describe, expect, it, vi, beforeEach } from "vitest";
import { OpenAiResponsesAdapter } from "./openaiResponsesAdapter";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../db", () => ({
  prisma: {
    appSetting: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("../services/secretStore", () => ({
  PROVIDER_SECRET_NAMES: {
    openAiResponsesApiKey: "openai_responses_api_key",
  },
  resolveSecretValue: vi.fn().mockResolvedValue({ value: null }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OpenAiResponsesAdapter", () => {
  let adapter: OpenAiResponsesAdapter;

  beforeEach(() => {
    adapter = new OpenAiResponsesAdapter();
    vi.unstubAllEnvs();
  });

  // ---- Identity ----

  it("getProviderId returns 'openai-responses'", () => {
    expect(adapter.id).toBe("openai-responses");
  });

  it("has correct label", () => {
    expect(adapter.label).toBe("OpenAI Responses");
  });

  it("declares streaming support", () => {
    expect(adapter.supportsStreaming).toBe(true);
    expect(adapter.capabilities.streaming).toBe(true);
  });

  it("declares tool support", () => {
    expect(adapter.supportsTools).toBe(true);
    expect(adapter.capabilities.tools).toBe(true);
  });

  // ---- classifyError ----

  describe("classifyError", () => {
    it("classifies auth errors", () => {
      expect(adapter.classifyError(new Error("401 Unauthorized"))).toBe("auth_required");
      expect(adapter.classifyError(new Error("403 Forbidden"))).toBe("auth_required");
      expect(adapter.classifyError(new Error("invalid api key"))).toBe("auth_required");
    });

    it("classifies rate limit errors", () => {
      expect(adapter.classifyError(new Error("429 Too Many Requests"))).toBe("rate_limited");
      expect(adapter.classifyError(new Error("rate limit exceeded"))).toBe("rate_limited");
      expect(adapter.classifyError(new Error("insufficient_quota"))).toBe("rate_limited");
    });

    it("classifies timeout errors", () => {
      expect(adapter.classifyError(new Error("request timed out"))).toBe("timeout");
      expect(adapter.classifyError(new Error("timeout waiting for response"))).toBe("timeout");
      expect(adapter.classifyError(new Error("AbortError: signal aborted"))).toBe("timeout");
    });

    it("classifies provider unavailable errors", () => {
      expect(adapter.classifyError(new Error("500 Internal Server Error"))).toBe("provider_unavailable");
      expect(adapter.classifyError(new Error("ECONNREFUSED 127.0.0.1:8080"))).toBe("provider_unavailable");
      expect(adapter.classifyError(new Error("fetch failed"))).toBe("provider_unavailable");
    });

    it("classifies unknown errors", () => {
      expect(adapter.classifyError(new Error("something weird happened"))).toBe("unknown");
      expect(adapter.classifyError("string error")).toBe("unknown");
    });
  });

  // ---- estimateAvailability ----

  describe("estimateAvailability", () => {
    it("returns auth_required when no API key is configured", async () => {
      vi.stubEnv("OPENAI_API_KEY", "");
      vi.stubEnv("OPENAI_RESPONSES_BASE_URL", "");

      const adapter2 = new OpenAiResponsesAdapter();
      const result = await adapter2.estimateAvailability("test-account");

      expect(result.state).toBe("auth_required");
      expect(result.confidence).toBe(1);
    });
  });

  // ---- createSession ----

  describe("createSession", () => {
    it("creates a session with correct provider id", async () => {
      const session = await adapter.createSession({
        sessionId: "test-session-1",
        metadata: { foo: "bar" },
      });

      expect(session.id).toBe("test-session-1");
      expect(session.provider).toBe("openai-responses");
      expect(session.accountId).toBe("openai-api");
      expect(session.capabilities.streaming).toBe(true);
      expect(session.metadata).toEqual({ foo: "bar" });
    });
  });

  // ---- capabilities ----

  describe("capabilities", () => {
    it("supports native conversation state", () => {
      expect(adapter.capabilities.nativeConversationState).toBe(true);
    });

    it("supports structured outputs", () => {
      expect(adapter.capabilities.structuredOutputs).toBe(true);
    });

    it("supports MCP tools", () => {
      expect(adapter.capabilities.mcpTools).toBe(true);
    });
  });
});

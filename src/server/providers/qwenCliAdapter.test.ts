import { describe, expect, it, vi, beforeEach } from "vitest";
import { QwenCliAdapter } from "./qwenCliAdapter";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrismaAccountFindFirst = vi.fn().mockResolvedValue(null);
const mockPrismaAccountFindUnique = vi.fn().mockResolvedValue(null);
const mockPrismaSettingFindUnique = vi.fn().mockResolvedValue(null);

vi.mock("../db", () => ({
  prisma: {
    providerAccount: {
      findFirst: (...args: unknown[]) => mockPrismaAccountFindFirst(...args),
      findUnique: (...args: unknown[]) => mockPrismaAccountFindUnique(...args),
    },
    appSetting: {
      findUnique: (...args: unknown[]) => mockPrismaSettingFindUnique(...args),
    },
  },
}));

vi.mock("./qwenCliConfig", () => ({
  getQwenCliConfig: vi.fn().mockResolvedValue({
    command: "qwen",
    args: ["--auth-type", "qwen-oauth", "--output-format", "text"],
    timeoutMs: 120000,
  }),
  resolveQwenProfileHome: vi.fn().mockReturnValue("/home/testuser"),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("QwenCliAdapter", () => {
  let adapter: QwenCliAdapter;

  beforeEach(() => {
    adapter = new QwenCliAdapter();
    mockPrismaAccountFindFirst.mockResolvedValue(null);
    mockPrismaAccountFindUnique.mockResolvedValue(null);
    mockPrismaSettingFindUnique.mockResolvedValue(null);
  });

  // ---- Identity ----

  it("has correct id and label", () => {
    expect(adapter.id).toBe("qwen-cli");
    expect(adapter.label).toBe("Qwen CLI");
  });

  it("declares correct capabilities", () => {
    expect(adapter.capabilities.streaming).toBe(true);
    expect(adapter.capabilities.tools).toBe(true);
    expect(adapter.capabilities.nativeConversationState).toBe(false);
    expect(adapter.capabilities.structuredOutputs).toBe(false);
    expect(adapter.capabilities.mcpTools).toBe(false);
    expect(adapter.supportsStreaming).toBe(true);
    expect(adapter.supportsTools).toBe(true);
  });

  // ---- classifyError ----

  describe("classifyError", () => {
    it("classifies quota exhaustion", () => {
      expect(adapter.classifyError(new Error("429 quota exceeded"))).toBe("quota_exhausted");
    });

    it("classifies rate limit errors", () => {
      expect(adapter.classifyError(new Error("rate limit reached"))).toBe("quota_exhausted");
      expect(adapter.classifyError(new Error("too many requests"))).toBe("quota_exhausted");
    });

    it("classifies auth issues", () => {
      expect(adapter.classifyError(new Error("authentication failed"))).toBe("auth_required");
      expect(adapter.classifyError(new Error("unauthorized access"))).toBe("auth_required");
      expect(adapter.classifyError(new Error("forbidden resource"))).toBe("auth_required");
      expect(adapter.classifyError(new Error("invalid token"))).toBe("auth_required");
      expect(adapter.classifyError(new Error("bad credential"))).toBe("auth_required");
      expect(adapter.classifyError(new Error("please login first"))).toBe("auth_required");
    });

    it("classifies timeout errors", () => {
      expect(adapter.classifyError(new Error("request timed out"))).toBe("timeout");
      expect(adapter.classifyError(new Error("timeout waiting"))).toBe("timeout");
      expect(adapter.classifyError(new Error("deadline reached"))).toBe("timeout");
    });

    it("classifies provider missing", () => {
      expect(adapter.classifyError(new Error("spawn ENOENT"))).toBe("provider_unavailable");
      expect(adapter.classifyError(new Error("spawn qwen ENOENT"))).toBe("provider_unavailable");
    });

    it("classifies unknown errors", () => {
      expect(adapter.classifyError(new Error("something unexpected"))).toBe("unknown");
      expect(adapter.classifyError("string error")).toBe("unknown");
      expect(adapter.classifyError(42)).toBe("unknown");
    });
  });

  // ---- createSession ----

  describe("createSession", () => {
    it("creates a session with empty accountId when no account found", async () => {
      const session = await adapter.createSession({ sessionId: "s-1" });
      expect(session.id).toBe("s-1");
      expect(session.provider).toBe("qwen-cli");
      expect(session.accountId).toBe("");
      expect(session.model).toBe("qwen-cli");
      expect(session.capabilities.streaming).toBe(true);
    });

    it("creates a session with account id when account found", async () => {
      mockPrismaAccountFindFirst.mockResolvedValue({
        id: "acct-qwen-1",
        providerId: "qwen-cli",
        enabled: true,
      });

      const session = await adapter.createSession({ sessionId: "s-2" });
      expect(session.accountId).toBe("acct-qwen-1");
    });
  });

  // ---- estimateAvailability ----

  describe("estimateAvailability", () => {
    it("returns disabled when account not found", async () => {
      const result = await adapter.estimateAvailability("nonexistent");
      expect(result.state).toBe("disabled");
      expect(result.confidence).toBe(0);
      expect(result.accountId).toBe("nonexistent");
    });

    it("returns disabled when account is not enabled", async () => {
      mockPrismaAccountFindUnique.mockResolvedValue({
        id: "acct-1",
        enabled: false,
        state: "ready",
        quotaNextUsableAt: null,
        quotaEtaConfidence: 0.5,
      });

      const result = await adapter.estimateAvailability("acct-1");
      expect(result.state).toBe("disabled");
    });

    it("returns account state when enabled", async () => {
      mockPrismaAccountFindUnique.mockResolvedValue({
        id: "acct-2",
        enabled: true,
        state: "ready",
        quotaNextUsableAt: null,
        quotaEtaConfidence: 0.9,
      });

      const result = await adapter.estimateAvailability("acct-2");
      expect(result.state).toBe("ready");
      expect(result.confidence).toBe(0.9);
      expect(result.nextUsableAt).toBeNull();
    });

    it("returns quotaNextUsableAt as ISO string", async () => {
      const futureDate = new Date("2026-05-01T12:00:00Z");
      mockPrismaAccountFindUnique.mockResolvedValue({
        id: "acct-3",
        enabled: true,
        state: "rate_limited",
        quotaNextUsableAt: futureDate,
        quotaEtaConfidence: 0.7,
      });

      const result = await adapter.estimateAvailability("acct-3");
      expect(result.nextUsableAt).toBe(futureDate.toISOString());
    });
  });

  // ---- stream ----

  describe("stream", () => {
    it("throws when account is not found", async () => {
      mockPrismaAccountFindUnique.mockResolvedValue(null);

      const gen = adapter.stream({
        sessionId: "s-1",
        accountId: "missing-account",
        messages: [{ role: "user", content: "hello" }],
      });

      await expect(gen.next()).rejects.toThrow("Qwen account 'missing-account' not found");
    });
  });

  // ---- send ----

  describe("send", () => {
    it("collects stream tokens into a single response", async () => {
      // Mock stream to yield tokens
      const originalStream = adapter.stream.bind(adapter);
      vi.spyOn(adapter, "stream").mockImplementation(async function* () {
        yield { type: "token" as const, value: "Hello " };
        yield { type: "token" as const, value: "world" };
        yield { type: "done" as const };
      });

      const result = await adapter.send({
        sessionId: "s-1",
        accountId: "acct-1",
        messages: [{ role: "user", content: "hi" }],
      });

      expect(result.text).toBe("Hello world");
      expect(result.usage?.totalTokens).toBeGreaterThan(0);
    });

    it("handles empty stream output", async () => {
      vi.spyOn(adapter, "stream").mockImplementation(async function* () {
        yield { type: "done" as const };
      });

      const result = await adapter.send({
        sessionId: "s-1",
        accountId: "acct-1",
        messages: [{ role: "user", content: "hi" }],
      });

      expect(result.text).toBe("");
      expect(result.usage?.totalTokens).toBe(1); // Math.max(1, ...)
    });
  });
});

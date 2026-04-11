import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { OpenAiResponsesAdapter } from "./openaiResponsesAdapter";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindUnique = vi.fn().mockResolvedValue(null);

vi.mock("../db", () => ({
  prisma: {
    appSetting: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}));

const mockResolveSecretValue = vi.fn().mockResolvedValue({ value: null });

vi.mock("../services/secretStore", () => ({
  PROVIDER_SECRET_NAMES: {
    openAiResponsesApiKey: "openai_responses_api_key",
  },
  resolveSecretValue: (...args: unknown[]) => mockResolveSecretValue(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "sess-1",
    accountId: "acct-1",
    messages: [
      { role: "system" as const, content: "You are a helper." },
      { role: "user" as const, content: "Hello" },
    ],
    modelRole: "coder_default" as const,
    ...overrides,
  };
}

function makeReadableStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OpenAiResponsesAdapter", () => {
  let adapter: OpenAiResponsesAdapter;

  beforeEach(() => {
    adapter = new OpenAiResponsesAdapter();
    vi.unstubAllEnvs();
    mockFindUnique.mockResolvedValue(null);
    mockResolveSecretValue.mockResolvedValue({ value: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

    it("returns ready when API key is valid and models endpoint succeeds", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-test-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-test-key");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("{}", { status: 200 }),
      );

      const result = await adapter.estimateAvailability("test-account");
      expect(result.state).toBe("ready");
      expect(result.confidence).toBe(1);
      fetchSpy.mockRestore();
    });

    it("returns auth_required on 401 from models endpoint", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-bad-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-bad-key");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Unauthorized", { status: 401 }),
      );

      const result = await adapter.estimateAvailability("test-account");
      expect(result.state).toBe("auth_required");
      expect(result.confidence).toBe(0.8);
      fetchSpy.mockRestore();
    });

    it("returns auth_required on 403 from models endpoint", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-bad-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-bad-key");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Forbidden", { status: 403 }),
      );

      const result = await adapter.estimateAvailability("test-account");
      expect(result.state).toBe("auth_required");
      expect(result.confidence).toBe(0.8);
      fetchSpy.mockRestore();
    });

    it("returns disabled on other status codes", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-test" });
      vi.stubEnv("OPENAI_API_KEY", "sk-test");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Server Error", { status: 500 }),
      );

      const result = await adapter.estimateAvailability("test-account");
      expect(result.state).toBe("disabled");
      expect(result.confidence).toBe(0.2);
      fetchSpy.mockRestore();
    });

    it("returns disabled on fetch error", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-test" });
      vi.stubEnv("OPENAI_API_KEY", "sk-test");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("Network error"),
      );

      const result = await adapter.estimateAvailability("test-account");
      expect(result.state).toBe("disabled");
      expect(result.confidence).toBe(0);
      fetchSpy.mockRestore();
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

    it("creates a session using model from config", async () => {
      mockFindUnique.mockResolvedValue({
        value: { model: "gpt-4o" },
      });

      const session = await adapter.createSession({
        sessionId: "s-2",
      });
      expect(session.model).toBe("gpt-4o");
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

  // ---- send ----

  describe("send", () => {
    it("throws when no API key is configured", async () => {
      await expect(adapter.send(makeInput())).rejects.toThrow(
        "OpenAI Responses API key is not configured",
      );
    });

    it("sends a request and returns parsed response", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-test-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-test-key");

      const responsePayload = {
        id: "resp-123",
        output_text: "Hello world!",
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      };

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(responsePayload), { status: 200 }),
      );

      const result = await adapter.send(makeInput());
      expect(result.text).toBe("Hello world!");
      expect(result.providerResponseId).toBe("resp-123");
      expect(result.usage?.inputTokens).toBe(10);
      expect(result.usage?.outputTokens).toBe(5);
      expect(result.usage?.totalTokens).toBe(15);
      fetchSpy.mockRestore();
    });

    it("throws on non-200 responses", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-test-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-test-key");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Bad Request", { status: 400 }),
      );

      await expect(adapter.send(makeInput())).rejects.toThrow(
        "openai-responses provider error 400",
      );
      fetchSpy.mockRestore();
    });

    it("extracts text from output array when output_text is missing", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const responsePayload = {
        id: "resp-456",
        output: [
          {
            content: [
              { text: "Part 1" },
              { text: "Part 2" },
            ],
          },
        ],
        usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
      };

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(responsePayload), { status: 200 }),
      );

      const result = await adapter.send(makeInput());
      expect(result.text).toBe("Part 1Part 2");
      fetchSpy.mockRestore();
    });

    it("extracts text from nested text.value objects", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const responsePayload = {
        id: "resp-789",
        output: [
          {
            content: [
              { text: { value: "Nested value" } },
            ],
          },
        ],
        usage: {},
      };

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(responsePayload), { status: 200 }),
      );

      const result = await adapter.send(makeInput());
      expect(result.text).toBe("Nested value");
      fetchSpy.mockRestore();
    });

    it("sends with tools when provided", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ output_text: "ok", id: "r1", usage: {} }), { status: 200 }),
      );

      await adapter.send(makeInput({
        tools: [
          { name: "my_tool", description: "A tool", parameters: { type: "object" } },
        ],
      }));

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].type).toBe("function");
      expect(body.tools[0].function.name).toBe("my_tool");
      fetchSpy.mockRestore();
    });

    it("sends with previousResponseId from metadata", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ output_text: "ok", id: "r1", usage: {} }), { status: 200 }),
      );

      await adapter.send(makeInput({
        metadata: { previousResponseId: "prev-resp-1" },
      }));

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.previous_response_id).toBe("prev-resp-1");
      fetchSpy.mockRestore();
    });

    it("uses model override from metadata", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ output_text: "ok", id: "r1", usage: {} }), { status: 200 }),
      );

      await adapter.send(makeInput({
        metadata: { model: "gpt-4o-mini" },
      }));

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.model).toBe("gpt-4o-mini");
      fetchSpy.mockRestore();
    });

    it("uses reasoning effort from metadata", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ output_text: "ok", id: "r1", usage: {} }), { status: 200 }),
      );

      await adapter.send(makeInput({
        metadata: { reasoningEffort: "high" },
      }));

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.reasoning.effort).toBe("high");
      fetchSpy.mockRestore();
    });

    it("maps modelRole to reasoning effort", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const makeOkResponse = () =>
        new Response(JSON.stringify({ output_text: "ok", id: "r1", usage: {} }), { status: 200 });

      const fetchSpy = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(makeOkResponse())
        .mockResolvedValueOnce(makeOkResponse())
        .mockResolvedValueOnce(makeOkResponse());

      // utility_fast -> low
      await adapter.send(makeInput({ modelRole: "utility_fast" }));
      let body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.reasoning.effort).toBe("low");

      // review_deep -> medium
      await adapter.send(makeInput({ modelRole: "review_deep" }));
      body = JSON.parse(fetchSpy.mock.calls[1][1]?.body as string);
      expect(body.reasoning.effort).toBe("medium");

      // overseer_escalation -> high
      await adapter.send(makeInput({ modelRole: "overseer_escalation" }));
      body = JSON.parse(fetchSpy.mock.calls[2][1]?.body as string);
      expect(body.reasoning.effort).toBe("high");

      fetchSpy.mockRestore();
    });

    it("uses default reasoning effort for unknown modelRole", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ output_text: "ok", id: "r1", usage: {} }), { status: 200 }),
      );

      await adapter.send(makeInput({ modelRole: "some_unknown_role" }));
      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.reasoning.effort).toBe("medium");
      fetchSpy.mockRestore();
    });

    it("handles system-only messages by using instructions", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ output_text: "ok", id: "r1", usage: {} }), { status: 200 }),
      );

      await adapter.send(makeInput({
        messages: [
          { role: "system", content: "Be helpful" },
          { role: "user", content: "Hi" },
        ],
      }));

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.instructions).toBe("Be helpful");
      fetchSpy.mockRestore();
    });

    it("handles response with no id gracefully", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ output_text: "ok", usage: {} }), { status: 200 }),
      );

      const result = await adapter.send(makeInput());
      expect(result.providerResponseId).toBeNull();
      fetchSpy.mockRestore();
    });

    it("handles output with non-object items", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({
          output: [null, "string", { content: [null, "non-obj"] }],
          usage: {},
        }), { status: 200 }),
      );

      const result = await adapter.send(makeInput());
      expect(result.text).toBe("");
      fetchSpy.mockRestore();
    });
  });

  // ---- stream ----

  describe("stream", () => {
    it("throws when no API key is configured", async () => {
      const gen = adapter.stream(makeInput());
      await expect(gen.next()).rejects.toThrow(
        "OpenAI Responses API key is not configured",
      );
    });

    it("throws on non-200 response", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Server Error", { status: 500 }),
      );

      const gen = adapter.stream(makeInput());
      await expect(gen.next()).rejects.toThrow(
        "openai-responses provider error 500",
      );
      fetchSpy.mockRestore();
    });

    it("falls back to send() when response has no body", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      // Create a response-like object with body = null
      const noBodyResponse = {
        ok: true,
        status: 200,
        body: null,
        headers: new Headers(),
        text: () => Promise.resolve(""),
      };

      const fetchSpy = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(noBodyResponse as unknown as Response)
        .mockResolvedValueOnce(
          new Response(JSON.stringify({
            id: "resp-fallback",
            output_text: "Fallback text",
            usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
          }), { status: 200 }),
        );

      const events: Array<{ type: string; [k: string]: unknown }> = [];
      for await (const event of adapter.stream(makeInput())) {
        events.push(event as { type: string; [k: string]: unknown });
      }

      expect(events.some((e) => e.type === "session")).toBe(true);
      expect(events.some((e) => e.type === "token" && e.value === "Fallback text")).toBe(true);
      expect(events.some((e) => e.type === "done")).toBe(true);
      fetchSpy.mockRestore();
    });

    it("streams SSE delta events", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const sseChunks = [
        'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
        'data: {"type":"response.output_text.delta","delta":" world"}\n\n',
        'data: {"type":"response.completed","response":{"id":"resp-stream","usage":{"input_tokens":5,"output_tokens":3,"total_tokens":8}}}\n\n',
        'data: [DONE]\n\n',
      ];

      const body = makeReadableStream(sseChunks);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(body, { status: 200 }),
      );

      const events: Array<{ type: string; [k: string]: unknown }> = [];
      for await (const event of adapter.stream(makeInput())) {
        events.push(event as { type: string; [k: string]: unknown });
      }

      const tokens = events.filter((e) => e.type === "token");
      expect(tokens).toHaveLength(2);
      expect(tokens[0].value).toBe("Hello");
      expect(tokens[1].value).toBe(" world");

      const sessionEvent = events.find((e) => e.type === "session");
      expect(sessionEvent).toBeTruthy();

      const doneEvent = events.find((e) => e.type === "done");
      expect(doneEvent).toBeTruthy();
      expect((doneEvent as any).usage?.inputTokens).toBe(5);
      fetchSpy.mockRestore();
    });

    it("uses fallback text when no delta tokens are emitted", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const sseChunks = [
        'data: {"type":"response.completed","response":{"id":"resp-fb","output_text":"Fallback from completed","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n',
      ];

      const body = makeReadableStream(sseChunks);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(body, { status: 200 }),
      );

      const events: Array<{ type: string; [k: string]: unknown }> = [];
      for await (const event of adapter.stream(makeInput())) {
        events.push(event as { type: string; [k: string]: unknown });
      }

      const tokens = events.filter((e) => e.type === "token");
      expect(tokens).toHaveLength(1);
      expect(tokens[0].value).toBe("Fallback from completed");
      fetchSpy.mockRestore();
    });

    it("handles malformed JSON in SSE data lines gracefully", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const sseChunks = [
        'data: {bad json}\n\n',
        'data: {"type":"response.output_text.delta","delta":"ok"}\n\n',
      ];

      const body = makeReadableStream(sseChunks);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(body, { status: 200 }),
      );

      const events: Array<{ type: string; [k: string]: unknown }> = [];
      for await (const event of adapter.stream(makeInput())) {
        events.push(event as { type: string; [k: string]: unknown });
      }

      const tokens = events.filter((e) => e.type === "token");
      expect(tokens).toHaveLength(1);
      expect(tokens[0].value).toBe("ok");
      fetchSpy.mockRestore();
    });

    it("handles empty data lines and [DONE]", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const sseChunks = [
        'data: \n\n',
        'data: [DONE]\n\n',
      ];

      const body = makeReadableStream(sseChunks);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(body, { status: 200 }),
      );

      const events: Array<{ type: string; [k: string]: unknown }> = [];
      for await (const event of adapter.stream(makeInput())) {
        events.push(event as { type: string; [k: string]: unknown });
      }

      // Should only have the done event
      expect(events.filter((e) => e.type === "done")).toHaveLength(1);
      fetchSpy.mockRestore();
    });

    it("extracts responseId from response payload", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const sseChunks = [
        'data: {"type":"response.output_text.delta","delta":"hi","response":{"id":"resp-extracted"}}\n\n',
      ];

      const body = makeReadableStream(sseChunks);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(body, { status: 200 }),
      );

      const events: Array<{ type: string; [k: string]: unknown }> = [];
      for await (const event of adapter.stream(makeInput())) {
        events.push(event as { type: string; [k: string]: unknown });
      }

      const sessionEvent = events.find((e) => e.type === "session");
      expect(sessionEvent).toBeTruthy();
      expect((sessionEvent as any).session.previousResponseId).toBe("resp-extracted");
      fetchSpy.mockRestore();
    });

    it("does not emit session event when no responseId is found", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const sseChunks = [
        'data: {"type":"response.output_text.delta","delta":"hi"}\n\n',
      ];

      const body = makeReadableStream(sseChunks);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(body, { status: 200 }),
      );

      const events: Array<{ type: string; [k: string]: unknown }> = [];
      for await (const event of adapter.stream(makeInput())) {
        events.push(event as { type: string; [k: string]: unknown });
      }

      expect(events.filter((e) => e.type === "session")).toHaveLength(0);
      fetchSpy.mockRestore();
    });
  });

  // ---- resolveConfig ----

  describe("resolveConfig (via send)", () => {
    it("uses env vars for base URL, model and timeout", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-env" });
      vi.stubEnv("OPENAI_API_KEY", "sk-env");
      vi.stubEnv("OPENAI_RESPONSES_BASE_URL", "https://custom.api.com/v1/");
      vi.stubEnv("OPENAI_RESPONSES_MODEL", "custom-model");
      vi.stubEnv("OPENAI_RESPONSES_TIMEOUT_MS", "30000");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ output_text: "ok", id: "r", usage: {} }), { status: 200 }),
      );

      await adapter.send(makeInput());
      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toBe("https://custom.api.com/v1/responses");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.model).toBe("custom-model");
      fetchSpy.mockRestore();
    });

    it("uses DB config values when present", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-db" });
      mockFindUnique.mockResolvedValue({
        value: {
          baseUrl: "https://db-api.com/v2",
          model: "db-model",
          timeoutMs: 60000,
          reasoningEffort: "high",
        },
      });

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ output_text: "ok", id: "r", usage: {} }), { status: 200 }),
      );

      await adapter.send(makeInput());
      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toBe("https://db-api.com/v2/responses");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.model).toBe("db-model");
      fetchSpy.mockRestore();
    });

    it("normalizes trailing slashes from base URL", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");
      vi.stubEnv("OPENAI_RESPONSES_BASE_URL", "https://api.com///");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ output_text: "ok", id: "r", usage: {} }), { status: 200 }),
      );

      await adapter.send(makeInput());
      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toBe("https://api.com/responses");
      fetchSpy.mockRestore();
    });

    it("enforces minimum timeout of 5000ms", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      mockFindUnique.mockResolvedValue({
        value: { timeoutMs: 100 },
      });

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ output_text: "ok", id: "r", usage: {} }), { status: 200 }),
      );

      // Should not throw even with very low timeout
      await adapter.send(makeInput());
      fetchSpy.mockRestore();
    });

    it("parses string timeout from env", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");
      vi.stubEnv("OPENAI_RESPONSES_TIMEOUT_MS", "15000");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ output_text: "ok", id: "r", usage: {} }), { status: 200 }),
      );

      await adapter.send(makeInput());
      // Verify it ran without error
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      fetchSpy.mockRestore();
    });
  });

  // ---- stream fallback when no response body ----

  describe("stream fallback when no response body", () => {
    it("falls back to send() when response has no body", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      // Create a Response with null body (simulates no streaming support)
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 200 }),
      );

      // Mock the second call (fallback send()) to return a proper response
      fetchSpy.mockResolvedValueOnce(
        new Response(null, { status: 200 }),
      ).mockResolvedValueOnce(
        new Response(JSON.stringify({
          output_text: "fallback text",
          id: "resp-fallback",
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        }), { status: 200 }),
      );

      const events: Array<{ type: string }> = [];
      for await (const event of adapter.stream(makeInput())) {
        events.push(event);
      }

      // Should have session, token, and done events from fallback
      expect(events.some((e) => e.type === "done")).toBe(true);

      fetchSpy.mockRestore();
    });
  });

  // ---- stream error handling ----

  describe("stream error on non-OK response", () => {
    it("throws on non-OK response in stream", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Internal Server Error", { status: 500 }),
      );

      await expect(async () => {
        for await (const _event of adapter.stream(makeInput())) {
          // consume
        }
      }).rejects.toThrow("openai-responses provider error 500");

      fetchSpy.mockRestore();
    });
  });

  // ---- reasoningEffortForRole coverage ----

  describe("reasoning effort per role", () => {
    it("uses medium effort for review_deep role", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ output_text: "ok", id: "r", usage: {} }), { status: 200 }),
      );

      await adapter.send(makeInput({ modelRole: "review_deep" }));

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.reasoning.effort).toBe("medium");
      fetchSpy.mockRestore();
    });

    it("uses high effort for overseer_escalation role", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ output_text: "ok", id: "r", usage: {} }), { status: 200 }),
      );

      await adapter.send(makeInput({ modelRole: "overseer_escalation" }));

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.reasoning.effort).toBe("high");
      fetchSpy.mockRestore();
    });

    it("uses medium effort for unknown role (default)", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ output_text: "ok", id: "r", usage: {} }), { status: 200 }),
      );

      await adapter.send(makeInput({ modelRole: "some_unknown_role" }));

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.reasoning.effort).toBe("medium");
      fetchSpy.mockRestore();
    });
  });

  // ---- helper functions ----

  describe("toStringOrNull edge cases", () => {
    it("handles non-string types in metadata gracefully", async () => {
      mockResolveSecretValue.mockResolvedValue({ value: "sk-key" });
      vi.stubEnv("OPENAI_API_KEY", "sk-key");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ output_text: "ok", id: "r", usage: {} }), { status: 200 }),
      );

      // metadata with non-string values for model, reasoningEffort, previousResponseId
      await adapter.send(makeInput({
        metadata: { model: 123, reasoningEffort: null, previousResponseId: undefined },
      }));

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      // Should fall back to config defaults
      expect(body.model).toBeTruthy();
      fetchSpy.mockRestore();
    });
  });
});

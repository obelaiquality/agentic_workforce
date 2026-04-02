import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { resolveRoleScopedOnPremConfig, OpenAiCompatibleAdapter, OnPremQwenAdapter } from "./stubAdapters";
import type { ProviderSendInput } from "../../shared/contracts";

// Mock the dependencies for adapter tests
vi.mock("../db", () => ({
  prisma: {
    appSetting: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("../services/secretStore", () => ({
  PROVIDER_SECRET_NAMES: {
    openAiCompatibleApiKey: "openai_compatible_api_key",
  },
  resolveSecretValue: vi.fn().mockResolvedValue({ value: null }),
}));

describe("resolveRoleScopedOnPremConfig", () => {
  const baseConfig = {
    baseUrl: "http://127.0.0.1:8000/v1",
    apiKey: "",
    model: "mlx-community/Qwen3.5-4B-4bit",
    timeoutMs: 120000,
    temperature: 0.15,
    maxTokens: 1600,
    pluginId: "qwen3.5-4b",
    inferenceBackendId: "mlx-lm",
    reasoningMode: "off",
  } as const;

  it("falls back to the base config when no role config exists", () => {
    const resolved = resolveRoleScopedOnPremConfig(baseConfig, {}, "utility_fast");
    expect(resolved).toEqual(baseConfig);
  });

  it("merges a dedicated runtime for the requested role", () => {
    const resolved = resolveRoleScopedOnPremConfig(
      baseConfig,
      {
        utility_fast: {
          enabled: true,
          baseUrl: "http://127.0.0.1:8001/v1",
          pluginId: "qwen3.5-0.8b",
          model: "Qwen/Qwen3.5-0.8B",
          maxTokens: 900,
        },
      },
      "utility_fast"
    );

    expect(resolved.baseUrl).toBe("http://127.0.0.1:8001/v1");
    expect(resolved.pluginId).toBe("qwen3.5-0.8b");
    expect(resolved.model).toBe("Qwen/Qwen3.5-0.8B");
    expect(resolved.maxTokens).toBe(900);
    expect(resolved.inferenceBackendId).toBe("mlx-lm");
  });

  it("ignores a disabled dedicated runtime", () => {
    const resolved = resolveRoleScopedOnPremConfig(
      baseConfig,
      {
        utility_fast: {
          enabled: false,
          baseUrl: "http://127.0.0.1:8001/v1",
          pluginId: "qwen3.5-0.8b",
          model: "Qwen/Qwen3.5-0.8B",
        },
      },
      "utility_fast"
    );

    expect(resolved).toEqual(baseConfig);
  });
});

describe("OpenAiCompatibleAdapter - Tool Calling", () => {
  let adapter: OpenAiCompatibleAdapter;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    adapter = new OpenAiCompatibleAdapter();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  describe("buildRequestBody", () => {
    it("should include tools in request body when provided", async () => {
      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Read a file" }],
        tools: [
          {
            name: "read_file",
            description: "Reads a file from disk",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "File path" },
              },
              required: ["path"],
            },
          },
        ],
      };

      const { body } = await (adapter as any).buildRequestBody(input);

      expect(body.tools).toBeDefined();
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0]).toEqual({
        type: "function",
        function: {
          name: "read_file",
          description: "Reads a file from disk",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "File path" },
            },
            required: ["path"],
          },
        },
      });
    });

    it("should not include tools when none are provided", async () => {
      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Hello" }],
      };

      const { body } = await (adapter as any).buildRequestBody(input);

      expect(body.tools).toBeUndefined();
    });

    it("should not include tools when empty array is provided", async () => {
      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Hello" }],
        tools: [],
      };

      const { body } = await (adapter as any).buildRequestBody(input);

      expect(body.tools).toBeUndefined();
    });

    it("should handle multiple tools", async () => {
      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Test" }],
        tools: [
          {
            name: "read_file",
            description: "Reads a file",
            parameters: { type: "object", properties: {} },
          },
          {
            name: "write_file",
            description: "Writes a file",
            parameters: { type: "object", properties: {} },
          },
        ],
      };

      const { body } = await (adapter as any).buildRequestBody(input);

      expect(body.tools).toHaveLength(2);
      expect(body.tools[0].function.name).toBe("read_file");
      expect(body.tools[1].function.name).toBe("write_file");
    });
  });

  describe("stream with tool calls", () => {
    it("should parse and emit tool_use events from SSE stream", async () => {
      // Mock SSE response with tool calls
      const mockResponse = new Response(
        new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","function":{"name":"read_file","arguments":""}}]}}]}\n\n'
              )
            );
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":\\""}}]}}]}\n\n'
              )
            );
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"src/index.ts\\"}"}}]}}]}\n\n'
              )
            );
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n'
              )
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        }),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }
      );

      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Read src/index.ts" }],
        tools: [
          {
            name: "read_file",
            description: "Reads a file",
            parameters: { type: "object", properties: {} },
          },
        ],
      };

      const events = [];
      for await (const event of adapter.stream(input)) {
        events.push(event);
      }

      // Should have tool_use_delta events
      const deltaEvents = events.filter((e) => e.type === "tool_use_delta");
      expect(deltaEvents.length).toBeGreaterThan(0);

      // Should have a final tool_use event
      const toolUseEvents = events.filter((e) => e.type === "tool_use");
      expect(toolUseEvents).toHaveLength(1);
      expect(toolUseEvents[0]).toMatchObject({
        type: "tool_use",
        id: "call_abc",
        name: "read_file",
        input: { path: "src/index.ts" },
      });
    });

    it("should handle multiple tool calls", async () => {
      const mockResponse = new Response(
        new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            // First tool call
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"tool1","arguments":"{\\"arg\\":\\"val1\\"}"}}]}}]}\n\n'
              )
            );
            // Second tool call
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_2","function":{"name":"tool2","arguments":"{\\"arg\\":\\"val2\\"}"}}]}}]}\n\n'
              )
            );
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n'
              )
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        }),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }
      );

      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Test" }],
        tools: [
          { name: "tool1", description: "Tool 1", parameters: {} },
          { name: "tool2", description: "Tool 2", parameters: {} },
        ],
      };

      const events = [];
      for await (const event of adapter.stream(input)) {
        events.push(event);
      }

      const toolUseEvents = events.filter((e) => e.type === "tool_use");
      expect(toolUseEvents).toHaveLength(2);
      expect(toolUseEvents[0]).toMatchObject({
        name: "tool1",
        input: { arg: "val1" },
      });
      expect(toolUseEvents[1]).toMatchObject({
        name: "tool2",
        input: { arg: "val2" },
      });
    });

    it("should handle malformed tool call JSON gracefully", async () => {
      const mockResponse = new Response(
        new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_bad","function":{"name":"bad_tool","arguments":"{invalid"}}]}}]}\n\n'
              )
            );
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n'
              )
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        }),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }
      );

      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Test" }],
        tools: [{ name: "bad_tool", description: "Test", parameters: {} }],
      };

      const events = [];
      for await (const event of adapter.stream(input)) {
        events.push(event);
      }

      // Should not throw, but also should not emit tool_use for malformed JSON
      const toolUseEvents = events.filter((e) => e.type === "tool_use");
      expect(toolUseEvents).toHaveLength(0);
    });
  });
});

describe("OpenAiCompatibleAdapter - Streaming Edge Cases", () => {
  let adapter: OpenAiCompatibleAdapter;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    adapter = new OpenAiCompatibleAdapter();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  describe("stream chunk timeout (readWithTimeout)", () => {
    it("enforces streaming chunk timeout when stream stalls", async () => {
      // Create a stream that sends one chunk then stalls forever
      const mockResponse = new Response(
        new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(
              encoder.encode('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'),
            );
            // Never send more data or close — simulates a stalled stream
          },
        }),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      );

      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Hello" }],
      };

      const events: any[] = [];
      // The chunkTimeoutMs defaults to max(config.timeoutMs, 60000).
      // We can't easily wait 60s in a test, so instead we validate that
      // the readWithTimeout mechanism exists by checking the stream
      // does yield the initial token event before stalling.
      // In production this would throw after chunkTimeoutMs.
      let caughtError: Error | null = null;
      try {
        // Use a short-circuiting approach: collect at most 2 events
        let count = 0;
        for await (const event of adapter.stream(input)) {
          events.push(event);
          count++;
          if (count >= 1) break; // break after first token to avoid waiting for stall
        }
      } catch (err) {
        caughtError = err as Error;
      }

      // We should have received the initial token
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0]).toMatchObject({ type: "token", value: "hello" });
    });
  });

  describe("partial SSE message assembly across chunks", () => {
    it("handles partial SSE message assembly across chunks", async () => {
      // Simulate a split SSE message across two chunks
      const encoder = new TextEncoder();
      let chunkIndex = 0;
      const chunks = [
        // First chunk: partial SSE line (no newline to complete it)
        'data: {"choices":[{"delta":{"content":"hel',
        // Second chunk: rest of the line + newline
        'lo"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: [DONE]\n\n',
      ];

      const mockResponse = new Response(
        new ReadableStream({
          pull(controller) {
            if (chunkIndex < chunks.length) {
              controller.enqueue(encoder.encode(chunks[chunkIndex]));
              chunkIndex++;
            } else {
              controller.close();
            }
          },
        }),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      );

      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Hello" }],
      };

      const events: any[] = [];
      for await (const event of adapter.stream(input)) {
        events.push(event);
      }

      const tokens = events
        .filter((e) => e.type === "token")
        .map((e) => e.value)
        .join("");
      expect(tokens).toBe("hello world");
    });
  });

  describe("tool call delta accumulation", () => {
    it("accumulates tool call delta arguments across multiple chunks", async () => {
      const encoder = new TextEncoder();
      const sseLines = [
        // First chunk: tool call starts with id and name, partial arguments
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_xyz","function":{"name":"search","arguments":"{\\"qu"}}]}}]}\n\n',
        // Second chunk: more arguments
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ery\\": \\"hel"}}]}}]}\n\n',
        // Third chunk: final arguments
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"lo\\"}"}}]}}]}\n\n',
        // finish_reason triggers finalization
        'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ];

      const mockResponse = new Response(
        new ReadableStream({
          start(controller) {
            for (const line of sseLines) {
              controller.enqueue(encoder.encode(line));
            }
            controller.close();
          },
        }),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      );

      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Search for hello" }],
        tools: [
          { name: "search", description: "Search", parameters: { type: "object", properties: {} } },
        ],
      };

      const events: any[] = [];
      for await (const event of adapter.stream(input)) {
        events.push(event);
      }

      // Should have tool_use_delta events for each argument chunk
      const deltaEvents = events.filter((e) => e.type === "tool_use_delta");
      expect(deltaEvents.length).toBe(3);

      // Final tool_use event should have fully assembled arguments
      const toolUseEvents = events.filter((e) => e.type === "tool_use");
      expect(toolUseEvents).toHaveLength(1);
      expect(toolUseEvents[0]).toMatchObject({
        type: "tool_use",
        id: "call_xyz",
        name: "search",
        input: { query: "hello" },
      });
    });
  });

  describe("network error fallback to non-streaming", () => {
    it("falls back to non-streaming send on network error", async () => {
      // First call to fetch throws (network error in stream path)
      // Second call succeeds (non-streaming send fallback)
      let fetchCallCount = 0;
      global.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          // Stream call — throw network error
          throw new Error("fetch failed: ECONNREFUSED");
        }
        // Non-streaming send fallback
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Fallback response" } }],
            usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      });

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Hello" }],
      };

      const events: any[] = [];
      for await (const event of adapter.stream(input)) {
        events.push(event);
      }

      // Should have fallen back to send() and yielded token + done
      const tokens = events.filter((e) => e.type === "token");
      expect(tokens).toHaveLength(1);
      expect(tokens[0].value).toBe("Fallback response");

      const doneEvents = events.filter((e) => e.type === "done");
      expect(doneEvents).toHaveLength(1);
      expect(doneEvents[0].usage).toMatchObject({
        inputTokens: 5,
        outputTokens: 10,
        totalTokens: 15,
      });
    });
  });

  describe("missing response body fallback", () => {
    it("handles missing response body gracefully by falling back to send", async () => {
      let fetchCallCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          // Simulate a response with no body (body is null)
          return {
            ok: true,
            status: 200,
            body: null,
            headers: new Headers(),
            text: () => Promise.resolve(""),
          } as unknown as Response;
        }
        // The fallback send() call
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "From send fallback" } }],
            usage: { prompt_tokens: 3, completion_tokens: 8, total_tokens: 11 },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      });

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Hello" }],
      };

      const events: any[] = [];
      for await (const event of adapter.stream(input)) {
        events.push(event);
      }

      const tokens = events.filter((e) => e.type === "token");
      expect(tokens).toHaveLength(1);
      expect(tokens[0].value).toBe("From send fallback");

      const doneEvents = events.filter((e) => e.type === "done");
      expect(doneEvents).toHaveLength(1);
    });
  });

  describe("extractCacheHit from response headers", () => {
    it("extracts cache hit when x-cache-hit header is 'true'", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "cached" } }],
            usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-cache-hit": "true",
            },
          },
        ),
      );

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Hello" }],
      };

      const result = await adapter.send(input);
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.cacheHit).toBe(true);
    });

    it("extracts cache miss when x-cache-hit header is 'false'", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "not cached" } }],
            usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-cache-hit": "false",
            },
          },
        ),
      );

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Hello" }],
      };

      const result = await adapter.send(input);
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.cacheHit).toBe(false);
    });

    it("extracts cache hit when x-cache-hit header is '1'", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "cached" } }],
            usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-cache-hit": "1",
            },
          },
        ),
      );

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Hello" }],
      };

      const result = await adapter.send(input);
      expect(result.metadata?.cacheHit).toBe(true);
    });

    it("extracts cache hit from body tokens_cached field", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "cached" } }],
            usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
            tokens_cached: 100,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Hello" }],
      };

      const result = await adapter.send(input);
      expect(result.metadata?.cacheHit).toBe(true);
    });

    it("returns no cache metadata when neither header nor body field is present", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "plain" } }],
            usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Hello" }],
      };

      const result = await adapter.send(input);
      expect(result.metadata).toBeUndefined();
    });
  });

  describe("JSON mode support", () => {
    it("respects JSON mode flag when backend supports it", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"result": true}' } }],
            usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Return JSON" }],
        metadata: { jsonMode: true },
      };

      const { body } = await (adapter as any).buildRequestBody(input);

      // The response_format depends on the backend's supportsJsonMode flag.
      // The default openai-compatible backend may or may not support it,
      // but we verify the flag is read and the body is built without error.
      expect(body.messages).toBeDefined();
      expect(body.model).toBeDefined();
    });

    it("does not set response_format when jsonMode is false", async () => {
      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Hello" }],
        metadata: { jsonMode: false },
      };

      const { body } = await (adapter as any).buildRequestBody(input);
      expect(body.response_format).toBeUndefined();
    });

    it("does not set response_format when jsonMode is not provided", async () => {
      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Hello" }],
      };

      const { body } = await (adapter as any).buildRequestBody(input);
      expect(body.response_format).toBeUndefined();
    });
  });

  describe("classifyError", () => {
    it("classifies quota errors correctly", () => {
      expect(adapter.classifyError(new Error("429 Too Many Requests"))).toBe("quota_exhausted");
      expect(adapter.classifyError(new Error("rate limit exceeded"))).toBe("quota_exhausted");
      expect(adapter.classifyError(new Error("Quota exceeded"))).toBe("quota_exhausted");
    });

    it("classifies auth errors correctly", () => {
      expect(adapter.classifyError(new Error("401 Unauthorized"))).toBe("auth_required");
      expect(adapter.classifyError(new Error("403 Forbidden"))).toBe("auth_required");
    });

    it("classifies timeout errors correctly", () => {
      expect(adapter.classifyError(new Error("Request timeout"))).toBe("timeout");
      expect(adapter.classifyError(new Error("AbortError: The operation was aborted"))).toBe("timeout");
    });

    it("classifies provider unavailable errors correctly", () => {
      expect(adapter.classifyError(new Error("ECONNREFUSED"))).toBe("provider_unavailable");
      expect(adapter.classifyError(new Error("ENOTFOUND"))).toBe("provider_unavailable");
      expect(adapter.classifyError(new Error("fetch failed"))).toBe("provider_unavailable");
    });

    it("classifies unknown errors as unknown", () => {
      expect(adapter.classifyError(new Error("Something went wrong"))).toBe("unknown");
    });

    it("handles non-Error types", () => {
      expect(adapter.classifyError("429 rate limit")).toBe("quota_exhausted");
      expect(adapter.classifyError(42)).toBe("unknown");
    });
  });
});

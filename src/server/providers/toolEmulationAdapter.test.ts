import { describe, it, expect, vi } from "vitest";
import { ToolEmulationAdapter, wrapWithToolEmulation } from "./toolEmulationAdapter";
import type { LlmProviderAdapter, ProviderSendInput, ProviderStreamEvent } from "../../shared/contracts";

describe("ToolEmulationAdapter", () => {
  const createMockAdapter = (supportsTools = false): LlmProviderAdapter => ({
    id: "test-provider" as const,
    label: "Test Provider",
    capabilities: {
      streaming: true,
      tools: supportsTools,
      nativeConversationState: false,
      structuredOutputs: false,
      mcpTools: false,
    },
    supportsStreaming: true,
    supportsTools,
    createSession: vi.fn(),
    send: vi.fn(),
    stream: vi.fn(),
    classifyError: vi.fn(),
    estimateAvailability: vi.fn(),
  });

  describe("wrapWithToolEmulation", () => {
    it("should not wrap adapters that already support tools", () => {
      const adapter = createMockAdapter(true);
      const wrapped = wrapWithToolEmulation(adapter);
      expect(wrapped).toBe(adapter);
    });

    it("should wrap adapters that don't support tools", () => {
      const adapter = createMockAdapter(false);
      const wrapped = wrapWithToolEmulation(adapter);
      expect(wrapped).toBeInstanceOf(ToolEmulationAdapter);
    });
  });

  describe("delegated properties and methods", () => {
    it("id delegates to base adapter", () => {
      const base = createMockAdapter(false);
      const adapter = new ToolEmulationAdapter(base);
      expect(adapter.id).toBe("test-provider");
    });

    it("label appends (Tool Emulation)", () => {
      const base = createMockAdapter(false);
      const adapter = new ToolEmulationAdapter(base);
      expect(adapter.label).toBe("Test Provider (Tool Emulation)");
    });

    it("capabilities overrides tools to true", () => {
      const base = createMockAdapter(false);
      const adapter = new ToolEmulationAdapter(base);
      expect(adapter.capabilities.tools).toBe(true);
      expect(adapter.capabilities.streaming).toBe(true);
    });

    it("supportsStreaming delegates to base adapter", () => {
      const base = createMockAdapter(false);
      const adapter = new ToolEmulationAdapter(base);
      expect(adapter.supportsStreaming).toBe(true);
    });

    it("supportsTools always returns true", () => {
      const base = createMockAdapter(false);
      const adapter = new ToolEmulationAdapter(base);
      expect(adapter.supportsTools).toBe(true);
    });

    it("createSession delegates to base adapter", async () => {
      const base = createMockAdapter(false);
      const mockSession = { id: "session-1" };
      (base.createSession as ReturnType<typeof vi.fn>).mockResolvedValue(mockSession);
      const adapter = new ToolEmulationAdapter(base);
      const result = await adapter.createSession({ accountId: "acc-1" } as any);
      expect(result).toBe(mockSession);
      expect(base.createSession).toHaveBeenCalledWith({ accountId: "acc-1" });
    });

    it("classifyError delegates to base adapter", () => {
      const base = createMockAdapter(false);
      (base.classifyError as ReturnType<typeof vi.fn>).mockReturnValue("transient");
      const adapter = new ToolEmulationAdapter(base);
      const result = adapter.classifyError(new Error("test"));
      expect(result).toBe("transient");
      expect(base.classifyError).toHaveBeenCalled();
    });

    it("estimateAvailability delegates to base adapter", async () => {
      const base = createMockAdapter(false);
      const availability = { available: true, latencyMs: 50 };
      (base.estimateAvailability as ReturnType<typeof vi.fn>).mockResolvedValue(availability);
      const adapter = new ToolEmulationAdapter(base);
      const result = await adapter.estimateAvailability("acc-1");
      expect(result).toBe(availability);
      expect(base.estimateAvailability).toHaveBeenCalledWith("acc-1");
    });
  });

  describe("send", () => {
    it("should inject tool schemas into system prompt", async () => {
      const baseAdapter = createMockAdapter(false);
      const mockSend = vi.fn().mockResolvedValue({
        text: "I'll help you read that file.",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      });
      baseAdapter.send = mockSend;

      const emulationAdapter = new ToolEmulationAdapter(baseAdapter);

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Read src/index.ts" },
        ],
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

      await emulationAdapter.send(input);

      expect(mockSend).toHaveBeenCalledWith({
        ...input,
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining("read_file"),
          }),
        ]),
        tools: undefined,
      });
    });

    it("should parse tool calls from response text", async () => {
      const baseAdapter = createMockAdapter(false);
      const mockSend = vi.fn().mockResolvedValue({
        text: `I'll read that file for you.

<tool_call>
{"name": "read_file", "arguments": {"path": "src/index.ts"}}
</tool_call>`,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      });
      baseAdapter.send = mockSend;

      const emulationAdapter = new ToolEmulationAdapter(baseAdapter);

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

      const result = await emulationAdapter.send(input);

      expect(result.metadata?.emulatedToolCalls).toEqual([
        {
          id: expect.stringMatching(/^emulated_\d+_0$/),
          name: "read_file",
          input: { path: "src/index.ts" },
        },
      ]);
    });

    it("should handle malformed tool call JSON gracefully", async () => {
      const baseAdapter = createMockAdapter(false);
      const mockSend = vi.fn().mockResolvedValue({
        text: `<tool_call>
{invalid json
</tool_call>`,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      });
      baseAdapter.send = mockSend;

      const emulationAdapter = new ToolEmulationAdapter(baseAdapter);

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Test" }],
        tools: [{ name: "test_tool", description: "Test", parameters: {} }],
      };

      const result = await emulationAdapter.send(input);

      expect(result.metadata?.emulatedToolCalls).toBeUndefined();
    });

    it("should inject tool schemas as new system message when none exists", async () => {
      const baseAdapter = createMockAdapter(false);
      const mockSend = vi.fn().mockResolvedValue({
        text: "Done.",
        usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
      });
      baseAdapter.send = mockSend;

      const emulationAdapter = new ToolEmulationAdapter(baseAdapter);

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [
          { role: "user", content: "Do something" },
        ],
        tools: [
          {
            name: "write_file",
            description: "Writes a file",
            parameters: { type: "object", properties: {} },
          },
        ],
      };

      await emulationAdapter.send(input);

      const sentMessages = mockSend.mock.calls[0][0].messages;
      // A system message should have been prepended
      expect(sentMessages[0].role).toBe("system");
      expect(sentMessages[0].content).toContain("write_file");
      // Original user message should follow
      expect(sentMessages[1].role).toBe("user");
    });

    it("should use parsed.input when arguments is not present", async () => {
      const baseAdapter = createMockAdapter(false);
      const mockSend = vi.fn().mockResolvedValue({
        text: `<tool_call>
{"name": "my_tool", "input": {"key": "value"}}
</tool_call>`,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      });
      baseAdapter.send = mockSend;

      const emulationAdapter = new ToolEmulationAdapter(baseAdapter);

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Test" }],
        tools: [{ name: "my_tool", description: "A tool", parameters: {} }],
      };

      const result = await emulationAdapter.send(input);

      expect(result.metadata?.emulatedToolCalls).toEqual([
        {
          id: expect.stringMatching(/^emulated_\d+_0$/),
          name: "my_tool",
          input: { key: "value" },
        },
      ]);
    });

    it("should fall back to empty object when neither arguments nor input is present", async () => {
      const baseAdapter = createMockAdapter(false);
      const mockSend = vi.fn().mockResolvedValue({
        text: `<tool_call>
{"name": "no_args_tool"}
</tool_call>`,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      });
      baseAdapter.send = mockSend;

      const emulationAdapter = new ToolEmulationAdapter(baseAdapter);

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Test" }],
        tools: [{ name: "no_args_tool", description: "Tool", parameters: {} }],
      };

      const result = await emulationAdapter.send(input);

      expect(result.metadata?.emulatedToolCalls).toEqual([
        {
          id: expect.stringMatching(/^emulated_\d+_0$/),
          name: "no_args_tool",
          input: {},
        },
      ]);
    });

    it("should skip parsed objects without a name field", async () => {
      const baseAdapter = createMockAdapter(false);
      const mockSend = vi.fn().mockResolvedValue({
        text: `<tool_call>
{"arguments": {"key": "value"}}
</tool_call>`,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      });
      baseAdapter.send = mockSend;

      const emulationAdapter = new ToolEmulationAdapter(baseAdapter);

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Test" }],
        tools: [{ name: "test_tool", description: "Test", parameters: {} }],
      };

      const result = await emulationAdapter.send(input);

      // No tool calls should be emitted because the parsed JSON has no name
      expect(result.metadata?.emulatedToolCalls).toBeUndefined();
    });

    it("should not modify response when no tools are provided", async () => {
      const baseAdapter = createMockAdapter(false);
      const mockSend = vi.fn().mockResolvedValue({
        text: "Hello, world!",
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
      });
      baseAdapter.send = mockSend;

      const emulationAdapter = new ToolEmulationAdapter(baseAdapter);

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Hello" }],
      };

      const result = await emulationAdapter.send(input);

      expect(result.text).toBe("Hello, world!");
      expect(result.metadata?.emulatedToolCalls).toBeUndefined();
    });
  });

  describe("stream", () => {
    it("should emit tool_use events after streaming completes", async () => {
      const baseAdapter = createMockAdapter(false);
      const mockStream = async function* (): AsyncGenerator<ProviderStreamEvent> {
        yield { type: "token", value: "I'll help you.\n\n" };
        yield { type: "token", value: "<tool_call>\n" };
        yield { type: "token", value: '{"name": "read_file", "arguments": {"path": "test.ts"}}\n' };
        yield { type: "token", value: "</tool_call>" };
        yield { type: "done", usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } };
      };
      baseAdapter.stream = mockStream;

      const emulationAdapter = new ToolEmulationAdapter(baseAdapter);

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Read test.ts" }],
        tools: [
          {
            name: "read_file",
            description: "Reads a file",
            parameters: { type: "object", properties: {} },
          },
        ],
      };

      const events: ProviderStreamEvent[] = [];
      for await (const event of emulationAdapter.stream(input)) {
        events.push(event);
      }

      // Should have token events, done event, and tool_use event
      expect(events).toContainEqual({
        type: "tool_use",
        id: expect.stringMatching(/^emulated_\d+_0$/),
        name: "read_file",
        input: { path: "test.ts" },
      });
    });

    it("should parse multiple tool calls", async () => {
      const baseAdapter = createMockAdapter(false);
      const mockStream = async function* (): AsyncGenerator<ProviderStreamEvent> {
        yield { type: "token", value: '<tool_call>{"name": "tool1", "arguments": {"arg": "val1"}}</tool_call>' };
        yield { type: "token", value: '<tool_call>{"name": "tool2", "arguments": {"arg": "val2"}}</tool_call>' };
        yield { type: "done" };
      };
      baseAdapter.stream = mockStream;

      const emulationAdapter = new ToolEmulationAdapter(baseAdapter);

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Test" }],
        tools: [
          { name: "tool1", description: "Tool 1", parameters: {} },
          { name: "tool2", description: "Tool 2", parameters: {} },
        ],
      };

      const events: ProviderStreamEvent[] = [];
      for await (const event of emulationAdapter.stream(input)) {
        events.push(event);
      }

      const toolUseEvents = events.filter((e) => e.type === "tool_use");
      expect(toolUseEvents).toHaveLength(2);
      expect(toolUseEvents[0]).toMatchObject({
        type: "tool_use",
        name: "tool1",
        input: { arg: "val1" },
      });
      expect(toolUseEvents[1]).toMatchObject({
        type: "tool_use",
        name: "tool2",
        input: { arg: "val2" },
      });
    });

    it("should emit tool_use events BEFORE done event (critical ordering)", async () => {
      const baseAdapter = createMockAdapter(false);
      const mockStream = async function* (): AsyncGenerator<ProviderStreamEvent> {
        yield { type: "token", value: "<tool_call>\n" };
        yield { type: "token", value: '{"name": "read_file", "arguments": {"path": "test.ts"}}\n' };
        yield { type: "token", value: "</tool_call>" };
        yield { type: "done", usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } };
      };
      baseAdapter.stream = mockStream;

      const emulationAdapter = new ToolEmulationAdapter(baseAdapter);

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Read test.ts" }],
        tools: [
          {
            name: "read_file",
            description: "Reads a file",
            parameters: { type: "object", properties: {} },
          },
        ],
      };

      const events: ProviderStreamEvent[] = [];
      for await (const event of emulationAdapter.stream(input)) {
        events.push(event);
      }

      const toolUseIndex = events.findIndex((e) => e.type === "tool_use");
      const doneIndex = events.findIndex((e) => e.type === "done");

      expect(toolUseIndex).toBeGreaterThan(-1);
      expect(doneIndex).toBeGreaterThan(-1);
      expect(toolUseIndex).toBeLessThan(doneIndex);
    });

    it("should pass through events when no tools provided", async () => {
      const baseAdapter = createMockAdapter(false);
      const mockStream = async function* (): AsyncGenerator<ProviderStreamEvent> {
        yield { type: "token", value: "Hello" };
        yield { type: "token", value: " world" };
        yield { type: "done" };
      };
      baseAdapter.stream = mockStream;

      const emulationAdapter = new ToolEmulationAdapter(baseAdapter);

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Hello" }],
      };

      const events: ProviderStreamEvent[] = [];
      for await (const event of emulationAdapter.stream(input)) {
        events.push(event);
      }

      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({ type: "token", value: "Hello" });
      expect(events[1]).toEqual({ type: "token", value: " world" });
      expect(events[2]).toEqual({ type: "done" });
    });

    it("should handle malformed JSON in tool call gracefully during streaming", async () => {
      const baseAdapter = createMockAdapter(false);
      const mockStream = async function* (): AsyncGenerator<ProviderStreamEvent> {
        yield { type: "token", value: "<tool_call>\n" };
        yield { type: "token", value: "{invalid json\n" };
        yield { type: "token", value: "</tool_call>\n" };
        yield { type: "token", value: "<tool_call>\n" };
        yield { type: "token", value: '{"name": "read_file", "arguments": {"path": "valid.ts"}}\n' };
        yield { type: "token", value: "</tool_call>" };
        yield { type: "done" };
      };
      baseAdapter.stream = mockStream;

      const emulationAdapter = new ToolEmulationAdapter(baseAdapter);

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Test" }],
        tools: [{ name: "read_file", description: "Reads a file", parameters: {} }],
      };

      const events: ProviderStreamEvent[] = [];
      for await (const event of emulationAdapter.stream(input)) {
        events.push(event);
      }

      const toolUseEvents = events.filter((e) => e.type === "tool_use");
      expect(toolUseEvents).toHaveLength(1);
      expect(toolUseEvents[0]).toMatchObject({
        type: "tool_use",
        name: "read_file",
        input: { path: "valid.ts" },
      });
    });

    it("should handle stream with no done event", async () => {
      const baseAdapter = createMockAdapter(false);
      const mockStream = async function* (): AsyncGenerator<ProviderStreamEvent> {
        yield { type: "token", value: "Hello" };
        // No done event
      };
      baseAdapter.stream = mockStream;

      const emulationAdapter = new ToolEmulationAdapter(baseAdapter);

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Hello" }],
      };

      const events: ProviderStreamEvent[] = [];
      for await (const event of emulationAdapter.stream(input)) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: "token", value: "Hello" });
    });

    it("should generate unique IDs across multiple tool calls", async () => {
      const baseAdapter = createMockAdapter(false);
      const mockStream = async function* (): AsyncGenerator<ProviderStreamEvent> {
        yield { type: "token", value: '<tool_call>{"name": "tool1", "arguments": {}}</tool_call>' };
        yield { type: "token", value: '<tool_call>{"name": "tool2", "arguments": {}}</tool_call>' };
        yield { type: "token", value: '<tool_call>{"name": "tool3", "arguments": {}}</tool_call>' };
        yield { type: "done" };
      };
      baseAdapter.stream = mockStream;

      const emulationAdapter = new ToolEmulationAdapter(baseAdapter);

      const input: ProviderSendInput = {
        sessionId: "test-session",
        accountId: "test-account",
        messages: [{ role: "user", content: "Test" }],
        tools: [
          { name: "tool1", description: "Tool 1", parameters: {} },
          { name: "tool2", description: "Tool 2", parameters: {} },
          { name: "tool3", description: "Tool 3", parameters: {} },
        ],
      };

      const events: ProviderStreamEvent[] = [];
      for await (const event of emulationAdapter.stream(input)) {
        events.push(event);
      }

      const toolUseEvents = events.filter((e) => e.type === "tool_use");
      const ids = toolUseEvents.map((e) => (e.type === "tool_use" ? e.id : ""));

      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3); // All unique
      expect(ids[0]).toMatch(/^emulated_\d+_0$/);
      expect(ids[1]).toMatch(/^emulated_\d+_1$/);
      expect(ids[2]).toMatch(/^emulated_\d+_2$/);
    });
  });
});

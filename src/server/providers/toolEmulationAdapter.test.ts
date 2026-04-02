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

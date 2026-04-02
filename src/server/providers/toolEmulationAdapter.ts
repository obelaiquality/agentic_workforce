import type {
  CreateSessionInput,
  LlmProviderAdapter,
  ProviderAvailability,
  ProviderErrorClass,
  ProviderSendInput,
  ProviderSendOutput,
  ProviderSession,
  ProviderStreamEvent,
} from "../../shared/contracts";

/**
 * ToolEmulationAdapter wraps any LlmProviderAdapter that doesn't support native tool calling.
 * It injects tool schemas into the system prompt and parses model output for tool call blocks.
 *
 * Expected format in model output:
 * <tool_call>
 * {"name": "read_file", "arguments": {"path": "src/index.ts"}}
 * </tool_call>
 */
export class ToolEmulationAdapter implements LlmProviderAdapter {
  constructor(private readonly baseAdapter: LlmProviderAdapter) {}

  get id() {
    return this.baseAdapter.id;
  }

  get label() {
    return `${this.baseAdapter.label} (Tool Emulation)`;
  }

  get capabilities() {
    return {
      ...this.baseAdapter.capabilities,
      tools: true, // Override to indicate tool support via emulation
    };
  }

  get supportsStreaming() {
    return this.baseAdapter.supportsStreaming;
  }

  get supportsTools() {
    return true; // Emulated support
  }

  async createSession(input: CreateSessionInput): Promise<ProviderSession> {
    return this.baseAdapter.createSession(input);
  }

  classifyError(err: unknown): ProviderErrorClass {
    return this.baseAdapter.classifyError(err);
  }

  async estimateAvailability(accountId: string): Promise<ProviderAvailability> {
    return this.baseAdapter.estimateAvailability(accountId);
  }

  /**
   * Injects tool schemas into the system prompt.
   */
  private injectToolsIntoSystemPrompt(input: ProviderSendInput): ProviderSendInput {
    if (!input.tools || input.tools.length === 0) {
      return input;
    }

    const toolDescriptions = input.tools
      .map((tool) => {
        return `Tool: ${tool.name}\nDescription: ${tool.description}\nParameters: ${JSON.stringify(tool.parameters, null, 2)}`;
      })
      .join("\n\n");

    const toolInstructions = `
You have access to the following tools. To use a tool, output a <tool_call> block with JSON:

${toolDescriptions}

Example:
<tool_call>
{"name": "read_file", "arguments": {"path": "src/index.ts"}}
</tool_call>

Important:
- Only use tools when needed to accomplish the user's request
- Output valid JSON inside <tool_call> tags
- You can call multiple tools by outputting multiple <tool_call> blocks
- After tool calls, wait for results before proceeding
`;

    const messages = [...input.messages];
    const systemIndex = messages.findIndex((m) => m.role === "system");

    if (systemIndex >= 0) {
      messages[systemIndex] = {
        ...messages[systemIndex],
        content: messages[systemIndex].content + "\n\n" + toolInstructions,
      };
    } else {
      messages.unshift({
        role: "system",
        content: toolInstructions,
      });
    }

    return {
      ...input,
      messages,
      tools: undefined, // Remove tools from input to avoid passing to base adapter
    };
  }

  /**
   * Parses tool call blocks from text output.
   */
  private parseToolCalls(text: string): Array<{ id: string; name: string; input: unknown }> {
    const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
    const regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
    let match: RegExpExecArray | null;
    let callIndex = 0;

    while ((match = regex.exec(text)) !== null) {
      const jsonStr = match[1].trim();
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed && typeof parsed === "object" && "name" in parsed) {
          const name = String(parsed.name);
          const args = parsed.arguments || parsed.input || {};
          toolCalls.push({
            id: `emulated_${Date.now()}_${callIndex++}`,
            name,
            input: args,
          });
        }
      } catch {
        // Malformed JSON in tool_call block — skip
      }
    }

    return toolCalls;
  }

  async send(input: ProviderSendInput): Promise<ProviderSendOutput> {
    const modifiedInput = this.injectToolsIntoSystemPrompt(input);
    const output = await this.baseAdapter.send(modifiedInput);

    // Parse tool calls from output text if tools were provided
    if (input.tools && input.tools.length > 0) {
      const toolCalls = this.parseToolCalls(output.text);
      if (toolCalls.length > 0) {
        // Store tool calls in metadata for caller to handle
        return {
          ...output,
          metadata: {
            ...output.metadata,
            emulatedToolCalls: toolCalls,
          },
        };
      }
    }

    return output;
  }

  async *stream(input: ProviderSendInput): AsyncGenerator<ProviderStreamEvent> {
    const modifiedInput = this.injectToolsIntoSystemPrompt(input);
    let accumulatedText = "";
    let bufferedDoneEvent: ProviderStreamEvent | null = null;

    // Stream from base adapter
    for await (const event of this.baseAdapter.stream(modifiedInput)) {
      if (event.type === "token") {
        accumulatedText += event.value;
      }

      // Buffer the done event instead of yielding it immediately
      if (event.type === "done") {
        bufferedDoneEvent = event;
      } else {
        yield event;
      }
    }

    // After streaming completes, parse accumulated text for tool calls
    if (input.tools && input.tools.length > 0) {
      const toolCalls = this.parseToolCalls(accumulatedText);
      for (const toolCall of toolCalls) {
        yield {
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input,
        };
      }
    }

    // Yield the buffered done event last
    if (bufferedDoneEvent) {
      yield bufferedDoneEvent;
    }
  }
}

/**
 * Wraps an adapter with tool emulation if it doesn't support native tools.
 */
export function wrapWithToolEmulation(adapter: LlmProviderAdapter): LlmProviderAdapter {
  if (adapter.supportsTools) {
    return adapter; // Already supports tools natively
  }
  return new ToolEmulationAdapter(adapter);
}

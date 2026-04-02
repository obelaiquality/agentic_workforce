import { z } from "zod";
import type { ToolDefinition, ToolJsonSchema, ToolContext, ToolResult } from "./types";

// ---------------------------------------------------------------------------
// Zod → JSON Schema converter (lightweight, no external deps)
// ---------------------------------------------------------------------------

function zodToJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodType<unknown>>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) {
        required.push(key);
      }
    }
    return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
  }
  if (schema instanceof z.ZodString) return { type: "string", description: schema.description ?? undefined };
  if (schema instanceof z.ZodNumber) return { type: "number", description: schema.description ?? undefined };
  if (schema instanceof z.ZodBoolean) return { type: "boolean", description: schema.description ?? undefined };
  if (schema instanceof z.ZodArray) return { type: "array", items: zodToJsonSchema((schema as z.ZodArray<z.ZodType<unknown>>).element) };
  if (schema instanceof z.ZodOptional) return zodToJsonSchema((schema as z.ZodOptional<z.ZodType<unknown>>).unwrap());
  if (schema instanceof z.ZodDefault) return zodToJsonSchema((schema as z.ZodDefault<z.ZodType<unknown>>).removeDefault());
  if (schema instanceof z.ZodEnum) return { type: "string", enum: (schema as z.ZodEnum<[string, ...string[]]>).options };
  if (schema instanceof z.ZodLiteral) return { type: typeof schema.value, const: schema.value };
  if (schema instanceof z.ZodUnion) {
    const options = (schema as z.ZodUnion<[z.ZodType<unknown>, ...z.ZodType<unknown>[]]>).options;
    return { oneOf: options.map(zodToJsonSchema) };
  }
  // Fallback for types we don't handle
  return { type: "string" };
}

// ---------------------------------------------------------------------------
// Tool Registry
// ---------------------------------------------------------------------------

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private aliasMap = new Map<string, string>();

  /** Register a tool definition */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    if (tool.aliases) {
      for (const alias of tool.aliases) {
        this.aliasMap.set(alias, tool.name);
      }
    }
  }

  /** Register multiple tools at once */
  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /** Unregister a tool definition by name */
  unregister(name: string): void {
    const tool = this.tools.get(name);
    if (!tool) {
      return;
    }
    this.tools.delete(name);
    if (tool.aliases) {
      for (const alias of tool.aliases) {
        this.aliasMap.delete(alias);
      }
    }
  }

  /** Unregister multiple tools */
  unregisterAll(names: string[]): void {
    for (const name of names) {
      this.unregister(name);
    }
  }

  /** Get a tool by name or alias */
  get(name: string): ToolDefinition | undefined {
    const tool = this.tools.get(name);
    if (tool) return tool;
    const canonical = this.aliasMap.get(name);
    return canonical ? this.tools.get(canonical) : undefined;
  }

  /** Check if a tool exists */
  has(name: string): boolean {
    return this.tools.has(name) || this.aliasMap.has(name);
  }

  /** List all registered tools */
  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /** List tools enabled for a specific execution context */
  listEnabled(ctx?: ToolContext): ToolDefinition[] {
    const tools = this.list();
    if (!ctx) {
      return tools;
    }
    return tools.filter((tool) => !tool.isEnabled || tool.isEnabled(ctx));
  }

  /** List tool names */
  names(): string[] {
    return Array.from(this.tools.keys());
  }

  /** Get tools that should be in the initial prompt (not deferred) */
  getInitialTools(): ToolDefinition[] {
    return this.list().filter((t) => t.alwaysLoad !== false);
  }

  /** Get initial tools enabled for a specific execution context */
  getInitialToolsForContext(ctx?: ToolContext): ToolDefinition[] {
    return this.listEnabled(ctx).filter((t) => t.alwaysLoad !== false);
  }

  /** Get tools that are deferred (loaded on demand via tool_search) */
  getDeferredTools(): ToolDefinition[] {
    return this.list().filter((t) => t.alwaysLoad === false);
  }

  /** Get deferred tools enabled for a specific execution context */
  getDeferredToolsForContext(ctx?: ToolContext): ToolDefinition[] {
    return this.listEnabled(ctx).filter((t) => t.alwaysLoad === false);
  }

  /** Get deferred tool names with descriptions (for tool_search prompt) */
  getDeferredToolSummaries(): Array<{ name: string; description: string }> {
    return this.getDeferredTools().map((t) => ({
      name: t.name,
      description: t.description,
    }));
  }

  /**
   * Search tools by keyword query (for tool_search tool).
   * Uses bag-of-words cosine similarity over name, description, and searchHints.
   */
  searchTools(query: string, maxResults = 5): ToolDefinition[] {
    const queryTokens = tokenize(query);
    if (queryTokens.size === 0) return [];

    const scored = this.list().map((tool) => {
      const toolTokens = tokenize(
        [tool.name, tool.description, ...(tool.searchHints || [])].join(" ")
      );
      const score = cosineSimilarity(queryTokens, toolTokens);
      return { tool, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map((s) => s.tool);
  }

  /** Convert a tool to JSON schema for the LLM API */
  toJsonSchema(tool: ToolDefinition): ToolJsonSchema {
    return {
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.inputSchema),
    };
  }

  /** Convert all initial tools to JSON schemas for the LLM API */
  toJsonSchemas(): ToolJsonSchema[] {
    return this.getInitialTools().map((t) => this.toJsonSchema(t));
  }

  /** Convert all initial tools enabled for a specific context to JSON schemas */
  toJsonSchemasForContext(ctx?: ToolContext): ToolJsonSchema[] {
    return this.getInitialToolsForContext(ctx).map((t) => this.toJsonSchema(t));
  }

  /** Convert specific tools to JSON schemas */
  toJsonSchemasFor(toolNames: string[]): ToolJsonSchema[] {
    return toolNames
      .map((name) => this.get(name))
      .filter((t): t is ToolDefinition => t !== undefined)
      .map((t) => this.toJsonSchema(t));
  }

  /**
   * Validate input against a tool's schema and execute it.
   * Returns ToolResultError if validation fails or tool not found.
   */
  async executeValidated(
    toolName: string,
    rawInput: unknown,
    ctx: ToolContext
  ): Promise<ToolResult & { durationMs: number }> {
    const start = Date.now();
    const tool = this.get(toolName);

    if (!tool) {
      return {
        type: "error",
        error: `Unknown tool: ${toolName}. Available tools: ${this.names().join(", ")}`,
        durationMs: Date.now() - start,
      };
    }

    // Check if tool is enabled in this context
    if (tool.isEnabled && !tool.isEnabled(ctx)) {
      return {
        type: "error",
        error: `Tool "${toolName}" is not available in this context.`,
        durationMs: Date.now() - start,
      };
    }

    // Validate input with Zod
    const parseResult = tool.inputSchema.safeParse(rawInput);
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return {
        type: "error",
        error: `Invalid input for tool "${toolName}": ${issues}`,
        durationMs: Date.now() - start,
      };
    }

    // Execute
    try {
      const result = await tool.execute(parseResult.data, ctx);
      return { ...result, durationMs: Date.now() - start };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `Tool "${toolName}" execution failed: ${message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  /** Get the number of registered tools */
  get size(): number {
    return this.tools.size;
  }
}

// ---------------------------------------------------------------------------
// Text similarity helpers
// ---------------------------------------------------------------------------

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9_\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1)
  );
}

function cosineSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  return intersection / Math.sqrt(a.size * b.size);
}

// ---------------------------------------------------------------------------
// Singleton default registry
// ---------------------------------------------------------------------------

let defaultRegistry: ToolRegistry | null = null;

export function getDefaultToolRegistry(): ToolRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new ToolRegistry();
  }
  return defaultRegistry;
}

export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}

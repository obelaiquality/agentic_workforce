import type { ToolRegistry } from "./registry";
import type { ToolContext, ToolJsonSchema } from "./types";

/**
 * DeferredToolLoader manages progressive disclosure of tools.
 *
 * In deferred loading mode:
 * 1. Initial prompt contains only core tools (read_file, edit_file, bash, etc.)
 * 2. System prompt includes a list of deferred tools the LLM can search for
 * 3. LLM uses tool_search to discover and load specialized tools on demand
 * 4. Once loaded via tool_search, tools become available for the rest of the session
 *
 * This reduces initial prompt size and allows the LLM to discover tools incrementally.
 */
export class DeferredToolLoader {
  private loadedTools = new Set<string>();
  private coreTools = new Set([
    "read_file",
    "edit_file",
    "write_file",
    "bash",
    "complete_task",
    "tool_search",
    "ask_user",
  ]);

  constructor(
    private registry: ToolRegistry,
    private readonly ctx?: ToolContext,
  ) {}

  /**
   * Get tool schemas for the initial prompt.
   * Includes only core tools (alwaysLoad=true) or tools in coreTools list.
   */
  getInitialToolSchemas(): ToolJsonSchema[] {
    const initial = this.registry
      .listEnabled(this.ctx)
      .filter((tool) => tool.alwaysLoad !== false || this.coreTools.has(tool.name));

    return initial.map((tool) => this.registry.toJsonSchema(tool));
  }

  /**
   * Get a summary list of deferred tools for the system prompt.
   * This tells the LLM what tools are available via tool_search.
   *
   * Returns a formatted string suitable for injection into the system prompt.
   */
  getDeferredToolsList(): string {
    const deferred = this.registry
      .getDeferredToolsForContext(this.ctx)
      .map((tool) => `- ${tool.name}: ${tool.description}`);

    if (deferred.length === 0) {
      return "";
    }

    return `## Available Tools (use tool_search to load)

The following specialized tools are available on demand. Use the tool_search tool to discover and load them:

${deferred.join("\n")}

Use tool_search with keywords to find relevant tools (e.g., tool_search("git commit")).`;
  }

  /**
   * Mark a tool as loaded (after tool_search returns it).
   * This makes it available in the active tool set.
   */
  markLoaded(toolName: string): void {
    if (this.registry.has(toolName)) {
      this.loadedTools.add(toolName);
    }
  }

  /**
   * Mark multiple tools as loaded.
   */
  markLoadedBatch(toolNames: string[]): void {
    for (const name of toolNames) {
      this.markLoaded(name);
    }
  }

  /**
   * Check if a tool has been loaded.
   */
  isLoaded(toolName: string): boolean {
    return this.loadedTools.has(toolName) || this.coreTools.has(toolName);
  }

  /**
   * Get all currently active tool schemas (core + loaded).
   * This is the full set of tools available to the LLM at this point in the session.
   */
  getActiveToolSchemas(): ToolJsonSchema[] {
    const activeNames = new Set([
      ...this.coreTools,
      ...this.loadedTools,
    ]);

    const active = this.registry
      .listEnabled(this.ctx)
      .filter((tool) => activeNames.has(tool.name) || tool.alwaysLoad !== false);

    return active.map((tool) => this.registry.toJsonSchema(tool));
  }

  /**
   * Get the list of loaded tool names (excluding core tools).
   */
  getLoadedToolNames(): string[] {
    return Array.from(this.loadedTools);
  }

  /**
   * Reset the loaded tools set (useful for new sessions).
   */
  reset(): void {
    this.loadedTools.clear();
  }

  /**
   * Get stats about the current tool loading state.
   */
  getStats(): {
    coreCount: number;
    loadedCount: number;
    deferredCount: number;
    totalCount: number;
  } {
    const all = this.registry.list();
    const deferred = this.registry.getDeferredTools();

    return {
      coreCount: this.coreTools.size,
      loadedCount: this.loadedTools.size,
      deferredCount: deferred.length,
      totalCount: all.length,
    };
  }
}

/**
 * Create a new DeferredToolLoader instance for a given registry.
 */
export function createDeferredToolLoader(registry: ToolRegistry): DeferredToolLoader {
  return new DeferredToolLoader(registry);
}

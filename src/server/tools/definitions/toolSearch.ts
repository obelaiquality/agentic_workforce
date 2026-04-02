import { z } from "zod";
import type { ToolDefinition } from "../types";
import type { ToolRegistry } from "../registry";

/**
 * Creates the tool_search meta-tool for progressive disclosure.
 *
 * This tool allows the LLM to discover and load additional tools on demand.
 * When using deferred tool loading, only core tools are in the initial prompt.
 * The LLM uses tool_search to find and load specialized tools as needed.
 *
 * Example query patterns:
 * - "git commit" → finds git-related commit tools
 * - "run tests" → finds test execution tools
 * - "search files" → finds file search/grep tools
 *
 * The tool returns full JSON schemas so the LLM can immediately use the discovered tools.
 */
export function createToolSearchTool(registry: ToolRegistry): ToolDefinition {
  return {
    name: "tool_search",
    description: `Search for available tools by keyword. Use this to find specialized tools not in your initial tool set.

Returns tool names, descriptions, and full parameter schemas so you can immediately use them.

Example queries:
- "git commit" — find git commit tools
- "run tests" — find test execution tools
- "search files" — find file search tools
- "database query" — find database-related tools`,

    inputSchema: z.object({
      query: z.string().describe("Keywords to search for tools (e.g., 'git commit', 'run tests', 'search files')"),
      max_results: z.number().optional().default(5).describe("Maximum number of tools to return (default: 5)"),
    }),

    permission: {
      scope: "meta",
      readOnly: true,
    },

    alwaysLoad: true, // Must always be available for progressive disclosure to work
    concurrencySafe: true,
    searchHints: ["discover", "find", "search", "available", "tools", "help"],

    execute: async (input, ctx) => {
      const enabledToolNames = new Set(registry.listEnabled(ctx).map((tool) => tool.name));
      const tools = registry
        .searchTools(input.query, input.max_results)
        .filter((tool) => enabledToolNames.has(tool.name));

      if (tools.length === 0) {
        return {
          type: "success",
          content: `No tools found matching "${input.query}". Try different keywords or broader terms.

Available tool categories you can search for:
- File operations (read, write, edit, search)
- Git operations (commit, branch, merge, diff)
- Build & test (run tests, build, lint)
- Code analysis (symbols, imports, dependencies)
- Network (HTTP requests, API calls)`,
        };
      }

      // Convert tools to full JSON schemas
      const toolSchemas = tools.map((tool) => registry.toJsonSchema(tool));

      // Format for human readability
      const formatted = toolSchemas.map((schema, idx) => {
        const params = JSON.stringify(schema.parameters, null, 2)
          .split("\n")
          .map((line, i) => (i === 0 ? line : `  ${line}`))
          .join("\n");

        return `${idx + 1}. ${schema.name}
   Description: ${schema.description}
   Parameters: ${params}`;
      }).join("\n\n");

      return {
        type: "success",
        content: `Found ${tools.length} tool(s) matching "${input.query}":

${formatted}

You can now use these tools directly in your next response.`,
        metadata: {
          toolsFound: tools.length,
          toolNames: tools.map((t) => t.name),
          schemas: toolSchemas,
        },
      };
    },
  };
}

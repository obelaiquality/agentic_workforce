import { z } from "zod";
import type { ToolDefinition } from "../types";
import { getServerConfigForFile } from "../../lsp/serverConfigs";
import { getSharedLspClient, shutdownSharedLspClient } from "../../lsp/sharedClient";

/**
 * Creates LSP-based code intelligence tools.
 * These tools require language servers to be installed (typescript-language-server, pylsp, rust-analyzer, etc.).
 */

/**
 * Shutdown all LSP servers (for cleanup).
 */
export async function shutdownLspClient(): Promise<void> {
  await shutdownSharedLspClient();
}

/**
 * Tool: lsp_diagnostics
 * Get diagnostics (errors, warnings, hints) for a file.
 */
export const lspDiagnosticsTool: ToolDefinition = {
  name: "lsp_diagnostics",
  description: `Get diagnostics (errors, warnings, info, hints) from the language server for a file.

Requires the appropriate language server to be installed:
- TypeScript/JavaScript: typescript-language-server
- Python: pylsp
- Rust: rust-analyzer
- Go: gopls

Returns line-by-line diagnostics with severity levels.`,

  inputSchema: z.object({
    path: z.string().describe("Absolute path to the file to check"),
  }),

  permission: {
    scope: "repo.verify",
    readOnly: true,
  },

  alwaysLoad: false,
  concurrencySafe: true,
  searchHints: ["diagnostics", "errors", "warnings", "lint", "check", "validate", "lsp", "language server"],

  execute: async (input, ctx) => {
    try {
      const config = getServerConfigForFile(input.path);
      if (!config) {
        return {
          type: "error",
          error: `No LSP server configured for file: ${input.path}. Supported: .ts, .tsx, .js, .jsx, .py, .rs, .go`,
        };
      }

      const client = getSharedLspClient();

      // Start server if not running
      try {
        await client.startServer(config.language, ctx.worktreePath);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          type: "error",
          error: `Failed to start LSP server for ${config.language}: ${message}. Ensure ${config.command[0]} is installed.`,
        };
      }

      const diagnostics = await client.getDiagnostics(input.path);

      if (diagnostics.length === 0) {
        return {
          type: "success",
          content: `No diagnostics found for ${input.path}. File appears clean.`,
          metadata: { diagnosticsCount: 0 },
        };
      }

      // Group by severity
      const errors = diagnostics.filter((d) => d.severity === "error");
      const warnings = diagnostics.filter((d) => d.severity === "warning");
      const info = diagnostics.filter((d) => d.severity === "info");
      const hints = diagnostics.filter((d) => d.severity === "hint");

      const formatDiagnostic = (d: typeof diagnostics[0]) =>
        `  Line ${d.line + 1}, Col ${d.character + 1}: ${d.message}${d.source ? ` [${d.source}]` : ""}`;

      const sections = [];
      if (errors.length > 0) {
        sections.push(`Errors (${errors.length}):\n${errors.map(formatDiagnostic).join("\n")}`);
      }
      if (warnings.length > 0) {
        sections.push(`Warnings (${warnings.length}):\n${warnings.map(formatDiagnostic).join("\n")}`);
      }
      if (info.length > 0) {
        sections.push(`Info (${info.length}):\n${info.map(formatDiagnostic).join("\n")}`);
      }
      if (hints.length > 0) {
        sections.push(`Hints (${hints.length}):\n${hints.map(formatDiagnostic).join("\n")}`);
      }

      return {
        type: "success",
        content: `Diagnostics for ${input.path}:\n\n${sections.join("\n\n")}`,
        metadata: {
          diagnosticsCount: diagnostics.length,
          errorCount: errors.length,
          warningCount: warnings.length,
          infoCount: info.length,
          hintCount: hints.length,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `LSP diagnostics failed: ${message}`,
      };
    }
  },
};

/**
 * Tool: lsp_definition
 * Go to definition of a symbol at a given position.
 */
export const lspDefinitionTool: ToolDefinition = {
  name: "lsp_definition",
  description: `Find the definition location of a symbol at a given line and character position.

Useful for:
- Finding where a function is defined
- Jumping to class declarations
- Locating variable declarations

Returns the file path, line, and character position of the definition.`,

  inputSchema: z.object({
    path: z.string().describe("Absolute path to the file"),
    line: z.number().describe("Line number (0-indexed)"),
    character: z.number().describe("Character position in the line (0-indexed)"),
  }),

  permission: {
    scope: "repo.read",
    readOnly: true,
  },

  alwaysLoad: false,
  concurrencySafe: true,
  searchHints: ["definition", "go to", "find", "locate", "jump", "symbol", "lsp"],

  execute: async (input, ctx) => {
    try {
      const config = getServerConfigForFile(input.path);
      if (!config) {
        return {
          type: "error",
          error: `No LSP server configured for file: ${input.path}`,
        };
      }

      const client = getSharedLspClient();

      try {
        await client.startServer(config.language, ctx.worktreePath);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          type: "error",
          error: `Failed to start LSP server: ${message}`,
        };
      }

      const location = await client.getDefinition(input.path, input.line, input.character);

      if (!location) {
        return {
          type: "success",
          content: `No definition found at ${input.path}:${input.line + 1}:${input.character + 1}`,
          metadata: { found: false },
        };
      }

      return {
        type: "success",
        content: `Definition found at:\n  File: ${location.file}\n  Line: ${location.line + 1}\n  Character: ${location.character + 1}`,
        metadata: {
          found: true,
          location,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `LSP definition lookup failed: ${message}`,
      };
    }
  },
};

/**
 * Tool: lsp_references
 * Find all references to a symbol at a given position.
 */
export const lspReferencesTool: ToolDefinition = {
  name: "lsp_references",
  description: `Find all references to a symbol at a given line and character position.

Useful for:
- Finding all usages of a function
- Locating all imports of a module
- Discovering where a variable is used

Returns a list of file paths with line and character positions.`,

  inputSchema: z.object({
    path: z.string().describe("Absolute path to the file"),
    line: z.number().describe("Line number (0-indexed)"),
    character: z.number().describe("Character position in the line (0-indexed)"),
  }),

  permission: {
    scope: "repo.read",
    readOnly: true,
  },

  alwaysLoad: false,
  concurrencySafe: true,
  searchHints: ["references", "find all", "usages", "where used", "imports", "lsp"],

  execute: async (input, ctx) => {
    try {
      const config = getServerConfigForFile(input.path);
      if (!config) {
        return {
          type: "error",
          error: `No LSP server configured for file: ${input.path}`,
        };
      }

      const client = getSharedLspClient();

      try {
        await client.startServer(config.language, ctx.worktreePath);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          type: "error",
          error: `Failed to start LSP server: ${message}`,
        };
      }

      const references = await client.getReferences(input.path, input.line, input.character);

      if (references.length === 0) {
        return {
          type: "success",
          content: `No references found for symbol at ${input.path}:${input.line + 1}:${input.character + 1}`,
          metadata: { referencesCount: 0 },
        };
      }

      const formatted = references.map((ref) => `  ${ref.file}:${ref.line + 1}:${ref.character + 1}`).join("\n");

      return {
        type: "success",
        content: `Found ${references.length} reference(s):\n${formatted}`,
        metadata: {
          referencesCount: references.length,
          references,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `LSP references lookup failed: ${message}`,
      };
    }
  },
};

/**
 * Tool: lsp_symbols
 * Get document symbols (functions, classes, etc.) for a file.
 */
export const lspSymbolsTool: ToolDefinition = {
  name: "lsp_symbols",
  description: `Get all symbols (functions, classes, variables, etc.) defined in a file.

Useful for:
- Understanding file structure
- Finding all exported functions
- Locating class definitions
- Getting an overview of a module

Returns a list of symbols with their names, kinds, and positions.`,

  inputSchema: z.object({
    path: z.string().describe("Absolute path to the file"),
  }),

  permission: {
    scope: "repo.read",
    readOnly: true,
  },

  alwaysLoad: false,
  concurrencySafe: true,
  searchHints: ["symbols", "outline", "structure", "functions", "classes", "exports", "lsp"],

  execute: async (input, ctx) => {
    try {
      const config = getServerConfigForFile(input.path);
      if (!config) {
        return {
          type: "error",
          error: `No LSP server configured for file: ${input.path}`,
        };
      }

      const client = getSharedLspClient();

      try {
        await client.startServer(config.language, ctx.worktreePath);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          type: "error",
          error: `Failed to start LSP server: ${message}`,
        };
      }

      const symbols = await client.getDocumentSymbols(input.path);

      if (symbols.length === 0) {
        return {
          type: "success",
          content: `No symbols found in ${input.path}`,
          metadata: { symbolCount: 0 },
        };
      }

      // Group by kind
      const byKind = new Map<string, typeof symbols>();
      for (const symbol of symbols) {
        const existing = byKind.get(symbol.kind) || [];
        existing.push(symbol);
        byKind.set(symbol.kind, existing);
      }

      const sections = Array.from(byKind.entries())
        .map(([kind, syms]) => {
          const formatted = syms.map((s) => `  ${s.name} (line ${s.line + 1})`).join("\n");
          return `${kind} (${syms.length}):\n${formatted}`;
        })
        .join("\n\n");

      return {
        type: "success",
        content: `Symbols in ${input.path}:\n\n${sections}`,
        metadata: {
          symbolCount: symbols.length,
          symbols,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `LSP symbols lookup failed: ${message}`,
      };
    }
  },
};

export const lspTools: ToolDefinition[] = [
  lspDiagnosticsTool,
  lspDefinitionTool,
  lspReferencesTool,
  lspSymbolsTool,
];

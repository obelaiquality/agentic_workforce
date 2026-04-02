/**
 * LSP Server configurations for different languages.
 * Each config specifies how to start the language server and what capabilities it supports.
 */

import { access } from "node:fs/promises";
import path from "node:path";

export interface LSPServerConfig {
  /** Language identifier (e.g., "typescript", "python") */
  language: string;
  /** File extensions this server handles */
  extensions: string[];
  /** Command to start the language server (first element is command, rest are args) */
  command: string[];
  /** Environment variables to pass to the server */
  env?: Record<string, string>;
  /** Server capabilities we expect */
  capabilities?: {
    diagnostics?: boolean;
    definition?: boolean;
    references?: boolean;
    documentSymbol?: boolean;
  };
}

export const LSP_SERVER_CONFIGS: LSPServerConfig[] = [
  {
    language: "typescript",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    command: ["npx", "typescript-language-server", "--stdio"],
    capabilities: {
      diagnostics: true,
      definition: true,
      references: true,
      documentSymbol: true,
    },
  },
  {
    language: "python",
    extensions: [".py", ".pyi"],
    command: ["pylsp"],
    capabilities: {
      diagnostics: true,
      definition: true,
      references: true,
      documentSymbol: true,
    },
  },
  {
    language: "rust",
    extensions: [".rs"],
    command: ["rust-analyzer"],
    capabilities: {
      diagnostics: true,
      definition: true,
      references: true,
      documentSymbol: true,
    },
  },
  {
    language: "go",
    extensions: [".go"],
    command: ["gopls"],
    capabilities: {
      diagnostics: true,
      definition: true,
      references: true,
      documentSymbol: true,
    },
  },
];

/**
 * Get server config for a file based on its extension.
 */
export function getServerConfigForFile(filePath: string): LSPServerConfig | undefined {
  const ext = filePath.substring(filePath.lastIndexOf("."));
  return LSP_SERVER_CONFIGS.find((config) => config.extensions.includes(ext));
}

/**
 * Get server config by language identifier.
 */
export function getServerConfigByLanguage(language: string): LSPServerConfig | undefined {
  return LSP_SERVER_CONFIGS.find((config) => config.language === language);
}

export async function isLspCommandAvailable(command: string): Promise<boolean> {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }

  const hasPathSeparator = trimmed.includes("/") || trimmed.includes("\\");
  const executableNames =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .filter((entry) => entry.trim().length > 0)
      : [""];

  if (hasPathSeparator) {
    try {
      await access(trimmed);
      return true;
    } catch {
      return false;
    }
  }

  const pathEntries = (process.env.PATH || "").split(path.delimiter).filter((entry) => entry.trim().length > 0);
  for (const dir of pathEntries) {
    for (const ext of executableNames) {
      const candidate = path.join(dir, process.platform === "win32" && !trimmed.toLowerCase().endsWith(ext.toLowerCase()) ? `${trimmed}${ext}` : trimmed);
      try {
        await access(candidate);
        return true;
      } catch {
        // Try next candidate.
      }
    }
  }

  return false;
}

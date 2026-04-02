import fs from "node:fs/promises";
import path from "node:path";
import { execSync, execFileSync } from "node:child_process";
import { z } from "zod";
import type { ToolDefinition, ToolContext, ToolResult } from "../types";
import { runEditMatcherChain } from "../../services/editMatcherChain";
import { validatePath } from "../pathValidation";

// ---------------------------------------------------------------------------
// 1. read_file — Read file contents with line numbers
// ---------------------------------------------------------------------------

const readFileSchema = z.object({
  path: z.string().describe("Relative or absolute file path to read"),
  offset: z.number().int().min(0).optional().describe("Starting line number (0-indexed)"),
  limit: z.number().int().min(1).max(5000).optional().describe("Maximum number of lines to read (default 2000)"),
});

export const readFile: ToolDefinition<z.infer<typeof readFileSchema>> = {
  name: "read_file",
  description: "Read file contents from the worktree with line numbers. Returns content with line numbers like '  1\\t<content>'. Large files are truncated by default.",
  inputSchema: readFileSchema,
  permission: {
    scope: "repo.read",
    readOnly: true,
  },
  alwaysLoad: true,
  concurrencySafe: true,

  async execute(input, ctx) {
    const { path: filePath, offset = 0, limit = 2000 } = input;
    const { fullPath, error: pathError } = validatePath(ctx.worktreePath, filePath, "read");
    if (pathError) return { type: "error" as const, error: pathError };

    try {
      const content = await fs.readFile(fullPath, "utf-8");
      const lines = content.split("\n");

      // Apply offset and limit
      const startLine = offset;
      const endLine = Math.min(lines.length, offset + limit);
      const selectedLines = lines.slice(startLine, endLine);

      // Add line numbers (1-indexed for display)
      const numbered = selectedLines
        .map((line, idx) => {
          const lineNum = startLine + idx + 1;
          return `${lineNum.toString().padStart(5, " ")}\t${line}`;
        })
        .join("\n");

      const metadata: Record<string, unknown> = {
        totalLines: lines.length,
        displayedLines: selectedLines.length,
        truncated: endLine < lines.length,
      };

      return {
        type: "success",
        content: numbered,
        metadata,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `Failed to read file "${filePath}": ${message}`,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// 2. edit_file — Apply search/replace edits using matcher chain
// ---------------------------------------------------------------------------

const editFileSchema = z.object({
  file_path: z.string().describe("Relative or absolute path to the file to edit"),
  old_string: z.string().describe("Exact text to search for (will try fuzzy matching if exact fails)"),
  new_string: z.string().describe("Text to replace with (must differ from old_string)"),
  replace_all: z.boolean().optional().describe("If true, replace all occurrences (default: false)"),
});

export const editFile: ToolDefinition<z.infer<typeof editFileSchema>> = {
  name: "edit_file",
  description: "Apply a search/replace edit to a file. Uses an 8-level matching chain (exact → quote-normalized → whitespace-normalized → indent-flexible → line-trimmed → fuzzy-line → line-anchored → similarity → whole-block) to handle formatting variations.",
  inputSchema: editFileSchema,
  permission: {
    scope: "repo.edit",
  },
  alwaysLoad: true,
  concurrencySafe: false,

  async execute(input, ctx) {
    const { file_path: filePath, old_string, new_string, replace_all = false } = input;

    if (old_string === new_string) {
      return {
        type: "error",
        error: "old_string and new_string must be different",
      };
    }

    const { fullPath, error: pathError } = validatePath(ctx.worktreePath, filePath, "write");
    if (pathError) return { type: "error" as const, error: pathError };

    try {
      const content = await fs.readFile(fullPath, "utf-8");

      if (replace_all) {
        // Simple replace all for exact matches
        if (!content.includes(old_string)) {
          return {
            type: "error",
            error: `String not found in file: "${old_string.slice(0, 100)}${old_string.length > 100 ? "..." : ""}"`,
          };
        }
        const newContent = content.split(old_string).join(new_string);
        await fs.writeFile(fullPath, newContent, "utf-8");
        const occurrences = content.split(old_string).length - 1;
        return {
          type: "success",
          content: `Replaced ${occurrences} occurrence(s) in ${filePath}`,
          metadata: { occurrences },
        };
      } else {
        // Use matcher chain for single replacement
        const result = runEditMatcherChain(content, old_string, new_string);

        if (!result.success) {
          return {
            type: "error",
            error: `Could not find a match for the search string in ${filePath}. Please verify the text exists and matches the file's formatting.`,
          };
        }

        await fs.writeFile(fullPath, result.content, "utf-8");

        return {
          type: "success",
          content: `Successfully edited ${filePath} using ${result.match?.matcherName} (level ${result.match?.matcherLevel})`,
          metadata: {
            matcherUsed: result.match?.matcherName,
            matcherLevel: result.match?.matcherLevel,
          },
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `Failed to edit file "${filePath}": ${message}`,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// 3. write_file — Create or overwrite a file
// ---------------------------------------------------------------------------

const writeFileSchema = z.object({
  file_path: z.string().describe("Relative or absolute path to the file to write"),
  content: z.string().describe("Complete file content to write"),
});

export const writeFile: ToolDefinition<z.infer<typeof writeFileSchema>> = {
  name: "write_file",
  description: "Create a new file or completely overwrite an existing file. Creates parent directories if needed. Prefer edit_file for modifying existing files.",
  inputSchema: writeFileSchema,
  permission: {
    scope: "repo.edit",
  },
  alwaysLoad: true,
  concurrencySafe: false,

  async execute(input, ctx) {
    const { file_path: filePath, content } = input;
    const { fullPath, error: pathError } = validatePath(ctx.worktreePath, filePath, "write");
    if (pathError) return { type: "error" as const, error: pathError };

    try {
      // Ensure parent directory exists
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(fullPath, content, "utf-8");

      const stats = await fs.stat(fullPath);

      return {
        type: "success",
        content: `Wrote ${stats.size} bytes to ${filePath}`,
        metadata: {
          bytes: stats.size,
          lines: content.split("\n").length,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `Failed to write file "${filePath}": ${message}`,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// 4. list_files — List directory contents
// ---------------------------------------------------------------------------

const listFilesSchema = z.object({
  path: z.string().optional().describe("Directory path to list (default: current directory)"),
  pattern: z.string().optional().describe("Optional glob pattern to filter results (e.g., '*.ts', '**/*.json')"),
});

export const listFiles: ToolDefinition<z.infer<typeof listFilesSchema>> = {
  name: "list_files",
  description: "List directory contents recursively. Returns file paths relative to the specified directory. Optionally filter by glob pattern.",
  inputSchema: listFilesSchema,
  permission: {
    scope: "repo.read",
    readOnly: true,
  },
  alwaysLoad: true,
  concurrencySafe: true,

  async execute(input, ctx) {
    const { path: dirPath = ".", pattern } = input;
    const { fullPath, error: pathError } = validatePath(ctx.worktreePath, dirPath, "read");
    if (pathError) return { type: "error" as const, error: pathError };

    try {
      const entries: string[] = [];

      async function walk(dir: string, relativeTo: string) {
        const items = await fs.readdir(dir, { withFileTypes: true });
        for (const item of items) {
          const fullItemPath = path.join(dir, item.name);
          const relPath = path.relative(relativeTo, fullItemPath);

          if (item.isDirectory()) {
            // Skip common ignore patterns
            if ([".git", "node_modules", ".agentic-workforce"].includes(item.name)) {
              continue;
            }
            await walk(fullItemPath, relativeTo);
          } else if (item.isFile()) {
            entries.push(relPath);
          }
        }
      }

      await walk(fullPath, fullPath);

      // Apply pattern filter if provided
      let filtered = entries;
      if (pattern) {
        const regex = globToRegex(pattern);
        filtered = entries.filter((e) => regex.test(e));
      }

      filtered.sort();

      return {
        type: "success",
        content: filtered.join("\n"),
        metadata: {
          totalFiles: filtered.length,
          pattern: pattern || null,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `Failed to list files in "${dirPath}": ${message}`,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// 5. grep_search — Search file contents using ripgrep or grep
// ---------------------------------------------------------------------------

const grepSearchSchema = z.object({
  pattern: z.string().describe("Regular expression pattern to search for"),
  path: z.string().optional().describe("Directory or file to search in (default: current directory)"),
  glob: z.string().optional().describe("Glob pattern to filter files (e.g., '*.ts')"),
  max_results: z.number().int().min(1).max(500).optional().describe("Maximum number of results to return (default: 50)"),
});

export const grepSearch: ToolDefinition<z.infer<typeof grepSearchSchema>> = {
  name: "grep_search",
  description: "Search file contents using regex. Uses ripgrep (rg) if available, falls back to grep. Returns matching lines with file paths and line numbers.",
  inputSchema: grepSearchSchema,
  permission: {
    scope: "repo.read",
    readOnly: true,
  },
  alwaysLoad: true,
  concurrencySafe: true,

  async execute(input, ctx) {
    const { pattern, path: searchPath = ".", glob, max_results = 50 } = input;
    const { fullPath, error: pathError } = validatePath(ctx.worktreePath, searchPath, "read");
    if (pathError) return { type: "error" as const, error: pathError };

    try {
      // Check if ripgrep is available
      let useRipgrep = false;
      try {
        execSync("which rg", { encoding: "utf-8", stdio: "pipe" });
        useRipgrep = true;
      } catch {
        // ripgrep not available, will use grep
      }

      let stdout: string;

      if (useRipgrep) {
        const rgArgs = ["--line-number", "--no-heading", "--color=never", pattern];
        if (glob) {
          rgArgs.push("--glob", glob);
        }
        rgArgs.push(fullPath);

        try {
          // Use execFileSync to prevent shell injection — pattern passed as arg, not interpolated
          stdout = execFileSync("rg", rgArgs, {
            cwd: ctx.worktreePath,
            encoding: "utf-8",
            maxBuffer: 10 * 1024 * 1024,
          });
        } catch (err: unknown) {
          // rg returns exit code 1 when no matches found
          if (err && typeof err === "object" && "status" in err && err.status === 1) {
            stdout = "";
          } else {
            throw err;
          }
        }
      } else {
        // Fallback to grep — use execFileSync to prevent shell injection
        const grepArgs = ["-rn"];
        if (glob) {
          grepArgs.push("--include", glob);
        }
        grepArgs.push(pattern, fullPath);

        try {
          stdout = execFileSync("grep", grepArgs, {
            cwd: ctx.worktreePath,
            encoding: "utf-8",
            maxBuffer: 10 * 1024 * 1024,
          });
        } catch (err: unknown) {
          // grep returns exit code 1 when no matches found
          if (err && typeof err === "object" && "status" in err && err.status === 1) {
            stdout = "";
          } else {
            throw err;
          }
        }
      }

      const lines = stdout.trim().split("\n").filter((l) => l.length > 0);
      const limited = lines.slice(0, max_results);

      return {
        type: "success",
        content: limited.join("\n"),
        metadata: {
          totalMatches: lines.length,
          displayedMatches: limited.length,
          truncated: lines.length > max_results,
          tool: useRipgrep ? "ripgrep" : "grep",
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `Search failed: ${message}`,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// 6. glob_search — Find files by glob pattern
// ---------------------------------------------------------------------------

const globSearchSchema = z.object({
  pattern: z.string().describe("Glob pattern to match files (e.g., '**/*.ts', 'src/**/*.test.ts')"),
  path: z.string().optional().describe("Base directory to search from (default: current directory)"),
});

export const globSearch: ToolDefinition<z.infer<typeof globSearchSchema>> = {
  name: "glob_search",
  description: "Find files matching a glob pattern. Supports ** for recursive matching, * for wildcards, {a,b} for alternatives.",
  inputSchema: globSearchSchema,
  permission: {
    scope: "repo.read",
    readOnly: true,
  },
  alwaysLoad: true,
  concurrencySafe: true,

  async execute(input, ctx) {
    const { pattern, path: basePath = "." } = input;
    const { fullPath, error: pathError } = validatePath(ctx.worktreePath, basePath, "read");
    if (pathError) return { type: "error" as const, error: pathError };

    try {
      const matches: string[] = [];

      async function walk(dir: string, relativeTo: string, currentDepth = 0) {
        // Prevent excessive recursion
        if (currentDepth > 20) return;

        const items = await fs.readdir(dir, { withFileTypes: true });
        for (const item of items) {
          const fullItemPath = path.join(dir, item.name);
          const relPath = path.relative(relativeTo, fullItemPath);

          if (item.isDirectory()) {
            if ([".git", "node_modules", ".agentic-workforce"].includes(item.name)) {
              continue;
            }
            await walk(fullItemPath, relativeTo, currentDepth + 1);
          } else if (item.isFile()) {
            if (matchGlob(relPath, pattern)) {
              matches.push(relPath);
            }
          }
        }
      }

      await walk(fullPath, fullPath);
      matches.sort();

      return {
        type: "success",
        content: matches.join("\n"),
        metadata: {
          totalMatches: matches.length,
          pattern,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `Glob search failed: ${message}`,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert glob pattern to regex (simple implementation) */
function globToRegex(pattern: string): RegExp {
  let regex = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "§GLOBSTAR§")
    .replace(/\*/g, "[^/]*")
    .replace(/§GLOBSTAR§/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regex}$`);
}

/** Check if a path matches a glob pattern */
function matchGlob(filePath: string, pattern: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(filePath);
}

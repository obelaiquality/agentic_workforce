import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import type { ToolDefinition, ToolContext, ToolResult } from "../types";
import { runEditMatcherChain } from "../../services/editMatcherChain";
import { validatePath } from "../pathValidation";
import {
  getRipgrepPath,
  execRipgrep,
  VCS_DIRS,
  COMMON_IGNORE_DIRS,
  vcsExclusionArgs,
  commonExclusionArgs,
  extractGlobBaseDir,
} from "../../services/ripgrep";

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
  head_limit: z.number().int().min(1).max(10000).optional().describe("Maximum number of files to return (default: 1000)"),
  sort_by: z.enum(["name", "mtime"]).optional().describe('Sort order: "name" (default) or "mtime" (most recently modified first)'),
});

export const listFiles: ToolDefinition<z.infer<typeof listFilesSchema>> = {
  name: "list_files",
  description: "List directory contents recursively. Returns file paths relative to the specified directory. Optionally filter by glob pattern. Supports mtime sorting and result limits.",
  inputSchema: listFilesSchema,
  permission: {
    scope: "repo.read",
    readOnly: true,
  },
  alwaysLoad: true,
  concurrencySafe: true,

  async execute(input, ctx) {
    const { path: dirPath = ".", pattern, head_limit = 1000, sort_by = "name" } = input;
    const { fullPath, error: pathError } = validatePath(ctx.worktreePath, dirPath, "read");
    if (pathError) return { type: "error" as const, error: pathError };

    try {
      let entries: string[];
      const rgAvailable = getRipgrepPath() !== null;

      if (rgAvailable) {
        // Use ripgrep for fast file listing
        const rgArgs = ["--files"];
        if (sort_by === "mtime") rgArgs.push("--sort=modified");
        // Exclude common dirs
        rgArgs.push(...commonExclusionArgs());
        // Apply glob pattern if provided
        if (pattern) rgArgs.push("--glob", pattern);
        rgArgs.push(fullPath);

        const lines = await execRipgrep(rgArgs, { cwd: ctx.worktreePath });
        // Relativize to the search directory
        entries = lines.map((p) => path.isAbsolute(p) ? path.relative(fullPath, p) : p);
      } else {
        // Fallback: manual walk
        entries = [];
        async function walk(dir: string, relativeTo: string) {
          const items = await fs.readdir(dir, { withFileTypes: true });
          for (const item of items) {
            const fullItemPath = path.join(dir, item.name);
            const relPath = path.relative(relativeTo, fullItemPath);
            if (item.isDirectory()) {
              if (COMMON_IGNORE_DIRS.includes(item.name as (typeof COMMON_IGNORE_DIRS)[number])) continue;
              await walk(fullItemPath, relativeTo);
            } else if (item.isFile()) {
              entries.push(relPath);
            }
          }
        }
        await walk(fullPath, fullPath);

        // Apply pattern filter if provided
        if (pattern) {
          const regex = globToRegex(pattern);
          entries = entries.filter((e) => regex.test(e));
        }

        if (sort_by === "name") {
          entries.sort();
        } else {
          // Sort by mtime (fallback path)
          const stats = await Promise.allSettled(
            entries.map((e) => fs.stat(path.join(fullPath, e))),
          );
          entries = entries
            .map((e, i) => {
              const r = stats[i]!;
              return { path: e, mtime: r.status === "fulfilled" ? r.value.mtimeMs : 0 };
            })
            .sort((a, b) => b.mtime - a.mtime)
            .map((e) => e.path);
        }
      }

      // Apply limit
      const totalFiles = entries.length;
      const limited = entries.slice(0, head_limit);
      const truncated = totalFiles > head_limit;

      return {
        type: "success",
        content: limited.join("\n"),
        metadata: {
          totalFiles,
          displayedFiles: limited.length,
          truncated,
          pattern: pattern || null,
          sortedBy: sort_by,
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

const DEFAULT_HEAD_LIMIT = 250;

const grepSearchSchema = z.object({
  pattern: z.string().describe("Regular expression pattern to search for"),
  path: z.string().optional().describe("Directory or file to search in (default: current directory)"),
  glob: z.string().optional().describe("Glob pattern to filter files (e.g., '*.ts', '*.{ts,tsx}')"),
  output_mode: z.enum(["content", "files_with_matches", "count"]).optional().describe(
    'Output mode: "content" shows matching lines, "files_with_matches" shows file paths, "count" shows match counts. Defaults to "content".',
  ),
  head_limit: z.number().int().min(0).max(10000).optional().describe(
    "Max results to return (default: 250). Pass 0 for unlimited.",
  ),
  offset: z.number().int().min(0).optional().describe("Skip first N results before applying head_limit (default: 0)"),
  max_results: z.number().int().min(1).max(500).optional().describe("Alias for head_limit (backward compat)"),
  context: z.number().int().min(0).max(20).optional().describe("Lines of context around each match (-C)"),
  "-A": z.number().int().min(0).max(20).optional().describe("Lines to show after each match"),
  "-B": z.number().int().min(0).max(20).optional().describe("Lines to show before each match"),
  "-i": z.boolean().optional().describe("Case insensitive search"),
  "-n": z.boolean().optional().describe("Show line numbers (default: true)"),
  type: z.string().optional().describe('File type filter (rg --type), e.g. "ts", "py", "js"'),
  multiline: z.boolean().optional().describe("Enable multiline mode (-U --multiline-dotall)"),
});

export const grepSearch: ToolDefinition<z.infer<typeof grepSearchSchema>> = {
  name: "grep_search",
  description:
    'Search file contents using regex. Uses ripgrep (rg) if available, falls back to grep. Supports 3 output modes: "content" (matching lines), "files_with_matches" (file paths sorted by mtime), "count" (match counts). Supports pagination via head_limit/offset.',
  inputSchema: grepSearchSchema,
  permission: {
    scope: "repo.read",
    readOnly: true,
  },
  alwaysLoad: true,
  concurrencySafe: true,
  searchHints: ["search", "grep", "find", "regex", "content", "ripgrep"],

  async execute(input, ctx) {
    const {
      pattern,
      path: searchPath = ".",
      glob: globPattern,
      output_mode = "content",
      offset = 0,
      context: contextLines,
      "-A": afterContext,
      "-B": beforeContext,
      "-i": caseInsensitive = false,
      "-n": showLineNumbers = true,
      type: fileType,
      multiline = false,
    } = input;
    // head_limit falls back to max_results for backward compat
    const headLimit = input.head_limit ?? input.max_results ?? DEFAULT_HEAD_LIMIT;

    const { fullPath, error: pathError } = validatePath(ctx.worktreePath, searchPath, "read");
    if (pathError) return { type: "error" as const, error: pathError };

    const rgAvailable = getRipgrepPath() !== null;

    try {
      let lines: string[];

      if (rgAvailable) {
        lines = await grepWithRipgrep({
          pattern,
          fullPath,
          cwd: ctx.worktreePath,
          globPattern,
          outputMode: output_mode,
          contextLines,
          afterContext,
          beforeContext,
          caseInsensitive,
          showLineNumbers,
          fileType,
          multiline,
        });
      } else {
        lines = grepWithGrep({ pattern, fullPath, cwd: ctx.worktreePath, globPattern });
      }

      // For files_with_matches mode: sort by mtime (most recent first)
      if (output_mode === "files_with_matches" && lines.length > 0) {
        const stats = await Promise.allSettled(
          lines.map((f) => fs.stat(f)),
        );
        const sorted = lines
          .map((file, i) => {
            const r = stats[i]!;
            return { file, mtime: r.status === "fulfilled" ? r.value.mtimeMs : 0 };
          })
          .sort((a, b) => b.mtime - a.mtime)
          .map((entry) => entry.file);
        lines = sorted;
      }

      // Relativize paths
      lines = lines.map((line) => relativizeLine(line, ctx.worktreePath, output_mode));

      // Apply pagination
      const totalMatches = lines.length;
      const effectiveLimit = headLimit === 0 ? lines.length : headLimit;
      const paginated = lines.slice(offset, offset + effectiveLimit);
      const truncated = totalMatches - offset > effectiveLimit;

      // Build count metadata for count mode
      let numMatches: number | undefined;
      if (output_mode === "count") {
        numMatches = 0;
        for (const line of paginated) {
          const colonIdx = line.lastIndexOf(":");
          if (colonIdx > 0) {
            const count = parseInt(line.slice(colonIdx + 1), 10);
            if (!isNaN(count)) numMatches += count;
          }
        }
      }

      return {
        type: "success",
        content: paginated.length > 0 ? paginated.join("\n") : "No matches found",
        metadata: {
          totalMatches,
          displayedMatches: paginated.length,
          truncated,
          tool: rgAvailable ? "ripgrep" : "grep",
          mode: output_mode,
          ...(numMatches !== undefined && { numMatches }),
          ...(truncated && { appliedLimit: effectiveLimit }),
          ...(offset > 0 && { appliedOffset: offset }),
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
// grep_search helpers
// ---------------------------------------------------------------------------

async function grepWithRipgrep(opts: {
  pattern: string;
  fullPath: string;
  cwd: string;
  globPattern?: string;
  outputMode: "content" | "files_with_matches" | "count";
  contextLines?: number;
  afterContext?: number;
  beforeContext?: number;
  caseInsensitive: boolean;
  showLineNumbers: boolean;
  fileType?: string;
  multiline: boolean;
}): Promise<string[]> {
  const args = ["--hidden", "--no-heading", "--color=never"];

  // Prevent minified/base64 content from blowing up results
  args.push("--max-columns", "500", "--max-columns-preview");

  // VCS directory exclusion
  args.push(...vcsExclusionArgs());

  // Output mode
  if (opts.outputMode === "files_with_matches") {
    args.push("-l");
  } else if (opts.outputMode === "count") {
    args.push("-c");
  }

  // Line numbers (content mode only)
  if (opts.showLineNumbers && opts.outputMode === "content") {
    args.push("-n");
  }

  // Case insensitive
  if (opts.caseInsensitive) {
    args.push("-i");
  }

  // Multiline
  if (opts.multiline) {
    args.push("-U", "--multiline-dotall");
  }

  // Context (content mode only)
  if (opts.outputMode === "content") {
    if (opts.contextLines !== undefined) {
      args.push("-C", opts.contextLines.toString());
    } else {
      if (opts.beforeContext !== undefined) args.push("-B", opts.beforeContext.toString());
      if (opts.afterContext !== undefined) args.push("-A", opts.afterContext.toString());
    }
  }

  // Pattern — use -e flag if it starts with dash
  if (opts.pattern.startsWith("-")) {
    args.push("-e", opts.pattern);
  } else {
    args.push(opts.pattern);
  }

  // File type filter
  if (opts.fileType) {
    args.push("--type", opts.fileType);
  }

  // Glob filter
  if (opts.globPattern) {
    args.push("--glob", opts.globPattern);
  }

  // Search path
  args.push(opts.fullPath);

  return execRipgrep(args, { cwd: opts.cwd });
}

function grepWithGrep(opts: {
  pattern: string;
  fullPath: string;
  cwd: string;
  globPattern?: string;
}): string[] {
  const grepArgs = ["-rn"];
  if (opts.globPattern) {
    grepArgs.push("--include", opts.globPattern);
  }
  grepArgs.push(opts.pattern, opts.fullPath);

  try {
    const stdout = execFileSync("grep", grepArgs, {
      cwd: opts.cwd,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim().split("\n").filter((l) => l.length > 0);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "status" in err && err.status === 1) {
      return [];
    }
    throw err;
  }
}

/** Relativize absolute paths in a grep output line. */
function relativizeLine(line: string, worktreePath: string, mode: string): string {
  if (mode === "files_with_matches") {
    return path.isAbsolute(line) ? path.relative(worktreePath, line) : line;
  }
  // For content and count modes, path is before the first colon
  const colonIdx = line.indexOf(":");
  if (colonIdx > 0) {
    const filePath = line.slice(0, colonIdx);
    if (path.isAbsolute(filePath)) {
      return path.relative(worktreePath, filePath) + line.slice(colonIdx);
    }
  }
  return line;
}

// ---------------------------------------------------------------------------
// 6. glob_search — Find files by glob pattern
// ---------------------------------------------------------------------------

const globSearchSchema = z.object({
  pattern: z.string().describe("Glob pattern to match files (e.g., '**/*.ts', 'src/**/*.test.ts')"),
  path: z.string().optional().describe("Base directory to search from (default: current directory)"),
  head_limit: z.number().int().min(1).max(10000).optional().describe("Maximum number of files to return (default: 1000)"),
  offset: z.number().int().min(0).optional().describe("Skip first N results before applying head_limit (default: 0)"),
});

export const globSearch: ToolDefinition<z.infer<typeof globSearchSchema>> = {
  name: "glob_search",
  description: "Find files matching a glob pattern. Supports ** for recursive matching, * for wildcards, {a,b} for alternatives. Results sorted by modification time (most recent first).",
  inputSchema: globSearchSchema,
  permission: {
    scope: "repo.read",
    readOnly: true,
  },
  alwaysLoad: true,
  concurrencySafe: true,
  searchHints: ["glob", "find", "files", "pattern", "wildcard"],

  async execute(input, ctx) {
    const { pattern, path: basePath = ".", head_limit = 1000, offset = 0 } = input;
    const { fullPath, error: pathError } = validatePath(ctx.worktreePath, basePath, "read");
    if (pathError) return { type: "error" as const, error: pathError };

    try {
      let matches: string[];
      const rgAvailable = getRipgrepPath() !== null;

      if (rgAvailable) {
        // Extract static base dir for more efficient searching
        const { baseDir, relativePattern } = extractGlobBaseDir(pattern);
        const searchDir = baseDir ? path.resolve(fullPath, baseDir) : fullPath;

        const rgArgs = [
          "--files",
          "--sort=modified",
          "--glob", relativePattern,
          ...commonExclusionArgs(),
          searchDir,
        ];

        const lines = await execRipgrep(rgArgs, { cwd: ctx.worktreePath });
        // Relativize to the original base path
        matches = lines.map((p) => path.isAbsolute(p) ? path.relative(fullPath, p) : p);
      } else {
        // Fallback: manual walk
        matches = [];
        async function walk(dir: string, relativeTo: string, currentDepth = 0) {
          if (currentDepth > 20) return;
          const items = await fs.readdir(dir, { withFileTypes: true });
          for (const item of items) {
            const fullItemPath = path.join(dir, item.name);
            const relPath = path.relative(relativeTo, fullItemPath);
            if (item.isDirectory()) {
              if (COMMON_IGNORE_DIRS.includes(item.name as (typeof COMMON_IGNORE_DIRS)[number])) continue;
              await walk(fullItemPath, relativeTo, currentDepth + 1);
            } else if (item.isFile()) {
              if (matchGlob(relPath, pattern)) matches.push(relPath);
            }
          }
        }
        await walk(fullPath, fullPath);
        matches.sort();
      }

      // Apply pagination
      const totalMatches = matches.length;
      const paginated = matches.slice(offset, offset + head_limit);
      const truncated = totalMatches - offset > head_limit;

      return {
        type: "success",
        content: paginated.length > 0 ? paginated.join("\n") : "No files found",
        metadata: {
          totalMatches,
          displayedMatches: paginated.length,
          truncated,
          pattern,
          ...(truncated && { appliedLimit: head_limit }),
          ...(offset > 0 && { appliedOffset: offset }),
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

// ---------------------------------------------------------------------------
// 7. fuzzy_file_search — Fuzzy file finding with nucleo-style scoring
// ---------------------------------------------------------------------------

import { FileIndex } from "../../services/fileIndex";

// Cache FileIndex instances per worktree to avoid re-indexing
const fileIndexCache = new Map<string, FileIndex>();

async function getOrCreateFileIndex(worktreePath: string): Promise<FileIndex> {
  let idx = fileIndexCache.get(worktreePath);
  if (idx && idx.isReady()) return idx;

  idx = new FileIndex();
  fileIndexCache.set(worktreePath, idx);

  // Populate with file list
  const rgAvailable = getRipgrepPath() !== null;
  let files: string[];

  if (rgAvailable) {
    files = await execRipgrep([
      "--files",
      "--sort=modified",
      ...commonExclusionArgs(),
      worktreePath,
    ], { cwd: worktreePath });
    // Convert to relative paths
    files = files.map((f) => path.isAbsolute(f) ? path.relative(worktreePath, f) : f);
  } else {
    // Fallback: manual walk
    files = [];
    async function walk(dir: string) {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        const fullItemPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          if (COMMON_IGNORE_DIRS.includes(item.name as (typeof COMMON_IGNORE_DIRS)[number])) continue;
          await walk(fullItemPath);
        } else if (item.isFile()) {
          files.push(path.relative(worktreePath, fullItemPath));
        }
      }
    }
    await walk(worktreePath);
  }

  idx.loadFromFileList(files);
  return idx;
}

const fuzzyFileSearchSchema = z.object({
  query: z.string().describe("Fuzzy search query (e.g., 'agOrch' matches 'agenticOrchestrator.ts', 'fIdx' matches 'fileIndex.ts')"),
  max_results: z.number().int().min(1).max(50).optional().describe("Maximum number of results to return (default: 10)"),
});

export const fuzzyFileSearch: ToolDefinition<z.infer<typeof fuzzyFileSearchSchema>> = {
  name: "fuzzy_file_search",
  description:
    "Find files by fuzzy matching against file paths. Supports camelCase matching, word boundary bonuses, and smart case (lowercase query = case-insensitive, any uppercase = case-sensitive). Non-test files are prioritized.",
  inputSchema: fuzzyFileSearchSchema,
  permission: {
    scope: "repo.read",
    readOnly: true,
  },
  alwaysLoad: false, // Deferred — loaded via tool_search
  concurrencySafe: true,
  searchHints: ["fuzzy", "find", "file", "search", "fzf", "nucleo", "filename"],

  async execute(input, ctx) {
    const { query, max_results = 10 } = input;

    try {
      const idx = await getOrCreateFileIndex(ctx.worktreePath);
      const results = idx.search(query, max_results);

      if (results.length === 0) {
        return {
          type: "success",
          content: `No files found matching "${query}"`,
          metadata: { totalMatches: 0, indexedFiles: idx.getFileCount() },
        };
      }

      const formatted = results
        .map((r, i) => `${i + 1}. ${r.path}`)
        .join("\n");

      return {
        type: "success",
        content: formatted,
        metadata: {
          totalMatches: results.length,
          indexedFiles: idx.getFileCount(),
          paths: results.map((r) => r.path),
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `Fuzzy file search failed: ${message}`,
      };
    }
  },
};

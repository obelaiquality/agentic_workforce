/**
 * ToolResultOptimizer — reduces context bloat from verbose tool outputs.
 *
 * Each optimizer leaves small outputs untouched and only truncates / filters
 * when the content exceeds a sensible threshold.
 *
 * Large results that exceed PERSIST_THRESHOLD_CHARS are written to disk
 * and replaced with a preview + file reference, so the model can later
 * read the full output if needed.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { safeWriteFile } from "./executionService";

const ERROR_PATTERN = /error|err!|fail|fatal/i;
const BUILD_DIAG_PATTERN = /error|warning|warn|err!/i;

/** Threshold above which results are persisted to disk (100k chars). */
const PERSIST_THRESHOLD_CHARS = 100_000;
/** How many chars of preview to keep in context. */
const PREVIEW_SIZE_CHARS = 10_000;

/* ------------------------------------------------------------------ */
/*  optimizeShellOutput                                               */
/* ------------------------------------------------------------------ */

export function optimizeShellOutput(output: string, maxLines = 50): string {
  const lines = output.split('\n');
  if (lines.length <= 100) return output;

  const errorLines = lines.filter((l) => ERROR_PATTERN.test(l));
  const tail = lines.slice(-maxLines);

  const parts: string[] = [];
  if (errorLines.length > 0) {
    parts.push(errorLines.join('\n'));
    parts.push('---');
  }
  parts.push(tail.join('\n'));
  parts.push(`[truncated: showing last ${maxLines} of ${lines.length} lines]`);

  return parts.join('\n');
}

/* ------------------------------------------------------------------ */
/*  optimizeFileRead                                                  */
/* ------------------------------------------------------------------ */

export function optimizeFileRead(content: string, maxLines = 20): string {
  const lines = content.split('\n');
  if (lines.length <= 200) return content;

  const omitted = lines.length - maxLines * 2;
  const head = lines.slice(0, maxLines);
  const tail = lines.slice(-maxLines);

  return (
    head.join('\n') +
    `\n... [${omitted} lines omitted] ...\n` +
    tail.join('\n')
  );
}

/* ------------------------------------------------------------------ */
/*  optimizeSearchResults                                             */
/* ------------------------------------------------------------------ */

export function optimizeSearchResults(
  results: string,
  maxMatches = 10,
): string {
  const blocks = results.split('\n\n');
  if (blocks.length <= 20) return results;

  const kept = blocks.slice(0, maxMatches);
  const omitted = blocks.length - maxMatches;

  return kept.join('\n\n') + `\n... [${omitted} more matches omitted] ...\n`;
}

/* ------------------------------------------------------------------ */
/*  optimizeBuildOutput                                               */
/* ------------------------------------------------------------------ */

export function optimizeBuildOutput(output: string): string {
  const lines = output.split('\n');
  if (lines.length <= 50) return output;

  const diagnostics = lines.filter((l) => BUILD_DIAG_PATTERN.test(l));

  return (
    `[build output filtered: ${lines.length} total lines, ${diagnostics.length} errors/warnings]\n` +
    diagnostics.join('\n')
  );
}

/* ------------------------------------------------------------------ */
/*  shouldOffload                                                     */
/* ------------------------------------------------------------------ */

export function shouldOffload(content: string, threshold = 8000): boolean {
  return content.length > threshold;
}

/* ------------------------------------------------------------------ */
/*  optimizeToolOutput — dispatcher                                   */
/* ------------------------------------------------------------------ */

export function optimizeToolOutput(
  output: string,
  toolType: 'shell' | 'file_read' | 'search' | 'build',
): string {
  switch (toolType) {
    case 'shell':
      return optimizeShellOutput(output);
    case 'file_read':
      return optimizeFileRead(output);
    case 'search':
      return optimizeSearchResults(output);
    case 'build':
      return optimizeBuildOutput(output);
  }
}

/* ------------------------------------------------------------------ */
/*  persistLargeResult — write oversized output to disk                */
/* ------------------------------------------------------------------ */

export interface PersistedResult {
  /** Path to the persisted file on disk. */
  filepath: string;
  /** Preview text kept in context. */
  preview: string;
  /** Original size in bytes. */
  originalSize: number;
  /** Whether the full content has more data beyond the preview. */
  hasMore: boolean;
}

/**
 * Get the session-specific directory for persisted tool results.
 */
function getToolResultDir(taskId?: string): string {
  const base = path.join(os.homedir(), ".agentic-workforce", "sessions");
  return path.join(base, taskId ?? "default", "tool-results");
}

/**
 * Persist a large tool result to disk. Returns the preview text to keep
 * in context plus metadata. Returns null if the output is below threshold.
 */
export function persistLargeResult(
  output: string,
  options?: {
    taskId?: string;
    label?: string;
    threshold?: number;
    previewSize?: number;
  },
): PersistedResult | null {
  const threshold = options?.threshold ?? PERSIST_THRESHOLD_CHARS;
  if (output.length <= threshold) return null;

  const previewSize = options?.previewSize ?? PREVIEW_SIZE_CHARS;
  const dir = getToolResultDir(options?.taskId);
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${options?.label ?? "result"}-${randomUUID().slice(0, 8)}.txt`;
  const filepath = path.join(dir, filename);
  safeWriteFile(filepath, output);

  const preview = output.slice(0, previewSize);
  return {
    filepath,
    preview,
    originalSize: Buffer.byteLength(output),
    hasMore: output.length > previewSize,
  };
}

/**
 * Optimize and optionally persist a tool result.
 * If the output exceeds the persistence threshold, it is written to disk
 * and the in-context content is replaced with a preview + reference.
 */
export function optimizeAndPersist(
  output: string,
  toolType: 'shell' | 'file_read' | 'search' | 'build',
  options?: { taskId?: string; label?: string },
): string {
  // First, try persistence for very large results
  const persisted = persistLargeResult(output, options);
  if (persisted) {
    const lines = [
      persisted.preview,
      "",
      `[Full output (${formatBytes(persisted.originalSize)}) saved to: ${persisted.filepath}]`,
    ];
    return lines.join("\n");
  }

  // Otherwise, apply normal optimization
  return optimizeToolOutput(output, toolType);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

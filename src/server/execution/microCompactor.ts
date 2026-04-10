/**
 * MicroCompactor — inline compaction of tool results before they enter
 * the conversation history. This prevents context bloat from large tool
 * outputs while preserving error lines and key information.
 *
 * Unlike toolResultOptimizer which persists to disk, microCompactor
 * operates in-memory and compresses the result string itself.
 * It is called in the orchestrator loop between tool execution and
 * conversation append.
 *
 * Pure functions — no side effects, no I/O.
 */

import {
  optimizeShellOutput,
  optimizeFileRead,
  optimizeSearchResults,
  optimizeBuildOutput,
} from "../services/toolResultOptimizer";

/** Default threshold: results under this size are returned unchanged. */
export const DEFAULT_MICRO_COMPACT_THRESHOLD = 8_000;

/** Error patterns to always preserve in compacted output. */
const ERROR_LINE_PATTERN = /error|err!|fail|fatal|exception|traceback|panic/i;

/**
 * Tool type categories for selecting the right compaction strategy.
 */
export type CompactableToolType = "shell" | "file_read" | "search" | "build" | "generic";

/**
 * Infer the compaction category from a tool name.
 */
export function inferToolType(toolName: string): CompactableToolType {
  switch (toolName) {
    case "bash":
    case "run_tests":
    case "run_linter":
      return "shell";
    case "read_file":
      return "file_read";
    case "grep_search":
    case "glob_search":
      return "search";
    case "run_build":
      return "build";
    default:
      return "generic";
  }
}

/**
 * Compact a tool result string if it exceeds the threshold.
 * Returns the original string unchanged if it's small enough.
 *
 * For known tool types, delegates to the specialized optimizers
 * from toolResultOptimizer. For generic/unknown tools, applies
 * a generic strategy that preserves error lines + head/tail.
 */
export function compactToolResult(
  content: string,
  toolName: string,
  threshold: number = DEFAULT_MICRO_COMPACT_THRESHOLD,
): string {
  if (content.length <= threshold) {
    return content;
  }

  const toolType = inferToolType(toolName);

  switch (toolType) {
    case "shell":
      return optimizeShellOutput(content, 30);
    case "file_read":
      return optimizeFileRead(content, 15);
    case "search":
      return optimizeSearchResults(content, 8);
    case "build":
      return optimizeBuildOutput(content);
    case "generic":
      return compactGeneric(content, threshold);
  }
}

/**
 * Generic compaction for tool types without a specialized optimizer.
 * Preserves error lines + first/last portions of the output.
 */
function compactGeneric(content: string, maxChars: number): string {
  const lines = content.split("\n");

  // For very few lines but large char count (e.g. single long line),
  // truncate by character count instead of line count.
  if (lines.length <= 10) {
    const halfChars = Math.floor(maxChars / 2);
    const head = content.slice(0, halfChars);
    const tail = content.slice(-halfChars);
    return `${head}\n[... ${content.length - maxChars} chars omitted ...]\n${tail}`;
  }

  // Extract error lines
  const errorLines = lines.filter((l) => ERROR_LINE_PATTERN.test(l));

  // Keep head and tail
  const keepLines = Math.max(10, Math.floor(maxChars / 80));
  const halfKeep = Math.floor(keepLines / 2);
  const head = lines.slice(0, halfKeep);
  const tail = lines.slice(-halfKeep);
  const omitted = lines.length - halfKeep * 2;

  const parts: string[] = [];
  if (errorLines.length > 0) {
    parts.push(`[${errorLines.length} error/warning lines found]`);
    parts.push(errorLines.slice(0, 20).join("\n"));
    parts.push("---");
  }
  parts.push(head.join("\n"));
  if (omitted > 0) {
    parts.push(`\n[... ${omitted} lines omitted, ${content.length} chars total ...]\n`);
  }
  parts.push(tail.join("\n"));

  return parts.join("\n");
}

/**
 * Compact the result content field of a ToolResultBlock in-place.
 * Only compacts "success" results with string content.
 * Returns the (possibly shortened) content string.
 */
export function compactToolResultContent(
  toolName: string,
  resultContent: string | undefined,
  threshold?: number,
): string | undefined {
  if (!resultContent || resultContent.length <= (threshold ?? DEFAULT_MICRO_COMPACT_THRESHOLD)) {
    return resultContent;
  }
  return compactToolResult(resultContent, toolName, threshold);
}

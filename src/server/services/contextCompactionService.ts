/**
 * Adaptive context compaction to prevent context overflow in long sessions.
 * Core functions are pure — no side effects, no DB access.
 * Memory-aware compaction (compactWithMemory) optionally commits summaries
 * to episodic memory before dropping assistant reasoning.
 */

import fs from "node:fs";
import type { MemoryService } from "./memoryService";
import { truncateFileContent } from "./codebaseHelpers";

export interface CompactionMessage {
  role: "system" | "user" | "assistant";
  content: string;
  pinned?: boolean;
}

export interface CompactionResult {
  messages: CompactionMessage[];
  stage: number;
  pressure: number;
  tokensBefore: number;
  tokensAfter: number;
}

export interface CompactionTracker {
  consecutiveFailures: number;
  lastCompactedAt: string | null;
  totalCompactions: number;
}

/** Max consecutive failures before circuit breaker trips. */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Rough token estimate: ~4 chars per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Returns current token usage as a fraction of the max (0-1). */
export function computePressure(
  messages: CompactionMessage[],
  maxContextTokens: number,
): number {
  const totalTokens = messages.reduce(
    (sum, m) => sum + estimateTokens(m.content),
    0,
  );
  return totalTokens / maxContextTokens;
}

// ---------------------------------------------------------------------------
// Internal stage helpers
// ---------------------------------------------------------------------------

function totalTokens(messages: CompactionMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

function isCompactable(
  msg: CompactionMessage,
  index: number,
  total: number,
  lastN: number,
): boolean {
  if (msg.pinned) return false;
  if (msg.role !== "assistant") return false;
  if (index >= total - lastN) return false;
  return true;
}

/** Stage 1: summarize old tool results — truncate to first 200 chars. */
function applySummarizeOldResults(
  messages: CompactionMessage[],
): CompactionMessage[] {
  const len = messages.length;
  return messages.map((m, i) => {
    if (!isCompactable(m, i, len, 3)) return m;
    if (m.content.length <= 200) return m;
    return { ...m, content: m.content.slice(0, 200) + "... [compacted]" };
  });
}

/** Stage 2: compress assistant reasoning — keep decision/result/output/conclusion lines. */
function applyCompressReasoning(
  messages: CompactionMessage[],
): CompactionMessage[] {
  const keywords = ["decision:", "result:", "output:", "conclusion:"];
  const len = messages.length;
  return messages.map((m, i) => {
    if (!isCompactable(m, i, len, 3)) return m;
    const lines = m.content.split("\n");
    const kept = lines.filter((line) =>
      keywords.some((kw) => line.toLowerCase().includes(kw)),
    );
    if (kept.length > 0) {
      return { ...m, content: kept.join("\n") };
    }
    if (m.content.length <= 100) return m;
    return {
      ...m,
      content: m.content.slice(0, 100) + "... [reasoning compacted]",
    };
  });
}

/** Stage 3: drop file contents inside code fences. */
function applyDropFileContents(
  messages: CompactionMessage[],
): CompactionMessage[] {
  const fenceRegex = /```[^\n]*\n([\s\S]*?)```/g;
  const len = messages.length;
  return messages.map((m, i) => {
    if (!isCompactable(m, i, len, 3)) return m;
    if (!m.content.includes("```")) return m;
    const replaced = m.content.replace(fenceRegex, (_match, inner: string) => {
      const lineCount = inner.split("\n").length;
      return `[file content omitted - ${lineCount} lines]`;
    });
    return { ...m, content: replaced };
  });
}

/** Stage 4: merge consecutive same-role messages. */
function applyMergeConsecutive(
  messages: CompactionMessage[],
): CompactionMessage[] {
  if (messages.length === 0) return [];
  const result: CompactionMessage[] = [messages[0]];
  for (let i = 1; i < messages.length; i++) {
    const prev = result[result.length - 1];
    const curr = messages[i];
    // Don't merge if either is pinned (preserve pinned identity)
    if (curr.role === prev.role && !curr.pinned && !prev.pinned) {
      result[result.length - 1] = {
        ...prev,
        content: prev.content + "\n\n" + curr.content,
      };
    } else {
      result.push(curr);
    }
  }
  return result;
}

/** Stage 5: emergency — keep only pinned + last 5 non-pinned. */
function applyEmergency(messages: CompactionMessage[]): CompactionMessage[] {
  const pinned = messages.filter((m) => m.pinned);
  const nonPinned = messages.filter((m) => !m.pinned);
  const lastFive = nonPinned.slice(-5);
  return [...pinned, ...lastFive];
}

// ---------------------------------------------------------------------------
// Stage 0: Snip compact (zero-cost time-based pruning)
// ---------------------------------------------------------------------------

export interface SnipCompactOptions {
  /** Number of recent turns (user+assistant pairs) to always keep. Default 10. */
  protectedTailTurns?: number;
  /** Pressure threshold below which snip is skipped. Default 0.5. */
  minPressure?: number;
}

/**
 * Zero-cost message pruning. Drops old messages beyond a sliding window
 * without summarization or API calls. Preserves pinned and system messages.
 */
export function snipCompact(
  messages: CompactionMessage[],
  maxContextTokens: number,
  options?: SnipCompactOptions,
): CompactionResult {
  const protectedTailTurns = options?.protectedTailTurns ?? 10;
  const minPressure = options?.minPressure ?? 0.5;
  const tokensBefore = totalTokens(messages);
  const pressure = computePressure(messages, maxContextTokens);

  if (pressure < minPressure) {
    return { messages: [...messages], stage: 0, pressure, tokensBefore, tokensAfter: tokensBefore };
  }

  // Count turns from the end. A turn boundary = a user message.
  // If fewer turns exist than protectedTailTurns, protect everything.
  let turnCount = 0;
  let protectedStartIndex = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      turnCount++;
      if (turnCount >= protectedTailTurns) {
        protectedStartIndex = i;
        break;
      }
    }
  }

  // Keep: all pinned, all system, and everything from protectedStartIndex onward
  const kept = messages.filter(
    (m, i) => m.pinned || m.role === "system" || i >= protectedStartIndex,
  );

  if (kept.length === messages.length) {
    return { messages: kept, stage: 0, pressure, tokensBefore, tokensAfter: tokensBefore };
  }

  const tokensAfter = totalTokens(kept);
  return {
    messages: kept,
    stage: 0,
    pressure: computePressure(kept, maxContextTokens),
    tokensBefore,
    tokensAfter,
  };
}

// ---------------------------------------------------------------------------
// Main compaction entry point
// ---------------------------------------------------------------------------

interface StageEntry {
  threshold: number;
  apply: (msgs: CompactionMessage[]) => CompactionMessage[];
}

const stages: StageEntry[] = [
  { threshold: 0.7, apply: applySummarizeOldResults },
  { threshold: 0.8, apply: applyCompressReasoning },
  { threshold: 0.85, apply: applyDropFileContents },
  { threshold: 0.9, apply: applyMergeConsecutive },
  { threshold: 0.99, apply: applyEmergency },
];

export function compactMessages(
  messages: CompactionMessage[],
  maxContextTokens: number,
): CompactionResult {
  const tokensBefore = totalTokens(messages);
  let current = [...messages];
  let pressure = computePressure(current, maxContextTokens);
  let appliedStage = 0;

  // Stage 0: snip compact — zero-cost pruning of old messages
  const snipResult = snipCompact(current, maxContextTokens);
  if (snipResult.tokensAfter < snipResult.tokensBefore) {
    current = snipResult.messages;
    pressure = snipResult.pressure;
    // If snip alone brought pressure below stage 1 threshold, return early
    if (pressure < stages[0].threshold) {
      return {
        messages: current,
        stage: 0,
        pressure,
        tokensBefore,
        tokensAfter: totalTokens(current),
      };
    }
  }

  if (pressure < stages[0].threshold) {
    return {
      messages: current,
      stage: 0,
      pressure,
      tokensBefore,
      tokensAfter: tokensBefore,
    };
  }

  for (const stage of stages) {
    if (pressure < stage.threshold) break;
    appliedStage = stages.indexOf(stage) + 1;
    current = stage.apply(current);
    pressure = computePressure(current, maxContextTokens);
  }

  return {
    messages: current,
    stage: appliedStage,
    pressure,
    tokensBefore,
    tokensAfter: totalTokens(current),
  };
}

// ---------------------------------------------------------------------------
// Circuit-breaker-aware compaction
// ---------------------------------------------------------------------------

export function createCompactionTracker(): CompactionTracker {
  return { consecutiveFailures: 0, lastCompactedAt: null, totalCompactions: 0 };
}

/**
 * Attempt compaction with circuit breaker protection.
 * After MAX_CONSECUTIVE_FAILURES, compaction is skipped until the tracker is reset.
 * Returns null when the circuit breaker is open.
 */
export function compactWithCircuitBreaker(
  messages: CompactionMessage[],
  maxContextTokens: number,
  tracker: CompactionTracker,
): CompactionResult | null {
  if (tracker.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    return null;
  }

  const result = compactMessages(messages, maxContextTokens);

  if (result.tokensAfter >= result.tokensBefore) {
    // Compaction did not reduce tokens — count as failure
    tracker.consecutiveFailures += 1;
    return result;
  }

  // Successful compaction — reset failures
  tracker.consecutiveFailures = 0;
  tracker.lastCompactedAt = new Date().toISOString();
  tracker.totalCompactions += 1;
  return result;
}

/**
 * Emergency compaction — skips directly to stage 4-5 (merge + emergency).
 * Used by reactive compaction when the API rejects with prompt_too_long.
 */
export function emergencyCompact(
  messages: CompactionMessage[],
  maxContextTokens: number,
): CompactionResult {
  const tokensBefore = totalTokens(messages);
  let current = [...messages];

  // Apply merge consecutive (stage 4)
  current = applyMergeConsecutive(current);
  let pressure = computePressure(current, maxContextTokens);

  // If still over, apply emergency (stage 5)
  if (pressure >= 0.9) {
    current = applyEmergency(current);
    pressure = computePressure(current, maxContextTokens);
  }

  return {
    messages: current,
    stage: 5,
    pressure,
    tokensBefore,
    tokensAfter: totalTokens(current),
  };
}

// ---------------------------------------------------------------------------
// Memory-aware compaction
// ---------------------------------------------------------------------------

/**
 * Compact messages with memory integration.
 * Before dropping assistant reasoning (stage 2+), extracts a summary
 * and commits it to episodic memory so the information is preserved
 * across the compaction boundary.
 *
 * This is the recommended entry point when a MemoryService is available.
 */
export function compactWithMemory(
  messages: CompactionMessage[],
  maxContextTokens: number,
  memoryService: MemoryService,
  tracker?: CompactionTracker,
): CompactionResult | null {
  let currentMessages = [...messages];

  // Stage 0: snip compact with memory extraction for dropped messages
  const snipResult = snipCompact(currentMessages, maxContextTokens);
  if (snipResult.tokensAfter < snipResult.tokensBefore) {
    const droppedAssistant = currentMessages.filter(
      (m) => !snipResult.messages.includes(m) && m.role === "assistant",
    );
    if (droppedAssistant.length > 0) {
      const keywords = ["decision:", "result:", "output:", "conclusion:", "error:", "fix:"];
      const extractedLines: string[] = [];
      for (const msg of droppedAssistant) {
        const lines = msg.content.split("\n");
        const keyLines = lines.filter((line) =>
          keywords.some((kw) => line.toLowerCase().includes(kw)),
        );
        extractedLines.push(...keyLines.slice(0, 3));
      }
      if (extractedLines.length > 0) {
        memoryService.commitCompactionSummary({
          droppedMessageCount: droppedAssistant.length,
          stage: 0,
          pressure: snipResult.pressure,
          sessionContext: extractedLines.slice(0, 5).join("; "),
        });
      }
    }
    currentMessages = snipResult.messages;
  }

  const pressure = computePressure(currentMessages, maxContextTokens);

  // If we're going to compact at stage 2+ (reasoning compression),
  // extract summaries from the content that will be dropped
  if (pressure >= 0.8) {
    const len = currentMessages.length;
    const droppableAssistant = currentMessages.filter(
      (m, i) => !m.pinned && m.role === "assistant" && i < len - 3,
    );

    if (droppableAssistant.length > 0) {
      // Extract key information from assistant messages before they're compacted
      const keywords = ["decision:", "result:", "output:", "conclusion:", "error:", "fix:"];
      const extractedLines: string[] = [];

      for (const msg of droppableAssistant) {
        const lines = msg.content.split("\n");
        const keyLines = lines.filter((line) =>
          keywords.some((kw) => line.toLowerCase().includes(kw)),
        );
        extractedLines.push(...keyLines.slice(0, 3));
      }

      if (extractedLines.length > 0) {
        memoryService.commitCompactionSummary({
          droppedMessageCount: droppableAssistant.length,
          stage: pressure >= 0.99 ? 5 : pressure >= 0.9 ? 4 : pressure >= 0.85 ? 3 : 2,
          pressure,
          sessionContext: extractedLines.slice(0, 5).join("; "),
        });
      }
    }
  }

  // Proceed with normal compaction (with or without circuit breaker)
  const result = tracker
    ? compactWithCircuitBreaker(currentMessages, maxContextTokens, tracker)
    : compactMessages(currentMessages, maxContextTokens);

  // Post-compaction file recovery: restore recently accessed files after stage 2+
  if (result && result.stage >= 2) {
    const restored = restoreRecentFiles(recentFileAccesses, {
      maxFiles: 5,
      totalBudget: 50_000,
      perFileBudget: 5_000,
    });
    if (restored.length > 0) {
      result.messages.push({
        role: "user",
        content: `[Context recovery — ${restored.length} recently accessed file(s)]\n\n${restored.join("\n\n")}`,
      });
      result.tokensAfter = totalTokens(result.messages);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Post-compaction file recovery
// ---------------------------------------------------------------------------

const recentFileAccesses: string[] = [];

/** Record a file access for post-compaction recovery. Keeps last 20 unique paths. */
export function recordFileAccess(filePath: string): void {
  const idx = recentFileAccesses.indexOf(filePath);
  if (idx >= 0) recentFileAccesses.splice(idx, 1);
  recentFileAccesses.unshift(filePath);
  if (recentFileAccesses.length > 20) recentFileAccesses.length = 20;
}

/** Restore recently accessed files within budget constraints. */
function restoreRecentFiles(
  paths: string[],
  budget: { maxFiles: number; totalBudget: number; perFileBudget: number },
): string[] {
  const restored: string[] = [];
  let totalChars = 0;

  for (const filePath of paths.slice(0, budget.maxFiles)) {
    if (totalChars >= budget.totalBudget) break;
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, "utf-8");
      const { content } = truncateFileContent(raw, 125, budget.perFileBudget);
      restored.push(`File: ${filePath}\n${content}`);
      totalChars += content.length;
    } catch {
      // Skip unreadable files
    }
  }

  return restored;
}

/** Reset recent file accesses (for testing). */
export function resetFileAccesses(): void {
  recentFileAccesses.length = 0;
}

// ---------------------------------------------------------------------------
// Cache topology estimation
// ---------------------------------------------------------------------------

import type { CacheTopologyHint } from "./toolResultOptimizer";

/**
 * Estimate which messages are in the API's cached prefix region.
 * System prompts and the first user message are typically cached;
 * modifying them breaks the cache prefix and causes cost spikes.
 */
export function computeCacheTopologyMap(
  messages: CompactionMessage[],
): Map<number, CacheTopologyHint> {
  const map = new Map<number, CacheTopologyHint>();
  let firstUserSeen = false;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const isSystem = msg.role === "system";
    const isFirstUser = msg.role === "user" && !firstUserSeen;

    if (isFirstUser) firstUserSeen = true;

    map.set(i, {
      messageIndex: i,
      inCachedRegion: isSystem || isFirstUser,
      hasCacheBreakpoint: msg.pinned === true,
    });
  }

  return map;
}

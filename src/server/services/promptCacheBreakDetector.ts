/**
 * PromptCacheBreakDetector — detects sudden drops in API prompt cache hit rates.
 *
 * Pure-function module. All state is explicit (CacheBreakDetectorState).
 * No side effects — callers decide what to do with detected breaks.
 */

export type CacheBreakCause =
  | "system_prompt_changed"
  | "tool_schema_changed"
  | "message_ordering_changed"
  | "compaction_occurred"
  | "unknown";

export interface CacheBreakEvent {
  /** Previous baseline cache read tokens. */
  previousBaseline: number;
  /** Current cache read tokens that triggered the break. */
  currentTokens: number;
  /** How much the hit rate dropped (0-1). */
  dropPercent: number;
  /** Diagnosed possible causes for the break. */
  possibleCauses: CacheBreakCause[];
  /** ISO timestamp of detection. */
  timestamp: string;
}

export interface CacheBreakDetectorState {
  /** Exponential moving average of cache read tokens. */
  baselineCacheReadTokens: number;
  /** Number of observations recorded. */
  sampleCount: number;
  /** Hash of the last system prompt seen. */
  lastSystemPromptHash: string | null;
  /** Hash of the last tool schema configuration seen. */
  lastToolSchemaHash: string | null;
  /** Number of messages in the last observed conversation. */
  lastMessageCount: number;
  /** Whether a compaction has occurred since the last check. */
  compactionSinceLastCheck: boolean;
}

/** Smoothing factor for exponential moving average (0-1). Higher = more responsive. */
const EMA_ALPHA = 0.3;

/** Minimum samples before detection is meaningful. */
const MIN_SAMPLES_FOR_DETECTION = 3;

/** Create a fresh detector state. */
export function createDetectorState(): CacheBreakDetectorState {
  return {
    baselineCacheReadTokens: 0,
    sampleCount: 0,
    lastSystemPromptHash: null,
    lastToolSchemaHash: null,
    lastMessageCount: 0,
    compactionSinceLastCheck: false,
  };
}

/**
 * Simple djb2 hash for comparing strings efficiently.
 * Not cryptographic — just for change detection.
 */
export function simpleHash(s: string): string {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) & 0xffffffff;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Record a cache observation after an API request.
 * Updates the baseline using exponential moving average.
 */
export function recordObservation(
  state: CacheBreakDetectorState,
  cacheReadTokens: number,
  systemPromptHash?: string,
  toolSchemaHash?: string,
  messageCount?: number,
): void {
  if (state.sampleCount === 0) {
    state.baselineCacheReadTokens = cacheReadTokens;
  } else {
    state.baselineCacheReadTokens =
      EMA_ALPHA * cacheReadTokens +
      (1 - EMA_ALPHA) * state.baselineCacheReadTokens;
  }

  state.sampleCount += 1;

  if (systemPromptHash !== undefined) {
    state.lastSystemPromptHash = systemPromptHash;
  }
  if (toolSchemaHash !== undefined) {
    state.lastToolSchemaHash = toolSchemaHash;
  }
  if (messageCount !== undefined) {
    state.lastMessageCount = messageCount;
  }
}

/**
 * Check whether a cache read token count constitutes a cache break.
 * A break is detected when cache read tokens drop more than `threshold` (default 50%)
 * below the baseline.
 */
export function detectBreak(
  state: CacheBreakDetectorState,
  currentCacheReadTokens: number,
  options?: {
    threshold?: number;
    currentSystemPromptHash?: string;
    currentToolSchemaHash?: string;
    currentMessageCount?: number;
  },
): CacheBreakEvent | null {
  const threshold = options?.threshold ?? 0.5;

  if (state.sampleCount < MIN_SAMPLES_FOR_DETECTION) return null;
  if (state.baselineCacheReadTokens <= 0) return null;

  const dropPercent =
    1 - currentCacheReadTokens / state.baselineCacheReadTokens;

  if (dropPercent < threshold) return null;

  const possibleCauses: CacheBreakCause[] = [];

  if (
    options?.currentSystemPromptHash !== undefined &&
    state.lastSystemPromptHash !== null &&
    options.currentSystemPromptHash !== state.lastSystemPromptHash
  ) {
    possibleCauses.push("system_prompt_changed");
  }

  if (
    options?.currentToolSchemaHash !== undefined &&
    state.lastToolSchemaHash !== null &&
    options.currentToolSchemaHash !== state.lastToolSchemaHash
  ) {
    possibleCauses.push("tool_schema_changed");
  }

  if (
    options?.currentMessageCount !== undefined &&
    state.lastMessageCount > 0 &&
    options.currentMessageCount < state.lastMessageCount
  ) {
    possibleCauses.push("message_ordering_changed");
  }

  if (state.compactionSinceLastCheck) {
    possibleCauses.push("compaction_occurred");
  }

  if (possibleCauses.length === 0) {
    possibleCauses.push("unknown");
  }

  return {
    previousBaseline: state.baselineCacheReadTokens,
    currentTokens: currentCacheReadTokens,
    dropPercent,
    possibleCauses,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Reset the baseline after a known topology change (e.g., compaction).
 * Prevents false positive break detection on the next observation.
 */
export function resetBaseline(state: CacheBreakDetectorState): void {
  state.baselineCacheReadTokens = 0;
  state.sampleCount = 0;
  state.compactionSinceLastCheck = false;
}

/**
 * Mark that a compaction occurred. The next detectBreak call will
 * include "compaction_occurred" as a possible cause.
 */
export function markCompaction(state: CacheBreakDetectorState): void {
  state.compactionSinceLastCheck = true;
}

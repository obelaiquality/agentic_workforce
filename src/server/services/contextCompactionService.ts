/**
 * Adaptive context compaction to prevent context overflow in long sessions.
 * All functions are pure — no side effects, no DB access.
 */

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

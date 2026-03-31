import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// ── Types ───────────────────────────────────────────────────────────────────

export interface EpisodicMemory {
  id: string;
  taskDescription: string;
  summary: string; // max 500 chars
  outcome: "success" | "failure" | "partial";
  keyFiles: string[];
  lessons: string[];
  createdAt: string;
}

export interface WorkingMemoryMessage {
  role: "system" | "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface MemoryComposition {
  episodicContext: string; // formatted episodic memories for injection
  workingMessages: WorkingMemoryMessage[];
  stats: {
    episodicCount: number;
    workingCount: number;
    totalTokenEstimate: number;
  };
}

export interface MemoryConfig {
  workingWindowSize: number; // default 15
  maxEpisodicMemories: number; // default 50
  relevanceTopK: number; // default 10
  memoryDir: string; // default ".agentic-workforce/memory"
}

// ── Utility functions ───────────────────────────────────────────────────────

/**
 * Lowercase, split on non-alphanumeric, filter tokens >= 2 chars, deduplicate.
 */
export function tokenize(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
  return [...new Set(tokens)];
}

/**
 * Bag-of-words cosine similarity: intersection count / sqrt(|a| * |b|).
 * Returns 0 if either array is empty.
 */
export function cosineSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let intersection = 0;
  for (const token of a) {
    if (setB.has(token)) intersection++;
  }
  return intersection / Math.sqrt(a.length * b.length);
}

/**
 * Truncate text to maxChars, appending "..." if truncated.
 */
export function truncateToChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "...";
}

// ── Default config ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG: MemoryConfig = {
  workingWindowSize: 15,
  maxEpisodicMemories: 50,
  relevanceTopK: 10,
  memoryDir: ".agentic-workforce/memory",
};

// ── Service ─────────────────────────────────────────────────────────────────

export class MemoryService {
  private episodic: EpisodicMemory[] = [];
  private working: WorkingMemoryMessage[] = [];
  private config: MemoryConfig;
  private memoryDirAbsolute: string;

  constructor(projectRoot: string, config?: Partial<MemoryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.memoryDirAbsolute = path.resolve(projectRoot, this.config.memoryDir);
  }

  // ── Persistence ─────────────────────────────────────────────────────────

  loadEpisodicMemory(): void {
    const filePath = path.join(this.memoryDirAbsolute, "episodic.json");
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      this.episodic = JSON.parse(raw) as EpisodicMemory[];
    }
  }

  saveEpisodicMemory(): void {
    if (!fs.existsSync(this.memoryDirAbsolute)) {
      fs.mkdirSync(this.memoryDirAbsolute, { recursive: true });
    }
    const filePath = path.join(this.memoryDirAbsolute, "episodic.json");
    fs.writeFileSync(filePath, JSON.stringify(this.episodic, null, 2), "utf-8");
  }

  // ── Episodic memory ────────────────────────────────────────────────────

  addEpisodicMemory(input: {
    taskDescription: string;
    summary: string;
    outcome: "success" | "failure" | "partial";
    keyFiles?: string[];
    lessons?: string[];
  }): EpisodicMemory {
    const memory: EpisodicMemory = {
      id: randomUUID(),
      taskDescription: input.taskDescription,
      summary: truncateToChars(input.summary, 500),
      outcome: input.outcome,
      keyFiles: input.keyFiles ?? [],
      lessons: input.lessons ?? [],
      createdAt: new Date().toISOString(),
    };

    this.episodic.push(memory);

    if (this.episodic.length > this.config.maxEpisodicMemories) {
      this.episodic.shift();
    }

    this.saveEpisodicMemory();
    return memory;
  }

  // ── Working memory ────────────────────────────────────────────────────

  addWorkingMessage(msg: {
    role: "system" | "user" | "assistant";
    content: string;
  }): void {
    this.working.push({
      ...msg,
      timestamp: new Date().toISOString(),
    });

    if (this.working.length > this.config.workingWindowSize) {
      this.working.shift();
    }
  }

  // ── Retrieval ─────────────────────────────────────────────────────────

  getRelevantEpisodicMemories(taskDescription: string): EpisodicMemory[] {
    const queryTokens = tokenize(taskDescription);

    const scored = this.episodic.map((mem) => {
      const memTokens = tokenize(mem.taskDescription + " " + mem.summary);
      const score = cosineSimilarity(queryTokens, memTokens);
      return { mem, score };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, this.config.relevanceTopK).map((s) => s.mem);
  }

  // ── Composition ───────────────────────────────────────────────────────

  compose(currentTask: string): MemoryComposition {
    const relevant = this.getRelevantEpisodicMemories(currentTask);

    let episodicContext = "";
    if (relevant.length > 0) {
      episodicContext = "## Previous Task Experience\n";
      relevant.forEach((mem, i) => {
        episodicContext += `${i + 1}. ${mem.summary}`;
        if (mem.lessons.length > 0) {
          episodicContext += ` (Lessons: ${mem.lessons.join("; ")})`;
        }
        episodicContext += "\n";
      });
    }

    const workingMessages = [...this.working];

    const totalText =
      episodicContext + workingMessages.map((m) => m.content).join(" ");
    // Rough estimate: ~4 chars per token
    const totalTokenEstimate = Math.ceil(totalText.length / 4);

    return {
      episodicContext,
      workingMessages,
      stats: {
        episodicCount: relevant.length,
        workingCount: workingMessages.length,
        totalTokenEstimate,
      },
    };
  }

  // ── Eviction ──────────────────────────────────────────────────────────

  /**
   * Evict the oldest N episodic memories.
   * Returns the number of tokens freed (estimated).
   * Used by context compaction as a lightweight first pass before
   * expensive LLM-driven summarization.
   */
  evictOldestEpisodic(count: number): { evicted: number; tokensFreed: number } {
    const toEvict = Math.min(count, this.episodic.length);
    if (toEvict === 0) return { evicted: 0, tokensFreed: 0 };

    const removed = this.episodic.splice(0, toEvict);
    const tokensFreed = removed.reduce((sum, mem) => {
      const text = mem.summary + " " + mem.lessons.join(" ");
      return sum + Math.ceil(text.length / 4);
    }, 0);

    this.saveEpisodicMemory();
    return { evicted: toEvict, tokensFreed };
  }

  /**
   * Trim working memory to keep only the last N messages.
   * Returns estimated tokens freed.
   */
  trimWorking(keepLast: number): { trimmed: number; tokensFreed: number } {
    if (this.working.length <= keepLast) return { trimmed: 0, tokensFreed: 0 };

    const toRemove = this.working.length - keepLast;
    const removed = this.working.splice(0, toRemove);
    const tokensFreed = removed.reduce(
      (sum, msg) => sum + Math.ceil(msg.content.length / 4),
      0,
    );

    return { trimmed: toRemove, tokensFreed };
  }

  /** Get the total count of episodic memories. */
  episodicCount(): number {
    return this.episodic.length;
  }

  /** Get the total count of working memory messages. */
  workingCount(): number {
    return this.working.length;
  }

  // ── Clearing ──────────────────────────────────────────────────────────

  clearWorking(): void {
    this.working = [];
  }

  clearAll(): void {
    this.episodic = [];
    this.working = [];
    const filePath = path.join(this.memoryDirAbsolute, "episodic.json");
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

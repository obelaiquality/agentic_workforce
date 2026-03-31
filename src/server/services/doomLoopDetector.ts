import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";

interface WindowEntry {
  fingerprint: string;
  actionName: string;
}

/** Default maximum nesting depth before requiring explicit override. */
const DEFAULT_MAX_CHAIN_DEPTH = 5;

export interface ChainContext {
  chainId: string;
  depth: number;
}

export class DoomLoopDetector {
  private window: WindowEntry[] = [];
  private readonly windowSize: number;
  private readonly threshold: number;
  private readonly maxChainDepth: number;
  private currentChain: ChainContext;

  constructor(windowSize = 20, threshold = 3, maxChainDepth = DEFAULT_MAX_CHAIN_DEPTH) {
    this.windowSize = windowSize;
    this.threshold = threshold;
    this.maxChainDepth = maxChainDepth;
    this.currentChain = { chainId: randomUUID(), depth: 0 };
  }

  record(actionName: string, args: Record<string, unknown>): void {
    const sortedArgs = Object.keys(args)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = args[key];
        return acc;
      }, {});

    const payload = JSON.stringify({ actionName, ...sortedArgs });
    const fingerprint = createHash("md5").update(payload).digest("hex");

    this.window.push({ fingerprint, actionName });

    if (this.window.length > this.windowSize) {
      this.window = this.window.slice(this.window.length - this.windowSize);
    }
  }

  isLooping(): boolean {
    return this.getLoopingAction() !== null;
  }

  reset(): void {
    this.window = [];
  }

  getLoopingAction(): string | null {
    const counts = new Map<string, { count: number; actionName: string }>();

    for (const entry of this.window) {
      const existing = counts.get(entry.fingerprint);
      if (existing) {
        existing.count++;
      } else {
        counts.set(entry.fingerprint, { count: 1, actionName: entry.actionName });
      }
    }

    let maxEntry: { count: number; actionName: string } | null = null;
    for (const val of counts.values()) {
      if (val.count >= this.threshold && (maxEntry === null || val.count > maxEntry.count)) {
        maxEntry = val;
      }
    }

    return maxEntry?.actionName ?? null;
  }

  stats(): { windowSize: number; recorded: number; threshold: number; looping: boolean; chainDepth: number } {
    return {
      windowSize: this.windowSize,
      recorded: this.window.length,
      threshold: this.threshold,
      looping: this.isLooping(),
      chainDepth: this.currentChain.depth,
    };
  }

  // ── Chain depth tracking ─────────────────────────────────────────────

  /** Get the current chain context for threading through sub-tasks. */
  getChainContext(): ChainContext {
    return { ...this.currentChain };
  }

  /** Create a child chain context (increments depth). */
  createChildChain(): ChainContext {
    return {
      chainId: this.currentChain.chainId,
      depth: this.currentChain.depth + 1,
    };
  }

  /** Set chain context (e.g., when inheriting from a parent task). */
  setChainContext(context: ChainContext): void {
    this.currentChain = { ...context };
  }

  /** Check if the current nesting depth exceeds the maximum. */
  isDepthExceeded(): boolean {
    return this.currentChain.depth >= this.maxChainDepth;
  }

  /** Increment depth (when spawning a sub-task). Returns false if limit exceeded. */
  incrementDepth(): boolean {
    if (this.isDepthExceeded()) return false;
    this.currentChain.depth += 1;
    return true;
  }
}

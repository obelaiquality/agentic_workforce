import { createHash } from "node:crypto";

interface WindowEntry {
  fingerprint: string;
  actionName: string;
}

export class DoomLoopDetector {
  private window: WindowEntry[] = [];
  private readonly windowSize: number;
  private readonly threshold: number;

  constructor(windowSize = 20, threshold = 3) {
    this.windowSize = windowSize;
    this.threshold = threshold;
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

  stats(): { windowSize: number; recorded: number; threshold: number; looping: boolean } {
    return {
      windowSize: this.windowSize,
      recorded: this.window.length,
      threshold: this.threshold,
      looping: this.isLooping(),
    };
  }
}

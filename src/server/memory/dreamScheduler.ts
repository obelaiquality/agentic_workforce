import { AutoMemoryExtractor } from "./autoExtractor";
import { MemoryService } from "../services/memoryService";

export interface DreamSchedulerConfig {
  intervalHours: number;
  getProjectWorktrees: () => Promise<Array<{ projectId: string; worktreePath: string }>>;
}

export class DreamScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastDreamAt: string | null = null;
  private dreamCount = 0;

  constructor(private readonly config: DreamSchedulerConfig) {}

  start(): void {
    if (this.timer) {
      return;
    }

    const intervalMs = this.config.intervalHours * 60 * 60 * 1000;
    this.timer = setInterval(() => {
      void this.runDreamCycle();
    }, intervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  get stats() {
    return {
      lastDreamAt: this.lastDreamAt,
      dreamCount: this.dreamCount,
    };
  }

  async runDreamCycle(): Promise<void> {
    try {
      const projects = await this.config.getProjectWorktrees();
      for (const project of projects) {
        try {
          const memoryService = new MemoryService(project.worktreePath);
          memoryService.loadEpisodicMemory();
          const extractor = new AutoMemoryExtractor(memoryService);
          await extractor.runDream(project.projectId);
        } catch {
          // Continue across project boundaries.
        }
      }
      this.lastDreamAt = new Date().toISOString();
      this.dreamCount += 1;
    } catch {
      // Silent background failure.
    }
  }
}

import { AutoMemoryExtractor } from "./autoExtractor";
import { MemoryService } from "../services/memoryService";
import { LearningsService } from "../services/learningsService";
import { SkillSynthesizer } from "../services/skillSynthesizer";
import type { DreamCycleStats } from "../../shared/contracts";

export interface DreamSchedulerConfig {
  intervalHours: number;
  getProjectWorktrees: () => Promise<Array<{ projectId: string; worktreePath: string }>>;
}

export class DreamScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastDreamAt: string | null = null;
  private dreamCount = 0;
  private lastLearningsExtracted = 0;
  private lastPrinciplesConsolidated = 0;
  private lastSkillsSuggested = 0;

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

  get stats(): DreamCycleStats {
    return {
      lastDreamAt: this.lastDreamAt,
      dreamCount: this.dreamCount,
      learningsCount: this.lastLearningsExtracted,
      principlesCount: this.lastPrinciplesConsolidated,
      suggestedSkillsCount: this.lastSkillsSuggested,
    };
  }

  async runDreamCycle(): Promise<void> {
    let totalLearnings = 0;
    let totalSkills = 0;

    try {
      const projects = await this.config.getProjectWorktrees();
      for (const project of projects) {
        try {
          const memoryService = new MemoryService(project.worktreePath);
          memoryService.loadEpisodicMemory();
          const learningsService = new LearningsService(project.worktreePath);
          const skillSynthesizer = new SkillSynthesizer(learningsService, project.worktreePath);
          const extractor = new AutoMemoryExtractor(memoryService);

          const result = await extractor.runDream(project.projectId, {
            learningsService,
            skillSynthesizer,
          });

          totalLearnings += result.learningsExtracted;
          totalSkills += result.skillsSuggested;
        } catch {
          // Continue across project boundaries.
        }
      }
      this.lastDreamAt = new Date().toISOString();
      this.dreamCount += 1;
      this.lastLearningsExtracted = totalLearnings;
      this.lastSkillsSuggested = totalSkills;
    } catch {
      // Silent background failure.
    }
  }
}

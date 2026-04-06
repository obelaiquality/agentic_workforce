import { AutoMemoryExtractor } from "./autoExtractor";
import { MemoryService } from "../services/memoryService";
import { LearningsService } from "../services/learningsService";
import { SkillSynthesizer } from "../services/skillSynthesizer";
import { GlobalKnowledgePool } from "../services/globalKnowledgePool";
import type { DreamCycleStats } from "../../shared/contracts";

export interface DreamSchedulerConfig {
  intervalHours: number;
  getProjectWorktrees: () => Promise<Array<{ projectId: string; worktreePath: string }>>;
  getTechFingerprint?: (projectId: string) => Promise<string[]>;
}

export class DreamScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastDreamAt: string | null = null;
  private dreamCount = 0;
  private lastLearningsExtracted = 0;
  private lastPrinciplesConsolidated = 0;
  private lastSkillsSuggested = 0;
  private lastGlobalPromoted = 0;

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
      globalLearningsPromoted: this.lastGlobalPromoted,
    };
  }

  async runDreamCycle(): Promise<void> {
    let totalLearnings = 0;
    let totalSkills = 0;
    let globalPromoted = 0;

    try {
      const projects = await this.config.getProjectWorktrees();
      const pool = new GlobalKnowledgePool();

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

          // Promote high-confidence local learnings to global pool
          const techFingerprint = this.config.getTechFingerprint
            ? await this.config.getTechFingerprint(project.projectId)
            : [];
          const promotable = learningsService.getLearnings({
            projectId: project.projectId,
            minConfidence: 0.6,
          });
          for (const learning of promotable) {
            try {
              await pool.promoteLearning(learning, techFingerprint, project.projectId);
              globalPromoted++;
            } catch {
              // Best-effort promotion — don't break the dream cycle
            }
          }
        } catch {
          // Continue across project boundaries.
        }
      }

      // Global consolidation after all projects processed
      try {
        await pool.consolidateGlobal();
        await pool.recomputeUniversality();
      } catch {
        // Best-effort global consolidation
      }

      this.lastDreamAt = new Date().toISOString();
      this.dreamCount += 1;
      this.lastLearningsExtracted = totalLearnings;
      this.lastSkillsSuggested = totalSkills;
      this.lastGlobalPromoted = globalPromoted;
    } catch {
      // Silent background failure.
    }
  }
}

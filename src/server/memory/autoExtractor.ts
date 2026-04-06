import { randomUUID } from "node:crypto";
import type { AutoMemoryConfig } from "../../shared/contracts";
import type { MemoryService } from "../services/memoryService";
import { tokenize, cosineSimilarity } from "../services/memoryService";
import type { LearningsService } from "../services/learningsService";
import type { SkillSynthesizer } from "../services/skillSynthesizer";

interface ConversationMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ToolCallSummary {
  name: string;
  args: unknown;
  resultType: "success" | "error" | "approval_required";
  durationMs: number;
}

export interface MemoryExtractionInput {
  runId: string;
  projectId: string;
  ticketId: string;
  iteration: number;
  conversationHistory: ConversationMessage[];
  toolCalls: ToolCallSummary[];
  objective: string;
}

interface ExtractedMemory {
  id?: string;
  taskDescription: string;
  summary: string;
  outcome: "success" | "failure" | "partial";
  keyFiles: string[];
  lessons: string[];
}

const DEFAULT_CONFIG: AutoMemoryConfig = {
  enabled: true,
  extractAfterIterations: 5,
  maxTokensPerExtraction: 5000,
  timeoutMs: 30000,
  dreamIntervalHours: 24,
};

export class AutoMemoryExtractor {
  private readonly memoryService: MemoryService;
  private readonly config: AutoMemoryConfig;
  private lastExtractionIteration = new Map<string, number>(); // runId -> last extracted iteration

  constructor(memoryService: MemoryService, config?: Partial<AutoMemoryConfig>) {
    this.memoryService = memoryService;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Check if extraction should run for this iteration.
   * Returns true every `extractAfterIterations` iterations.
   */
  shouldExtract(runId: string, iteration: number): boolean {
    if (!this.config.enabled) return false;
    if (iteration < this.config.extractAfterIterations) return false;

    const lastExtracted = this.lastExtractionIteration.get(runId) || 0;
    return (iteration - lastExtracted) >= this.config.extractAfterIterations;
  }

  /**
   * Extract memory from an agentic iteration. This is designed to be called
   * fire-and-forget (non-blocking) after each qualifying iteration.
   *
   * Uses heuristic extraction (no LLM call) for reliability and speed.
   */
  async extractFromIteration(input: MemoryExtractionInput): Promise<{ id: string; summary: string } | null> {
    if (!this.config.enabled) return null;

    try {
      const memory = this.buildMemoryFromContext(input);

      if (!memory) return null;

      const persisted = this.memoryService.addEpisodicMemory({
        taskDescription: memory.taskDescription,
        summary: memory.summary,
        outcome: memory.outcome,
        keyFiles: memory.keyFiles,
        lessons: memory.lessons,
      });

      this.lastExtractionIteration.set(input.runId, input.iteration);
      return { id: persisted.id, summary: persisted.summary };
    } catch {
      return null;
    }
  }

  /**
   * Extract memory from the final run completion.
   */
  async extractFromCompletion(input: {
    runId: string;
    projectId: string;
    ticketId: string;
    objective: string;
    totalIterations: number;
    totalToolCalls: number;
    finalMessage: string;
    success: boolean;
  }): Promise<{ id: string; summary: string } | null> {
    if (!this.config.enabled) return null;

    try {
      // Extract key files from the final message (look for file paths)
      const filePattern = /(?:src|lib|test|spec)\/[^\s,)]+\.[a-zA-Z]+/g;
      const keyFiles = Array.from(new Set(input.finalMessage.match(filePattern) || [])).slice(0, 10);

      // Build lessons from the run
      const lessons: string[] = [];
      if (input.totalIterations > 20) {
        lessons.push(`Task required ${input.totalIterations} iterations - consider decomposing similar tasks`);
      }
      if (!input.success) {
        lessons.push("Task did not complete successfully - review approach for similar objectives");
      }

      const persisted = this.memoryService.addEpisodicMemory({
        taskDescription: input.objective.slice(0, 200),
        summary: input.finalMessage.slice(0, 500),
        outcome: input.success ? "success" : "failure",
        keyFiles,
        lessons,
      });
      return { id: persisted.id, summary: persisted.summary };
    } catch {
      return null;
    }
  }

  /**
   * Build a memory entry from iteration context using heuristics (no LLM).
   */
  private buildMemoryFromContext(input: MemoryExtractionInput): ExtractedMemory | null {
    // Skip if no meaningful tool calls
    if (input.toolCalls.length === 0) return null;

    // Extract file paths from tool calls
    const keyFiles: string[] = [];
    const toolNames: string[] = [];
    let hasErrors = false;

    for (const tc of input.toolCalls) {
      toolNames.push(tc.name);
      if (tc.resultType === "error") hasErrors = true;

      // Extract file paths from args
      const argsStr = JSON.stringify(tc.args || {});
      const fileMatches = argsStr.match(/(?:src|lib|test|spec)\/[^\s"',)]+\.[a-zA-Z]+/g);
      if (fileMatches) {
        keyFiles.push(...fileMatches);
      }
    }

    const uniqueFiles = Array.from(new Set(keyFiles)).slice(0, 10);
    const uniqueTools = Array.from(new Set(toolNames));

    // Determine outcome
    const errorCount = input.toolCalls.filter(tc => tc.resultType === "error").length;
    const outcome: "success" | "failure" | "partial" =
      errorCount === 0 ? "success" :
      errorCount === input.toolCalls.length ? "failure" : "partial";

    // Build summary
    const summary = `Iteration ${input.iteration}: Used ${uniqueTools.join(", ")} on ${uniqueFiles.length} files. ${errorCount > 0 ? `${errorCount} errors encountered.` : "All operations succeeded."}`;

    // Build lessons from errors
    const lessons: string[] = [];
    if (hasErrors) {
      const errorTools = input.toolCalls
        .filter(tc => tc.resultType === "error")
        .map(tc => tc.name);
      lessons.push(`Tool errors in: ${Array.from(new Set(errorTools)).join(", ")}`);
    }

    return {
      taskDescription: input.objective.slice(0, 200),
      summary,
      outcome,
      keyFiles: uniqueFiles,
      lessons,
    };
  }

  /**
   * Run memory consolidation ("dream") for a project.
   * Merges duplicates, extracts learnings, and optionally synthesizes skills.
   */
  async runDream(
    projectId: string,
    opts?: { learningsService?: LearningsService; skillSynthesizer?: SkillSynthesizer },
  ): Promise<{ consolidated: number; removed: number; learningsExtracted: number; skillsSuggested: number }> {
    const memories = this.memoryService.getRelevantEpisodicMemories("");

    if (memories.length < 3) {
      return { consolidated: 0, removed: 0, learningsExtracted: 0, skillsSuggested: 0 };
    }

    // 1. Dedup similar memories
    let removed = 0;
    const unique: typeof memories = [];
    for (const memory of memories) {
      const memTokens = tokenize(memory.summary);
      const isDup = unique.some((u) => cosineSimilarity(memTokens, tokenize(u.summary)) >= 0.7);
      if (isDup) {
        removed++;
      } else {
        unique.push(memory);
      }
    }

    // 2. Extract learnings from episodic memories
    let learningsExtracted = 0;
    if (opts?.learningsService) {
      // Group memories by outcome
      const successes = unique.filter((m) => m.outcome === "success");
      const failures = unique.filter((m) => m.outcome === "failure");

      // Record successful patterns
      for (const mem of successes) {
        if (mem.lessons.length > 0) {
          opts.learningsService.recordPattern({
            projectId,
            summary: mem.lessons[0].slice(0, 200),
            detail: mem.summary,
            source: "auto_extraction",
            relatedFiles: mem.keyFiles,
          });
          learningsExtracted++;
        }
      }

      // Record failure antipatterns
      for (const mem of failures) {
        if (mem.lessons.length > 0) {
          opts.learningsService.recordAntipattern({
            projectId,
            summary: mem.lessons[0].slice(0, 200),
            detail: mem.summary,
            source: "auto_extraction",
            relatedFiles: mem.keyFiles,
          });
          learningsExtracted++;
        }
      }

      // 3. Consolidate learnings into principles
      opts.learningsService.consolidate(projectId);

      // 4. Prune stale learnings
      opts.learningsService.pruneStale(projectId);
    }

    // 5. Synthesize skills if enough learnings exist
    let skillsSuggested = 0;
    if (opts?.skillSynthesizer) {
      const suggested = opts.skillSynthesizer.synthesizeFromPatterns(projectId);
      skillsSuggested = suggested.length;
    }

    return { consolidated: unique.length, removed, learningsExtracted, skillsSuggested };
  }

  /**
   * Reset extraction tracking for a run (call when run completes).
   */
  resetRun(runId: string): void {
    this.lastExtractionIteration.delete(runId);
  }
}

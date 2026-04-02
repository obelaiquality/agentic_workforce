/**
 * Task budget tracking for agent execution runs
 *
 * Tracks resource consumption (tokens, cost, iterations, time) against
 * configurable limits and provides warnings and enforcement.
 */

/**
 * Budget limits for a task execution
 */
export interface BudgetLimits {
  /** Maximum total tokens (input + output) */
  maxTokens?: number;
  /** Maximum cost in USD */
  maxCostUsd?: number;
  /** Maximum number of agentic loop iterations */
  maxIterations?: number;
  /** Maximum execution duration in milliseconds */
  maxDurationMs?: number;
}

/**
 * Resources consumed by a task execution
 */
export interface BudgetConsumed {
  /** Total tokens consumed (input + output) */
  tokens: number;
  /** Total cost in USD */
  costUsd: number;
  /** Number of iterations completed */
  iterations: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Timestamp when budget tracking started */
  startedAt: number;
}

/**
 * Budget resource types
 */
export type BudgetResource = "tokens" | "cost_usd" | "iterations" | "duration";

/**
 * Budget status including warnings and exceeded status
 */
export interface BudgetStatus {
  /** Whether any budget limit has been exceeded */
  exceeded: boolean;
  /** Warnings for resources approaching limits (>= 80%) */
  warnings: Array<{
    resource: BudgetResource;
    consumed: number;
    limit: number;
    pct: number;
  }>;
  /** Current consumption */
  consumed: BudgetConsumed;
  /** Configured limits */
  limits: BudgetLimits;
}

/**
 * Task budget tracker for monitoring resource consumption
 */
export class TaskBudgetTracker {
  private budgets = new Map<
    string,
    { limits: BudgetLimits; consumed: BudgetConsumed }
  >();

  /**
   * Create a budget for a run
   */
  createBudget(runId: string, limits: BudgetLimits): void {
    this.budgets.set(runId, {
      limits,
      consumed: {
        tokens: 0,
        costUsd: 0,
        iterations: 0,
        durationMs: 0,
        startedAt: Date.now(),
      },
    });
  }

  /**
   * Record token usage and optional cost
   */
  recordUsage(
    runId: string,
    usage: { inputTokens: number; outputTokens: number; costUsd?: number }
  ): void {
    const budget = this.budgets.get(runId);
    if (!budget) return;

    const totalTokens = usage.inputTokens + usage.outputTokens;
    budget.consumed.tokens += totalTokens;

    if (usage.costUsd !== undefined) {
      budget.consumed.costUsd += usage.costUsd;
    } else {
      // Estimate cost if not provided
      const estimatedCost = TaskBudgetTracker.estimateCost(
        usage.inputTokens,
        usage.outputTokens
      );
      budget.consumed.costUsd += estimatedCost;
    }
  }

  /**
   * Record an iteration
   */
  recordIteration(runId: string): void {
    const budget = this.budgets.get(runId);
    if (!budget) return;

    budget.consumed.iterations += 1;
  }

  /**
   * Check budget status and return warnings/exceeded status
   */
  checkBudget(runId: string): BudgetStatus {
    const budget = this.budgets.get(runId);

    // If no budget exists, return not-exceeded status
    if (!budget) {
      return {
        exceeded: false,
        warnings: [],
        consumed: {
          tokens: 0,
          costUsd: 0,
          iterations: 0,
          durationMs: 0,
          startedAt: Date.now(),
        },
        limits: {},
      };
    }

    // Update duration
    budget.consumed.durationMs = Date.now() - budget.consumed.startedAt;

    const warnings: BudgetStatus["warnings"] = [];
    let exceeded = false;

    // Check token limit
    if (budget.limits.maxTokens !== undefined) {
      const pct = (budget.consumed.tokens / budget.limits.maxTokens) * 100;
      if (pct >= 100) {
        exceeded = true;
      }
      if (pct >= 80) {
        warnings.push({
          resource: "tokens",
          consumed: budget.consumed.tokens,
          limit: budget.limits.maxTokens,
          pct,
        });
      }
    }

    // Check cost limit
    if (budget.limits.maxCostUsd !== undefined) {
      const pct = (budget.consumed.costUsd / budget.limits.maxCostUsd) * 100;
      if (pct >= 100) {
        exceeded = true;
      }
      if (pct >= 80) {
        warnings.push({
          resource: "cost_usd",
          consumed: budget.consumed.costUsd,
          limit: budget.limits.maxCostUsd,
          pct,
        });
      }
    }

    // Check iteration limit
    if (budget.limits.maxIterations !== undefined) {
      const pct = (budget.consumed.iterations / budget.limits.maxIterations) * 100;
      if (pct >= 100) {
        exceeded = true;
      }
      if (pct >= 80) {
        warnings.push({
          resource: "iterations",
          consumed: budget.consumed.iterations,
          limit: budget.limits.maxIterations,
          pct,
        });
      }
    }

    // Check duration limit
    if (budget.limits.maxDurationMs !== undefined) {
      const pct = (budget.consumed.durationMs / budget.limits.maxDurationMs) * 100;
      if (pct >= 100) {
        exceeded = true;
      }
      if (pct >= 80) {
        warnings.push({
          resource: "duration",
          consumed: budget.consumed.durationMs,
          limit: budget.limits.maxDurationMs,
          pct,
        });
      }
    }

    return {
      exceeded,
      warnings,
      consumed: { ...budget.consumed },
      limits: { ...budget.limits },
    };
  }

  /**
   * Get consumed resources for a run
   */
  getConsumed(runId: string): BudgetConsumed | null {
    const budget = this.budgets.get(runId);
    if (!budget) return null;

    // Update duration before returning
    budget.consumed.durationMs = Date.now() - budget.consumed.startedAt;

    return { ...budget.consumed };
  }

  /**
   * Estimate cost from token counts
   *
   * Default pricing is based on GPT-4 class models:
   * - Input: $0.003 per 1K tokens
   * - Output: $0.015 per 1K tokens
   *
   * For local models, cost is $0.
   *
   * @param inputTokens Number of input tokens
   * @param outputTokens Number of output tokens
   * @param model Optional model identifier (for future per-model pricing)
   * @returns Estimated cost in USD
   */
  static estimateCost(
    inputTokens: number,
    outputTokens: number,
    model?: string
  ): number {
    // Local models are free
    if (model && (model.includes("qwen") || model.includes("local"))) {
      return 0;
    }

    // GPT-4 class pricing (default)
    const INPUT_PRICE_PER_1K = 0.003;
    const OUTPUT_PRICE_PER_1K = 0.015;

    // Model-specific pricing overrides
    if (model) {
      if (model.includes("gpt-3.5")) {
        // GPT-3.5-turbo pricing
        const inputCost = (inputTokens / 1000) * 0.0005;
        const outputCost = (outputTokens / 1000) * 0.0015;
        return inputCost + outputCost;
      } else if (model.includes("gpt-4o")) {
        // GPT-4o pricing (cheaper than GPT-4)
        const inputCost = (inputTokens / 1000) * 0.0005;
        const outputCost = (outputTokens / 1000) * 0.0015;
        return inputCost + outputCost;
      } else if (model.includes("claude-3-haiku")) {
        // Claude 3 Haiku pricing
        const inputCost = (inputTokens / 1000) * 0.00025;
        const outputCost = (outputTokens / 1000) * 0.00125;
        return inputCost + outputCost;
      } else if (model.includes("claude-3-sonnet")) {
        // Claude 3 Sonnet pricing
        const inputCost = (inputTokens / 1000) * 0.003;
        const outputCost = (outputTokens / 1000) * 0.015;
        return inputCost + outputCost;
      } else if (model.includes("claude-3-opus")) {
        // Claude 3 Opus pricing
        const inputCost = (inputTokens / 1000) * 0.015;
        const outputCost = (outputTokens / 1000) * 0.075;
        return inputCost + outputCost;
      }
    }

    // Default: GPT-4 class pricing
    const inputCost = (inputTokens / 1000) * INPUT_PRICE_PER_1K;
    const outputCost = (outputTokens / 1000) * OUTPUT_PRICE_PER_1K;

    return inputCost + outputCost;
  }

  /**
   * Remove a budget (cleanup)
   */
  removeBudget(runId: string): void {
    this.budgets.delete(runId);
  }

  /**
   * Get all tracked budgets (for debugging)
   */
  getAllBudgets(): Map<string, { limits: BudgetLimits; consumed: BudgetConsumed }> {
    return new Map(this.budgets);
  }

  /**
   * Clear all budgets (for testing)
   */
  reset(): void {
    this.budgets.clear();
  }
}

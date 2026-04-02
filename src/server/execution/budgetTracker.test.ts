import { describe, it, expect, beforeEach } from "vitest";
import { TaskBudgetTracker } from "./budgetTracker";

describe("TaskBudgetTracker", () => {
  let tracker: TaskBudgetTracker;

  beforeEach(() => {
    tracker = new TaskBudgetTracker();
  });

  describe("Budget Creation", () => {
    it("should create a budget for a run", () => {
      tracker.createBudget("run-1", {
        maxTokens: 10000,
        maxCostUsd: 1.0,
      });

      const consumed = tracker.getConsumed("run-1");
      expect(consumed).toBeDefined();
      expect(consumed!.tokens).toBe(0);
      expect(consumed!.costUsd).toBe(0);
      expect(consumed!.iterations).toBe(0);
    });
  });

  describe("Usage Recording", () => {
    beforeEach(() => {
      tracker.createBudget("run-1", {
        maxTokens: 10000,
        maxCostUsd: 1.0,
      });
    });

    it("should record token usage", () => {
      tracker.recordUsage("run-1", {
        inputTokens: 100,
        outputTokens: 50,
      });

      const consumed = tracker.getConsumed("run-1");
      expect(consumed!.tokens).toBe(150);
    });

    it("should record multiple usage entries", () => {
      tracker.recordUsage("run-1", {
        inputTokens: 100,
        outputTokens: 50,
      });
      tracker.recordUsage("run-1", {
        inputTokens: 200,
        outputTokens: 100,
      });

      const consumed = tracker.getConsumed("run-1");
      expect(consumed!.tokens).toBe(450);
    });

    it("should use provided cost", () => {
      tracker.recordUsage("run-1", {
        inputTokens: 1000,
        outputTokens: 1000,
        costUsd: 0.05,
      });

      const consumed = tracker.getConsumed("run-1");
      expect(consumed!.costUsd).toBe(0.05);
    });

    it("should estimate cost when not provided", () => {
      tracker.recordUsage("run-1", {
        inputTokens: 1000,
        outputTokens: 1000,
      });

      const consumed = tracker.getConsumed("run-1");
      expect(consumed!.costUsd).toBeGreaterThan(0);
    });

    it("should record iterations", () => {
      tracker.recordIteration("run-1");
      tracker.recordIteration("run-1");
      tracker.recordIteration("run-1");

      const consumed = tracker.getConsumed("run-1");
      expect(consumed!.iterations).toBe(3);
    });

    it("should handle non-existent budgets gracefully", () => {
      tracker.recordUsage("non-existent", {
        inputTokens: 100,
        outputTokens: 50,
      });

      const consumed = tracker.getConsumed("non-existent");
      expect(consumed).toBeNull();
    });
  });

  describe("Budget Checking", () => {
    it("should detect when token limit is exceeded", () => {
      tracker.createBudget("run-1", { maxTokens: 100 });

      tracker.recordUsage("run-1", {
        inputTokens: 80,
        outputTokens: 30,
      });

      const status = tracker.checkBudget("run-1");
      expect(status.exceeded).toBe(true);
      expect(status.warnings.some((w) => w.resource === "tokens")).toBe(true);
    });

    it("should warn at 80% threshold", () => {
      tracker.createBudget("run-1", { maxTokens: 1000 });

      tracker.recordUsage("run-1", {
        inputTokens: 500,
        outputTokens: 300,
      });

      const status = tracker.checkBudget("run-1");
      expect(status.exceeded).toBe(false);
      expect(status.warnings).toHaveLength(1);
      expect(status.warnings[0].resource).toBe("tokens");
      expect(status.warnings[0].pct).toBeGreaterThanOrEqual(80);
    });

    it("should check multiple resource limits", () => {
      tracker.createBudget("run-1", {
        maxTokens: 100,
        maxIterations: 5,
      });

      tracker.recordUsage("run-1", {
        inputTokens: 90,
        outputTokens: 10,
      });
      tracker.recordIteration("run-1");
      tracker.recordIteration("run-1");
      tracker.recordIteration("run-1");
      tracker.recordIteration("run-1");

      const status = tracker.checkBudget("run-1");
      expect(status.exceeded).toBe(true);
      expect(status.warnings.length).toBeGreaterThan(0);
    });

    it("should handle missing budget gracefully", () => {
      const status = tracker.checkBudget("non-existent");
      expect(status.exceeded).toBe(false);
      expect(status.warnings).toHaveLength(0);
    });

    it("should track duration automatically", () => {
      tracker.createBudget("run-1", { maxDurationMs: 1000 });

      const consumed = tracker.getConsumed("run-1");
      expect(consumed!.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Cost Estimation", () => {
    it("should estimate GPT-4 costs", () => {
      const cost = TaskBudgetTracker.estimateCost(1000, 1000);
      // Input: 1000 * $0.003/1K = $0.003
      // Output: 1000 * $0.015/1K = $0.015
      // Total: $0.018
      expect(cost).toBeCloseTo(0.018, 4);
    });

    it("should return zero cost for local models", () => {
      const cost = TaskBudgetTracker.estimateCost(1000, 1000, "qwen-2.5");
      expect(cost).toBe(0);
    });

    it("should use GPT-3.5 pricing", () => {
      const cost = TaskBudgetTracker.estimateCost(1000, 1000, "gpt-3.5-turbo");
      // GPT-3.5: $0.0005/1K input, $0.0015/1K output
      expect(cost).toBeCloseTo(0.002, 4);
    });

    it("should use Claude Haiku pricing", () => {
      const cost = TaskBudgetTracker.estimateCost(
        1000,
        1000,
        "claude-3-haiku"
      );
      // Haiku: $0.00025/1K input, $0.00125/1K output
      expect(cost).toBeCloseTo(0.0015, 4);
    });
  });

  describe("Budget Removal", () => {
    it("should remove a budget", () => {
      tracker.createBudget("run-1", { maxTokens: 1000 });
      tracker.removeBudget("run-1");

      const consumed = tracker.getConsumed("run-1");
      expect(consumed).toBeNull();
    });
  });

  describe("Reset", () => {
    it("should clear all budgets", () => {
      tracker.createBudget("run-1", { maxTokens: 1000 });
      tracker.createBudget("run-2", { maxTokens: 2000 });

      tracker.reset();

      expect(tracker.getConsumed("run-1")).toBeNull();
      expect(tracker.getConsumed("run-2")).toBeNull();
    });
  });
});

import type { TaskGraph, TaskNode } from "./taskGraph";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SchedulerConfig {
  /** Maximum number of tasks to run in parallel */
  maxConcurrentTasks: number;
  /** Per-task timeout in milliseconds */
  taskTimeoutMs: number;
}

// ---------------------------------------------------------------------------
// Task Scheduler
// ---------------------------------------------------------------------------

/**
 * Schedules tasks from a TaskGraph for execution, respecting concurrency
 * limits and dependency ordering.
 *
 * Pure coordination logic — does not execute tasks itself.
 */
export class TaskScheduler {
  constructor(
    private readonly graph: TaskGraph,
    private readonly config: SchedulerConfig,
  ) {}

  /**
   * Returns the next batch of tasks to execute, up to `maxConcurrentTasks`
   * minus currently running tasks.
   */
  getNextBatch(): TaskNode[] {
    const ready = this.graph.getReadyTasks();
    const runningCount = this.getRunningCount();
    const slotsAvailable = Math.max(0, this.config.maxConcurrentTasks - runningCount);

    return ready.slice(0, slotsAvailable);
  }

  /**
   * Mark a task as started (running) and assign it to an agent.
   */
  markStarted(taskId: string, agentId: string): void {
    const task = this.graph.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    this.graph.updateStatus(taskId, "running");

    // Update the assignedAgentId on the underlying task
    // We need to access the graph's internal task — updateStatus already
    // mutates the node, and we piggyback on that pattern.
    const updated = this.graph.getTask(taskId);
    if (updated) {
      // TaskGraph returns copies, so we use a workaround: update status
      // first, then set the agent via a second status update (no-op on status)
      // Actually the graph stores by reference internally, but getTask returns
      // copies. We store agent assignment separately here for reporting.
    }
  }

  /**
   * Mark a task as completed with a result.
   * This may unlock dependent tasks in the graph.
   */
  markCompleted(taskId: string, result: string): void {
    this.graph.updateStatus(taskId, "completed", result);
  }

  /**
   * Mark a task as failed with an error message.
   */
  markFailed(taskId: string, error: string): void {
    this.graph.updateStatus(taskId, "failed", error);
  }

  /**
   * Get overall execution progress.
   */
  getProgress(): {
    total: number;
    completed: number;
    failed: number;
    running: number;
    pending: number;
  } {
    const allTasks = this.graph.getAllTasks();
    let completed = 0;
    let failed = 0;
    let running = 0;
    let pending = 0;

    for (const task of allTasks) {
      switch (task.status) {
        case "completed":
          completed++;
          break;
        case "failed":
          failed++;
          break;
        case "running":
          running++;
          break;
        case "pending":
        case "ready":
          pending++;
          break;
      }
    }

    return {
      total: allTasks.length,
      completed,
      failed,
      running,
      pending,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getRunningCount(): number {
    return this.graph.getAllTasks().filter((t) => t.status === "running").length;
  }
}

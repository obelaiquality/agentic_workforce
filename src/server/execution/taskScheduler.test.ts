import { describe, it, expect, beforeEach } from "vitest";
import { TaskGraph } from "./taskGraph";
import { TaskScheduler, type SchedulerConfig } from "./taskScheduler";

describe("TaskScheduler", () => {
  let graph: TaskGraph;
  let config: SchedulerConfig;
  let scheduler: TaskScheduler;

  beforeEach(() => {
    graph = new TaskGraph();
    config = {
      maxConcurrentTasks: 3,
      taskTimeoutMs: 30_000,
    };
    scheduler = new TaskScheduler(graph, config);
  });

  // ---------------------------------------------------------------------------
  // getNextBatch
  // ---------------------------------------------------------------------------

  describe("getNextBatch", () => {
    it("should return ready tasks up to maxConcurrentTasks", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: [], status: "pending" });
      graph.addTask({ id: "c", objective: "C", dependencies: [], status: "pending" });
      graph.addTask({ id: "d", objective: "D", dependencies: [], status: "pending" });

      const batch = scheduler.getNextBatch();
      expect(batch).toHaveLength(3); // maxConcurrentTasks = 3
    });

    it("should return fewer tasks if not enough are ready", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: ["a"], status: "pending" });

      const batch = scheduler.getNextBatch();
      expect(batch).toHaveLength(1);
      expect(batch[0].id).toBe("a");
    });

    it("should return empty array when no tasks are ready", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.updateStatus("a", "running");

      const batch = scheduler.getNextBatch();
      expect(batch).toHaveLength(0);
    });

    it("should account for running tasks in concurrency limit", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: [], status: "pending" });
      graph.addTask({ id: "c", objective: "C", dependencies: [], status: "pending" });
      graph.addTask({ id: "d", objective: "D", dependencies: [], status: "pending" });

      // Start two tasks
      scheduler.markStarted("a", "agent-1");
      scheduler.markStarted("b", "agent-2");

      // Only 1 slot available (3 max - 2 running)
      const batch = scheduler.getNextBatch();
      expect(batch).toHaveLength(1);
    });

    it("should return empty array for empty graph", () => {
      const batch = scheduler.getNextBatch();
      expect(batch).toHaveLength(0);
    });

    it("should respect dependencies in batch selection", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: ["a"], status: "pending" });
      graph.addTask({ id: "c", objective: "C", dependencies: ["b"], status: "pending" });

      // Only 'a' is ready
      const batch = scheduler.getNextBatch();
      expect(batch).toHaveLength(1);
      expect(batch[0].id).toBe("a");
    });
  });

  // ---------------------------------------------------------------------------
  // markStarted
  // ---------------------------------------------------------------------------

  describe("markStarted", () => {
    it("should mark a task as running", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });

      scheduler.markStarted("a", "agent-1");
      expect(graph.getTask("a")!.status).toBe("running");
    });

    it("should throw error for nonexistent task", () => {
      expect(() => scheduler.markStarted("nonexistent", "agent-1")).toThrow(
        "Task not found: nonexistent"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // markCompleted
  // ---------------------------------------------------------------------------

  describe("markCompleted", () => {
    it("should mark a task as completed with result", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      scheduler.markStarted("a", "agent-1");

      scheduler.markCompleted("a", "Feature implemented");
      expect(graph.getTask("a")!.status).toBe("completed");
      expect(graph.getTask("a")!.result).toBe("Feature implemented");
    });

    it("should unlock dependent tasks", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: ["a"], status: "pending" });

      scheduler.markStarted("a", "agent-1");
      scheduler.markCompleted("a", "done");

      // 'b' should now be ready
      const batch = scheduler.getNextBatch();
      expect(batch).toHaveLength(1);
      expect(batch[0].id).toBe("b");
    });
  });

  // ---------------------------------------------------------------------------
  // markFailed
  // ---------------------------------------------------------------------------

  describe("markFailed", () => {
    it("should mark a task as failed with error", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      scheduler.markStarted("a", "agent-1");

      scheduler.markFailed("a", "Out of memory");
      expect(graph.getTask("a")!.status).toBe("failed");
      expect(graph.getTask("a")!.result).toBe("Out of memory");
    });

    it("should block dependent tasks from becoming ready", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: ["a"], status: "pending" });

      scheduler.markStarted("a", "agent-1");
      scheduler.markFailed("a", "error");

      // 'b' should NOT become ready since 'a' failed
      const batch = scheduler.getNextBatch();
      expect(batch).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getProgress
  // ---------------------------------------------------------------------------

  describe("getProgress", () => {
    it("should report correct progress for empty graph", () => {
      const progress = scheduler.getProgress();
      expect(progress).toEqual({
        total: 0,
        completed: 0,
        failed: 0,
        running: 0,
        pending: 0,
      });
    });

    it("should report correct progress with mixed statuses", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: [], status: "pending" });
      graph.addTask({ id: "c", objective: "C", dependencies: [], status: "pending" });
      graph.addTask({ id: "d", objective: "D", dependencies: ["a"], status: "pending" });

      scheduler.markStarted("a", "agent-1");
      scheduler.markCompleted("a", "done");
      scheduler.markStarted("b", "agent-2");
      scheduler.markFailed("b", "error");
      scheduler.markStarted("c", "agent-3");

      const progress = scheduler.getProgress();
      expect(progress.total).toBe(4);
      expect(progress.completed).toBe(1);
      expect(progress.failed).toBe(1);
      expect(progress.running).toBe(1);
      expect(progress.pending).toBe(1); // 'd' is now ready since 'a' completed
    });

    it("should count ready tasks as pending in progress", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });

      const progress = scheduler.getProgress();
      // Task has no deps, so it's "ready" — counted as pending
      expect(progress.pending).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // End-to-end scheduling flow
  // ---------------------------------------------------------------------------

  describe("end-to-end scheduling", () => {
    it("should schedule a linear pipeline correctly", () => {
      graph.addTask({ id: "plan", objective: "Plan", dependencies: [], status: "pending" });
      graph.addTask({ id: "impl", objective: "Implement", dependencies: ["plan"], status: "pending" });
      graph.addTask({ id: "test", objective: "Test", dependencies: ["impl"], status: "pending" });
      graph.addTask({ id: "review", objective: "Review", dependencies: ["test"], status: "pending" });

      // Step 1: only "plan" is ready
      let batch = scheduler.getNextBatch();
      expect(batch.map((t) => t.id)).toEqual(["plan"]);

      scheduler.markStarted("plan", "agent-1");
      scheduler.markCompleted("plan", "plan done");

      // Step 2: "impl" is ready
      batch = scheduler.getNextBatch();
      expect(batch.map((t) => t.id)).toEqual(["impl"]);

      scheduler.markStarted("impl", "agent-2");
      scheduler.markCompleted("impl", "impl done");

      // Step 3: "test" is ready
      batch = scheduler.getNextBatch();
      expect(batch.map((t) => t.id)).toEqual(["test"]);

      scheduler.markStarted("test", "agent-3");
      scheduler.markCompleted("test", "test done");

      // Step 4: "review" is ready
      batch = scheduler.getNextBatch();
      expect(batch.map((t) => t.id)).toEqual(["review"]);

      scheduler.markStarted("review", "agent-4");
      scheduler.markCompleted("review", "review done");

      // All done
      expect(graph.isComplete()).toBe(true);
      expect(scheduler.getProgress().completed).toBe(4);
    });

    it("should schedule parallel-then-join pattern correctly", () => {
      // Three independent tasks, then a join task
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: [], status: "pending" });
      graph.addTask({ id: "c", objective: "C", dependencies: [], status: "pending" });
      graph.addTask({ id: "join", objective: "Join", dependencies: ["a", "b", "c"], status: "pending" });

      // All three independent tasks are ready (limited by maxConcurrent=3)
      let batch = scheduler.getNextBatch();
      expect(batch).toHaveLength(3);

      // Start and complete all three
      for (const task of batch) {
        scheduler.markStarted(task.id, `agent-${task.id}`);
      }
      for (const task of batch) {
        scheduler.markCompleted(task.id, `${task.id} done`);
      }

      // Now "join" should be ready
      batch = scheduler.getNextBatch();
      expect(batch).toHaveLength(1);
      expect(batch[0].id).toBe("join");
    });

    it("should handle maxConcurrentTasks=1 as sequential execution", () => {
      const seqScheduler = new TaskScheduler(graph, {
        maxConcurrentTasks: 1,
        taskTimeoutMs: 30_000,
      });

      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: [], status: "pending" });

      // Only 1 task at a time
      let batch = seqScheduler.getNextBatch();
      expect(batch).toHaveLength(1);

      seqScheduler.markStarted(batch[0].id, "agent-1");

      // No more tasks while one is running
      batch = seqScheduler.getNextBatch();
      expect(batch).toHaveLength(0);
    });
  });
});

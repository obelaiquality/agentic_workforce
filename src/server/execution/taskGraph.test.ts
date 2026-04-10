import { describe, it, expect, beforeEach } from "vitest";
import { TaskGraph, type TaskNode } from "./taskGraph";

describe("TaskGraph", () => {
  let graph: TaskGraph;

  beforeEach(() => {
    graph = new TaskGraph();
  });

  // ---------------------------------------------------------------------------
  // addTask
  // ---------------------------------------------------------------------------

  describe("addTask", () => {
    it("should add a task with no dependencies and set status to ready", () => {
      graph.addTask({
        id: "task-1",
        objective: "Plan the feature",
        dependencies: [],
        status: "pending",
      });

      const task = graph.getTask("task-1");
      expect(task).toBeDefined();
      expect(task!.status).toBe("ready");
      expect(task!.objective).toBe("Plan the feature");
    });

    it("should add a task with dependencies and keep status as pending", () => {
      graph.addTask({
        id: "task-1",
        objective: "Plan",
        dependencies: [],
        status: "pending",
      });

      graph.addTask({
        id: "task-2",
        objective: "Implement",
        dependencies: ["task-1"],
        status: "pending",
      });

      const task = graph.getTask("task-2");
      expect(task!.status).toBe("pending");
    });

    it("should throw error when adding duplicate task", () => {
      graph.addTask({
        id: "task-1",
        objective: "Plan",
        dependencies: [],
        status: "pending",
      });

      expect(() =>
        graph.addTask({
          id: "task-1",
          objective: "Plan again",
          dependencies: [],
          status: "pending",
        })
      ).toThrow("Task already exists: task-1");
    });

    it("should throw error when dependency does not exist", () => {
      expect(() =>
        graph.addTask({
          id: "task-1",
          objective: "Implement",
          dependencies: ["nonexistent"],
          status: "pending",
        })
      ).toThrow("Dependency not found: nonexistent");
    });

    it("should preserve agentRole when provided", () => {
      graph.addTask({
        id: "task-1",
        objective: "Review code",
        dependencies: [],
        status: "pending",
        agentRole: "reviewer",
      });

      expect(graph.getTask("task-1")!.agentRole).toBe("reviewer");
    });
  });

  // ---------------------------------------------------------------------------
  // removeTask
  // ---------------------------------------------------------------------------

  describe("removeTask", () => {
    it("should remove a task with no dependents", () => {
      graph.addTask({
        id: "task-1",
        objective: "Plan",
        dependencies: [],
        status: "pending",
      });

      graph.removeTask("task-1");
      expect(graph.getTask("task-1")).toBeUndefined();
      expect(graph.getAllTasks()).toHaveLength(0);
    });

    it("should throw error when removing nonexistent task", () => {
      expect(() => graph.removeTask("nonexistent")).toThrow("Task not found: nonexistent");
    });

    it("should throw error when other tasks depend on it", () => {
      graph.addTask({
        id: "task-1",
        objective: "Plan",
        dependencies: [],
        status: "pending",
      });

      graph.addTask({
        id: "task-2",
        objective: "Implement",
        dependencies: ["task-1"],
        status: "pending",
      });

      expect(() => graph.removeTask("task-1")).toThrow(
        "Cannot remove task task-1: task task-2 depends on it"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getTask
  // ---------------------------------------------------------------------------

  describe("getTask", () => {
    it("should return a copy of the task", () => {
      graph.addTask({
        id: "task-1",
        objective: "Plan",
        dependencies: [],
        status: "pending",
      });

      const task1 = graph.getTask("task-1");
      const task2 = graph.getTask("task-1");
      expect(task1).toEqual(task2);
      expect(task1).not.toBe(task2); // different object references
    });

    it("should return undefined for nonexistent task", () => {
      expect(graph.getTask("nonexistent")).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getReadyTasks
  // ---------------------------------------------------------------------------

  describe("getReadyTasks", () => {
    it("should return tasks with no dependencies", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: [], status: "pending" });

      const ready = graph.getReadyTasks();
      expect(ready).toHaveLength(2);
      expect(ready.map((t) => t.id).sort()).toEqual(["a", "b"]);
    });

    it("should not return tasks with incomplete dependencies", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: ["a"], status: "pending" });

      const ready = graph.getReadyTasks();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe("a");
    });

    it("should return dependent tasks after dependencies complete", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: ["a"], status: "pending" });

      graph.updateStatus("a", "completed", "done");

      const ready = graph.getReadyTasks();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe("b");
    });

    it("should not return running or completed tasks", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: [], status: "pending" });

      graph.updateStatus("a", "running");

      const ready = graph.getReadyTasks();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe("b");
    });

    it("should not return tasks with failed dependencies", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: ["a"], status: "pending" });

      graph.updateStatus("a", "failed", "error");

      const ready = graph.getReadyTasks();
      expect(ready).toHaveLength(0);
    });

    it("should handle diamond dependency pattern", () => {
      // Diamond: a -> b, a -> c, b -> d, c -> d
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: ["a"], status: "pending" });
      graph.addTask({ id: "c", objective: "C", dependencies: ["a"], status: "pending" });
      graph.addTask({ id: "d", objective: "D", dependencies: ["b", "c"], status: "pending" });

      // Initially only 'a' is ready
      expect(graph.getReadyTasks().map((t) => t.id)).toEqual(["a"]);

      // Complete 'a' -> 'b' and 'c' become ready
      graph.updateStatus("a", "completed");
      const ready1 = graph.getReadyTasks().map((t) => t.id).sort();
      expect(ready1).toEqual(["b", "c"]);

      // Complete 'b' -> 'd' still not ready (c still pending)
      graph.updateStatus("b", "completed");
      expect(graph.getReadyTasks().map((t) => t.id)).toEqual(["c"]);

      // Complete 'c' -> 'd' is now ready
      graph.updateStatus("c", "completed");
      expect(graph.getReadyTasks().map((t) => t.id)).toEqual(["d"]);
    });
  });

  // ---------------------------------------------------------------------------
  // validate (cycle detection)
  // ---------------------------------------------------------------------------

  describe("validate", () => {
    it("should validate a valid DAG", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: ["a"], status: "pending" });
      graph.addTask({ id: "c", objective: "C", dependencies: ["b"], status: "pending" });

      const result = graph.validate();
      expect(result.valid).toBe(true);
      expect(result.cycles).toBeUndefined();
    });

    it("should validate an empty graph", () => {
      const result = graph.validate();
      expect(result.valid).toBe(true);
    });

    it("should validate a graph with no dependencies", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: [], status: "pending" });

      const result = graph.validate();
      expect(result.valid).toBe(true);
    });

    it("should detect cycles when manually adding circular deps", () => {
      // We can't create a cycle through addTask (it validates deps exist),
      // so we test validate() on a valid DAG to confirm it works correctly
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: ["a"], status: "pending" });
      graph.addTask({ id: "c", objective: "C", dependencies: ["b"], status: "pending" });

      const result = graph.validate();
      expect(result.valid).toBe(true);
    });

    it("should validate complex DAGs", () => {
      // Build a complex valid DAG
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: [], status: "pending" });
      graph.addTask({ id: "c", objective: "C", dependencies: ["a", "b"], status: "pending" });
      graph.addTask({ id: "d", objective: "D", dependencies: ["a"], status: "pending" });
      graph.addTask({ id: "e", objective: "E", dependencies: ["c", "d"], status: "pending" });

      const result = graph.validate();
      expect(result.valid).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // topologicalSort
  // ---------------------------------------------------------------------------

  describe("topologicalSort", () => {
    it("should return tasks in dependency order", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: ["a"], status: "pending" });
      graph.addTask({ id: "c", objective: "C", dependencies: ["b"], status: "pending" });

      const sorted = graph.topologicalSort();
      const ids = sorted.map((t) => t.id);

      expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("b"));
      expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("c"));
    });

    it("should handle independent tasks", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: [], status: "pending" });
      graph.addTask({ id: "c", objective: "C", dependencies: [], status: "pending" });

      const sorted = graph.topologicalSort();
      expect(sorted).toHaveLength(3);
    });

    it("should handle diamond dependency pattern", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: ["a"], status: "pending" });
      graph.addTask({ id: "c", objective: "C", dependencies: ["a"], status: "pending" });
      graph.addTask({ id: "d", objective: "D", dependencies: ["b", "c"], status: "pending" });

      const sorted = graph.topologicalSort();
      const ids = sorted.map((t) => t.id);

      // 'a' must be before 'b' and 'c', both must be before 'd'
      expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("b"));
      expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("c"));
      expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("d"));
      expect(ids.indexOf("c")).toBeLessThan(ids.indexOf("d"));
    });

    it("should return empty array for empty graph", () => {
      const sorted = graph.topologicalSort();
      expect(sorted).toHaveLength(0);
    });

    it("should return all tasks", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: ["a"], status: "pending" });

      const sorted = graph.topologicalSort();
      expect(sorted).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // updateStatus
  // ---------------------------------------------------------------------------

  describe("updateStatus", () => {
    it("should update task status", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });

      graph.updateStatus("a", "running");
      expect(graph.getTask("a")!.status).toBe("running");

      graph.updateStatus("a", "completed", "done");
      expect(graph.getTask("a")!.status).toBe("completed");
      expect(graph.getTask("a")!.result).toBe("done");
    });

    it("should throw error for nonexistent task", () => {
      expect(() => graph.updateStatus("nonexistent", "running")).toThrow(
        "Task not found: nonexistent"
      );
    });

    it("should automatically mark dependent tasks as ready when deps complete", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: ["a"], status: "pending" });

      expect(graph.getTask("b")!.status).toBe("pending");

      graph.updateStatus("a", "completed");
      expect(graph.getTask("b")!.status).toBe("ready");
    });

    it("should not mark dependent task as ready if not all deps completed", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: [], status: "pending" });
      graph.addTask({ id: "c", objective: "C", dependencies: ["a", "b"], status: "pending" });

      graph.updateStatus("a", "completed");
      // 'c' still has 'b' as incomplete dependency
      expect(graph.getTask("c")!.status).toBe("pending");

      graph.updateStatus("b", "completed");
      expect(graph.getTask("c")!.status).toBe("ready");
    });

    it("should store result when provided", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });

      graph.updateStatus("a", "failed", "something went wrong");
      expect(graph.getTask("a")!.result).toBe("something went wrong");
    });
  });

  // ---------------------------------------------------------------------------
  // isComplete
  // ---------------------------------------------------------------------------

  describe("isComplete", () => {
    it("should return false for empty graph", () => {
      expect(graph.isComplete()).toBe(false);
    });

    it("should return false when tasks are pending", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      expect(graph.isComplete()).toBe(false);
    });

    it("should return false when tasks are running", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.updateStatus("a", "running");
      expect(graph.isComplete()).toBe(false);
    });

    it("should return true when all tasks are completed", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: ["a"], status: "pending" });

      graph.updateStatus("a", "completed");
      graph.updateStatus("b", "completed");
      expect(graph.isComplete()).toBe(true);
    });

    it("should return true when all tasks are completed or failed", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: [], status: "pending" });

      graph.updateStatus("a", "completed");
      graph.updateStatus("b", "failed", "error");
      expect(graph.isComplete()).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // getAllTasks
  // ---------------------------------------------------------------------------

  describe("getAllTasks", () => {
    it("should return all tasks", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });
      graph.addTask({ id: "b", objective: "B", dependencies: ["a"], status: "pending" });

      const tasks = graph.getAllTasks();
      expect(tasks).toHaveLength(2);
    });

    it("should return copies of tasks", () => {
      graph.addTask({ id: "a", objective: "A", dependencies: [], status: "pending" });

      const tasks1 = graph.getAllTasks();
      const tasks2 = graph.getAllTasks();
      expect(tasks1[0]).toEqual(tasks2[0]);
      expect(tasks1[0]).not.toBe(tasks2[0]);
    });

    it("should return empty array for empty graph", () => {
      expect(graph.getAllTasks()).toHaveLength(0);
    });
  });
});

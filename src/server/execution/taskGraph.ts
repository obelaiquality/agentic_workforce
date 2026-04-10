import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskNode {
  id: string;
  objective: string;
  dependencies: string[]; // IDs of tasks that must complete before this one
  agentRole?: string;
  status: "pending" | "ready" | "running" | "completed" | "failed";
  result?: string;
  assignedAgentId?: string;
}

// ---------------------------------------------------------------------------
// Task Dependency Graph
// ---------------------------------------------------------------------------

/**
 * A directed acyclic graph (DAG) of tasks with dependency tracking.
 *
 * Tasks can depend on other tasks; a task becomes "ready" only when all
 * of its dependencies have been completed. The graph enforces DAG
 * invariants and provides topological ordering for execution scheduling.
 */
export class TaskGraph {
  private nodes = new Map<string, TaskNode>();

  /**
   * Add a task to the graph.
   * Automatically sets status to "ready" if the task has no dependencies.
   */
  addTask(task: TaskNode): void {
    if (this.nodes.has(task.id)) {
      throw new Error(`Task already exists: ${task.id}`);
    }

    // Validate that all dependencies reference existing tasks
    for (const depId of task.dependencies) {
      if (!this.nodes.has(depId)) {
        throw new Error(`Dependency not found: ${depId} (required by task ${task.id})`);
      }
    }

    const status =
      task.dependencies.length === 0 ? "ready" : task.status === "ready" ? "ready" : task.status;

    this.nodes.set(task.id, { ...task, status });
  }

  /**
   * Remove a task from the graph.
   * Throws if other tasks depend on it.
   */
  removeTask(id: string): void {
    if (!this.nodes.has(id)) {
      throw new Error(`Task not found: ${id}`);
    }

    // Check if other tasks depend on this one
    for (const [otherId, node] of this.nodes) {
      if (node.dependencies.includes(id)) {
        throw new Error(`Cannot remove task ${id}: task ${otherId} depends on it`);
      }
    }

    this.nodes.delete(id);
  }

  /**
   * Get a task by ID.
   */
  getTask(id: string): TaskNode | undefined {
    const node = this.nodes.get(id);
    return node ? { ...node } : undefined;
  }

  /**
   * Returns tasks whose dependencies are all completed and whose status
   * is "pending" or "ready".
   */
  getReadyTasks(): TaskNode[] {
    const ready: TaskNode[] = [];

    for (const node of this.nodes.values()) {
      if (node.status !== "pending" && node.status !== "ready") continue;

      const allDepsCompleted = node.dependencies.every((depId) => {
        const dep = this.nodes.get(depId);
        return dep?.status === "completed";
      });

      if (allDepsCompleted) {
        ready.push({ ...node });
      }
    }

    return ready;
  }

  /**
   * Validate that the graph is a DAG (no cycles).
   * Uses DFS-based cycle detection.
   */
  validate(): { valid: boolean; cycles?: string[][] } {
    const WHITE = 0; // unvisited
    const GRAY = 1; // in current DFS path
    const BLACK = 2; // fully processed

    const color = new Map<string, number>();
    const parent = new Map<string, string | null>();
    const cycles: string[][] = [];

    for (const id of this.nodes.keys()) {
      color.set(id, WHITE);
    }

    const dfs = (nodeId: string): void => {
      color.set(nodeId, GRAY);
      const node = this.nodes.get(nodeId)!;

      for (const depId of node.dependencies) {
        if (!this.nodes.has(depId)) continue;

        const depColor = color.get(depId) ?? WHITE;

        if (depColor === GRAY) {
          // Found a cycle — trace it back
          const cycle: string[] = [depId, nodeId];
          let current = nodeId;
          while (current !== depId) {
            const p = parent.get(current);
            if (p === null || p === undefined) break;
            if (p === depId) break;
            cycle.push(p);
            current = p;
          }
          cycles.push(cycle.reverse());
        } else if (depColor === WHITE) {
          parent.set(depId, nodeId);
          dfs(depId);
        }
      }

      color.set(nodeId, BLACK);
    };

    for (const id of this.nodes.keys()) {
      if (color.get(id) === WHITE) {
        parent.set(id, null);
        dfs(id);
      }
    }

    return cycles.length === 0
      ? { valid: true }
      : { valid: false, cycles };
  }

  /**
   * Get topological order for execution using Kahn's algorithm
   * (BFS with in-degree tracking).
   *
   * Throws if the graph contains cycles.
   */
  topologicalSort(): TaskNode[] {
    // Compute in-degrees (number of dependencies each task has within the graph)
    const inDegree = new Map<string, number>();
    for (const [id, node] of this.nodes) {
      // Count only dependencies that exist in the graph
      const validDeps = node.dependencies.filter((d) => this.nodes.has(d));
      inDegree.set(id, validDeps.length);
    }

    // Build adjacency list: for each task, which tasks depend on it?
    const dependents = new Map<string, string[]>();
    for (const id of this.nodes.keys()) {
      dependents.set(id, []);
    }
    for (const [id, node] of this.nodes) {
      for (const depId of node.dependencies) {
        if (this.nodes.has(depId)) {
          dependents.get(depId)!.push(id);
        }
      }
    }

    // Start with nodes that have in-degree 0
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const sorted: TaskNode[] = [];

    while (queue.length > 0) {
      const id = queue.shift()!;
      sorted.push({ ...this.nodes.get(id)! });

      for (const depId of dependents.get(id)!) {
        const newDeg = inDegree.get(depId)! - 1;
        inDegree.set(depId, newDeg);
        if (newDeg === 0) {
          queue.push(depId);
        }
      }
    }

    if (sorted.length !== this.nodes.size) {
      throw new Error("Cannot topologically sort: graph contains cycles");
    }

    return sorted;
  }

  /**
   * Update the status of a task.
   * When a task completes, dependent tasks with all deps completed become "ready".
   */
  updateStatus(id: string, status: TaskNode["status"], result?: string): void {
    const node = this.nodes.get(id);
    if (!node) {
      throw new Error(`Task not found: ${id}`);
    }

    node.status = status;
    if (result !== undefined) {
      node.result = result;
    }

    // When a task completes, check if any dependent tasks are now ready
    if (status === "completed") {
      for (const other of this.nodes.values()) {
        if (other.status !== "pending") continue;
        if (!other.dependencies.includes(id)) continue;

        const allDepsCompleted = other.dependencies.every((depId) => {
          const dep = this.nodes.get(depId);
          return dep?.status === "completed";
        });

        if (allDepsCompleted) {
          other.status = "ready";
        }
      }
    }
  }

  /**
   * Check if all tasks are completed or failed.
   */
  isComplete(): boolean {
    for (const node of this.nodes.values()) {
      if (node.status !== "completed" && node.status !== "failed") {
        return false;
      }
    }
    return this.nodes.size > 0;
  }

  /**
   * Get all tasks in the graph.
   */
  getAllTasks(): TaskNode[] {
    return Array.from(this.nodes.values()).map((n) => ({ ...n }));
  }
}

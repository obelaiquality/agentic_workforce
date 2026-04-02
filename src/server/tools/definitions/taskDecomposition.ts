import { z } from "zod";
import type { ToolDefinition } from "../types";
import { SubtaskService } from "../../services/subtaskService";

let _subtaskService: SubtaskService | null = null;

export function getSubtaskService(): SubtaskService {
  if (!_subtaskService) {
    _subtaskService = new SubtaskService();
  }
  return _subtaskService;
}

export function setSubtaskService(service: SubtaskService): void {
  _subtaskService = service;
}

const createSubtaskSchema = z.object({
  title: z.string().max(96).describe("Concise subtask title (max 96 chars)"),
  description: z.string().describe("Detailed subtask description with acceptance criteria"),
  priority: z.enum(["p0", "p1", "p2", "p3"]).optional().describe("Priority (default: inherits from parent)"),
  dependencies: z.array(z.string()).optional().describe("Subtask IDs this task depends on"),
  estimated_complexity: z.enum(["low", "medium", "high"]).optional().describe("Estimated complexity"),
});

export const createSubtaskTool: ToolDefinition<z.infer<typeof createSubtaskSchema>> = {
  name: "create_subtask",
  description: `Decompose the current task into a subtask. Creates a tracked child task under the current ticket.

Use when:
- You identify a discrete unit of work that should be tracked separately
- You want to break a complex task into manageable pieces
- You need to establish dependencies between work items

The subtask appears in the project's kanban board under the parent ticket.`,
  inputSchema: createSubtaskSchema,
  permission: { scope: "meta", readOnly: false },
  alwaysLoad: true,
  concurrencySafe: true,
  searchHints: ["decompose", "split", "breakdown", "subtask", "child", "create"],

  async execute(input, ctx) {
    const subtask = await getSubtaskService().createSubtask({
      parentTicketId: ctx.ticketId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      estimatedComplexity: input.estimated_complexity,
      dependencies: input.dependencies,
    });

    await ctx.recordEvent({
      type: "subtask_created",
      payload: {
        subtaskId: subtask.id,
        title: subtask.title,
        parentTicketId: ctx.ticketId,
        priority: subtask.priority,
        dependencies: subtask.dependencies,
      },
    });

    let content = `Subtask created: "${subtask.title}" (ID: ${subtask.id})`;
    if (subtask.dependencies.length > 0) {
      content += `\nDepends on: ${subtask.dependencies.join(", ")}`;
    }

    return {
      type: "success",
      content,
      metadata: {
        subtaskId: subtask.id,
        parentTicketId: ctx.ticketId,
        status: subtask.status,
      },
    };
  },
};

const updateSubtaskSchema = z.object({
  subtask_id: z.string().describe("ID of the subtask to update"),
  status: z.enum(["backlog", "in_progress", "review", "blocked", "done"]).optional().describe("New status"),
  notes: z.string().optional().describe("Progress notes, blockers, or completion summary"),
});

export const updateSubtaskTool: ToolDefinition<z.infer<typeof updateSubtaskSchema>> = {
  name: "update_subtask",
  description: `Update a subtask's status or add notes. Use when you complete a subtask, encounter a blocker, or need to record progress.

Valid status transitions:
- backlog -> in_progress, blocked
- in_progress -> review, blocked, done
- blocked -> in_progress, backlog
- review -> done, in_progress`,
  inputSchema: updateSubtaskSchema,
  permission: { scope: "meta", readOnly: false },
  alwaysLoad: true,
  concurrencySafe: true,
  searchHints: ["update", "subtask", "status", "progress", "complete", "block"],

  async execute(input, ctx) {
    const service = getSubtaskService();
    const existing = await service.getSubtask(ctx.ticketId, input.subtask_id);
    const subtask = await service.updateSubtask({
      parentTicketId: ctx.ticketId,
      subtaskId: input.subtask_id,
      status: input.status,
      notes: input.notes,
    });

    if (!subtask) {
      return { type: "error", error: `Subtask "${input.subtask_id}" not found` };
    }

    const changes: string[] = [];
    if (input.status && existing && input.status !== existing.status) {
      changes.push(`Status: ${existing.status} -> ${input.status}`);
    }
    if (input.notes) {
      changes.push("Note added");
    }

    await ctx.recordEvent({
      type: "subtask_updated",
      payload: {
        subtaskId: input.subtask_id,
        status: subtask.status,
        changes,
      },
    });

    const siblings = await service.listSubtasks(ctx.ticketId, { includeCompleted: true });
    const allDone = siblings.length > 0 && siblings.every((item) => item.status === "done");

    let content = `Subtask "${subtask.title}" updated: ${changes.join(", ") || "No changes recorded"}`;
    if (allDone) {
      content += "\n\nAll subtasks for this ticket are now complete!";
    }

    return {
      type: "success",
      content,
      metadata: {
        subtaskId: input.subtask_id,
        status: subtask.status,
        allSiblingsDone: allDone,
      },
    };
  },
};

const listSubtasksSchema = z.object({
  include_completed: z.boolean().optional().describe("Include completed subtasks (default: false)"),
});

export const listSubtasksTool: ToolDefinition<z.infer<typeof listSubtasksSchema>> = {
  name: "list_subtasks",
  description: "List all subtasks for the current ticket. Shows status, dependencies, and progress.",
  inputSchema: listSubtasksSchema,
  permission: { scope: "meta", readOnly: true },
  alwaysLoad: true,
  concurrencySafe: true,
  searchHints: ["list", "subtasks", "children", "progress", "status"],

  async execute(input, ctx) {
    const service = getSubtaskService();
    const items = await service.listSubtasks(ctx.ticketId, {
      includeCompleted: input.include_completed,
    });
    const allItems = await service.listSubtasks(ctx.ticketId, {
      includeCompleted: true,
    });

    if (items.length === 0) {
      return {
        type: "success",
        content: input.include_completed
          ? "No subtasks found for this ticket."
          : "No active subtasks found. Use include_completed=true to see completed ones.",
        metadata: { count: 0 },
      };
    }

    const doneCount = allItems.filter((item) => item.status === "done").length;
    const progress = allItems.length > 0 ? Math.round((doneCount / allItems.length) * 100) : 0;
    const lines = items.map((item) => {
      const deps = item.dependencies.length > 0 ? ` (depends on: ${item.dependencies.join(", ")})` : "";
      const blocked = item.blockedBy.length > 0 ? ` [BLOCKED by: ${item.blockedBy.join(", ")}]` : "";
      return `- [${item.status}] ${item.title} (${item.id})${deps}${blocked}`;
    });

    return {
      type: "success",
      content: `Progress: ${doneCount}/${allItems.length} (${progress}%)\n\n${lines.join("\n")}`,
      metadata: {
        count: items.length,
        totalCount: allItems.length,
        doneCount,
        progress,
      },
    };
  },
};

export const taskDecompositionTools: ToolDefinition[] = [createSubtaskTool, updateSubtaskTool, listSubtasksTool];

export async function _getSubtasks(parentTicketId = "test-ticket") {
  return getSubtaskService().listSubtasks(parentTicketId, { includeCompleted: true });
}

export function _clearSubtasks(): void {
  getSubtaskService().clear();
}

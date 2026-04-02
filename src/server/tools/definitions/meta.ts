import path from "node:path";
import { z } from "zod";
import type { ToolDefinition, ToolContext } from "../types";
import { ShadowGitService } from "../../services/shadowGitService";

// ---------------------------------------------------------------------------
// 1. rollback_file — Rollback a file to a previous snapshot
// ---------------------------------------------------------------------------

const rollbackFileSchema = z.object({
  file_path: z.string().describe("Relative path to the file to rollback"),
  step_id: z.string().describe("Step ID of the snapshot to rollback to"),
});

export const rollbackFile: ToolDefinition<z.infer<typeof rollbackFileSchema>> = {
  name: "rollback_file",
  description: "Rollback a file to a previous snapshot state. Uses the shadow git service to restore file contents from a specific step.",
  inputSchema: rollbackFileSchema,
  permission: {
    scope: "repo.edit",
  },
  alwaysLoad: false, // Deferred tool — not always needed
  concurrencySafe: false,

  async execute(input, ctx) {
    const { file_path: filePath, step_id: stepId } = input;

    try {
      // Initialize shadow git service
      const shadowGit = new ShadowGitService(ctx.worktreePath);
      shadowGit.initialize();

      // Attempt rollback
      const result = shadowGit.rollback(stepId);

      if (!result) {
        return {
          type: "error",
          error: `No snapshot found for step ID: ${stepId}`,
        };
      }

      if (result.filePath !== filePath) {
        return {
          type: "error",
          error: `Step ${stepId} snapshot is for file "${result.filePath}", not "${filePath}"`,
        };
      }

      // Write the rolled-back content to the actual file
      const fs = await import("node:fs/promises");
      const fullPath = path.join(ctx.worktreePath, filePath);
      await fs.writeFile(fullPath, result.content, "utf-8");

      return {
        type: "success",
        content: `Successfully rolled back ${filePath} to step ${stepId}`,
        metadata: {
          filePath,
          stepId,
          bytes: result.content.length,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `Rollback failed: ${message}`,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// 2. ask_user — Request clarification from user
// ---------------------------------------------------------------------------

const askUserSchema = z.object({
  question: z.string().min(1).describe("Question to ask the user"),
});

export const askUser: ToolDefinition<z.infer<typeof askUserSchema>> = {
  name: "ask_user",
  description: "Request clarification or input from the user. Returns an approval_required result that pauses execution until the user responds.",
  inputSchema: askUserSchema,
  permission: {
    scope: "meta",
    readOnly: true,
  },
  alwaysLoad: true,
  concurrencySafe: true,

  async execute(input, ctx) {
    const { question } = input;

    try {
      // Create an approval request
      const approval = await ctx.createApproval({
        actionType: "ask_user",
        payload: {
          question,
          ticketId: ctx.ticketId,
          runId: ctx.runId,
        },
      });

      return {
        type: "approval_required",
        approvalId: approval.id,
        message: question,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `Failed to create user question: ${message}`,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// 3. complete_task — Signal task completion
// ---------------------------------------------------------------------------

const completeTaskSchema = z.object({
  summary: z.string().min(1).describe("Summary of work completed"),
  files_changed: z.array(z.string()).optional().describe("List of files that were modified"),
});

export const completeTask: ToolDefinition<z.infer<typeof completeTaskSchema>> = {
  name: "complete_task",
  description: "Signal that the task is complete. Provide a summary of the work done and optionally list files changed. This ends the execution loop.",
  inputSchema: completeTaskSchema,
  permission: {
    scope: "meta",
    readOnly: true,
  },
  alwaysLoad: true,
  concurrencySafe: true,

  async execute(input, ctx) {
    const { summary, files_changed = [] } = input;

    try {
      // Record a completion event
      await ctx.recordEvent({
        type: "task_completed",
        payload: {
          summary,
          filesChanged: files_changed,
          ticketId: ctx.ticketId,
          runId: ctx.runId,
          actor: ctx.actor,
          stage: ctx.stage,
        },
      });

      let content = `Task completed: ${summary}`;
      if (files_changed.length > 0) {
        content += `\n\nFiles changed (${files_changed.length}):\n${files_changed.map((f) => `  - ${f}`).join("\n")}`;
      }

      return {
        type: "success",
        content,
        metadata: {
          summary,
          filesChanged: files_changed,
          completedAt: new Date().toISOString(),
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `Failed to record task completion: ${message}`,
      };
    }
  },
};

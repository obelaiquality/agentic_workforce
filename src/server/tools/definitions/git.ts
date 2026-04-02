import { execSync } from "node:child_process";
import { z } from "zod";
import type { ToolDefinition, ToolContext } from "../types";

// ---------------------------------------------------------------------------
// 1. git_status — Show working tree status
// ---------------------------------------------------------------------------

const gitStatusSchema = z.object({});

export const gitStatus: ToolDefinition<z.infer<typeof gitStatusSchema>> = {
  name: "git_status",
  description: "Show the current git working tree status. Returns staged, unstaged, and untracked files in short format.",
  inputSchema: gitStatusSchema,
  permission: {
    scope: "git.meta",
    readOnly: true,
  },
  alwaysLoad: true,
  concurrencySafe: true,

  async execute(input, ctx) {
    try {
      const stdout = execSync("git status --short", {
        cwd: ctx.worktreePath,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      });

      // Also get branch info
      let branch = "unknown";
      try {
        branch = execSync("git branch --show-current", {
          cwd: ctx.worktreePath,
          encoding: "utf-8",
        }).trim();
      } catch {
        // Ignore errors (e.g., not on a branch)
      }

      return {
        type: "success",
        content: stdout.trim() || "(no changes)",
        metadata: {
          branch,
          hasChanges: stdout.trim().length > 0,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `git status failed: ${message}`,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// 2. git_diff — Show changes
// ---------------------------------------------------------------------------

const gitDiffSchema = z.object({
  staged: z.boolean().optional().describe("If true, show staged changes only (default: show unstaged)"),
});

export const gitDiff: ToolDefinition<z.infer<typeof gitDiffSchema>> = {
  name: "git_diff",
  description: "Show changes in the working tree. By default shows unstaged changes; use staged=true to show staged changes.",
  inputSchema: gitDiffSchema,
  permission: {
    scope: "git.meta",
    readOnly: true,
  },
  alwaysLoad: true,
  concurrencySafe: true,

  async execute(input, ctx) {
    const { staged = false } = input;

    try {
      const command = staged ? "git diff --cached" : "git diff";
      const stdout = execSync(command, {
        cwd: ctx.worktreePath,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      });

      return {
        type: "success",
        content: stdout.trim() || "(no diff)",
        metadata: {
          staged,
          hasDiff: stdout.trim().length > 0,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `git diff failed: ${message}`,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// 3. git_commit — Commit staged changes
// ---------------------------------------------------------------------------

const gitCommitSchema = z.object({
  message: z.string().min(1).describe("Commit message"),
  add_all: z.boolean().optional().describe("If true, stage all changes before committing (git add -A)"),
});

export const gitCommit: ToolDefinition<z.infer<typeof gitCommitSchema>> = {
  name: "git_commit",
  description: "Commit staged changes with a message. Optionally stage all changes first with add_all=true.",
  inputSchema: gitCommitSchema,
  permission: {
    scope: "git.write",
  },
  alwaysLoad: true,
  concurrencySafe: false,

  async execute(input, ctx) {
    const { message, add_all = false } = input;

    try {
      // Stage all changes if requested
      if (add_all) {
        execSync("git add -A", {
          cwd: ctx.worktreePath,
          encoding: "utf-8",
        });
      }

      // Check if there are staged changes
      const stagedDiff = execSync("git diff --cached --name-only", {
        cwd: ctx.worktreePath,
        encoding: "utf-8",
      }).trim();

      if (!stagedDiff) {
        return {
          type: "error",
          error: "No changes staged for commit. Use add_all=true to stage all changes, or stage files manually.",
        };
      }

      // Commit
      const stdout = execSync(`git commit -m ${JSON.stringify(message)}`, {
        cwd: ctx.worktreePath,
        encoding: "utf-8",
      });

      // Get commit hash
      let commitHash = "unknown";
      try {
        commitHash = execSync("git rev-parse HEAD", {
          cwd: ctx.worktreePath,
          encoding: "utf-8",
        }).trim();
      } catch {
        // Ignore errors
      }

      return {
        type: "success",
        content: stdout.trim(),
        metadata: {
          commitHash,
          message,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `git commit failed: ${message}`,
      };
    }
  },
};

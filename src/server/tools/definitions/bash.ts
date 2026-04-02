import { execSync } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import type { ToolDefinition, ToolContext, ToolResult } from "../types";
import { validatePath } from "../pathValidation";

// ---------------------------------------------------------------------------
// bash — Execute shell command
// ---------------------------------------------------------------------------

const bashSchema = z.object({
  command: z.string().describe("Shell command to execute"),
  cwd: z.string().optional().describe("Working directory (default: worktree root)"),
  timeout: z.number().int().min(1000).max(600000).optional().describe("Timeout in milliseconds (default: 90000ms / 90s)"),
});

export const bash: ToolDefinition<z.infer<typeof bashSchema>> = {
  name: "bash",
  description: "Execute a shell command in the worktree. Returns stdout, stderr, and exit code. Use with caution for destructive operations.",
  inputSchema: bashSchema,
  permission: {
    scope: "repo.verify",
    checkApproval: (input: unknown, ctx: ToolContext) => {
      const { command } = input as { command: string };
      return isDangerousCommand(command, ctx);
    },
  },
  alwaysLoad: true,
  concurrencySafe: false,

  async execute(input, ctx) {
    const { command, cwd, timeout = 90000 } = input;
    let workingDir = ctx.worktreePath;
    if (cwd) {
      const { fullPath, error: cwdError } = validatePath(ctx.worktreePath, cwd, "read");
      if (cwdError) {
        return { type: "error", error: cwdError };
      }
      workingDir = fullPath;
    }

    try {
      const stdout = execSync(command, {
        cwd: workingDir,
        encoding: "utf-8",
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        stdio: "pipe",
      });

      return {
        type: "success",
        content: stdout,
        metadata: {
          exitCode: 0,
          command,
        },
      };
    } catch (err: unknown) {
      // execSync throws on non-zero exit code
      if (err && typeof err === "object" && "status" in err && "stdout" in err && "stderr" in err) {
        const execErr = err as { status: number; stdout: string; stderr: string };
        return {
          type: "error",
          error: `Command failed with exit code ${execErr.status}\n\nstdout:\n${execErr.stdout}\n\nstderr:\n${execErr.stderr}`,
          metadata: {
            exitCode: execErr.status,
            stdout: execErr.stdout,
            stderr: execErr.stderr,
          },
        };
      }

      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `Command execution failed: ${message}`,
        metadata: {
          command,
        },
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Dangerous command detection
// ---------------------------------------------------------------------------

function isDangerousCommand(command: string, ctx: ToolContext): boolean {
  const dangerous = [
    // Destructive file operations
    /rm\s+(-[rf]+\s+)?\/($|\s)/,           // rm -rf /
    /rm\s+(-[rf]+\s+)?\*/,                  // rm -rf *
    /:\(\)\{.*\|.*&\s*\}/,                  // fork bomb

    // Dangerous git operations
    /git\s+push\s+.*--force/,               // git push --force
    /git\s+reset\s+--hard/,                 // git reset --hard
    /git\s+clean\s+-[fdx]/,                 // git clean -fd
    /git\s+branch\s+-D\s+(?:main|master)/,  // deleting main/master branch

    // Force push to main/master
    /git\s+push\s+(?:.*\s+)?(?:origin\s+)?(?:main|master)\s+(?:.*\s+)?--force/,

    // System-level destructive operations
    /dd\s+if=/,                             // dd command (disk destroyer)
    /mkfs\./,                               // filesystem creation
    />\s*\/dev\/sd[a-z]/,                   // writing to disk devices

    // Package manager uninstall/purge
    /npm\s+uninstall\s+-g/,                 // global npm uninstall
    /apt-get\s+(?:remove|purge)/,           // apt removal
    /brew\s+uninstall/,                     // brew uninstall

    // Overwriting critical files
    />\s*\/etc\//,                          // writing to /etc
    />\s*~\/\.(?:bash|zsh)rc/,              // overwriting shell config
  ];

  return dangerous.some((pattern) => pattern.test(command));
}

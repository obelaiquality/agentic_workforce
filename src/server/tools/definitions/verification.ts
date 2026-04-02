import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { z } from "zod";
import type { ToolDefinition, ToolContext } from "../types";

// ---------------------------------------------------------------------------
// 1. run_tests — Run project test suite
// ---------------------------------------------------------------------------

const runTestsSchema = z.object({
  command: z.string().optional().describe("Test command to run (default: auto-detect from package.json)"),
});

export const runTests: ToolDefinition<z.infer<typeof runTestsSchema>> = {
  name: "run_tests",
  description: "Run the project's test suite. Auto-detects test command from package.json if not provided. Returns test output and exit code.",
  inputSchema: runTestsSchema,
  permission: {
    scope: "repo.verify",
  },
  alwaysLoad: true,
  concurrencySafe: false,

  async execute(input, ctx) {
    let { command } = input;

    // Auto-detect test command if not provided
    if (!command) {
      command = await detectTestCommand(ctx.worktreePath);
      if (!command) {
        return {
          type: "error",
          error: "Could not auto-detect test command. Please provide a command explicitly, or add a 'test' script to package.json.",
        };
      }
    }

    try {
      const stdout = execSync(command, {
        cwd: ctx.worktreePath,
        encoding: "utf-8",
        maxBuffer: 20 * 1024 * 1024, // 20MB for test output
        timeout: 300000, // 5 minutes
      });

      return {
        type: "success",
        content: stdout,
        metadata: {
          command,
          exitCode: 0,
        },
      };
    } catch (err: unknown) {
      if (err && typeof err === "object" && "status" in err && "stdout" in err && "stderr" in err) {
        const execErr = err as { status: number; stdout: string; stderr: string };
        return {
          type: "error",
          error: `Tests failed with exit code ${execErr.status}\n\n${execErr.stdout}\n\n${execErr.stderr}`,
          metadata: {
            command,
            exitCode: execErr.status,
            stdout: execErr.stdout,
            stderr: execErr.stderr,
          },
        };
      }

      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `Test execution failed: ${message}`,
        metadata: {
          command,
        },
      };
    }
  },
};

// ---------------------------------------------------------------------------
// 2. run_lint — Run linter
// ---------------------------------------------------------------------------

const runLintSchema = z.object({
  command: z.string().optional().describe("Lint command to run (default: auto-detect from package.json)"),
});

export const runLint: ToolDefinition<z.infer<typeof runLintSchema>> = {
  name: "run_lint",
  description: "Run the project's linter. Auto-detects lint command from package.json if not provided. Returns lint output and exit code.",
  inputSchema: runLintSchema,
  permission: {
    scope: "repo.verify",
  },
  alwaysLoad: true,
  concurrencySafe: false,

  async execute(input, ctx) {
    let { command } = input;

    // Auto-detect lint command if not provided
    if (!command) {
      command = await detectLintCommand(ctx.worktreePath);
      if (!command) {
        return {
          type: "error",
          error: "Could not auto-detect lint command. Please provide a command explicitly, or add a 'lint' script to package.json.",
        };
      }
    }

    try {
      const stdout = execSync(command, {
        cwd: ctx.worktreePath,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: 120000, // 2 minutes
      });

      return {
        type: "success",
        content: stdout,
        metadata: {
          command,
          exitCode: 0,
        },
      };
    } catch (err: unknown) {
      if (err && typeof err === "object" && "status" in err && "stdout" in err && "stderr" in err) {
        const execErr = err as { status: number; stdout: string; stderr: string };
        return {
          type: "error",
          error: `Lint failed with exit code ${execErr.status}\n\n${execErr.stdout}\n\n${execErr.stderr}`,
          metadata: {
            command,
            exitCode: execErr.status,
            stdout: execErr.stdout,
            stderr: execErr.stderr,
          },
        };
      }

      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `Lint execution failed: ${message}`,
        metadata: {
          command,
        },
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Auto-detection helpers
// ---------------------------------------------------------------------------

async function detectTestCommand(worktreePath: string): Promise<string | null> {
  try {
    const pkgJsonPath = path.join(worktreePath, "package.json");
    const content = await fs.readFile(pkgJsonPath, "utf-8");
    const pkg = JSON.parse(content);

    if (pkg.scripts?.test) {
      return "npm test";
    }

    // Check for common test runners
    if (pkg.devDependencies || pkg.dependencies) {
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.vitest) return "npx vitest run";
      if (deps.jest) return "npx jest";
      if (deps.mocha) return "npx mocha";
      if (deps["@playwright/test"]) return "npx playwright test";
    }

    return null;
  } catch {
    return null;
  }
}

async function detectLintCommand(worktreePath: string): Promise<string | null> {
  try {
    const pkgJsonPath = path.join(worktreePath, "package.json");
    const content = await fs.readFile(pkgJsonPath, "utf-8");
    const pkg = JSON.parse(content);

    if (pkg.scripts?.lint) {
      return "npm run lint";
    }

    if (pkg.scripts?.["lint:code"]) {
      return "npm run lint:code";
    }

    // Check for common linters
    if (pkg.devDependencies || pkg.dependencies) {
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.eslint) return "npx eslint .";
      if (deps.biome) return "npx biome check .";
    }

    return null;
  } catch {
    return null;
  }
}

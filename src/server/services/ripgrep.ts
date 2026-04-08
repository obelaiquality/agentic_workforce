/**
 * Async ripgrep utility — wraps the `rg` binary for high-performance file
 * listing and content search. Falls back gracefully when rg is unavailable.
 */

import { execFile, execFileSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Version control directories to exclude from searches. */
export const VCS_DIRS = [".git", ".svn", ".hg", ".bzr", ".jj", ".sl"] as const;

/** Common directories to ignore in file walks and searches. */
export const COMMON_IGNORE_DIRS = [
  ...VCS_DIRS,
  "node_modules",
  ".agentic-workforce",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "target",
] as const;

// ---------------------------------------------------------------------------
// Ripgrep Detection (memoized)
// ---------------------------------------------------------------------------

let cachedRgPath: string | null | undefined;

/**
 * Returns the absolute path to `rg`, or null if not found.
 * Result is memoized — `which rg` runs at most once per process.
 *
 * Override with the `RIPGREP_PATH` environment variable.
 */
export function getRipgrepPath(): string | null {
  if (cachedRgPath !== undefined) return cachedRgPath;

  // Allow explicit override
  if (process.env.RIPGREP_PATH) {
    cachedRgPath = process.env.RIPGREP_PATH;
    return cachedRgPath;
  }

  try {
    const result = execFileSync("which", ["rg"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    }).trim();
    cachedRgPath = result || null;
  } catch {
    cachedRgPath = null;
  }

  return cachedRgPath;
}

/**
 * Reset the memoized rg path (useful for testing).
 */
export function resetRipgrepPathCache(): void {
  cachedRgPath = undefined;
}

// ---------------------------------------------------------------------------
// Error Classes
// ---------------------------------------------------------------------------

/** Thrown when a ripgrep invocation exceeds its timeout. */
export class RipgrepTimeoutError extends Error {
  constructor(message: string, public readonly timeoutMs: number) {
    super(message);
    this.name = "RipgrepTimeoutError";
  }
}

/** Thrown when ripgrep encounters an actual error (exit code 2). */
export class RipgrepError extends Error {
  constructor(message: string, public readonly exitCode: number) {
    super(message);
    this.name = "RipgrepError";
  }
}

// ---------------------------------------------------------------------------
// Async Execution
// ---------------------------------------------------------------------------

export interface RipgrepOptions {
  /** Working directory for the rg process. */
  cwd?: string;
  /** Maximum stdout buffer size in bytes (default: 20 MB). */
  maxBuffer?: number;
  /** Timeout in milliseconds (default: 30 000). */
  timeoutMs?: number;
  /** AbortSignal to cancel the search. */
  signal?: AbortSignal;
}

const DEFAULT_MAX_BUFFER = 20 * 1024 * 1024; // 20 MB
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Check if stderr indicates an EAGAIN error (resource temporarily unavailable).
 * Common in Docker/CI when rg spawns too many threads.
 */
function isEagainError(stderr: string): boolean {
  return (
    stderr.includes("os error 11") ||
    stderr.includes("Resource temporarily unavailable")
  );
}

/**
 * Execute ripgrep asynchronously and return output lines.
 *
 * - Exit code 0 → matched lines
 * - Exit code 1 → no matches → returns `[]`
 * - Exit code 2 → rg error → throws `RipgrepError`
 * - EAGAIN → retries once after 100 ms
 * - Timeout → throws `RipgrepTimeoutError`
 *
 * @throws {RipgrepError} when rg exits with code 2
 * @throws {RipgrepTimeoutError} when the timeout is exceeded
 * @throws {Error} when rg is not installed
 */
export async function execRipgrep(
  args: string[],
  options?: RipgrepOptions,
): Promise<string[]> {
  const rgPath = getRipgrepPath();
  if (!rgPath) {
    throw new Error(
      "ripgrep (rg) is not installed. Install it via: brew install ripgrep / apt install ripgrep",
    );
  }

  const cwd = options?.cwd;
  const maxBuffer = options?.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = options?.signal;

  return runRg(rgPath, args, { cwd, maxBuffer, timeoutMs, signal }, true);
}

async function runRg(
  rgPath: string,
  args: string[],
  opts: { cwd?: string; maxBuffer: number; timeoutMs: number; signal?: AbortSignal },
  allowRetry: boolean,
): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }

    let child: ChildProcess;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child?.kill("SIGTERM");
    }, opts.timeoutMs);

    try {
      child = execFile(
        rgPath,
        args,
        {
          cwd: opts.cwd,
          encoding: "utf-8",
          maxBuffer: opts.maxBuffer,
        },
        (error, stdout, stderr) => {
          clearTimeout(timer);
          if (settled) return;
          settled = true;

          if (timedOut) {
            reject(
              new RipgrepTimeoutError(
                `ripgrep timed out after ${opts.timeoutMs}ms`,
                opts.timeoutMs,
              ),
            );
            return;
          }

          // Exit code 1 = no matches
          if (error && "code" in error && error.code === 1) {
            resolve([]);
            return;
          }

          // EAGAIN — retry once
          if (error && typeof stderr === "string" && isEagainError(stderr) && allowRetry) {
            setTimeout(() => {
              runRg(rgPath, args, opts, false).then(resolve, reject);
            }, 100);
            return;
          }

          // Exit code 2 or other rg error
          if (error) {
            const exitCode =
              typeof (error as NodeJS.ErrnoException).code === "number"
                ? ((error as NodeJS.ErrnoException).code as unknown as number)
                : 2;
            reject(
              new RipgrepError(
                stderr?.trim() || error.message || "ripgrep failed",
                exitCode,
              ),
            );
            return;
          }

          // Success — split into lines and filter empties
          const lines = (stdout as string)
            .split("\n")
            .filter((line) => line.length > 0);
          resolve(lines);
        },
      );
    } catch (spawnError) {
      clearTimeout(timer);
      settled = true;
      reject(spawnError);
      return;
    }

    // Wire up AbortSignal
    if (opts.signal) {
      const onAbort = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          child?.kill("SIGTERM");
          reject(new Error("Aborted"));
        }
      };
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers for building rg args
// ---------------------------------------------------------------------------

/** Build `--glob '!<dir>'` exclusion args for VCS directories. */
export function vcsExclusionArgs(): string[] {
  const args: string[] = [];
  for (const dir of VCS_DIRS) {
    args.push("--glob", `!${dir}`);
  }
  return args;
}

/** Build `--glob '!<dir>'` exclusion args for all common ignore dirs. */
export function commonExclusionArgs(): string[] {
  const args: string[] = [];
  for (const dir of COMMON_IGNORE_DIRS) {
    args.push("--glob", `!${dir}`);
  }
  return args;
}

/**
 * Extract the static base directory from a glob pattern.
 * Everything before the first glob metacharacter (`*`, `?`, `[`, `{`).
 *
 * Examples:
 *   "src/components/*.tsx" → { baseDir: "src/components", relativePattern: "*.tsx" }
 *   "**\/*.ts"            → { baseDir: "",               relativePattern: "**\/*.ts" }
 */
export function extractGlobBaseDir(pattern: string): {
  baseDir: string;
  relativePattern: string;
} {
  const firstMeta = pattern.search(/[*?[{]/);
  if (firstMeta === -1) {
    // No glob chars — treat the directory part as base
    const lastSlash = pattern.lastIndexOf("/");
    if (lastSlash === -1) return { baseDir: "", relativePattern: pattern };
    return {
      baseDir: pattern.slice(0, lastSlash),
      relativePattern: pattern.slice(lastSlash + 1),
    };
  }

  const staticPrefix = pattern.slice(0, firstMeta);
  const lastSlash = Math.max(staticPrefix.lastIndexOf("/"), staticPrefix.lastIndexOf("\\"));

  if (lastSlash === -1) {
    return { baseDir: "", relativePattern: pattern };
  }

  return {
    baseDir: staticPrefix.slice(0, lastSlash),
    relativePattern: pattern.slice(lastSlash + 1),
  };
}

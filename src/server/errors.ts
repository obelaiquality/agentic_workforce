/**
 * Structured error types for telemetry-safe error handling.
 * Inspired by claude-code's error hierarchy.
 */

export class ShellError extends Error {
  readonly name = "ShellError";

  constructor(
    message: string,
    public readonly stdout: string,
    public readonly stderr: string,
    public readonly exitCode: number,
  ) {
    super(message);
  }
}

export class ModelInferenceError extends Error {
  readonly name = "ModelInferenceError";

  constructor(
    message: string,
    public readonly providerId: string,
    public readonly modelRole?: string,
  ) {
    super(message);
  }
}

export class FileSystemError extends Error {
  readonly name = "FileSystemError";

  constructor(
    message: string,
    public readonly filePath: string,
    public readonly operation: "read" | "write" | "delete",
  ) {
    super(message);
  }
}

/**
 * Truncate an error stack to N frames for model context.
 * Reduces token waste when including errors in prompts.
 */
export function shortErrorStack(error: Error, maxFrames = 5): string {
  const stack = error.stack || error.message;
  const lines = stack.split("\n");
  if (lines.length <= maxFrames + 1) return stack;
  return `${lines.slice(0, maxFrames + 1).join("\n")}\n    ... ${lines.length - maxFrames - 1} more frames`;
}

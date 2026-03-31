/**
 * Unit tests for errors.ts
 * Tests structured error types and stack truncation utility.
 */
import { describe, it, expect } from "vitest";
import {
  ShellError,
  ModelInferenceError,
  FileSystemError,
  shortErrorStack,
} from "./errors";

describe("ShellError", () => {
  it("sets all properties correctly", () => {
    const error = new ShellError(
      "Command failed",
      "output line",
      "error line",
      127,
    );

    expect(error.message).toBe("Command failed");
    expect(error.stdout).toBe("output line");
    expect(error.stderr).toBe("error line");
    expect(error.exitCode).toBe(127);
  });

  it("has name ShellError", () => {
    const error = new ShellError("test", "", "", 1);
    expect(error.name).toBe("ShellError");
  });

  it("is an instance of Error", () => {
    const error = new ShellError("test", "", "", 1);
    expect(error).toBeInstanceOf(Error);
  });

  it("handles empty stdout and stderr", () => {
    const error = new ShellError("Failed", "", "", 0);
    expect(error.stdout).toBe("");
    expect(error.stderr).toBe("");
  });

  it("handles multiline output", () => {
    const error = new ShellError(
      "Multi-line fail",
      "line1\nline2\nline3",
      "err1\nerr2",
      1,
    );

    expect(error.stdout).toBe("line1\nline2\nline3");
    expect(error.stderr).toBe("err1\nerr2");
  });
});

describe("ModelInferenceError", () => {
  it("sets providerId and message", () => {
    const error = new ModelInferenceError("Inference failed", "qwen-cli");

    expect(error.message).toBe("Inference failed");
    expect(error.providerId).toBe("qwen-cli");
  });

  it("has name ModelInferenceError", () => {
    const error = new ModelInferenceError("test", "provider");
    expect(error.name).toBe("ModelInferenceError");
  });

  it("sets optional modelRole when provided", () => {
    const error = new ModelInferenceError(
      "Role error",
      "openai",
      "coder_default",
    );

    expect(error.modelRole).toBe("coder_default");
  });

  it("allows undefined modelRole", () => {
    const error = new ModelInferenceError("No role", "provider");
    expect(error.modelRole).toBeUndefined();
  });

  it("is an instance of Error", () => {
    const error = new ModelInferenceError("test", "provider");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("FileSystemError", () => {
  it("sets filePath and operation", () => {
    const error = new FileSystemError(
      "Cannot read file",
      "/path/to/file.txt",
      "read",
    );

    expect(error.message).toBe("Cannot read file");
    expect(error.filePath).toBe("/path/to/file.txt");
    expect(error.operation).toBe("read");
  });

  it("has name FileSystemError", () => {
    const error = new FileSystemError("test", "/path", "write");
    expect(error.name).toBe("FileSystemError");
  });

  it("supports all operation types", () => {
    const readErr = new FileSystemError("read fail", "/path", "read");
    const writeErr = new FileSystemError("write fail", "/path", "write");
    const deleteErr = new FileSystemError("delete fail", "/path", "delete");

    expect(readErr.operation).toBe("read");
    expect(writeErr.operation).toBe("write");
    expect(deleteErr.operation).toBe("delete");
  });

  it("handles absolute paths", () => {
    const error = new FileSystemError(
      "Access denied",
      "/Users/test/workspace/file.ts",
      "write",
    );

    expect(error.filePath).toBe("/Users/test/workspace/file.ts");
  });

  it("is an instance of Error", () => {
    const error = new FileSystemError("test", "/path", "read");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("shortErrorStack", () => {
  it("truncates stack to maxFrames", () => {
    const error = new Error("Test error");
    // Manually create a stack with known number of lines
    const lines = [
      "Error: Test error",
      "    at frame1",
      "    at frame2",
      "    at frame3",
      "    at frame4",
      "    at frame5",
      "    at frame6",
      "    at frame7",
    ];
    error.stack = lines.join("\n");

    const result = shortErrorStack(error, 3);
    const resultLines = result.split("\n");

    // Should have: message line + 3 frames + "... N more frames"
    expect(resultLines.length).toBe(5);
    expect(resultLines[0]).toBe("Error: Test error");
    expect(resultLines[1]).toBe("    at frame1");
    expect(resultLines[2]).toBe("    at frame2");
    expect(resultLines[3]).toBe("    at frame3");
    expect(resultLines[4]).toMatch(/\.\.\. \d+ more frames/);
  });

  it("preserves message line", () => {
    const error = new Error("Important message");
    const lines = [
      "Error: Important message",
      "    at somewhere",
      "    at elsewhere",
      "    at anywhere",
    ];
    error.stack = lines.join("\n");

    const result = shortErrorStack(error, 1);

    expect(result).toContain("Error: Important message");
    expect(result.split("\n")[0]).toBe("Error: Important message");
  });

  it("handles errors without stack", () => {
    const error = new Error("No stack");
    error.stack = undefined;

    const result = shortErrorStack(error);

    expect(result).toBe("No stack");
  });

  it("appends correct N more frames message", () => {
    const error = new Error("Test");
    const lines = ["Error: Test"];
    for (let i = 1; i <= 10; i++) {
      lines.push(`    at frame${i}`);
    }
    error.stack = lines.join("\n");

    const result = shortErrorStack(error, 5);

    // Total lines = 11 (message + 10 frames)
    // Kept = 6 (message + 5 frames)
    // Trimmed = 5 frames
    expect(result).toContain("... 5 more frames");
  });

  it("returns full stack when lines <= maxFrames + 1", () => {
    const error = new Error("Short stack");
    const lines = [
      "Error: Short stack",
      "    at frame1",
      "    at frame2",
      "    at frame3",
    ];
    error.stack = lines.join("\n");

    const result = shortErrorStack(error, 5);

    // 4 lines total <= 5 maxFrames + 1
    expect(result).toBe(lines.join("\n"));
    expect(result).not.toContain("more frames");
  });

  it("handles exactly maxFrames + 1 lines", () => {
    const error = new Error("Exact");
    const lines = [
      "Error: Exact",
      "    at frame1",
      "    at frame2",
      "    at frame3",
    ];
    error.stack = lines.join("\n");

    const result = shortErrorStack(error, 3);

    // Exactly 4 lines (3 maxFrames + 1 message) — should return full stack
    expect(result).toBe(lines.join("\n"));
    expect(result).not.toContain("more frames");
  });

  it("uses default maxFrames of 5", () => {
    const error = new Error("Default");
    const lines = ["Error: Default"];
    for (let i = 1; i <= 10; i++) {
      lines.push(`    at frame${i}`);
    }
    error.stack = lines.join("\n");

    const result = shortErrorStack(error);

    const resultLines = result.split("\n");
    // Message + 5 frames + "... N more frames"
    expect(resultLines.length).toBe(7);
    expect(result).toContain("... 5 more frames");
  });

  it("handles single-line stack", () => {
    const error = new Error("Single");
    error.stack = "Error: Single";

    const result = shortErrorStack(error, 5);

    expect(result).toBe("Error: Single");
    expect(result).not.toContain("more frames");
  });

  it("handles empty error message", () => {
    const error = new Error("");
    const lines = [
      "Error",
      "    at frame1",
      "    at frame2",
      "    at frame3",
      "    at frame4",
      "    at frame5",
      "    at frame6",
    ];
    error.stack = lines.join("\n");

    const result = shortErrorStack(error, 2);

    expect(result.split("\n")[0]).toBe("Error");
    expect(result).toContain("... 4 more frames");
  });
});

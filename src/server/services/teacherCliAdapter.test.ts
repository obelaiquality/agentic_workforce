import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BehaviorSpecV1 } from "../../shared/contracts";

const mockExecFileAsync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:util", () => ({
  promisify: () => mockExecFileAsync,
}));

vi.mock("./privacyScanner", () => ({
  scanAndRedactSensitiveText: vi.fn((text: string) => ({
    redacted: text,
    hadSensitiveData: false,
    redactionsMade: 0,
  })),
}));

import { generateTeacherExample } from "./teacherCliAdapter";

describe("teacherCliAdapter", () => {
  const mockSpec: BehaviorSpecV1 = {
    specId: "test-spec-001",
    intent: "Create a user authentication endpoint",
    inputs: ["user credentials", "validation rules"],
    constraints: ["use JWT tokens", "hash passwords with bcrypt"],
    requiredTools: ["edit_file", "run_command"],
    requiredChecks: ["unit_test", "integration_test"],
    expectedArtifacts: ["src/auth.ts", "tests/auth.test.ts"],
    riskClass: "medium",
  };

  const mockOptions = {
    command: "qwen-cli",
    model: "qwen-3.5-4b",
    timeoutMs: 30000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generateTeacherExample", () => {
    it("successfully generates teacher output from CLI", async () => {
      const mockStdout = JSON.stringify({
        result: "Test teacher output",
        structured_output: {
          teacherOutput: "Create auth endpoint with JWT validation",
          citations: ["docs/auth.md", "examples/jwt.ts"],
        },
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 20,
          cache_creation_input_tokens: 10,
        },
        total_cost_usd: 0.0025,
      });

      mockExecFileAsync.mockResolvedValue({ stdout: mockStdout, stderr: "" });

      const result = await generateTeacherExample(mockSpec, ["retrieval-001"], mockOptions);

      expect(result.teacherOutput).toBe("Create auth endpoint with JWT validation");
      expect(result.citations).toEqual(["docs/auth.md", "examples/jwt.ts"]);
      expect(result.model).toBe("qwen-3.5-4b");
      expect(result.usedFallback).toBe(false);
      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(50);
      expect(result.usage.cacheReadInputTokens).toBe(20);
      expect(result.usage.cacheCreationInputTokens).toBe(10);
      expect(result.usage.totalTokens).toBe(180);
      expect(result.usage.costUsd).toBe(0.0025);
    });

    it("calls CLI with correct arguments", async () => {
      mockExecFileAsync.mockResolvedValue({
        stdout: JSON.stringify({ result: "output" }),
        stderr: "",
      });

      await generateTeacherExample(mockSpec, ["retrieval-001"], mockOptions);

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        "qwen-cli",
        expect.arrayContaining([
          "-p",
          "--output-format",
          "json",
          "--model",
          "qwen-3.5-4b",
          expect.stringContaining("SPEC_ID: test-spec-001"),
        ]),
        expect.objectContaining({
          timeout: 30000,
          maxBuffer: 2 * 1024 * 1024,
        })
      );
    });

    it("builds prompt with spec details", async () => {
      let capturedPrompt = "";
      mockExecFileAsync.mockImplementation(async (cmd, args) => {
        if (Array.isArray(args)) {
          capturedPrompt = args[args.length - 1] as string;
        }
        return { stdout: JSON.stringify({ result: "ok" }), stderr: "" };
      });

      await generateTeacherExample(mockSpec, ["retrieval-001", "retrieval-002"], mockOptions);

      expect(capturedPrompt).toContain("SPEC_ID: test-spec-001");
      expect(capturedPrompt).toContain("INTENT: Create a user authentication endpoint");
      expect(capturedPrompt).toContain("INPUTS: user credentials | validation rules");
      expect(capturedPrompt).toContain("CONSTRAINTS: use JWT tokens | hash passwords with bcrypt");
      expect(capturedPrompt).toContain("REQUIRED_TOOLS: edit_file | run_command");
      expect(capturedPrompt).toContain("REQUIRED_CHECKS: unit_test | integration_test");
      expect(capturedPrompt).toContain("EXPECTED_ARTIFACTS: src/auth.ts | tests/auth.test.ts");
      expect(capturedPrompt).toContain("RISK_CLASS: medium");
      expect(capturedPrompt).toContain("RETRIEVAL_CONTEXT_IDS: retrieval-001 | retrieval-002");
    });

    it("falls back to result field when structured_output is missing", async () => {
      const mockStdout = JSON.stringify({
        result: JSON.stringify({
          teacherOutput: "Fallback teacher output",
          citations: ["doc1.md"],
        }),
        usage: {
          input_tokens: 80,
          output_tokens: 40,
        },
      });

      mockExecFileAsync.mockResolvedValue({ stdout: mockStdout, stderr: "" });

      const result = await generateTeacherExample(mockSpec, [], mockOptions);

      expect(result.teacherOutput).toBe("Fallback teacher output");
      expect(result.citations).toEqual(["doc1.md"]);
    });

    it("uses fallback when CLI returns error flag", async () => {
      const mockStdout = JSON.stringify({
        is_error: true,
        result: "Rate limit exceeded",
      });

      mockExecFileAsync.mockResolvedValue({ stdout: mockStdout, stderr: "" });

      const result = await generateTeacherExample(mockSpec, ["retrieval-001"], mockOptions);

      expect(result.usedFallback).toBe(true);
      expect(result.model).toBe("fallback");
      expect(result.errorClass).toBe("rate_limited");
      expect(result.errorMessage).toBe("Rate limit exceeded");
    });

    it("classifies rate limit errors correctly", async () => {
      const mockStdout = JSON.stringify({
        is_error: true,
        result: "429 Rate limit hit your limit",
      });

      mockExecFileAsync.mockResolvedValue({ stdout: mockStdout, stderr: "" });

      const result = await generateTeacherExample(mockSpec, [], mockOptions);

      expect(result.errorClass).toBe("rate_limited");
    });

    it("classifies timeout errors correctly", async () => {
      const error = Object.assign(new Error("Command timed out"), {
        killed: true,
        signal: "SIGTERM",
      });
      mockExecFileAsync.mockRejectedValue(error);

      const result = await generateTeacherExample(mockSpec, [], mockOptions);

      expect(result.usedFallback).toBe(true);
      expect(result.errorClass).toBe("timeout");
    });

    it("classifies auth errors correctly", async () => {
      const mockStdout = JSON.stringify({
        is_error: true,
        result: "Unauthorized: invalid auth token",
      });

      mockExecFileAsync.mockResolvedValue({ stdout: mockStdout, stderr: "" });

      const result = await generateTeacherExample(mockSpec, [], mockOptions);

      expect(result.errorClass).toBe("auth_required");
    });

    it("classifies provider unavailable errors correctly", async () => {
      const mockStdout = JSON.stringify({
        is_error: true,
        result: "Provider service unavailable",
      });

      mockExecFileAsync.mockResolvedValue({ stdout: mockStdout, stderr: "" });

      const result = await generateTeacherExample(mockSpec, [], mockOptions);

      expect(result.errorClass).toBe("provider_unavailable");
    });

    it("handles execFile errors with fallback", async () => {
      mockExecFileAsync.mockRejectedValue(new Error("Something went wrong"));

      const result = await generateTeacherExample(mockSpec, ["retrieval-001"], mockOptions);

      expect(result.usedFallback).toBe(true);
      expect(result.model).toBe("fallback");
      expect(result.teacherOutput).toContain("Execute Create a user authentication endpoint");
      expect(result.citations).toEqual(["retrieval-001"]);
      expect(result.errorClass).toBe("unknown");
    });

    it("includes stderr in error message when available", async () => {
      const error = Object.assign(new Error("CLI failed"), {
        stderr: "Detailed error from stderr",
      });
      mockExecFileAsync.mockRejectedValue(error);

      const result = await generateTeacherExample(mockSpec, [], mockOptions);

      expect(result.errorMessage).toContain("Detailed error from stderr");
    });

    it("enforces minimum timeout of 5000ms", async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: JSON.stringify({ result: "ok" }), stderr: "" });

      await generateTeacherExample(mockSpec, [], {
        ...mockOptions,
        timeoutMs: 1000,
      });

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          timeout: 5000,
        })
      );
    });

    it("respects specified timeout when greater than 5000ms", async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: JSON.stringify({ result: "ok" }), stderr: "" });

      await generateTeacherExample(mockSpec, [], {
        ...mockOptions,
        timeoutMs: 60000,
      });

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          timeout: 60000,
        })
      );
    });

    it("handles empty retrieval context IDs", async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: JSON.stringify({ result: "ok" }), stderr: "" });

      const result = await generateTeacherExample(mockSpec, [], mockOptions);

      expect(result.citations).toEqual([]);
    });

    it("filters out empty citations from structured_output", async () => {
      const mockStdout = JSON.stringify({
        structured_output: {
          teacherOutput: "Test output",
          citations: ["valid.md", "", "  ", null, "another.md"],
        },
      });

      mockExecFileAsync.mockResolvedValue({ stdout: mockStdout, stderr: "" });

      const result = await generateTeacherExample(mockSpec, [], mockOptions);

      expect(result.citations).toEqual(["valid.md", "another.md"]);
    });

    it("uses retrieval context IDs when citations are invalid", async () => {
      const mockStdout = JSON.stringify({
        structured_output: {
          teacherOutput: "Test output",
          citations: null,
        },
      });

      mockExecFileAsync.mockResolvedValue({ stdout: mockStdout, stderr: "" });

      const result = await generateTeacherExample(mockSpec, ["retrieval-001", "retrieval-002"], mockOptions);

      expect(result.citations).toEqual(["retrieval-001", "retrieval-002"]);
    });

    it("handles missing usage data with zero values", async () => {
      const mockStdout = JSON.stringify({
        result: "Test output",
      });

      mockExecFileAsync.mockResolvedValue({ stdout: mockStdout, stderr: "" });

      const result = await generateTeacherExample(mockSpec, [], mockOptions);

      expect(result.usage.inputTokens).toBe(0);
      expect(result.usage.outputTokens).toBe(0);
      expect(result.usage.cacheReadInputTokens).toBe(0);
      expect(result.usage.cacheCreationInputTokens).toBe(0);
      expect(result.usage.totalTokens).toBe(0);
      expect(result.usage.costUsd).toBe(0);
    });

    it("unwraps JSON-wrapped teacher output from result field", async () => {
      const mockStdout = JSON.stringify({
        result: "```json\n{\"teacherOutput\": \"Wrapped output\"}\n```",
      });

      mockExecFileAsync.mockResolvedValue({ stdout: mockStdout, stderr: "" });

      const result = await generateTeacherExample(mockSpec, [], mockOptions);

      expect(result.teacherOutput).toBe("Wrapped output");
    });

    it("fallback output includes spec intent and required checks", async () => {
      mockExecFileAsync.mockRejectedValue(new Error("Something bad happened"));

      const result = await generateTeacherExample(mockSpec, [], mockOptions);

      expect(result.teacherOutput).toContain(mockSpec.intent);
      expect(result.teacherOutput).toContain("unit_test");
      expect(result.teacherOutput).toContain("integration_test");
    });

    it("handles ETIMEDOUT error code", async () => {
      const error = Object.assign(new Error("Timeout"), { code: "ETIMEDOUT" });
      mockExecFileAsync.mockRejectedValue(error);

      const result = await generateTeacherExample(mockSpec, [], mockOptions);

      expect(result.errorClass).toBe("timeout");
    });

    it("handles exit code 143 as timeout", async () => {
      const error = Object.assign(new Error("Process terminated"), { code: 143 });
      mockExecFileAsync.mockRejectedValue(error);

      const result = await generateTeacherExample(mockSpec, [], mockOptions);

      expect(result.errorClass).toBe("timeout");
    });
  });
});

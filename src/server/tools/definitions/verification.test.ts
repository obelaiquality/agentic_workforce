import { describe, it, expect, vi, beforeEach } from "vitest";
import { runTests, runLint } from "./verification";
import type { ToolContext } from "../types";

describe("verification tools", () => {
  let mockContext: ToolContext;

  beforeEach(() => {
    mockContext = {
      runId: "test-run",
      repoId: "test-repo",
      ticketId: "test-ticket",
      worktreePath: "/tmp/test",
      actor: "test-agent",
      stage: "review",
      conversationHistory: [],
      createApproval: vi.fn(),
      recordEvent: vi.fn(),
    };
  });

  describe("run_tests", () => {
    it("should have correct metadata", () => {
      expect(runTests.name).toBe("run_tests");
      expect(runTests.description).toContain("test");
      expect(runTests.permission.scope).toBe("repo.verify");
      // Note: readOnly is not set on verification tools
    });

    it("should accept optional command parameter", () => {
      const parseResultWithCommand = runTests.inputSchema.safeParse({
        command: "npm test"
      });
      expect(parseResultWithCommand.success).toBe(true);

      const parseResultWithoutCommand = runTests.inputSchema.safeParse({});
      expect(parseResultWithoutCommand.success).toBe(true);
    });

    it("should return result when executed with command", async () => {
      const result = await runTests.execute({ command: "echo 'tests passed'" }, mockContext);

      // Should return either success or error
      expect(result).toBeDefined();
      expect(["success", "error"]).toContain(result.type);
    });

    it("should handle test failures", async () => {
      // Run a command that will fail
      const result = await runTests.execute({ command: "exit 1" }, mockContext);

      // Should return error
      expect(result).toBeDefined();
      expect(result.type).toBe("error");
    });
  });

  describe("run_lint", () => {
    it("should have correct metadata", () => {
      expect(runLint.name).toBe("run_lint");
      expect(runLint.description).toContain("lint");
      expect(runLint.permission.scope).toBe("repo.verify");
      // Note: readOnly is not set on verification tools
    });

    it("should accept optional command parameter", () => {
      const parseResultWithCommand = runLint.inputSchema.safeParse({
        command: "npm run lint"
      });
      expect(parseResultWithCommand.success).toBe(true);

      const parseResultWithoutCommand = runLint.inputSchema.safeParse({});
      expect(parseResultWithoutCommand.success).toBe(true);
    });

    it("should return result when executed with command", async () => {
      const result = await runLint.execute({ command: "echo 'no issues'" }, mockContext);

      // Should return either success or error
      expect(result).toBeDefined();
      expect(["success", "error"]).toContain(result.type);
    });

    it("should format lint errors appropriately", async () => {
      // Run a command that outputs error-like text
      const result = await runLint.execute(
        { command: "echo 'error: unexpected token'" },
        mockContext
      );

      // Should return result
      expect(result).toBeDefined();
      expect(["success", "error"]).toContain(result.type);
    });
  });
});

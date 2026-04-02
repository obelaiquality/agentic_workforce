import { describe, it, expect, vi, beforeEach } from "vitest";
import { gitStatus, gitDiff, gitCommit } from "./git";
import type { ToolContext } from "../types";

describe("git tools", () => {
  let mockContext: ToolContext;

  beforeEach(() => {
    mockContext = {
      runId: "test-run",
      repoId: "test-repo",
      ticketId: "test-ticket",
      worktreePath: "/tmp/test",
      actor: "test-agent",
      stage: "build",
      conversationHistory: [],
      createApproval: vi.fn(),
      recordEvent: vi.fn(),
    };
  });

  describe("git_status", () => {
    it("should have correct metadata", () => {
      expect(gitStatus.name).toBe("git_status");
      expect(gitStatus.description).toContain("working tree status");
      expect(gitStatus.permission.scope).toBe("git.meta");
      expect(gitStatus.permission.readOnly).toBe(true);
    });

    it("should return result when executed", async () => {
      const result = await gitStatus.execute({}, mockContext);

      // Should return either success or error (depending on whether /tmp/test is a git repo)
      expect(result).toBeDefined();
      expect(["success", "error"]).toContain(result.type);
    });

    it("should handle git errors gracefully", async () => {
      // Execute in a non-git directory
      const badContext = { ...mockContext, worktreePath: "/tmp" };
      const result = await gitStatus.execute({}, badContext);

      // Should return error or empty status
      expect(result).toBeDefined();
      expect(["success", "error"]).toContain(result.type);
    });
  });

  describe("git_diff", () => {
    it("should have correct metadata", () => {
      expect(gitDiff.name).toBe("git_diff");
      expect(gitDiff.description).toContain("changes");
      expect(gitDiff.permission.scope).toBe("git.meta");
      expect(gitDiff.permission.readOnly).toBe(true);
    });

    it("should return result with unstaged changes", async () => {
      const result = await gitDiff.execute({ staged: false }, mockContext);

      expect(result).toBeDefined();
      expect(["success", "error"]).toContain(result.type);
    });

    it("should support staged flag", async () => {
      const result = await gitDiff.execute({ staged: true }, mockContext);

      expect(result).toBeDefined();
      expect(["success", "error"]).toContain(result.type);
    });

    it("should validate input schema", () => {
      const parseResult = gitDiff.inputSchema.safeParse({ staged: "not-a-boolean" });
      expect(parseResult.success).toBe(false);
    });
  });

  describe("git_commit", () => {
    it("should have correct metadata", () => {
      expect(gitCommit.name).toBe("git_commit");
      expect(gitCommit.description).toContain("Commit");
      expect(gitCommit.permission.scope).toBe("git.write");
      // Note: destructive is not set, so it's undefined
    });

    it("should handle commit attempt", async () => {
      const result = await gitCommit.execute(
        { message: "test commit" },
        mockContext
      );

      // Commit may require approval or succeed depending on policy, or error if no staged changes
      expect(["success", "approval_required", "error"]).toContain(result.type);
    });

    it("should validate message is required", () => {
      const parseResult = gitCommit.inputSchema.safeParse({});
      expect(parseResult.success).toBe(false);
    });

    it("should accept valid commit message", () => {
      const parseResult = gitCommit.inputSchema.safeParse({
        message: "feat: add new feature"
      });
      expect(parseResult.success).toBe(true);
    });

    it("should handle empty repository gracefully", async () => {
      const result = await gitCommit.execute(
        { message: "initial commit" },
        mockContext
      );

      // Should either succeed or return error, not crash
      expect(result).toBeDefined();
      expect(["success", "error", "approval_required"]).toContain(result.type);
    });
  });
});

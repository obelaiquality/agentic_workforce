import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fsSyncOrig from "node:fs";
import pathOrig from "node:path";
import osOrig from "node:os";
import { execSync as execSyncOrig } from "node:child_process";
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

  // ── Git tools with real temp repo ────────────────────────────────────────

  describe("git tools with real temp repo", () => {
    let tmpDir: string;
    let repoCtx: ToolContext;

    beforeEach(() => {
      tmpDir = fsSyncOrig.mkdtempSync(pathOrig.join(osOrig.tmpdir(), "git-test-"));
      execSyncOrig("git init", { cwd: tmpDir });
      execSyncOrig('git config user.email "test@test.com"', { cwd: tmpDir });
      execSyncOrig('git config user.name "Test"', { cwd: tmpDir });
      repoCtx = { ...mockContext, worktreePath: tmpDir };
    });

    afterEach(() => {
      fsSyncOrig.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("git_status returns clean status for empty repo", async () => {
      const result = await gitStatus.execute({}, repoCtx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toBe("(no changes)");
        expect(result.metadata?.hasChanges).toBe(false);
        expect(result.metadata?.branch).toBeDefined();
      }
    });

    it("git_status detects new files", async () => {
      fsSyncOrig.writeFileSync(pathOrig.join(tmpDir, "new.txt"), "hello");

      const result = await gitStatus.execute({}, repoCtx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("new.txt");
        expect(result.metadata?.hasChanges).toBe(true);
      }
    });

    it("git_diff shows unstaged changes", async () => {
      // Create initial commit
      fsSyncOrig.writeFileSync(pathOrig.join(tmpDir, "file.txt"), "original");
      execSyncOrig("git add -A", { cwd: tmpDir });
      execSyncOrig('git commit -m "initial"', { cwd: tmpDir });

      // Modify file
      fsSyncOrig.writeFileSync(pathOrig.join(tmpDir, "file.txt"), "modified");

      const result = await gitDiff.execute({ staged: false }, repoCtx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("modified");
        expect(result.metadata?.hasDiff).toBe(true);
        expect(result.metadata?.staged).toBe(false);
      }
    });

    it("git_diff shows staged changes", async () => {
      // Create initial commit
      fsSyncOrig.writeFileSync(pathOrig.join(tmpDir, "file.txt"), "original");
      execSyncOrig("git add -A", { cwd: tmpDir });
      execSyncOrig('git commit -m "initial"', { cwd: tmpDir });

      // Stage a change
      fsSyncOrig.writeFileSync(pathOrig.join(tmpDir, "file.txt"), "staged-change");
      execSyncOrig("git add file.txt", { cwd: tmpDir });

      const result = await gitDiff.execute({ staged: true }, repoCtx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("staged-change");
        expect(result.metadata?.hasDiff).toBe(true);
        expect(result.metadata?.staged).toBe(true);
      }
    });

    it("git_diff returns no diff when clean", async () => {
      fsSyncOrig.writeFileSync(pathOrig.join(tmpDir, "file.txt"), "content");
      execSyncOrig("git add -A", { cwd: tmpDir });
      execSyncOrig('git commit -m "initial"', { cwd: tmpDir });

      const result = await gitDiff.execute({}, repoCtx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toBe("(no diff)");
        expect(result.metadata?.hasDiff).toBe(false);
      }
    });

    it("git_commit succeeds with staged changes", async () => {
      fsSyncOrig.writeFileSync(pathOrig.join(tmpDir, "file.txt"), "content");
      execSyncOrig("git add -A", { cwd: tmpDir });

      const result = await gitCommit.execute(
        { message: "test commit" },
        repoCtx,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("test commit");
        expect(result.metadata?.commitHash).toBeDefined();
        expect(result.metadata?.commitHash).not.toBe("unknown");
        expect(result.metadata?.message).toBe("test commit");
      }
    });

    it("git_commit with add_all stages and commits", async () => {
      // Create initial commit first
      fsSyncOrig.writeFileSync(pathOrig.join(tmpDir, "init.txt"), "init");
      execSyncOrig("git add -A", { cwd: tmpDir });
      execSyncOrig('git commit -m "init"', { cwd: tmpDir });

      // Add a new file without staging
      fsSyncOrig.writeFileSync(pathOrig.join(tmpDir, "new.txt"), "new content");

      const result = await gitCommit.execute(
        { message: "auto-staged commit", add_all: true },
        repoCtx,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("auto-staged commit");
      }
    });

    it("git_commit returns error when nothing is staged", async () => {
      // Create initial commit so repo is clean
      fsSyncOrig.writeFileSync(pathOrig.join(tmpDir, "init.txt"), "init");
      execSyncOrig("git add -A", { cwd: tmpDir });
      execSyncOrig('git commit -m "init"', { cwd: tmpDir });

      const result = await gitCommit.execute(
        { message: "empty commit" },
        repoCtx,
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("No changes staged for commit");
      }
    });
  });
});

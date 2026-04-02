import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ToolContext } from "../types";
import { bash } from "./bash";

// Helper to create a minimal ToolContext with custom worktreePath
function createMockContext(worktreePath: string): ToolContext {
  return {
    runId: "test-run",
    repoId: "test-repo",
    ticketId: "test-ticket",
    worktreePath,
    actor: "test-actor",
    stage: "build",
    conversationHistory: [],
    createApproval: async () => ({ id: "approval-1" }),
    recordEvent: async () => {},
  };
}

describe("bash tool", () => {
  let tmpDir: string;
  let ctx: ToolContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bash-test-"));
    ctx = createMockContext(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Successful execution ────────────────────────────────────────────────────

  it("executes simple command successfully", async () => {
    const result = await bash.execute({ command: "echo hello" }, ctx);

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.content.trim()).toBe("hello");
      expect(result.metadata?.exitCode).toBe(0);
      expect(result.metadata?.command).toBe("echo hello");
    }
  });

  it("captures stdout from command", async () => {
    const result = await bash.execute({ command: "printf 'test output'" }, ctx);

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.content).toBe("test output");
    }
  });

  it("executes command in worktree by default", async () => {
    // Create a test file in tmpDir
    fs.writeFileSync(path.join(tmpDir, "test.txt"), "content");

    const result = await bash.execute({ command: "cat test.txt" }, ctx);

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.content.trim()).toBe("content");
    }
  });

  // ── cwd parameter ───────────────────────────────────────────────────────────

  it("respects cwd parameter (relative path)", async () => {
    // Create nested directory structure
    const subdir = path.join(tmpDir, "subdir");
    fs.mkdirSync(subdir);
    fs.writeFileSync(path.join(subdir, "file.txt"), "nested");

    const result = await bash.execute({ command: "cat file.txt", cwd: "subdir" }, ctx);

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.content.trim()).toBe("nested");
    }
  });

  it("respects cwd parameter (absolute path)", async () => {
    const subdir = path.join(tmpDir, "subdir");
    fs.mkdirSync(subdir);
    fs.writeFileSync(path.join(subdir, "file.txt"), "absolute");

    const result = await bash.execute({ command: "cat file.txt", cwd: subdir }, ctx);

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.content.trim()).toBe("absolute");
    }
  });

  // ── Exit code handling ──────────────────────────────────────────────────────

  it("returns error for non-zero exit code", async () => {
    const result = await bash.execute({ command: "exit 1" }, ctx);

    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.error).toContain("exit code 1");
      expect(result.metadata?.exitCode).toBe(1);
    }
  });

  it("captures stderr on failure", async () => {
    const result = await bash.execute({ command: "cat nonexistent-file.txt 2>&1" }, ctx);

    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.error).toContain("exit code");
    }
  });

  // ── Timeout enforcement ─────────────────────────────────────────────────────

  it("respects timeout parameter", async () => {
    const result = await bash.execute({ command: "sleep 10", timeout: 1000 }, ctx);

    expect(result.type).toBe("error");
    if (result.type === "error") {
      // Timeout can result in different error messages depending on how execSync handles it
      expect(result.error).toMatch(/execution failed|Command failed|SIGTERM/i);
    }
  }, 5000); // Test timeout of 5 seconds to ensure it completes

  // ── Dangerous command detection ─────────────────────────────────────────────

  it("detects rm -rf / as dangerous", () => {
    const checkApproval = bash.permission.checkApproval;
    if (checkApproval) {
      expect(checkApproval({ command: "rm -rf /" }, ctx)).toBe(true);
      expect(checkApproval({ command: "rm -rf / " }, ctx)).toBe(true);
    }
  });

  it("detects git push --force origin main as dangerous", () => {
    const checkApproval = bash.permission.checkApproval;
    if (checkApproval) {
      expect(checkApproval({ command: "git push --force origin main" }, ctx)).toBe(true);
      expect(checkApproval({ command: "git push origin main --force" }, ctx)).toBe(true);
    }
  });

  it("detects git reset --hard as dangerous", () => {
    const checkApproval = bash.permission.checkApproval;
    if (checkApproval) {
      expect(checkApproval({ command: "git reset --hard HEAD~1" }, ctx)).toBe(true);
    }
  });

  it("detects git clean -fd as dangerous", () => {
    const checkApproval = bash.permission.checkApproval;
    if (checkApproval) {
      expect(checkApproval({ command: "git clean -fd" }, ctx)).toBe(true);
    }
  });

  it("detects deleting main/master branch as dangerous", () => {
    const checkApproval = bash.permission.checkApproval;
    if (checkApproval) {
      expect(checkApproval({ command: "git branch -D main" }, ctx)).toBe(true);
      expect(checkApproval({ command: "git branch -D master" }, ctx)).toBe(true);
    }
  });

  it("detects dd command as dangerous", () => {
    const checkApproval = bash.permission.checkApproval;
    if (checkApproval) {
      expect(checkApproval({ command: "dd if=/dev/zero of=/dev/sda" }, ctx)).toBe(true);
    }
  });

  it("detects writing to /etc as dangerous", () => {
    const checkApproval = bash.permission.checkApproval;
    if (checkApproval) {
      expect(checkApproval({ command: "echo malicious > /etc/passwd" }, ctx)).toBe(true);
    }
  });

  it("does not flag safe commands as dangerous", () => {
    const checkApproval = bash.permission.checkApproval;
    if (checkApproval) {
      expect(checkApproval({ command: "ls -la" }, ctx)).toBe(false);
      expect(checkApproval({ command: "git status" }, ctx)).toBe(false);
      expect(checkApproval({ command: "npm install" }, ctx)).toBe(false);
      expect(checkApproval({ command: "echo 'hello world'" }, ctx)).toBe(false);
    }
  });
});

import { describe, it, expect } from "vitest";
import { validatePath } from "./pathValidation";
import path from "node:path";
import os from "node:os";

describe("validatePath", () => {
  const worktree = "/tmp/test-worktree";

  // ── Valid paths ───────────────────────────────────────────────────────────

  it("should accept relative path within worktree", () => {
    const result = validatePath(worktree, "src/index.ts", "read");
    expect(result.error).toBeUndefined();
    expect(result.fullPath).toBe(path.normalize(path.join(worktree, "src/index.ts")));
  });

  it("should accept absolute path within worktree", () => {
    const absPath = path.join(worktree, "src/file.ts");
    const result = validatePath(worktree, absPath, "read");
    expect(result.error).toBeUndefined();
    expect(result.fullPath).toBe(path.normalize(absPath));
  });

  it("should accept worktree root itself", () => {
    const result = validatePath(worktree, worktree, "read");
    expect(result.error).toBeUndefined();
    expect(result.fullPath).toBe(path.normalize(worktree));
  });

  // ── Empty paths ───────────────────────────────────────────────────────────

  it("should reject empty path", () => {
    const result = validatePath(worktree, "", "read");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("empty");
  });

  it("should reject whitespace-only path", () => {
    const result = validatePath(worktree, "   ", "read");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("empty");
  });

  // ── Shell expansion blocking ──────────────────────────────────────────────

  it("should reject path with $ shell variable", () => {
    const result = validatePath(worktree, "$HOME/file.txt", "read");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("shell expansion");
  });

  it("should reject path with backtick", () => {
    const result = validatePath(worktree, "`whoami`/file.txt", "read");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("shell expansion");
  });

  it("should reject path with % expansion", () => {
    const result = validatePath(worktree, "%PATH%/file.txt", "read");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("shell expansion");
  });

  // ── UNC paths ─────────────────────────────────────────────────────────────

  it("should reject UNC path with backslashes", () => {
    const result = validatePath(worktree, "\\\\server\\share", "read");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("UNC");
  });

  it("should reject UNC path with forward slashes", () => {
    const result = validatePath(worktree, "//server/share", "read");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("UNC");
  });

  // ── Tilde variants ────────────────────────────────────────────────────────

  it("should reject ~user path", () => {
    const result = validatePath(worktree, "~admin/file.txt", "read");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("tilde");
  });

  it("should reject ~+ path", () => {
    const result = validatePath(worktree, "~+/file.txt", "read");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("tilde");
  });

  it("should reject ~- path", () => {
    const result = validatePath(worktree, "~-/file.txt", "read");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("tilde");
  });

  // ── Path traversal ────────────────────────────────────────────────────────

  it("should reject ../../etc/passwd", () => {
    const result = validatePath(worktree, "../../etc/passwd", "read");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("traversal");
  });

  it("should reject absolute path outside worktree", () => {
    const result = validatePath(worktree, "/etc/passwd", "read");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("traversal");
  });

  // ── Write-specific checks ─────────────────────────────────────────────────

  it("should reject writing to dangerous system path", () => {
    // "/" is dangerous for write operations — checked by checkDangerousPath
    const result = validatePath("/", "/", "write");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("dangerous");
  });

  it("should reject glob patterns in write path", () => {
    // A path containing glob chars within the worktree should be blocked for writes
    const result = validatePath(worktree, "*.ts", "write");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Glob");
  });

  // ── Read vs write distinction ─────────────────────────────────────────────

  it("should allow reading a relative path that contains glob chars", () => {
    // Glob chars in read paths are fine — only blocked for write/delete
    const result = validatePath(worktree, "src/*.ts", "read");
    expect(result.error).toBeUndefined();
    expect(result.fullPath).toBe(path.normalize(path.join(worktree, "src/*.ts")));
  });

  it("should default operation to read when not specified", () => {
    const result = validatePath(worktree, "src/file.ts");
    expect(result.error).toBeUndefined();
    expect(result.fullPath).toBe(path.normalize(path.join(worktree, "src/file.ts")));
  });

  // ── Nested traversal ──────────────────────────────────────────────────────

  it("should reject a deeply nested traversal attempt", () => {
    const result = validatePath(worktree, "a/b/../../../../etc/shadow", "read");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("traversal");
  });
});

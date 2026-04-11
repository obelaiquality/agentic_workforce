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

  // ── Symlink resolution ─────────────────────────────────────────────────────

  it("should allow a valid path that exists on disk within worktree", () => {
    // Use the actual temp directory which exists
    const tmpWorktree = os.tmpdir();
    const result = validatePath(tmpWorktree, ".", "read");
    expect(result.error).toBeUndefined();
  });

  // ── Dangerous path blocking for write/delete ──────────────────────────────

  it("should reject deleting dangerous system path /usr", () => {
    const result = validatePath("/usr", "/usr", "delete");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("dangerous");
  });

  it("should reject writing to /etc", () => {
    const result = validatePath("/etc", "/etc", "write");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("dangerous");
  });

  it("should reject writing to /var", () => {
    const result = validatePath("/var", "/var", "write");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("dangerous");
  });

  it("should reject writing to /tmp root", () => {
    const result = validatePath("/tmp", "/tmp", "write");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("dangerous");
  });

  it("should reject writing to home directory root", () => {
    const home = os.homedir();
    const result = validatePath(home, home, "write");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("dangerous");
  });

  it("should reject writing to .bashrc in home directory", () => {
    const home = os.homedir();
    const bashrc = path.join(home, ".bashrc");
    const result = validatePath(home, bashrc, "write");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("sensitive dotfile");
  });

  it("should reject writing to .zshrc in home directory", () => {
    const home = os.homedir();
    const zshrc = path.join(home, ".zshrc");
    const result = validatePath(home, zshrc, "write");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("sensitive dotfile");
  });

  it("should reject writing to .ssh directory in home", () => {
    const home = os.homedir();
    const sshDir = path.join(home, ".ssh");
    const result = validatePath(home, sshDir, "write");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("sensitive dotfile");
  });

  it("should reject writing to .ssh/id_rsa in home", () => {
    const home = os.homedir();
    const sshKey = path.join(home, ".ssh/id_rsa");
    const result = validatePath(home, sshKey, "write");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("sensitive dotfile");
  });

  it("should reject writing to .profile in home directory", () => {
    const home = os.homedir();
    const profile = path.join(home, ".profile");
    const result = validatePath(home, profile, "write");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("sensitive dotfile");
  });

  it("should reject writing to .bash_profile in home directory", () => {
    const home = os.homedir();
    const bashProfile = path.join(home, ".bash_profile");
    const result = validatePath(home, bashProfile, "write");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("sensitive dotfile");
  });

  it("should reject glob patterns [brackets] in delete paths", () => {
    const result = validatePath(worktree, "src/[test].ts", "delete");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Glob");
  });

  it("should reject glob patterns with ? in write paths", () => {
    const result = validatePath(worktree, "src/file?.ts", "write");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Glob");
  });

  it("should allow read operations against dangerous paths within their own worktree", () => {
    // Reading from within a worktree that happens to be a system directory
    // is still allowed because the dangerous path check only applies to write/delete
    const home = os.homedir();
    const filePath = path.join(home, "somefile.txt");
    const result = validatePath(home, filePath, "read");
    expect(result.error).toBeUndefined();
  });

  it("should reject writing to path with trailing separator matching dangerous path", () => {
    const result = validatePath("/", "/" + path.sep, "write");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("dangerous");
  });

  // ── Tilde edge cases ──────────────────────────────────────────────────────

  it("should allow bare ~ path (not treated as dangerous tilde)", () => {
    // Bare ~ is allowed through tilde check but will fail boundary check
    const result = validatePath(worktree, "~", "read");
    // ~ resolves to worktree/~ which is fine for tilde check
    // but the boundary check may or may not fail depending on resolution
    expect(result.error === undefined || result.error?.includes("traversal")).toBe(true);
  });

  it("should allow ~/path (not treated as dangerous tilde)", () => {
    const result = validatePath(worktree, "~/file.txt", "read");
    // ~/file.txt is allowed through tilde check but may fail boundary
    expect(result.error === undefined || result.error?.includes("traversal")).toBe(true);
  });

  // ── macOS-specific paths ──────────────────────────────────────────────────

  it("should reject writing to /Applications on macOS", () => {
    if (process.platform === "darwin") {
      const result = validatePath("/Applications", "/Applications", "write");
      expect(result.error).toBeDefined();
      expect(result.error).toContain("dangerous");
    }
  });

  it("should reject writing to /Users on macOS", () => {
    if (process.platform === "darwin") {
      const result = validatePath("/Users", "/Users", "write");
      expect(result.error).toBeDefined();
      expect(result.error).toContain("dangerous");
    }
  });
});

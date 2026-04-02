import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ToolContext } from "../types";
import { readFile, editFile, writeFile, listFiles, grepSearch, globSearch } from "./fileOps";

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

describe("fileOps tools", () => {
  let tmpDir: string;
  let ctx: ToolContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fileops-test-"));
    ctx = createMockContext(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── read_file ───────────────────────────────────────────────────────────────

  describe("read_file", () => {
    it("reads file with line numbers", async () => {
      const content = "line 1\nline 2\nline 3";
      const filePath = path.join(tmpDir, "test.txt");
      fs.writeFileSync(filePath, content);

      const result = await readFile.execute({ path: "test.txt" }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("    1\tline 1");
        expect(result.content).toContain("    2\tline 2");
        expect(result.content).toContain("    3\tline 3");
        expect(result.metadata?.totalLines).toBe(3);
        expect(result.metadata?.displayedLines).toBe(3);
        expect(result.metadata?.truncated).toBe(false);
      }
    });

    it("applies offset parameter", async () => {
      const content = "line 1\nline 2\nline 3\nline 4";
      const filePath = path.join(tmpDir, "test.txt");
      fs.writeFileSync(filePath, content);

      const result = await readFile.execute({ path: "test.txt", offset: 2 }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("    3\tline 3");
        expect(result.content).toContain("    4\tline 4");
        expect(result.content).not.toContain("line 1");
        expect(result.metadata?.displayedLines).toBe(2);
      }
    });

    it("applies limit parameter", async () => {
      const content = "line 1\nline 2\nline 3\nline 4";
      const filePath = path.join(tmpDir, "test.txt");
      fs.writeFileSync(filePath, content);

      const result = await readFile.execute({ path: "test.txt", limit: 2 }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("line 1");
        expect(result.content).toContain("line 2");
        expect(result.content).not.toContain("line 3");
        expect(result.metadata?.displayedLines).toBe(2);
        expect(result.metadata?.truncated).toBe(true);
      }
    });

    it("returns error for non-existent file", async () => {
      const result = await readFile.execute({ path: "nonexistent.txt" }, ctx);
      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("Failed to read file");
      }
    });

    it("blocks path traversal attack", async () => {
      const result = await readFile.execute({ path: "../../etc/passwd" }, ctx);
      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("Path traversal");
      }
    });

    it("handles absolute paths within worktree", async () => {
      const content = "test content";
      const filePath = path.join(tmpDir, "test.txt");
      fs.writeFileSync(filePath, content);

      const result = await readFile.execute({ path: filePath }, ctx);
      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("test content");
      }
    });
  });

  // ── edit_file ───────────────────────────────────────────────────────────────

  describe("edit_file", () => {
    it("performs exact match replacement", async () => {
      const content = "Hello world\nGoodbye world";
      const filePath = path.join(tmpDir, "test.txt");
      fs.writeFileSync(filePath, content);

      const result = await editFile.execute(
        {
          file_path: "test.txt",
          old_string: "Hello world",
          new_string: "Hi world",
        },
        ctx
      );

      expect(result.type).toBe("success");
      const updated = fs.readFileSync(filePath, "utf-8");
      expect(updated).toBe("Hi world\nGoodbye world");
    });

    it("performs replace_all", async () => {
      const content = "foo bar foo baz foo";
      const filePath = path.join(tmpDir, "test.txt");
      fs.writeFileSync(filePath, content);

      const result = await editFile.execute(
        {
          file_path: "test.txt",
          old_string: "foo",
          new_string: "qux",
          replace_all: true,
        },
        ctx
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.metadata?.occurrences).toBe(3);
      }
      const updated = fs.readFileSync(filePath, "utf-8");
      expect(updated).toBe("qux bar qux baz qux");
    });

    it("rejects identical old_string and new_string", async () => {
      const result = await editFile.execute(
        {
          file_path: "test.txt",
          old_string: "same",
          new_string: "same",
        },
        ctx
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("must be different");
      }
    });

    it("returns error when string not found (replace_all)", async () => {
      const content = "Hello world";
      const filePath = path.join(tmpDir, "test.txt");
      fs.writeFileSync(filePath, content);

      const result = await editFile.execute(
        {
          file_path: "test.txt",
          old_string: "nonexistent",
          new_string: "replacement",
          replace_all: true,
        },
        ctx
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("String not found");
      }
    });

    it("blocks path traversal attack", async () => {
      const result = await editFile.execute(
        {
          file_path: "../../etc/passwd",
          old_string: "old",
          new_string: "new",
        },
        ctx
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("Path traversal");
      }
    });
  });

  // ── write_file ──────────────────────────────────────────────────────────────

  describe("write_file", () => {
    it("creates new file", async () => {
      const result = await writeFile.execute(
        {
          file_path: "new.txt",
          content: "Hello world",
        },
        ctx
      );

      expect(result.type).toBe("success");
      const filePath = path.join(tmpDir, "new.txt");
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, "utf-8")).toBe("Hello world");
    });

    it("creates parent directories", async () => {
      const result = await writeFile.execute(
        {
          file_path: "nested/deep/file.txt",
          content: "test",
        },
        ctx
      );

      expect(result.type).toBe("success");
      const filePath = path.join(tmpDir, "nested/deep/file.txt");
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, "utf-8")).toBe("test");
    });

    it("overwrites existing file", async () => {
      const filePath = path.join(tmpDir, "existing.txt");
      fs.writeFileSync(filePath, "old content");

      const result = await writeFile.execute(
        {
          file_path: "existing.txt",
          content: "new content",
        },
        ctx
      );

      expect(result.type).toBe("success");
      expect(fs.readFileSync(filePath, "utf-8")).toBe("new content");
    });

    it("blocks path traversal attack", async () => {
      const result = await writeFile.execute(
        {
          file_path: "../../tmp/evil.txt",
          content: "malicious",
        },
        ctx
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("Path traversal");
      }
    });

    it("returns metadata with size and line count", async () => {
      const result = await writeFile.execute(
        {
          file_path: "test.txt",
          content: "line1\nline2\nline3",
        },
        ctx
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.metadata?.bytes).toBeGreaterThan(0);
        expect(result.metadata?.lines).toBe(3);
      }
    });
  });

  // ── list_files ──────────────────────────────────────────────────────────────

  describe("list_files", () => {
    beforeEach(() => {
      // Create test file structure
      fs.mkdirSync(path.join(tmpDir, "src"));
      fs.mkdirSync(path.join(tmpDir, "tests"));
      fs.mkdirSync(path.join(tmpDir, "node_modules")); // Should be skipped
      fs.writeFileSync(path.join(tmpDir, "src/index.ts"), "");
      fs.writeFileSync(path.join(tmpDir, "src/utils.ts"), "");
      fs.writeFileSync(path.join(tmpDir, "tests/test.ts"), "");
      fs.writeFileSync(path.join(tmpDir, "README.md"), "");
      fs.writeFileSync(path.join(tmpDir, "node_modules/lib.js"), ""); // Should be skipped
    });

    it("lists all files recursively", async () => {
      const result = await listFiles.execute({}, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        const files = result.content.split("\n").filter((f) => f.length > 0);
        expect(files).toContain("README.md");
        expect(files).toContain("src/index.ts");
        expect(files).toContain("src/utils.ts");
        expect(files).toContain("tests/test.ts");
        expect(files).not.toContain("node_modules/lib.js");
        expect(result.metadata?.totalFiles).toBeGreaterThan(0);
      }
    });

    it("filters by glob pattern", async () => {
      const result = await listFiles.execute({ pattern: "**/*.ts" }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        const files = result.content.split("\n").filter((f) => f.length > 0);
        expect(files).toContain("src/index.ts");
        expect(files).toContain("src/utils.ts");
        expect(files).toContain("tests/test.ts");
        expect(files).not.toContain("README.md");
      }
    });

    it("skips .git, node_modules, .agentic-workforce", async () => {
      fs.mkdirSync(path.join(tmpDir, ".git"));
      fs.writeFileSync(path.join(tmpDir, ".git/config"), "");

      const result = await listFiles.execute({}, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).not.toContain(".git/config");
      }
    });

    it("blocks path traversal attack", async () => {
      const result = await listFiles.execute({ path: "../../etc" }, ctx);

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("Path traversal");
      }
    });
  });

  // ── grep_search ─────────────────────────────────────────────────────────────

  describe("grep_search", () => {
    beforeEach(() => {
      fs.mkdirSync(path.join(tmpDir, "src"));
      fs.writeFileSync(path.join(tmpDir, "src/index.ts"), "function hello() {\n  return 'world';\n}");
      fs.writeFileSync(path.join(tmpDir, "src/utils.ts"), "export const foo = 'bar';");
      fs.writeFileSync(path.join(tmpDir, "README.md"), "# Documentation\nhello world");
    });

    it("searches for pattern and returns matches", async () => {
      const result = await grepSearch.execute({ pattern: "hello" }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("hello");
        expect(result.metadata?.totalMatches).toBeGreaterThan(0);
      }
    });

    it("filters by glob pattern", async () => {
      const result = await grepSearch.execute({ pattern: "hello", glob: "*.ts" }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("index.ts");
        expect(result.content).not.toContain("README.md");
      }
    });

    it("respects max_results limit", async () => {
      // Create many matching files
      for (let i = 0; i < 100; i++) {
        fs.writeFileSync(path.join(tmpDir, `file${i}.txt`), "match match match");
      }

      const result = await grepSearch.execute({ pattern: "match", max_results: 10 }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        const lines = result.content.split("\n").filter((l) => l.length > 0);
        expect(lines.length).toBeLessThanOrEqual(10);
        expect(result.metadata?.truncated).toBe(true);
      }
    });

    it("returns empty result when no matches (exit code 1)", async () => {
      const result = await grepSearch.execute({ pattern: "nonexistent_pattern_xyz" }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toBe("");
        expect(result.metadata?.totalMatches).toBe(0);
      }
    });

    it("blocks path traversal attack", async () => {
      const result = await grepSearch.execute({ pattern: "test", path: "../../etc" }, ctx);

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("Path traversal");
      }
    });
  });

  // ── glob_search ─────────────────────────────────────────────────────────────

  describe("glob_search", () => {
    beforeEach(() => {
      fs.mkdirSync(path.join(tmpDir, "src"));
      fs.mkdirSync(path.join(tmpDir, "tests"));
      fs.writeFileSync(path.join(tmpDir, "src/index.ts"), "");
      fs.writeFileSync(path.join(tmpDir, "src/utils.ts"), "");
      fs.writeFileSync(path.join(tmpDir, "tests/test.spec.ts"), "");
      fs.writeFileSync(path.join(tmpDir, "README.md"), "");
    });

    it("finds files matching glob pattern", async () => {
      const result = await globSearch.execute({ pattern: "**/*.ts" }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        const files = result.content.split("\n").filter((f) => f.length > 0);
        expect(files).toContain("src/index.ts");
        expect(files).toContain("src/utils.ts");
        expect(files).toContain("tests/test.spec.ts");
        expect(files).not.toContain("README.md");
      }
    });

    it("finds files with specific extension", async () => {
      const result = await globSearch.execute({ pattern: "*.md" }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        const files = result.content.split("\n").filter((f) => f.length > 0);
        expect(files).toContain("README.md");
        expect(files.length).toBe(1);
      }
    });

    it("finds files in specific directory", async () => {
      const result = await globSearch.execute({ pattern: "src/*.ts" }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        const files = result.content.split("\n").filter((f) => f.length > 0);
        expect(files).toContain("src/index.ts");
        expect(files).toContain("src/utils.ts");
        expect(files).not.toContain("tests/test.spec.ts");
      }
    });

    it("blocks path traversal attack", async () => {
      const result = await globSearch.execute({ pattern: "*.txt", path: "../../etc" }, ctx);

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("Path traversal");
      }
    });

    it("returns metadata with match count", async () => {
      const result = await globSearch.execute({ pattern: "**/*.ts" }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.metadata?.totalMatches).toBe(3);
        expect(result.metadata?.pattern).toBe("**/*.ts");
      }
    });
  });
});

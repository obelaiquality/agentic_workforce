import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ToolContext } from "../types";
import { readFile, editFile, writeFile, listFiles, grepSearch, globSearch, fuzzyFileSearch } from "./fileOps";

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
        expect(result.content).toBe("No matches found");
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

    it("applies pagination with offset", async () => {
      const result = await globSearch.execute({ pattern: "**/*.ts", offset: 1, head_limit: 1 }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        const files = result.content.split("\n").filter((f) => f.length > 0);
        expect(files.length).toBe(1);
        expect(result.metadata?.displayedMatches).toBe(1);
        expect(result.metadata?.totalMatches).toBe(3);
        expect(result.metadata?.truncated).toBe(true);
      }
    });

    it("returns 'No files found' for non-matching pattern", async () => {
      const result = await globSearch.execute({ pattern: "**/*.xyz" }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toBe("No files found");
        expect(result.metadata?.totalMatches).toBe(0);
      }
    });

    it("returns error for invalid path", async () => {
      const result = await globSearch.execute({ pattern: "*.txt", path: "../../etc" }, ctx);

      expect(result.type).toBe("error");
    });
  });

  // ── edit_file (additional coverage) ────────────────────────────────────────

  describe("edit_file (additional)", () => {
    it("returns error when matcher chain fails to find a match", async () => {
      const content = "const a = 1;\nconst b = 2;";
      const filePath = path.join(tmpDir, "nomatch.ts");
      fs.writeFileSync(filePath, content);

      const result = await editFile.execute(
        {
          file_path: "nomatch.ts",
          old_string: "completely unrelated text that does not exist anywhere in the file at all",
          new_string: "replacement",
        },
        ctx,
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("Could not find a match");
      }
    });

    it("returns error for replace_all with long old_string not found", async () => {
      const content = "Hello world";
      const filePath = path.join(tmpDir, "longmatch.txt");
      fs.writeFileSync(filePath, content);

      const longString = "x".repeat(200);
      const result = await editFile.execute(
        {
          file_path: "longmatch.txt",
          old_string: longString,
          new_string: "replacement",
          replace_all: true,
        },
        ctx,
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        // old_string gets truncated in error message at 100 chars
        expect(result.error).toContain("...");
        expect(result.error).toContain("String not found");
      }
    });

    it("handles file read error in edit gracefully", async () => {
      // Try editing a file that doesn't exist
      const result = await editFile.execute(
        {
          file_path: "nonexistent_edit_target.ts",
          old_string: "old",
          new_string: "new",
        },
        ctx,
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("Failed to edit file");
      }
    });
  });

  // ── write_file (additional coverage) ───────────────────────────────────────

  describe("write_file (additional)", () => {
    it("reports correct bytes in metadata", async () => {
      const content = "Hello, World!";
      const result = await writeFile.execute(
        { file_path: "bytes_test.txt", content },
        ctx,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain(`${Buffer.byteLength(content)} bytes`);
        expect(result.metadata?.bytes).toBe(Buffer.byteLength(content));
        expect(result.metadata?.lines).toBe(1);
      }
    });
  });

  // ── read_file (additional coverage) ────────────────────────────────────────

  describe("read_file (additional)", () => {
    it("applies both offset and limit together", async () => {
      const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
      const filePath = path.join(tmpDir, "range.txt");
      fs.writeFileSync(filePath, lines.join("\n"));

      const result = await readFile.execute({ path: "range.txt", offset: 3, limit: 2 }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("    4\tline 4");
        expect(result.content).toContain("    5\tline 5");
        expect(result.content).not.toContain("line 3");
        expect(result.content).not.toContain("line 6");
        expect(result.metadata?.displayedLines).toBe(2);
        expect(result.metadata?.truncated).toBe(true);
        expect(result.metadata?.totalLines).toBe(10);
      }
    });

    it("handles empty file", async () => {
      const filePath = path.join(tmpDir, "empty.txt");
      fs.writeFileSync(filePath, "");

      const result = await readFile.execute({ path: "empty.txt" }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.metadata?.totalLines).toBe(1); // empty string split by \n => [""]
        expect(result.metadata?.truncated).toBe(false);
      }
    });
  });

  // ── grep_search (additional coverage) ──────────────────────────────────────

  describe("grep_search (additional)", () => {
    beforeEach(() => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src/index.ts"), "function hello() {\n  return 'world';\n}");
      fs.writeFileSync(path.join(tmpDir, "src/utils.ts"), "export const foo = 'bar';");
      fs.writeFileSync(path.join(tmpDir, "README.md"), "# Documentation\nhello world");
    });

    it("supports files_with_matches output mode", async () => {
      const result = await grepSearch.execute(
        { pattern: "hello", output_mode: "files_with_matches" },
        ctx,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.metadata?.mode).toBe("files_with_matches");
        expect(result.metadata?.totalMatches).toBeGreaterThan(0);
      }
    });

    it("supports count output mode", async () => {
      const result = await grepSearch.execute(
        { pattern: "hello", output_mode: "count" },
        ctx,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.metadata?.mode).toBe("count");
        // numMatches is set in count mode
        expect(result.metadata?.numMatches).toBeDefined();
      }
    });

    it("supports case insensitive search", async () => {
      const result = await grepSearch.execute(
        { pattern: "HELLO", "-i": true },
        ctx,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("hello");
        expect(result.metadata?.totalMatches).toBeGreaterThan(0);
      }
    });

    it("supports offset pagination", async () => {
      // Create enough matching files
      for (let i = 0; i < 5; i++) {
        fs.writeFileSync(path.join(tmpDir, `match_${i}.txt`), `match_line ${i}`);
      }

      const resultAll = await grepSearch.execute(
        { pattern: "match_line", head_limit: 100 },
        ctx,
      );

      const resultOffset = await grepSearch.execute(
        { pattern: "match_line", offset: 2, head_limit: 2 },
        ctx,
      );

      expect(resultAll.type).toBe("success");
      expect(resultOffset.type).toBe("success");
      if (resultOffset.type === "success") {
        expect(resultOffset.metadata?.displayedMatches).toBeLessThanOrEqual(2);
        expect(resultOffset.metadata?.appliedOffset).toBe(2);
      }
    });

    it("supports context lines (-C)", async () => {
      const result = await grepSearch.execute(
        { pattern: "return", context: 1 },
        ctx,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        // Context should include lines around "return 'world'"
        expect(result.metadata?.totalMatches).toBeGreaterThan(0);
      }
    });

    it("supports after context (-A)", async () => {
      const result = await grepSearch.execute(
        { pattern: "function", "-A": 1 },
        ctx,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.metadata?.totalMatches).toBeGreaterThan(0);
      }
    });

    it("supports before context (-B)", async () => {
      const result = await grepSearch.execute(
        { pattern: "return", "-B": 1 },
        ctx,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.metadata?.totalMatches).toBeGreaterThan(0);
      }
    });

    it("supports file type filter", async () => {
      const result = await grepSearch.execute(
        { pattern: "hello", type: "ts" },
        ctx,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        // Should only match .ts files
        expect(result.content).not.toContain("README.md");
      }
    });

    it("supports multiline mode", async () => {
      fs.writeFileSync(
        path.join(tmpDir, "multi.ts"),
        "function foo() {\n  return 1;\n}",
      );

      const result = await grepSearch.execute(
        { pattern: "foo.*return", multiline: true },
        ctx,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.metadata?.totalMatches).toBeGreaterThan(0);
      }
    });

    it("handles pattern starting with dash", async () => {
      fs.writeFileSync(path.join(tmpDir, "dash.txt"), "value is -1 here");

      const result = await grepSearch.execute({ pattern: "-1" }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("-1");
      }
    });

    it("uses head_limit=0 for unlimited", async () => {
      for (let i = 0; i < 5; i++) {
        fs.writeFileSync(path.join(tmpDir, `unlimited_${i}.txt`), "target_string");
      }

      const result = await grepSearch.execute(
        { pattern: "target_string", head_limit: 0 },
        ctx,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.metadata?.truncated).toBe(false);
      }
    });

    it("reports appliedLimit in metadata when truncated", async () => {
      for (let i = 0; i < 10; i++) {
        fs.writeFileSync(path.join(tmpDir, `trunc_${i}.txt`), "truncate_me");
      }

      const result = await grepSearch.execute(
        { pattern: "truncate_me", head_limit: 3 },
        ctx,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        if (result.metadata?.truncated) {
          expect(result.metadata?.appliedLimit).toBe(3);
        }
      }
    });

    it("handles line numbers flag disabled", async () => {
      const result = await grepSearch.execute(
        { pattern: "hello", "-n": false },
        ctx,
      );

      expect(result.type).toBe("success");
    });
  });

  // ── list_files (additional coverage) ───────────────────────────────────────

  describe("list_files (additional)", () => {
    beforeEach(() => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src/a.ts"), "");
      fs.writeFileSync(path.join(tmpDir, "src/b.ts"), "");
      fs.writeFileSync(path.join(tmpDir, "root.txt"), "");
    });

    it("applies head_limit to truncate results", async () => {
      const result = await listFiles.execute({ head_limit: 1 }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        const files = result.content.split("\n").filter((f) => f.length > 0);
        expect(files.length).toBe(1);
        expect(result.metadata?.truncated).toBe(true);
        expect(result.metadata?.totalFiles).toBeGreaterThan(1);
      }
    });

    it("sorts by mtime when requested", async () => {
      const result = await listFiles.execute({ sort_by: "mtime" }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.metadata?.sortedBy).toBe("mtime");
        expect(result.metadata?.totalFiles).toBeGreaterThan(0);
      }
    });

    it("returns metadata showing sort order", async () => {
      const result = await listFiles.execute({ sort_by: "name" }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.metadata?.sortedBy).toBe("name");
        expect(result.metadata?.pattern).toBeNull();
      }
    });

    it("returns metadata with pattern when filter is applied", async () => {
      const result = await listFiles.execute({ pattern: "*.ts" }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.metadata?.pattern).toBe("*.ts");
      }
    });
  });

  // ── fuzzy_file_search ─────────────────────────────────────────────────────

  describe("fuzzy_file_search", () => {
    beforeEach(() => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "tests"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src/agenticOrchestrator.ts"), "");
      fs.writeFileSync(path.join(tmpDir, "src/fileIndex.ts"), "");
      fs.writeFileSync(path.join(tmpDir, "src/utils.ts"), "");
      fs.writeFileSync(path.join(tmpDir, "tests/test.spec.ts"), "");
    });

    it("has correct metadata", () => {
      expect(fuzzyFileSearch.name).toBe("fuzzy_file_search");
      expect(fuzzyFileSearch.permission.scope).toBe("repo.read");
      expect(fuzzyFileSearch.permission.readOnly).toBe(true);
      expect(fuzzyFileSearch.alwaysLoad).toBe(false);
      expect(fuzzyFileSearch.concurrencySafe).toBe(true);
    });

    it("finds files matching fuzzy query", async () => {
      const result = await fuzzyFileSearch.execute({ query: "utils" }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("utils");
        expect(result.metadata?.totalMatches).toBeGreaterThan(0);
        expect(result.metadata?.indexedFiles).toBeGreaterThan(0);
        expect(result.metadata?.paths).toBeDefined();
      }
    });

    it("returns no results message for non-matching query", async () => {
      const result = await fuzzyFileSearch.execute({ query: "zzzzxyznonexistent" }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("No files found");
        expect(result.metadata?.totalMatches).toBe(0);
      }
    });

    it("respects max_results limit", async () => {
      const result = await fuzzyFileSearch.execute({ query: "ts", max_results: 2 }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.metadata?.totalMatches).toBeLessThanOrEqual(2);
      }
    });

    it("formats results with numbering", async () => {
      const result = await fuzzyFileSearch.execute({ query: "ts" }, ctx);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        if (result.metadata?.totalMatches! > 0) {
          expect(result.content).toMatch(/^1\. /);
        }
      }
    });

    it("validates input schema", () => {
      const valid = fuzzyFileSearch.inputSchema.safeParse({ query: "test" });
      expect(valid.success).toBe(true);

      const invalid = fuzzyFileSearch.inputSchema.safeParse({});
      expect(invalid.success).toBe(false);

      const invalidMax = fuzzyFileSearch.inputSchema.safeParse({ query: "test", max_results: 0 });
      expect(invalidMax.success).toBe(false);

      const tooHighMax = fuzzyFileSearch.inputSchema.safeParse({ query: "test", max_results: 100 });
      expect(tooHighMax.success).toBe(false);
    });
  });
});

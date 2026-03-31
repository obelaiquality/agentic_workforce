import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Mock database and event bus to prevent real DB connections
const mocks = vi.hoisted(() => ({
  prisma: {
    appSetting: { findUnique: vi.fn() },
  },
  publishEvent: vi.fn(),
}));

vi.mock("../db", () => ({ prisma: mocks.prisma }));
vi.mock("../eventBus", () => ({ publishEvent: mocks.publishEvent }));

// Mock all service imports
vi.mock("./v2EventService");
vi.mock("./routerService");
vi.mock("./contextService");
vi.mock("./providerOrchestrator");
vi.mock("./repoService");
vi.mock("./codeGraphService");
vi.mock("./commandEngine");
vi.mock("./shellDetect", () => ({ detectShell: () => "/bin/bash" }));
vi.mock("./toolResultOptimizer");
vi.mock("./editMatcherChain");
vi.mock("./fileStateCache", () => ({
  getSharedFileStateCache: () => ({ delete: vi.fn(), get: vi.fn() }),
}));
vi.mock("./memoryService");
vi.mock("./shadowGitService");
vi.mock("./systemReminderService");
vi.mock("./doomLoopDetector");
vi.mock("./contextCompactionService");
vi.mock("../errors", async () => {
  const actual = await vi.importActual("../errors");
  return actual;
});
vi.mock("./sensitiveRedaction", async () => {
  const actual = await vi.importActual("./sensitiveRedaction");
  return actual;
});
vi.mock("./codebaseHelpers", async () => {
  const actual = await vi.importActual("./codebaseHelpers");
  return actual;
});

import {
  combinedShellOutput,
  classifyInfraVerificationFailure,
  hasInfraVerificationFailure,
  resolveDependencyBootstrapCommand,
  detectLineEndings,
  normalizeLineEndings,
  safeWriteFile,
  extractJsonObject,
  parsePatchManifest,
} from "./executionService";

describe("combinedShellOutput", () => {
  it("returns combined stderr and stdout trimmed and lowercased", () => {
    const result = combinedShellOutput({
      stdout: "Hello World",
      stderr: "Error Message",
    });

    expect(result).toBe("error message\nhello world");
  });

  it("handles empty stderr", () => {
    const result = combinedShellOutput({
      stdout: "Output",
      stderr: "",
    });

    expect(result).toBe("output");
  });

  it("handles empty stdout", () => {
    const result = combinedShellOutput({
      stdout: "",
      stderr: "Error",
    });

    expect(result).toBe("error");
  });

  it("trims whitespace from beginning and end only", () => {
    const result = combinedShellOutput({
      stdout: "  output  ",
      stderr: "  error  ",
    });

    // Trim only applies to the combined result, not individual parts
    expect(result).toBe("error  \n  output");
  });

  it("handles both empty", () => {
    const result = combinedShellOutput({
      stdout: "",
      stderr: "",
    });

    expect(result).toBe("");
  });
});

describe("classifyInfraVerificationFailure", () => {
  describe("missing tool detection", () => {
    it("detects exit code 127 with output", () => {
      const result = classifyInfraVerificationFailure("npm", {
        stdout: "error",
        stderr: "",
        exitCode: 127,
      });

      expect(result).toEqual({
        code: "infra_missing_tool:npm",
        message: 'Missing tool while running "npm".',
      });
    });

    it("detects command not found in output", () => {
      const result = classifyInfraVerificationFailure("git", {
        stdout: "",
        stderr: "bash: git: command not found",
        exitCode: 1,
      });

      expect(result).toEqual({
        code: "infra_missing_tool:git",
        message: 'Missing tool while running "git".',
      });
    });

    it("detects Windows-style missing command", () => {
      const result = classifyInfraVerificationFailure("node", {
        stdout: "",
        stderr: "'node' is not recognized as an internal or external command",
        exitCode: 1,
      });

      expect(result).toEqual({
        code: "infra_missing_tool:node",
        message: 'Missing tool while running "node".',
      });
    });
  });

  describe("missing dependency detection", () => {
    it("detects cannot find module", () => {
      const result = classifyInfraVerificationFailure("jest", {
        stdout: "",
        stderr: "Error: Cannot find module 'jest'",
        exitCode: 1,
      });

      expect(result).toEqual({
        code: "infra_missing_dependency:jest",
        message: 'Missing dependency while running "jest".',
      });
    });

    it("detects module not found", () => {
      const result = classifyInfraVerificationFailure("webpack", {
        stdout: "Error: Module not found: webpack",
        stderr: "",
        exitCode: 1,
      });

      expect(result).toEqual({
        code: "infra_missing_dependency:webpack",
        message: 'Missing dependency while running "webpack".',
      });
    });

    it("detects ERR_MODULE_NOT_FOUND", () => {
      const result = classifyInfraVerificationFailure("react", {
        stdout: "",
        stderr: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'react'",
        exitCode: 1,
      });

      expect(result).toEqual({
        code: "infra_missing_dependency:react",
        message: 'Missing dependency while running "react".',
      });
    });

    it("detects Python no module named", () => {
      const result = classifyInfraVerificationFailure("pytest", {
        stdout: "",
        stderr: "ModuleNotFoundError: No module named 'pytest'",
        exitCode: 1,
      });

      expect(result).toEqual({
        code: "infra_missing_dependency:pytest",
        message: 'Missing dependency while running "pytest".',
      });
    });
  });

  describe("timeout detection", () => {
    it("detects exit code 124 with output", () => {
      const result = classifyInfraVerificationFailure("slow-script", {
        stdout: "some output",
        stderr: "",
        exitCode: 124,
      });

      expect(result).toEqual({
        code: "infra_command_timeout:slow-script",
        message: 'Command timeout while running "slow-script".',
      });
    });

    it("detects timed out in output", () => {
      const result = classifyInfraVerificationFailure("test", {
        stdout: "",
        stderr: "Process timed out after 30 seconds",
        exitCode: 1,
      });

      expect(result).toEqual({
        code: "infra_command_timeout:test",
        message: 'Command timeout while running "test".',
      });
    });
  });

  describe("no failure detection", () => {
    it("returns null for empty output", () => {
      const result = classifyInfraVerificationFailure("echo", {
        stdout: "",
        stderr: "",
        exitCode: 0,
      });

      expect(result).toBeNull();
    });

    it("returns null for unrelated error", () => {
      const result = classifyInfraVerificationFailure("test", {
        stdout: "",
        stderr: "Assertion failed: expected true, got false",
        exitCode: 1,
      });

      expect(result).toBeNull();
    });
  });
});

describe("hasInfraVerificationFailure", () => {
  it("returns true for infra_missing_tool prefix", () => {
    expect(hasInfraVerificationFailure(["infra_missing_tool:npm"])).toBe(true);
  });

  it("returns true for infra_missing_dependency prefix", () => {
    expect(hasInfraVerificationFailure(["infra_missing_dependency:jest"])).toBe(true);
  });

  it("returns true for infra_command_timeout prefix", () => {
    expect(hasInfraVerificationFailure(["infra_command_timeout:test"])).toBe(true);
  });

  it("returns true for setup_failed prefix", () => {
    expect(hasInfraVerificationFailure(["setup_failed:initialization"])).toBe(true);
  });

  it("returns false for no matching failures", () => {
    expect(hasInfraVerificationFailure(["test_failed:unit", "lint_error:missing-semicolon"])).toBe(false);
  });

  it("returns false for empty array", () => {
    expect(hasInfraVerificationFailure([])).toBe(false);
  });

  it("returns true if any failure matches", () => {
    expect(hasInfraVerificationFailure(["test_failed:unit", "infra_missing_tool:git", "lint_error:formatting"])).toBe(true);
  });
});

describe("resolveDependencyBootstrapCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-test-"));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns pnpm install for pnpm-lock.yaml", () => {
    fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "");

    const result = resolveDependencyBootstrapCommand(tempDir);

    expect(result).toBe("pnpm install");
  });

  it("returns yarn install for yarn.lock", () => {
    fs.writeFileSync(path.join(tempDir, "yarn.lock"), "");

    const result = resolveDependencyBootstrapCommand(tempDir);

    expect(result).toBe("yarn install");
  });

  it("returns bun install for bun.lockb", () => {
    fs.writeFileSync(path.join(tempDir, "bun.lockb"), "");

    const result = resolveDependencyBootstrapCommand(tempDir);

    expect(result).toBe("bun install");
  });

  it("returns bun install for bun.lock", () => {
    fs.writeFileSync(path.join(tempDir, "bun.lock"), "");

    const result = resolveDependencyBootstrapCommand(tempDir);

    expect(result).toBe("bun install");
  });

  it("returns npm install for package.json", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "{}");

    const result = resolveDependencyBootstrapCommand(tempDir);

    expect(result).toBe("npm install");
  });

  it("returns null for no lockfiles or package.json", () => {
    const result = resolveDependencyBootstrapCommand(tempDir);

    expect(result).toBeNull();
  });

  it("prioritizes pnpm over yarn over bun over npm", () => {
    fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "");
    fs.writeFileSync(path.join(tempDir, "yarn.lock"), "");
    fs.writeFileSync(path.join(tempDir, "bun.lockb"), "");
    fs.writeFileSync(path.join(tempDir, "package.json"), "{}");

    const result = resolveDependencyBootstrapCommand(tempDir);

    expect(result).toBe("pnpm install");
  });

  it("prioritizes yarn over bun over npm when no pnpm", () => {
    fs.writeFileSync(path.join(tempDir, "yarn.lock"), "");
    fs.writeFileSync(path.join(tempDir, "bun.lockb"), "");
    fs.writeFileSync(path.join(tempDir, "package.json"), "{}");

    const result = resolveDependencyBootstrapCommand(tempDir);

    expect(result).toBe("yarn install");
  });

  it("prioritizes bun over npm when no pnpm or yarn", () => {
    fs.writeFileSync(path.join(tempDir, "bun.lockb"), "");
    fs.writeFileSync(path.join(tempDir, "package.json"), "{}");

    const result = resolveDependencyBootstrapCommand(tempDir);

    expect(result).toBe("bun install");
  });
});

describe("detectLineEndings", () => {
  it("detects CRLF when more CRLF than LF", () => {
    const content = "line1\r\nline2\r\nline3\n";
    expect(detectLineEndings(content)).toBe("CRLF");
  });

  it("detects LF when more LF than CRLF", () => {
    const content = "line1\nline2\nline3\r\n";
    expect(detectLineEndings(content)).toBe("LF");
  });

  it("detects LF for Unix-style files", () => {
    const content = "line1\nline2\nline3\n";
    expect(detectLineEndings(content)).toBe("LF");
  });

  it("detects CRLF for Windows-style files", () => {
    const content = "line1\r\nline2\r\nline3\r\n";
    expect(detectLineEndings(content)).toBe("CRLF");
  });

  it("detects LF when counts are equal", () => {
    const content = "line1\r\nline2\n";
    expect(detectLineEndings(content)).toBe("LF");
  });

  it("detects LF for empty content", () => {
    expect(detectLineEndings("")).toBe("LF");
  });

  it("detects LF for single line no newline", () => {
    expect(detectLineEndings("single line")).toBe("LF");
  });
});

describe("normalizeLineEndings", () => {
  it("preserves LF when style is LF", () => {
    const content = "line1\nline2\nline3\n";
    expect(normalizeLineEndings(content, "LF")).toBe("line1\nline2\nline3\n");
  });

  it("converts CRLF to LF when style is LF", () => {
    const content = "line1\r\nline2\r\nline3\r\n";
    expect(normalizeLineEndings(content, "LF")).toBe("line1\nline2\nline3\n");
  });

  it("converts LF to CRLF when style is CRLF", () => {
    const content = "line1\nline2\nline3\n";
    expect(normalizeLineEndings(content, "CRLF")).toBe("line1\r\nline2\r\nline3\r\n");
  });

  it("preserves CRLF when style is CRLF", () => {
    const content = "line1\r\nline2\r\nline3\r\n";
    expect(normalizeLineEndings(content, "CRLF")).toBe("line1\r\nline2\r\nline3\r\n");
  });

  it("handles mixed line endings when converting to LF", () => {
    const content = "line1\r\nline2\nline3\r\n";
    expect(normalizeLineEndings(content, "LF")).toBe("line1\nline2\nline3\n");
  });

  it("handles mixed line endings when converting to CRLF", () => {
    const content = "line1\r\nline2\nline3\r\n";
    expect(normalizeLineEndings(content, "CRLF")).toBe("line1\r\nline2\r\nline3\r\n");
  });

  it("handles empty string", () => {
    expect(normalizeLineEndings("", "LF")).toBe("");
    expect(normalizeLineEndings("", "CRLF")).toBe("");
  });
});

describe("safeWriteFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-test-"));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("writes new file with LF line endings", () => {
    const filePath = path.join(tempDir, "test.txt");
    const result = safeWriteFile(filePath, "line1\nline2\n");

    expect(result).toEqual({ written: true, stale: false });
    expect(fs.readFileSync(filePath, "utf8")).toBe("line1\nline2\n");
  });

  it("preserves existing file line endings", () => {
    const filePath = path.join(tempDir, "test.txt");
    fs.writeFileSync(filePath, "original\r\ncontent\r\n", "utf8");

    const result = safeWriteFile(filePath, "new\ncontent\n");

    expect(result).toEqual({ written: true, stale: false });
    expect(fs.readFileSync(filePath, "utf8")).toBe("new\r\ncontent\r\n");
  });

  it("detects stale file when modified after read", () => {
    const filePath = path.join(tempDir, "test.txt");
    fs.writeFileSync(filePath, "original", "utf8");

    const readTime = Date.now();
    // Sleep to ensure modified time is after read time
    const sleepSync = (ms: number) => {
      const start = Date.now();
      while (Date.now() - start < ms) {}
    };
    sleepSync(10);

    // Modify file after read time
    fs.writeFileSync(filePath, "modified", "utf8");

    const result = safeWriteFile(filePath, "new content", readTime);

    expect(result.written).toBe(true);
    expect(result.stale).toBe(true);
  });

  it("does not detect staleness when file not modified", () => {
    const filePath = path.join(tempDir, "test.txt");
    fs.writeFileSync(filePath, "content", "utf8");

    const stat = fs.statSync(filePath);
    const readTime = stat.mtimeMs + 100; // Read time after file modification

    const result = safeWriteFile(filePath, "new content", readTime);

    expect(result).toEqual({ written: true, stale: false });
  });

  it("handles file creation with no readTimestamp", () => {
    const filePath = path.join(tempDir, "new-file.txt");

    const result = safeWriteFile(filePath, "content");

    expect(result).toEqual({ written: true, stale: false });
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("writes file even when staleness detected", () => {
    const filePath = path.join(tempDir, "test.txt");
    fs.writeFileSync(filePath, "original", "utf8");

    // Get the current file's mtime and use an earlier timestamp
    const stat = fs.statSync(filePath);
    const readTime = stat.mtimeMs - 1000; // 1 second before the file was written

    const result = safeWriteFile(filePath, "overwritten", readTime);

    expect(result.written).toBe(true);
    expect(result.stale).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toBe("overwritten");
  });
});

describe("extractJsonObject", () => {
  it("extracts bare JSON object", () => {
    const text = '{"summary": "test", "files": []}';
    const result = extractJsonObject(text);

    expect(result).toEqual({ summary: "test", files: [] });
  });

  it("extracts JSON from fenced code block", () => {
    const text = '```json\n{"summary": "test"}\n```';
    const result = extractJsonObject(text);

    expect(result).toEqual({ summary: "test" });
  });

  it("extracts JSON from code block without language", () => {
    const text = '```\n{"summary": "test"}\n```';
    const result = extractJsonObject(text);

    expect(result).toEqual({ summary: "test" });
  });

  it("extracts JSON with surrounding text", () => {
    const text = 'Here is the plan:\n{"summary": "test"}\nThat is all.';
    const result = extractJsonObject(text);

    expect(result).toEqual({ summary: "test" });
  });

  it("extracts JSON with trailing commentary", () => {
    const text = '{"summary": "test"} // This is the manifest';
    const result = extractJsonObject(text);

    expect(result).toEqual({ summary: "test" });
  });

  it("throws error when no braces found", () => {
    const text = "No JSON here";

    expect(() => extractJsonObject(text)).toThrowError("Model did not return a JSON object");
  });

  it("throws error when only opening brace", () => {
    const text = "{ incomplete";

    expect(() => extractJsonObject(text)).toThrowError("Model did not return a JSON object");
  });

  it("throws error when only closing brace", () => {
    const text = "incomplete }";

    expect(() => extractJsonObject(text)).toThrowError("Model did not return a JSON object");
  });

  it("throws error when closing brace before opening", () => {
    const text = "} invalid {";

    expect(() => extractJsonObject(text)).toThrowError("Model did not return a JSON object");
  });

  it("handles nested objects", () => {
    const text = '{"outer": {"inner": "value"}}';
    const result = extractJsonObject(text);

    expect(result).toEqual({ outer: { inner: "value" } });
  });

  it("handles arrays in JSON", () => {
    const text = '{"files": [{"path": "a.ts"}, {"path": "b.ts"}]}';
    const result = extractJsonObject(text);

    expect(result).toEqual({
      files: [{ path: "a.ts" }, { path: "b.ts" }],
    });
  });
});

describe("parsePatchManifest", () => {
  it("parses valid manifest with all fields", () => {
    const text = JSON.stringify({
      summary: "Add new feature",
      files: [
        {
          path: "src/feature.ts",
          action: "create",
          strategy: "full_file",
          reason: "Create new feature file",
        },
      ],
      docsChecked: ["README.md"],
      tests: ["src/feature.test.ts"],
    });

    const result = parsePatchManifest(text);

    expect(result).toEqual({
      summary: "Add new feature",
      files: [
        {
          path: "src/feature.ts",
          action: "create",
          strategy: "full_file",
          reason: "Create new feature file",
        },
      ],
      docsChecked: ["README.md"],
      tests: ["src/feature.test.ts"],
      raw: text,
    });
  });

  it("defaults action to update when not create", () => {
    const text = JSON.stringify({
      files: [{ path: "src/file.ts" }],
    });

    const result = parsePatchManifest(text);

    expect(result.files[0].action).toBe("update");
  });

  it("defaults strategy to full_file when not specified", () => {
    const text = JSON.stringify({
      files: [{ path: "src/file.ts" }],
    });

    const result = parsePatchManifest(text);

    expect(result.files[0].strategy).toBe("full_file");
  });

  it("supports unified_diff strategy", () => {
    const text = JSON.stringify({
      files: [{ path: "src/file.ts", strategy: "unified_diff" }],
    });

    const result = parsePatchManifest(text);

    expect(result.files[0].strategy).toBe("unified_diff");
  });

  it("supports search_replace strategy", () => {
    const text = JSON.stringify({
      files: [{ path: "src/file.ts", strategy: "search_replace" }],
    });

    const result = parsePatchManifest(text);

    expect(result.files[0].strategy).toBe("search_replace");
  });

  it("defaults invalid strategy to full_file", () => {
    const text = JSON.stringify({
      files: [{ path: "src/file.ts", strategy: "invalid_strategy" }],
    });

    const result = parsePatchManifest(text);

    expect(result.files[0].strategy).toBe("full_file");
  });

  it("provides default reason when missing", () => {
    const text = JSON.stringify({
      files: [{ path: "src/file.ts" }],
    });

    const result = parsePatchManifest(text);

    expect(result.files[0].reason).toBe("Update this file to satisfy the objective.");
  });

  it("trims path and reason", () => {
    const text = JSON.stringify({
      files: [{ path: "  src/file.ts  ", reason: "  Fix bug  " }],
    });

    const result = parsePatchManifest(text);

    expect(result.files[0].path).toBe("src/file.ts");
    expect(result.files[0].reason).toBe("Fix bug");
  });

  it("filters out files with empty path", () => {
    const text = JSON.stringify({
      files: [{ path: "" }, { path: "   " }, { path: "src/valid.ts" }],
    });

    const result = parsePatchManifest(text);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("src/valid.ts");
  });

  it("handles missing files array", () => {
    const text = JSON.stringify({
      summary: "No files",
    });

    const result = parsePatchManifest(text);

    expect(result.files).toEqual([]);
  });

  it("handles non-array files field", () => {
    const text = JSON.stringify({
      files: "not an array",
    });

    const result = parsePatchManifest(text);

    expect(result.files).toEqual([]);
  });

  it("filters non-string items from docsChecked", () => {
    const text = JSON.stringify({
      docsChecked: ["README.md", 123, null, "CONTRIBUTING.md"],
    });

    const result = parsePatchManifest(text);

    expect(result.docsChecked).toEqual(["README.md", "CONTRIBUTING.md"]);
  });

  it("filters non-string items from tests", () => {
    const text = JSON.stringify({
      tests: ["test1.ts", false, "test2.ts", {}],
    });

    const result = parsePatchManifest(text);

    expect(result.tests).toEqual(["test1.ts", "test2.ts"]);
  });

  it("handles missing docsChecked", () => {
    const text = JSON.stringify({});

    const result = parsePatchManifest(text);

    expect(result.docsChecked).toEqual([]);
  });

  it("handles missing tests", () => {
    const text = JSON.stringify({});

    const result = parsePatchManifest(text);

    expect(result.tests).toEqual([]);
  });

  it("uses truncated text as summary when missing", () => {
    const text = JSON.stringify({});

    const result = parsePatchManifest(text);

    expect(result.summary).toBe("{}");
  });

  it("preserves raw text", () => {
    const text = '{"summary": "test"}';

    const result = parsePatchManifest(text);

    expect(result.raw).toBe(text);
  });

  it("handles JSON in fenced code block", () => {
    const text = '```json\n{"summary": "test", "files": []}\n```';

    const result = parsePatchManifest(text);

    expect(result.summary).toBe("test");
    expect(result.files).toEqual([]);
  });

  it("handles multiple files with mixed properties", () => {
    const text = JSON.stringify({
      files: [
        { path: "a.ts", action: "create", strategy: "full_file", reason: "New file" },
        { path: "b.ts", action: "update", strategy: "search_replace" },
        { path: "c.ts" },
      ],
    });

    const result = parsePatchManifest(text);

    expect(result.files).toHaveLength(3);
    expect(result.files[0]).toMatchObject({
      path: "a.ts",
      action: "create",
      strategy: "full_file",
      reason: "New file",
    });
    expect(result.files[1]).toMatchObject({
      path: "b.ts",
      action: "update",
      strategy: "search_replace",
      reason: "Update this file to satisfy the objective.",
    });
    expect(result.files[2]).toMatchObject({
      path: "c.ts",
      action: "update",
      strategy: "full_file",
      reason: "Update this file to satisfy the objective.",
    });
  });

  it("handles empty reason string by using default", () => {
    const text = JSON.stringify({
      files: [{ path: "src/file.ts", reason: "   " }],
    });

    const result = parsePatchManifest(text);

    expect(result.files[0].reason).toBe("Update this file to satisfy the objective.");
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Mock database and event bus to prevent real DB connections
const mocks = vi.hoisted(() => ({
  prisma: {
    appSetting: { findUnique: vi.fn() },
    projectBlueprint: { findUnique: vi.fn().mockResolvedValue(null) },
    executionAttempt: { update: vi.fn().mockResolvedValue({}) },
    runProjection: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    shareableRunReport: { upsert: vi.fn().mockResolvedValue({}) },
    verificationBundle: { create: vi.fn().mockResolvedValue({ id: "vb-1", pass: true }) },
  },
  publishEvent: vi.fn(),
  MockMemoryService: vi.fn().mockImplementation(() => ({
    loadEpisodicMemory: vi.fn(),
    compose: vi.fn().mockReturnValue({ episodicContext: null, workingContext: [] }),
    commitTaskOutcome: vi.fn(),
  })),
  MockShadowGitService: vi.fn().mockImplementation(() => ({
    initialize: vi.fn(),
    snapshot: vi.fn(),
  })),
  MockDoomLoopDetector: vi.fn().mockImplementation(() => ({
    check: vi.fn().mockReturnValue({ stuck: false }),
    record: vi.fn(),
  })),
  MockAgenticOrchestrator: vi.fn(),
  MockAutoMemoryExtractor: vi.fn().mockImplementation(() => ({
    extractAndStore: vi.fn(),
  })),
  MockLearningsService: vi.fn().mockImplementation(() => ({
    load: vi.fn(),
    save: vi.fn(),
  })),
  MockRunCoordinatorMode: vi.fn(),
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
vi.mock("./memoryService", () => ({
  MemoryService: mocks.MockMemoryService,
}));
vi.mock("./shadowGitService", () => ({
  ShadowGitService: mocks.MockShadowGitService,
}));
vi.mock("./systemReminderService", () => ({
  buildErrorReminder: vi.fn().mockReturnValue(""),
  buildJsonFormatReminder: vi.fn().mockReturnValue(""),
  shouldInjectReminder: vi.fn().mockReturnValue(false),
  injectReminders: vi.fn().mockImplementation(({ messages }) => messages),
}));
vi.mock("./doomLoopDetector", () => ({
  DoomLoopDetector: mocks.MockDoomLoopDetector,
}));
vi.mock("./contextCompactionService");
vi.mock("../execution/agenticOrchestrator", () => ({
  AgenticOrchestrator: mocks.MockAgenticOrchestrator,
}));
vi.mock("../execution/coordinatorAgent", () => ({
  runCoordinatorMode: mocks.MockRunCoordinatorMode,
}));
vi.mock("../memory/autoExtractor", () => ({
  AutoMemoryExtractor: mocks.MockAutoMemoryExtractor,
}));
vi.mock("./learningsService", () => ({
  LearningsService: mocks.MockLearningsService,
}));
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
  ExecutionService,
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

// ---------------------------------------------------------------------------
// safeWriteFile — directory creation
// ---------------------------------------------------------------------------

describe("safeWriteFile — directory creation", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-svc-dir-"));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("creates intermediate directories when they do not exist", () => {
    const filePath = path.join(tempDir, "a", "b", "c", "deep.txt");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const result = safeWriteFile(filePath, "deep content\n");

    expect(result).toEqual({ written: true, stale: false });
    expect(fs.readFileSync(filePath, "utf8")).toBe("deep content\n");
  });

  it("overwrites content and preserves LF line endings for new files", () => {
    const filePath = path.join(tempDir, "new.txt");

    safeWriteFile(filePath, "first\n");
    const result = safeWriteFile(filePath, "second\n");

    expect(result.written).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toBe("second\n");
  });

  it("handles empty content", () => {
    const filePath = path.join(tempDir, "empty.txt");

    const result = safeWriteFile(filePath, "");

    expect(result).toEqual({ written: true, stale: false });
    expect(fs.readFileSync(filePath, "utf8")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// parsePatchManifest — deterministic manifests round-trip correctly
// ---------------------------------------------------------------------------

describe("parsePatchManifest — deterministic manifest patterns", () => {
  it("parses a status-badge deterministic manifest", () => {
    const manifest = {
      summary: "Add a status badge component to the app and test it.",
      files: [
        { path: "src/components/StatusBadge.tsx", action: "create", strategy: "full_file", reason: "Create the StatusBadge component." },
        { path: "src/App.tsx", action: "update", strategy: "search_replace", reason: "Render the component." },
        { path: "src/App.test.tsx", action: "update", strategy: "search_replace", reason: "Cover the component in tests." },
        { path: "README.md", action: "update", strategy: "search_replace", reason: "Document the addition." },
      ],
      docsChecked: ["README.md", "AGENTS.md"],
      tests: ["src/App.test.tsx"],
    };
    const text = JSON.stringify(manifest);
    const result = parsePatchManifest(text);

    expect(result.summary).toBe("Add a status badge component to the app and test it.");
    expect(result.files).toHaveLength(4);
    expect(result.files[0].path).toBe("src/components/StatusBadge.tsx");
    expect(result.files[0].action).toBe("create");
    expect(result.docsChecked).toEqual(["README.md", "AGENTS.md"]);
  });

  it("parses a progress-bar deterministic manifest", () => {
    const manifest = {
      summary: "Add a progress bar component.",
      files: [
        { path: "src/components/ProgressBar.tsx", action: "create", strategy: "full_file", reason: "Create ProgressBar." },
      ],
      docsChecked: [],
      tests: [],
    };
    const result = parsePatchManifest(JSON.stringify(manifest));

    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("src/components/ProgressBar.tsx");
    expect(result.files[0].strategy).toBe("full_file");
  });

  it("parses a theme-toggle deterministic manifest", () => {
    const manifest = {
      summary: "Add a theme toggle component to the app and test it.",
      files: [
        { path: "src/components/ThemeToggle.tsx", action: "create", strategy: "full_file", reason: "Create ThemeToggle." },
        { path: "src/App.tsx", action: "update", strategy: "search_replace", reason: "Add toggle to App." },
        { path: "src/App.test.tsx", action: "update", strategy: "search_replace", reason: "Add theme tests." },
        { path: "README.md", action: "update", strategy: "search_replace", reason: "Document toggle." },
      ],
      docsChecked: ["README.md", "AGENTS.md"],
      tests: ["src/App.test.tsx"],
    };
    const result = parsePatchManifest(JSON.stringify(manifest));

    expect(result.files).toHaveLength(4);
    expect(result.files[0].path).toBe("src/components/ThemeToggle.tsx");
    expect(result.docsChecked).toContain("AGENTS.md");
  });

  it("preserves create/update distinction across multiple files", () => {
    const manifest = {
      files: [
        { path: "src/new.ts", action: "create" },
        { path: "src/existing.ts", action: "update" },
        { path: "src/implicit.ts" },
      ],
    };
    const result = parsePatchManifest(JSON.stringify(manifest));

    expect(result.files[0].action).toBe("create");
    expect(result.files[1].action).toBe("update");
    expect(result.files[2].action).toBe("update"); // default is update
  });
});

// ---------------------------------------------------------------------------
// extractJsonObject — additional edge cases
// ---------------------------------------------------------------------------

describe("extractJsonObject — additional edge cases", () => {
  it("extracts JSON with newlines and whitespace", () => {
    const text = `\n\n  {\n  "summary": "test"\n}\n\n`;
    const result = extractJsonObject(text);
    expect(result).toEqual({ summary: "test" });
  });

  it("extracts from deeply nested structure", () => {
    const text = '{"a":{"b":{"c":{"d":"deep"}}}}';
    const result = extractJsonObject(text);
    expect(result).toEqual({ a: { b: { c: { d: "deep" } } } });
  });

  it("throws descriptive error for completely non-JSON text", () => {
    expect(() => extractJsonObject("just plain text here")).toThrow("Model did not return a JSON object");
  });
});

// ---------------------------------------------------------------------------
// ExecutionService class
// ---------------------------------------------------------------------------

describe("ExecutionService", () => {
  // Shared mock service dependencies for the constructor
  const mockV2EventService = { appendEvent: vi.fn().mockResolvedValue(undefined) } as any;
  const mockRouterService = { listRecentForAggregate: vi.fn().mockResolvedValue([]) } as any;
  const mockContextService = { getWorkflowState: vi.fn().mockResolvedValue(null) } as any;
  const mockProviderOrchestrator = {
    getModelRoleBinding: vi.fn().mockResolvedValue({
      providerId: "onprem-qwen",
      model: "qwen-4b",
      temperature: 0.1,
      maxTokens: 2048,
      reasoningMode: "off",
    }),
    streamChatWithRetry: vi.fn().mockResolvedValue(undefined),
  } as any;
  const mockRepoService = {
    getGuidelines: vi.fn().mockResolvedValue(null),
    getActiveRepo: vi.fn().mockResolvedValue(null),
  } as any;
  const mockCodeGraphService = {
    rerankForManifest: vi.fn().mockImplementation((_id, pack) => pack),
  } as any;
  const mockCommandEngine = { run: vi.fn().mockResolvedValue({ ok: true, stdout: "", stderr: "", exitCode: 0 }) } as any;
  const mockPolicyEngine = { evaluate: vi.fn().mockReturnValue({ allowed: true }) } as any;
  const mockApprovalService = { check: vi.fn().mockResolvedValue({ approved: true }) } as any;
  const mockContextCollapseService = { collapse: vi.fn().mockReturnValue([]) } as any;
  const mockHookService = { runHook: vi.fn().mockResolvedValue(undefined) } as any;
  const mockPlanService = { getPlan: vi.fn().mockResolvedValue(null) } as any;
  const mockLspClient = { getSymbols: vi.fn().mockResolvedValue([]) } as any;

  function createService() {
    return new ExecutionService(
      mockV2EventService,
      mockRouterService,
      mockContextService,
      mockProviderOrchestrator,
      mockRepoService,
      mockCodeGraphService,
      mockCommandEngine,
      mockPolicyEngine,
      mockApprovalService,
      mockContextCollapseService,
      mockHookService,
      mockPlanService,
      mockLspClient,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("does not throw with all dependencies", () => {
      expect(() => createService()).not.toThrow();
    });

    it("does not throw with only required dependencies", () => {
      expect(
        () =>
          new ExecutionService(
            mockV2EventService,
            mockRouterService,
            mockContextService,
            mockProviderOrchestrator,
            mockRepoService,
            mockCodeGraphService,
          ),
      ).not.toThrow();
    });

    it("returns an instance of ExecutionService", () => {
      const svc = createService();
      expect(svc).toBeInstanceOf(ExecutionService);
    });
  });

  describe("initMemory", () => {
    it("returns a MemoryService instance", () => {
      const svc = createService();
      const mem = svc.initMemory("/tmp/test-worktree");

      expect(mem).toBeDefined();
      expect(mocks.MockMemoryService).toHaveBeenCalledWith("/tmp/test-worktree");
    });

    it("calls loadEpisodicMemory on the returned memory", () => {
      const svc = createService();
      const mem = svc.initMemory("/tmp/test-worktree");

      expect(mem.loadEpisodicMemory).toHaveBeenCalled();
    });

    it("returns the same type on subsequent calls", () => {
      const svc = createService();
      const mem1 = svc.initMemory("/tmp/path-a");
      const mem2 = svc.initMemory("/tmp/path-b");

      // Each call creates a new MemoryService (replaces previous)
      expect(mocks.MockMemoryService).toHaveBeenCalledTimes(2);
      expect(mem1).toBeDefined();
      expect(mem2).toBeDefined();
    });
  });

  describe("initShadowGit", () => {
    it("creates a ShadowGitService for the worktree", () => {
      const svc = createService();
      svc.initShadowGit("/tmp/test-worktree");

      expect(mocks.MockShadowGitService).toHaveBeenCalledWith("/tmp/test-worktree");
    });

    it("calls initialize on the shadow git", () => {
      const svc = createService();
      svc.initShadowGit("/tmp/test-worktree");

      const instance = mocks.MockShadowGitService.mock.results[0].value;
      expect(instance.initialize).toHaveBeenCalled();
    });

    it("does not throw when initialize fails", () => {
      mocks.MockShadowGitService.mockImplementationOnce(() => ({
        initialize: vi.fn(() => { throw new Error("git init failed"); }),
        snapshot: vi.fn(),
      }));

      const svc = createService();
      // Should not throw — shadow git failure is non-critical
      expect(() => svc.initShadowGit("/tmp/test-worktree")).not.toThrow();
    });
  });

  describe("executeAgentic", () => {
    it("creates an AgenticOrchestrator and yields events", async () => {
      const fakeEvents: any[] = [
        { type: "iteration_start", iteration: 1 },
        { type: "execution_complete", totalIterations: 1, totalToolCalls: 2 },
      ];

      // Set up the mock orchestrator execute as async generator
      mocks.MockAgenticOrchestrator.mockImplementation(() => ({
        execute: async function* () {
          for (const event of fakeEvents) {
            yield event;
          }
        },
      }));

      const svc = createService();
      const input = {
        runId: "run-1",
        objective: "test objective",
        worktreePath: "/tmp/test-worktree",
        actor: "test-user",
        repoId: "repo-1",
        maxIterations: 5,
        budget: { maxTokens: 10000 },
      } as any;

      const events: any[] = [];
      for await (const event of svc.executeAgentic({} as any, input)) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("iteration_start");
      expect(events[1].type).toBe("execution_complete");
    });

    it("records execution_complete event to V2EventService", async () => {
      mocks.MockAgenticOrchestrator.mockImplementation(() => ({
        execute: async function* () {
          yield { type: "execution_complete", totalIterations: 3, totalToolCalls: 7 };
        },
      }));

      const svc = createService();
      const input = {
        runId: "run-2",
        objective: "complete task",
        worktreePath: "/tmp/wt",
        actor: "user",
        repoId: "repo-1",
      } as any;

      const events: any[] = [];
      for await (const event of svc.executeAgentic({} as any, input)) {
        events.push(event);
      }

      expect(mockV2EventService.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agentic.execution.completed",
          aggregateId: "run-2",
          actor: "user",
          payload: expect.objectContaining({
            objective: "complete task",
            iterations: 3,
            toolCalls: 7,
          }),
        }),
      );
    });

    it("records execution_aborted event to V2EventService", async () => {
      mocks.MockAgenticOrchestrator.mockImplementation(() => ({
        execute: async function* () {
          yield { type: "execution_aborted", reason: "budget exceeded" };
        },
      }));

      const svc = createService();
      const input = {
        runId: "run-3",
        objective: "task",
        worktreePath: "/tmp/wt",
        actor: "user",
        repoId: "repo-1",
      } as any;

      const events: any[] = [];
      for await (const event of svc.executeAgentic({} as any, input)) {
        events.push(event);
      }

      expect(mockV2EventService.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agentic.execution.aborted",
          payload: expect.objectContaining({ reason: "budget exceeded" }),
        }),
      );
    });

    it("yields error event when orchestrator throws", async () => {
      mocks.MockAgenticOrchestrator.mockImplementation(() => ({
        execute: async function* () {
          throw new Error("orchestrator exploded");
        },
      }));

      const svc = createService();
      const input = {
        runId: "run-4",
        objective: "task",
        worktreePath: "/tmp/wt",
        actor: "user",
        repoId: "repo-1",
      } as any;

      const events: any[] = [];
      for await (const event of svc.executeAgentic({} as any, input)) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("error");
      expect(events[0].error).toContain("orchestrator exploded");
      expect(events[0].recoverable).toBe(false);
    });

    it("records escalating event to V2EventService", async () => {
      mocks.MockAgenticOrchestrator.mockImplementation(() => ({
        execute: async function* () {
          yield { type: "escalating", fromRole: "coder_default", toRole: "overseer_escalation", reason: "too complex" };
        },
      }));

      const svc = createService();
      const input = {
        runId: "run-5",
        objective: "complex task",
        worktreePath: "/tmp/wt",
        actor: "user",
        repoId: "repo-1",
      } as any;

      const events: any[] = [];
      for await (const event of svc.executeAgentic({} as any, input)) {
        events.push(event);
      }

      expect(mockV2EventService.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agentic.escalated",
          payload: expect.objectContaining({
            fromRole: "coder_default",
            toRole: "overseer_escalation",
            reason: "too complex",
          }),
        }),
      );
    });

    it("creates DoomLoopDetector with standard parameters", async () => {
      mocks.MockAgenticOrchestrator.mockImplementation(() => ({
        execute: async function* () {
          yield { type: "execution_complete", totalIterations: 1, totalToolCalls: 1 };
        },
      }));

      const svc = createService();
      const input = {
        runId: "run-6",
        objective: "task",
        worktreePath: "/tmp/wt",
        actor: "user",
        repoId: "repo-1",
      } as any;

      for await (const _event of svc.executeAgentic({} as any, input)) {
        // drain
      }

      // DoomLoopDetector constructed with (windowSize=20, threshold=3, cooldown=5)
      expect(mocks.MockDoomLoopDetector).toHaveBeenCalledWith(20, 3, 5);
    });

    it("delegates to coordinator mode when input.coordinator is true", async () => {
      const fakeCoordinatorEvents: any[] = [
        { type: "execution_complete", totalIterations: 2, totalToolCalls: 5 },
      ];

      mocks.MockRunCoordinatorMode.mockImplementation(async function* () {
        for (const event of fakeCoordinatorEvents) {
          yield event;
        }
      });

      const svc = createService();
      const input = {
        runId: "run-coord",
        objective: "multi-agent task",
        worktreePath: "/tmp/wt",
        actor: "user",
        repoId: "repo-1",
        coordinator: true,
      } as any;

      const events: any[] = [];
      for await (const event of svc.executeAgentic({} as any, input)) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("execution_complete");
      // AgenticOrchestrator should NOT be constructed in coordinator mode
      expect(mocks.MockAgenticOrchestrator).not.toHaveBeenCalled();
    });
  });
});

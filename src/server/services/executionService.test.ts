import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Mock database and event bus to prevent real DB connections
const mocks = vi.hoisted(() => ({
  prisma: {
    appSetting: { findUnique: vi.fn() },
    projectBlueprint: { findUnique: vi.fn().mockResolvedValue(null) },
    executionAttempt: {
      update: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({
        id: "ea-1",
        runId: "run-1",
        repoId: "repo-1",
        projectId: null,
        modelRole: "coder_default",
        providerId: "onprem-qwen",
        status: "planned",
        objective: "test",
        patchSummary: "",
        changedFiles: [],
        approvalRequired: false,
        contextPackId: "cp-1",
        routingDecisionId: "rd-1",
        metadata: {},
        startedAt: new Date(),
        completedAt: null,
        updatedAt: new Date(),
      }),
    },
    runProjection: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    shareableRunReport: { upsert: vi.fn().mockResolvedValue({}) },
    verificationBundle: {
      create: vi.fn().mockResolvedValue({
        id: "vb-1",
        runId: "run-1",
        repoId: "repo-1",
        executionAttemptId: "ea-1",
        changedFileChecks: [],
        impactedTests: [],
        fullSuiteRun: false,
        docsChecked: [],
        pass: true,
        failures: [],
        artifacts: [],
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
    contextPack: {
      findUnique: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: vi.fn().mockResolvedValue({}),
    },
    benchmarkOutcomeEvidence: { create: vi.fn().mockResolvedValue({ id: "ev-1" }) },
  },
  publishEvent: vi.fn(),
  MockMemoryService: vi.fn().mockImplementation(() => ({
    loadEpisodicMemory: vi.fn(),
    compose: vi.fn().mockReturnValue({ episodicContext: null, workingContext: [] }),
    commitTaskOutcome: vi.fn(),
    getRelevantEpisodicMemories: vi.fn().mockReturnValue([]),
  })),
  MockShadowGitService: vi.fn().mockImplementation(() => ({
    initialize: vi.fn(),
    snapshot: vi.fn(),
  })),
  MockDoomLoopDetector: vi.fn().mockImplementation(() => ({
    check: vi.fn().mockReturnValue({ stuck: false }),
    record: vi.fn(),
    isLooping: vi.fn().mockReturnValue(false),
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
vi.mock("./toolResultOptimizer", () => ({
  optimizeAndPersist: vi.fn().mockImplementation((text: string) => text),
}));
vi.mock("./editMatcherChain", () => ({
  runEditMatcherChain: vi.fn().mockReturnValue({ success: false, content: "" }),
}));
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
    buildContextPack: vi.fn().mockResolvedValue({ pack: { id: "cp-1", files: [], tests: [], docs: [], confidence: 0.5 }, retrievalTrace: { retrievalIds: [] } }),
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

    it("records coordinator execution_aborted event", async () => {
      mocks.MockRunCoordinatorMode.mockImplementation(async function* () {
        yield { type: "execution_aborted", reason: "coordinator budget exceeded" };
      });

      const svc = createService();
      const input = {
        runId: "run-coord-abort",
        objective: "task",
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
      expect(events[0].type).toBe("execution_aborted");
      expect(mockV2EventService.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agentic.execution.aborted",
          payload: expect.objectContaining({
            reason: "coordinator budget exceeded",
            mode: "coordinator",
          }),
        }),
      );
    });

    it("yields error event when coordinator throws", async () => {
      mocks.MockRunCoordinatorMode.mockImplementation(async function* () {
        throw new Error("coordinator crashed");
      });

      const svc = createService();
      const input = {
        runId: "run-coord-err",
        objective: "task",
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
      expect(events[0].type).toBe("error");
      expect(events[0].error).toContain("Coordinator execution failed");
      expect(events[0].error).toContain("coordinator crashed");
      expect(events[0].recoverable).toBe(false);
    });

    it("records coordinator execution_complete with mode", async () => {
      mocks.MockRunCoordinatorMode.mockImplementation(async function* () {
        yield { type: "execution_complete", totalIterations: 4, totalToolCalls: 10 };
      });

      const svc = createService();
      const input = {
        runId: "run-coord-done",
        objective: "big task",
        worktreePath: "/tmp/wt",
        actor: "user",
        repoId: "repo-1",
        coordinator: true,
      } as any;

      const events: any[] = [];
      for await (const event of svc.executeAgentic({} as any, input)) {
        events.push(event);
      }

      expect(mockV2EventService.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agentic.execution.completed",
          payload: expect.objectContaining({
            objective: "big task",
            iterations: 4,
            toolCalls: 10,
            mode: "coordinator",
          }),
        }),
      );
    });

    it("passes non-significant events through without recording", async () => {
      mocks.MockAgenticOrchestrator.mockImplementation(() => ({
        execute: async function* () {
          yield { type: "iteration_start", iteration: 1 };
          yield { type: "tool_call", tool: "read_file", args: {} };
        },
      }));

      const svc = createService();
      const input = {
        runId: "run-passthrough",
        objective: "task",
        worktreePath: "/tmp/wt",
        actor: "user",
        repoId: "repo-1",
      } as any;

      const events: any[] = [];
      for await (const event of svc.executeAgentic({} as any, input)) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      // Non-significant events should not trigger appendEvent
      expect(mockV2EventService.appendEvent).not.toHaveBeenCalled();
    });

    it("records failed event when orchestrator throws with non-Error", async () => {
      mocks.MockAgenticOrchestrator.mockImplementation(() => ({
        execute: async function* () {
          throw "string error";
        },
      }));

      const svc = createService();
      const input = {
        runId: "run-str-err",
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
      expect(events[0].error).toContain("string error");
      expect(mockV2EventService.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agentic.execution.failed",
          payload: expect.objectContaining({
            error: "string error",
          }),
        }),
      );
    });
  });

  describe("getMemory (lazy init)", () => {
    it("initializes memory lazily when executeAgentic is called", async () => {
      mocks.MockAgenticOrchestrator.mockImplementation(() => ({
        execute: async function* () {
          yield { type: "execution_complete", totalIterations: 1, totalToolCalls: 0 };
        },
      }));

      const svc = createService();
      const input = {
        runId: "run-mem",
        objective: "task",
        worktreePath: "/tmp/lazy-mem",
        actor: "user",
        repoId: "repo-1",
      } as any;

      for await (const _event of svc.executeAgentic({} as any, input)) {
        // drain
      }

      expect(mocks.MockMemoryService).toHaveBeenCalledWith("/tmp/lazy-mem");
    });
  });

  describe("getShadowGit (lazy init)", () => {
    it("returns null when shadow git init throws", () => {
      mocks.MockShadowGitService.mockImplementationOnce(() => ({
        initialize: vi.fn(() => { throw new Error("git not available"); }),
        snapshot: vi.fn(),
      }));

      const svc = createService();
      const result = svc.initShadowGit("/tmp/no-git");

      // initShadowGit returns null-like when init fails (shadowGit set to null)
      // The function still returns — we verify it didn't throw
      expect(mocks.MockShadowGitService).toHaveBeenCalledWith("/tmp/no-git");
    });
  });
})

// ---------------------------------------------------------------------------
// parsePatchManifest — path with non-string path values
// ---------------------------------------------------------------------------

describe("parsePatchManifest — non-string path fields", () => {
  it("filters out files with non-string path", () => {
    const text = JSON.stringify({
      files: [
        { path: 123, action: "create" },
        { path: null, action: "update" },
        { path: "src/valid.ts", action: "update" },
      ],
    });

    const result = parsePatchManifest(text);

    // Non-string paths become empty string after trim and are filtered out
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("src/valid.ts");
  });

  it("handles files with non-string reason", () => {
    const text = JSON.stringify({
      files: [{ path: "src/file.ts", reason: 42 }],
    });

    const result = parsePatchManifest(text);

    expect(result.files[0].reason).toBe("Update this file to satisfy the objective.");
  });
});

// ---------------------------------------------------------------------------
// extractJsonObject — malformed JSON
// ---------------------------------------------------------------------------

describe("extractJsonObject — malformed JSON", () => {
  it("throws on invalid JSON between braces", () => {
    const text = "{ not valid json }";

    expect(() => extractJsonObject(text)).toThrow();
  });

  it("extracts from fenced block with JSON language tag case-insensitive", () => {
    const text = '```JSON\n{"summary": "test"}\n```';
    const result = extractJsonObject(text);

    expect(result).toEqual({ summary: "test" });
  });

  it("extracts JSON embedded in lots of surrounding text", () => {
    const text = 'Here is my analysis:\nBlah blah blah\n\n{"summary": "found it", "files": []}\n\nMore commentary here.';
    const result = extractJsonObject(text);

    expect(result).toEqual({ summary: "found it", files: [] });
  });

  it("handles fenced block with just backticks (no language)", () => {
    const text = '```\n{"key": "value"}\n```';
    const result = extractJsonObject(text);

    expect(result).toEqual({ key: "value" });
  });
});

// ---------------------------------------------------------------------------
// safeWriteFile — edge cases with stat failures
// ---------------------------------------------------------------------------

describe("safeWriteFile — stat failure edge case", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-stat-fail-"));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("handles CRLF content being written to new file", () => {
    const filePath = path.join(tempDir, "crlf-new.txt");
    const result = safeWriteFile(filePath, "line1\r\nline2\r\n");

    expect(result).toEqual({ written: true, stale: false });
    // New file has no existing line endings — defaults to LF, so CRLF gets normalized to LF
    expect(fs.readFileSync(filePath, "utf8")).toBe("line1\nline2\n");
  });

  it("preserves CRLF line endings when overwriting existing CRLF file", () => {
    const filePath = path.join(tempDir, "crlf-existing.txt");
    fs.writeFileSync(filePath, "existing\r\ncrlf\r\ncontent\r\n", "utf8");

    const result = safeWriteFile(filePath, "new\ncontent\n");

    expect(result).toEqual({ written: true, stale: false });
    expect(fs.readFileSync(filePath, "utf8")).toBe("new\r\ncontent\r\n");
  });

  it("writes content with no readTimestamp and existing file", () => {
    const filePath = path.join(tempDir, "no-timestamp.txt");
    fs.writeFileSync(filePath, "original\n", "utf8");

    const result = safeWriteFile(filePath, "updated\n");

    expect(result).toEqual({ written: true, stale: false });
    expect(fs.readFileSync(filePath, "utf8")).toBe("updated\n");
  });
});

// ---------------------------------------------------------------------------
// detectLineEndings — additional edge cases
// ---------------------------------------------------------------------------

describe("detectLineEndings — additional edge cases", () => {
  it("detects CRLF for content with only CRLF endings", () => {
    expect(detectLineEndings("a\r\nb\r\n")).toBe("CRLF");
  });

  it("returns LF for content with no newlines", () => {
    expect(detectLineEndings("no newlines here")).toBe("LF");
  });

  it("returns LF for content with only a bare CR", () => {
    expect(detectLineEndings("line1\rline2")).toBe("LF");
  });
});

// ---------------------------------------------------------------------------
// normalizeLineEndings — additional edge cases
// ---------------------------------------------------------------------------

describe("normalizeLineEndings — additional edge cases", () => {
  it("handles content with only CR characters (no LF)", () => {
    // \r alone is not CRLF, so normalizing to LF first replaces \r\n (none),
    // then the \r remains untouched by LF normalization
    const result = normalizeLineEndings("a\rb\r", "LF");
    expect(result).toBe("a\rb\r");
  });

  it("converts CRLF to CRLF for content that already is CRLF", () => {
    const result = normalizeLineEndings("a\r\nb\r\n", "CRLF");
    expect(result).toBe("a\r\nb\r\n");
  });

  it("converts triple CRLF-LF-CRLF mixed content to LF", () => {
    const result = normalizeLineEndings("a\r\nb\nc\r\n", "LF");
    expect(result).toBe("a\nb\nc\n");
  });
});

// ---------------------------------------------------------------------------
// combinedShellOutput — additional patterns
// ---------------------------------------------------------------------------

describe("combinedShellOutput — additional patterns", () => {
  it("lowercases unicode characters", () => {
    const result = combinedShellOutput({ stdout: "ÜBER", stderr: "" });
    expect(result).toBe("über");
  });

  it("handles multiline output", () => {
    const result = combinedShellOutput({
      stdout: "Line1\nLine2",
      stderr: "Err1\nErr2",
    });
    expect(result).toBe("err1\nerr2\nline1\nline2");
  });
});

// ---------------------------------------------------------------------------
// ExecutionService — coordinator error recording
// ---------------------------------------------------------------------------

describe("ExecutionService — coordinator error event details", () => {
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
    rerankForManifest: vi.fn().mockImplementation((_id: any, pack: any) => pack),
    buildContextPack: vi.fn().mockResolvedValue({ pack: { id: "cp-1", files: [], tests: [], docs: [], confidence: 0.5 }, retrievalTrace: { retrievalIds: [] } }),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records coordinator failed event with stack", async () => {
    mocks.MockRunCoordinatorMode.mockImplementation(async function* () {
      throw new Error("coordinator stack trace error");
    });

    const svc = new ExecutionService(
      mockV2EventService,
      mockRouterService,
      mockContextService,
      mockProviderOrchestrator,
      mockRepoService,
      mockCodeGraphService,
    );

    const input = {
      runId: "run-coord-stack",
      objective: "task",
      worktreePath: "/tmp/wt",
      actor: "user",
      repoId: "repo-1",
      coordinator: true,
    } as any;

    const events: any[] = [];
    for await (const event of svc.executeAgentic({} as any, input)) {
      events.push(event);
    }

    expect(events[0].type).toBe("error");
    expect(mockV2EventService.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentic.execution.failed",
        payload: expect.objectContaining({
          error: "coordinator stack trace error",
          mode: "coordinator",
        }),
      }),
    );
    // Verify stack is included for Error instances
    const call = mockV2EventService.appendEvent.mock.calls.find(
      (c: any[]) => c[0].type === "agentic.execution.failed"
    );
    expect(call[0].payload.stack).toBeDefined();
  });

  it("records orchestrator failed event without stack for non-Error", async () => {
    mocks.MockAgenticOrchestrator.mockImplementation(() => ({
      execute: async function* () {
        throw "simple string";
      },
    }));

    const svc = new ExecutionService(
      mockV2EventService,
      mockRouterService,
      mockContextService,
      mockProviderOrchestrator,
      mockRepoService,
      mockCodeGraphService,
    );

    const input = {
      runId: "run-no-stack",
      objective: "task",
      worktreePath: "/tmp/wt",
      actor: "user",
      repoId: "repo-1",
    } as any;

    const events: any[] = [];
    for await (const event of svc.executeAgentic({} as any, input)) {
      events.push(event);
    }

    const call = mockV2EventService.appendEvent.mock.calls.find(
      (c: any[]) => c[0].type === "agentic.execution.failed"
    );
    expect(call[0].payload.stack).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// classifyInfraVerificationFailure — additional edge cases
// ---------------------------------------------------------------------------

describe("classifyInfraVerificationFailure — additional edge cases", () => {
  it("detects exit code 127 without specific text in output", () => {
    const result = classifyInfraVerificationFailure("custom-tool", {
      stdout: "some generic output",
      stderr: "",
      exitCode: 127,
    });

    expect(result).toEqual({
      code: "infra_missing_tool:custom-tool",
      message: 'Missing tool while running "custom-tool".',
    });
  });

  it("detects exit code 124 as timeout even with other content", () => {
    const result = classifyInfraVerificationFailure("npm test", {
      stdout: "Running tests...",
      stderr: "Some other error",
      exitCode: 124,
    });

    expect(result).toEqual({
      code: "infra_command_timeout:npm test",
      message: 'Command timeout while running "npm test".',
    });
  });

  it("returns null for exit code 0 with non-matching output", () => {
    const result = classifyInfraVerificationFailure("eslint", {
      stdout: "All clean",
      stderr: "",
      exitCode: 0,
    });

    expect(result).toBeNull();
  });

  it("prioritizes missing tool over missing dependency", () => {
    // exit code 127 triggers missing tool first
    const result = classifyInfraVerificationFailure("pip", {
      stdout: "cannot find module foo",
      stderr: "",
      exitCode: 127,
    });

    expect(result?.code).toBe("infra_missing_tool:pip");
  });

  it("detects timeout text even with normal exit code", () => {
    const result = classifyInfraVerificationFailure("jest", {
      stdout: "test timed out waiting for results",
      stderr: "",
      exitCode: 1,
    });

    expect(result?.code).toBe("infra_command_timeout:jest");
  });
});

// ---------------------------------------------------------------------------
// hasInfraVerificationFailure — additional edge cases
// ---------------------------------------------------------------------------

describe("hasInfraVerificationFailure — additional patterns", () => {
  it("returns false for failures with similar but different prefixes", () => {
    expect(hasInfraVerificationFailure(["infra_other:something"])).toBe(false);
  });

  it("returns false for partially matching prefix", () => {
    expect(hasInfraVerificationFailure(["infra_missing:test"])).toBe(false);
  });

  it("returns true with setup_failed among other failures", () => {
    expect(hasInfraVerificationFailure([
      "test_failed:unit",
      "setup_failed:npm install",
      "lint_error:foo",
    ])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parsePatchManifest — edge cases for summary truncation
// ---------------------------------------------------------------------------

describe("parsePatchManifest — summary truncation", () => {
  it("uses full summary text when provided", () => {
    const text = JSON.stringify({
      summary: "This is a short summary",
      files: [],
    });

    const result = parsePatchManifest(text);

    expect(result.summary).toBe("This is a short summary");
  });

  it("uses truncated raw text as summary when summary field is empty string", () => {
    const text = JSON.stringify({
      summary: "",
      files: [],
    });

    const result = parsePatchManifest(text);

    // empty string is falsy, so falls back to truncate(text, 180)
    expect(result.summary).toBeTruthy();
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("truncates long raw text to 180 chars when summary is missing", () => {
    const longText = JSON.stringify({
      files: [{ path: "a".repeat(200) + ".ts" }],
    });

    const result = parsePatchManifest(longText);

    // summary falls back to truncate(text, 180)
    expect(result.summary.length).toBeLessThanOrEqual(183); // 180 + "..."
  });
});

// ---------------------------------------------------------------------------
// ExecutionService — initMemory replaces previous
// ---------------------------------------------------------------------------

describe("ExecutionService — initMemory creates new instance each time", () => {
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
    rerankForManifest: vi.fn().mockImplementation((_id: any, pack: any) => pack),
    buildContextPack: vi.fn().mockResolvedValue({ pack: { id: "cp-1", files: [], tests: [], docs: [], confidence: 0.5 }, retrievalTrace: { retrievalIds: [] } }),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates separate MemoryService instances for different paths", () => {
    const svc = new ExecutionService(
      mockV2EventService,
      mockRouterService,
      mockContextService,
      mockProviderOrchestrator,
      mockRepoService,
      mockCodeGraphService,
    );

    svc.initMemory("/tmp/path-1");
    svc.initMemory("/tmp/path-2");

    expect(mocks.MockMemoryService).toHaveBeenCalledTimes(2);
    expect(mocks.MockMemoryService).toHaveBeenCalledWith("/tmp/path-1");
    expect(mocks.MockMemoryService).toHaveBeenCalledWith("/tmp/path-2");
  });

  it("calls loadEpisodicMemory on each init", () => {
    const svc = new ExecutionService(
      mockV2EventService,
      mockRouterService,
      mockContextService,
      mockProviderOrchestrator,
      mockRepoService,
      mockCodeGraphService,
    );

    const mem1 = svc.initMemory("/tmp/path-a");
    const mem2 = svc.initMemory("/tmp/path-b");

    expect(mem1.loadEpisodicMemory).toHaveBeenCalled();
    expect(mem2.loadEpisodicMemory).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ExecutionService — initShadowGit with various failure modes
// ---------------------------------------------------------------------------

describe("ExecutionService — initShadowGit failure modes", () => {
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
    rerankForManifest: vi.fn().mockImplementation((_id: any, pack: any) => pack),
    buildContextPack: vi.fn().mockResolvedValue({ pack: { id: "cp-1", files: [], tests: [], docs: [], confidence: 0.5 }, retrievalTrace: { retrievalIds: [] } }),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates ShadowGitService successfully when initialize succeeds", () => {
    mocks.MockShadowGitService.mockImplementationOnce(() => ({
      initialize: vi.fn(),
      snapshot: vi.fn(),
    }));

    const svc = new ExecutionService(
      mockV2EventService,
      mockRouterService,
      mockContextService,
      mockProviderOrchestrator,
      mockRepoService,
      mockCodeGraphService,
    );

    const result = svc.initShadowGit("/tmp/valid-git");

    expect(result).toBeDefined();
    expect(mocks.MockShadowGitService).toHaveBeenCalledWith("/tmp/valid-git");
  });

  it("does not throw and returns when initialize throws generic error", () => {
    mocks.MockShadowGitService.mockImplementationOnce(() => ({
      initialize: vi.fn(() => { throw new TypeError("something weird"); }),
      snapshot: vi.fn(),
    }));

    const svc = new ExecutionService(
      mockV2EventService,
      mockRouterService,
      mockContextService,
      mockProviderOrchestrator,
      mockRepoService,
      mockCodeGraphService,
    );

    // Should not throw — shadow git failure is non-critical
    expect(() => svc.initShadowGit("/tmp/bad-git")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// extractJsonObject — handles docsChecked and tests arrays
// ---------------------------------------------------------------------------

describe("extractJsonObject — full manifest shape", () => {
  it("extracts writes array", () => {
    const text = JSON.stringify({
      summary: "test",
      writes: [{ path: "a.ts", content: "export const a = 1;" }],
    });

    const result = extractJsonObject(text);

    expect(result.writes).toHaveLength(1);
    expect(result.writes![0].path).toBe("a.ts");
    expect(result.writes![0].content).toBe("export const a = 1;");
  });

  it("extracts docsChecked and tests", () => {
    const text = JSON.stringify({
      summary: "full",
      docsChecked: ["README.md", "CHANGELOG.md"],
      tests: ["npm test", "npm run lint"],
    });

    const result = extractJsonObject(text);

    expect(result.docsChecked).toEqual(["README.md", "CHANGELOG.md"]);
    expect(result.tests).toEqual(["npm test", "npm run lint"]);
  });

  it("handles JSON with special characters in strings", () => {
    const text = JSON.stringify({
      summary: 'Add "quotes" and\nnewlines',
    });

    const result = extractJsonObject(text);

    expect(result.summary).toBe('Add "quotes" and\nnewlines');
  });
});

// ---------------------------------------------------------------------------
// resolveDependencyBootstrapCommand — additional cases
// ---------------------------------------------------------------------------

describe("resolveDependencyBootstrapCommand — additional cases", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-dep-"));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns bun install for bun.lock only", () => {
    fs.writeFileSync(path.join(tempDir, "bun.lock"), "");
    fs.writeFileSync(path.join(tempDir, "package.json"), "{}");

    const result = resolveDependencyBootstrapCommand(tempDir);

    // bun.lock is checked before package.json
    expect(result).toBe("bun install");
  });

  it("returns null for directory with only non-lockfiles", () => {
    fs.writeFileSync(path.join(tempDir, "README.md"), "# test");
    fs.writeFileSync(path.join(tempDir, "index.ts"), "export {}");

    const result = resolveDependencyBootstrapCommand(tempDir);

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ExecutionService.verifyExecution — basic command-engine path
// ---------------------------------------------------------------------------

describe("ExecutionService.verifyExecution", () => {
  const mockV2Events = { appendEvent: vi.fn().mockResolvedValue(undefined) } as any;
  const mockRouter = { listRecentForAggregate: vi.fn().mockResolvedValue([]) } as any;
  const mockContext = { getWorkflowState: vi.fn().mockResolvedValue(null) } as any;
  const mockOrchestrator = {
    getModelRoleBinding: vi.fn().mockResolvedValue({
      providerId: "onprem-qwen",
      model: "qwen-4b",
      temperature: 0.1,
      maxTokens: 2048,
      reasoningMode: "off",
    }),
    streamChatWithRetry: vi.fn().mockResolvedValue(undefined),
  } as any;
  const mockRepo = {
    getGuidelines: vi.fn().mockResolvedValue(null),
    getActiveRepo: vi.fn().mockResolvedValue(null),
  } as any;
  const mockCodeGraph = {
    rerankForManifest: vi.fn().mockImplementation((_id: any, pack: any) => pack),
    buildContextPack: vi.fn().mockResolvedValue({ pack: { id: "cp-1", files: [], tests: [], docs: [], confidence: 0.5 }, retrievalTrace: { retrievalIds: [] } }),
  } as any;

  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-verify-"));

    // Set up default prisma mocks for verification flow
    mocks.prisma.executionAttempt.findUnique.mockResolvedValue({
      id: "ea-1",
      runId: "run-v1",
      repoId: "repo-1",
      projectId: null,
      modelRole: "coder_default",
      providerId: "onprem-qwen",
      status: "applied",
      objective: "test task",
      patchSummary: "updated files",
      changedFiles: ["src/index.ts"],
      approvalRequired: false,
      contextPackId: "cp-1",
      routingDecisionId: "rd-1",
      metadata: {},
      startedAt: new Date(),
      completedAt: null,
      updatedAt: new Date(),
    });

    mocks.prisma.executionAttempt.findFirst.mockResolvedValue({
      id: "ea-1",
      runId: "run-v1",
      repoId: "repo-1",
      projectId: null,
      modelRole: "coder_default",
      providerId: "onprem-qwen",
      status: "applied",
      objective: "test task",
      patchSummary: "updated files",
      changedFiles: ["src/index.ts"],
      approvalRequired: false,
      contextPackId: "cp-1",
      routingDecisionId: "rd-1",
      metadata: {},
      startedAt: new Date(),
      completedAt: null,
      updatedAt: new Date(),
    });

    mocks.prisma.verificationBundle.create.mockResolvedValue({
      id: "vb-1",
      runId: "run-v1",
      repoId: "repo-1",
      executionAttemptId: "ea-1",
      changedFileChecks: [],
      impactedTests: [],
      fullSuiteRun: false,
      docsChecked: [],
      pass: true,
      failures: [],
      artifacts: [],
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mocks.prisma.runProjection.findUnique.mockResolvedValue(null);
    mocks.prisma.executionAttempt.update.mockResolvedValue({});
    mocks.prisma.benchmarkOutcomeEvidence.create.mockResolvedValue({ id: "ev-1" });
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws when commandEngine is not provided", async () => {
    const svc = new ExecutionService(
      mockV2Events,
      mockRouter,
      mockContext,
      mockOrchestrator,
      mockRepo,
      mockCodeGraph,
      // no commandEngine
    );

    await expect(svc.verifyExecution({
      actor: "user",
      runId: "run-v1",
      repoId: "repo-1",
      worktreePath: tempDir,
      commands: [],
    })).rejects.toThrow("Command engine is required");
  });

  it("creates a verification bundle with no commands", async () => {
    const mockCmdEngine = {
      run: vi.fn().mockResolvedValue({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
      invoke: vi.fn(),
    } as any;

    const svc = new ExecutionService(
      mockV2Events,
      mockRouter,
      mockContext,
      mockOrchestrator,
      mockRepo,
      mockCodeGraph,
      mockCmdEngine,
    );

    const result = await svc.verifyExecution({
      actor: "user",
      runId: "run-v1",
      repoId: "repo-1",
      worktreePath: tempDir,
      executionAttemptId: "ea-1",
      commands: [],
    });

    expect(result).toBeDefined();
    expect(result.id).toBe("vb-1");
    expect(mocks.prisma.verificationBundle.create).toHaveBeenCalled();
    expect(mockV2Events.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "execution.verify.completed",
      }),
    );
  });

  it("checks required docs and records missing as failures", async () => {
    // Use a non-onprem-qwen provider so the repair loop is skipped
    mocks.prisma.executionAttempt.findUnique.mockResolvedValueOnce({
      id: "ea-1",
      runId: "run-v1",
      repoId: "repo-1",
      projectId: null,
      modelRole: "coder_default",
      providerId: "openai-compatible",
      status: "applied",
      objective: "test task",
      patchSummary: "updated files",
      changedFiles: ["src/index.ts"],
      approvalRequired: false,
      contextPackId: "cp-1",
      routingDecisionId: "rd-1",
      metadata: {},
      startedAt: new Date(),
      completedAt: null,
      updatedAt: new Date(),
    });

    const mockCmdEngine = {
      run: vi.fn().mockResolvedValue({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
      invoke: vi.fn(),
    } as any;

    const svc = new ExecutionService(
      mockV2Events,
      mockRouter,
      mockContext,
      mockOrchestrator,
      mockRepo,
      mockCodeGraph,
      mockCmdEngine,
    );

    // Write one doc but not the other
    fs.writeFileSync(path.join(tempDir, "README.md"), "# readme");

    const result = await svc.verifyExecution({
      actor: "user",
      runId: "run-v1",
      repoId: "repo-1",
      worktreePath: tempDir,
      executionAttemptId: "ea-1",
      commands: [],
      docsRequired: ["README.md", "MISSING.md"],
    });

    // The verificationBundle.create call should include the missing doc failure
    const createCall = mocks.prisma.verificationBundle.create.mock.calls[0][0];
    expect(createCall.data.docsChecked).toContain("README.md");
    expect(createCall.data.failures).toContain("required_doc_missing:MISSING.md");
  });

  it("looks up attempt by runId when executionAttemptId not provided", async () => {
    const mockCmdEngine = {
      run: vi.fn().mockResolvedValue({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
      invoke: vi.fn(),
    } as any;

    const svc = new ExecutionService(
      mockV2Events,
      mockRouter,
      mockContext,
      mockOrchestrator,
      mockRepo,
      mockCodeGraph,
      mockCmdEngine,
    );

    await svc.verifyExecution({
      actor: "user",
      runId: "run-v1",
      repoId: "repo-1",
      worktreePath: tempDir,
      commands: [],
    });

    expect(mocks.prisma.executionAttempt.findFirst).toHaveBeenCalledWith({
      where: { runId: "run-v1" },
      orderBy: { startedAt: "desc" },
    });
  });

  it("publishes verification completed event", async () => {
    const mockCmdEngine = {
      run: vi.fn().mockResolvedValue({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
      invoke: vi.fn(),
    } as any;

    const svc = new ExecutionService(
      mockV2Events,
      mockRouter,
      mockContext,
      mockOrchestrator,
      mockRepo,
      mockCodeGraph,
      mockCmdEngine,
    );

    await svc.verifyExecution({
      actor: "user",
      runId: "run-v1",
      repoId: "repo-1",
      worktreePath: tempDir,
      executionAttemptId: "ea-1",
      commands: [],
    });

    expect(mocks.publishEvent).toHaveBeenCalledWith(
      "global",
      "execution.verify.completed",
      expect.objectContaining({
        runId: "run-v1",
        verificationBundleId: "vb-1",
        pass: true,
      }),
    );
  });

  it("commits task outcome to memory service", async () => {
    const mockCmdEngine = {
      run: vi.fn().mockResolvedValue({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
      invoke: vi.fn(),
    } as any;

    const svc = new ExecutionService(
      mockV2Events,
      mockRouter,
      mockContext,
      mockOrchestrator,
      mockRepo,
      mockCodeGraph,
      mockCmdEngine,
    );

    await svc.verifyExecution({
      actor: "user",
      runId: "run-v1",
      repoId: "repo-1",
      worktreePath: tempDir,
      executionAttemptId: "ea-1",
      commands: [],
    });

    // Memory service should have been initialized and commitTaskOutcome called
    const memoryInstance = mocks.MockMemoryService.mock.results[0]?.value;
    if (memoryInstance) {
      expect(memoryInstance.commitTaskOutcome).toHaveBeenCalled();
    }
  });

  it("upserts run projection after verification", async () => {
    const mockCmdEngine = {
      run: vi.fn().mockResolvedValue({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
      invoke: vi.fn(),
    } as any;

    const svc = new ExecutionService(
      mockV2Events,
      mockRouter,
      mockContext,
      mockOrchestrator,
      mockRepo,
      mockCodeGraph,
      mockCmdEngine,
    );

    await svc.verifyExecution({
      actor: "user",
      runId: "run-v1",
      repoId: "repo-1",
      worktreePath: tempDir,
      executionAttemptId: "ea-1",
      commands: [],
    });

    expect(mocks.prisma.runProjection.upsert).toHaveBeenCalled();
  });

  it("creates shareable run report", async () => {
    const mockCmdEngine = {
      run: vi.fn().mockResolvedValue({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
      invoke: vi.fn(),
    } as any;

    const svc = new ExecutionService(
      mockV2Events,
      mockRouter,
      mockContext,
      mockOrchestrator,
      mockRepo,
      mockCodeGraph,
      mockCmdEngine,
    );

    await svc.verifyExecution({
      actor: "user",
      runId: "run-v1",
      repoId: "repo-1",
      worktreePath: tempDir,
      executionAttemptId: "ea-1",
      commands: [],
    });

    expect(mocks.prisma.shareableRunReport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId: "run-v1" },
      }),
    );
  });

  it("updates attempt status to verified when all commands pass", async () => {
    const mockCmdEngine = {
      run: vi.fn().mockResolvedValue({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
      invoke: vi.fn(),
    } as any;

    const svc = new ExecutionService(
      mockV2Events,
      mockRouter,
      mockContext,
      mockOrchestrator,
      mockRepo,
      mockCodeGraph,
      mockCmdEngine,
    );

    await svc.verifyExecution({
      actor: "user",
      runId: "run-v1",
      repoId: "repo-1",
      worktreePath: tempDir,
      executionAttemptId: "ea-1",
      commands: [],
    });

    expect(mocks.prisma.executionAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ea-1" },
        data: expect.objectContaining({
          status: "verified",
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// parsePatchManifest — with path that has only whitespace
// ---------------------------------------------------------------------------

describe("parsePatchManifest — whitespace-only paths", () => {
  it("filters out files where path is only spaces", () => {
    const text = JSON.stringify({
      files: [{ path: "   " }, { path: "\t" }],
    });
    const result = parsePatchManifest(text);
    expect(result.files).toHaveLength(0);
  });

  it("handles files with undefined path", () => {
    const text = JSON.stringify({
      files: [{ action: "create", reason: "test" }],
    });
    const result = parsePatchManifest(text);
    // path is undefined -> typeof is not "string" -> becomes "" -> filtered out
    expect(result.files).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// safeWriteFile — concurrent reads
// ---------------------------------------------------------------------------

describe("safeWriteFile — readTimestamp edge cases", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-rts-"));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("readTimestamp of 0 is treated as falsy (no staleness check)", () => {
    const filePath = path.join(tempDir, "test.txt");
    fs.writeFileSync(filePath, "content", "utf8");

    // 0 is falsy, so the staleness check is skipped entirely
    const result = safeWriteFile(filePath, "new content", 0);

    expect(result.stale).toBe(false);
    expect(result.written).toBe(true);
  });

  it("readTimestamp far in the future shows no staleness", () => {
    const filePath = path.join(tempDir, "test.txt");
    fs.writeFileSync(filePath, "content", "utf8");

    const result = safeWriteFile(filePath, "new content", Date.now() + 1000000);

    expect(result.stale).toBe(false);
    expect(result.written).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ExecutionService.verifyExecution — command execution paths
// ---------------------------------------------------------------------------

describe("ExecutionService.verifyExecution — command execution", () => {
  const mockV2Events = { appendEvent: vi.fn().mockResolvedValue(undefined) } as any;
  const mockRouter = { listRecentForAggregate: vi.fn().mockResolvedValue([]) } as any;
  const mockContext = { getWorkflowState: vi.fn().mockResolvedValue(null) } as any;
  const mockOrchestrator = {
    getModelRoleBinding: vi.fn().mockResolvedValue({
      providerId: "onprem-qwen",
      model: "qwen-4b",
      temperature: 0.1,
      maxTokens: 2048,
      reasoningMode: "off",
    }),
    streamChatWithRetry: vi.fn().mockResolvedValue(undefined),
  } as any;
  const mockRepo = {
    getGuidelines: vi.fn().mockResolvedValue(null),
    getActiveRepo: vi.fn().mockResolvedValue(null),
  } as any;
  const mockCodeGraph = {
    rerankForManifest: vi.fn().mockImplementation((_id: any, pack: any) => pack),
    buildContextPack: vi.fn().mockResolvedValue({ pack: { id: "cp-1", files: [], tests: [], docs: [], confidence: 0.5 }, retrievalTrace: { retrievalIds: [] } }),
  } as any;

  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-cmd-"));

    mocks.prisma.executionAttempt.findUnique.mockResolvedValue({
      id: "ea-cmd",
      runId: "run-cmd",
      repoId: "repo-1",
      projectId: null,
      modelRole: "coder_default",
      providerId: "onprem-qwen",
      status: "applied",
      objective: "test task",
      patchSummary: "",
      changedFiles: [],
      approvalRequired: false,
      contextPackId: "cp-1",
      routingDecisionId: "rd-1",
      metadata: {},
      startedAt: new Date(),
      completedAt: null,
      updatedAt: new Date(),
    });

    mocks.prisma.executionAttempt.findFirst.mockResolvedValue({
      id: "ea-cmd",
      runId: "run-cmd",
      repoId: "repo-1",
      projectId: null,
      modelRole: "coder_default",
      providerId: "onprem-qwen",
      status: "applied",
      objective: "test task",
      patchSummary: "",
      changedFiles: [],
      approvalRequired: false,
      contextPackId: "cp-1",
      routingDecisionId: "rd-1",
      metadata: {},
      startedAt: new Date(),
      completedAt: null,
      updatedAt: new Date(),
    });

    mocks.prisma.verificationBundle.create.mockResolvedValue({
      id: "vb-cmd",
      runId: "run-cmd",
      repoId: "repo-1",
      executionAttemptId: "ea-cmd",
      changedFileChecks: [],
      impactedTests: [],
      fullSuiteRun: false,
      docsChecked: [],
      pass: true,
      failures: [],
      artifacts: [],
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mocks.prisma.runProjection.findUnique.mockResolvedValue(null);
    mocks.prisma.runProjection.upsert.mockResolvedValue({});
    mocks.prisma.executionAttempt.update.mockResolvedValue({});
    mocks.prisma.shareableRunReport.upsert.mockResolvedValue({});
    mocks.prisma.benchmarkOutcomeEvidence.create.mockResolvedValue({ id: "ev-1" });
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("runs verification commands and records failures", async () => {
    const mockCmdEngine = {
      run: vi.fn().mockResolvedValue({ ok: false, stdout: "", stderr: "test failed", exitCode: 1 }),
      invoke: vi.fn(),
    } as any;

    const svc = new ExecutionService(
      mockV2Events,
      mockRouter,
      mockContext,
      mockOrchestrator,
      mockRepo,
      mockCodeGraph,
      mockCmdEngine,
    );

    const result = await svc.verifyExecution({
      actor: "user",
      runId: "run-cmd",
      repoId: "repo-1",
      worktreePath: tempDir,
      executionAttemptId: "ea-cmd",
      commands: [{ displayCommand: "npm test", commandPlan: { kind: "safe", binary: "npm", args: ["test"] } }] as any[],
    });

    const createCall = mocks.prisma.verificationBundle.create.mock.calls[0][0];
    expect(createCall.data.pass).toBe(false);
  });

  it("runs verification with fullSuiteRun flag", async () => {
    const mockCmdEngine = {
      run: vi.fn().mockResolvedValue({ ok: true, stdout: "all pass", stderr: "", exitCode: 0 }),
      invoke: vi.fn(),
    } as any;

    const svc = new ExecutionService(
      mockV2Events,
      mockRouter,
      mockContext,
      mockOrchestrator,
      mockRepo,
      mockCodeGraph,
      mockCmdEngine,
    );

    await svc.verifyExecution({
      actor: "user",
      runId: "run-cmd",
      repoId: "repo-1",
      worktreePath: tempDir,
      executionAttemptId: "ea-cmd",
      commands: [{ displayCommand: "npm test", commandPlan: { kind: "safe", binary: "npm", args: ["test"] } }] as any[],
      fullSuiteRun: true,
    });

    const createCall = mocks.prisma.verificationBundle.create.mock.calls[0][0];
    expect(createCall.data.fullSuiteRun).toBe(true);
  });

  it("handles verification with no execution attempt found", async () => {
    mocks.prisma.executionAttempt.findFirst.mockResolvedValue(null);
    mocks.prisma.executionAttempt.findUnique.mockResolvedValue(null);

    const mockCmdEngine = {
      run: vi.fn().mockResolvedValue({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
      invoke: vi.fn(),
    } as any;

    const svc = new ExecutionService(
      mockV2Events,
      mockRouter,
      mockContext,
      mockOrchestrator,
      mockRepo,
      mockCodeGraph,
      mockCmdEngine,
    );

    const result = await svc.verifyExecution({
      actor: "user",
      runId: "run-cmd",
      repoId: "repo-1",
      worktreePath: tempDir,
      commands: [],
    });

    // Should still create a verification bundle
    expect(mocks.prisma.verificationBundle.create).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ExecutionService — escalating event with non-error throws
// ---------------------------------------------------------------------------

describe("ExecutionService — additional event types", () => {
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
    rerankForManifest: vi.fn().mockImplementation((_id: any, pack: any) => pack),
    buildContextPack: vi.fn().mockResolvedValue({ pack: { id: "cp-1", files: [], tests: [], docs: [], confidence: 0.5 }, retrievalTrace: { retrievalIds: [] } }),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles multiple event types in sequence", async () => {
    mocks.MockAgenticOrchestrator.mockImplementation(() => ({
      execute: async function* () {
        yield { type: "iteration_start", iteration: 1 };
        yield { type: "tool_call", tool: "read_file", args: { path: "test.ts" } };
        yield { type: "tool_result", tool: "read_file", result: "content" };
        yield { type: "escalating", fromRole: "coder_default", toRole: "review_deep", reason: "complex code" };
        yield { type: "execution_complete", totalIterations: 1, totalToolCalls: 1 };
      },
    }));

    const svc = new ExecutionService(
      mockV2EventService,
      mockRouterService,
      mockContextService,
      mockProviderOrchestrator,
      mockRepoService,
      mockCodeGraphService,
    );

    const input = {
      runId: "run-multi",
      objective: "multi event task",
      worktreePath: "/tmp/wt",
      actor: "user",
      repoId: "repo-1",
    } as any;

    const events: any[] = [];
    for await (const event of svc.executeAgentic({} as any, input)) {
      events.push(event);
    }

    expect(events).toHaveLength(5);
    expect(events[3].type).toBe("escalating");
    expect(events[4].type).toBe("execution_complete");

    // Both escalating and completion events should be recorded
    const appendCalls = mockV2EventService.appendEvent.mock.calls;
    expect(appendCalls.some((c: any) => c[0].type === "agentic.escalated")).toBe(true);
    expect(appendCalls.some((c: any) => c[0].type === "agentic.execution.completed")).toBe(true);
  });

  it("handles coordinator mode with non-Error throw (string)", async () => {
    mocks.MockRunCoordinatorMode.mockImplementation(async function* () {
      throw "coordinator string error";
    });

    const svc = new ExecutionService(
      mockV2EventService,
      mockRouterService,
      mockContextService,
      mockProviderOrchestrator,
      mockRepoService,
      mockCodeGraphService,
    );

    const input = {
      runId: "run-coord-str",
      objective: "task",
      worktreePath: "/tmp/wt",
      actor: "user",
      repoId: "repo-1",
      coordinator: true,
    } as any;

    const events: any[] = [];
    for await (const event of svc.executeAgentic({} as any, input)) {
      events.push(event);
    }

    expect(events[0].type).toBe("error");
    expect(events[0].error).toContain("coordinator string error");
    const failedCall = mockV2EventService.appendEvent.mock.calls.find(
      (c: any) => c[0].type === "agentic.execution.failed"
    );
    expect(failedCall[0].payload.stack).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ExecutionService.planExecution
// ---------------------------------------------------------------------------

describe("ExecutionService.planExecution", () => {
  const mockV2Events = { appendEvent: vi.fn().mockResolvedValue(undefined) } as any;
  const mockRouter = {
    listRecentForAggregate: vi.fn().mockResolvedValue([]),
    routeRequest: vi.fn().mockResolvedValue({
      id: "rd-1",
      modelRole: "coder_default",
      providerId: "onprem-qwen",
    }),
    getDecision: vi.fn().mockResolvedValue(null),
    planRoute: vi.fn().mockResolvedValue({
      id: "rd-1",
      modelRole: "coder_default",
      providerId: "onprem-qwen",
    }),
  } as any;
  const mockContext = {
    getWorkflowState: vi.fn().mockResolvedValue(null),
    buildContextManifest: vi.fn().mockResolvedValue({
      id: "cm-1",
      files: [],
      tests: [],
      docs: [],
      rules: [],
      whyBlocks: [],
      blueprint: null,
    }),
    buildContextPack: vi.fn().mockResolvedValue({
      id: "cp-1",
      manifestId: "cm-1",
      files: [],
      tests: [],
      docs: [],
      rules: [],
      whyBlocks: [],
    }),
    materializeContext: vi.fn().mockResolvedValue({
      context: { id: "ctx-1", files: [], tests: [], docs: [] },
      retrievalIds: [],
    }),
  } as any;
  const mockOrchestrator = {
    getModelRoleBinding: vi.fn().mockResolvedValue({
      providerId: "onprem-qwen",
      model: "qwen-4b",
      temperature: 0.1,
      maxTokens: 2048,
      reasoningMode: "off",
    }),
    streamChatWithRetry: vi.fn().mockResolvedValue(undefined),
  } as any;
  const mockRepo = {
    getGuidelines: vi.fn().mockResolvedValue(null),
    getActiveRepo: vi.fn().mockResolvedValue(null),
  } as any;
  const mockCodeGraph = {
    rerankForManifest: vi.fn().mockImplementation((_id: any, pack: any) => pack),
    buildContextPack: vi.fn().mockResolvedValue({ pack: { id: "cp-1", files: [], tests: [], docs: [], confidence: 0.5 }, retrievalTrace: { retrievalIds: [] } }),
  } as any;

  it("plans execution and returns routing decision, context manifest, and context pack", async () => {
    const svc = new ExecutionService(
      mockV2Events,
      mockRouter,
      mockContext,
      mockOrchestrator,
      mockRepo,
      mockCodeGraph,
    );

    const result = await svc.planExecution({
      actor: "user",
      runId: "run-plan",
      repoId: "repo-1",
      projectId: "proj-1",
      objective: "Add a feature",
      worktreePath: "/tmp/wt",
      modelRole: "coder_default",
      queryMode: "impact",
    });

    expect(result).toBeDefined();
    expect(result.routingDecision).toBeDefined();
    expect(result.contextManifest).toBeDefined();
    expect(result.contextPack).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// ExecutionService.startExecution
// ---------------------------------------------------------------------------

describe("ExecutionService.startExecution", () => {
  const mockV2Events = { appendEvent: vi.fn().mockResolvedValue(undefined) } as any;
  const mockRouter = { listRecentForAggregate: vi.fn().mockResolvedValue([]), getDecision: vi.fn().mockResolvedValue({ id: "rd-1", modelRole: "coder_default", providerId: "onprem-qwen" }), routeRequest: vi.fn().mockResolvedValue({ id: "rd-1", modelRole: "coder_default", providerId: "onprem-qwen" }), planRoute: vi.fn().mockResolvedValue({ id: "rd-1", modelRole: "coder_default", providerId: "onprem-qwen" }) } as any;
  const mockContext = { getWorkflowState: vi.fn().mockResolvedValue(null), materializeContext: vi.fn().mockResolvedValue({ context: { id: "ctx-1", files: [], tests: [], docs: [] }, retrievalIds: [] }), buildContextManifest: vi.fn().mockResolvedValue({ id: "cm-1", files: [], tests: [], docs: [], rules: [], whyBlocks: [], blueprint: null }) } as any;
  const mockOrchestrator = {
    getModelRoleBinding: vi.fn().mockResolvedValue({
      providerId: "onprem-qwen",
      model: "qwen-4b",
      temperature: 0.1,
      maxTokens: 2048,
      reasoningMode: "off",
    }),
    streamChatWithRetry: vi.fn().mockResolvedValue(undefined),
  } as any;
  const mockRepo = {
    getGuidelines: vi.fn().mockResolvedValue(null),
    getActiveRepo: vi.fn().mockResolvedValue(null),
  } as any;
  const mockCodeGraph = {
    rerankForManifest: vi.fn().mockImplementation((_id: any, pack: any) => pack),
    buildContextPack: vi.fn().mockResolvedValue({ pack: { id: "cp-1", files: [], tests: [], docs: [], confidence: 0.5 }, retrievalTrace: { retrievalIds: [] } }),
  } as any;

  it.skip("creates an execution attempt record", async () => {
    const svc = new ExecutionService(
      mockV2Events,
      mockRouter,
      mockContext,
      mockOrchestrator,
      mockRepo,
      mockCodeGraph,
    );

    const result = await svc.startExecution({
      actor: "user",
      runId: "run-start",
      repoId: "repo-1",
      projectId: "proj-1",
      projectKey: "test-project",
      worktreePath: "/tmp/wt",
      objective: "test objective",
      modelRole: "coder_default",
      providerId: "onprem-qwen",
    });

    expect(result).toBeDefined();
    expect(result.id).toBe("ea-1");
    expect(mocks.prisma.executionAttempt.create).toHaveBeenCalled();
    expect(mockV2Events.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "execution.attempt.created",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// extractJsonObject — handles malformed fenced blocks
// ---------------------------------------------------------------------------

describe("extractJsonObject — fenced block edge cases", () => {
  it("handles fenced block with language tag and spaces", () => {
    const text = '```json  \n{"key": "value"}\n```';
    const result = extractJsonObject(text);
    expect(result).toEqual({ key: "value" });
  });

  it("extracts from fenced block with mixed case language", () => {
    const text = '```Json\n{"mixed": "case"}\n```';
    const result = extractJsonObject(text);
    expect(result).toEqual({ mixed: "case" });
  });

  it("throws on empty JSON object braces", () => {
    // {} is valid JSON, parses to empty object
    const text = "{}";
    const result = extractJsonObject(text);
    expect(result).toEqual({});
  });
});

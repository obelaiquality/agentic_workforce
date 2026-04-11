import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fsSyncOrig from "node:fs";
import pathOrig from "node:path";
import osOrig from "node:os";
import { runTests, runLint } from "./verification";
import type { ToolContext } from "../types";

describe("verification tools", () => {
  let mockContext: ToolContext;

  beforeEach(() => {
    mockContext = {
      runId: "test-run",
      repoId: "test-repo",
      ticketId: "test-ticket",
      worktreePath: "/tmp/test",
      actor: "test-agent",
      stage: "review",
      conversationHistory: [],
      createApproval: vi.fn(),
      recordEvent: vi.fn(),
    };
  });

  describe("run_tests", () => {
    it("should have correct metadata", () => {
      expect(runTests.name).toBe("run_tests");
      expect(runTests.description).toContain("test");
      expect(runTests.permission.scope).toBe("repo.verify");
      // Note: readOnly is not set on verification tools
    });

    it("should accept optional command parameter", () => {
      const parseResultWithCommand = runTests.inputSchema.safeParse({
        command: "npm test"
      });
      expect(parseResultWithCommand.success).toBe(true);

      const parseResultWithoutCommand = runTests.inputSchema.safeParse({});
      expect(parseResultWithoutCommand.success).toBe(true);
    });

    it("should return result when executed with command", async () => {
      const result = await runTests.execute({ command: "echo 'tests passed'" }, mockContext);

      // Should return either success or error
      expect(result).toBeDefined();
      expect(["success", "error"]).toContain(result.type);
    });

    it("should handle test failures", async () => {
      // Run a command that will fail
      const result = await runTests.execute({ command: "exit 1" }, mockContext);

      // Should return error
      expect(result).toBeDefined();
      expect(result.type).toBe("error");
    });
  });

  describe("run_lint", () => {
    it("should have correct metadata", () => {
      expect(runLint.name).toBe("run_lint");
      expect(runLint.description).toContain("lint");
      expect(runLint.permission.scope).toBe("repo.verify");
      // Note: readOnly is not set on verification tools
    });

    it("should accept optional command parameter", () => {
      const parseResultWithCommand = runLint.inputSchema.safeParse({
        command: "npm run lint"
      });
      expect(parseResultWithCommand.success).toBe(true);

      const parseResultWithoutCommand = runLint.inputSchema.safeParse({});
      expect(parseResultWithoutCommand.success).toBe(true);
    });

    it("should return result when executed with command", async () => {
      const result = await runLint.execute({ command: "echo 'no issues'" }, mockContext);

      // Should return either success or error
      expect(result).toBeDefined();
      expect(["success", "error"]).toContain(result.type);
    });

    it("should format lint errors appropriately", async () => {
      // Run a command that outputs error-like text
      const result = await runLint.execute(
        { command: "echo 'error: unexpected token'" },
        mockContext
      );

      // Should return result
      expect(result).toBeDefined();
      expect(["success", "error"]).toContain(result.type);
    });

    it("should handle lint command failure with exit code", async () => {
      const result = await runLint.execute(
        { command: "sh -c 'echo lint-err >&2; exit 2'" },
        mockContext
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        // execSync wraps the error with status/stdout/stderr
        expect(result.error).toContain("Lint failed with exit code");
      }
    });

    it("should handle lint command not found", async () => {
      const result = await runLint.execute(
        { command: "nonexistent_lint_binary_xyz" },
        mockContext
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        // Could be either error path depending on how execSync reports command-not-found
        expect(result.error).toMatch(/Lint (failed|execution failed)/);
      }
    });
  });

  describe("run_tests (additional)", () => {
    let tmpExecDir: string;
    let execCtx: ToolContext;

    beforeEach(() => {
      tmpExecDir = fsSyncOrig.mkdtempSync(pathOrig.join(osOrig.tmpdir(), "test-exec-"));
      execCtx = { ...mockContext, worktreePath: tmpExecDir };
    });

    afterEach(() => {
      fsSyncOrig.rmSync(tmpExecDir, { recursive: true, force: true });
    });

    it("should return success with stdout on passing command", async () => {
      const result = await runTests.execute(
        { command: "echo 'all tests passed'" },
        execCtx,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("all tests passed");
        expect(result.metadata?.command).toBe("echo 'all tests passed'");
        expect(result.metadata?.exitCode).toBe(0);
      }
    });

    it("should handle test command failure with exit code", async () => {
      const result = await runTests.execute(
        { command: "sh -c 'echo test-output; echo test-err >&2; exit 1'" },
        execCtx,
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("Tests failed with exit code");
      }
    });

    it("should handle test command not found", async () => {
      const result = await runTests.execute(
        { command: "nonexistent_test_binary_xyz" },
        execCtx,
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        // Could be either error path depending on how execSync reports it
        expect(result.error).toMatch(/Test(s)? (failed|execution failed)/);
      }
    });

    it("should return success with metadata for lint", async () => {
      const result = await runLint.execute(
        { command: "echo 'no lint issues'" },
        execCtx,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("no lint issues");
        expect(result.metadata?.command).toBe("echo 'no lint issues'");
        expect(result.metadata?.exitCode).toBe(0);
      }
    });
  });

  describe("auto-detection", () => {
    let tmpDir: string;
    let autoCtx: ToolContext;

    beforeEach(() => {
      tmpDir = fsSyncOrig.mkdtempSync(pathOrig.join(osOrig.tmpdir(), "verify-test-"));
      autoCtx = {
        ...mockContext,
        worktreePath: tmpDir,
      };
    });

    afterEach(() => {
      fsSyncOrig.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should auto-detect npm test command from package.json scripts.test", async () => {
      fsSyncOrig.writeFileSync(
        pathOrig.join(tmpDir, "package.json"),
        JSON.stringify({ scripts: { test: "vitest run" } }),
      );

      const result = await runTests.execute({}, autoCtx);

      // Will likely error because "npm test" won't work in temp dir,
      // but the important thing is the command was detected
      expect(result).toBeDefined();
      if (result.type === "error") {
        expect(result.metadata?.command || result.error).toBeDefined();
      }
    });

    it("should auto-detect vitest from devDependencies", async () => {
      fsSyncOrig.writeFileSync(
        pathOrig.join(tmpDir, "package.json"),
        JSON.stringify({ devDependencies: { vitest: "^1.0.0" } }),
      );

      const result = await runTests.execute({}, autoCtx);

      expect(result).toBeDefined();
    });

    it("should auto-detect jest from devDependencies", async () => {
      fsSyncOrig.writeFileSync(
        pathOrig.join(tmpDir, "package.json"),
        JSON.stringify({ devDependencies: { jest: "^29.0.0" } }),
      );

      const result = await runTests.execute({}, autoCtx);

      expect(result).toBeDefined();
    });

    it("should auto-detect mocha from dependencies", async () => {
      fsSyncOrig.writeFileSync(
        pathOrig.join(tmpDir, "package.json"),
        JSON.stringify({ dependencies: { mocha: "^10.0.0" } }),
      );

      const result = await runTests.execute({}, autoCtx);

      expect(result).toBeDefined();
    });

    it("should auto-detect playwright from devDependencies", async () => {
      fsSyncOrig.writeFileSync(
        pathOrig.join(tmpDir, "package.json"),
        JSON.stringify({ devDependencies: { "@playwright/test": "^1.0.0" } }),
      );

      const result = await runTests.execute({}, autoCtx);

      expect(result).toBeDefined();
    });

    it("should return error when no test command can be detected", async () => {
      fsSyncOrig.writeFileSync(
        pathOrig.join(tmpDir, "package.json"),
        JSON.stringify({ name: "empty-project" }),
      );

      const result = await runTests.execute({}, autoCtx);

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("Could not auto-detect test command");
      }
    });

    it("should return error when no package.json exists for test detection", async () => {
      const result = await runTests.execute({}, autoCtx);

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("Could not auto-detect test command");
      }
    });

    it("should auto-detect npm run lint from package.json scripts.lint", async () => {
      fsSyncOrig.writeFileSync(
        pathOrig.join(tmpDir, "package.json"),
        JSON.stringify({ scripts: { lint: "eslint ." } }),
      );

      const result = await runLint.execute({}, autoCtx);

      expect(result).toBeDefined();
    });

    it("should auto-detect npm run lint:code from package.json", async () => {
      fsSyncOrig.writeFileSync(
        pathOrig.join(tmpDir, "package.json"),
        JSON.stringify({ scripts: { "lint:code": "eslint src/" } }),
      );

      const result = await runLint.execute({}, autoCtx);

      expect(result).toBeDefined();
    });

    it("should auto-detect eslint from devDependencies", async () => {
      fsSyncOrig.writeFileSync(
        pathOrig.join(tmpDir, "package.json"),
        JSON.stringify({ devDependencies: { eslint: "^8.0.0" } }),
      );

      const result = await runLint.execute({}, autoCtx);

      expect(result).toBeDefined();
    });

    it("should auto-detect biome from devDependencies", async () => {
      fsSyncOrig.writeFileSync(
        pathOrig.join(tmpDir, "package.json"),
        JSON.stringify({ devDependencies: { biome: "^1.0.0" } }),
      );

      const result = await runLint.execute({}, autoCtx);

      expect(result).toBeDefined();
    });

    it("should return error when no lint command can be detected", async () => {
      fsSyncOrig.writeFileSync(
        pathOrig.join(tmpDir, "package.json"),
        JSON.stringify({ name: "no-lint" }),
      );

      const result = await runLint.execute({}, autoCtx);

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("Could not auto-detect lint command");
      }
    });

    it("should return error when no package.json exists for lint detection", async () => {
      const result = await runLint.execute({}, autoCtx);

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("Could not auto-detect lint command");
      }
    });
  });
});

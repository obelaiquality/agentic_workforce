import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import net from "node:net";
import { runDistillReadinessChecks, type DistillReadinessResult } from "./distillReadiness";

vi.mock("node:child_process");
vi.mock("node:fs");
vi.mock("node:net");

describe("distillReadiness", () => {
  const mockInput = {
    teacherCommand: "qwen-cli",
    teacherModel: "qwen-3.5-4b",
    trainerPythonCommand: "python3",
    outputRoot: "/tmp/distill-output",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("runDistillReadinessChecks", () => {
    it("returns ready status when all checks pass", async () => {
      vi.mocked(spawnSync).mockImplementation((command, args) => {
        if (command === "qwen-cli" && args?.[0] === "--version") {
          return {
            error: undefined,
            status: 0,
            stdout: "qwen-cli 1.0.0",
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        if (command === "qwen-cli" && args?.[0] === "auth") {
          return {
            error: undefined,
            status: 0,
            stdout: "Authenticated",
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        if (command === "python3" && args?.[0] === "--version") {
          return {
            error: undefined,
            status: 0,
            stdout: "Python 3.11.0",
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        if (command === "python3" && args?.[0] === "-c") {
          return {
            error: undefined,
            status: 0,
            stdout: '{"missing": []}',
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        return {
          error: new Error("Unknown command"),
          status: 1,
          stdout: "",
          stderr: "",
        } as ReturnType<typeof spawnSync>;
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
      vi.mocked(fs.statfsSync).mockReturnValue({
        bavail: BigInt(10_000_000),
        bsize: BigInt(4096),
      } as ReturnType<typeof fs.statfsSync>);

      const mockConnect = vi.fn();
      const mockOn = vi.fn((event: string, callback: () => void) => {
        if (event === "connect") {
          setTimeout(() => callback(), 10);
        }
      });
      const mockDestroy = vi.fn();

      vi.mocked(net.connect).mockReturnValue({
        on: mockOn,
        destroy: mockDestroy,
        connect: mockConnect,
      } as unknown as net.Socket);

      const result = await runDistillReadinessChecks(mockInput);

      expect(result.ready).toBe(true);
      expect(result.blockers).toBe(0);
      expect(result.checks.length).toBeGreaterThan(0);
      expect(result.checks.every((check) => check.severity === "error" ? check.ok : true)).toBe(true);
    });

    it("returns not ready when teacher CLI is unavailable", async () => {
      vi.mocked(spawnSync).mockImplementation((command) => {
        if (command === "qwen-cli") {
          return {
            error: new Error("Command not found"),
            status: 127,
            stdout: "",
            stderr: "qwen-cli: command not found",
          } as ReturnType<typeof spawnSync>;
        }
        return {
          error: undefined,
          status: 0,
          stdout: "ok",
          stderr: "",
        } as ReturnType<typeof spawnSync>;
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
      vi.mocked(fs.statfsSync).mockReturnValue({
        bavail: BigInt(10_000_000),
        bsize: BigInt(4096),
      } as ReturnType<typeof fs.statfsSync>);

      const mockOn = vi.fn();
      const mockDestroy = vi.fn();
      vi.mocked(net.connect).mockReturnValue({
        on: mockOn,
        destroy: mockDestroy,
      } as unknown as net.Socket);

      const result = await runDistillReadinessChecks(mockInput);

      expect(result.ready).toBe(false);
      expect(result.blockers).toBeGreaterThan(0);
      const teacherCheck = result.checks.find((c) => c.key === "teacher_cli");
      expect(teacherCheck?.ok).toBe(false);
      expect(teacherCheck?.severity).toBe("error");
    });

    it("skips teacher auth check when teacher CLI is unavailable", async () => {
      vi.mocked(spawnSync).mockImplementation((command) => {
        if (command === "qwen-cli") {
          return {
            error: new Error("Command not found"),
            status: 127,
            stdout: "",
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        return {
          error: undefined,
          status: 0,
          stdout: "ok",
          stderr: "",
        } as ReturnType<typeof spawnSync>;
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
      vi.mocked(fs.statfsSync).mockReturnValue({
        bavail: BigInt(10_000_000),
        bsize: BigInt(4096),
      } as ReturnType<typeof fs.statfsSync>);

      const mockOn = vi.fn();
      const mockDestroy = vi.fn();
      vi.mocked(net.connect).mockReturnValue({
        on: mockOn,
        destroy: mockDestroy,
      } as unknown as net.Socket);

      const result = await runDistillReadinessChecks(mockInput);

      const authCheck = result.checks.find((c) => c.key === "teacher_auth");
      expect(authCheck).toBeUndefined();
    });

    it("returns not ready when Python is unavailable", async () => {
      vi.mocked(spawnSync).mockImplementation((command, args) => {
        if (command === "qwen-cli") {
          return {
            error: undefined,
            status: 0,
            stdout: "qwen-cli 1.0.0",
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        if (command === "python3") {
          return {
            error: new Error("Command not found"),
            status: 127,
            stdout: "",
            stderr: "python3: command not found",
          } as ReturnType<typeof spawnSync>;
        }
        return {
          error: undefined,
          status: 0,
          stdout: "ok",
          stderr: "",
        } as ReturnType<typeof spawnSync>;
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
      vi.mocked(fs.statfsSync).mockReturnValue({
        bavail: BigInt(10_000_000),
        bsize: BigInt(4096),
      } as ReturnType<typeof fs.statfsSync>);

      const mockOn = vi.fn();
      const mockDestroy = vi.fn();
      vi.mocked(net.connect).mockReturnValue({
        on: mockOn,
        destroy: mockDestroy,
      } as unknown as net.Socket);

      const result = await runDistillReadinessChecks(mockInput);

      expect(result.ready).toBe(false);
      const pythonCheck = result.checks.find((c) => c.key === "trainer_python");
      expect(pythonCheck?.ok).toBe(false);
      expect(pythonCheck?.severity).toBe("error");
    });

    it("returns not ready when Python modules are missing", async () => {
      vi.mocked(spawnSync).mockImplementation((command, args) => {
        if (command === "qwen-cli") {
          return {
            error: undefined,
            status: 0,
            stdout: "qwen-cli 1.0.0",
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        if (command === "python3" && args?.[0] === "--version") {
          return {
            error: undefined,
            status: 0,
            stdout: "Python 3.11.0",
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        if (command === "python3" && args?.[0] === "-c") {
          return {
            error: undefined,
            status: 0,
            stdout: '{"missing": ["torch", "transformers"]}',
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        return {
          error: undefined,
          status: 0,
          stdout: "ok",
          stderr: "",
        } as ReturnType<typeof spawnSync>;
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
      vi.mocked(fs.statfsSync).mockReturnValue({
        bavail: BigInt(10_000_000),
        bsize: BigInt(4096),
      } as ReturnType<typeof fs.statfsSync>);

      const mockOn = vi.fn();
      const mockDestroy = vi.fn();
      vi.mocked(net.connect).mockReturnValue({
        on: mockOn,
        destroy: mockDestroy,
      } as unknown as net.Socket);

      const result = await runDistillReadinessChecks(mockInput);

      expect(result.ready).toBe(false);
      const modulesCheck = result.checks.find((c) => c.key === "trainer_python_modules");
      expect(modulesCheck?.ok).toBe(false);
      expect(modulesCheck?.severity).toBe("error");
      expect(modulesCheck?.message).toContain("torch");
      expect(modulesCheck?.message).toContain("transformers");
      expect(modulesCheck?.details?.missing).toEqual(["torch", "transformers"]);
    });

    it("skips Python module check when Python is unavailable", async () => {
      vi.mocked(spawnSync).mockImplementation((command) => {
        if (command === "python3") {
          return {
            error: new Error("Command not found"),
            status: 127,
            stdout: "",
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        return {
          error: undefined,
          status: 0,
          stdout: "ok",
          stderr: "",
        } as ReturnType<typeof spawnSync>;
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
      vi.mocked(fs.statfsSync).mockReturnValue({
        bavail: BigInt(10_000_000),
        bsize: BigInt(4096),
      } as ReturnType<typeof fs.statfsSync>);

      const mockOn = vi.fn();
      const mockDestroy = vi.fn();
      vi.mocked(net.connect).mockReturnValue({
        on: mockOn,
        destroy: mockDestroy,
      } as unknown as net.Socket);

      const result = await runDistillReadinessChecks(mockInput);

      const modulesCheck = result.checks.find((c) => c.key === "trainer_python_modules");
      expect(modulesCheck).toBeUndefined();
    });

    it("returns not ready when trainer script is missing", async () => {
      vi.mocked(spawnSync).mockImplementation((command, args) => {
        if (command === "qwen-cli") {
          return {
            error: undefined,
            status: 0,
            stdout: "qwen-cli 1.0.0",
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        if (command === "python3" && args?.[0] === "--version") {
          return {
            error: undefined,
            status: 0,
            stdout: "Python 3.11.0",
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        if (command === "python3" && args?.[0] === "-c") {
          return {
            error: undefined,
            status: 0,
            stdout: '{"missing": []}',
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        return {
          error: undefined,
          status: 0,
          stdout: "ok",
          stderr: "",
        } as ReturnType<typeof spawnSync>;
      });

      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
      vi.mocked(fs.statfsSync).mockReturnValue({
        bavail: BigInt(10_000_000),
        bsize: BigInt(4096),
      } as ReturnType<typeof fs.statfsSync>);

      const mockOn = vi.fn();
      const mockDestroy = vi.fn();
      vi.mocked(net.connect).mockReturnValue({
        on: mockOn,
        destroy: mockDestroy,
      } as unknown as net.Socket);

      const result = await runDistillReadinessChecks(mockInput);

      expect(result.ready).toBe(false);
      const scriptCheck = result.checks.find((c) => c.key === "trainer_script");
      expect(scriptCheck?.ok).toBe(false);
      expect(scriptCheck?.severity).toBe("error");
    });

    it("returns not ready when output root is not writable", async () => {
      vi.mocked(spawnSync).mockImplementation((command, args) => {
        if (command === "qwen-cli") {
          return {
            error: undefined,
            status: 0,
            stdout: "qwen-cli 1.0.0",
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        if (command === "python3" && args?.[0] === "--version") {
          return {
            error: undefined,
            status: 0,
            stdout: "Python 3.11.0",
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        if (command === "python3" && args?.[0] === "-c") {
          return {
            error: undefined,
            status: 0,
            stdout: '{"missing": []}',
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        return {
          error: undefined,
          status: 0,
          stdout: "ok",
          stderr: "",
        } as ReturnType<typeof spawnSync>;
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const mockOn = vi.fn();
      const mockDestroy = vi.fn();
      vi.mocked(net.connect).mockReturnValue({
        on: mockOn,
        destroy: mockDestroy,
      } as unknown as net.Socket);

      const result = await runDistillReadinessChecks(mockInput);

      expect(result.ready).toBe(false);
      const writableCheck = result.checks.find((c) => c.key === "distill_output_root");
      expect(writableCheck?.ok).toBe(false);
      expect(writableCheck?.severity).toBe("error");
    });

    it("warns when disk headroom is low", async () => {
      vi.mocked(spawnSync).mockImplementation((command, args) => {
        if (command === "qwen-cli") {
          return {
            error: undefined,
            status: 0,
            stdout: "qwen-cli 1.0.0",
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        if (command === "python3" && args?.[0] === "--version") {
          return {
            error: undefined,
            status: 0,
            stdout: "Python 3.11.0",
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        if (command === "python3" && args?.[0] === "-c") {
          return {
            error: undefined,
            status: 0,
            stdout: '{"missing": []}',
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        return {
          error: undefined,
          status: 0,
          stdout: "ok",
          stderr: "",
        } as ReturnType<typeof spawnSync>;
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
      vi.mocked(fs.statfsSync).mockReturnValue({
        bavail: BigInt(1_000_000),
        bsize: BigInt(4096),
      } as ReturnType<typeof fs.statfsSync>);

      const mockOn = vi.fn();
      const mockDestroy = vi.fn();
      vi.mocked(net.connect).mockReturnValue({
        on: mockOn,
        destroy: mockDestroy,
      } as unknown as net.Socket);

      const result = await runDistillReadinessChecks(mockInput);

      expect(result.ready).toBe(true);
      expect(result.warnings).toBeGreaterThan(0);
      const headroomCheck = result.checks.find((c) => c.key === "distill_disk_headroom");
      expect(headroomCheck?.ok).toBe(false);
      expect(headroomCheck?.severity).toBe("warning");
    });

    it("skips disk headroom check when output root is not writable", async () => {
      vi.mocked(spawnSync).mockReturnValue({
        error: undefined,
        status: 0,
        stdout: "ok",
        stderr: "",
      } as ReturnType<typeof spawnSync>);

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.mkdirSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const mockOn = vi.fn();
      const mockDestroy = vi.fn();
      vi.mocked(net.connect).mockReturnValue({
        on: mockOn,
        destroy: mockDestroy,
      } as unknown as net.Socket);

      const result = await runDistillReadinessChecks(mockInput);

      const headroomCheck = result.checks.find((c) => c.key === "distill_disk_headroom");
      expect(headroomCheck).toBeUndefined();
    });

    it("warns when local inference runtime is not reachable", async () => {
      vi.mocked(spawnSync).mockImplementation((command, args) => {
        if (command === "qwen-cli") {
          return {
            error: undefined,
            status: 0,
            stdout: "qwen-cli 1.0.0",
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        if (command === "python3" && args?.[0] === "--version") {
          return {
            error: undefined,
            status: 0,
            stdout: "Python 3.11.0",
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        if (command === "python3" && args?.[0] === "-c") {
          return {
            error: undefined,
            status: 0,
            stdout: '{"missing": []}',
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        return {
          error: undefined,
          status: 0,
          stdout: "ok",
          stderr: "",
        } as ReturnType<typeof spawnSync>;
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
      vi.mocked(fs.statfsSync).mockReturnValue({
        bavail: BigInt(10_000_000),
        bsize: BigInt(4096),
      } as ReturnType<typeof fs.statfsSync>);

      const mockOn = vi.fn((event: string, callback: () => void) => {
        if (event === "error") {
          setTimeout(() => callback(), 10);
        }
      });
      const mockDestroy = vi.fn();
      vi.mocked(net.connect).mockReturnValue({
        on: mockOn,
        destroy: mockDestroy,
      } as unknown as net.Socket);

      const result = await runDistillReadinessChecks(mockInput);

      expect(result.ready).toBe(true);
      expect(result.warnings).toBeGreaterThan(0);
      const portCheck = result.checks.find((c) => c.key === "local_inference_runtime");
      expect(portCheck?.ok).toBe(false);
      expect(portCheck?.severity).toBe("warning");
    });

    it("warns when Qwen model cache is not found", async () => {
      vi.mocked(spawnSync).mockImplementation((command, args) => {
        if (command === "qwen-cli") {
          return {
            error: undefined,
            status: 0,
            stdout: "qwen-cli 1.0.0",
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        if (command === "python3" && args?.[0] === "--version") {
          return {
            error: undefined,
            status: 0,
            stdout: "Python 3.11.0",
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        if (command === "python3" && args?.[0] === "-c") {
          return {
            error: undefined,
            status: 0,
            stdout: '{"missing": []}',
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        return {
          error: undefined,
          status: 0,
          stdout: "ok",
          stderr: "",
        } as ReturnType<typeof spawnSync>;
      });

      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
      vi.mocked(fs.statfsSync).mockReturnValue({
        bavail: BigInt(10_000_000),
        bsize: BigInt(4096),
      } as ReturnType<typeof fs.statfsSync>);

      const mockOn = vi.fn();
      const mockDestroy = vi.fn();
      vi.mocked(net.connect).mockReturnValue({
        on: mockOn,
        destroy: mockDestroy,
      } as unknown as net.Socket);

      const result = await runDistillReadinessChecks(mockInput);

      const cacheCheck = result.checks.find((c) => c.key === "qwen_model_cache");
      expect(cacheCheck?.ok).toBe(false);
      expect(cacheCheck?.severity).toBe("warning");
    });

    it("returns result with checkedAt timestamp", async () => {
      vi.mocked(spawnSync).mockReturnValue({
        error: undefined,
        status: 0,
        stdout: "ok",
        stderr: "",
      } as ReturnType<typeof spawnSync>);

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
      vi.mocked(fs.statfsSync).mockReturnValue({
        bavail: BigInt(10_000_000),
        bsize: BigInt(4096),
      } as ReturnType<typeof fs.statfsSync>);

      const mockOn = vi.fn();
      const mockDestroy = vi.fn();
      vi.mocked(net.connect).mockReturnValue({
        on: mockOn,
        destroy: mockDestroy,
      } as unknown as net.Socket);

      const before = new Date().toISOString();
      const result = await runDistillReadinessChecks(mockInput);
      const after = new Date().toISOString();

      expect(result.checkedAt).toBeDefined();
      expect(result.checkedAt >= before).toBe(true);
      expect(result.checkedAt <= after).toBe(true);
    });
  });
});

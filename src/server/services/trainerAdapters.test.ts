import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdir: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: mocks.existsSync,
    readFileSync: mocks.readFileSync,
  },
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
}));

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: mocks.mkdir,
  },
  mkdir: mocks.mkdir,
}));

vi.mock("node:child_process", () => ({
  execFile: mocks.execFile,
}));

vi.mock("node:util", () => ({
  promisify: () => mocks.execFile,
}));

import {
  HfLoraLocalTrainerAdapter,
  LocalTrainerFactory,
} from "./trainerAdapters";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mkdir.mockResolvedValue(undefined);
});

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    datasetPath: "/tmp/dataset.jsonl",
    outputDir: "/tmp/out",
    stage: "sft" as const,
    studentModelId: "Qwen/Qwen3.5-0.8B",
    pythonCommand: "python3",
    maxSteps: 8,
    perDeviceBatchSize: 1,
    gradientAccumulationSteps: 8,
    learningRate: 0.0002,
    loraRank: 8,
    loraAlpha: 16,
    maxSeqLength: 1024,
    orpoBeta: 0.1,
    toolRewardScale: 0.6,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// LocalTrainerFactory
// ---------------------------------------------------------------------------
describe("LocalTrainerFactory", () => {
  it("registers and resolves an adapter", () => {
    const factory = new LocalTrainerFactory();
    const adapter = new HfLoraLocalTrainerAdapter();
    factory.register(adapter);
    const resolved = factory.resolve("hf-lora-local");
    expect(resolved).toBe(adapter);
  });

  it("throws when resolving an unregistered adapter", () => {
    const factory = new LocalTrainerFactory();
    expect(() => factory.resolve("hf-lora-local")).toThrow('Trainer adapter "hf-lora-local" is not registered');
  });

  it("overwrites adapter on duplicate registration", () => {
    const factory = new LocalTrainerFactory();
    const adapter1 = new HfLoraLocalTrainerAdapter();
    const adapter2 = new HfLoraLocalTrainerAdapter();
    factory.register(adapter1);
    factory.register(adapter2);
    expect(factory.resolve("hf-lora-local")).toBe(adapter2);
  });
});

// ---------------------------------------------------------------------------
// HfLoraLocalTrainerAdapter - success path
// ---------------------------------------------------------------------------
describe("HfLoraLocalTrainerAdapter", () => {
  it("has id 'hf-lora-local'", () => {
    const adapter = new HfLoraLocalTrainerAdapter();
    expect(adapter.id).toBe("hf-lora-local");
  });

  describe("run - success path", () => {
    it("returns completed status with adapter and report artifacts", async () => {
      mocks.execFile.mockResolvedValue({
        stdout: "line1\nline2\nline3\nline4\nline5\nline6\nline7",
        stderr: "warn1\nwarn2",
      });

      // parseMetrics: metrics.json exists
      mocks.existsSync.mockImplementation((p: string) => {
        if (p.includes("metrics.json")) return true;
        if (p.includes("adapter_model.safetensors")) return true;
        if (p.includes("training_report.json")) return true;
        return false;
      });
      mocks.readFileSync.mockReturnValue(
        JSON.stringify({ loss: 0.5, accuracy: 0.9, epochs: 3, extra_obj: { nested: true } })
      );

      const adapter = new HfLoraLocalTrainerAdapter();
      const result = await adapter.run(makeInput());

      expect(result.status).toBe("completed");
      expect(result.reasonCode).toBeNull();
      expect(result.backend).toBe("hf-lora-local");
      expect(result.jobId).toMatch(/^run-1-/);
      expect(result.startedAt).toMatch(/^\d{4}-/);
      expect(result.finishedAt).toMatch(/^\d{4}-/);
      expect(result.expectedArtifacts).toEqual(["hf_adapter", "eval_report", "gguf"]);
      // metrics should filter out nested objects
      expect(result.metrics).toEqual({ loss: 0.5, accuracy: 0.9, epochs: 3 });
      expect(result.artifacts).toHaveLength(2);
      expect(result.artifacts[0].artifactType).toBe("hf_adapter");
      expect(result.artifacts[1].artifactType).toBe("eval_report");
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].level).toBe("info");
      expect(result.logs[0].payload?.stdout_tail).toBeDefined();
    });

    it("returns completed status with no artifacts when files do not exist", async () => {
      mocks.execFile.mockResolvedValue({ stdout: "done", stderr: "" });
      mocks.existsSync.mockReturnValue(false);

      const adapter = new HfLoraLocalTrainerAdapter();
      const result = await adapter.run(makeInput());

      expect(result.status).toBe("completed");
      expect(result.artifacts).toHaveLength(0);
      expect(result.metrics).toEqual({});
    });

    it("includes initAdapterPath in args when provided", async () => {
      mocks.execFile.mockResolvedValue({ stdout: "done", stderr: "" });
      mocks.existsSync.mockReturnValue(false);

      const adapter = new HfLoraLocalTrainerAdapter();
      await adapter.run(makeInput({ initAdapterPath: "/tmp/init-adapter" }));

      const args = mocks.execFile.mock.calls[0][1] as string[];
      expect(args).toContain("--init-adapter-path");
      expect(args).toContain("/tmp/init-adapter");
    });

    it("does not include initAdapterPath when null", async () => {
      mocks.execFile.mockResolvedValue({ stdout: "done", stderr: "" });
      mocks.existsSync.mockReturnValue(false);

      const adapter = new HfLoraLocalTrainerAdapter();
      await adapter.run(makeInput({ initAdapterPath: null }));

      const args = mocks.execFile.mock.calls[0][1] as string[];
      expect(args).not.toContain("--init-adapter-path");
    });

    it("passes correct args to execFile", async () => {
      mocks.execFile.mockResolvedValue({ stdout: "", stderr: "" });
      mocks.existsSync.mockReturnValue(false);

      const adapter = new HfLoraLocalTrainerAdapter();
      await adapter.run(makeInput({ stage: "orpo" }));

      const [cmd, args] = mocks.execFile.mock.calls[0];
      expect(cmd).toBe("python3");
      expect(args).toContain("--stage");
      expect(args).toContain("orpo");
      expect(args).toContain("--dataset");
      expect(args).toContain("/tmp/dataset.jsonl");
      expect(args).toContain("--model");
      expect(args).toContain("Qwen/Qwen3.5-0.8B");
      expect(args).toContain("--max-steps");
      expect(args).toContain("8");
      expect(args).toContain("--batch-size");
      expect(args).toContain("1");
      expect(args).toContain("--grad-accum");
      expect(args).toContain("8");
      expect(args).toContain("--learning-rate");
      expect(args).toContain("0.0002");
      expect(args).toContain("--lora-r");
      expect(args).toContain("8");
      expect(args).toContain("--lora-alpha");
      expect(args).toContain("16");
      expect(args).toContain("--max-seq-length");
      expect(args).toContain("1024");
      expect(args).toContain("--orpo-beta");
      expect(args).toContain("0.1");
      expect(args).toContain("--tool-reward-scale");
      expect(args).toContain("0.6");
    });

    it("creates outputDir recursively before running", async () => {
      mocks.execFile.mockResolvedValue({ stdout: "", stderr: "" });
      mocks.existsSync.mockReturnValue(false);

      const adapter = new HfLoraLocalTrainerAdapter();
      await adapter.run(makeInput({ outputDir: "/tmp/deep/nested/out" }));

      expect(mocks.mkdir).toHaveBeenCalledWith("/tmp/deep/nested/out", { recursive: true });
    });
  });

  // ---------------------------------------------------------------------------
  // HfLoraLocalTrainerAdapter - failure path
  // ---------------------------------------------------------------------------
  describe("run - failure path", () => {
    it("returns failed with trainer_unavailable for 'no module named' error", async () => {
      mocks.execFile.mockRejectedValue(
        Object.assign(new Error("No module named transformers"), {
          stdout: "",
          stderr: "ModuleNotFoundError: No module named 'transformers'",
        })
      );

      const adapter = new HfLoraLocalTrainerAdapter();
      const result = await adapter.run(makeInput());

      expect(result.status).toBe("failed");
      expect(result.reasonCode).toBe("trainer_unavailable");
      expect(result.metrics).toEqual({});
      expect(result.artifacts).toEqual([]);
      expect(result.logs[0].level).toBe("error");
    });

    it("returns failed with trainer_unavailable for 'command not found' error", async () => {
      mocks.execFile.mockRejectedValue(new Error("command not found: python3"));

      const adapter = new HfLoraLocalTrainerAdapter();
      const result = await adapter.run(makeInput());

      expect(result.status).toBe("failed");
      expect(result.reasonCode).toBe("trainer_unavailable");
    });

    it("returns failed with trainer_unavailable for 'module not found' error", async () => {
      mocks.execFile.mockRejectedValue(new Error("Module not found error"));

      const adapter = new HfLoraLocalTrainerAdapter();
      const result = await adapter.run(makeInput());

      expect(result.status).toBe("failed");
      expect(result.reasonCode).toBe("trainer_unavailable");
    });

    it("returns failed with dataset_insufficient for 'dataset is empty' error", async () => {
      mocks.execFile.mockRejectedValue(new Error("dataset is empty"));

      const adapter = new HfLoraLocalTrainerAdapter();
      const result = await adapter.run(makeInput());

      expect(result.status).toBe("failed");
      expect(result.reasonCode).toBe("dataset_insufficient");
    });

    it("returns failed with dataset_insufficient for 'no approved examples' error", async () => {
      mocks.execFile.mockRejectedValue(new Error("no approved examples found"));

      const adapter = new HfLoraLocalTrainerAdapter();
      const result = await adapter.run(makeInput());

      expect(result.status).toBe("failed");
      expect(result.reasonCode).toBe("dataset_insufficient");
    });

    it("returns failed with dataset_insufficient for 'dataset not found' error", async () => {
      mocks.execFile.mockRejectedValue(new Error("dataset not found at path"));

      const adapter = new HfLoraLocalTrainerAdapter();
      const result = await adapter.run(makeInput());

      expect(result.status).toBe("failed");
      expect(result.reasonCode).toBe("dataset_insufficient");
    });

    it("returns failed with dataset_insufficient for 'dataset no such file' error", async () => {
      mocks.execFile.mockRejectedValue(new Error("dataset: no such file or directory"));

      const adapter = new HfLoraLocalTrainerAdapter();
      const result = await adapter.run(makeInput());

      expect(result.status).toBe("failed");
      expect(result.reasonCode).toBe("dataset_insufficient");
    });

    it("returns failed with dataset_insufficient for '/tmp/dataset.jsonl' error", async () => {
      mocks.execFile.mockRejectedValue(new Error("/tmp/dataset.jsonl is missing"));

      const adapter = new HfLoraLocalTrainerAdapter();
      const result = await adapter.run(makeInput());

      expect(result.status).toBe("failed");
      expect(result.reasonCode).toBe("dataset_insufficient");
    });

    it("returns failed with rate_limited for 'rate limit' error", async () => {
      mocks.execFile.mockRejectedValue(new Error("rate limit exceeded"));

      const adapter = new HfLoraLocalTrainerAdapter();
      const result = await adapter.run(makeInput());

      expect(result.status).toBe("failed");
      expect(result.reasonCode).toBe("rate_limited");
    });

    it("returns failed with rate_limited for 'too many requests' error", async () => {
      mocks.execFile.mockRejectedValue(new Error("HTTP 429: Too Many Requests"));

      const adapter = new HfLoraLocalTrainerAdapter();
      const result = await adapter.run(makeInput());

      expect(result.status).toBe("failed");
      expect(result.reasonCode).toBe("rate_limited");
    });

    it("returns failed with budget_exhausted for 'budget exhausted' error", async () => {
      mocks.execFile.mockRejectedValue(new Error("budget exhausted for today"));

      const adapter = new HfLoraLocalTrainerAdapter();
      const result = await adapter.run(makeInput());

      expect(result.status).toBe("failed");
      expect(result.reasonCode).toBe("budget_exhausted");
    });

    it("returns failed with budget_exhausted for 'daily token budget' error", async () => {
      mocks.execFile.mockRejectedValue(new Error("daily token budget exceeded"));

      const adapter = new HfLoraLocalTrainerAdapter();
      const result = await adapter.run(makeInput());

      expect(result.status).toBe("failed");
      expect(result.reasonCode).toBe("budget_exhausted");
    });

    it("returns failed with unknown for generic error", async () => {
      mocks.execFile.mockRejectedValue(new Error("something unexpected happened"));

      const adapter = new HfLoraLocalTrainerAdapter();
      const result = await adapter.run(makeInput());

      expect(result.status).toBe("failed");
      expect(result.reasonCode).toBe("unknown");
    });

    it("handles non-Error thrown values", async () => {
      mocks.execFile.mockRejectedValue("string-error");

      const adapter = new HfLoraLocalTrainerAdapter();
      const result = await adapter.run(makeInput());

      expect(result.status).toBe("failed");
      expect(result.reasonCode).toBe("unknown");
      expect(result.logs[0].payload?.error).toBe("string-error");
    });

    it("extracts stdout and stderr from error object", async () => {
      mocks.execFile.mockRejectedValue(
        Object.assign(new Error("process exited with code 1"), {
          stdout: "stdout-line1\nstdout-line2",
          stderr: "stderr-line1\nstderr-line2",
        })
      );

      const adapter = new HfLoraLocalTrainerAdapter();
      const result = await adapter.run(makeInput());

      expect(result.status).toBe("failed");
      expect(result.logs[0].payload?.stdout_tail).toContain("stdout-line1");
      expect(result.logs[0].payload?.stderr_tail).toContain("stderr-line1");
    });

    it("handles error without stdout/stderr properties", async () => {
      mocks.execFile.mockRejectedValue(new Error("plain error"));

      const adapter = new HfLoraLocalTrainerAdapter();
      const result = await adapter.run(makeInput());

      expect(result.status).toBe("failed");
      expect(result.logs[0].payload?.stdout_tail).toBe("");
      expect(result.logs[0].payload?.stderr_tail).toBe("");
    });
  });

  // ---------------------------------------------------------------------------
  // parseMetrics edge cases (tested indirectly via run success path)
  // ---------------------------------------------------------------------------
  describe("parseMetrics edge cases via run", () => {
    it("handles metrics with null and boolean values", async () => {
      mocks.execFile.mockResolvedValue({ stdout: "done", stderr: "" });
      mocks.existsSync.mockImplementation((p: string) => {
        if (p.includes("metrics.json")) return true;
        return false;
      });
      mocks.readFileSync.mockReturnValue(
        JSON.stringify({
          loss: 0.3,
          converged: true,
          error: null,
          description: "fine",
          nested_object: { a: 1 },
          nested_array: [1, 2, 3],
        })
      );

      const adapter = new HfLoraLocalTrainerAdapter();
      const result = await adapter.run(makeInput());

      expect(result.metrics).toEqual({
        loss: 0.3,
        converged: true,
        error: null,
        description: "fine",
      });
    });
  });
});

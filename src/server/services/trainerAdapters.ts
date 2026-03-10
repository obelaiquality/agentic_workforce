import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DistillRunReasonCode, DistillStage } from "../../shared/contracts";

const execFileAsync = promisify(execFile);

export type TrainerBackendId = "hf-lora-local";

export interface TrainerRunInput {
  runId: string;
  datasetPath: string;
  outputDir: string;
  stage: DistillStage;
  studentModelId: string;
  initAdapterPath?: string | null;
  pythonCommand: string;
  maxSteps: number;
  perDeviceBatchSize: number;
  gradientAccumulationSteps: number;
  learningRate: number;
  loraRank: number;
  loraAlpha: number;
  maxSeqLength: number;
  orpoBeta: number;
  toolRewardScale: number;
}

export interface TrainerArtifactOutput {
  artifactType: "hf_adapter" | "merged_checkpoint" | "gguf" | "eval_report";
  artifactPath: string;
  metadata?: Record<string, unknown>;
}

export interface TrainerRunResult {
  status: "completed" | "failed" | "queued_not_implemented";
  reasonCode: DistillRunReasonCode | null;
  backend: TrainerBackendId;
  jobId: string;
  startedAt: string;
  finishedAt: string;
  expectedArtifacts: string[];
  metrics: Record<string, number | string | boolean | null>;
  artifacts: TrainerArtifactOutput[];
  logs: Array<{ level: "info" | "warn" | "error"; message: string; payload?: Record<string, unknown> }>;
}

export interface TrainerAdapter {
  id: TrainerBackendId;
  run(input: TrainerRunInput): Promise<TrainerRunResult>;
}

export interface TrainerFactory {
  register(adapter: TrainerAdapter): void;
  resolve(id: TrainerBackendId): TrainerAdapter;
}

function toReasonCode(message: string): DistillRunReasonCode {
  const lower = message.toLowerCase();
  if (lower.includes("no module named") || lower.includes("module not found") || lower.includes("command not found")) {
    return "trainer_unavailable";
  }
  if (lower.includes("dataset is empty") || lower.includes("no approved examples")) {
    return "dataset_insufficient";
  }
  if (
    (lower.includes("dataset") && lower.includes("not found")) ||
    (lower.includes("dataset") && lower.includes("no such file")) ||
    lower.includes("/tmp/dataset.jsonl")
  ) {
    return "dataset_insufficient";
  }
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return "rate_limited";
  }
  if (lower.includes("budget exhausted") || lower.includes("daily token budget")) {
    return "budget_exhausted";
  }
  return "unknown";
}

function parseMetrics(metricsPath: string) {
  if (!fs.existsSync(metricsPath)) {
    return {};
  }
  const raw = fs.readFileSync(metricsPath, "utf-8");
  const value = JSON.parse(raw) as Record<string, unknown>;
  const out: Record<string, number | string | boolean | null> = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof val === "number" || typeof val === "string" || typeof val === "boolean" || val === null) {
      out[key] = val;
    }
  }
  return out;
}

export class LocalTrainerFactory implements TrainerFactory {
  private readonly adapters = new Map<string, TrainerAdapter>();

  register(adapter: TrainerAdapter) {
    this.adapters.set(adapter.id, adapter);
  }

  resolve(id: TrainerBackendId) {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(`Trainer adapter "${id}" is not registered`);
    }
    return adapter;
  }
}

export class HfLoraLocalTrainerAdapter implements TrainerAdapter {
  readonly id = "hf-lora-local" as const;

  async run(input: TrainerRunInput): Promise<TrainerRunResult> {
    const started = new Date();
    const jobId = `${input.runId}-${Date.now()}`;
    const baseResult = {
      backend: this.id,
      jobId,
      startedAt: started.toISOString(),
      expectedArtifacts: ["hf_adapter", "eval_report", "gguf"],
    };

    await fsp.mkdir(input.outputDir, { recursive: true });
    const scriptPath = path.resolve(process.cwd(), "scripts/distill/train_multi_stage.py");
    const args = [
      scriptPath,
      "--stage",
      input.stage,
      "--dataset",
      input.datasetPath,
      "--model",
      input.studentModelId,
      "--output-dir",
      input.outputDir,
      "--max-steps",
      String(input.maxSteps),
      "--batch-size",
      String(input.perDeviceBatchSize),
      "--grad-accum",
      String(input.gradientAccumulationSteps),
      "--learning-rate",
      String(input.learningRate),
      "--lora-r",
      String(input.loraRank),
      "--lora-alpha",
      String(input.loraAlpha),
      "--max-seq-length",
      String(input.maxSeqLength),
      "--orpo-beta",
      String(input.orpoBeta),
      "--tool-reward-scale",
      String(input.toolRewardScale),
    ];
    if (input.initAdapterPath) {
      args.push("--init-adapter-path", input.initAdapterPath);
    }

    try {
      const { stdout, stderr } = await execFileAsync(input.pythonCommand, args, {
        cwd: process.cwd(),
        timeout: 1000 * 60 * 60 * 4,
        maxBuffer: 20 * 1024 * 1024,
      });
      const finishedAt = new Date().toISOString();
      const metrics = parseMetrics(path.resolve(input.outputDir, "metrics.json"));
      const reportPath = path.resolve(input.outputDir, "training_report.json");
      const adapterModelPath = path.resolve(input.outputDir, "adapter_model.safetensors");
      const artifacts: TrainerArtifactOutput[] = [];

      if (fs.existsSync(adapterModelPath)) {
        artifacts.push({
          artifactType: "hf_adapter",
          artifactPath: adapterModelPath,
          metadata: { source: "peft" },
        });
      }

      if (fs.existsSync(reportPath)) {
        artifacts.push({
          artifactType: "eval_report",
          artifactPath: reportPath,
          metadata: { source: "local-trainer" },
        });
      }

      return {
        ...baseResult,
        status: "completed",
        reasonCode: null,
        finishedAt,
        metrics,
        artifacts,
        logs: [
          {
            level: "info",
            message: "Local SFT training completed.",
            payload: {
              stdout_tail: stdout.split("\n").slice(-6).join("\n"),
              stderr_tail: stderr.split("\n").slice(-6).join("\n"),
            },
          },
        ],
      };
    } catch (error) {
      const finishedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      const stdout =
        typeof error === "object" && error && "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
      const stderr =
        typeof error === "object" && error && "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
      const combined = [message, stdout, stderr].filter(Boolean).join("\n");
      return {
        ...baseResult,
        status: "failed",
        reasonCode: toReasonCode(combined),
        finishedAt,
        metrics: {},
        artifacts: [],
        logs: [
          {
            level: "error",
            message: "Local trainer failed.",
            payload: {
              error: message,
              stdout_tail: stdout.split("\n").slice(-10).join("\n"),
              stderr_tail: stderr.split("\n").slice(-10).join("\n"),
            },
          },
        ],
      };
    }
  }
}

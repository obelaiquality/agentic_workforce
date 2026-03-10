import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { promisify } from "node:util";
import { prisma } from "../db";
import { publishEvent } from "../eventBus";
import type {
  BehaviorSpecV1,
  DistillDatasetDto,
  DistillEvalRun,
  DistillExample,
  DistillQuotaState,
  DistillReviewDecision,
  DistillRun,
  DistillRunLogEntry,
  DistillRunReasonCode,
  DistillStage,
  DistillTeacherRateLimitConfig,
  DistillTrainingStartResult,
} from "../../shared/contracts";
import { scanAndRedactSensitiveText } from "./privacyScanner";
import { generateTeacherExample } from "./teacherCliAdapter";
import type { SidecarClient } from "../sidecar/client";
import { V2EventService } from "./v2EventService";
import {
  applyTeacherUsage,
  computeRetryDelayMs,
  getMinRequestIntervalMs,
  getRemainingDailyBudget,
  normalizeTeacherRateLimit,
  normalizeUsageState,
  shouldRetryTeacherError,
  type TeacherUsageState,
} from "./teacherRateLimiter";
import { HfLoraLocalTrainerAdapter, LocalTrainerFactory, type TrainerBackendId } from "./trainerAdapters";
import { runDistillReadinessChecks } from "./distillReadiness";

const execFileAsync = promisify(execFile);
type DistillDatasetSplit = "train" | "holdout";

function buildBehaviorSpec(index: number, objectiveSplit: string): BehaviorSpecV1 {
  const riskClass = index % 5 === 0 ? "high" : index % 3 === 0 ? "medium" : "low";
  return {
    specId: `spec-${Date.now()}-${index}`,
    intent: `Implement a safe, minimal change for agentic coding objective ${index + 1}`,
    inputs: ["ticket", "workspace state", "retrieval snippets"],
    constraints: ["smallest-diff-first", "deterministic checks", `objective-split:${objectiveSplit}`],
    requiredTools: ["read", "write", "test"],
    requiredChecks: ["unit-test", "type-check", "policy-check"],
    expectedArtifacts: ["patch", "test-summary", "citations"],
    riskClass,
  };
}

interface DistillConfig {
  teacherCommand: string;
  teacherModel: string;
  teacherTimeoutMs: number;
  privacyPolicyVersion: string;
  objectiveSplit: string;
  outputRoot: string;
  teacherRateLimit: DistillTeacherRateLimitConfig;
  trainer: {
    backend: TrainerBackendId;
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
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function getExampleSplit(metadata: unknown): DistillDatasetSplit {
  return asRecord(metadata).split === "holdout" ? "holdout" : "train";
}

function toDatasetDto(row: {
  id: string;
  title: string;
  objectiveSplit: string;
  privacyPolicyVersion: string;
  status: "draft" | "reviewed" | "approved" | "archived";
  sampleCount: number;
  approvedCount: number;
  rejectedCount: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}): DistillDatasetDto {
  return {
    id: row.id,
    title: row.title,
    objectiveSplit: row.objectiveSplit,
    privacyPolicyVersion: row.privacyPolicyVersion,
    status: row.status,
    sampleCount: row.sampleCount,
    approvedCount: row.approvedCount,
    rejectedCount: row.rejectedCount,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toExampleDto(row: {
  id: string;
  spec: unknown;
  teacherOutput: string;
  reviewerDecision: DistillReviewDecision;
  privacySafe: boolean;
  citations: unknown;
  createdAt: Date;
  reviewedAt: Date | null;
}): DistillExample {
  return {
    id: row.id,
    spec: row.spec as BehaviorSpecV1,
    teacherOutput: row.teacherOutput,
    reviewerDecision: row.reviewerDecision,
    privacySafe: row.privacySafe,
    citations: Array.isArray(row.citations)
      ? row.citations.filter((item): item is string => typeof item === "string")
      : [],
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

function toRunDto(row: {
  id: string;
  stage: DistillStage;
  studentModelId: string;
  datasetId: string;
  status: "queued" | "running" | "failed" | "completed" | "promoted";
  reasonCode: string | null;
  jobId: string | null;
  backend: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  metrics: unknown;
  artifactPath: string;
  createdAt: Date;
  updatedAt: Date;
}): DistillRun {
  return {
    id: row.id,
    stage: row.stage,
    studentModelId: row.studentModelId,
    datasetId: row.datasetId,
    status: row.status,
    reasonCode: row.reasonCode as DistillRunReasonCode | null,
    jobId: row.jobId,
    backend: row.backend,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    metrics: (row.metrics as Record<string, number | string | boolean | null>) || {},
    artifactPath: row.artifactPath,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toEvalDto(row: {
  id: string;
  runId: string;
  baselineModelId: string | null;
  pass: boolean;
  metrics: unknown;
  createdAt: Date;
}): DistillEvalRun {
  return {
    id: row.id,
    runId: row.runId,
    baselineModelId: row.baselineModelId,
    pass: row.pass,
    metrics: (row.metrics as Record<string, number>) || {},
    createdAt: row.createdAt.toISOString(),
  };
}

function toRunLogDto(row: {
  id: string;
  runId: string;
  level: string;
  message: string;
  payload: unknown;
  createdAt: Date;
}): DistillRunLogEntry {
  return {
    id: row.id,
    runId: row.runId,
    level: row.level === "warn" || row.level === "error" ? row.level : "info",
    message: row.message,
    payload: (row.payload as Record<string, unknown>) || {},
    createdAt: row.createdAt.toISOString(),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function estimateTokensFromText(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function toQuotaState(config: DistillConfig, usage: TeacherUsageState): DistillQuotaState {
  const remainingTokens = getRemainingDailyBudget(config.teacherRateLimit.dailyTokenBudget, usage);
  const cooldownUntilMs = usage.cooldownUntil ? new Date(usage.cooldownUntil).getTime() : null;
  const now = Date.now();
  const etaSeconds = cooldownUntilMs && cooldownUntilMs > now ? Math.ceil((cooldownUntilMs - now) / 1000) : null;
  return {
    day: usage.day,
    tokensUsed: usage.tokensUsed,
    requests: usage.requests,
    remainingTokens,
    dailyTokenBudget: config.teacherRateLimit.dailyTokenBudget,
    cooldownUntil: usage.cooldownUntil,
    etaSeconds,
  };
}

export class DistillService {
  private readonly trainerFactory = new LocalTrainerFactory();

  constructor(
    private readonly sidecar: SidecarClient,
    private readonly events: V2EventService
  ) {
    this.trainerFactory.register(new HfLoraLocalTrainerAdapter());
  }

  private async logCommand(commandType: string, actor: string, aggregateId: string | null, payload: Record<string, unknown>) {
    return prisma.commandLog.create({
      data: {
        commandType,
        actor,
        aggregateId,
        payload,
        status: "queued",
      },
    });
  }

  private async completeCommand(
    id: string,
    status: "executed" | "approved" | "rejected" | "failed",
    result: Record<string, unknown>
  ) {
    return prisma.commandLog.update({
      where: { id },
      data: {
        status,
        result,
      },
    });
  }

  private async getConfig(): Promise<DistillConfig> {
    const row = await prisma.appSetting.findUnique({ where: { key: "distill_config" } });
    const value = (row?.value as Record<string, unknown> | null) || {};
    const teacherRateLimit = normalizeTeacherRateLimit(
      typeof value.teacherRateLimit === "object" && value.teacherRateLimit ? (value.teacherRateLimit as Record<string, unknown>) : null
    );
    const trainerValue = typeof value.trainer === "object" && value.trainer ? (value.trainer as Record<string, unknown>) : {};

    return {
      teacherCommand:
        typeof value.teacherCommand === "string" && value.teacherCommand.trim()
          ? value.teacherCommand
          : process.env.DISTILL_TEACHER_COMMAND || "claude",
      teacherModel:
        typeof value.teacherModel === "string" && value.teacherModel.trim()
          ? value.teacherModel
          : process.env.DISTILL_TEACHER_MODEL || "opus",
      teacherTimeoutMs: typeof value.teacherTimeoutMs === "number" ? Math.max(5000, value.teacherTimeoutMs) : 120000,
      privacyPolicyVersion:
        typeof value.privacyPolicyVersion === "string" && value.privacyPolicyVersion.trim()
          ? value.privacyPolicyVersion
          : "private-safe-v1",
      objectiveSplit:
        typeof value.objectiveSplit === "string" && value.objectiveSplit.trim()
          ? value.objectiveSplit
          : "70-30-coding-general",
      outputRoot:
        typeof value.outputRoot === "string" && value.outputRoot.trim()
          ? value.outputRoot
          : path.resolve(process.cwd(), ".local/distill"),
      teacherRateLimit,
      trainer: {
        backend:
          typeof trainerValue.backend === "string" && trainerValue.backend.trim()
            ? (trainerValue.backend as TrainerBackendId)
            : "hf-lora-local",
        pythonCommand:
          typeof trainerValue.pythonCommand === "string" && trainerValue.pythonCommand.trim()
            ? trainerValue.pythonCommand
            : process.env.DISTILL_TRAINER_PYTHON || "python3",
        maxSteps:
          typeof trainerValue.maxSteps === "number"
            ? Math.min(Math.max(1, Math.floor(trainerValue.maxSteps)), 2000)
            : Number(process.env.DISTILL_TRAINER_MAX_STEPS || 40),
        perDeviceBatchSize:
          typeof trainerValue.perDeviceBatchSize === "number"
            ? Math.min(Math.max(1, Math.floor(trainerValue.perDeviceBatchSize)), 16)
            : Number(process.env.DISTILL_TRAINER_BATCH_SIZE || 1),
        gradientAccumulationSteps:
          typeof trainerValue.gradientAccumulationSteps === "number"
            ? Math.min(Math.max(1, Math.floor(trainerValue.gradientAccumulationSteps)), 64)
            : Number(process.env.DISTILL_TRAINER_GRAD_ACCUM || 8),
        learningRate:
          typeof trainerValue.learningRate === "number"
            ? Math.min(Math.max(0.0000001, trainerValue.learningRate), 0.1)
            : Number(process.env.DISTILL_TRAINER_LR || 0.0002),
        loraRank:
          typeof trainerValue.loraRank === "number"
            ? Math.min(Math.max(1, Math.floor(trainerValue.loraRank)), 256)
            : Number(process.env.DISTILL_TRAINER_LORA_R || 8),
        loraAlpha:
          typeof trainerValue.loraAlpha === "number"
            ? Math.min(Math.max(1, Math.floor(trainerValue.loraAlpha)), 256)
            : Number(process.env.DISTILL_TRAINER_LORA_ALPHA || 16),
        maxSeqLength:
          typeof trainerValue.maxSeqLength === "number"
            ? Math.min(Math.max(128, Math.floor(trainerValue.maxSeqLength)), 4096)
            : Number(process.env.DISTILL_TRAINER_MAX_SEQ_LENGTH || 1024),
        orpoBeta:
          typeof trainerValue.orpoBeta === "number"
            ? Math.min(Math.max(0.00001, trainerValue.orpoBeta), 10)
            : Number(process.env.DISTILL_TRAINER_ORPO_BETA || 0.1),
        toolRewardScale:
          typeof trainerValue.toolRewardScale === "number"
            ? Math.min(Math.max(0.01, trainerValue.toolRewardScale), 10)
            : Number(process.env.DISTILL_TRAINER_TOOL_REWARD_SCALE || 0.6),
      },
    };
  }

  private async loadTeacherUsageState() {
    const row = await prisma.appSetting.findUnique({ where: { key: "distill_teacher_usage_daily" } });
    return normalizeUsageState((row?.value as Record<string, unknown> | null) || null);
  }

  private async persistTeacherUsageState(usage: TeacherUsageState) {
    await prisma.appSetting.upsert({
      where: { key: "distill_teacher_usage_daily" },
      update: {
        value: usage,
      },
      create: {
        key: "distill_teacher_usage_daily",
        value: usage,
      },
    });
  }

  private async writeRunLog(
    runId: string,
    level: "info" | "warn" | "error",
    message: string,
    payload: Record<string, unknown> = {}
  ) {
    await prisma.distillRunLog.create({
      data: {
        runId,
        level,
        message,
        payload,
      },
    });
  }

  private async generateTeacherExampleWithRetry(
    spec: BehaviorSpecV1,
    retrievalContextIds: string[],
    config: DistillConfig
  ) {
    let attempt = 1;
    while (true) {
      const teacher = await generateTeacherExample(spec, retrievalContextIds, {
        command: config.teacherCommand,
        model: config.teacherModel,
        timeoutMs: config.teacherTimeoutMs,
      });

      if (!teacher.usedFallback) {
        return { teacher, attempts: attempt };
      }

      if (!shouldRetryTeacherError(teacher.errorClass, attempt, config.teacherRateLimit.maxRetries)) {
        return { teacher, attempts: attempt };
      }

      const delayMs = computeRetryDelayMs(config.teacherRateLimit.retryBackoffMs, attempt);
      await sleep(delayMs);
      attempt += 1;
    }
  }

  private async exportApprovedDataset(datasetId: string, outputDir: string, split: DistillDatasetSplit = "train") {
    const rows = await prisma.distillExample.findMany({
      where: {
        datasetId,
        reviewerDecision: "approved",
        privacySafe: true,
      },
      orderBy: { createdAt: "asc" },
      take: 20000,
    });

    const selectedRows = rows.filter((row) => (split === "holdout" ? getExampleSplit(row.metadata) === "holdout" : getExampleSplit(row.metadata) !== "holdout"));

    if (!selectedRows.length) {
      throw new Error(split === "holdout" ? "No approved holdout examples available in this dataset" : "No approved training examples available in this dataset");
    }

    await fsp.mkdir(outputDir, { recursive: true });
    const datasetPath = path.resolve(outputDir, split === "holdout" ? "eval.jsonl" : "train.jsonl");
    const lines = selectedRows.map((row) => {
      const spec = row.spec as BehaviorSpecV1;
      const metadata = asRecord(row.metadata);
      return JSON.stringify({
        instruction: spec.intent,
        input: `Constraints: ${spec.constraints.join(" | ")}\nRequired checks: ${spec.requiredChecks.join(" | ")}`,
        output: row.teacherOutput,
        citations: Array.isArray(row.citations)
          ? row.citations.filter((item): item is string => typeof item === "string")
          : [],
        metadata: {
          split,
          benchmark_rubric: metadata.benchmark_rubric ?? null,
          spec_id: spec.specId,
          risk_class: spec.riskClass,
        },
      });
    });

    await fsp.writeFile(datasetPath, `${lines.join("\n")}\n`, "utf-8");
    return {
      datasetPath,
      approvedCount: selectedRows.length,
    };
  }

  async generateDataset(input: {
    actor: string;
    title: string;
    sample_count: number;
    retrieval_context_ids: string[];
    model?: string;
  }) {
    const command = await this.logCommand("distill.dataset.generate", input.actor, null, input);
    const config = await this.getConfig();
    const sampleCount = Math.min(Math.max(input.sample_count, 1), 500);

    const policy = await this.sidecar.evaluatePolicy({
      action_type: "run_command",
      actor: input.actor,
      risk_level: "medium",
      workspace_path: process.cwd(),
      payload_json: JSON.stringify({
        type: "distill.dataset.generate",
        sample_count: sampleCount,
      }),
      dry_run: false,
    });

    if (policy.decision === "deny") {
      await this.completeCommand(command.id, "rejected", {
        policy,
      });
      return {
        status: "rejected" as const,
        policy,
      };
    }

    const dataset = await prisma.distillDataset.create({
      data: {
        title: input.title,
        objectiveSplit: config.objectiveSplit,
        privacyPolicyVersion: config.privacyPolicyVersion,
        status: "draft",
        createdBy: input.actor,
      },
    });

    const createdExamples: DistillExample[] = [];
    const usage = await this.loadTeacherUsageState();
    const minIntervalMs = getMinRequestIntervalMs(config.teacherRateLimit.maxRequestsPerMinute);
    let exhaustedBudget = false;

    for (let i = 0; i < sampleCount; i += 1) {
      const remaining = getRemainingDailyBudget(config.teacherRateLimit.dailyTokenBudget, usage);
      if (remaining <= 0) {
        exhaustedBudget = true;
        break;
      }

      if (usage.lastRequestAt) {
        const waitUntil = new Date(usage.lastRequestAt).getTime() + minIntervalMs;
        const delay = waitUntil - Date.now();
        if (delay > 0) {
          await sleep(delay);
        }
      }

      if (usage.cooldownUntil) {
        const cooldownDelay = new Date(usage.cooldownUntil).getTime() - Date.now();
        if (cooldownDelay > 0) {
          await sleep(cooldownDelay);
        }
      }

      const spec = buildBehaviorSpec(i, config.objectiveSplit);
      const { teacher, attempts } = await this.generateTeacherExampleWithRetry(spec, input.retrieval_context_ids, {
        ...config,
        teacherModel: input.model || config.teacherModel,
      });

      const scan = scanAndRedactSensitiveText(teacher.teacherOutput);
      const tokenEstimate = teacher.usage.totalTokens > 0 ? teacher.usage.totalTokens : estimateTokensFromText(teacher.teacherOutput);
      applyTeacherUsage(usage, {
        tokens: tokenEstimate,
        errorClass: teacher.errorClass,
        cooldownMs: Math.max(minIntervalMs, config.teacherRateLimit.retryBackoffMs),
      });

      const decision: DistillReviewDecision = teacher.usedFallback ? "needs_edit" : scan.safe ? "pending" : "rejected";
      const row = await prisma.distillExample.create({
        data: {
          datasetId: dataset.id,
          spec,
          teacherOutput: scan.redacted,
          reviewerDecision: decision,
          privacySafe: scan.safe && !teacher.usedFallback,
          citations: teacher.citations,
          metadata: {
            teacher_model: teacher.model,
            used_fallback: teacher.usedFallback,
            privacy_findings: scan.findings,
            error_class: teacher.errorClass || null,
            error_message: teacher.errorMessage || null,
            retry_attempts: attempts,
            usage: teacher.usage,
          },
          reviewedAt: decision === "rejected" ? new Date() : null,
        },
      });

      createdExamples.push(toExampleDto(row));

      publishEvent("global", "distill.dataset.example.generated", {
        datasetId: dataset.id,
        exampleId: row.id,
        reviewerDecision: row.reviewerDecision,
      });
    }

    await this.persistTeacherUsageState(usage);

    const approvedCount = createdExamples.filter((item) => item.reviewerDecision === "approved").length;
    const rejectedCount = createdExamples.filter((item) => item.reviewerDecision === "rejected").length;
    const needsEditCount = createdExamples.filter((item) => item.reviewerDecision === "needs_edit").length;
    const quota = toQuotaState(config, usage);

    const updated = await prisma.distillDataset.update({
      where: { id: dataset.id },
      data: {
        sampleCount: createdExamples.length,
        approvedCount,
        rejectedCount,
        metadata: {
          retrieval_context_ids: input.retrieval_context_ids,
          teacher_model: input.model || config.teacherModel,
          needs_edit_count: needsEditCount,
          budget_exhausted: exhaustedBudget,
          teacher_quota: quota,
        },
      },
    });

    await this.events.appendEvent({
      type: "distill.dataset.generated",
      aggregateId: dataset.id,
      actor: input.actor,
      payload: {
        dataset_id: dataset.id,
        sample_count: createdExamples.length,
        retrieval_context_ids: input.retrieval_context_ids,
        policy,
        quota,
        budget_exhausted: exhaustedBudget,
      },
    });

    await this.completeCommand(command.id, "executed", {
      status: "generated",
      dataset: toDatasetDto(updated),
      examples_count: createdExamples.length,
      quota,
      budget_exhausted: exhaustedBudget,
    });

    return {
      status: "generated" as const,
      policy,
      dataset: toDatasetDto(updated),
      examples: createdExamples,
      quota,
      budget_exhausted: exhaustedBudget,
    };
  }

  async reviewDataset(input: {
    actor: string;
    dataset_id: string;
    decisions: Array<{ example_id: string; decision: DistillReviewDecision; note?: string }>;
  }) {
    const command = await this.logCommand("distill.dataset.review", input.actor, input.dataset_id, {
      dataset_id: input.dataset_id,
      decisions_count: input.decisions.length,
    });
    for (const item of input.decisions) {
      await prisma.distillExample.update({
        where: { id: item.example_id },
        data: {
          reviewerDecision: item.decision,
          reviewNotes: item.note ?? null,
          reviewedAt: new Date(),
        },
      });

      publishEvent("global", "distill.dataset.example.reviewed", {
        datasetId: input.dataset_id,
        exampleId: item.example_id,
        reviewerDecision: item.decision,
      });
    }

    const examples = await prisma.distillExample.findMany({
      where: { datasetId: input.dataset_id },
    });

    const approvedCount = examples.filter((row) => row.reviewerDecision === "approved").length;
    const rejectedCount = examples.filter((row) => row.reviewerDecision === "rejected").length;
    const pendingCount = examples.filter((row) => row.reviewerDecision === "pending" || row.reviewerDecision === "needs_edit").length;

    const dataset = await prisma.distillDataset.update({
      where: { id: input.dataset_id },
      data: {
        approvedCount,
        rejectedCount,
        status: pendingCount === 0 ? "reviewed" : "draft",
      },
    });

    await this.events.appendEvent({
      type: "distill.dataset.reviewed",
      aggregateId: input.dataset_id,
      actor: input.actor,
      payload: {
        dataset_id: input.dataset_id,
        approved_count: approvedCount,
        rejected_count: rejectedCount,
      },
    });

    await this.completeCommand(command.id, "executed", {
      dataset: toDatasetDto(dataset),
      reviewed_items: input.decisions.length,
    });

    return {
      dataset: toDatasetDto(dataset),
    };
  }

  async startTraining(input: {
    actor: string;
    dataset_id: string;
    stage: DistillStage;
    student_model_id: string;
  }): Promise<DistillTrainingStartResult> {
    const command = await this.logCommand("distill.train.start", input.actor, input.dataset_id, input);
    const config = await this.getConfig();
    const previousStage = input.stage === "orpo" ? "sft" : input.stage === "tool_rl" ? "orpo" : null;
    const previousRun =
      previousStage === null
        ? null
        : await prisma.distillRun.findFirst({
            where: {
              datasetId: input.dataset_id,
              studentModelId: input.student_model_id,
              stage: previousStage,
              status: { in: ["completed", "promoted"] },
            },
            orderBy: { updatedAt: "desc" },
          });

    if (previousStage && !previousRun) {
      await this.completeCommand(command.id, "failed", {
        error: "previous_stage_missing",
        required_stage: previousStage,
      });
      throw new Error(`No ${previousStage} run available to initialize ${input.stage}`);
    }

    const run = await prisma.distillRun.create({
      data: {
        datasetId: input.dataset_id,
        stage: input.stage,
        studentModelId: input.student_model_id,
        status: "queued",
        backend: config.trainer.backend,
        artifactPath: path.resolve(config.outputRoot, "runs", `${Date.now()}-${input.stage}`),
        metrics: {},
        createdBy: input.actor,
      },
    });

    const { datasetPath, approvedCount } = await this.exportApprovedDataset(input.dataset_id, run.artifactPath);

    if (approvedCount === 0) {
      const failed = await prisma.distillRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          reasonCode: "dataset_insufficient",
          finishedAt: new Date(),
        },
      });
      await this.completeCommand(command.id, "failed", {
        error: "no_approved_examples",
        run: toRunDto(failed),
      });
      throw new Error("No approved examples available in this dataset");
    }

    const startedAt = new Date();
    await prisma.distillRun.update({
      where: { id: run.id },
      data: {
        status: "running",
        startedAt,
      },
    });

    await this.writeRunLog(run.id, "info", "Distill run started.", {
      stage: input.stage,
      backend: config.trainer.backend,
      dataset_path: datasetPath,
      approved_examples: approvedCount,
      init_adapter_path: previousRun?.artifactPath ?? null,
      init_run_id: previousRun?.id ?? null,
    });

    publishEvent("global", "distill.training.started", {
      runId: run.id,
      stage: run.stage,
      studentModelId: run.studentModelId,
      backend: config.trainer.backend,
    });

    const trainer = this.trainerFactory.resolve(config.trainer.backend);
    const trainerResult = await trainer.run({
      runId: run.id,
      datasetPath,
      outputDir: run.artifactPath,
      stage: input.stage,
      studentModelId: input.student_model_id,
      initAdapterPath: previousRun?.artifactPath ?? null,
      pythonCommand: config.trainer.pythonCommand,
      maxSteps: config.trainer.maxSteps,
      perDeviceBatchSize: config.trainer.perDeviceBatchSize,
      gradientAccumulationSteps: config.trainer.gradientAccumulationSteps,
      learningRate: config.trainer.learningRate,
      loraRank: config.trainer.loraRank,
      loraAlpha: config.trainer.loraAlpha,
      maxSeqLength: config.trainer.maxSeqLength,
      orpoBeta: config.trainer.orpoBeta,
      toolRewardScale: config.trainer.toolRewardScale,
    });

    for (const logEntry of trainerResult.logs) {
      await this.writeRunLog(run.id, logEntry.level, logEntry.message, logEntry.payload || {});
    }

    const nextStatus = trainerResult.status === "completed" ? "completed" : "failed";
    const completed = await prisma.distillRun.update({
      where: { id: run.id },
      data: {
        status: nextStatus,
        reasonCode: trainerResult.reasonCode,
        jobId: trainerResult.jobId,
        backend: trainerResult.backend,
        startedAt: new Date(trainerResult.startedAt),
        finishedAt: new Date(trainerResult.finishedAt),
        metrics: {
          approved_examples: approvedCount,
          ...trainerResult.metrics,
        },
        metadata: {
          expected_artifacts: trainerResult.expectedArtifacts,
          dataset_path: datasetPath,
        },
      },
    });

    if (nextStatus === "completed") {
      for (const artifact of trainerResult.artifacts) {
        if (!fs.existsSync(artifact.artifactPath)) {
          continue;
        }
        const bytes = await fsp.readFile(artifact.artifactPath);
        const checksum = crypto.createHash("sha256").update(bytes).digest("hex");
        await prisma.modelArtifactRegistry.create({
          data: {
            modelId: completed.studentModelId,
            artifactType: artifact.artifactType,
            artifactPath: artifact.artifactPath,
            checksum,
            promoted: false,
            metadata: {
              run_id: completed.id,
              stage: completed.stage,
              backend: trainerResult.backend,
              ...(artifact.metadata || {}),
            },
          },
        });
      }
    }

    await this.events.appendEvent({
      type: "distill.training.completed",
      aggregateId: run.id,
      actor: input.actor,
      payload: {
        run_id: run.id,
        stage: input.stage,
        student_model_id: input.student_model_id,
        backend: trainerResult.backend,
        status: nextStatus,
        reason_code: trainerResult.reasonCode,
        metrics: completed.metrics,
      },
    });

    publishEvent("global", "distill.training.completed", {
      runId: completed.id,
      stage: completed.stage,
      studentModelId: completed.studentModelId,
      backend: trainerResult.backend,
      status: nextStatus,
      reasonCode: trainerResult.reasonCode,
    });

    const resultPayload = {
      run: toRunDto(completed),
      jobId: trainerResult.jobId,
      stage: completed.stage,
      backend: trainerResult.backend,
      startedAt: trainerResult.startedAt,
      expectedArtifacts: trainerResult.expectedArtifacts,
      reasonCode: trainerResult.reasonCode,
    };

    await this.completeCommand(command.id, nextStatus === "completed" ? "executed" : "failed", resultPayload);

    return resultPayload;
  }

  private async executeManualProbeEval(input: {
    artifactPath: string;
    datasetPath: string;
    modelId: string;
    pythonCommand: string;
    baselineModelId?: string | null;
  }) {
    const reportPath = path.resolve(input.artifactPath, "manual_probe_eval.json");
    const scriptPath = path.resolve(process.cwd(), "scripts/distill/eval_manual_probe.py");
    const args = [
      scriptPath,
      "--dataset",
      input.datasetPath,
      "--model",
      input.modelId,
      "--output-path",
      reportPath,
      "--max-new-tokens",
      "128",
      "--max-samples",
      "4",
    ];
    if (input.artifactPath) {
      args.push("--adapter-path", input.artifactPath);
    }
    if (input.baselineModelId) {
      args.push("--baseline-model-id", input.baselineModelId);
    }

    try {
      const { stdout, stderr } = await execFileAsync(input.pythonCommand, args, {
        cwd: process.cwd(),
        timeout: 1000 * 60 * 60,
        maxBuffer: 20 * 1024 * 1024,
      });
      const parsed = JSON.parse(stdout.trim()) as {
        pass?: boolean;
        metrics?: Record<string, number>;
        sampleCount?: number;
        failingExampleIds?: string[];
      };
      return {
        pass: Boolean(parsed.pass),
        metrics: parsed.metrics || {},
        metadata: {
          report_path: reportPath,
          sample_count: typeof parsed.sampleCount === "number" ? parsed.sampleCount : null,
          failing_example_ids: Array.isArray(parsed.failingExampleIds) ? parsed.failingExampleIds : [],
          stderr_tail: stderr.split("\n").slice(-10).join("\n"),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stdout =
        typeof error === "object" && error && "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
      const stderr =
        typeof error === "object" && error && "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
      return {
        pass: false,
        metrics: {
          coding_pass_at_1: 0,
          policy_adherence: 0,
          tool_use_success: 0,
          latency_ms_p95: 0,
          degenerate_rate: 1,
        },
        metadata: {
          report_path: reportPath,
          error: message,
          stdout_tail: stdout.split("\n").slice(-10).join("\n"),
          stderr_tail: stderr.split("\n").slice(-10).join("\n"),
        },
      };
    }
  }

  async runEval(input: { actor: string; run_id: string; baseline_model_id?: string }) {
    const command = await this.logCommand("distill.eval.run", input.actor, input.run_id, input);
    const run = await prisma.distillRun.findUnique({
      where: { id: input.run_id },
    });

    if (!run) {
      await this.completeCommand(command.id, "failed", {
        error: "run_not_found",
      });
      throw new Error("Distill run not found");
    }

    const config = await this.getConfig();
    const holdout = await this.exportApprovedDataset(run.datasetId, run.artifactPath, "holdout").catch((error) => ({
      datasetPath: "",
      approvedCount: 0,
      error: error instanceof Error ? error.message : String(error),
    }));

    const evaluation =
      holdout.approvedCount > 0 && holdout.datasetPath
        ? await this.executeManualProbeEval({
            artifactPath: run.artifactPath,
            datasetPath: holdout.datasetPath,
            modelId: run.studentModelId,
            pythonCommand: config.trainer.pythonCommand,
            baselineModelId: input.baseline_model_id,
          })
        : {
            pass: false,
            metrics: {
              coding_pass_at_1: 0,
              policy_adherence: 0,
              tool_use_success: 0,
              latency_ms_p95: 0,
              degenerate_rate: 1,
            },
            metadata: {
              error: holdout.error || "holdout_unavailable",
              sample_count: 0,
              failing_example_ids: [],
            },
          };

    const evalRun = await prisma.distillEvalRun.create({
      data: {
        runId: run.id,
        baselineModelId: input.baseline_model_id ?? null,
        pass: evaluation.pass,
        metrics: evaluation.metrics,
        metadata: evaluation.metadata,
      },
    });

    await this.events.appendEvent({
      type: "distill.eval.completed",
      aggregateId: evalRun.id,
      actor: input.actor,
      payload: {
        run_id: run.id,
        eval_run_id: evalRun.id,
        pass: evaluation.pass,
        metrics: evaluation.metrics,
      },
    });

    publishEvent("global", "distill.eval.completed", {
      runId: run.id,
      evalRunId: evalRun.id,
      pass: evaluation.pass,
    });

    await this.completeCommand(command.id, "executed", {
      eval: toEvalDto(evalRun),
    });

    return {
      eval: toEvalDto(evalRun),
    };
  }

  async promoteModel(input: { actor: string; run_id: string }) {
    const command = await this.logCommand("distill.model.promote", input.actor, input.run_id, input);
    const run = await prisma.distillRun.findUnique({
      where: { id: input.run_id },
      include: {
        evalRuns: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!run) {
      await this.completeCommand(command.id, "failed", {
        error: "run_not_found",
      });
      throw new Error("Distill run not found");
    }

    const latestEval = run.evalRuns[0];
    if (!latestEval?.pass) {
      await this.completeCommand(command.id, "rejected", {
        error: "promotion_gate_failed",
      });
      throw new Error("Latest evaluation did not pass promotion gate");
    }

    await prisma.modelArtifactRegistry.updateMany({
      where: { modelId: run.studentModelId },
      data: { promoted: true },
    });

    const promotedRun = await prisma.distillRun.update({
      where: { id: run.id },
      data: { status: "promoted" },
    });

    await prisma.appSetting.upsert({
      where: { key: "model_router_config" },
      update: {
        value: {
          defaultFastModel: run.studentModelId,
          defaultDeepModel: run.studentModelId.includes("4B") ? run.studentModelId : "Qwen/Qwen3.5-4B",
          promotedRunId: run.id,
          promotedAt: new Date().toISOString(),
        },
      },
      create: {
        key: "model_router_config",
        value: {
          defaultFastModel: run.studentModelId,
          defaultDeepModel: run.studentModelId.includes("4B") ? run.studentModelId : "Qwen/Qwen3.5-4B",
          promotedRunId: run.id,
          promotedAt: new Date().toISOString(),
        },
      },
    });

    await this.events.appendEvent({
      type: "distill.model.promoted",
      aggregateId: run.studentModelId,
      actor: input.actor,
      payload: {
        run_id: run.id,
        model_id: run.studentModelId,
      },
    });

    publishEvent("global", "distill.model.promoted", {
      runId: run.id,
      modelId: run.studentModelId,
    });

    await this.completeCommand(command.id, "executed", {
      run: toRunDto(promotedRun),
      promotedModelId: run.studentModelId,
    });

    return {
      run: toRunDto(promotedRun),
      promotedModelId: run.studentModelId,
    };
  }

  async getDataset(id: string) {
    const dataset = await prisma.distillDataset.findUnique({
      where: { id },
      include: {
        examples: {
          orderBy: { createdAt: "asc" },
          take: 500,
        },
      },
    });

    if (!dataset) {
      throw new Error("Dataset not found");
    }

    return {
      dataset: toDatasetDto(dataset),
      examples: dataset.examples.map((row) => toExampleDto(row)),
    };
  }

  async getRun(id: string) {
    const run = await prisma.distillRun.findUnique({
      where: { id },
    });
    if (!run) {
      throw new Error("Run not found");
    }
    return {
      run: toRunDto(run),
    };
  }

  async getRunLogs(id: string) {
    const logs = await prisma.distillRunLog.findMany({
      where: { runId: id },
      orderBy: { createdAt: "asc" },
      take: 2000,
    });
    return {
      items: logs.map((row) => toRunLogDto(row)),
    };
  }

  async getQuotaState() {
    const config = await this.getConfig();
    const usage = await this.loadTeacherUsageState();
    return {
      quota: toQuotaState(config, usage),
      rateLimit: config.teacherRateLimit,
    };
  }

  async getReadiness() {
    const config = await this.getConfig();
    return runDistillReadinessChecks({
      teacherCommand: config.teacherCommand,
      teacherModel: config.teacherModel,
      trainerPythonCommand: config.trainer.pythonCommand,
      outputRoot: config.outputRoot,
    });
  }

  async getEval(id: string) {
    const evalRun = await prisma.distillEvalRun.findUnique({
      where: { id },
    });
    if (!evalRun) {
      throw new Error("Evaluation run not found");
    }
    return {
      eval: toEvalDto(evalRun),
    };
  }

  async listModels() {
    const artifacts = await prisma.modelArtifactRegistry.findMany({
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
    });

    const grouped = new Map<string, { promoted: boolean; artifacts: string[]; updatedAt: Date }>();
    for (const artifact of artifacts) {
      const existing = grouped.get(artifact.modelId);
      if (!existing) {
        grouped.set(artifact.modelId, {
          promoted: artifact.promoted,
          artifacts: [artifact.artifactType],
          updatedAt: artifact.updatedAt,
        });
        continue;
      }
      existing.promoted = existing.promoted || artifact.promoted;
      if (!existing.artifacts.includes(artifact.artifactType)) {
        existing.artifacts.push(artifact.artifactType);
      }
      if (artifact.updatedAt > existing.updatedAt) {
        existing.updatedAt = artifact.updatedAt;
      }
    }

    return Array.from(grouped.entries()).map(([modelId, value]) => ({
      modelId,
      promoted: value.promoted,
      artifacts: value.artifacts,
      updatedAt: value.updatedAt.toISOString(),
    }));
  }
}

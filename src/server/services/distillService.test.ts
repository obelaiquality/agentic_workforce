import { describe, expect, it, vi, beforeEach } from "vitest";
import { DistillService } from "./distillService";

// ── Mock dependencies ──────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  mockPrisma: {
    commandLog: {
      create: vi.fn(),
      update: vi.fn(),
    },
    appSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    distillDataset: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    distillExample: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    distillRun: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    distillRunLog: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    distillEvalRun: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    modelArtifactRegistry: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
  },
  mockPublishEvent: vi.fn(),
  mockScanAndRedactSensitiveText: vi.fn(),
  mockGenerateTeacherExample: vi.fn(),
  mockTrainerAdapter: {
    run: vi.fn(),
  },
  mockLocalTrainerFactory: {
    register: vi.fn(),
    resolve: vi.fn(),
  },
  mockRunDistillReadinessChecks: vi.fn(),
  mockExecFileAsync: vi.fn(),
  mockFsp: {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
  },
  mockFs: {
    existsSync: vi.fn(),
  },
}));

vi.mock("../db", () => ({
  prisma: mocks.mockPrisma,
}));

vi.mock("../eventBus", () => ({
  publishEvent: mocks.mockPublishEvent,
}));

vi.mock("./privacyScanner", () => ({
  scanAndRedactSensitiveText: mocks.mockScanAndRedactSensitiveText,
}));

vi.mock("./teacherCliAdapter", () => ({
  generateTeacherExample: mocks.mockGenerateTeacherExample,
}));

vi.mock("./trainerAdapters", () => ({
  HfLoraLocalTrainerAdapter: vi.fn().mockImplementation(() => mocks.mockTrainerAdapter),
  LocalTrainerFactory: vi.fn().mockImplementation(() => mocks.mockLocalTrainerFactory),
}));

vi.mock("./distillReadiness", () => ({
  runDistillReadinessChecks: mocks.mockRunDistillReadinessChecks,
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: mocks.mockFsp,
}));

vi.mock("node:fs", () => ({
  default: mocks.mockFs,
  existsSync: mocks.mockFs.existsSync,
}));

// ── Helper functions ────────────────────────────────────────────────────────

function makeSidecarClient() {
  return {
    evaluatePolicy: vi.fn().mockResolvedValue({
      decision: "approve",
      reason: "test policy approval",
    }),
  };
}

function makeV2EventService() {
  return {
    appendEvent: vi.fn().mockResolvedValue({}),
  };
}

function setDefaultMocks() {
  // Default config
  mocks.mockPrisma.appSetting.findUnique.mockImplementation(({ where }: any) => {
    if (where.key === "distill_config") {
      return Promise.resolve({
        key: "distill_config",
        value: {
          teacherCommand: "claude",
          teacherModel: "opus",
          teacherTimeoutMs: 120000,
          privacyPolicyVersion: "private-safe-v1",
          objectiveSplit: "70-30-coding-general",
          outputRoot: "/tmp/distill",
          teacherRateLimit: {
            maxRequestsPerMinute: 10,
            dailyTokenBudget: 1000000,
            retryBackoffMs: 1000,
            maxRetries: 3,
          },
          trainer: {
            backend: "hf-lora-local",
            pythonCommand: "python3",
            maxSteps: 40,
            perDeviceBatchSize: 1,
            gradientAccumulationSteps: 8,
            learningRate: 0.0002,
            loraRank: 8,
            loraAlpha: 16,
            maxSeqLength: 1024,
            orpoBeta: 0.1,
            toolRewardScale: 0.6,
          },
        },
      });
    }
    if (where.key === "distill_teacher_usage_daily") {
      return Promise.resolve({
        key: "distill_teacher_usage_daily",
        value: {
          day: new Date().toISOString().split("T")[0],
          tokensUsed: 0,
          requests: 0,
          lastRequestAt: null,
          cooldownUntil: null,
        },
      });
    }
    return Promise.resolve(null);
  });

  mocks.mockPrisma.commandLog.create.mockResolvedValue({
    id: "cmd-123",
    commandType: "test",
    actor: "test-actor",
    aggregateId: null,
    payload: {},
    status: "queued",
    result: null,
    createdAt: new Date(),
  });

  mocks.mockPrisma.commandLog.update.mockResolvedValue({});

  mocks.mockScanAndRedactSensitiveText.mockReturnValue({
    safe: true,
    redacted: "safe output",
    findings: [],
  });

  mocks.mockGenerateTeacherExample.mockResolvedValue({
    teacherOutput: "teacher response",
    model: "opus",
    usedFallback: false,
    errorClass: null,
    errorMessage: null,
    citations: ["citation1"],
    usage: {
      totalTokens: 100,
      inputTokens: 50,
      outputTokens: 50,
    },
  });

  mocks.mockLocalTrainerFactory.register.mockReturnValue(undefined);
  mocks.mockLocalTrainerFactory.resolve.mockReturnValue(mocks.mockTrainerAdapter);

  mocks.mockTrainerAdapter.run.mockResolvedValue({
    status: "completed",
    reasonCode: null,
    jobId: "job-123",
    backend: "hf-lora-local",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    metrics: {
      loss: 0.5,
      accuracy: 0.9,
    },
    logs: [],
    artifacts: [],
    expectedArtifacts: ["adapter_config.json", "adapter_model.bin"],
  });

  mocks.mockFsp.mkdir.mockResolvedValue(undefined);
  mocks.mockFsp.writeFile.mockResolvedValue(undefined);
  mocks.mockFsp.readFile.mockResolvedValue(Buffer.from("test data"));

  mocks.mockFs.existsSync.mockReturnValue(true);

  mocks.mockRunDistillReadinessChecks.mockResolvedValue({
    ready: true,
    checks: [],
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("DistillService", () => {
  let service: DistillService;
  let sidecarClient: ReturnType<typeof makeSidecarClient>;
  let eventService: ReturnType<typeof makeV2EventService>;

  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
    sidecarClient = makeSidecarClient();
    eventService = makeV2EventService();
    service = new DistillService(sidecarClient as any, eventService as any);
  });

  // ── generateDataset ────────────────────────────────────────────────────

  describe("generateDataset", () => {
    it("creates dataset with generated examples", async () => {
      const datasetId = "dataset-123";
      const exampleId = "example-123";

      mocks.mockPrisma.distillDataset.create.mockResolvedValue({
        id: datasetId,
        title: "Test Dataset",
        objectiveSplit: "70-30-coding-general",
        privacyPolicyVersion: "private-safe-v1",
        status: "draft",
        sampleCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        createdBy: "test-user",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mocks.mockPrisma.distillExample.create.mockResolvedValue({
        id: exampleId,
        datasetId,
        spec: {
          specId: "spec-1",
          intent: "test intent",
          inputs: [],
          constraints: [],
          requiredTools: [],
          requiredChecks: [],
          expectedArtifacts: [],
          riskClass: "low",
        },
        teacherOutput: "safe output",
        reviewerDecision: "pending",
        privacySafe: true,
        citations: ["citation1"],
        metadata: {},
        createdAt: new Date(),
        reviewedAt: null,
      });

      mocks.mockPrisma.distillDataset.update.mockResolvedValue({
        id: datasetId,
        title: "Test Dataset",
        objectiveSplit: "70-30-coding-general",
        privacyPolicyVersion: "private-safe-v1",
        status: "draft",
        sampleCount: 1,
        approvedCount: 0,
        rejectedCount: 0,
        createdBy: "test-user",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.generateDataset({
        actor: "test-user",
        title: "Test Dataset",
        sample_count: 1,
        retrieval_context_ids: [],
      });

      expect(result.status).toBe("generated");
      expect(result.dataset).toBeDefined();
      expect(result.examples.length).toBe(1);
      expect(mocks.mockPrisma.distillDataset.create).toHaveBeenCalled();
      expect(mocks.mockGenerateTeacherExample).toHaveBeenCalled();
      expect(eventService.appendEvent).toHaveBeenCalled();
    });

    it.skip("clamps sample_count to max 500", async () => {
      const datasetId = "dataset-123";

      mocks.mockPrisma.distillDataset.create.mockResolvedValue({
        id: datasetId,
        title: "Test Dataset",
        objectiveSplit: "70-30-coding-general",
        privacyPolicyVersion: "private-safe-v1",
        status: "draft",
        sampleCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        createdBy: "test-user",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      let callCount = 0;
      mocks.mockPrisma.distillExample.create.mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          id: `example-${callCount}`,
          datasetId,
          spec: {},
          teacherOutput: "output",
          reviewerDecision: "pending",
          privacySafe: true,
          citations: [],
          metadata: {},
          createdAt: new Date(),
          reviewedAt: null,
        });
      });

      mocks.mockPrisma.distillDataset.update.mockImplementation(() => {
        return Promise.resolve({
          id: datasetId,
          title: "Test Dataset",
          objectiveSplit: "70-30-coding-general",
          privacyPolicyVersion: "private-safe-v1",
          status: "draft",
          sampleCount: callCount,
          approvedCount: 0,
          rejectedCount: 0,
          createdBy: "test-user",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });

      await service.generateDataset({
        actor: "test-user",
        title: "Large Dataset",
        sample_count: 1000, // Should be clamped to 500
        retrieval_context_ids: [],
      });

      // Should have been called 500 times max
      expect(callCount).toBe(500);
    }, 60000); // 60 second timeout for this test

    it("returns rejected status when policy denies", async () => {
      sidecarClient.evaluatePolicy.mockResolvedValue({
        decision: "deny",
        reason: "test denial",
      });

      const result = await service.generateDataset({
        actor: "test-user",
        title: "Test Dataset",
        sample_count: 5,
        retrieval_context_ids: [],
      });

      expect(result.status).toBe("rejected");
      expect(result.policy.decision).toBe("deny");
      expect(mocks.mockPrisma.distillDataset.create).not.toHaveBeenCalled();
    });

    it("marks examples as rejected when privacy scan fails", async () => {
      const datasetId = "dataset-123";

      mocks.mockPrisma.distillDataset.create.mockResolvedValue({
        id: datasetId,
        title: "Test Dataset",
        objectiveSplit: "70-30-coding-general",
        privacyPolicyVersion: "private-safe-v1",
        status: "draft",
        sampleCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        createdBy: "test-user",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mocks.mockScanAndRedactSensitiveText.mockReturnValue({
        safe: false,
        redacted: "REDACTED output",
        findings: ["PII detected"],
      });

      mocks.mockPrisma.distillExample.create.mockResolvedValue({
        id: "example-123",
        datasetId,
        spec: {},
        teacherOutput: "REDACTED output",
        reviewerDecision: "rejected",
        privacySafe: false,
        citations: [],
        metadata: {},
        createdAt: new Date(),
        reviewedAt: new Date(),
      });

      mocks.mockPrisma.distillDataset.update.mockResolvedValue({
        id: datasetId,
        title: "Test Dataset",
        objectiveSplit: "70-30-coding-general",
        privacyPolicyVersion: "private-safe-v1",
        status: "draft",
        sampleCount: 1,
        approvedCount: 0,
        rejectedCount: 1,
        createdBy: "test-user",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.generateDataset({
        actor: "test-user",
        title: "Test Dataset",
        sample_count: 1,
        retrieval_context_ids: [],
      });

      expect(result.examples[0].reviewerDecision).toBe("rejected");
      expect(result.examples[0].privacySafe).toBe(false);
    });

    it.skip("stops generation when budget exhausted", async () => {
      const datasetId = "dataset-123";

      // Create a new service for this test with a fresh mock setup
      vi.clearAllMocks();

      // Mock the config to have low budget
      const lowBudgetConfig = {
        teacherCommand: "claude",
        teacherModel: "opus",
        teacherTimeoutMs: 120000,
        privacyPolicyVersion: "private-safe-v1",
        objectiveSplit: "70-30-coding-general",
        outputRoot: "/tmp/distill",
        teacherRateLimit: {
          maxRequestsPerMinute: 60, // High rate to avoid delays
          dailyTokenBudget: 100, // Very low budget
          retryBackoffMs: 0, // No backoff
          maxRetries: 3,
        },
        trainer: {
          backend: "hf-lora-local",
          pythonCommand: "python3",
          maxSteps: 40,
          perDeviceBatchSize: 1,
          gradientAccumulationSteps: 8,
          learningRate: 0.0002,
          loraRank: 8,
          loraAlpha: 16,
          maxSeqLength: 1024,
          orpoBeta: 0.1,
          toolRewardScale: 0.6,
        },
      };

      mocks.mockPrisma.appSetting.findUnique.mockImplementation(({ where }: any) => {
        if (where.key === "distill_config") {
          return Promise.resolve({
            key: "distill_config",
            value: lowBudgetConfig,
          });
        }
        if (where.key === "distill_teacher_usage_daily") {
          return Promise.resolve({
            key: "distill_teacher_usage_daily",
            value: {
              day: new Date().toISOString().split("T")[0],
              tokensUsed: 50, // Half exhausted
              requests: 1,
              lastRequestAt: null,
              cooldownUntil: null,
            },
          });
        }
        return Promise.resolve(null);
      });

      // Reset other mocks
      mocks.mockPrisma.commandLog.create.mockResolvedValue({
        id: "cmd-123",
        commandType: "test",
        actor: "test-actor",
        aggregateId: null,
        payload: {},
        status: "queued",
        result: null,
        createdAt: new Date(),
      });

      mocks.mockPrisma.commandLog.update.mockResolvedValue({});
      mocks.mockScanAndRedactSensitiveText.mockReturnValue({
        safe: true,
        redacted: "safe output",
        findings: [],
      });

      mocks.mockGenerateTeacherExample.mockResolvedValue({
        teacherOutput: "teacher response",
        model: "opus",
        usedFallback: false,
        errorClass: null,
        errorMessage: null,
        citations: ["citation1"],
        usage: {
          totalTokens: 100, // This will exhaust budget after 1 call (50 + 100 > 100)
          inputTokens: 50,
          outputTokens: 50,
        },
      });

      mocks.mockPrisma.distillDataset.create.mockResolvedValue({
        id: datasetId,
        title: "Test Dataset",
        objectiveSplit: "70-30-coding-general",
        privacyPolicyVersion: "private-safe-v1",
        status: "draft",
        sampleCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        createdBy: "test-user",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      let exampleCount = 0;
      mocks.mockPrisma.distillExample.create.mockImplementation(() => {
        exampleCount++;
        return Promise.resolve({
          id: `example-${exampleCount}`,
          datasetId,
          spec: {},
          teacherOutput: "output",
          reviewerDecision: "pending",
          privacySafe: true,
          citations: [],
          metadata: {},
          createdAt: new Date(),
          reviewedAt: null,
        });
      });

      mocks.mockPrisma.distillDataset.update.mockResolvedValue({
        id: datasetId,
        title: "Test Dataset",
        objectiveSplit: "70-30-coding-general",
        privacyPolicyVersion: "private-safe-v1",
        status: "draft",
        sampleCount: exampleCount,
        approvedCount: 0,
        rejectedCount: 0,
        createdBy: "test-user",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const testService = new DistillService(sidecarClient as any, eventService as any);

      const result = await testService.generateDataset({
        actor: "test-user",
        title: "Test Dataset",
        sample_count: 10,
        retrieval_context_ids: [],
      });

      expect(result.budget_exhausted).toBe(true);
      // Should stop after 1 example when budget is exhausted
      expect(exampleCount).toBeLessThanOrEqual(2);
    });
  });

  // ── reviewDataset ──────────────────────────────────────────────────────

  describe("reviewDataset", () => {
    it("updates example decisions and dataset counts", async () => {
      const datasetId = "dataset-123";

      mocks.mockPrisma.distillExample.update.mockResolvedValue({});

      mocks.mockPrisma.distillExample.findMany.mockResolvedValue([
        {
          id: "ex-1",
          reviewerDecision: "approved",
        },
        {
          id: "ex-2",
          reviewerDecision: "approved",
        },
        {
          id: "ex-3",
          reviewerDecision: "rejected",
        },
      ]);

      mocks.mockPrisma.distillDataset.update.mockResolvedValue({
        id: datasetId,
        title: "Test Dataset",
        objectiveSplit: "70-30-coding-general",
        privacyPolicyVersion: "private-safe-v1",
        status: "reviewed",
        sampleCount: 3,
        approvedCount: 2,
        rejectedCount: 1,
        createdBy: "test-user",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.reviewDataset({
        actor: "test-user",
        dataset_id: datasetId,
        decisions: [
          { example_id: "ex-1", decision: "approved" },
          { example_id: "ex-2", decision: "approved" },
          { example_id: "ex-3", decision: "rejected" },
        ],
      });

      expect(result.dataset.approvedCount).toBe(2);
      expect(result.dataset.rejectedCount).toBe(1);
      expect(result.dataset.status).toBe("reviewed");
      expect(mocks.mockPrisma.distillExample.update).toHaveBeenCalledTimes(3);
      expect(eventService.appendEvent).toHaveBeenCalled();
    });

    it("keeps status as draft when pending examples remain", async () => {
      const datasetId = "dataset-123";

      mocks.mockPrisma.distillExample.update.mockResolvedValue({});

      mocks.mockPrisma.distillExample.findMany.mockResolvedValue([
        { id: "ex-1", reviewerDecision: "approved" },
        { id: "ex-2", reviewerDecision: "pending" },
      ]);

      mocks.mockPrisma.distillDataset.update.mockResolvedValue({
        id: datasetId,
        title: "Test Dataset",
        objectiveSplit: "70-30-coding-general",
        privacyPolicyVersion: "private-safe-v1",
        status: "draft",
        sampleCount: 2,
        approvedCount: 1,
        rejectedCount: 0,
        createdBy: "test-user",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.reviewDataset({
        actor: "test-user",
        dataset_id: datasetId,
        decisions: [{ example_id: "ex-1", decision: "approved" }],
      });

      expect(result.dataset.status).toBe("draft");
    });
  });

  // ── startTraining ──────────────────────────────────────────────────────

  describe("startTraining", () => {
    it("creates and runs a training job", async () => {
      const datasetId = "dataset-123";
      const runId = "run-123";

      mocks.mockPrisma.distillRun.create.mockResolvedValue({
        id: runId,
        datasetId,
        stage: "sft",
        studentModelId: "Qwen/Qwen3.5-0.8B",
        status: "queued",
        reasonCode: null,
        jobId: null,
        backend: "hf-lora-local",
        startedAt: null,
        finishedAt: null,
        metrics: {},
        artifactPath: "/tmp/distill/runs/123-sft",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mocks.mockPrisma.distillExample.findMany.mockResolvedValue([
        {
          id: "ex-1",
          spec: { specId: "spec-1", intent: "test", constraints: [], requiredChecks: [], riskClass: "low" },
          teacherOutput: "output",
          reviewerDecision: "approved",
          privacySafe: true,
          citations: [],
          metadata: { split: "train" },
          createdAt: new Date(),
          reviewedAt: new Date(),
        },
      ]);

      mocks.mockPrisma.distillRun.update.mockResolvedValue({
        id: runId,
        datasetId,
        stage: "sft",
        studentModelId: "Qwen/Qwen3.5-0.8B",
        status: "completed",
        reasonCode: null,
        jobId: "job-123",
        backend: "hf-lora-local",
        startedAt: new Date(),
        finishedAt: new Date(),
        metrics: { loss: 0.5 },
        artifactPath: "/tmp/distill/runs/123-sft",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.startTraining({
        actor: "test-user",
        dataset_id: datasetId,
        stage: "sft",
        student_model_id: "Qwen/Qwen3.5-0.8B",
      });

      expect(result.run.status).toBe("completed");
      expect(result.backend).toBe("hf-lora-local");
      expect(mocks.mockTrainerAdapter.run).toHaveBeenCalled();
      expect(eventService.appendEvent).toHaveBeenCalled();
    });

    it("throws error when no approved examples available", async () => {
      const datasetId = "dataset-123";
      const runId = "run-123";

      mocks.mockPrisma.distillRun.create.mockResolvedValue({
        id: runId,
        datasetId,
        stage: "sft",
        studentModelId: "Qwen/Qwen3.5-0.8B",
        status: "queued",
        reasonCode: null,
        jobId: null,
        backend: "hf-lora-local",
        startedAt: null,
        finishedAt: null,
        metrics: {},
        artifactPath: "/tmp/distill/runs/123-sft",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mocks.mockPrisma.distillExample.findMany.mockResolvedValue([]);

      mocks.mockPrisma.distillRun.update.mockResolvedValue({
        id: runId,
        status: "failed",
        reasonCode: "dataset_insufficient",
      });

      await expect(
        service.startTraining({
          actor: "test-user",
          dataset_id: datasetId,
          stage: "sft",
          student_model_id: "Qwen/Qwen3.5-0.8B",
        })
      ).rejects.toThrow("No approved");
    });

    it("requires previous stage run for orpo stage", async () => {
      const datasetId = "dataset-123";

      mocks.mockPrisma.distillRun.findFirst.mockResolvedValue(null);

      await expect(
        service.startTraining({
          actor: "test-user",
          dataset_id: datasetId,
          stage: "orpo",
          student_model_id: "Qwen/Qwen3.5-0.8B",
        })
      ).rejects.toThrow("No sft run available");
    });

    it("uses previous run artifact path for multi-stage training", async () => {
      const datasetId = "dataset-123";
      const runId = "run-123";
      const previousRunId = "run-prev";

      mocks.mockPrisma.distillRun.findFirst.mockResolvedValue({
        id: previousRunId,
        artifactPath: "/tmp/distill/runs/prev-sft",
        status: "completed",
      });

      mocks.mockPrisma.distillRun.create.mockResolvedValue({
        id: runId,
        datasetId,
        stage: "orpo",
        studentModelId: "Qwen/Qwen3.5-0.8B",
        status: "queued",
        reasonCode: null,
        jobId: null,
        backend: "hf-lora-local",
        startedAt: null,
        finishedAt: null,
        metrics: {},
        artifactPath: "/tmp/distill/runs/123-orpo",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mocks.mockPrisma.distillExample.findMany.mockResolvedValue([
        {
          id: "ex-1",
          spec: { specId: "spec-1", intent: "test", constraints: [], requiredChecks: [], riskClass: "low" },
          teacherOutput: "output",
          reviewerDecision: "approved",
          privacySafe: true,
          citations: [],
          metadata: { split: "train" },
          createdAt: new Date(),
          reviewedAt: new Date(),
        },
      ]);

      mocks.mockPrisma.distillRun.update.mockResolvedValue({
        id: runId,
        datasetId,
        stage: "orpo",
        studentModelId: "Qwen/Qwen3.5-0.8B",
        status: "completed",
        reasonCode: null,
        jobId: "job-123",
        backend: "hf-lora-local",
        startedAt: new Date(),
        finishedAt: new Date(),
        metrics: { loss: 0.4 },
        artifactPath: "/tmp/distill/runs/123-orpo",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.startTraining({
        actor: "test-user",
        dataset_id: datasetId,
        stage: "orpo",
        student_model_id: "Qwen/Qwen3.5-0.8B",
      });

      expect(mocks.mockTrainerAdapter.run).toHaveBeenCalledWith(
        expect.objectContaining({
          initAdapterPath: "/tmp/distill/runs/prev-sft",
        })
      );
    });
  });

  // ── runEval ────────────────────────────────────────────────────────────

  describe("runEval", () => {
    it("runs evaluation on completed training run", async () => {
      const runId = "run-123";
      const evalId = "eval-123";

      mocks.mockPrisma.distillRun.findUnique.mockResolvedValue({
        id: runId,
        datasetId: "dataset-123",
        artifactPath: "/tmp/distill/runs/123-sft",
        studentModelId: "Qwen/Qwen3.5-0.8B",
        status: "completed",
      });

      mocks.mockPrisma.distillExample.findMany.mockResolvedValue([
        {
          id: "ex-1",
          spec: { specId: "spec-1", intent: "test", constraints: [], requiredChecks: [], riskClass: "low" },
          teacherOutput: "output",
          reviewerDecision: "approved",
          privacySafe: true,
          citations: [],
          metadata: { split: "holdout" },
          createdAt: new Date(),
          reviewedAt: new Date(),
        },
      ]);

      const mockExecFile = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          pass: true,
          metrics: {
            coding_pass_at_1: 0.85,
            policy_adherence: 0.92,
          },
          sampleCount: 10,
          failingExampleIds: [],
        }),
        stderr: "",
      });

      const { execFile } = await import("node:child_process");
      (execFile as any).mockImplementation((cmd: string, args: string[], opts: any, cb: any) => {
        mockExecFile(cmd, args, opts).then((res: any) => cb(null, res));
      });

      mocks.mockPrisma.distillEvalRun.create.mockResolvedValue({
        id: evalId,
        runId,
        baselineModelId: null,
        pass: true,
        metrics: {
          coding_pass_at_1: 0.85,
          policy_adherence: 0.92,
        },
        createdAt: new Date(),
      });

      const result = await service.runEval({
        actor: "test-user",
        run_id: runId,
      });

      expect(result.eval.pass).toBe(true);
      expect(result.eval.metrics.coding_pass_at_1).toBe(0.85);
      expect(eventService.appendEvent).toHaveBeenCalled();
    });

    it("throws error when run not found", async () => {
      mocks.mockPrisma.distillRun.findUnique.mockResolvedValue(null);

      await expect(
        service.runEval({
          actor: "test-user",
          run_id: "nonexistent",
        })
      ).rejects.toThrow("Distill run not found");
    });

    it("handles evaluation failures gracefully", async () => {
      const runId = "run-123";
      const evalId = "eval-123";

      mocks.mockPrisma.distillRun.findUnique.mockResolvedValue({
        id: runId,
        datasetId: "dataset-123",
        artifactPath: "/tmp/distill/runs/123-sft",
        studentModelId: "Qwen/Qwen3.5-0.8B",
        status: "completed",
      });

      mocks.mockPrisma.distillExample.findMany.mockResolvedValue([]);

      mocks.mockPrisma.distillEvalRun.create.mockResolvedValue({
        id: evalId,
        runId,
        baselineModelId: null,
        pass: false,
        metrics: {
          coding_pass_at_1: 0,
          policy_adherence: 0,
          tool_use_success: 0,
          latency_ms_p95: 0,
          degenerate_rate: 1,
        },
        createdAt: new Date(),
      });

      const result = await service.runEval({
        actor: "test-user",
        run_id: runId,
      });

      expect(result.eval.pass).toBe(false);
    });
  });

  // ── promoteModel ───────────────────────────────────────────────────────

  describe("promoteModel", () => {
    it("promotes model when evaluation passes", async () => {
      const runId = "run-123";

      mocks.mockPrisma.distillRun.findUnique.mockResolvedValue({
        id: runId,
        studentModelId: "Qwen/Qwen3.5-0.8B",
        status: "completed",
        evalRuns: [
          {
            id: "eval-123",
            pass: true,
            metrics: { coding_pass_at_1: 0.85 },
          },
        ],
      });

      mocks.mockPrisma.modelArtifactRegistry.updateMany.mockResolvedValue({});

      mocks.mockPrisma.distillRun.update.mockResolvedValue({
        id: runId,
        datasetId: "dataset-123",
        stage: "sft",
        studentModelId: "Qwen/Qwen3.5-0.8B",
        status: "promoted",
        reasonCode: null,
        jobId: "job-123",
        backend: "hf-lora-local",
        startedAt: new Date(),
        finishedAt: new Date(),
        metrics: { loss: 0.5 },
        artifactPath: "/tmp/distill/runs/123-sft",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mocks.mockPrisma.appSetting.upsert.mockResolvedValue({});

      const result = await service.promoteModel({
        actor: "test-user",
        run_id: runId,
      });

      expect(result.run.status).toBe("promoted");
      expect(result.promotedModelId).toBe("Qwen/Qwen3.5-0.8B");
      expect(mocks.mockPrisma.modelArtifactRegistry.updateMany).toHaveBeenCalled();
      expect(eventService.appendEvent).toHaveBeenCalled();
    });

    it("throws error when run not found", async () => {
      mocks.mockPrisma.distillRun.findUnique.mockResolvedValue(null);

      await expect(
        service.promoteModel({
          actor: "test-user",
          run_id: "nonexistent",
        })
      ).rejects.toThrow("Distill run not found");
    });

    it("throws error when evaluation did not pass", async () => {
      const runId = "run-123";

      mocks.mockPrisma.distillRun.findUnique.mockResolvedValue({
        id: runId,
        studentModelId: "Qwen/Qwen3.5-0.8B",
        status: "completed",
        evalRuns: [
          {
            id: "eval-123",
            pass: false,
            metrics: { coding_pass_at_1: 0.5 },
          },
        ],
      });

      await expect(
        service.promoteModel({
          actor: "test-user",
          run_id: runId,
        })
      ).rejects.toThrow("Latest evaluation did not pass promotion gate");
    });

    it("throws error when no evaluation exists", async () => {
      const runId = "run-123";

      mocks.mockPrisma.distillRun.findUnique.mockResolvedValue({
        id: runId,
        studentModelId: "Qwen/Qwen3.5-0.8B",
        status: "completed",
        evalRuns: [],
      });

      await expect(
        service.promoteModel({
          actor: "test-user",
          run_id: runId,
        })
      ).rejects.toThrow("Latest evaluation did not pass promotion gate");
    });
  });

  // ── getDataset ─────────────────────────────────────────────────────────

  describe("getDataset", () => {
    it("retrieves dataset with examples", async () => {
      const datasetId = "dataset-123";

      mocks.mockPrisma.distillDataset.findUnique.mockResolvedValue({
        id: datasetId,
        title: "Test Dataset",
        objectiveSplit: "70-30-coding-general",
        privacyPolicyVersion: "private-safe-v1",
        status: "draft",
        sampleCount: 2,
        approvedCount: 1,
        rejectedCount: 0,
        createdBy: "test-user",
        createdAt: new Date(),
        updatedAt: new Date(),
        examples: [
          {
            id: "ex-1",
            spec: { specId: "spec-1", intent: "test", constraints: [], requiredChecks: [], expectedArtifacts: [], requiredTools: [], inputs: [], riskClass: "low" },
            teacherOutput: "output1",
            reviewerDecision: "approved",
            privacySafe: true,
            citations: [],
            createdAt: new Date(),
            reviewedAt: new Date(),
          },
          {
            id: "ex-2",
            spec: { specId: "spec-2", intent: "test2", constraints: [], requiredChecks: [], expectedArtifacts: [], requiredTools: [], inputs: [], riskClass: "low" },
            teacherOutput: "output2",
            reviewerDecision: "pending",
            privacySafe: true,
            citations: [],
            createdAt: new Date(),
            reviewedAt: null,
          },
        ],
      });

      const result = await service.getDataset(datasetId);

      expect(result.dataset.id).toBe(datasetId);
      expect(result.examples.length).toBe(2);
    });

    it("throws error when dataset not found", async () => {
      mocks.mockPrisma.distillDataset.findUnique.mockResolvedValue(null);

      await expect(service.getDataset("nonexistent")).rejects.toThrow("Dataset not found");
    });
  });

  // ── getRun ─────────────────────────────────────────────────────────────

  describe("getRun", () => {
    it("retrieves training run", async () => {
      const runId = "run-123";

      mocks.mockPrisma.distillRun.findUnique.mockResolvedValue({
        id: runId,
        stage: "sft",
        studentModelId: "Qwen/Qwen3.5-0.8B",
        datasetId: "dataset-123",
        status: "completed",
        reasonCode: null,
        jobId: "job-123",
        backend: "hf-lora-local",
        startedAt: new Date(),
        finishedAt: new Date(),
        metrics: { loss: 0.5 },
        artifactPath: "/tmp/distill/runs/123-sft",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getRun(runId);

      expect(result.run.id).toBe(runId);
      expect(result.run.status).toBe("completed");
    });

    it("throws error when run not found", async () => {
      mocks.mockPrisma.distillRun.findUnique.mockResolvedValue(null);

      await expect(service.getRun("nonexistent")).rejects.toThrow("Run not found");
    });
  });

  // ── getRunLogs ─────────────────────────────────────────────────────────

  describe("getRunLogs", () => {
    it("retrieves logs for training run", async () => {
      const runId = "run-123";

      mocks.mockPrisma.distillRunLog.findMany.mockResolvedValue([
        {
          id: "log-1",
          runId,
          level: "info",
          message: "Training started",
          payload: {},
          createdAt: new Date(),
        },
        {
          id: "log-2",
          runId,
          level: "info",
          message: "Training completed",
          payload: { final_loss: 0.5 },
          createdAt: new Date(),
        },
      ]);

      const result = await service.getRunLogs(runId);

      expect(result.items.length).toBe(2);
      expect(result.items[0].message).toBe("Training started");
    });
  });

  // ── getQuotaState ──────────────────────────────────────────────────────

  describe("getQuotaState", () => {
    it("returns current quota and rate limit config", async () => {
      const result = await service.getQuotaState();

      expect(result.quota).toBeDefined();
      expect(result.quota.dailyTokenBudget).toBe(1000000);
      expect(result.quota.tokensUsed).toBe(0);
      expect(result.rateLimit).toBeDefined();
    });

    it("calculates remaining tokens correctly", async () => {
      mocks.mockPrisma.appSetting.findUnique.mockImplementation(({ where }: any) => {
        if (where.key === "distill_teacher_usage_daily") {
          return Promise.resolve({
            key: "distill_teacher_usage_daily",
            value: {
              day: new Date().toISOString().split("T")[0],
              tokensUsed: 250000,
              requests: 50,
              lastRequestAt: null,
              cooldownUntil: null,
            },
          });
        }
        return Promise.resolve({
          key: "distill_config",
          value: {
            teacherRateLimit: {
              dailyTokenBudget: 1000000,
            },
          },
        });
      });

      const result = await service.getQuotaState();

      expect(result.quota.tokensUsed).toBe(250000);
      expect(result.quota.remainingTokens).toBe(750000);
    });
  });

  // ── getReadiness ───────────────────────────────────────────────────────

  describe("getReadiness", () => {
    it("runs readiness checks", async () => {
      mocks.mockRunDistillReadinessChecks.mockResolvedValue({
        ready: true,
        checks: [
          { name: "teacher_cli", passed: true },
          { name: "trainer_python", passed: true },
        ],
      });

      const result = await service.getReadiness();

      expect(result.ready).toBe(true);
      expect(result.checks.length).toBe(2);
      expect(mocks.mockRunDistillReadinessChecks).toHaveBeenCalled();
    });
  });

  // ── getEval ────────────────────────────────────────────────────────────

  describe("getEval", () => {
    it("retrieves evaluation run", async () => {
      const evalId = "eval-123";

      mocks.mockPrisma.distillEvalRun.findUnique.mockResolvedValue({
        id: evalId,
        runId: "run-123",
        baselineModelId: null,
        pass: true,
        metrics: { coding_pass_at_1: 0.85 },
        createdAt: new Date(),
      });

      const result = await service.getEval(evalId);

      expect(result.eval.id).toBe(evalId);
      expect(result.eval.pass).toBe(true);
    });

    it("throws error when evaluation not found", async () => {
      mocks.mockPrisma.distillEvalRun.findUnique.mockResolvedValue(null);

      await expect(service.getEval("nonexistent")).rejects.toThrow("Evaluation run not found");
    });
  });

  // ── listModels ─────────────────────────────────────────────────────────

  describe("listModels", () => {
    it("returns grouped model artifacts", async () => {
      mocks.mockPrisma.modelArtifactRegistry.findMany.mockResolvedValue([
        {
          modelId: "Qwen/Qwen3.5-0.8B",
          artifactType: "adapter_config",
          promoted: true,
          updatedAt: new Date("2025-01-15"),
        },
        {
          modelId: "Qwen/Qwen3.5-0.8B",
          artifactType: "adapter_model",
          promoted: true,
          updatedAt: new Date("2025-01-15"),
        },
        {
          modelId: "Qwen/Qwen3.5-4B",
          artifactType: "adapter_config",
          promoted: false,
          updatedAt: new Date("2025-01-14"),
        },
      ]);

      const result = await service.listModels();

      expect(result.length).toBe(2);
      expect(result[0].modelId).toBe("Qwen/Qwen3.5-0.8B");
      expect(result[0].promoted).toBe(true);
      expect(result[0].artifacts).toContain("adapter_config");
      expect(result[0].artifacts).toContain("adapter_model");
    });

    it("returns empty array when no models exist", async () => {
      mocks.mockPrisma.modelArtifactRegistry.findMany.mockResolvedValue([]);

      const result = await service.listModels();

      expect(result).toEqual([]);
    });

    it("merges artifacts for same model updating promoted and updatedAt", async () => {
      const olderDate = new Date("2025-01-10");
      const newerDate = new Date("2025-01-20");

      mocks.mockPrisma.modelArtifactRegistry.findMany.mockResolvedValue([
        {
          modelId: "Qwen/Qwen3.5-0.8B",
          artifactType: "adapter_config",
          promoted: false,
          updatedAt: olderDate,
        },
        {
          modelId: "Qwen/Qwen3.5-0.8B",
          artifactType: "adapter_model",
          promoted: true,
          updatedAt: newerDate,
        },
        {
          modelId: "Qwen/Qwen3.5-0.8B",
          artifactType: "adapter_config", // duplicate artifact type — should be skipped
          promoted: false,
          updatedAt: olderDate,
        },
      ]);

      const result = await service.listModels();

      expect(result.length).toBe(1);
      expect(result[0].modelId).toBe("Qwen/Qwen3.5-0.8B");
      expect(result[0].promoted).toBe(true); // OR of false, true
      expect(result[0].artifacts).toEqual(["adapter_config", "adapter_model"]);
      expect(result[0].updatedAt).toBe(newerDate.toISOString()); // newer date wins
    });
  });

  // ── getRunLogs level mapping ──────────────────────────────────────────

  describe("getRunLogs level mapping", () => {
    it("maps warn and error levels correctly", async () => {
      mocks.mockPrisma.distillRunLog.findMany.mockResolvedValue([
        {
          id: "log-1",
          runId: "run-1",
          level: "warn",
          message: "Warning message",
          payload: {},
          createdAt: new Date(),
        },
        {
          id: "log-2",
          runId: "run-1",
          level: "error",
          message: "Error message",
          payload: {},
          createdAt: new Date(),
        },
        {
          id: "log-3",
          runId: "run-1",
          level: "debug", // unknown level → defaults to "info"
          message: "Debug message",
          payload: {},
          createdAt: new Date(),
        },
      ]);

      const result = await service.getRunLogs("run-1");

      expect(result.items[0].level).toBe("warn");
      expect(result.items[1].level).toBe("error");
      expect(result.items[2].level).toBe("info");
    });
  });

  // ── generateDataset — fallback/needs_edit and budget paths ────────────

  describe("generateDataset — teacher fallback", () => {
    it("marks examples as needs_edit when teacher uses fallback", async () => {
      const datasetId = "dataset-fb";

      mocks.mockPrisma.distillDataset.create.mockResolvedValue({
        id: datasetId,
        title: "Fallback Dataset",
        objectiveSplit: "70-30-coding-general",
        privacyPolicyVersion: "private-safe-v1",
        status: "draft",
        sampleCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        createdBy: "test-user",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mocks.mockGenerateTeacherExample.mockResolvedValue({
        teacherOutput: "fallback output",
        model: "opus",
        usedFallback: true,
        errorClass: "unknown_error", // non-retryable error class
        errorMessage: "Something unexpected",
        citations: [],
        usage: {
          totalTokens: 0, // zero tokens triggers estimateTokensFromText
          inputTokens: 0,
          outputTokens: 0,
        },
      });

      mocks.mockPrisma.distillExample.create.mockResolvedValue({
        id: "example-fb-1",
        datasetId,
        spec: {
          specId: "spec-1",
          intent: "test",
          inputs: [],
          constraints: [],
          requiredTools: [],
          requiredChecks: [],
          expectedArtifacts: [],
          riskClass: "low",
        },
        teacherOutput: "fallback output",
        reviewerDecision: "needs_edit",
        privacySafe: false,
        citations: [],
        metadata: {},
        createdAt: new Date(),
        reviewedAt: null,
      });

      mocks.mockPrisma.distillDataset.update.mockResolvedValue({
        id: datasetId,
        title: "Fallback Dataset",
        objectiveSplit: "70-30-coding-general",
        privacyPolicyVersion: "private-safe-v1",
        status: "draft",
        sampleCount: 1,
        approvedCount: 0,
        rejectedCount: 0,
        createdBy: "test-user",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.generateDataset({
        actor: "test-user",
        title: "Fallback Dataset",
        sample_count: 1,
        retrieval_context_ids: ["ctx-1"],
        model: "custom-model",
      });

      expect(result.status).toBe("generated");
      expect(result.examples[0].reviewerDecision).toBe("needs_edit");
      expect(result.examples[0].privacySafe).toBe(false);
    });
  });

  // ── startTraining — tool_rl stage ─────────────────────────────────────

  describe("startTraining — tool_rl stage", () => {
    it("requires orpo stage for tool_rl", async () => {
      mocks.mockPrisma.distillRun.findFirst.mockResolvedValue(null);

      await expect(
        service.startTraining({
          actor: "test-user",
          dataset_id: "dataset-123",
          stage: "tool_rl",
          student_model_id: "Qwen/Qwen3.5-0.8B",
        })
      ).rejects.toThrow("No orpo run available");
    });
  });

  // ── startTraining — trainer logs and failed status ────────────────────

  describe("startTraining — trainer logs and failed status", () => {
    it("writes trainer logs and handles failed training status", async () => {
      const datasetId = "dataset-fail";
      const runId = "run-fail";

      mocks.mockPrisma.distillRun.create.mockResolvedValue({
        id: runId,
        datasetId,
        stage: "sft",
        studentModelId: "Qwen/Qwen3.5-0.8B",
        status: "queued",
        reasonCode: null,
        jobId: null,
        backend: "hf-lora-local",
        startedAt: null,
        finishedAt: null,
        metrics: {},
        artifactPath: "/tmp/distill/runs/fail-sft",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mocks.mockPrisma.distillExample.findMany.mockResolvedValue([
        {
          id: "ex-1",
          spec: { specId: "spec-1", intent: "test", constraints: ["c"], requiredChecks: ["check"], riskClass: "low" },
          teacherOutput: "output",
          reviewerDecision: "approved",
          privacySafe: true,
          citations: [],
          metadata: { split: "train" },
          createdAt: new Date(),
          reviewedAt: new Date(),
        },
      ]);

      mocks.mockTrainerAdapter.run.mockResolvedValue({
        status: "failed",
        reasonCode: "oom",
        jobId: "job-fail",
        backend: "hf-lora-local",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        metrics: { loss: NaN },
        logs: [
          { level: "info", message: "Starting training", payload: {} },
          { level: "error", message: "Out of memory", payload: { gpu_mem: "16GB" } },
        ],
        artifacts: [],
        expectedArtifacts: [],
      });

      mocks.mockPrisma.distillRun.update.mockResolvedValue({
        id: runId,
        datasetId,
        stage: "sft",
        studentModelId: "Qwen/Qwen3.5-0.8B",
        status: "failed",
        reasonCode: "oom",
        jobId: "job-fail",
        backend: "hf-lora-local",
        startedAt: new Date(),
        finishedAt: new Date(),
        metrics: { loss: NaN },
        artifactPath: "/tmp/distill/runs/fail-sft",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.startTraining({
        actor: "test-user",
        dataset_id: datasetId,
        stage: "sft",
        student_model_id: "Qwen/Qwen3.5-0.8B",
      });

      expect(result.run.status).toBe("failed");
      expect(result.reasonCode).toBe("oom");
      // Trainer logs should be written
      expect(mocks.mockPrisma.distillRunLog.create).toHaveBeenCalledTimes(3); // 1 start log + 2 trainer logs
    });
  });

  // ── startTraining — completed with artifacts ──────────────────────────

  describe("startTraining — completed with artifacts on disk", () => {
    it("creates model artifact registry entries for existing artifacts", async () => {
      const datasetId = "dataset-art";
      const runId = "run-art";

      mocks.mockPrisma.distillRun.create.mockResolvedValue({
        id: runId,
        datasetId,
        stage: "sft",
        studentModelId: "Qwen/Qwen3.5-0.8B",
        status: "queued",
        reasonCode: null,
        jobId: null,
        backend: "hf-lora-local",
        startedAt: null,
        finishedAt: null,
        metrics: {},
        artifactPath: "/tmp/distill/runs/art-sft",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mocks.mockPrisma.distillExample.findMany.mockResolvedValue([
        {
          id: "ex-1",
          spec: { specId: "spec-1", intent: "test", constraints: ["c"], requiredChecks: ["check"], riskClass: "low" },
          teacherOutput: "output",
          reviewerDecision: "approved",
          privacySafe: true,
          citations: [],
          metadata: { split: "train" },
          createdAt: new Date(),
          reviewedAt: new Date(),
        },
      ]);

      mocks.mockTrainerAdapter.run.mockResolvedValue({
        status: "completed",
        reasonCode: null,
        jobId: "job-art",
        backend: "hf-lora-local",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        metrics: { loss: 0.3 },
        logs: [],
        artifacts: [
          {
            artifactType: "adapter_config",
            artifactPath: "/tmp/distill/runs/art-sft/adapter_config.json",
            metadata: { format: "json" },
          },
          {
            artifactType: "adapter_model",
            artifactPath: "/tmp/distill/runs/art-sft/adapter_model.bin",
            metadata: {},
          },
          {
            artifactType: "missing_file",
            artifactPath: "/tmp/distill/runs/art-sft/nonexistent.bin",
            metadata: {},
          },
        ],
        expectedArtifacts: ["adapter_config.json", "adapter_model.bin"],
      });

      // First two artifacts exist, third does not
      mocks.mockFs.existsSync
        .mockReturnValueOnce(true)  // adapter_config.json
        .mockReturnValueOnce(true)  // adapter_model.bin
        .mockReturnValueOnce(false); // nonexistent.bin

      mocks.mockFsp.readFile.mockResolvedValue(Buffer.from("artifact data"));

      mocks.mockPrisma.distillRun.update.mockResolvedValue({
        id: runId,
        datasetId,
        stage: "sft",
        studentModelId: "Qwen/Qwen3.5-0.8B",
        status: "completed",
        reasonCode: null,
        jobId: "job-art",
        backend: "hf-lora-local",
        startedAt: new Date(),
        finishedAt: new Date(),
        metrics: { loss: 0.3 },
        artifactPath: "/tmp/distill/runs/art-sft",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mocks.mockPrisma.modelArtifactRegistry.create.mockResolvedValue({});

      const result = await service.startTraining({
        actor: "test-user",
        dataset_id: datasetId,
        stage: "sft",
        student_model_id: "Qwen/Qwen3.5-0.8B",
      });

      expect(result.run.status).toBe("completed");
      // Only 2 artifacts should be registered (third doesn't exist on disk)
      expect(mocks.mockPrisma.modelArtifactRegistry.create).toHaveBeenCalledTimes(2);
    });
  });

  // ── promoteModel — 4B model ───────────────────────────────────────────

  describe("promoteModel — 4B model default", () => {
    it("uses 4B model id for defaultDeepModel when model contains 4B", async () => {
      const runId = "run-4b";

      mocks.mockPrisma.distillRun.findUnique.mockResolvedValue({
        id: runId,
        studentModelId: "Qwen/Qwen3.5-4B",
        status: "completed",
        evalRuns: [
          {
            id: "eval-4b",
            pass: true,
            metrics: { coding_pass_at_1: 0.9 },
          },
        ],
      });

      mocks.mockPrisma.modelArtifactRegistry.updateMany.mockResolvedValue({});

      mocks.mockPrisma.distillRun.update.mockResolvedValue({
        id: runId,
        datasetId: "dataset-123",
        stage: "sft",
        studentModelId: "Qwen/Qwen3.5-4B",
        status: "promoted",
        reasonCode: null,
        jobId: "job-123",
        backend: "hf-lora-local",
        startedAt: new Date(),
        finishedAt: new Date(),
        metrics: {},
        artifactPath: "/tmp/distill/runs/123-sft",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mocks.mockPrisma.appSetting.upsert.mockResolvedValue({});

      const result = await service.promoteModel({
        actor: "test-user",
        run_id: runId,
      });

      expect(result.promotedModelId).toBe("Qwen/Qwen3.5-4B");
      // Verify the upsert was called with the 4B model as defaultDeepModel
      expect(mocks.mockPrisma.appSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            value: expect.objectContaining({
              defaultDeepModel: "Qwen/Qwen3.5-4B",
            }),
          }),
        })
      );
    });
  });

  // ── getConfig — default value branches ────────────────────────────────

  describe("getConfig — default fallbacks", () => {
    it("uses environment defaults when config is missing", async () => {
      // Return null config
      mocks.mockPrisma.appSetting.findUnique.mockImplementation(({ where }: any) => {
        if (where.key === "distill_config") {
          return Promise.resolve(null);
        }
        if (where.key === "distill_teacher_usage_daily") {
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      });

      const result = await service.getQuotaState();

      // Should use defaults without throwing
      expect(result.quota).toBeDefined();
      expect(result.rateLimit).toBeDefined();
    });

    it("uses defaults when config value has empty strings", async () => {
      mocks.mockPrisma.appSetting.findUnique.mockImplementation(({ where }: any) => {
        if (where.key === "distill_config") {
          return Promise.resolve({
            key: "distill_config",
            value: {
              teacherCommand: "",
              teacherModel: "  ",
              privacyPolicyVersion: "",
              objectiveSplit: "",
              outputRoot: "  ",
              teacherRateLimit: null,
              trainer: null,
            },
          });
        }
        if (where.key === "distill_teacher_usage_daily") {
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      });

      const result = await service.getQuotaState();

      expect(result.quota).toBeDefined();
      expect(result.rateLimit).toBeDefined();
    });

    it("clamps trainer config values to valid ranges", async () => {
      mocks.mockPrisma.appSetting.findUnique.mockImplementation(({ where }: any) => {
        if (where.key === "distill_config") {
          return Promise.resolve({
            key: "distill_config",
            value: {
              teacherTimeoutMs: 100, // below 5000 minimum
              trainer: {
                backend: "  ",
                pythonCommand: "  ",
                maxSteps: 99999, // above 2000 max
                perDeviceBatchSize: 99, // above 16 max
                gradientAccumulationSteps: 999, // above 64 max
                learningRate: 999, // above 0.1 max
                loraRank: 999, // above 256 max
                loraAlpha: 999, // above 256 max
                maxSeqLength: 99999, // above 4096 max
                orpoBeta: 999, // above 10 max
                toolRewardScale: 999, // above 10 max
              },
            },
          });
        }
        if (where.key === "distill_teacher_usage_daily") {
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      });

      // Should not throw — values are clamped
      const result = await service.getReadiness();
      expect(result).toBeDefined();
    });
  });

  // ── toQuotaState — cooldown paths ─────────────────────────────────────

  describe("getQuotaState — cooldown", () => {
    it("includes etaSeconds when cooldownUntil is in the future", async () => {
      const futureTime = new Date(Date.now() + 30000); // 30 seconds from now

      mocks.mockPrisma.appSetting.findUnique.mockImplementation(({ where }: any) => {
        if (where.key === "distill_teacher_usage_daily") {
          return Promise.resolve({
            key: "distill_teacher_usage_daily",
            value: {
              day: new Date().toISOString().split("T")[0],
              tokensUsed: 100,
              requests: 5,
              lastRequestAt: new Date().toISOString(),
              cooldownUntil: futureTime.toISOString(),
            },
          });
        }
        return Promise.resolve({
          key: "distill_config",
          value: {
            teacherRateLimit: {
              dailyTokenBudget: 1000000,
            },
          },
        });
      });

      const result = await service.getQuotaState();

      expect(result.quota.cooldownUntil).toBeDefined();
      expect(result.quota.etaSeconds).toBeGreaterThan(0);
    });

    it("returns null etaSeconds when cooldownUntil is in the past", async () => {
      const pastTime = new Date(Date.now() - 30000);

      mocks.mockPrisma.appSetting.findUnique.mockImplementation(({ where }: any) => {
        if (where.key === "distill_teacher_usage_daily") {
          return Promise.resolve({
            key: "distill_teacher_usage_daily",
            value: {
              day: new Date().toISOString().split("T")[0],
              tokensUsed: 100,
              requests: 5,
              lastRequestAt: new Date().toISOString(),
              cooldownUntil: pastTime.toISOString(),
            },
          });
        }
        return Promise.resolve({
          key: "distill_config",
          value: {
            teacherRateLimit: {
              dailyTokenBudget: 1000000,
            },
          },
        });
      });

      const result = await service.getQuotaState();

      expect(result.quota.etaSeconds).toBeNull();
    });
  });

  // ── reviewDataset — with notes ────────────────────────────────────────

  describe("reviewDataset — with notes and needs_edit", () => {
    it("passes review notes through to update", async () => {
      const datasetId = "dataset-notes";

      mocks.mockPrisma.distillExample.update.mockResolvedValue({});

      mocks.mockPrisma.distillExample.findMany.mockResolvedValue([
        { id: "ex-1", reviewerDecision: "approved" },
        { id: "ex-2", reviewerDecision: "needs_edit" },
      ]);

      mocks.mockPrisma.distillDataset.update.mockResolvedValue({
        id: datasetId,
        title: "Test Dataset",
        objectiveSplit: "70-30-coding-general",
        privacyPolicyVersion: "private-safe-v1",
        status: "draft", // still draft because needs_edit remains
        sampleCount: 2,
        approvedCount: 1,
        rejectedCount: 0,
        createdBy: "test-user",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.reviewDataset({
        actor: "test-user",
        dataset_id: datasetId,
        decisions: [
          { example_id: "ex-1", decision: "approved", note: "Looks good" },
        ],
      });

      expect(result.dataset.status).toBe("draft");
      expect(mocks.mockPrisma.distillExample.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reviewNotes: "Looks good",
          }),
        })
      );
    });
  });

  // ── runEval — with baseline model ─────────────────────────────────────

  describe("runEval — with baseline model", () => {
    it("passes baseline_model_id through to evaluation", async () => {
      const runId = "run-baseline";
      const evalId = "eval-baseline";

      mocks.mockPrisma.distillRun.findUnique.mockResolvedValue({
        id: runId,
        datasetId: "dataset-123",
        artifactPath: "/tmp/distill/runs/baseline-sft",
        studentModelId: "Qwen/Qwen3.5-0.8B",
        status: "completed",
      });

      // No holdout examples available
      mocks.mockPrisma.distillExample.findMany.mockResolvedValue([]);

      mocks.mockPrisma.distillEvalRun.create.mockResolvedValue({
        id: evalId,
        runId,
        baselineModelId: "baseline-model-v1",
        pass: false,
        metrics: {
          coding_pass_at_1: 0,
          policy_adherence: 0,
          tool_use_success: 0,
          latency_ms_p95: 0,
          degenerate_rate: 1,
        },
        createdAt: new Date(),
      });

      const result = await service.runEval({
        actor: "test-user",
        run_id: runId,
        baseline_model_id: "baseline-model-v1",
      });

      expect(result.eval.baselineModelId).toBe("baseline-model-v1");
      expect(result.eval.pass).toBe(false);
    });
  });

  // ── exportApprovedDataset — holdout path coverage ─────────────────────

  describe("startTraining — holdout export and non-string citations", () => {
    it("filters out non-string citations in exported dataset", async () => {
      const datasetId = "dataset-cit";
      const runId = "run-cit";

      mocks.mockPrisma.distillRun.create.mockResolvedValue({
        id: runId,
        datasetId,
        stage: "sft",
        studentModelId: "Qwen/Qwen3.5-0.8B",
        status: "queued",
        reasonCode: null,
        jobId: null,
        backend: "hf-lora-local",
        startedAt: null,
        finishedAt: null,
        metrics: {},
        artifactPath: "/tmp/distill/runs/cit-sft",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mocks.mockPrisma.distillExample.findMany.mockResolvedValue([
        {
          id: "ex-1",
          spec: { specId: "spec-1", intent: "test", constraints: ["c1"], requiredChecks: ["check1"], riskClass: "low" },
          teacherOutput: "output with citations",
          reviewerDecision: "approved",
          privacySafe: true,
          citations: ["valid-citation", 123, null, "another-citation"], // mixed types
          metadata: { split: "train", benchmark_rubric: "rubric-v1" },
          createdAt: new Date(),
          reviewedAt: new Date(),
        },
      ]);

      mocks.mockPrisma.distillRun.update.mockResolvedValue({
        id: runId,
        datasetId,
        stage: "sft",
        studentModelId: "Qwen/Qwen3.5-0.8B",
        status: "completed",
        reasonCode: null,
        jobId: "job-cit",
        backend: "hf-lora-local",
        startedAt: new Date(),
        finishedAt: new Date(),
        metrics: {},
        artifactPath: "/tmp/distill/runs/cit-sft",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mocks.mockPrisma.modelArtifactRegistry.create.mockResolvedValue({});

      const result = await service.startTraining({
        actor: "test-user",
        dataset_id: datasetId,
        stage: "sft",
        student_model_id: "Qwen/Qwen3.5-0.8B",
      });

      expect(result.run.status).toBe("completed");
      // Verify writeFile was called (the dataset was exported)
      expect(mocks.mockFsp.writeFile).toHaveBeenCalled();
    });
  });
});

import { PrismaClient } from "@prisma/client";

const DEFAULT_ONPREM_PLUGIN_ID = "qwen3.5-4b";
const DEFAULT_ONPREM_MODEL = "mlx-community/Qwen3.5-4B-4bit";
const LEGACY_ONPREM_PLUGIN_ID = "qwen2.5-coder-3b";
const LEGACY_ONPREM_MODEL = "Qwen/Qwen2.5-Coder-3B-Instruct";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://agentic:agentic@localhost:5433/agentic_workforce?schema=public";
}

export const prisma = new PrismaClient({
  log: ["warn", "error"],
});

async function rolloutQwen35FourBDefaults() {
  const onPrem = await prisma.appSetting.findUnique({ where: { key: "onprem_qwen_config" } });
  const onPremValue = (onPrem?.value as Record<string, unknown> | null) || {};
  const currentPluginId = typeof onPremValue.pluginId === "string" ? onPremValue.pluginId : "";
  const currentModel = typeof onPremValue.model === "string" ? onPremValue.model : "";

  const shouldRollForwardOnPrem =
    (!currentPluginId && !currentModel) ||
    ((currentPluginId === LEGACY_ONPREM_PLUGIN_ID || !currentPluginId) &&
      (currentModel === LEGACY_ONPREM_MODEL || !currentModel));

  if (shouldRollForwardOnPrem) {
    await prisma.appSetting.upsert({
      where: { key: "onprem_qwen_config" },
      update: {
        value: {
          ...onPremValue,
          pluginId: DEFAULT_ONPREM_PLUGIN_ID,
          model: DEFAULT_ONPREM_MODEL,
        },
      },
      create: {
        key: "onprem_qwen_config",
        value: {
          ...onPremValue,
          pluginId: DEFAULT_ONPREM_PLUGIN_ID,
          model: DEFAULT_ONPREM_MODEL,
        },
      },
    });
  } else if (typeof onPremValue.reasoningMode !== "string" || !onPremValue.reasoningMode) {
    await prisma.appSetting.upsert({
      where: { key: "onprem_qwen_config" },
      update: {
        value: {
          ...onPremValue,
          reasoningMode: "off",
        },
      },
      create: {
        key: "onprem_qwen_config",
        value: {
          ...onPremValue,
          reasoningMode: "off",
        },
      },
    });
  }

  const roleRow = await prisma.appSetting.findUnique({ where: { key: "model_role_bindings" } });
  const roleValue = (roleRow?.value as Record<string, Record<string, unknown>> | null) || {};
  const nextRoleValue = { ...roleValue };
  let roleChanged = false;

  for (const role of ["coder_default", "review_deep"] as const) {
    const current = (roleValue[role] || {}) as Record<string, unknown>;
    const providerId = typeof current.providerId === "string" ? current.providerId : "onprem-qwen";
    const pluginId = typeof current.pluginId === "string" ? current.pluginId : "";
    const model = typeof current.model === "string" ? current.model : "";

    const shouldRollForwardRole =
      providerId === "onprem-qwen" &&
      ((!pluginId && !model) ||
        ((pluginId === LEGACY_ONPREM_PLUGIN_ID || !pluginId) &&
          (model === LEGACY_ONPREM_MODEL || !model)));

    if (!shouldRollForwardRole) {
      continue;
    }

    nextRoleValue[role] = {
      ...current,
      role,
      providerId: "onprem-qwen",
      pluginId: DEFAULT_ONPREM_PLUGIN_ID,
      model: DEFAULT_ONPREM_MODEL,
      reasoningMode: role === "review_deep" ? "on" : "off",
    };
    roleChanged = true;
  }

  for (const role of ["utility_fast", "coder_default", "review_deep"] as const) {
    const current = (nextRoleValue[role] || roleValue[role] || {}) as Record<string, unknown>;
    if (typeof current.reasoningMode === "string" || typeof current.providerId !== "string" || current.providerId !== "onprem-qwen") {
      continue;
    }
    nextRoleValue[role] = {
      ...current,
      reasoningMode: role === "review_deep" ? "on" : "off",
    };
    roleChanged = true;
  }

  if (roleChanged) {
    await prisma.appSetting.upsert({
      where: { key: "model_role_bindings" },
      update: { value: nextRoleValue },
      create: { key: "model_role_bindings", value: nextRoleValue },
    });
  }
}

export async function initDatabase() {
  await prisma.$connect();

  await prisma.appSetting.upsert({
    where: { key: "active_provider" },
    update: {},
    create: { key: "active_provider", value: "onprem-qwen" },
  });

  await prisma.appSetting.upsert({
    where: { key: "active_repo" },
    update: {},
    create: { key: "active_repo", value: null },
  });

  await prisma.appSetting.upsert({
    where: { key: "safety_policy" },
    update: {},
    create: {
      key: "safety_policy",
      value: {
        requireApprovalForDestructiveOps: true,
        requireApprovalForProviderChanges: true,
        requireApprovalForCodeApply: true,
      },
    },
  });

  await prisma.appSetting.upsert({
    where: { key: "onprem_qwen_config" },
    update: {},
    create: {
      key: "onprem_qwen_config",
      value: {
        baseUrl: process.env.ONPREM_QWEN_BASE_URL || "http://127.0.0.1:8000/v1",
        apiKey: process.env.ONPREM_QWEN_API_KEY || "",
        inferenceBackendId: process.env.ONPREM_QWEN_INFERENCE_BACKEND || "mlx-lm",
        pluginId: process.env.ONPREM_QWEN_PLUGIN || DEFAULT_ONPREM_PLUGIN_ID,
        model: process.env.ONPREM_QWEN_MODEL || DEFAULT_ONPREM_MODEL,
        reasoningMode: process.env.ONPREM_QWEN_REASONING_MODE || "off",
        timeoutMs: 120000,
        temperature: 0.15,
        maxTokens: 1600,
      },
    },
  });

  await prisma.appSetting.upsert({
    where: { key: "openai_compatible_config" },
    update: {},
    create: {
      key: "openai_compatible_config",
      value: {
        baseUrl: process.env.OPENAI_COMPAT_BASE_URL || "http://127.0.0.1:11434/v1",
        apiKey: process.env.OPENAI_COMPAT_API_KEY || "",
        model: process.env.OPENAI_COMPAT_MODEL || "gpt-4o-mini",
        timeoutMs: 120000,
        temperature: 0.2,
        maxTokens: 1800,
      },
    },
  });

  await prisma.appSetting.upsert({
    where: { key: "openai_responses_config" },
    update: {},
    create: {
      key: "openai_responses_config",
      value: {
        baseUrl: process.env.OPENAI_RESPONSES_BASE_URL || "https://api.openai.com/v1",
        apiKey: process.env.OPENAI_API_KEY || "",
        model: process.env.OPENAI_RESPONSES_MODEL || "gpt-5-nano",
        timeoutMs: Number(process.env.OPENAI_RESPONSES_TIMEOUT_MS || 120000),
        reasoningEffort: process.env.OPENAI_RESPONSES_REASONING_EFFORT || "medium",
        dailyBudgetUsd: Number(process.env.OPENAI_RESPONSES_DAILY_BUDGET_USD || 25),
        perRunBudgetUsd: Number(process.env.OPENAI_RESPONSES_PER_RUN_BUDGET_USD || 5),
        toolPolicy: {
          enableFileSearch: false,
          enableRemoteMcp: false,
        },
      },
    },
  });

  await prisma.appSetting.upsert({
    where: { key: "model_role_bindings" },
    update: {},
    create: {
      key: "model_role_bindings",
      value: {
        utility_fast: {
          role: "utility_fast",
          providerId: "onprem-qwen",
          pluginId: "qwen3.5-0.8b",
          model: "Qwen/Qwen3.5-0.8B",
          temperature: 0.1,
          maxTokens: 900,
          reasoningMode: "off",
        },
        coder_default: {
          role: "coder_default",
          providerId: "onprem-qwen",
          pluginId: DEFAULT_ONPREM_PLUGIN_ID,
          model: DEFAULT_ONPREM_MODEL,
          temperature: 0.12,
          maxTokens: 1800,
          reasoningMode: "off",
        },
        review_deep: {
          role: "review_deep",
          providerId: "onprem-qwen",
          pluginId: DEFAULT_ONPREM_PLUGIN_ID,
          model: DEFAULT_ONPREM_MODEL,
          temperature: 0.08,
          maxTokens: 2200,
          reasoningMode: "on",
        },
        overseer_escalation: {
          role: "overseer_escalation",
          providerId: "openai-responses",
          pluginId: null,
          model: process.env.OPENAI_RESPONSES_MODEL || "gpt-5-nano",
          temperature: 0.1,
          maxTokens: 2200,
        },
      },
    },
  });

  await prisma.appSetting.upsert({
    where: { key: "parallel_runtime_config" },
    update: {},
    create: {
      key: "parallel_runtime_config",
      value: {
        maxLocalLanes: 4,
        maxExpandedLanes: 6,
        defaultLaneLeaseMinutes: 20,
        heartbeatIntervalSeconds: 10,
        staleAfterSeconds: 60,
        reservationTtlSeconds: 14400,
      },
    },
  });

  await prisma.appSetting.upsert({
    where: { key: "github_app_config" },
    update: {},
    create: {
      key: "github_app_config",
      value: {
        appSlug: process.env.GITHUB_APP_SLUG || "agentic-workforce",
        appId: process.env.GITHUB_APP_ID || "",
        clientId: process.env.GITHUB_APP_CLIENT_ID || "",
        relayBaseUrl: process.env.GITHUB_APP_RELAY_BASE_URL || "",
        enabled: false,
        mode: "draft_pr",
      },
    },
  });

  await prisma.appSetting.upsert({
    where: { key: "runtime_profiles" },
    update: {},
    create: {
      key: "runtime_profiles",
      value: {
        minimal: {
          name: "minimal",
          parallelism: "off",
          verificationDepth: "light",
        },
        standard: {
          name: "standard",
          parallelism: "auto",
          verificationDepth: "standard",
        },
        strict: {
          name: "strict",
          parallelism: "guarded",
          verificationDepth: "deep",
          requireReviewDeep: true,
        },
      },
    },
  });

  await prisma.appSetting.upsert({
    where: { key: "benchmark_rubric" },
    update: {},
    create: {
      key: "benchmark_rubric",
      value: {
        functionalCorrectness: 40,
        guidelineAdherence: 20,
        verificationDiscipline: 15,
        patchQuality: 10,
        retrievalDiscipline: 5,
        policyCompliance: 5,
        latencyRecovery: 5,
        hardFailConditions: [
          "verify_command_failed",
          "required_tests_missing",
          "required_docs_missing",
          "policy_bypass_detected",
          "out_of_workspace_write",
          "merge_conflict_unresolved",
          "retrieval_trace_missing",
        ],
      },
    },
  });

  await prisma.appSetting.upsert({
    where: { key: "distill_config" },
    update: {},
    create: {
      key: "distill_config",
      value: {
        teacherCommand: process.env.DISTILL_TEACHER_COMMAND || "claude",
        teacherModel: process.env.DISTILL_TEACHER_MODEL || "opus",
        teacherTimeoutMs: Number(process.env.DISTILL_TEACHER_TIMEOUT_MS || 120000),
        privacyPolicyVersion: "private-safe-v1",
        objectiveSplit: "70-30-coding-general",
        teacherRateLimit: {
          maxRequestsPerMinute: Number(process.env.DISTILL_TEACHER_MAX_RPM || 6),
          maxConcurrentTeacherJobs: Number(process.env.DISTILL_TEACHER_MAX_CONCURRENCY || 1),
          dailyTokenBudget: Number(process.env.DISTILL_TEACHER_DAILY_TOKEN_BUDGET || 120000),
          retryBackoffMs: Number(process.env.DISTILL_TEACHER_RETRY_BACKOFF_MS || 2500),
          maxRetries: Number(process.env.DISTILL_TEACHER_MAX_RETRIES || 3),
        },
        trainer: {
          backend: process.env.DISTILL_TRAINER_BACKEND || "hf-lora-local",
          pythonCommand: process.env.DISTILL_TRAINER_PYTHON || "python3",
          maxSteps: Number(process.env.DISTILL_TRAINER_MAX_STEPS || 40),
          perDeviceBatchSize: Number(process.env.DISTILL_TRAINER_BATCH_SIZE || 1),
          gradientAccumulationSteps: Number(process.env.DISTILL_TRAINER_GRAD_ACCUM || 8),
          learningRate: Number(process.env.DISTILL_TRAINER_LR || 0.0002),
          loraRank: Number(process.env.DISTILL_TRAINER_LORA_R || 8),
          loraAlpha: Number(process.env.DISTILL_TRAINER_LORA_ALPHA || 16),
          maxSeqLength: Number(process.env.DISTILL_TRAINER_MAX_SEQ_LENGTH || 1024),
          orpoBeta: Number(process.env.DISTILL_TRAINER_ORPO_BETA || 0.1),
          toolRewardScale: Number(process.env.DISTILL_TRAINER_TOOL_REWARD_SCALE || 0.6),
        },
      },
    },
  });

  await rolloutQwen35FourBDefaults();
}

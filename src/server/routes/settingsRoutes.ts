import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { DEFAULT_QWEN_CLI_ARGS } from "../providers/qwenCliConfig";
import { ChannelService } from "../services/channelService";
import {
  clearStoredSecret,
  getSecretState,
  PROVIDER_SECRET_NAMES,
  resolveSecretValue,
  setStoredSecret,
} from "../services/secretStore";
import {
  defaultLocalQwenRoleBindings,
  hasConfiguredSecret,
  inferRuntimeMode,
  mergeSecretInput,
  normalizeExecutionProfiles,
  openAiUnifiedRoleBindings,
} from "./shared/runtimeConfig";
import type { ExperimentalChannelsConfig } from "../../shared/contracts";

const setRuntimeModeSchema = z.object({
  mode: z.enum(["local_qwen", "openai_api"]),
  openAiApiKey: z.string().trim().optional(),
  openAiModel: z.string().trim().optional(),
});

type SettingsRouteDeps = {
  app: FastifyInstance;
  channelService: ChannelService;
};

async function applySecretPatch(input: {
  secretName: string;
  value?: string;
  clearRequested?: boolean;
}) {
  if (input.clearRequested) {
    await clearStoredSecret(prisma, input.secretName);
    return;
  }
  if (typeof input.value === "string" && input.value.trim()) {
    await setStoredSecret(prisma, input.secretName, input.value);
  }
}

type SettingsPatchBody = {
  safety?: Record<string, unknown>;
  qwenCli?: {
    command?: string;
    args?: string[];
    timeoutMs?: number;
  };
  onPremQwen?: {
    baseUrl?: string;
    apiKey?: string;
    clearApiKey?: boolean;
    inferenceBackendId?: string;
    pluginId?: string;
    model?: string;
    reasoningMode?: "off" | "on" | "auto";
    timeoutMs?: number;
    temperature?: number;
    maxTokens?: number;
  };
  onPremQwenRoleRuntimes?: Record<string, unknown>;
  openAiCompatible?: {
    baseUrl?: string;
    apiKey?: string;
    clearApiKey?: boolean;
    model?: string;
    timeoutMs?: number;
    temperature?: number;
    maxTokens?: number;
  };
  openAiResponses?: {
    baseUrl?: string;
    apiKey?: string;
    clearApiKey?: boolean;
    model?: string;
    timeoutMs?: number;
    reasoningEffort?: "low" | "medium" | "high";
    dailyBudgetUsd?: number;
    perRunBudgetUsd?: number;
    toolPolicy?: {
      enableFileSearch?: boolean;
      enableRemoteMcp?: boolean;
    };
  };
  modelRoles?: Record<string, unknown>;
  executionProfiles?: {
    activeProfileId?: string;
    profiles?: Array<{
      id?: string;
      name?: string;
      description?: string;
      preset?: "balanced" | "deep_scope" | "build_heavy" | "custom";
      stages?: {
        scope?: "utility_fast" | "coder_default" | "review_deep" | "overseer_escalation";
        build?: "utility_fast" | "coder_default" | "review_deep" | "overseer_escalation";
        review?: "utility_fast" | "coder_default" | "review_deep" | "overseer_escalation";
        escalate?: "utility_fast" | "coder_default" | "review_deep" | "overseer_escalation";
      };
      updatedAt?: string;
    }>;
  };
  parallelRuntime?: {
    maxLocalLanes?: number;
    maxExpandedLanes?: number;
    defaultLaneLeaseMinutes?: number;
    heartbeatIntervalSeconds?: number;
    staleAfterSeconds?: number;
    reservationTtlSeconds?: number;
  };
  distill?: {
    teacherCommand?: string;
    teacherModel?: string;
    teacherTimeoutMs?: number;
    privacyPolicyVersion?: string;
    objectiveSplit?: string;
    teacherRateLimit?: {
      maxRequestsPerMinute?: number;
      maxConcurrentTeacherJobs?: number;
      dailyTokenBudget?: number;
      retryBackoffMs?: number;
      maxRetries?: number;
    };
    trainer?: {
      backend?: string;
      pythonCommand?: string;
      maxSteps?: number;
      perDeviceBatchSize?: number;
      gradientAccumulationSteps?: number;
      learningRate?: number;
      loraRank?: number;
      loraAlpha?: number;
      maxSeqLength?: number;
      orpoBeta?: number;
      toolRewardScale?: number;
    };
  };
  experimentalChannels?: Partial<ExperimentalChannelsConfig>;
};

export function registerSettingsRoutes(deps: SettingsRouteDeps) {
  const { app, channelService } = deps;

  app.get("/api/v1/settings", async () => {
    const activeProvider = await prisma.appSetting.findUnique({ where: { key: "active_provider" } });
    const safety = await prisma.appSetting.findUnique({ where: { key: "safety_policy" } });
    const qwen = await prisma.appSetting.findUnique({ where: { key: "qwen_cli_config" } });
    const onPrem = await prisma.appSetting.findUnique({ where: { key: "onprem_qwen_config" } });
    const onPremRoleRuntimes = await prisma.appSetting.findUnique({ where: { key: "onprem_qwen_role_runtime_configs" } });
    const openAiCompat = await prisma.appSetting.findUnique({ where: { key: "openai_compatible_config" } });
    const openAiResponses = await prisma.appSetting.findUnique({ where: { key: "openai_responses_config" } });
    const modelRoles = await prisma.appSetting.findUnique({ where: { key: "model_role_bindings" } });
    const parallelRuntime = await prisma.appSetting.findUnique({ where: { key: "parallel_runtime_config" } });
    const executionProfiles = await prisma.appSetting.findUnique({ where: { key: "execution_profiles" } });
    const distill = await prisma.appSetting.findUnique({ where: { key: "distill_config" } });
    const experimentalChannels = await channelService.getConfig();
    const qwenValue = (qwen?.value as Record<string, unknown>) || {};
    const onPremValue = (onPrem?.value as Record<string, unknown>) || {};
    const onPremRoleRuntimesValue = (onPremRoleRuntimes?.value as Record<string, unknown>) || {};
    const openAiCompatValue = (openAiCompat?.value as Record<string, unknown>) || {};
    const openAiResponsesValue = (openAiResponses?.value as Record<string, unknown>) || {};
    const modelRolesValue = (modelRoles?.value as Record<string, unknown>) || {};
    const activeProviderValue =
      typeof activeProvider?.value === "string" && activeProvider.value.trim()
        ? activeProvider.value
        : "onprem-qwen";
    const parallelRuntimeValue = (parallelRuntime?.value as Record<string, unknown>) || {};
    const executionProfilesValue = normalizeExecutionProfiles(executionProfiles?.value);
    const distillValue = (distill?.value as Record<string, unknown>) || {};
    const [onPremApiKeyState, openAiCompatibleApiKeyState, openAiResponsesApiKeyState, sanitizedRoleRuntimeEntries] =
      await Promise.all([
        getSecretState(prisma, PROVIDER_SECRET_NAMES.onPremQwenApiKey, process.env.ONPREM_QWEN_API_KEY || ""),
        getSecretState(prisma, PROVIDER_SECRET_NAMES.openAiCompatibleApiKey, process.env.OPENAI_COMPAT_API_KEY || ""),
        getSecretState(prisma, PROVIDER_SECRET_NAMES.openAiResponsesApiKey, process.env.OPENAI_API_KEY || ""),
        Promise.all(
          Object.entries(onPremRoleRuntimesValue).map(async ([role, rawValue]) => {
            const runtime = (rawValue ?? {}) as Record<string, unknown>;
            const { apiKey: _runtimeApiKey, ...restRuntime } = runtime;
            const secretState = await getSecretState(prisma, PROVIDER_SECRET_NAMES.onPremRoleRuntimeApiKey(role));
            return [
              role,
              {
                ...restRuntime,
                hasApiKey: secretState.hasSecret,
                apiKeySource: secretState.source,
              },
            ] as const;
          })
        ),
      ]);
    const sanitizedRoleRuntimes = Object.fromEntries(sanitizedRoleRuntimeEntries);
    const sanitizedExperimentalChannels: ExperimentalChannelsConfig = {
      ...experimentalChannels,
      webhook: {
        ...experimentalChannels.webhook,
        signingSecret: "",
        hasSigningSecret: hasConfiguredSecret(experimentalChannels.webhook.signingSecret),
      },
      telegram: {
        ...experimentalChannels.telegram,
        signingSecret: "",
        hasSigningSecret: hasConfiguredSecret(experimentalChannels.telegram.signingSecret),
      },
      ciMonitoring: {
        ...experimentalChannels.ciMonitoring,
        signingSecret: "",
        hasSigningSecret: hasConfiguredSecret(experimentalChannels.ciMonitoring.signingSecret),
      },
    };
    const qwenArgs = Array.isArray(qwenValue.args)
      ? qwenValue.args.filter((item): item is string => typeof item === "string")
      : (process.env.QWEN_ARGS || DEFAULT_QWEN_CLI_ARGS.join(" ")).split(" ");
    const normalizedQwenArgs =
      qwenArgs.join(" ").trim() === "chat --prompt" || !qwenArgs.length ? DEFAULT_QWEN_CLI_ARGS : qwenArgs;

    return {
      items: {
        safety: safety?.value ?? {
          requireApprovalForDestructiveOps: true,
          requireApprovalForProviderChanges: true,
          requireApprovalForCodeApply: true,
        },
        qwenCli: {
          command:
            typeof qwenValue.command === "string" && qwenValue.command.trim()
              ? qwenValue.command
              : process.env.QWEN_COMMAND || "qwen",
          args: normalizedQwenArgs,
          timeoutMs: typeof qwenValue.timeoutMs === "number" ? qwenValue.timeoutMs : 120000,
        },
        onPremQwen: {
          baseUrl:
            typeof onPremValue.baseUrl === "string" && onPremValue.baseUrl.trim()
              ? onPremValue.baseUrl
              : process.env.ONPREM_QWEN_BASE_URL || "http://127.0.0.1:8000/v1",
          hasApiKey: onPremApiKeyState.hasSecret,
          apiKeySource: onPremApiKeyState.source,
          inferenceBackendId:
            typeof onPremValue.inferenceBackendId === "string" && onPremValue.inferenceBackendId.trim()
              ? onPremValue.inferenceBackendId
              : process.env.ONPREM_QWEN_INFERENCE_BACKEND || "mlx-lm",
          pluginId:
            typeof onPremValue.pluginId === "string" && onPremValue.pluginId.trim()
              ? onPremValue.pluginId
              : process.env.ONPREM_QWEN_PLUGIN || "qwen3.5-4b",
          model:
            typeof onPremValue.model === "string" && onPremValue.model.trim()
              ? onPremValue.model
              : process.env.ONPREM_QWEN_MODEL || "mlx-community/Qwen3.5-4B-4bit",
          reasoningMode:
            typeof onPremValue.reasoningMode === "string" && onPremValue.reasoningMode.trim()
              ? onPremValue.reasoningMode
              : process.env.ONPREM_QWEN_REASONING_MODE || "off",
          timeoutMs: typeof onPremValue.timeoutMs === "number" ? onPremValue.timeoutMs : 120000,
          temperature: typeof onPremValue.temperature === "number" ? onPremValue.temperature : 0.15,
          maxTokens: typeof onPremValue.maxTokens === "number" ? onPremValue.maxTokens : 1600,
        },
        onPremQwenRoleRuntimes: sanitizedRoleRuntimes,
        openAiCompatible: {
          baseUrl:
            typeof openAiCompatValue.baseUrl === "string" && openAiCompatValue.baseUrl.trim()
              ? openAiCompatValue.baseUrl
              : process.env.OPENAI_COMPAT_BASE_URL || "http://127.0.0.1:11434/v1",
          hasApiKey: openAiCompatibleApiKeyState.hasSecret,
          apiKeySource: openAiCompatibleApiKeyState.source,
          model:
            typeof openAiCompatValue.model === "string" && openAiCompatValue.model.trim()
              ? openAiCompatValue.model
              : process.env.OPENAI_COMPAT_MODEL || "gpt-4o-mini",
          timeoutMs: typeof openAiCompatValue.timeoutMs === "number" ? openAiCompatValue.timeoutMs : 120000,
          temperature: typeof openAiCompatValue.temperature === "number" ? openAiCompatValue.temperature : 0.2,
          maxTokens: typeof openAiCompatValue.maxTokens === "number" ? openAiCompatValue.maxTokens : 1800,
        },
        openAiResponses: {
          baseUrl:
            typeof openAiResponsesValue.baseUrl === "string" && openAiResponsesValue.baseUrl.trim()
              ? openAiResponsesValue.baseUrl
              : process.env.OPENAI_RESPONSES_BASE_URL || "https://api.openai.com/v1",
          hasApiKey: openAiResponsesApiKeyState.hasSecret,
          apiKeySource: openAiResponsesApiKeyState.source,
          model:
            typeof openAiResponsesValue.model === "string" && openAiResponsesValue.model.trim()
              ? openAiResponsesValue.model
              : process.env.OPENAI_RESPONSES_MODEL || "gpt-5-nano",
          timeoutMs: typeof openAiResponsesValue.timeoutMs === "number" ? openAiResponsesValue.timeoutMs : 120000,
          reasoningEffort:
            typeof openAiResponsesValue.reasoningEffort === "string" && openAiResponsesValue.reasoningEffort.trim()
              ? openAiResponsesValue.reasoningEffort
              : "medium",
          dailyBudgetUsd:
            typeof openAiResponsesValue.dailyBudgetUsd === "number" ? openAiResponsesValue.dailyBudgetUsd : 25,
          perRunBudgetUsd:
            typeof openAiResponsesValue.perRunBudgetUsd === "number" ? openAiResponsesValue.perRunBudgetUsd : 5,
          toolPolicy:
            typeof openAiResponsesValue.toolPolicy === "object" && openAiResponsesValue.toolPolicy
              ? openAiResponsesValue.toolPolicy
              : { enableFileSearch: false, enableRemoteMcp: false },
        },
        runtimeMode: inferRuntimeMode(activeProviderValue, modelRolesValue),
        modelRoles: modelRolesValue,
        executionProfiles: executionProfilesValue,
        parallelRuntime: {
          maxLocalLanes: typeof parallelRuntimeValue.maxLocalLanes === "number" ? parallelRuntimeValue.maxLocalLanes : 4,
          maxExpandedLanes:
            typeof parallelRuntimeValue.maxExpandedLanes === "number" ? parallelRuntimeValue.maxExpandedLanes : 6,
          defaultLaneLeaseMinutes:
            typeof parallelRuntimeValue.defaultLaneLeaseMinutes === "number"
              ? parallelRuntimeValue.defaultLaneLeaseMinutes
              : 20,
          heartbeatIntervalSeconds:
            typeof parallelRuntimeValue.heartbeatIntervalSeconds === "number"
              ? parallelRuntimeValue.heartbeatIntervalSeconds
              : 10,
          staleAfterSeconds:
            typeof parallelRuntimeValue.staleAfterSeconds === "number" ? parallelRuntimeValue.staleAfterSeconds : 60,
          reservationTtlSeconds:
            typeof parallelRuntimeValue.reservationTtlSeconds === "number"
              ? parallelRuntimeValue.reservationTtlSeconds
              : 14400,
        },
        distill: {
          teacherCommand:
            typeof distillValue.teacherCommand === "string" && distillValue.teacherCommand.trim()
              ? distillValue.teacherCommand
              : process.env.DISTILL_TEACHER_COMMAND || "claude",
          teacherModel:
            typeof distillValue.teacherModel === "string" && distillValue.teacherModel.trim()
              ? distillValue.teacherModel
              : process.env.DISTILL_TEACHER_MODEL || "opus",
          teacherTimeoutMs:
            typeof distillValue.teacherTimeoutMs === "number" ? distillValue.teacherTimeoutMs : 120000,
          privacyPolicyVersion:
            typeof distillValue.privacyPolicyVersion === "string" && distillValue.privacyPolicyVersion.trim()
              ? distillValue.privacyPolicyVersion
              : "private-safe-v1",
          objectiveSplit:
            typeof distillValue.objectiveSplit === "string" && distillValue.objectiveSplit.trim()
              ? distillValue.objectiveSplit
              : "70-30-coding-general",
          teacherRateLimit:
            typeof distillValue.teacherRateLimit === "object" && distillValue.teacherRateLimit
              ? distillValue.teacherRateLimit
              : {
                  maxRequestsPerMinute: 6,
                  maxConcurrentTeacherJobs: 1,
                  dailyTokenBudget: 120000,
                  retryBackoffMs: 2500,
                  maxRetries: 3,
                },
          trainer:
            typeof distillValue.trainer === "object" && distillValue.trainer
              ? {
                  backend:
                    typeof (distillValue.trainer as { backend?: unknown }).backend === "string"
                      ? (distillValue.trainer as { backend: string }).backend
                      : "hf-lora-local",
                  pythonCommand:
                    typeof (distillValue.trainer as { pythonCommand?: unknown }).pythonCommand === "string"
                      ? (distillValue.trainer as { pythonCommand: string }).pythonCommand
                      : "python3",
                  maxSteps:
                    typeof (distillValue.trainer as { maxSteps?: unknown }).maxSteps === "number"
                      ? (distillValue.trainer as { maxSteps: number }).maxSteps
                      : 40,
                  perDeviceBatchSize:
                    typeof (distillValue.trainer as { perDeviceBatchSize?: unknown }).perDeviceBatchSize === "number"
                      ? (distillValue.trainer as { perDeviceBatchSize: number }).perDeviceBatchSize
                      : 1,
                  gradientAccumulationSteps:
                    typeof (distillValue.trainer as { gradientAccumulationSteps?: unknown }).gradientAccumulationSteps === "number"
                      ? (distillValue.trainer as { gradientAccumulationSteps: number }).gradientAccumulationSteps
                      : 8,
                  learningRate:
                    typeof (distillValue.trainer as { learningRate?: unknown }).learningRate === "number"
                      ? (distillValue.trainer as { learningRate: number }).learningRate
                      : 0.0002,
                  loraRank:
                    typeof (distillValue.trainer as { loraRank?: unknown }).loraRank === "number"
                      ? (distillValue.trainer as { loraRank: number }).loraRank
                      : 8,
                  loraAlpha:
                    typeof (distillValue.trainer as { loraAlpha?: unknown }).loraAlpha === "number"
                      ? (distillValue.trainer as { loraAlpha: number }).loraAlpha
                      : 16,
                  maxSeqLength:
                    typeof (distillValue.trainer as { maxSeqLength?: unknown }).maxSeqLength === "number"
                      ? (distillValue.trainer as { maxSeqLength: number }).maxSeqLength
                      : 1024,
                  orpoBeta:
                    typeof (distillValue.trainer as { orpoBeta?: unknown }).orpoBeta === "number"
                      ? (distillValue.trainer as { orpoBeta: number }).orpoBeta
                      : 0.1,
                  toolRewardScale:
                    typeof (distillValue.trainer as { toolRewardScale?: unknown }).toolRewardScale === "number"
                      ? (distillValue.trainer as { toolRewardScale: number }).toolRewardScale
                      : 0.6,
                }
              : {
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
        experimentalChannels: sanitizedExperimentalChannels,
      },
    };
  });

  app.patch("/api/v1/settings", async (request) => {
    const input = request.body as SettingsPatchBody;

    if (input.safety) {
      await prisma.appSetting.upsert({
        where: { key: "safety_policy" },
        update: { value: input.safety },
        create: { key: "safety_policy", value: input.safety },
      });
    }

    if (input.qwenCli) {
      const current = await prisma.appSetting.findUnique({ where: { key: "qwen_cli_config" } });
      const previous = (current?.value as Record<string, unknown>) || {};
      const previousArgs = Array.isArray(previous.args) ? previous.args.filter((item): item is string => typeof item === "string") : [];
      const normalizedPreviousArgs =
        previousArgs.join(" ").trim() === "chat --prompt" || !previousArgs.length ? DEFAULT_QWEN_CLI_ARGS : previousArgs;
      const next = {
        command: input.qwenCli.command ?? previous.command ?? process.env.QWEN_COMMAND ?? "qwen",
        args: input.qwenCli.args ?? normalizedPreviousArgs ?? (process.env.QWEN_ARGS || DEFAULT_QWEN_CLI_ARGS.join(" ")).split(" "),
        timeoutMs: input.qwenCli.timeoutMs ?? previous.timeoutMs ?? 120000,
      };

      await prisma.appSetting.upsert({
        where: { key: "qwen_cli_config" },
        update: { value: next },
        create: { key: "qwen_cli_config", value: next },
      });
    }

    if (input.onPremQwen) {
      const current = await prisma.appSetting.findUnique({ where: { key: "onprem_qwen_config" } });
      const previous = (current?.value as Record<string, unknown>) || {};
      const next = {
        baseUrl:
          input.onPremQwen.baseUrl ??
          (typeof previous.baseUrl === "string" ? previous.baseUrl : process.env.ONPREM_QWEN_BASE_URL ?? "http://127.0.0.1:8000/v1"),
        inferenceBackendId:
          input.onPremQwen.inferenceBackendId ??
          (typeof previous.inferenceBackendId === "string"
            ? previous.inferenceBackendId
            : process.env.ONPREM_QWEN_INFERENCE_BACKEND ?? "mlx-lm"),
        pluginId:
          input.onPremQwen.pluginId ??
          (typeof previous.pluginId === "string" ? previous.pluginId : process.env.ONPREM_QWEN_PLUGIN ?? "qwen3.5-4b"),
        model:
          input.onPremQwen.model ??
          (typeof previous.model === "string" ? previous.model : process.env.ONPREM_QWEN_MODEL ?? "mlx-community/Qwen3.5-4B-4bit"),
        reasoningMode:
          input.onPremQwen.reasoningMode ??
          (typeof previous.reasoningMode === "string" ? previous.reasoningMode : process.env.ONPREM_QWEN_REASONING_MODE ?? "off"),
        timeoutMs: input.onPremQwen.timeoutMs ?? (typeof previous.timeoutMs === "number" ? previous.timeoutMs : 120000),
        temperature: input.onPremQwen.temperature ?? (typeof previous.temperature === "number" ? previous.temperature : 0.15),
        maxTokens: input.onPremQwen.maxTokens ?? (typeof previous.maxTokens === "number" ? previous.maxTokens : 1600),
      };

      await prisma.appSetting.upsert({
        where: { key: "onprem_qwen_config" },
        update: { value: next },
        create: { key: "onprem_qwen_config", value: next },
      });

      await applySecretPatch({
        secretName: PROVIDER_SECRET_NAMES.onPremQwenApiKey,
        value: input.onPremQwen.apiKey,
        clearRequested: input.onPremQwen.clearApiKey,
      });
    }

    if (input.onPremQwenRoleRuntimes) {
      const current = await prisma.appSetting.findUnique({ where: { key: "onprem_qwen_role_runtime_configs" } });
      const previous = (current?.value as Record<string, Record<string, unknown>>) || {};
      const next = {
        ...previous,
        ...Object.fromEntries(
          Object.entries(input.onPremQwenRoleRuntimes).map(([role, rawValue]) => {
            const patch = (rawValue ?? {}) as Record<string, unknown>;
            const prior = (previous[role] ?? {}) as Record<string, unknown>;
            const { apiKey: _inputApiKey, clearApiKey: _clearApiKey, ...patchWithoutSecrets } = patch;
            const { apiKey: _priorApiKey, ...priorWithoutSecrets } = prior;
            return [
              role,
              {
                ...priorWithoutSecrets,
                ...patchWithoutSecrets,
              },
            ];
          })
        ),
      };
      await prisma.appSetting.upsert({
        where: { key: "onprem_qwen_role_runtime_configs" },
        update: { value: next },
        create: { key: "onprem_qwen_role_runtime_configs", value: next },
      });

      await Promise.all(
        Object.entries(input.onPremQwenRoleRuntimes).map(async ([role, rawValue]) => {
          const patch = (rawValue ?? {}) as Record<string, unknown>;
          await applySecretPatch({
            secretName: PROVIDER_SECRET_NAMES.onPremRoleRuntimeApiKey(role),
            value: typeof patch.apiKey === "string" ? patch.apiKey : undefined,
            clearRequested: patch.clearApiKey === true,
          });
        })
      );
    }

    if (input.openAiCompatible) {
      const current = await prisma.appSetting.findUnique({ where: { key: "openai_compatible_config" } });
      const previous = (current?.value as Record<string, unknown>) || {};
      const next = {
        baseUrl:
          input.openAiCompatible.baseUrl ??
          (typeof previous.baseUrl === "string" ? previous.baseUrl : process.env.OPENAI_COMPAT_BASE_URL ?? "http://127.0.0.1:11434/v1"),
        model:
          input.openAiCompatible.model ??
          (typeof previous.model === "string" ? previous.model : process.env.OPENAI_COMPAT_MODEL ?? "gpt-4o-mini"),
        timeoutMs: input.openAiCompatible.timeoutMs ?? (typeof previous.timeoutMs === "number" ? previous.timeoutMs : 120000),
        temperature: input.openAiCompatible.temperature ?? (typeof previous.temperature === "number" ? previous.temperature : 0.2),
        maxTokens: input.openAiCompatible.maxTokens ?? (typeof previous.maxTokens === "number" ? previous.maxTokens : 1800),
      };

      await prisma.appSetting.upsert({
        where: { key: "openai_compatible_config" },
        update: { value: next },
        create: { key: "openai_compatible_config", value: next },
      });

      await applySecretPatch({
        secretName: PROVIDER_SECRET_NAMES.openAiCompatibleApiKey,
        value: input.openAiCompatible.apiKey,
        clearRequested: input.openAiCompatible.clearApiKey,
      });
    }

    if (input.openAiResponses) {
      const current = await prisma.appSetting.findUnique({ where: { key: "openai_responses_config" } });
      const previous = (current?.value as Record<string, unknown>) || {};
      const next = {
        baseUrl:
          input.openAiResponses.baseUrl ??
          (typeof previous.baseUrl === "string" ? previous.baseUrl : process.env.OPENAI_RESPONSES_BASE_URL ?? "https://api.openai.com/v1"),
        model:
          input.openAiResponses.model ??
          (typeof previous.model === "string" ? previous.model : process.env.OPENAI_RESPONSES_MODEL ?? "gpt-5-nano"),
        timeoutMs:
          input.openAiResponses.timeoutMs ??
          (typeof previous.timeoutMs === "number" ? previous.timeoutMs : 120000),
        reasoningEffort:
          input.openAiResponses.reasoningEffort ??
          (typeof previous.reasoningEffort === "string" ? previous.reasoningEffort : "medium"),
        dailyBudgetUsd:
          input.openAiResponses.dailyBudgetUsd ??
          (typeof previous.dailyBudgetUsd === "number" ? previous.dailyBudgetUsd : 25),
        perRunBudgetUsd:
          input.openAiResponses.perRunBudgetUsd ??
          (typeof previous.perRunBudgetUsd === "number" ? previous.perRunBudgetUsd : 5),
        toolPolicy: {
          enableFileSearch:
            input.openAiResponses.toolPolicy?.enableFileSearch ??
            (typeof previous.toolPolicy === "object" && previous.toolPolicy
              ? Boolean((previous.toolPolicy as { enableFileSearch?: boolean }).enableFileSearch)
              : false),
          enableRemoteMcp:
            input.openAiResponses.toolPolicy?.enableRemoteMcp ??
            (typeof previous.toolPolicy === "object" && previous.toolPolicy
              ? Boolean((previous.toolPolicy as { enableRemoteMcp?: boolean }).enableRemoteMcp)
              : false),
        },
      };

      await prisma.appSetting.upsert({
        where: { key: "openai_responses_config" },
        update: { value: next },
        create: { key: "openai_responses_config", value: next },
      });

      await applySecretPatch({
        secretName: PROVIDER_SECRET_NAMES.openAiResponsesApiKey,
        value: input.openAiResponses.apiKey,
        clearRequested: input.openAiResponses.clearApiKey,
      });
    }

    if (input.modelRoles) {
      await prisma.appSetting.upsert({
        where: { key: "model_role_bindings" },
        update: { value: input.modelRoles },
        create: { key: "model_role_bindings", value: input.modelRoles },
      });
    }

    if (input.executionProfiles) {
      await prisma.appSetting.upsert({
        where: { key: "execution_profiles" },
        update: { value: normalizeExecutionProfiles(input.executionProfiles) },
        create: { key: "execution_profiles", value: normalizeExecutionProfiles(input.executionProfiles) },
      });
    }

    if (input.parallelRuntime) {
      const current = await prisma.appSetting.findUnique({ where: { key: "parallel_runtime_config" } });
      const previous = (current?.value as Record<string, unknown>) || {};
      const next = {
        maxLocalLanes: input.parallelRuntime.maxLocalLanes ?? (typeof previous.maxLocalLanes === "number" ? previous.maxLocalLanes : 4),
        maxExpandedLanes:
          input.parallelRuntime.maxExpandedLanes ?? (typeof previous.maxExpandedLanes === "number" ? previous.maxExpandedLanes : 6),
        defaultLaneLeaseMinutes:
          input.parallelRuntime.defaultLaneLeaseMinutes ??
          (typeof previous.defaultLaneLeaseMinutes === "number" ? previous.defaultLaneLeaseMinutes : 20),
        heartbeatIntervalSeconds:
          input.parallelRuntime.heartbeatIntervalSeconds ??
          (typeof previous.heartbeatIntervalSeconds === "number" ? previous.heartbeatIntervalSeconds : 10),
        staleAfterSeconds:
          input.parallelRuntime.staleAfterSeconds ?? (typeof previous.staleAfterSeconds === "number" ? previous.staleAfterSeconds : 60),
        reservationTtlSeconds:
          input.parallelRuntime.reservationTtlSeconds ??
          (typeof previous.reservationTtlSeconds === "number" ? previous.reservationTtlSeconds : 14400),
      };

      await prisma.appSetting.upsert({
        where: { key: "parallel_runtime_config" },
        update: { value: next },
        create: { key: "parallel_runtime_config", value: next },
      });
    }

    if (input.distill) {
      const current = await prisma.appSetting.findUnique({ where: { key: "distill_config" } });
      const previous = (current?.value as Record<string, unknown>) || {};
      const next = {
        teacherCommand:
          input.distill.teacherCommand ??
          (typeof previous.teacherCommand === "string" ? previous.teacherCommand : process.env.DISTILL_TEACHER_COMMAND ?? "claude"),
        teacherModel:
          input.distill.teacherModel ??
          (typeof previous.teacherModel === "string" ? previous.teacherModel : process.env.DISTILL_TEACHER_MODEL ?? "opus"),
        teacherTimeoutMs:
          input.distill.teacherTimeoutMs ??
          (typeof previous.teacherTimeoutMs === "number" ? previous.teacherTimeoutMs : 120000),
        privacyPolicyVersion:
          input.distill.privacyPolicyVersion ??
          (typeof previous.privacyPolicyVersion === "string" ? previous.privacyPolicyVersion : "private-safe-v1"),
        objectiveSplit:
          input.distill.objectiveSplit ??
          (typeof previous.objectiveSplit === "string" ? previous.objectiveSplit : "70-30-coding-general"),
        teacherRateLimit: {
          maxRequestsPerMinute:
            input.distill.teacherRateLimit?.maxRequestsPerMinute ??
            (typeof previous.teacherRateLimit === "object" && previous.teacherRateLimit
              ? (previous.teacherRateLimit as { maxRequestsPerMinute?: number }).maxRequestsPerMinute
              : 6) ??
            6,
          maxConcurrentTeacherJobs:
            input.distill.teacherRateLimit?.maxConcurrentTeacherJobs ??
            (typeof previous.teacherRateLimit === "object" && previous.teacherRateLimit
              ? (previous.teacherRateLimit as { maxConcurrentTeacherJobs?: number }).maxConcurrentTeacherJobs
              : 1) ??
            1,
          dailyTokenBudget:
            input.distill.teacherRateLimit?.dailyTokenBudget ??
            (typeof previous.teacherRateLimit === "object" && previous.teacherRateLimit
              ? (previous.teacherRateLimit as { dailyTokenBudget?: number }).dailyTokenBudget
              : 120000) ??
            120000,
          retryBackoffMs:
            input.distill.teacherRateLimit?.retryBackoffMs ??
            (typeof previous.teacherRateLimit === "object" && previous.teacherRateLimit
              ? (previous.teacherRateLimit as { retryBackoffMs?: number }).retryBackoffMs
              : 2500) ??
            2500,
          maxRetries:
            input.distill.teacherRateLimit?.maxRetries ??
            (typeof previous.teacherRateLimit === "object" && previous.teacherRateLimit
              ? (previous.teacherRateLimit as { maxRetries?: number }).maxRetries
              : 3) ??
            3,
        },
        trainer: {
          backend:
            input.distill.trainer?.backend ??
            (typeof previous.trainer === "object" && previous.trainer
              ? (previous.trainer as { backend?: string }).backend
              : "hf-lora-local") ??
            "hf-lora-local",
          pythonCommand:
            input.distill.trainer?.pythonCommand ??
            (typeof previous.trainer === "object" && previous.trainer
              ? (previous.trainer as { pythonCommand?: string }).pythonCommand
              : "python3") ??
            "python3",
          maxSteps:
            input.distill.trainer?.maxSteps ??
            (typeof previous.trainer === "object" && previous.trainer
              ? (previous.trainer as { maxSteps?: number }).maxSteps
              : 40) ??
            40,
          perDeviceBatchSize:
            input.distill.trainer?.perDeviceBatchSize ??
            (typeof previous.trainer === "object" && previous.trainer
              ? (previous.trainer as { perDeviceBatchSize?: number }).perDeviceBatchSize
              : 1) ??
            1,
          gradientAccumulationSteps:
            input.distill.trainer?.gradientAccumulationSteps ??
            (typeof previous.trainer === "object" && previous.trainer
              ? (previous.trainer as { gradientAccumulationSteps?: number }).gradientAccumulationSteps
              : 8) ??
            8,
          learningRate:
            input.distill.trainer?.learningRate ??
            (typeof previous.trainer === "object" && previous.trainer
              ? (previous.trainer as { learningRate?: number }).learningRate
              : 0.0002) ??
            0.0002,
          loraRank:
            input.distill.trainer?.loraRank ??
            (typeof previous.trainer === "object" && previous.trainer
              ? (previous.trainer as { loraRank?: number }).loraRank
              : 8) ??
            8,
          loraAlpha:
            input.distill.trainer?.loraAlpha ??
            (typeof previous.trainer === "object" && previous.trainer
              ? (previous.trainer as { loraAlpha?: number }).loraAlpha
              : 16) ??
            16,
          maxSeqLength:
            input.distill.trainer?.maxSeqLength ??
            (typeof previous.trainer === "object" && previous.trainer
              ? (previous.trainer as { maxSeqLength?: number }).maxSeqLength
              : 1024) ??
            1024,
          orpoBeta:
            input.distill.trainer?.orpoBeta ??
            (typeof previous.trainer === "object" && previous.trainer
              ? (previous.trainer as { orpoBeta?: number }).orpoBeta
              : 0.1) ??
            0.1,
          toolRewardScale:
            input.distill.trainer?.toolRewardScale ??
            (typeof previous.trainer === "object" && previous.trainer
              ? (previous.trainer as { toolRewardScale?: number }).toolRewardScale
              : 0.6) ??
            0.6,
        },
      };

      await prisma.appSetting.upsert({
        where: { key: "distill_config" },
        update: { value: next },
        create: { key: "distill_config", value: next },
      });
    }

    if (input.experimentalChannels) {
      const current = await channelService.getConfig();
      const next: ExperimentalChannelsConfig = {
        ...current,
        ...input.experimentalChannels,
        senderAllowlist: Array.isArray(input.experimentalChannels.senderAllowlist)
          ? input.experimentalChannels.senderAllowlist.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          : current.senderAllowlist,
        webhook: {
          ...current.webhook,
          ...(input.experimentalChannels.webhook ?? {}),
          signingSecret: mergeSecretInput({
            inputValue: input.experimentalChannels.webhook?.signingSecret,
            clearRequested: (input.experimentalChannels.webhook as { clearSigningSecret?: boolean } | undefined)?.clearSigningSecret,
            previousValue: current.webhook.signingSecret,
          }),
        },
        telegram: {
          ...current.telegram,
          ...(input.experimentalChannels.telegram ?? {}),
          signingSecret: mergeSecretInput({
            inputValue: input.experimentalChannels.telegram?.signingSecret,
            clearRequested: (input.experimentalChannels.telegram as { clearSigningSecret?: boolean } | undefined)?.clearSigningSecret,
            previousValue: current.telegram.signingSecret,
          }),
        },
        ciMonitoring: {
          ...current.ciMonitoring,
          ...(input.experimentalChannels.ciMonitoring ?? {}),
          signingSecret: mergeSecretInput({
            inputValue: input.experimentalChannels.ciMonitoring?.signingSecret,
            clearRequested: (input.experimentalChannels.ciMonitoring as { clearSigningSecret?: boolean } | undefined)?.clearSigningSecret,
            previousValue: current.ciMonitoring.signingSecret,
          }),
        },
      };

      delete (next.webhook as Record<string, unknown>).clearSigningSecret;
      delete (next.telegram as Record<string, unknown>).clearSigningSecret;
      delete (next.ciMonitoring as Record<string, unknown>).clearSigningSecret;

      await prisma.appSetting.upsert({
        where: { key: "experimental_channels_config" },
        update: { value: next },
        create: { key: "experimental_channels_config", value: next },
      });
    }

    await prisma.auditEvent.create({
      data: {
        actor: "user",
        eventType: "settings.updated",
        payload: input,
      },
    });

    return { ok: true };
  });

  app.post("/api/v1/settings/runtime-mode", async (request) => {
    const payload = setRuntimeModeSchema.parse(request.body);
    const chosenModel = payload.openAiModel?.trim() || "gpt-5-nano";

    if (payload.mode === "openai_api") {
      const current = await prisma.appSetting.findUnique({ where: { key: "openai_responses_config" } });
      const previous = (current?.value as Record<string, unknown>) || {};
      const nextOpenAiConfig = {
        baseUrl:
          typeof previous.baseUrl === "string" && previous.baseUrl.trim()
            ? previous.baseUrl
            : process.env.OPENAI_RESPONSES_BASE_URL || "https://api.openai.com/v1",
        model: chosenModel,
        timeoutMs:
          typeof previous.timeoutMs === "number"
            ? previous.timeoutMs
            : Number(process.env.OPENAI_RESPONSES_TIMEOUT_MS || 120000),
        reasoningEffort:
          typeof previous.reasoningEffort === "string" && previous.reasoningEffort.trim()
            ? previous.reasoningEffort
            : (process.env.OPENAI_RESPONSES_REASONING_EFFORT || "medium"),
        dailyBudgetUsd:
          typeof previous.dailyBudgetUsd === "number" ? previous.dailyBudgetUsd : Number(process.env.OPENAI_RESPONSES_DAILY_BUDGET_USD || 25),
        perRunBudgetUsd:
          typeof previous.perRunBudgetUsd === "number" ? previous.perRunBudgetUsd : Number(process.env.OPENAI_RESPONSES_PER_RUN_BUDGET_USD || 5),
        toolPolicy:
          typeof previous.toolPolicy === "object" && previous.toolPolicy
            ? previous.toolPolicy
            : { enableFileSearch: false, enableRemoteMcp: false },
      };

      await prisma.appSetting.upsert({
        where: { key: "openai_responses_config" },
        update: { value: nextOpenAiConfig },
        create: { key: "openai_responses_config", value: nextOpenAiConfig },
      });

      if (payload.openAiApiKey?.trim()) {
        await setStoredSecret(prisma, PROVIDER_SECRET_NAMES.openAiResponsesApiKey, payload.openAiApiKey);
      }

      await prisma.appSetting.upsert({
        where: { key: "model_role_bindings" },
        update: { value: openAiUnifiedRoleBindings(chosenModel) },
        create: { key: "model_role_bindings", value: openAiUnifiedRoleBindings(chosenModel) },
      });

      await prisma.appSetting.upsert({
        where: { key: "active_provider" },
        update: { value: "openai-responses" },
        create: { key: "active_provider", value: "openai-responses" },
      });

      return { ok: true, mode: "openai_api" };
    }

    await prisma.appSetting.upsert({
      where: { key: "model_role_bindings" },
      update: { value: defaultLocalQwenRoleBindings() },
      create: { key: "model_role_bindings", value: defaultLocalQwenRoleBindings() },
    });

    await prisma.appSetting.upsert({
      where: { key: "active_provider" },
      update: { value: "onprem-qwen" },
      create: { key: "active_provider", value: "onprem-qwen" },
    });

    return { ok: true, mode: "local_qwen" };
  });

  app.get("/api/v1/openai/models", async () => {
    const configRow = await prisma.appSetting.findUnique({ where: { key: "openai_responses_config" } });
    const config = (configRow?.value as Record<string, unknown> | null) || {};
    const baseUrl =
      typeof config.baseUrl === "string" && config.baseUrl.trim()
        ? config.baseUrl.replace(/\/+$/, "")
        : (process.env.OPENAI_RESPONSES_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const resolvedApiKey = await resolveSecretValue(
      prisma,
      PROVIDER_SECRET_NAMES.openAiResponsesApiKey,
      process.env.OPENAI_API_KEY || "",
    );
    const apiKey = resolvedApiKey.value.trim();

    if (!apiKey) {
      return {
        items: [] as Array<{ id: string; created: number | null; ownedBy: string | null }>,
        error: "OpenAI API key is not configured",
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${baseUrl}/models`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
      });
      const raw = await response.text();
      if (!response.ok) {
        return { items: [] as Array<{ id: string; created: number | null; ownedBy: string | null }>, error: raw };
      }
      const payload = JSON.parse(raw) as { data?: Array<Record<string, unknown>> };
      const items = Array.isArray(payload.data)
        ? payload.data
            .map((item) => ({
              id: typeof item.id === "string" ? item.id : "",
              created: typeof item.created === "number" ? item.created : null,
              ownedBy: typeof item.owned_by === "string" ? item.owned_by : null,
            }))
            .filter((item) => item.id)
            .sort((a, b) => a.id.localeCompare(b.id))
        : [];
      return { items };
    } finally {
      clearTimeout(timer);
    }
  });
}

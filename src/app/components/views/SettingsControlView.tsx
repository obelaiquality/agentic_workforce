import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activateModelPluginV2,
  activateProviderV2,
  bootstrapQwenAccount,
  createQwenAccount,
  getLatestInferenceBenchmarksV2,
  listOnPremRoleRuntimes,
  getOpenAiBudgetV3,
  getSettings,
  listInferenceBackendsV2,
  listOpenAiModels,
  listModelPluginsV2,
  listProviders,
  listQwenAccountAuthSessions,
  listQwenAccounts,
  policyDecideV2,
  reauthQwenAccount,
  runInferenceAutotuneV2,
  startEnabledOnPremRoleRuntimes,
  startInferenceBackendV2,
  startOnPremRoleRuntime,
  startQwenAccountAuth,
  stopInferenceBackendV2,
  stopOnPremRoleRuntime,
  switchInferenceBackendV2,
  testOnPremRoleRuntime,
  updateQwenAccount,
  updateSettings,
  setRuntimeMode,
} from "../../lib/apiClient";
import { useUiStore } from "../../store/uiStore";
import { Chip, Panel, PanelHeader } from "../UI";

type SettingsTab = "basic" | "accounts" | "advanced" | "labs";
type ModelRoleKey = "utility_fast" | "coder_default" | "review_deep" | "overseer_escalation";
type LocalRuntimeRoleKey = "utility_fast" | "coder_default" | "review_deep";
type ExecutionProfileStageKey = "scope" | "build" | "review" | "escalate";

const ROLE_ORDER: ModelRoleKey[] = ["utility_fast", "coder_default", "review_deep", "overseer_escalation"];
const EXECUTION_PROFILE_STAGE_ORDER: ExecutionProfileStageKey[] = ["scope", "build", "review", "escalate"];
const ROLE_LABELS: Record<ModelRoleKey, string> = {
  utility_fast: "Fast",
  coder_default: "Build",
  review_deep: "Review",
  overseer_escalation: "Escalate",
};

const DEFAULT_EXECUTION_PROFILES = {
  activeProfileId: "balanced",
  profiles: [
    {
      id: "balanced",
      name: "Balanced",
      description: "Fast scoping, standard build, deep review, escalate only when needed.",
      preset: "balanced",
      stages: {
        scope: "utility_fast",
        build: "coder_default",
        review: "review_deep",
        escalate: "overseer_escalation",
      },
      updatedAt: new Date(0).toISOString(),
    },
    {
      id: "deep_scope",
      name: "Deep Scope",
      description: "Use deeper reasoning while scoping before standard implementation.",
      preset: "deep_scope",
      stages: {
        scope: "review_deep",
        build: "coder_default",
        review: "review_deep",
        escalate: "overseer_escalation",
      },
      updatedAt: new Date(0).toISOString(),
    },
    {
      id: "build_heavy",
      name: "Build Heavy",
      description: "Favor deeper reasoning during implementation and review.",
      preset: "build_heavy",
      stages: {
        scope: "utility_fast",
        build: "review_deep",
        review: "review_deep",
        escalate: "overseer_escalation",
      },
      updatedAt: new Date(0).toISOString(),
    },
    {
      id: "custom",
      name: "Custom",
      description: "Editable lifecycle profile for project-specific overrides.",
      preset: "custom",
      stages: {
        scope: "utility_fast",
        build: "coder_default",
        review: "review_deep",
        escalate: "overseer_escalation",
      },
      updatedAt: new Date(0).toISOString(),
    },
  ],
} as const;

const LOCAL_RUNTIME_ROLES: LocalRuntimeRoleKey[] = ["utility_fast", "coder_default", "review_deep"];

function pickFirstAvailable(preferred: string[], available: string[], fallback: string) {
  for (const model of preferred) {
    if (available.includes(model)) return model;
  }
  return fallback;
}

function recommendedOpenAiRoleBindings(
  availableModels: string[],
  fallbackModel: string
): Record<ModelRoleKey, { role: ModelRoleKey; providerId: "openai-responses"; pluginId: null; model: string; temperature: number; maxTokens: number; reasoningMode: "off" | "on" }> {
  const fastModel = pickFirstAvailable(
    ["gpt-5-nano", "gpt-5.1-nano", "gpt-4.1-nano", "gpt-4o-mini"],
    availableModels,
    fallbackModel
  );
  const buildModel = pickFirstAvailable(
    ["gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.1-codex", "gpt-5-codex", "gpt-5.1-codex-mini", "gpt-5-mini"],
    availableModels,
    fastModel
  );
  const reviewModel = pickFirstAvailable(
    ["gpt-5.4", "gpt-5.2", "gpt-5.1", "gpt-5", "gpt-5-mini"],
    availableModels,
    buildModel
  );
  const escalateModel = pickFirstAvailable(
    ["gpt-5.4", "gpt-5.2", "gpt-5.1", "gpt-5", "gpt-5.4-pro", "gpt-5.2-pro", "gpt-5-pro"],
    availableModels,
    reviewModel
  );

  return {
    utility_fast: {
      role: "utility_fast",
      providerId: "openai-responses",
      pluginId: null,
      model: fastModel,
      temperature: 0,
      maxTokens: 900,
      reasoningMode: "off",
    },
    coder_default: {
      role: "coder_default",
      providerId: "openai-responses",
      pluginId: null,
      model: buildModel,
      temperature: 0.1,
      maxTokens: 1800,
      reasoningMode: "off",
    },
    review_deep: {
      role: "review_deep",
      providerId: "openai-responses",
      pluginId: null,
      model: reviewModel,
      temperature: 0.05,
      maxTokens: 2200,
      reasoningMode: "on",
    },
    overseer_escalation: {
      role: "overseer_escalation",
      providerId: "openai-responses",
      pluginId: null,
      model: escalateModel,
      temperature: 0.05,
      maxTokens: 2400,
      reasoningMode: "on",
    },
  };
}

function recommendedHybridRoleBindings(
  availableModels: string[],
  fallbackOpenAiModel: string,
  localPluginId: string,
  localModel: string
): Record<ModelRoleKey, { role: ModelRoleKey; providerId: "onprem-qwen" | "openai-responses"; pluginId: string | null; model: string; temperature: number; maxTokens: number; reasoningMode: "off" | "on" }> {
  const openAiBindings = recommendedOpenAiRoleBindings(availableModels, fallbackOpenAiModel);
  return {
    utility_fast: {
      role: "utility_fast",
      providerId: "onprem-qwen",
      pluginId: localPluginId,
      model: localModel,
      temperature: 0.1,
      maxTokens: 900,
      reasoningMode: "off",
    },
    coder_default: openAiBindings.coder_default,
    review_deep: openAiBindings.review_deep,
    overseer_escalation: openAiBindings.overseer_escalation,
  };
}

function groupOpenAiModels(
  models: Array<{ id: string; created: number | null; ownedBy: string | null }>
) {
  const groups = new Map<string, Array<{ id: string; created: number | null; ownedBy: string | null }>>();

  const classify = (modelId: string) => {
    if (/^gpt-5(?:[.-].*codex.*|.*codex.*)$/i.test(modelId)) return "GPT-5 Codex";
    if (/^gpt-5/i.test(modelId)) return "GPT-5";
    if (/^gpt-4\.1/i.test(modelId)) return "GPT-4.1";
    if (/^gpt-4o/i.test(modelId)) return "GPT-4o";
    if (/^o\d|^o[1-9]|^o3|^o4/i.test(modelId)) return "O-Series";
    return "Other";
  };

  for (const model of models) {
    const label = classify(model.id);
    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label)!.push(model);
  }

  const order = ["GPT-5 Codex", "GPT-5", "GPT-4.1", "GPT-4o", "O-Series", "Other"];
  return order
    .filter((label) => groups.has(label))
    .map((label) => ({
      label,
      items: groups.get(label)!.slice().sort((left, right) => left.id.localeCompare(right.id)),
    }));
}

function suggestSiblingLocalBaseUrl(baseUrl: string, fallbackPort: number) {
  try {
    const parsed = new URL(baseUrl);
    const port = Number(parsed.port || "8000");
    parsed.port = String(Number.isFinite(port) ? port + 1 : fallbackPort);
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return `http://127.0.0.1:${fallbackPort}/v1`;
  }
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="space-y-1 block">
      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
      />
    </label>
  );
}

export function SettingsControlView() {
  const queryClient = useQueryClient();
  const labsMode = useUiStore((state) => state.labsMode);
  const setLabsMode = useUiStore((state) => state.setLabsMode);
  const setActiveSection = useUiStore((state) => state.setActiveSection);
  const settingsFocusTarget = useUiStore((state) => state.settingsFocusTarget);
  const setSettingsFocusTarget = useUiStore((state) => state.setSettingsFocusTarget);
  const [tab, setTab] = useState<SettingsTab>("basic");
  const [newAccountLabel, setNewAccountLabel] = useState("");
  const [newAccountPath, setNewAccountPath] = useState("");
  const [policyPath, setPolicyPath] = useState("");
  const [autotuneProfile, setAutotuneProfile] = useState<"interactive" | "batch" | "tool_heavy">("interactive");
  const providersSectionRef = useRef<HTMLDivElement | null>(null);
  const executionProfilesSectionRef = useRef<HTMLDivElement | null>(null);
  const accountsSectionRef = useRef<HTMLDivElement | null>(null);
  const [highlightSection, setHighlightSection] = useState<"providers" | "execution_profiles" | "accounts" | null>(null);

  const providersQuery = useQuery({ queryKey: ["providers"], queryFn: listProviders });
  const accountsQuery = useQuery({ queryKey: ["qwen-accounts"], queryFn: listQwenAccounts });
  const authSessionsQuery = useQuery({
    queryKey: ["qwen-account-auth-sessions"],
    queryFn: listQwenAccountAuthSessions,
    refetchInterval: 2000,
  });
  const settingsQuery = useQuery({ queryKey: ["app-settings"], queryFn: getSettings });
  const openAiModelsQuery = useQuery({
    queryKey: ["openai-models"],
    queryFn: listOpenAiModels,
    refetchInterval: 300000,
  });
  const onPremPluginsQuery = useQuery({ queryKey: ["onprem-qwen-plugins"], queryFn: listModelPluginsV2 });
  const onPremBackendsQuery = useQuery({ queryKey: ["onprem-qwen-backends"], queryFn: listInferenceBackendsV2 });
  const onPremRoleRuntimeStatusQuery = useQuery({
    queryKey: ["onprem-qwen-role-runtimes"],
    queryFn: listOnPremRoleRuntimes,
    refetchInterval: 5000,
  });
  const latestBenchmarksQuery = useQuery({
    queryKey: ["inference-benchmarks-latest", autotuneProfile],
    queryFn: () => getLatestInferenceBenchmarksV2(autotuneProfile),
    enabled: labsMode || tab === "advanced",
    refetchInterval: 10000,
  });
  const openAiBudgetQuery = useQuery({
    queryKey: ["openai-responses-budget-v3"],
    queryFn: getOpenAiBudgetV3,
    refetchInterval: 10000,
  });

  const setProviderMutation = useMutation({
    mutationFn: (providerId: "qwen-cli" | "openai-compatible" | "onprem-qwen" | "openai-responses") =>
      activateProviderV2(providerId, "user"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["policy-pending-v2"] });
    },
  });

  const createAccountMutation = useMutation({
    mutationFn: createQwenAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qwen-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["qwen-account-auth-sessions"] });
      setNewAccountLabel("");
      setNewAccountPath("");
    },
  });

  const bootstrapAccountMutation = useMutation({
    mutationFn: bootstrapQwenAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qwen-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["qwen-account-auth-sessions"] });
      setNewAccountLabel("");
    },
  });

  const updateAccountMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => updateQwenAccount(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["qwen-accounts"] }),
  });

  const reauthMutation = useMutation({
    mutationFn: reauthQwenAccount,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["qwen-accounts"] }),
  });

  const startAccountAuthMutation = useMutation({
    mutationFn: startQwenAccountAuth,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qwen-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["qwen-account-auth-sessions"] });
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["app-settings"] }),
  });

  const startEnabledRoleRuntimesMutation = useMutation({
    mutationFn: () => startEnabledOnPremRoleRuntimes("user"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onprem-qwen-role-runtimes"] });
    },
  });

  const startRoleRuntimeMutation = useMutation({
    mutationFn: (role: LocalRuntimeRoleKey) => startOnPremRoleRuntime({ actor: "user", role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onprem-qwen-role-runtimes"] });
    },
  });

  const stopRoleRuntimeMutation = useMutation({
    mutationFn: (role: LocalRuntimeRoleKey) => stopOnPremRoleRuntime({ actor: "user", role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onprem-qwen-role-runtimes"] });
    },
  });

  const testRoleRuntimeMutation = useMutation({
    mutationFn: (role: LocalRuntimeRoleKey) => testOnPremRoleRuntime({ actor: "user", role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onprem-qwen-role-runtimes"] });
    },
  });

  const runtimeModeMutation = useMutation({
    mutationFn: setRuntimeMode,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["openai-models"] });
      queryClient.invalidateQueries({ queryKey: ["openai-responses-budget-v3"] });
    },
  });

  const autotuneMutation = useMutation({
    mutationFn: () => runInferenceAutotuneV2({ actor: "user", profile: autotuneProfile }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onprem-qwen-backends"] });
      queryClient.invalidateQueries({ queryKey: ["inference-benchmarks-latest"] });
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
    },
  });

  const backendStartMutation = useMutation({
    mutationFn: (backendId: "mlx-lm" | "sglang" | "vllm-openai" | "trtllm-openai" | "llama-cpp-openai" | "transformers-openai" | "ollama-openai") =>
      startInferenceBackendV2({ actor: "user", backend_id: backendId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["onprem-qwen-backends"] }),
  });

  const backendStopMutation = useMutation({
    mutationFn: (backendId: "mlx-lm" | "sglang" | "vllm-openai" | "trtllm-openai" | "llama-cpp-openai" | "transformers-openai" | "ollama-openai") =>
      stopInferenceBackendV2({ actor: "user", backend_id: backendId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["onprem-qwen-backends"] }),
  });

  const activatePluginMutation = useMutation({
    mutationFn: (pluginId: string) => activateModelPluginV2({ actor: "user", plugin_id: pluginId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onprem-qwen-plugins"] });
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
    },
  });

  const dryRunPolicyMutation = useMutation({
    mutationFn: () =>
      policyDecideV2({
        action_type: "run_command",
        actor: "user",
        risk_level: "high",
        workspace_path: policyPath || "",
        payload: { intent: "dry-run policy simulation" },
        dry_run: true,
      }),
  });

  const safety = useMemo(() => {
    const value = settingsQuery.data?.items.safety;
    if (!value) {
      return {
        requireApprovalForDestructiveOps: true,
        requireApprovalForProviderChanges: true,
        requireApprovalForCodeApply: true,
      };
    }
    return value as Record<string, boolean>;
  }, [settingsQuery.data?.items.safety]);

  const qwenSettings = settingsQuery.data?.items.qwenCli ?? {
    command: "qwen",
    args: ["--auth-type", "qwen-oauth", "--output-format", "text"],
    timeoutMs: 120000,
  };
  const onPremSettings = settingsQuery.data?.items.onPremQwen ?? {
    baseUrl: "http://127.0.0.1:8000/v1",
    apiKey: "",
    inferenceBackendId: "mlx-lm",
    pluginId: "qwen3.5-4b",
    model: "mlx-community/Qwen3.5-4B-4bit",
    reasoningMode: "off",
    timeoutMs: 120000,
    temperature: 0.15,
    maxTokens: 1600,
  };
  const openAiResponsesSettings = settingsQuery.data?.items.openAiResponses ?? {
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-5-nano",
    timeoutMs: 120000,
    reasoningEffort: "medium",
    dailyBudgetUsd: 25,
    perRunBudgetUsd: 5,
    toolPolicy: { enableFileSearch: false, enableRemoteMcp: false },
  };
  const runtimeMode = settingsQuery.data?.items.runtimeMode ?? "local_qwen";
  const openAiModels = useMemo(() => {
    const liveItems = openAiModelsQuery.data?.items ?? [];
    const current = openAiResponsesSettings.model?.trim();
    const merged = current && !liveItems.some((item) => item.id === current)
      ? [{ id: current, created: null, ownedBy: null }, ...liveItems]
      : liveItems;

    return merged
      .slice()
      .sort((left, right) => {
        const leftCreated = left.created ?? 0;
        const rightCreated = right.created ?? 0;
        if (leftCreated !== rightCreated) return rightCreated - leftCreated;
        return left.id.localeCompare(right.id);
      });
  }, [openAiModelsQuery.data?.items, openAiResponsesSettings.model]);
  const openAiModelGroups = useMemo(() => groupOpenAiModels(openAiModels), [openAiModels]);
  const parallelRuntime = settingsQuery.data?.items.parallelRuntime ?? {
    maxLocalLanes: 4,
    maxExpandedLanes: 6,
    defaultLaneLeaseMinutes: 20,
    heartbeatIntervalSeconds: 10,
    staleAfterSeconds: 60,
    reservationTtlSeconds: 14400,
  };
  const distillSettings = settingsQuery.data?.items.distill ?? {
    teacherCommand: "claude",
    teacherModel: "opus",
    teacherTimeoutMs: 120000,
    privacyPolicyVersion: "private-safe-v1",
    objectiveSplit: "70-30-coding-general",
    teacherRateLimit: {
      maxRequestsPerMinute: 6,
      maxConcurrentTeacherJobs: 1,
      dailyTokenBudget: 120000,
      retryBackoffMs: 2500,
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
  const currentRoleBindings = useMemo(() => {
    const raw = (settingsQuery.data?.items.modelRoles ?? {}) as Record<string, Record<string, unknown>>;
    return {
      utility_fast: {
        role: "utility_fast" as const,
        providerId: (raw.utility_fast?.providerId as "onprem-qwen" | "openai-responses" | undefined) ?? "onprem-qwen",
        pluginId: (raw.utility_fast?.pluginId as string | null | undefined) ?? "qwen3.5-0.8b",
        model: (raw.utility_fast?.model as string | undefined) ?? "Qwen/Qwen3.5-0.8B",
        temperature: (raw.utility_fast?.temperature as number | undefined) ?? 0.1,
        maxTokens: (raw.utility_fast?.maxTokens as number | undefined) ?? 900,
        reasoningMode: (raw.utility_fast?.reasoningMode as "off" | "on" | "auto" | undefined) ?? "off",
      },
      coder_default: {
        role: "coder_default" as const,
        providerId: (raw.coder_default?.providerId as "onprem-qwen" | "openai-responses" | undefined) ?? "onprem-qwen",
        pluginId: (raw.coder_default?.pluginId as string | null | undefined) ?? onPremSettings.pluginId,
        model: (raw.coder_default?.model as string | undefined) ?? onPremSettings.model,
        temperature: (raw.coder_default?.temperature as number | undefined) ?? 0.12,
        maxTokens: (raw.coder_default?.maxTokens as number | undefined) ?? 1800,
        reasoningMode: (raw.coder_default?.reasoningMode as "off" | "on" | "auto" | undefined) ?? "off",
      },
      review_deep: {
        role: "review_deep" as const,
        providerId: (raw.review_deep?.providerId as "onprem-qwen" | "openai-responses" | undefined) ?? "onprem-qwen",
        pluginId: (raw.review_deep?.pluginId as string | null | undefined) ?? onPremSettings.pluginId,
        model: (raw.review_deep?.model as string | undefined) ?? onPremSettings.model,
        temperature: (raw.review_deep?.temperature as number | undefined) ?? 0.08,
        maxTokens: (raw.review_deep?.maxTokens as number | undefined) ?? 2200,
        reasoningMode: (raw.review_deep?.reasoningMode as "off" | "on" | "auto" | undefined) ?? "on",
      },
      overseer_escalation: {
        role: "overseer_escalation" as const,
        providerId: (raw.overseer_escalation?.providerId as "onprem-qwen" | "openai-responses" | undefined) ?? "openai-responses",
        pluginId: (raw.overseer_escalation?.pluginId as string | null | undefined) ?? null,
        model: (raw.overseer_escalation?.model as string | undefined) ?? openAiResponsesSettings.model,
        temperature: (raw.overseer_escalation?.temperature as number | undefined) ?? 0.05,
        maxTokens: (raw.overseer_escalation?.maxTokens as number | undefined) ?? 2400,
        reasoningMode: (raw.overseer_escalation?.reasoningMode as "off" | "on" | "auto" | undefined) ?? "on",
      },
    };
  }, [settingsQuery.data?.items.modelRoles, onPremSettings.model, onPremSettings.pluginId, openAiResponsesSettings.model]);
  const onPremRoleRuntimes = useMemo(() => {
    const raw = (settingsQuery.data?.items.onPremQwenRoleRuntimes ?? {}) as Record<string, Record<string, unknown>>;
    return {
      utility_fast: {
        enabled: Boolean(raw.utility_fast?.enabled),
        baseUrl: (raw.utility_fast?.baseUrl as string | undefined) ?? "",
        apiKey: (raw.utility_fast?.apiKey as string | undefined) ?? "",
        inferenceBackendId: (raw.utility_fast?.inferenceBackendId as string | undefined) ?? "",
        pluginId: (raw.utility_fast?.pluginId as string | undefined) ?? "qwen3.5-0.8b",
        model: (raw.utility_fast?.model as string | undefined) ?? "Qwen/Qwen3.5-0.8B",
        reasoningMode: (raw.utility_fast?.reasoningMode as "off" | "on" | "auto" | undefined) ?? "off",
        timeoutMs: (raw.utility_fast?.timeoutMs as number | undefined) ?? 120000,
        temperature: (raw.utility_fast?.temperature as number | undefined) ?? 0.1,
        maxTokens: (raw.utility_fast?.maxTokens as number | undefined) ?? 900,
      },
      coder_default: {
        enabled: Boolean(raw.coder_default?.enabled),
        baseUrl: (raw.coder_default?.baseUrl as string | undefined) ?? "",
        apiKey: (raw.coder_default?.apiKey as string | undefined) ?? "",
        inferenceBackendId: (raw.coder_default?.inferenceBackendId as string | undefined) ?? "",
        pluginId: (raw.coder_default?.pluginId as string | undefined) ?? onPremSettings.pluginId,
        model: (raw.coder_default?.model as string | undefined) ?? onPremSettings.model,
        reasoningMode: (raw.coder_default?.reasoningMode as "off" | "on" | "auto" | undefined) ?? "off",
        timeoutMs: (raw.coder_default?.timeoutMs as number | undefined) ?? onPremSettings.timeoutMs,
        temperature: (raw.coder_default?.temperature as number | undefined) ?? 0.12,
        maxTokens: (raw.coder_default?.maxTokens as number | undefined) ?? 1800,
      },
      review_deep: {
        enabled: Boolean(raw.review_deep?.enabled),
        baseUrl: (raw.review_deep?.baseUrl as string | undefined) ?? "",
        apiKey: (raw.review_deep?.apiKey as string | undefined) ?? "",
        inferenceBackendId: (raw.review_deep?.inferenceBackendId as string | undefined) ?? "",
        pluginId: (raw.review_deep?.pluginId as string | undefined) ?? onPremSettings.pluginId,
        model: (raw.review_deep?.model as string | undefined) ?? onPremSettings.model,
        reasoningMode: (raw.review_deep?.reasoningMode as "off" | "on" | "auto" | undefined) ?? "on",
        timeoutMs: (raw.review_deep?.timeoutMs as number | undefined) ?? onPremSettings.timeoutMs,
        temperature: (raw.review_deep?.temperature as number | undefined) ?? 0.08,
        maxTokens: (raw.review_deep?.maxTokens as number | undefined) ?? 2200,
      },
    };
  }, [
    settingsQuery.data?.items.onPremQwenRoleRuntimes,
    onPremSettings.model,
    onPremSettings.pluginId,
    onPremSettings.timeoutMs,
  ]);
  const onPremRoleRuntimeStatuses = useMemo(
    () => new Map((onPremRoleRuntimeStatusQuery.data?.items ?? []).map((item) => [item.role, item])),
    [onPremRoleRuntimeStatusQuery.data?.items]
  );

  const onPremPluginOptions = useMemo(
    () =>
      (onPremPluginsQuery.data?.items ?? []).map((plugin) => ({
        id: plugin.id,
        model: plugin.runtimeModel,
        label: plugin.label,
      })),
    [onPremPluginsQuery.data?.items]
  );

  const selectedOnPremPlugin = (onPremPluginsQuery.data?.items ?? []).find((plugin) => plugin.id === onPremSettings.pluginId);
  const selectedInferenceBackend = (onPremBackendsQuery.data?.items ?? []).find((backend) => backend.id === onPremSettings.inferenceBackendId);
  const executionProfiles = settingsQuery.data?.items.executionProfiles ?? DEFAULT_EXECUTION_PROFILES;
  const activeExecutionProfile =
    executionProfiles.profiles.find((profile) => profile.id === executionProfiles.activeProfileId) ??
    executionProfiles.profiles[0];
  const startupCommand = (selectedInferenceBackend?.startupCommandTemplate ?? "")
    .replaceAll("{{model}}", onPremSettings.model || selectedOnPremPlugin?.runtimeModel || "mlx-community/Qwen3.5-4B-4bit");
  const authSessionMap = useMemo(
    () => new Map((authSessionsQuery.data?.items ?? []).map((item) => [item.accountId, item])),
    [authSessionsQuery.data?.items]
  );
  const applyModelRoles = (nextBindings: Record<ModelRoleKey, Record<string, unknown>>) => {
    updateSettingsMutation.mutate({ modelRoles: nextBindings });
  };
  const applyExecutionProfiles = (nextProfiles: typeof executionProfiles) => {
    updateSettingsMutation.mutate({ executionProfiles: nextProfiles });
  };
  const applyOnPremRoleRuntimes = (nextRuntimes: Record<LocalRuntimeRoleKey, Record<string, unknown>>) => {
    updateSettingsMutation.mutate({ onPremQwenRoleRuntimes: nextRuntimes });
  };
  const updateRoleBinding = (role: ModelRoleKey, patch: Record<string, unknown>) => {
    applyModelRoles({
      ...currentRoleBindings,
      [role]: {
        ...currentRoleBindings[role],
        ...patch,
        role,
      },
    });
  };
  const updateOnPremRoleRuntime = (role: LocalRuntimeRoleKey, patch: Record<string, unknown>) => {
    applyOnPremRoleRuntimes({
      ...onPremRoleRuntimes,
      [role]: {
        ...onPremRoleRuntimes[role],
        ...patch,
      },
    });
  };
  const setActiveExecutionProfile = (profileId: string) => {
    applyExecutionProfiles({
      ...executionProfiles,
      activeProfileId: profileId,
    });
  };
  const updateExecutionProfileStage = (profileId: string, stage: ExecutionProfileStageKey, role: ModelRoleKey) => {
    applyExecutionProfiles({
      ...executionProfiles,
      profiles: executionProfiles.profiles.map((profile) =>
        profile.id === profileId
          ? {
              ...profile,
              stages: {
                ...profile.stages,
                [stage]: role,
              },
              updatedAt: new Date().toISOString(),
            }
          : profile
      ),
    });
  };
  const applyRecommendedOpenAiRoles = () => {
    setProviderMutation.mutate("openai-responses");
    applyModelRoles(
      recommendedOpenAiRoleBindings(
        openAiModels.map((item) => item.id),
        openAiResponsesSettings.model || "gpt-5-nano"
      )
    );
  };
  const applyRecommendedHybridRoles = () => {
    setProviderMutation.mutate("onprem-qwen");
    applyModelRoles(
      recommendedHybridRoleBindings(
        openAiModels.map((item) => item.id),
        openAiResponsesSettings.model || "gpt-5-nano",
        onPremSettings.pluginId,
        onPremSettings.model
      )
    );
  };
  const applyRecommendedLocalSplit = () => {
    const utilityPlugin = onPremPluginOptions.find((plugin) => plugin.id === "qwen3.5-0.8b");
    const utilityModel = utilityPlugin?.model ?? "Qwen/Qwen3.5-0.8B";
    const utilityBaseUrl = suggestSiblingLocalBaseUrl(onPremSettings.baseUrl, 8001);

    setProviderMutation.mutate("onprem-qwen");
    runtimeModeMutation.mutate("local_qwen");
    applyModelRoles({
      ...currentRoleBindings,
      utility_fast: {
        ...currentRoleBindings.utility_fast,
        role: "utility_fast",
        providerId: "onprem-qwen",
        pluginId: utilityPlugin?.id ?? "qwen3.5-0.8b",
        model: utilityModel,
        reasoningMode: "off",
        maxTokens: 900,
      },
      coder_default: {
        ...currentRoleBindings.coder_default,
        role: "coder_default",
        providerId: "onprem-qwen",
        pluginId: onPremSettings.pluginId,
        model: onPremSettings.model,
        reasoningMode: "off",
      },
      review_deep: {
        ...currentRoleBindings.review_deep,
        role: "review_deep",
        providerId: "onprem-qwen",
        pluginId: onPremSettings.pluginId,
        model: onPremSettings.model,
        reasoningMode: "on",
      },
    });
    applyOnPremRoleRuntimes({
      utility_fast: {
        enabled: true,
        baseUrl: utilityBaseUrl,
        apiKey: "",
        inferenceBackendId: onPremSettings.inferenceBackendId,
        pluginId: utilityPlugin?.id ?? "qwen3.5-0.8b",
        model: utilityModel,
        reasoningMode: "off",
        timeoutMs: 120000,
        temperature: 0.1,
        maxTokens: 900,
      },
      coder_default: {
        enabled: false,
        baseUrl: onPremSettings.baseUrl,
        apiKey: onPremSettings.apiKey,
        inferenceBackendId: onPremSettings.inferenceBackendId,
        pluginId: onPremSettings.pluginId,
        model: onPremSettings.model,
        reasoningMode: "off",
        timeoutMs: onPremSettings.timeoutMs,
        temperature: 0.12,
        maxTokens: 1800,
      },
      review_deep: {
        enabled: false,
        baseUrl: onPremSettings.baseUrl,
        apiKey: onPremSettings.apiKey,
        inferenceBackendId: onPremSettings.inferenceBackendId,
        pluginId: onPremSettings.pluginId,
        model: onPremSettings.model,
        reasoningMode: "on",
        timeoutMs: onPremSettings.timeoutMs,
        temperature: 0.08,
        maxTokens: 2200,
      },
    });
  };

  useEffect(() => {
    if (!settingsFocusTarget) return;
    const focusMap = {
      providers: { tab: "basic" as SettingsTab, ref: providersSectionRef },
      execution_profiles: { tab: "basic" as SettingsTab, ref: executionProfilesSectionRef },
      accounts: { tab: "accounts" as SettingsTab, ref: accountsSectionRef },
    };
    const target = focusMap[settingsFocusTarget];
    setTab(target.tab);
    requestAnimationFrame(() => {
      target.ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setHighlightSection(settingsFocusTarget);
      window.setTimeout(() => {
        setHighlightSection((current) => (current === settingsFocusTarget ? null : current));
      }, 1800);
      setSettingsFocusTarget(null);
    });
  }, [setSettingsFocusTarget, settingsFocusTarget]);

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Settings">
          <div className="flex items-center gap-2">
            <Chip variant="subtle">{providersQuery.data?.activeProvider ?? "loading"}</Chip>
            {labsMode ? <Chip variant="warn">labs on</Chip> : null}
          </div>
        </PanelHeader>
        <div className="p-4 flex flex-wrap gap-2">
          {(["basic", "accounts", "advanced"] as SettingsTab[]).map((item) => (
            <button
              key={item}
              onClick={() => setTab(item)}
              className={`rounded-full px-3 py-1.5 text-xs ${tab === item ? "bg-cyan-500/15 border border-cyan-400/30 text-cyan-100" : "border border-white/10 bg-white/[0.03] text-zinc-400"}`}
            >
              {item}
            </button>
          ))}
          {labsMode ? (
            <button
              onClick={() => setTab("labs")}
              className={`rounded-full px-3 py-1.5 text-xs ${tab === "labs" ? "bg-amber-500/15 border border-amber-400/30 text-amber-100" : "border border-white/10 bg-white/[0.03] text-zinc-400"}`}
            >
              Labs
            </button>
          ) : null}
          <div className="ml-auto flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
            <span className="text-xs text-zinc-400">Show Labs</span>
            <input type="checkbox" checked={labsMode} onChange={(event) => setLabsMode(event.target.checked)} />
          </div>
        </div>
      </Panel>

      {tab === "basic" ? (
        <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1fr] gap-4">
          <div
            ref={providersSectionRef}
            className={
              highlightSection === "providers"
                ? "rounded-2xl ring-1 ring-cyan-400/35 shadow-[0_0_0_1px_rgba(34,211,238,0.08),0_0_24px_rgba(34,211,238,0.08)] transition-all"
                : "transition-all"
            }
          >
          <Panel>
            <PanelHeader title="Providers" />
            <div className="p-4 space-y-4">
              <div className="flex flex-wrap gap-2">
                {providersQuery.data?.providers.map((provider) => (
                  <button
                    key={provider.id}
                    onClick={() => setProviderMutation.mutate(provider.id)}
                    className={`px-3 py-2 rounded-lg border text-xs ${
                      providersQuery.data?.activeProvider === provider.id
                        ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-100"
                        : "bg-zinc-900/40 border-white/10 text-zinc-400"
                    }`}
                  >
                    {provider.label}
                  </button>
                ))}
              </div>

              <div
                ref={executionProfilesSectionRef}
                className={
                  highlightSection === "execution_profiles"
                    ? "rounded-xl border border-cyan-400/35 bg-white/[0.02] p-4 space-y-3 shadow-[0_0_0_1px_rgba(34,211,238,0.08),0_0_24px_rgba(34,211,238,0.08)] transition-all"
                    : "rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3 transition-all"
                }
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm text-white font-medium">Runtime mode</div>
                    <div className="text-xs text-zinc-500 mt-1">
                      Run the whole app on local Qwen or switch every role to OpenAI with one setting.
                    </div>
                  </div>
                  <Chip variant={runtimeMode === "openai_api" ? "ok" : "subtle"}>
                    {runtimeMode === "openai_api" ? "OpenAI API active" : "Local Qwen active"}
                  </Chip>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-3">
                  <LabeledInput
                    label="OpenAI API key"
                    type="password"
                    value={openAiResponsesSettings.apiKey}
                    onChange={(value) =>
                      updateSettingsMutation.mutate({
                        openAiResponses: {
                          ...openAiResponsesSettings,
                          apiKey: value,
                        },
                      })
                    }
                  />
                  <label className="space-y-1 block">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">OpenAI model</div>
                    <select
                      value={openAiResponsesSettings.model}
                      onChange={(event) =>
                        updateSettingsMutation.mutate({
                          openAiResponses: {
                            ...openAiResponsesSettings,
                            model: event.target.value,
                          },
                        })
                      }
                      className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                    >
                      {openAiModels.length === 0 ? <option value={openAiResponsesSettings.model}>{openAiResponsesSettings.model}</option> : null}
                      {openAiModelGroups.map((group) => (
                        <optgroup key={group.label} label={group.label}>
                          {group.items.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.id}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() =>
                      runtimeModeMutation.mutate({
                        mode: "openai_api",
                        openAiApiKey: openAiResponsesSettings.apiKey,
                        openAiModel: openAiResponsesSettings.model,
                      })
                    }
                    className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white"
                  >
                    Use OpenAI For All Roles
                  </button>
                  <button
                    onClick={() => runtimeModeMutation.mutate({ mode: "local_qwen" })}
                    className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-zinc-300"
                  >
                    Restore Local Qwen
                  </button>
                  <button
                    onClick={applyRecommendedOpenAiRoles}
                    className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 px-4 py-2 text-sm text-fuchsia-100"
                  >
                    Apply Recommended OpenAI Roles
                  </button>
                  <button
                    onClick={applyRecommendedHybridRoles}
                    className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100"
                  >
                    Apply Hybrid Recommended
                  </button>
                  <button
                    onClick={() => queryClient.invalidateQueries({ queryKey: ["openai-models"] })}
                    className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-zinc-300"
                  >
                    Refresh OpenAI Models
                  </button>
                </div>
                <div className="text-xs text-zinc-500">
                  Models are fetched live from your account’s OpenAI `/v1/models` list. Default quick preset is <code>gpt-5-nano</code>.
                  {openAiModelsQuery.data?.error ? ` ${openAiModelsQuery.data.error}` : ""}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm text-white font-medium">Execution Profiles</div>
                    <div className="text-xs text-zinc-500 mt-1">
                      Profiles map the ticket lifecycle to responsibility roles. Role routing below still decides which provider and model each role uses.
                    </div>
                  </div>
                  <Chip variant="subtle">{activeExecutionProfile?.name ?? "Balanced"}</Chip>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {executionProfiles.profiles.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => setActiveExecutionProfile(profile.id)}
                      className={`rounded-xl border p-3 text-left transition ${
                        executionProfiles.activeProfileId === profile.id
                          ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-100"
                          : "border-white/10 bg-black/20 text-zinc-300 hover:bg-white/[0.03]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium text-white">{profile.name}</div>
                        <Chip variant={executionProfiles.activeProfileId === profile.id ? "ok" : "subtle"} className="text-[10px]">
                          {profile.preset}
                        </Chip>
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">{profile.description}</div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {EXECUTION_PROFILE_STAGE_ORDER.map((stage) => (
                          <Chip key={`${profile.id}-${stage}`} variant="subtle" className="text-[9px]">
                            {stage}: {ROLE_LABELS[profile.stages[stage]]}
                          </Chip>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">Custom lifecycle mapping</div>
                      <div className="text-xs text-zinc-500 mt-1">
                        Edit the `Custom` profile, then choose it in the command center or make it the active global default here.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveExecutionProfile("custom")}
                      className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/[0.08]"
                    >
                      Use Custom
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {EXECUTION_PROFILE_STAGE_ORDER.map((stage) => (
                      <label key={stage} className="space-y-1 block">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{stage}</div>
                        <select
                          value={executionProfiles.profiles.find((profile) => profile.id === "custom")?.stages[stage] ?? DEFAULT_EXECUTION_PROFILES.profiles[3].stages[stage]}
                          onChange={(event) => updateExecutionProfileStage("custom", stage, event.target.value as ModelRoleKey)}
                          className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                        >
                          {ROLE_ORDER.map((role) => (
                            <option key={`${stage}-${role}`} value={role}>
                              {ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm text-white font-medium">Role routing</div>
                    <div className="text-xs text-zinc-500 mt-1">
                      Configure which provider and model each responsibility role should use. Recommended OpenAI setup uses a Codex-family model for `Build` when available. Hybrid recommended keeps `Fast` on local Qwen and uses OpenAI for `Build`, `Review`, and `Escalate`.
                    </div>
                  </div>
                  <Chip variant="subtle">hybrid capable</Chip>
                </div>
                <div className="space-y-3">
                  {ROLE_ORDER.map((role) => {
                    const binding = currentRoleBindings[role];
                    const provider = binding.providerId === "openai-responses" ? "openai-responses" : "onprem-qwen";
                    const selectedPlugin = onPremPluginOptions.find((plugin) => plugin.id === binding.pluginId) ?? onPremPluginOptions[0];
                    const openAiRecommendation = recommendedOpenAiRoleBindings(
                      openAiModels.map((item) => item.id),
                      openAiResponsesSettings.model || "gpt-5-nano"
                    )[role].model;

                    return (
                      <div key={role} className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-white">{ROLE_LABELS[role]}</div>
                            <div className="text-xs text-zinc-500">{role}</div>
                          </div>
                          {provider === "openai-responses" ? <Chip variant="ok">OpenAI API</Chip> : <Chip variant="subtle">Local Qwen</Chip>}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-[150px_1fr_110px] gap-3">
                          <label className="space-y-1 block">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Provider</div>
                            <select
                              value={provider}
                              onChange={(event) => {
                                const nextProvider = event.target.value as "onprem-qwen" | "openai-responses";
                                if (nextProvider === "openai-responses") {
                                  updateRoleBinding(role, {
                                    providerId: "openai-responses",
                                    pluginId: null,
                                    model:
                                      role === "coder_default"
                                        ? openAiRecommendation
                                        : openAiResponsesSettings.model || openAiRecommendation,
                                  });
                                } else {
                                  updateRoleBinding(role, {
                                    providerId: "onprem-qwen",
                                    pluginId: selectedPlugin?.id ?? onPremSettings.pluginId,
                                    model: selectedPlugin?.model ?? onPremSettings.model,
                                  });
                                }
                              }}
                              className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                            >
                              <option value="onprem-qwen">Local Qwen</option>
                              <option value="openai-responses">OpenAI API</option>
                            </select>
                          </label>
                          <label className="space-y-1 block">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Model</div>
                            {provider === "openai-responses" ? (
                              <select
                                value={binding.model}
                                onChange={(event) => updateRoleBinding(role, { providerId: "openai-responses", pluginId: null, model: event.target.value })}
                                className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                              >
                                {openAiModels.length === 0 ? <option value={binding.model}>{binding.model}</option> : null}
                                {openAiModelGroups.map((group) => (
                                  <optgroup key={group.label} label={group.label}>
                                    {group.items.map((model) => (
                                      <option key={model.id} value={model.id}>
                                        {model.id}
                                      </option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                            ) : (
                              <select
                                value={binding.pluginId ?? selectedPlugin?.id ?? ""}
                                onChange={(event) => {
                                  const nextPlugin = onPremPluginOptions.find((plugin) => plugin.id === event.target.value);
                                  if (!nextPlugin) return;
                                  updateRoleBinding(role, {
                                    providerId: "onprem-qwen",
                                    pluginId: nextPlugin.id,
                                    model: nextPlugin.model,
                                  });
                                }}
                                className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                              >
                                {onPremPluginOptions.map((plugin) => (
                                  <option key={plugin.id} value={plugin.id}>
                                    {plugin.label}
                                  </option>
                                ))}
                              </select>
                            )}
                          </label>
                          <label className="space-y-1 block">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Thinking</div>
                            <select
                              value={binding.reasoningMode ?? "off"}
                              onChange={(event) => updateRoleBinding(role, { reasoningMode: event.target.value as "off" | "on" | "auto" })}
                              className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                            >
                              <option value="off">off</option>
                              <option value="on">on</option>
                              <option value="auto">auto</option>
                            </select>
                          </label>
                        </div>
                        <div className="flex flex-wrap gap-2 text-[11px] text-zinc-500">
                          <span>Temp {binding.temperature}</span>
                          <span>·</span>
                          <span>Max {binding.maxTokens} tokens</span>
                          {provider === "openai-responses" && role === "coder_default" ? (
                            <>
                              <span>·</span>
                              <span>Recommended build model: {openAiRecommendation}</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                <div className="text-sm text-white font-medium">Default local model</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <LabeledInput label="Base URL" value={onPremSettings.baseUrl} onChange={(value) => updateSettingsMutation.mutate({ onPremQwen: { ...onPremSettings, baseUrl: value } })} />
                  <LabeledInput label="Model" value={onPremSettings.model} onChange={(value) => updateSettingsMutation.mutate({ onPremQwen: { ...onPremSettings, model: value } })} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label className="space-y-1 block">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Plugin</div>
                    <select
                      value={onPremSettings.pluginId}
                      onChange={(event) => activatePluginMutation.mutate(event.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                    >
                      {(onPremPluginsQuery.data?.items ?? []).map((plugin) => (
                        <option key={plugin.id} value={plugin.id}>{plugin.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 block">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Thinking</div>
                    <select
                      value={onPremSettings.reasoningMode}
                      onChange={(event) => updateSettingsMutation.mutate({ onPremQwen: { ...onPremSettings, reasoningMode: event.target.value as "off" | "on" | "auto" } })}
                      className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                    >
                      <option value="off">off</option>
                      <option value="on">on</option>
                      <option value="auto">auto</option>
                    </select>
                  </label>
                  <LabeledInput label="Max tokens" value={String(onPremSettings.maxTokens)} onChange={(value) => updateSettingsMutation.mutate({ onPremQwen: { ...onPremSettings, maxTokens: Number(value) || 0 } })} />
                </div>
                <div className="text-xs text-zinc-500">Use `off` for fast default coding, `on` for deeper review paths, and `auto` when role routing should decide.</div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm text-white font-medium">Local role runtimes</div>
                    <div className="text-xs text-zinc-500 mt-1">
                      Optional dedicated local endpoints per role. Use this when you want `Fast` on a smaller local model and `Build` on a larger one at the same time.
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Chip variant="subtle">optional</Chip>
                    <button
                      onClick={applyRecommendedLocalSplit}
                      className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1.5 text-xs text-fuchsia-100"
                    >
                      Apply recommended local split
                    </button>
                    <button
                      onClick={() => startEnabledRoleRuntimesMutation.mutate()}
                      className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-100"
                    >
                      Start enabled runtimes
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  {LOCAL_RUNTIME_ROLES.map((role) => {
                    const runtime = onPremRoleRuntimes[role];
                    const status = onPremRoleRuntimeStatuses.get(role);
                    const selectedPlugin =
                      onPremPluginOptions.find((plugin) => plugin.id === runtime.pluginId) ?? onPremPluginOptions[0];
                    const statusVariant = status?.healthy
                      ? "ok"
                      : status?.running
                        ? "warn"
                        : "subtle";
                    const statusLabel = status?.healthy
                      ? "healthy"
                      : status?.running
                        ? "running"
                        : runtime.enabled
                          ? "stopped"
                          : "disabled";
                    const issues: string[] = [];
                    if (runtime.enabled && !runtime.baseUrl.trim()) issues.push("missing base URL");
                    if (runtime.enabled && !runtime.model.trim()) issues.push("missing model");
                    const backendLabel =
                      (onPremBackendsQuery.data?.items ?? []).find((backend) => backend.id === runtime.inferenceBackendId)?.label ??
                      "plugin/default";

                    return (
                      <div key={role} className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-medium text-white">{ROLE_LABELS[role]}</div>
                              <Chip variant={statusVariant}>{statusLabel}</Chip>
                              {status?.pid ? <Chip variant="subtle">pid {status.pid}</Chip> : null}
                            </div>
                            <div className="text-xs text-zinc-500 mt-1">
                              {runtime.enabled
                                ? "Uses its own local runtime endpoint"
                                : "Falls back to the default local runtime above"}
                            </div>
                          </div>
                          <label className="flex items-center gap-2 text-xs text-zinc-300">
                            <span>Dedicated runtime</span>
                            <input
                              type="checkbox"
                              checked={runtime.enabled}
                              onChange={(event) =>
                                updateOnPremRoleRuntime(role, {
                                  enabled: event.target.checked,
                                })
                              }
                            />
                          </label>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                          <div className="rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-2">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Endpoint</div>
                            <div className="mt-1 text-xs text-zinc-200 break-all">{runtime.baseUrl || "not set"}</div>
                          </div>
                          <div className="rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-2">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Backend</div>
                            <div className="mt-1 text-xs text-zinc-200">{backendLabel}</div>
                          </div>
                          <div className="rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-2">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Model</div>
                            <div className="mt-1 text-xs text-zinc-200 break-all">{runtime.model || "not set"}</div>
                          </div>
                          <div className="rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-2">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Diagnostics</div>
                            <div className="mt-1 text-xs text-zinc-200">
                              {issues.length > 0 ? issues.join(" · ") : status?.message ?? "Ready to test or start"}
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr_1fr_110px] gap-3">
                          <LabeledInput
                            label="Base URL"
                            value={runtime.baseUrl}
                            onChange={(value) => updateOnPremRoleRuntime(role, { baseUrl: value })}
                            placeholder={role === "utility_fast" ? "http://127.0.0.1:8001/v1" : "http://127.0.0.1:8000/v1"}
                          />
                          <label className="space-y-1 block">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Backend</div>
                            <select
                              value={runtime.inferenceBackendId}
                              onChange={(event) =>
                                updateOnPremRoleRuntime(role, {
                                  inferenceBackendId: event.target.value,
                                })
                              }
                              className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                            >
                              <option value="">plugin/default</option>
                              {(onPremBackendsQuery.data?.items ?? []).map((backend) => (
                                <option key={backend.id} value={backend.id}>
                                  {backend.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="space-y-1 block">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Plugin</div>
                            <select
                              value={runtime.pluginId}
                              onChange={(event) => {
                                const nextPlugin = onPremPluginOptions.find((plugin) => plugin.id === event.target.value);
                                if (!nextPlugin) return;
                                updateOnPremRoleRuntime(role, {
                                  pluginId: nextPlugin.id,
                                  model: nextPlugin.model,
                                });
                              }}
                              className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                            >
                              {onPremPluginOptions.map((plugin) => (
                                <option key={plugin.id} value={plugin.id}>
                                  {plugin.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="space-y-1 block">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Thinking</div>
                            <select
                              value={runtime.reasoningMode}
                              onChange={(event) =>
                                updateOnPremRoleRuntime(role, {
                                  reasoningMode: event.target.value as "off" | "on" | "auto",
                                })
                              }
                              className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                            >
                              <option value="off">off</option>
                              <option value="on">on</option>
                              <option value="auto">auto</option>
                            </select>
                          </label>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <LabeledInput
                            label="Model"
                            value={runtime.model}
                            onChange={(value) => updateOnPremRoleRuntime(role, { model: value })}
                          />
                          <LabeledInput
                            label="Timeout ms"
                            value={String(runtime.timeoutMs)}
                            onChange={(value) => updateOnPremRoleRuntime(role, { timeoutMs: Number(value) || 0 })}
                          />
                          <LabeledInput
                            label="Max tokens"
                            value={String(runtime.maxTokens)}
                            onChange={(value) => updateOnPremRoleRuntime(role, { maxTokens: Number(value) || 0 })}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => testRoleRuntimeMutation.mutate(role)}
                            disabled={!runtime.enabled}
                            className="rounded-lg border border-white/10 bg-zinc-900/50 px-3 py-1.5 text-xs text-zinc-200 disabled:opacity-40"
                          >
                            {testRoleRuntimeMutation.isPending && testRoleRuntimeMutation.variables === role ? "Testing..." : "Test"}
                          </button>
                          <button
                            onClick={() => startRoleRuntimeMutation.mutate(role)}
                            disabled={!runtime.enabled}
                            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-100 disabled:opacity-40"
                          >
                            {startRoleRuntimeMutation.isPending && startRoleRuntimeMutation.variables === role ? "Starting..." : "Start"}
                          </button>
                          <button
                            onClick={() => stopRoleRuntimeMutation.mutate(role)}
                            disabled={!runtime.enabled}
                            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-100 disabled:opacity-40"
                          >
                            {stopRoleRuntimeMutation.isPending && stopRoleRuntimeMutation.variables === role ? "Stopping..." : "Stop"}
                          </button>
                          <div className="text-xs text-zinc-500">
                            {status?.message ?? "Configure a dedicated endpoint, then test or start it."}
                          </div>
                        </div>
                        <div className="text-xs text-zinc-500">
                          Current plugin: {selectedPlugin?.label ?? runtime.pluginId}. Configure a second local server and point this role at it to get a true simultaneous multi-model setup.
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Panel>

          <div className="space-y-4">
            <Panel>
              <PanelHeader title="Approvals" />
              <div className="p-4 grid grid-cols-1 gap-2">
                {Object.entries(safety).map(([key, value]) => (
                  <label key={key} className="rounded-lg border border-white/10 bg-zinc-900/40 p-3 flex items-center justify-between gap-2">
                    <span className="text-xs text-zinc-300">{key}</span>
                    <input
                      type="checkbox"
                      checked={Boolean(value)}
                      onChange={(event) => {
                        updateSettingsMutation.mutate({
                          safety: {
                            ...safety,
                            [key]: event.target.checked,
                          },
                        });
                      }}
                    />
                  </label>
                ))}
              </div>
            </Panel>
          </div>

            <Panel>
              <PanelHeader title="OpenAI API" />
              <div className="p-4 space-y-3">
                <div className="text-xs text-zinc-500">
                  Used for escalation by default, or as the full runtime when you switch `Runtime mode` above. Daily remaining budget: $
                  {(openAiBudgetQuery.data?.item.remainingUsd ?? openAiResponsesSettings.dailyBudgetUsd).toFixed(2)}
                </div>
                <label className="space-y-1 block">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Model</div>
                  <select
                    value={openAiResponsesSettings.model}
                    onChange={(event) =>
                      updateSettingsMutation.mutate({
                        openAiResponses: {
                          ...openAiResponsesSettings,
                          model: event.target.value,
                        },
                      })
                    }
                    className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                  >
                    {openAiModels.length === 0 ? <option value={openAiResponsesSettings.model}>{openAiResponsesSettings.model}</option> : null}
                    {openAiModelGroups.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.items.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.id}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <LabeledInput label="API key" type="password" value={openAiResponsesSettings.apiKey} onChange={(value) => updateSettingsMutation.mutate({ openAiResponses: { ...openAiResponsesSettings, apiKey: value } })} />
                <div className="grid grid-cols-2 gap-3">
                  <LabeledInput label="Daily budget" value={String(openAiResponsesSettings.dailyBudgetUsd)} onChange={(value) => updateSettingsMutation.mutate({ openAiResponses: { ...openAiResponsesSettings, dailyBudgetUsd: Number(value) || 0 } })} />
                  <LabeledInput label="Per-run budget" value={String(openAiResponsesSettings.perRunBudgetUsd)} onChange={(value) => updateSettingsMutation.mutate({ openAiResponses: { ...openAiResponsesSettings, perRunBudgetUsd: Number(value) || 0 } })} />
                </div>
              </div>
            </Panel>
          </div>
        </div>
      ) : null}

      {tab === "accounts" ? (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_minmax(0,1.2fr)] gap-4">
          <div
            ref={accountsSectionRef}
            className={
              highlightSection === "accounts"
                ? "rounded-2xl ring-1 ring-cyan-400/35 shadow-[0_0_0_1px_rgba(34,211,238,0.08),0_0_24px_rgba(34,211,238,0.08)] transition-all"
                : "transition-all"
            }
          >
          <Panel>
            <PanelHeader title="Add Qwen account">
              <Chip variant="subtle">optional provider path</Chip>
            </PanelHeader>
            <div className="p-4 space-y-3">
              <LabeledInput label="Account label" value={newAccountLabel} onChange={setNewAccountLabel} placeholder="Google Main" />
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => newAccountLabel.trim() && bootstrapAccountMutation.mutate({ label: newAccountLabel.trim() })}
                  className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white"
                >
                  Create + Auth
                </button>
                <button
                  onClick={() => newAccountLabel.trim() && bootstrapAccountMutation.mutate({ label: newAccountLabel.trim(), importCurrentAuth: true })}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-zinc-300"
                >
                  Import Current
                </button>
              </div>
              <div className="rounded-xl border border-white/10 bg-zinc-950/60 p-4 space-y-2">
                <div className="text-sm text-white font-medium">Add existing profile path</div>
                <LabeledInput label="Label" value={newAccountLabel} onChange={setNewAccountLabel} />
                <LabeledInput label="Profile path" value={newAccountPath} onChange={setNewAccountPath} placeholder="/path/to/isolated/home" />
                <button
                  onClick={() => newAccountLabel.trim() && newAccountPath.trim() && createAccountMutation.mutate({ label: newAccountLabel.trim(), profilePath: newAccountPath.trim() })}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-zinc-300"
                >
                  Add Existing
                </button>
              </div>
            </div>
          </Panel>
          </div>

          <Panel>
            <PanelHeader title="Qwen account profiles">
              <Chip variant="subtle">{accountsQuery.data?.items.length ?? 0}</Chip>
            </PanelHeader>
            <div className="p-4 space-y-3">
              {(accountsQuery.data?.items ?? []).map((account) => (
                <article key={account.id} className="rounded-xl border border-white/10 bg-zinc-900/40 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm text-zinc-100 font-medium">{account.label}</div>
                      <div className="text-xs text-zinc-500 mt-1">{account.profilePath}</div>
                    </div>
                    {account.state === "ready" ? <Chip variant="ok">ready</Chip> : account.state === "cooldown" ? <Chip variant="warn">cooldown</Chip> : <Chip variant="stop">{account.state}</Chip>}
                  </div>
                  <div className="text-xs text-zinc-500">next usable: {account.quotaNextUsableAt ?? "unknown"} · confidence {(account.quotaEtaConfidence * 100).toFixed(0)}%</div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => updateAccountMutation.mutate({ id: account.id, patch: { enabled: !account.enabled } })} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300">{account.enabled ? "Disable" : "Enable"}</button>
                    <button onClick={() => reauthMutation.mutate(account.id)} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300">Re-auth</button>
                    <button onClick={() => startAccountAuthMutation.mutate(account.id)} className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-medium text-white">{authSessionMap.get(account.id)?.status === "running" ? "Auth Running" : account.state === "auth_required" ? "Start Auth" : "Verify Auth"}</button>
                  </div>
                  {authSessionMap.get(account.id) ? (
                    <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-zinc-400 whitespace-pre-wrap">
                      auth status: <span className="text-zinc-200">{authSessionMap.get(account.id)?.status}</span>
                      {authSessionMap.get(account.id)?.message ? ` · ${authSessionMap.get(account.id)?.message}` : ""}
                      {(authSessionMap.get(account.id)?.log ?? []).length ? `\n${(authSessionMap.get(account.id)?.log ?? []).slice(-3).join("\n")}` : ""}
                    </div>
                  ) : null}
                </article>
              ))}
              {(accountsQuery.data?.items ?? []).length === 0 ? <div className="text-xs text-zinc-600">No Qwen CLI accounts configured.</div> : null}
            </div>
          </Panel>
        </div>
      ) : null}

      {tab === "advanced" ? (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-4">
          <Panel>
            <PanelHeader title="Runtime" />
            <div className="p-4 space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                <div className="text-sm text-white font-medium">On-prem backend</div>
                <select
                  value={onPremSettings.inferenceBackendId}
                  onChange={(event) => {
                    switchInferenceBackendV2({
                      actor: "user",
                      backend_id: event.target.value as "mlx-lm" | "sglang" | "vllm-openai" | "trtllm-openai" | "llama-cpp-openai" | "transformers-openai" | "ollama-openai",
                    }).then(() => {
                      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
                      queryClient.invalidateQueries({ queryKey: ["onprem-qwen-backends"] });
                    });
                  }}
                  className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                >
                  {(onPremBackendsQuery.data?.items ?? []).map((backend) => (
                    <option key={backend.id} value={backend.id}>{backend.label}</option>
                  ))}
                </select>
                <div className="flex flex-wrap gap-2">
                  <select value={autotuneProfile} onChange={(event) => setAutotuneProfile(event.target.value as "interactive" | "batch" | "tool_heavy")} className="rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200">
                    <option value="interactive">interactive</option>
                    <option value="batch">batch</option>
                    <option value="tool_heavy">tool-heavy</option>
                  </select>
                  <button onClick={() => autotuneMutation.mutate()} className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-medium text-white">Autotune</button>
                  {selectedInferenceBackend?.running ? (
                    <button onClick={() => backendStopMutation.mutate(selectedInferenceBackend.id as any)} className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">Stop</button>
                  ) : (
                    <button onClick={() => selectedInferenceBackend && backendStartMutation.mutate(selectedInferenceBackend.id as any)} className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">Start</button>
                  )}
                </div>
                <div className="text-xs text-zinc-500">{selectedInferenceBackend ? `optimized for ${selectedInferenceBackend.optimizedFor}` : "No backend selected"}</div>
                {startupCommand ? <code className="block rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-[10px] text-zinc-300 break-all">{startupCommand}</code> : null}
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                <div className="text-sm text-white font-medium">Parallel runtime</div>
                <div className="grid grid-cols-2 gap-3">
                  <LabeledInput label="Max local lanes" value={String(parallelRuntime.maxLocalLanes)} onChange={(value) => updateSettingsMutation.mutate({ parallelRuntime: { ...parallelRuntime, maxLocalLanes: Number(value) || 0 } })} />
                  <LabeledInput label="Max expanded lanes" value={String(parallelRuntime.maxExpandedLanes)} onChange={(value) => updateSettingsMutation.mutate({ parallelRuntime: { ...parallelRuntime, maxExpandedLanes: Number(value) || 0 } })} />
                  <LabeledInput label="Lease minutes" value={String(parallelRuntime.defaultLaneLeaseMinutes)} onChange={(value) => updateSettingsMutation.mutate({ parallelRuntime: { ...parallelRuntime, defaultLaneLeaseMinutes: Number(value) || 0 } })} />
                  <LabeledInput label="Stale after sec" value={String(parallelRuntime.staleAfterSeconds)} onChange={(value) => updateSettingsMutation.mutate({ parallelRuntime: { ...parallelRuntime, staleAfterSeconds: Number(value) || 0 } })} />
                </div>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Developer diagnostics" />
            <div className="p-4 space-y-4">
              {(latestBenchmarksQuery.data?.items ?? []).length > 0 ? (
                <div className="rounded-xl border border-white/10 bg-zinc-900/40 p-4">
                  <div className="text-sm text-white font-medium">Latest inference benchmarks</div>
                  <div className="mt-3 space-y-1">
                    {(latestBenchmarksQuery.data?.items ?? []).slice(0, 4).map((row) => (
                      <div key={`${row.profile}:${row.backendId}`} className="text-xs text-zinc-400">
                        {row.backendId} · score {row.score.toFixed(3)} · {row.outputTokPerSec.toFixed(1)} tok/s
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="rounded-xl border border-white/10 bg-zinc-900/40 p-4 space-y-3">
                <div className="text-sm text-white font-medium">Qwen CLI runtime</div>
                <LabeledInput label="Command" value={qwenSettings.command} onChange={(value) => updateSettingsMutation.mutate({ qwenCli: { ...qwenSettings, command: value } })} />
                <LabeledInput label="Args" value={qwenSettings.args.join(" ")} onChange={(value) => updateSettingsMutation.mutate({ qwenCli: { ...qwenSettings, args: value.split(" ").filter(Boolean) } })} />
              </div>

              <div className="rounded-xl border border-white/10 bg-zinc-900/40 p-4 space-y-3">
                <div className="text-sm text-white font-medium">Policy simulation</div>
                <LabeledInput label="Workspace path" value={policyPath} onChange={setPolicyPath} placeholder="/path/to/workspace" />
                <button onClick={() => dryRunPolicyMutation.mutate()} className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-zinc-300">Run dry-run policy check</button>
                {dryRunPolicyMutation.data ? (
                  <div className="text-xs text-zinc-400">decision: {dryRunPolicyMutation.data.decision.decision} · version {dryRunPolicyMutation.data.decision.policy_version}</div>
                ) : null}
              </div>
            </div>
          </Panel>
        </div>
      ) : null}

      {tab === "labs" ? (
        labsMode ? (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-4">
            <Panel>
              <PanelHeader title="Benchmarks + internal tools">
                <Chip variant="warn">developer only</Chip>
              </PanelHeader>
              <div className="p-4 space-y-3">
                <div className="text-sm text-white font-medium">Internal surfaces</div>
                <div className="text-xs text-zinc-500">Benchmarks and distillation stay out of the normal user app and live here for agent tuning and evaluation.</div>
                <button onClick={() => setActiveSection("benchmarks")} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white">Open Benchmarks Lab</button>
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Distillation">
                <Chip variant="warn">hidden from users</Chip>
              </PanelHeader>
              <div className="p-4 space-y-3">
                <LabeledInput label="Teacher command" value={distillSettings.teacherCommand} onChange={(value) => updateSettingsMutation.mutate({ distill: { ...distillSettings, teacherCommand: value } })} />
                <LabeledInput label="Teacher model" value={distillSettings.teacherModel} onChange={(value) => updateSettingsMutation.mutate({ distill: { ...distillSettings, teacherModel: value } })} />
                <LabeledInput label="Objective split" value={distillSettings.objectiveSplit} onChange={(value) => updateSettingsMutation.mutate({ distill: { ...distillSettings, objectiveSplit: value } })} />
                <LabeledInput label="Privacy policy" value={distillSettings.privacyPolicyVersion} onChange={(value) => updateSettingsMutation.mutate({ distill: { ...distillSettings, privacyPolicyVersion: value } })} />
                <div className="grid grid-cols-2 gap-3">
                  <LabeledInput label="Teacher RPM" value={String(distillSettings.teacherRateLimit?.maxRequestsPerMinute ?? 6)} onChange={(value) => updateSettingsMutation.mutate({ distill: { ...distillSettings, teacherRateLimit: { ...(distillSettings.teacherRateLimit || {}), maxRequestsPerMinute: Number(value) || 0 } } })} />
                  <LabeledInput label="Daily tokens" value={String(distillSettings.teacherRateLimit?.dailyTokenBudget ?? 120000)} onChange={(value) => updateSettingsMutation.mutate({ distill: { ...distillSettings, teacherRateLimit: { ...(distillSettings.teacherRateLimit || {}), dailyTokenBudget: Number(value) || 0 } } })} />
                </div>
              </div>
            </Panel>
          </div>
        ) : (
          <Panel>
            <PanelHeader title="Labs are hidden" />
            <div className="p-6 text-sm text-zinc-500">Enable Developer Labs above if you need benchmarks, distillation, or internal tuning tools.</div>
          </Panel>
        )
      ) : null}
    </div>
  );
}

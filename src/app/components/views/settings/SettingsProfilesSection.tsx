import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  activateModelPluginV2,
  activateProviderV2,
  getSettings,
  listInferenceBackendsV2,
  listModelPluginsV2,
  listOnPremRoleRuntimes,
  listOpenAiModels,
  setRuntimeMode,
  startEnabledOnPremRoleRuntimes,
  startOnPremRoleRuntime,
  stopOnPremRoleRuntime,
  testOnPremRoleRuntime,
  updateSettings,
} from "../../../lib/apiClient";
import { Chip, Panel, PanelHeader } from "../../UI";
import { LabeledInput } from "./SettingsShared";
import {
  DEFAULT_EXECUTION_PROFILES,
  EXECUTION_PROFILE_STAGE_ORDER,
  groupOpenAiModels,
  LOCAL_RUNTIME_ROLES,
  providerSecretStatus,
  recommendedHybridRoleBindings,
  recommendedOpenAiRoleBindings,
  ROLE_LABELS,
  ROLE_ORDER,
  stripRoleRuntimeSecretState,
  suggestSiblingLocalBaseUrl,
  type ExecutionProfileStageKey,
  type LocalRuntimeRoleKey,
  type ModelRoleKey,
} from "./types";

export function SettingsProfilesSection({
  executionProfilesSectionRef,
  highlightSection,
}: {
  executionProfilesSectionRef: React.RefObject<HTMLDivElement | null>;
  highlightSection: "providers" | "execution_profiles" | "accounts" | null;
}) {
  const queryClient = useQueryClient();
  const [onPremApiKeyDraft, setOnPremApiKeyDraft] = useState("");

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

  const onPremSettings = settingsQuery.data?.items.onPremQwen ?? {
    baseUrl: "http://127.0.0.1:8000/v1",
    hasApiKey: false,
    apiKeySource: "none" as const,
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
    hasApiKey: false,
    apiKeySource: "none" as const,
    model: "gpt-5-nano",
    timeoutMs: 120000,
    reasoningEffort: "medium",
    dailyBudgetUsd: 25,
    perRunBudgetUsd: 5,
    toolPolicy: { enableFileSearch: false, enableRemoteMcp: false },
  };

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

  const writableOnPremSettings = useMemo(
    () => ({
      baseUrl: onPremSettings.baseUrl,
      inferenceBackendId: onPremSettings.inferenceBackendId,
      pluginId: onPremSettings.pluginId,
      model: onPremSettings.model,
      reasoningMode: onPremSettings.reasoningMode,
      timeoutMs: onPremSettings.timeoutMs,
      temperature: onPremSettings.temperature,
      maxTokens: onPremSettings.maxTokens,
    }),
    [
      onPremSettings.baseUrl,
      onPremSettings.inferenceBackendId,
      onPremSettings.maxTokens,
      onPremSettings.model,
      onPremSettings.pluginId,
      onPremSettings.reasoningMode,
      onPremSettings.temperature,
      onPremSettings.timeoutMs,
    ]
  );
  const writableOpenAiResponsesSettings = useMemo(
    () => ({
      baseUrl: openAiResponsesSettings.baseUrl,
      model: openAiResponsesSettings.model,
      timeoutMs: openAiResponsesSettings.timeoutMs,
      reasoningEffort: openAiResponsesSettings.reasoningEffort,
      dailyBudgetUsd: openAiResponsesSettings.dailyBudgetUsd,
      perRunBudgetUsd: openAiResponsesSettings.perRunBudgetUsd,
      toolPolicy: openAiResponsesSettings.toolPolicy,
    }),
    [
      openAiResponsesSettings.baseUrl,
      openAiResponsesSettings.dailyBudgetUsd,
      openAiResponsesSettings.model,
      openAiResponsesSettings.perRunBudgetUsd,
      openAiResponsesSettings.reasoningEffort,
      openAiResponsesSettings.timeoutMs,
      openAiResponsesSettings.toolPolicy,
    ]
  );

  const executionProfiles = settingsQuery.data?.items.executionProfiles ?? DEFAULT_EXECUTION_PROFILES;
  const activeExecutionProfile =
    executionProfiles.profiles.find((profile) => profile.id === executionProfiles.activeProfileId) ??
    executionProfiles.profiles[0];

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
        hasApiKey: Boolean(raw.utility_fast?.hasApiKey),
        apiKeySource: (raw.utility_fast?.apiKeySource as "stored" | "env" | "none" | undefined) ?? "none",
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
        hasApiKey: Boolean(raw.coder_default?.hasApiKey),
        apiKeySource: (raw.coder_default?.apiKeySource as "stored" | "env" | "none" | undefined) ?? "none",
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
        hasApiKey: Boolean(raw.review_deep?.hasApiKey),
        apiKeySource: (raw.review_deep?.apiKeySource as "stored" | "env" | "none" | undefined) ?? "none",
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

  const setProviderMutation = useMutation({
    mutationFn: (providerId: "qwen-cli" | "openai-compatible" | "onprem-qwen" | "openai-responses") =>
      activateProviderV2(providerId, "user"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["policy-pending-v2"] });
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      if (variables.onPremQwen?.apiKey !== undefined || variables.onPremQwen?.clearApiKey) {
        setOnPremApiKeyDraft("");
      }
      toast.success("Settings saved");
    },
    onError: () => toast.error("Failed to save settings"),
  });

  const activatePluginMutation = useMutation({
    mutationFn: (pluginId: string) => activateModelPluginV2({ actor: "user", plugin_id: pluginId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onprem-qwen-plugins"] });
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
    },
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

  const applyModelRoles = (nextBindings: Record<ModelRoleKey, Record<string, unknown>>) => {
    updateSettingsMutation.mutate({ modelRoles: nextBindings });
  };
  const applyExecutionProfiles = (nextProfiles: typeof executionProfiles) => {
    updateSettingsMutation.mutate({ executionProfiles: nextProfiles });
  };
  const applyOnPremRoleRuntimes = (nextRuntimes: Record<LocalRuntimeRoleKey, Record<string, unknown>>) => {
    updateSettingsMutation.mutate({
      onPremQwenRoleRuntimes: Object.fromEntries(
        Object.entries(nextRuntimes).map(([role, runtime]) => [role, stripRoleRuntimeSecretState(runtime)])
      ) as Record<LocalRuntimeRoleKey, Record<string, unknown>>,
    });
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
    runtimeModeMutation.mutate({ mode: "local_qwen" });
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

  const selectedOnPremPlugin = (onPremPluginsQuery.data?.items ?? []).find((plugin) => plugin.id === onPremSettings.pluginId);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr]">
      <div
        ref={executionProfilesSectionRef}
        className={
          highlightSection === "execution_profiles"
            ? "rounded-2xl ring-1 ring-cyan-400/35 shadow-[0_0_0_1px_rgba(34,211,238,0.08),0_0_24px_rgba(34,211,238,0.08)] transition-all"
            : "transition-all"
        }
      >
        <Panel>
          <PanelHeader title="Execution Profiles and Routing" />
          <div className="p-4 space-y-4">
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
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={applyRecommendedOpenAiRoles}
                  className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 px-4 py-2 text-sm text-fuchsia-100"
                >
                  Apply recommended OpenAI roles
                </button>
                <button
                  onClick={applyRecommendedHybridRoles}
                  className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100"
                >
                  Apply hybrid recommended
                </button>
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
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-[150px_1fr_110px]">
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
          </div>
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel>
          <PanelHeader title="Runtime Controls" />
          <div className="p-4 space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-white font-medium">Default local model</div>
                <Chip variant={onPremSettings.hasApiKey ? "ok" : "subtle"}>
                  {providerSecretStatus(onPremSettings.hasApiKey, onPremSettings.apiKeySource)}
                </Chip>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <LabeledInput label="Base URL" value={onPremSettings.baseUrl} onChange={(value) => updateSettingsMutation.mutate({ onPremQwen: { ...writableOnPremSettings, baseUrl: value } })} />
                <LabeledInput label="Model" value={onPremSettings.model} onChange={(value) => updateSettingsMutation.mutate({ onPremQwen: { ...writableOnPremSettings, model: value } })} />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_auto]">
                <LabeledInput
                  label="API key (optional)"
                  type="password"
                  value={onPremApiKeyDraft}
                  placeholder={onPremSettings.hasApiKey ? "Saved in backend. Enter a new key to rotate it." : "leave blank for local-only runtimes"}
                  onChange={setOnPremApiKeyDraft}
                />
                <button
                  onClick={() => updateSettingsMutation.mutate({ onPremQwen: { apiKey: onPremApiKeyDraft } })}
                  disabled={!onPremApiKeyDraft.trim()}
                  className="self-end rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  Save key
                </button>
                <button
                  onClick={() => {
                    if (onPremApiKeyDraft.trim()) {
                      setOnPremApiKeyDraft("");
                      return;
                    }
                    updateSettingsMutation.mutate({ onPremQwen: { clearApiKey: true } });
                  }}
                  className="self-end rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-zinc-300"
                >
                  {onPremApiKeyDraft.trim() ? "Clear draft" : "Clear saved key"}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
                    onChange={(event) => updateSettingsMutation.mutate({ onPremQwen: { ...writableOnPremSettings, reasoningMode: event.target.value as "off" | "on" | "auto" } })}
                    className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                  >
                    <option value="off">off</option>
                    <option value="on">on</option>
                    <option value="auto">auto</option>
                  </select>
                </label>
                <LabeledInput label="Max tokens" value={String(onPremSettings.maxTokens)} onChange={(value) => updateSettingsMutation.mutate({ onPremQwen: { ...writableOnPremSettings, maxTokens: Number(value) || 0 } })} />
              </div>
              <div className="text-xs text-zinc-500">Use `off` for fast default coding, `on` for deeper review paths, and `auto` when role routing should decide.</div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
              <div className="text-sm text-white font-medium">OpenAI API model and budget</div>
              <label className="space-y-1 block">
                <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Model</div>
                <select
                  value={openAiResponsesSettings.model}
                  onChange={(event) =>
                    updateSettingsMutation.mutate({
                      openAiResponses: {
                        ...writableOpenAiResponsesSettings,
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
              <div className="grid grid-cols-2 gap-3">
                <LabeledInput label="Daily budget" value={String(openAiResponsesSettings.dailyBudgetUsd)} onChange={(value) => updateSettingsMutation.mutate({ openAiResponses: { ...writableOpenAiResponsesSettings, dailyBudgetUsd: Number(value) || 0 } })} />
                <LabeledInput label="Per-run budget" value={String(openAiResponsesSettings.perRunBudgetUsd)} onChange={(value) => updateSettingsMutation.mutate({ openAiResponses: { ...writableOpenAiResponsesSettings, perRunBudgetUsd: Number(value) || 0 } })} />
              </div>
              <div className="text-xs text-zinc-500">
                Models are fetched live from your account's OpenAI `/v1/models` list. Default quick preset is <code>gpt-5-nano</code>.
                {openAiModelsQuery.data?.error ? ` ${openAiModelsQuery.data.error}` : ""}
              </div>
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
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
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
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.2fr_1fr_1fr_110px]">
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
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
      </div>
    </div>
  );
}

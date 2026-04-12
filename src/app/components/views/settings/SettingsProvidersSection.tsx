import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getOpenAiBudgetV3,
  getSettings,
  listOpenAiModels,
  setRuntimeMode,
  updateSettings,
} from "../../../lib/apiClient";
import { toast } from "sonner";
import { Chip, Panel } from "../../UI";
import { LabeledInput } from "./SettingsShared";
import { DEFAULT_EXECUTION_PROFILES, providerSecretStatus, type SettingsView } from "./types";

export function SettingsProvidersSection({
  providersSectionRef,
  highlightSection,
  setView,
}: {
  providersSectionRef: React.RefObject<HTMLDivElement | null>;
  highlightSection: "providers" | "execution_profiles" | "accounts" | null;
  setView: (view: SettingsView) => void;
}) {
  const queryClient = useQueryClient();
  const [openAiApiKeyDraft, setOpenAiApiKeyDraft] = useState("");

  const settingsQuery = useQuery({ queryKey: ["app-settings"], queryFn: getSettings });
  const openAiBudgetQuery = useQuery({
    queryKey: ["openai-responses-budget-v3"],
    queryFn: getOpenAiBudgetV3,
    refetchInterval: 10000,
  });

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
  const runtimeMode = settingsQuery.data?.items.runtimeMode ?? "local_qwen";
  const executionProfiles = settingsQuery.data?.items.executionProfiles ?? DEFAULT_EXECUTION_PROFILES;
  const activeExecutionProfile =
    executionProfiles.profiles.find((profile) => profile.id === executionProfiles.activeProfileId) ??
    executionProfiles.profiles[0];
  const safety = (() => {
    const value = settingsQuery.data?.items.safety;
    if (!value) {
      return {
        requireApprovalForDestructiveOps: true,
        requireApprovalForProviderChanges: true,
        requireApprovalForCodeApply: true,
      };
    }
    return value as Record<string, boolean>;
  })();

  const runtimeModeMutation = useMutation({
    mutationFn: setRuntimeMode,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["openai-models"] });
      queryClient.invalidateQueries({ queryKey: ["openai-responses-budget-v3"] });
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      if (variables.openAiResponses?.apiKey !== undefined || variables.openAiResponses?.clearApiKey) {
        setOpenAiApiKeyDraft("");
      }
      toast.success("Settings saved");
    },
    onError: () => toast.error("Failed to save settings"),
  });

  const setActiveExecutionProfile = (profileId: string) => {
    updateSettingsMutation.mutate({
      executionProfiles: {
        ...executionProfiles,
        activeProfileId: profileId,
      },
    });
  };

  return (
    <div
      ref={providersSectionRef}
      className={
        highlightSection === "providers"
          ? "rounded-2xl ring-1 ring-cyan-400/35 shadow-[0_0_0_1px_rgba(34,211,238,0.08),0_0_24px_rgba(34,211,238,0.08)] transition-all"
          : "transition-all"
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Panel data-testid="settings-runtime-mode">
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-white">Runtime Mode</div>
              <Chip variant={runtimeMode === "openai_api" ? "ok" : "subtle"} className="text-[10px]">
                {runtimeMode === "openai_api" ? "OpenAI" : "Local"}
              </Chip>
            </div>
            <div className="text-xs text-zinc-500">Choose between local on-device models or cloud API.</div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() =>
                  runtimeModeMutation.mutate({
                    mode: "openai_api",
                    openAiApiKey: openAiApiKeyDraft.trim() || undefined,
                    openAiModel: openAiResponsesSettings.model,
                  })
                }
                className={`rounded-lg px-3 py-2 text-xs font-medium transition ${runtimeMode === "openai_api" ? "bg-cyan-600 text-white" : "border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06]"}`}
              >
                Use OpenAI API
              </button>
              <button
                onClick={() => runtimeModeMutation.mutate({ mode: "local_qwen" })}
                className={`rounded-lg px-3 py-2 text-xs font-medium transition ${runtimeMode !== "openai_api" ? "bg-cyan-600 text-white" : "border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06]"}`}
              >
                Use Local Qwen
              </button>
            </div>
          </div>
        </Panel>

        <Panel data-testid="settings-api-keys">
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-white">API Keys</div>
              <Chip variant={openAiResponsesSettings.hasApiKey ? "ok" : "subtle"} className="text-[10px]">
                {providerSecretStatus(openAiResponsesSettings.hasApiKey, openAiResponsesSettings.apiKeySource)}
              </Chip>
            </div>
            <LabeledInput
              label="OpenAI API key"
              type="password"
              value={openAiApiKeyDraft}
              placeholder={openAiResponsesSettings.hasApiKey ? "Key saved. Enter new to rotate." : "sk-..."}
              onChange={setOpenAiApiKeyDraft}
            />
            <div className="flex gap-2">
              <button
                onClick={() => updateSettingsMutation.mutate({ openAiResponses: { apiKey: openAiApiKeyDraft } })}
                disabled={!openAiApiKeyDraft.trim()}
                className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
              >
                Save
              </button>
              <button
                onClick={() => {
                  if (openAiApiKeyDraft.trim()) {
                    setOpenAiApiKeyDraft("");
                    return;
                  }
                  updateSettingsMutation.mutate({ openAiResponses: { clearApiKey: true } });
                }}
                className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300"
              >
                {openAiApiKeyDraft.trim() ? "Clear" : "Remove key"}
              </button>
            </div>
            <div className="text-[10px] text-zinc-600">
              Budget: ${(openAiBudgetQuery.data?.item.remainingUsd ?? openAiResponsesSettings.dailyBudgetUsd).toFixed(2)}/day remaining
            </div>
          </div>
        </Panel>

        <Panel data-testid="settings-active-profile">
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-white">Active Profile</div>
              <Chip variant="subtle" className="text-[10px]">{activeExecutionProfile?.name ?? "Balanced"}</Chip>
            </div>
            <div className="text-xs text-zinc-500">Controls how the agent pipeline distributes work across model roles.</div>
            <div className="flex flex-col gap-1.5">
              {executionProfiles.profiles.slice(0, 3).map((profile) => (
                <button
                  key={profile.id}
                  onClick={() => setActiveExecutionProfile(profile.id)}
                  className={`rounded-lg px-3 py-2 text-left text-xs transition ${
                    executionProfiles.activeProfileId === profile.id
                      ? "bg-cyan-500/10 border border-cyan-400/30 text-cyan-100"
                      : "border border-white/10 bg-white/[0.02] text-zinc-300 hover:bg-white/[0.05]"
                  }`}
                >
                  <span className="font-medium">{profile.name}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setView("advanced")}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 transition"
            >
              Customize profiles in Advanced →
            </button>
          </div>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel>
          <div className="p-4 grid grid-cols-1 gap-2 md:grid-cols-3">
            {Object.entries(safety).map(([key, value]) => (
              <label key={key} className="rounded-lg border border-white/10 bg-zinc-900/40 p-3 flex items-center justify-between gap-2">
                <span className="text-xs text-zinc-300">{key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}</span>
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
    </div>
  );
}

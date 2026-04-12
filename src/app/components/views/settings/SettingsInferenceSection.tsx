import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getLatestInferenceBenchmarksV2,
  getSettings,
  listExperimentalChannelActivity,
  listInferenceBackendsV2,
  policyDecideV2,
  runInferenceAutotuneV2,
  startInferenceBackendV2,
  stopInferenceBackendV2,
  switchInferenceBackendV2,
  updateSettings,
} from "../../../lib/apiClient";
import { useUiStore } from "../../../store/uiStore";
import { Chip, Panel, PanelHeader } from "../../UI";
import { LabeledInput } from "./SettingsShared";

export function SettingsInferenceSection() {
  const queryClient = useQueryClient();
  const labsMode = useUiStore((state) => state.labsMode);
  const [autotuneProfile, setAutotuneProfile] = useState<"interactive" | "batch" | "tool_heavy">("interactive");
  const [policyPath, setPolicyPath] = useState("");
  const [webhookSigningSecretDraft, setWebhookSigningSecretDraft] = useState("");
  const [telegramSigningSecretDraft, setTelegramSigningSecretDraft] = useState("");
  const [ciMonitoringSigningSecretDraft, setCiMonitoringSigningSecretDraft] = useState("");

  const settingsQuery = useQuery({ queryKey: ["app-settings"], queryFn: getSettings });
  const onPremBackendsQuery = useQuery({ queryKey: ["onprem-qwen-backends"], queryFn: listInferenceBackendsV2 });
  const latestBenchmarksQuery = useQuery({
    queryKey: ["inference-benchmarks-latest", autotuneProfile],
    queryFn: () => getLatestInferenceBenchmarksV2(autotuneProfile),
    enabled: labsMode || true,
    refetchInterval: 10000,
  });
  const channelActivityQuery = useQuery({
    queryKey: ["experimental-channel-activity"],
    queryFn: () => listExperimentalChannelActivity(),
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
  const qwenSettings = settingsQuery.data?.items.qwenCli ?? {
    command: "qwen",
    args: ["--auth-type", "qwen-oauth", "--output-format", "text"],
    timeoutMs: 120000,
  };
  const parallelRuntime = settingsQuery.data?.items.parallelRuntime ?? {
    maxLocalLanes: 4,
    maxExpandedLanes: 6,
    defaultLaneLeaseMinutes: 20,
    heartbeatIntervalSeconds: 10,
    staleAfterSeconds: 60,
    reservationTtlSeconds: 14400,
  };
  const experimentalChannels = settingsQuery.data?.items.experimentalChannels ?? {
    enabled: false,
    senderAllowlist: [],
    defaultProjectId: null,
    defaultSessionId: null,
    allowRemoteApprovals: false,
    allowUnattendedReadOnly: false,
    webhook: {
      enabled: false,
      signingSecret: "",
      hasSigningSecret: false,
    },
    telegram: {
      enabled: false,
      signingSecret: "",
      hasSigningSecret: false,
    },
    ciMonitoring: {
      enabled: false,
      signingSecret: "",
      hasSigningSecret: false,
    },
  };

  const selectedInferenceBackend = (onPremBackendsQuery.data?.items ?? []).find((backend) => backend.id === onPremSettings.inferenceBackendId);
  const startupCommand = (selectedInferenceBackend?.startupCommandTemplate ?? "")
    .replaceAll("{{model}}", onPremSettings.model || "mlx-community/Qwen3.5-4B-4bit");

  const updateSettingsMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      if (variables.experimentalChannels?.webhook?.signingSecret !== undefined || variables.experimentalChannels?.webhook?.clearSigningSecret) {
        setWebhookSigningSecretDraft("");
      }
      if (variables.experimentalChannels?.telegram?.signingSecret !== undefined || variables.experimentalChannels?.telegram?.clearSigningSecret) {
        setTelegramSigningSecretDraft("");
      }
      if (variables.experimentalChannels?.ciMonitoring?.signingSecret !== undefined || variables.experimentalChannels?.ciMonitoring?.clearSigningSecret) {
        setCiMonitoringSigningSecretDraft("");
      }
      toast.success("Settings saved");
    },
    onError: () => toast.error("Failed to save settings"),
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

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
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

          <div className="rounded-xl border border-white/10 bg-zinc-900/40 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm text-white font-medium">Channels + automations</div>
                <div className="text-xs text-zinc-500 mt-1">
                  Experimental event push into active mission sessions, with remote approval relay and bounded subagent planning.
                </div>
              </div>
              {experimentalChannels.enabled ? <Chip variant="warn">experimental</Chip> : <Chip variant="subtle">off</Chip>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-300">
                <span>Enable channels</span>
                <input
                  type="checkbox"
                  checked={experimentalChannels.enabled}
                  onChange={(event) => updateSettingsMutation.mutate({ experimentalChannels: { ...experimentalChannels, enabled: event.target.checked } })}
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-300">
                <span>Allow remote approvals</span>
                <input
                  type="checkbox"
                  checked={experimentalChannels.allowRemoteApprovals}
                  onChange={(event) =>
                    updateSettingsMutation.mutate({
                      experimentalChannels: { ...experimentalChannels, allowRemoteApprovals: event.target.checked },
                    })
                  }
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-300">
                <span>Allow unattended read-only delivery</span>
                <input
                  type="checkbox"
                  checked={experimentalChannels.allowUnattendedReadOnly}
                  onChange={(event) =>
                    updateSettingsMutation.mutate({
                      experimentalChannels: { ...experimentalChannels, allowUnattendedReadOnly: event.target.checked },
                    })
                  }
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-300">
                <span>Webhook source enabled</span>
                <input
                  type="checkbox"
                  checked={experimentalChannels.webhook.enabled}
                  onChange={(event) =>
                    updateSettingsMutation.mutate({
                      experimentalChannels: {
                        ...experimentalChannels,
                        webhook: { ...experimentalChannels.webhook, enabled: event.target.checked },
                      },
                    })
                  }
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-300">
                <span>Telegram relay enabled</span>
                <input
                  type="checkbox"
                  checked={experimentalChannels.telegram.enabled}
                  onChange={(event) =>
                    updateSettingsMutation.mutate({
                      experimentalChannels: {
                        ...experimentalChannels,
                        telegram: { ...experimentalChannels.telegram, enabled: event.target.checked },
                      },
                    })
                  }
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-300">
                <span>CI / monitoring source enabled</span>
                <input
                  type="checkbox"
                  checked={experimentalChannels.ciMonitoring.enabled}
                  onChange={(event) =>
                    updateSettingsMutation.mutate({
                      experimentalChannels: {
                        ...experimentalChannels,
                        ciMonitoring: { ...experimentalChannels.ciMonitoring, enabled: event.target.checked },
                      },
                    })
                  }
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <LabeledInput
                label="Default project id"
                value={experimentalChannels.defaultProjectId ?? ""}
                onChange={(value) =>
                  updateSettingsMutation.mutate({
                    experimentalChannels: { ...experimentalChannels, defaultProjectId: value.trim() || null },
                  })
                }
              />
              <LabeledInput
                label="Default session id"
                value={experimentalChannels.defaultSessionId ?? ""}
                onChange={(value) =>
                  updateSettingsMutation.mutate({
                    experimentalChannels: { ...experimentalChannels, defaultSessionId: value.trim() || null },
                  })
                }
              />
              <LabeledInput
                label="Sender allowlist"
                value={experimentalChannels.senderAllowlist.join(",")}
                onChange={(value) =>
                  updateSettingsMutation.mutate({
                    experimentalChannels: {
                      ...experimentalChannels,
                      senderAllowlist: value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    },
                  })
                }
                placeholder="ops-bot,neil-phone,ci-main"
              />
              <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-zinc-100">Webhook signing secret</div>
                  <Chip variant={experimentalChannels.webhook.hasSigningSecret ? "ok" : "subtle"}>
                    {experimentalChannels.webhook.hasSigningSecret ? "saved" : "not configured"}
                  </Chip>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto]">
                  <LabeledInput
                    label="Secret"
                    type="password"
                    value={webhookSigningSecretDraft}
                    placeholder={experimentalChannels.webhook.hasSigningSecret ? "Saved in backend. Enter a new secret to rotate it." : "shared secret"}
                    onChange={setWebhookSigningSecretDraft}
                  />
                  <button
                    onClick={() =>
                      updateSettingsMutation.mutate({
                        experimentalChannels: { webhook: { signingSecret: webhookSigningSecretDraft } },
                      })
                    }
                    disabled={!webhookSigningSecretDraft.trim()}
                    className="self-end rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      if (webhookSigningSecretDraft.trim()) {
                        setWebhookSigningSecretDraft("");
                        return;
                      }
                      updateSettingsMutation.mutate({
                        experimentalChannels: { webhook: { clearSigningSecret: true } },
                      });
                    }}
                    className="self-end rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-zinc-300"
                  >
                    {webhookSigningSecretDraft.trim() ? "Clear draft" : "Clear saved"}
                  </button>
                </div>
              </div>
              <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-zinc-100">Telegram signing secret</div>
                  <Chip variant={experimentalChannels.telegram.hasSigningSecret ? "ok" : "subtle"}>
                    {experimentalChannels.telegram.hasSigningSecret ? "saved" : "not configured"}
                  </Chip>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto]">
                  <LabeledInput
                    label="Secret"
                    type="password"
                    value={telegramSigningSecretDraft}
                    placeholder={experimentalChannels.telegram.hasSigningSecret ? "Saved in backend. Enter a new secret to rotate it." : "shared secret"}
                    onChange={setTelegramSigningSecretDraft}
                  />
                  <button
                    onClick={() =>
                      updateSettingsMutation.mutate({
                        experimentalChannels: { telegram: { signingSecret: telegramSigningSecretDraft } },
                      })
                    }
                    disabled={!telegramSigningSecretDraft.trim()}
                    className="self-end rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      if (telegramSigningSecretDraft.trim()) {
                        setTelegramSigningSecretDraft("");
                        return;
                      }
                      updateSettingsMutation.mutate({
                        experimentalChannels: { telegram: { clearSigningSecret: true } },
                      });
                    }}
                    className="self-end rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-zinc-300"
                  >
                    {telegramSigningSecretDraft.trim() ? "Clear draft" : "Clear saved"}
                  </button>
                </div>
              </div>
              <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-zinc-100">CI / monitoring signing secret</div>
                  <Chip variant={experimentalChannels.ciMonitoring.hasSigningSecret ? "ok" : "subtle"}>
                    {experimentalChannels.ciMonitoring.hasSigningSecret ? "saved" : "not configured"}
                  </Chip>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto]">
                  <LabeledInput
                    label="Secret"
                    type="password"
                    value={ciMonitoringSigningSecretDraft}
                    placeholder={experimentalChannels.ciMonitoring.hasSigningSecret ? "Saved in backend. Enter a new secret to rotate it." : "shared secret"}
                    onChange={setCiMonitoringSigningSecretDraft}
                  />
                  <button
                    onClick={() =>
                      updateSettingsMutation.mutate({
                        experimentalChannels: { ciMonitoring: { signingSecret: ciMonitoringSigningSecretDraft } },
                      })
                    }
                    disabled={!ciMonitoringSigningSecretDraft.trim()}
                    className="self-end rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      if (ciMonitoringSigningSecretDraft.trim()) {
                        setCiMonitoringSigningSecretDraft("");
                        return;
                      }
                      updateSettingsMutation.mutate({
                        experimentalChannels: { ciMonitoring: { clearSigningSecret: true } },
                      });
                    }}
                    className="self-end rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-zinc-300"
                  >
                    {ciMonitoringSigningSecretDraft.trim() ? "Clear draft" : "Clear saved"}
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-zinc-100">Recent channel activity</div>
                <div className="text-[11px] text-zinc-500">
                  {(channelActivityQuery.data?.items.channels.length ?? 0)} events · {(channelActivityQuery.data?.items.subagents.length ?? 0)} subagent plans
                </div>
              </div>
              {(channelActivityQuery.data?.items.channels ?? []).slice(0, 3).map((event) => (
                <div key={event.id} className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-300">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-100">{event.source}</span>
                    <span className="text-zinc-500">{new Date(event.createdAt).toLocaleTimeString()}</span>
                  </div>
                  <div className="mt-1 text-zinc-400">sender {event.senderId} · trust {event.trustLevel}</div>
                  <div className="mt-1 text-zinc-400 line-clamp-2">{event.content}</div>
                </div>
              ))}
              {(channelActivityQuery.data?.items.subagents ?? []).slice(0, 4).map((activity) => (
                <div key={activity.id} className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-300">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-100">{activity.role.replace(/_/g, " ")}</span>
                    <span className="text-zinc-500">{activity.status}</span>
                  </div>
                  <div className="mt-1 text-zinc-400">{activity.summary}</div>
                </div>
              ))}
              {!(channelActivityQuery.data?.items.channels.length || channelActivityQuery.data?.items.subagents.length) ? (
                <div className="text-xs text-zinc-500">No channel activity recorded yet.</div>
              ) : null}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

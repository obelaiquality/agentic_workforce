import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  addSecret,
  deleteSecret,
  getContextCompactionConfig,
  getPrivacyConfig,
  listSecrets,
  updateContextCompactionConfig,
  updatePrivacyConfig,
} from "../../../lib/apiClient";
import { Chip, Panel, PanelHeader } from "../../UI";
import { AdvancedSection } from "./SettingsShared";

export function SettingsPrivacySection({
  advancedOpenSection,
  setAdvancedOpenSection,
}: {
  advancedOpenSection: string | null;
  setAdvancedOpenSection: (section: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [newSecretName, setNewSecretName] = useState("");
  const [newSecretValue, setNewSecretValue] = useState("");
  const [secretToDelete, setSecretToDelete] = useState<string | null>(null);

  const contextCompactionQuery = useQuery({
    queryKey: ["context-compaction-config"],
    queryFn: getContextCompactionConfig,
  });
  const privacyConfigQuery = useQuery({
    queryKey: ["privacy-config"],
    queryFn: getPrivacyConfig,
  });
  const secretsQuery = useQuery({
    queryKey: ["secrets"],
    queryFn: listSecrets,
  });

  const updateContextCompactionMutation = useMutation({
    mutationFn: updateContextCompactionConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["context-compaction-config"] });
    },
  });

  const updatePrivacyConfigMutation = useMutation({
    mutationFn: updatePrivacyConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["privacy-config"] });
    },
  });

  const addSecretMutation = useMutation({
    mutationFn: ({ name, value }: { name: string; value: string }) => addSecret(name, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["secrets"] });
      toast.success("Secret added");
    },
    onError: () => toast.error("Failed to add secret"),
  });

  const deleteSecretMutation = useMutation({
    mutationFn: deleteSecret,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["secrets"] });
      toast("Secret removed");
    },
    onError: () => toast.error("Failed to delete secret"),
  });

  return (
    <>
      <AdvancedSection
        id="context-compaction"
        title="Context Compaction"
        subtitle="Adaptive context window management"
        open={advancedOpenSection === "context-compaction"}
        onToggle={() => setAdvancedOpenSection(advancedOpenSection === "context-compaction" ? null : "context-compaction")}
      >
        <div className="p-4">
          <Panel>
            <PanelHeader title="Context Compaction Configuration" />
            <div className="p-4 space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-4">
                <div>
                  <div className="text-sm font-medium text-white">Pressure Thresholds</div>
                  <div className="text-xs text-zinc-500 mt-1">
                    Configure when different compaction strategies activate based on context window pressure (0-1 scale).
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="block space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-400">Summarize ({((contextCompactionQuery.data?.thresholds?.summarize ?? 0.7) * 100).toFixed(0)}%)</span>
                      <span className="text-xs text-zinc-600">{contextCompactionQuery.data?.thresholds?.summarize ?? 0.7}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={contextCompactionQuery.data?.thresholds?.summarize ?? 0.7}
                      onChange={(e) => {
                        const newValue = parseFloat(e.target.value);
                        updateContextCompactionMutation.mutate({
                          thresholds: {
                            ...contextCompactionQuery.data?.thresholds,
                            summarize: newValue,
                          },
                        });
                      }}
                      className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                    />
                  </label>

                  <label className="block space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-400">Compress ({((contextCompactionQuery.data?.thresholds?.compress ?? 0.8) * 100).toFixed(0)}%)</span>
                      <span className="text-xs text-zinc-600">{contextCompactionQuery.data?.thresholds?.compress ?? 0.8}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={contextCompactionQuery.data?.thresholds?.compress ?? 0.8}
                      onChange={(e) => {
                        const newValue = parseFloat(e.target.value);
                        updateContextCompactionMutation.mutate({
                          thresholds: {
                            ...contextCompactionQuery.data?.thresholds,
                            compress: newValue,
                          },
                        });
                      }}
                      className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                    />
                  </label>

                  <label className="block space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-400">Drop Files ({((contextCompactionQuery.data?.thresholds?.dropFiles ?? 0.85) * 100).toFixed(0)}%)</span>
                      <span className="text-xs text-zinc-600">{contextCompactionQuery.data?.thresholds?.dropFiles ?? 0.85}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={contextCompactionQuery.data?.thresholds?.dropFiles ?? 0.85}
                      onChange={(e) => {
                        const newValue = parseFloat(e.target.value);
                        updateContextCompactionMutation.mutate({
                          thresholds: {
                            ...contextCompactionQuery.data?.thresholds,
                            dropFiles: newValue,
                          },
                        });
                      }}
                      className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                    />
                  </label>

                  <label className="block space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-400">Merge ({((contextCompactionQuery.data?.thresholds?.merge ?? 0.9) * 100).toFixed(0)}%)</span>
                      <span className="text-xs text-zinc-600">{contextCompactionQuery.data?.thresholds?.merge ?? 0.9}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={contextCompactionQuery.data?.thresholds?.merge ?? 0.9}
                      onChange={(e) => {
                        const newValue = parseFloat(e.target.value);
                        updateContextCompactionMutation.mutate({
                          thresholds: {
                            ...contextCompactionQuery.data?.thresholds,
                            merge: newValue,
                          },
                        });
                      }}
                      className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                    />
                  </label>

                  <label className="block space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-400">Emergency ({((contextCompactionQuery.data?.thresholds?.emergency ?? 0.99) * 100).toFixed(0)}%)</span>
                      <span className="text-xs text-zinc-600">{contextCompactionQuery.data?.thresholds?.emergency ?? 0.99}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={contextCompactionQuery.data?.thresholds?.emergency ?? 0.99}
                      onChange={(e) => {
                        const newValue = parseFloat(e.target.value);
                        updateContextCompactionMutation.mutate({
                          thresholds: {
                            ...contextCompactionQuery.data?.thresholds,
                            emergency: newValue,
                          },
                        });
                      }}
                      className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-4">
                <div>
                  <div className="text-sm font-medium text-white">Cache-Aware Pruning</div>
                  <div className="text-xs text-zinc-500 mt-1">
                    Optimize context by removing messages outside the prompt cache window.
                  </div>
                </div>

                <label className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Enable cache-aware pruning</span>
                  <input
                    type="checkbox"
                    checked={contextCompactionQuery.data?.microcompact?.enabled ?? true}
                    onChange={(e) => {
                      updateContextCompactionMutation.mutate({
                        microcompact: {
                          ...contextCompactionQuery.data?.microcompact,
                          enabled: e.target.checked,
                        },
                      });
                    }}
                    className="w-4 h-4 rounded border-white/20 bg-zinc-900 text-cyan-500 focus:ring-cyan-500/30"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-zinc-400">Cache window size</span>
                  <input
                    type="number"
                    min="10"
                    max="200"
                    value={contextCompactionQuery.data?.microcompact?.cacheWindowSize ?? 50}
                    onChange={(e) => {
                      updateContextCompactionMutation.mutate({
                        microcompact: {
                          ...contextCompactionQuery.data?.microcompact,
                          cacheWindowSize: parseInt(e.target.value, 10),
                        },
                      });
                    }}
                    className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-zinc-400">Min age for removal (turns)</span>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={contextCompactionQuery.data?.microcompact?.minAgeForRemoval ?? 3}
                    onChange={(e) => {
                      updateContextCompactionMutation.mutate({
                        microcompact: {
                          ...contextCompactionQuery.data?.microcompact,
                          minAgeForRemoval: parseInt(e.target.value, 10),
                        },
                      });
                    }}
                    className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                  />
                </label>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-4">
                <div>
                  <div className="text-sm font-medium text-white">Snip Compaction</div>
                  <div className="text-xs text-zinc-500 mt-1">
                    Configure tail protection and minimum pressure for snip-based compaction.
                  </div>
                </div>

                <label className="block space-y-1">
                  <span className="text-xs text-zinc-400">Protected tail turns</span>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={contextCompactionQuery.data?.snipCompact?.protectedTailTurns ?? 10}
                    onChange={(e) => {
                      updateContextCompactionMutation.mutate({
                        snipCompact: {
                          ...contextCompactionQuery.data?.snipCompact,
                          protectedTailTurns: parseInt(e.target.value, 10),
                        },
                      });
                    }}
                    className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                  />
                </label>

                <label className="block space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">Min pressure threshold ({((contextCompactionQuery.data?.snipCompact?.minPressureThreshold ?? 0.5) * 100).toFixed(0)}%)</span>
                    <span className="text-xs text-zinc-600">{contextCompactionQuery.data?.snipCompact?.minPressureThreshold ?? 0.5}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={contextCompactionQuery.data?.snipCompact?.minPressureThreshold ?? 0.5}
                    onChange={(e) => {
                      const newValue = parseFloat(e.target.value);
                      updateContextCompactionMutation.mutate({
                        snipCompact: {
                          ...contextCompactionQuery.data?.snipCompact,
                          minPressureThreshold: newValue,
                        },
                      });
                    }}
                    className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                  />
                </label>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => {
                    updateContextCompactionMutation.mutate({
                      thresholds: { summarize: 0.7, compress: 0.8, dropFiles: 0.85, merge: 0.9, emergency: 0.99 },
                      microcompact: { enabled: true, cacheWindowSize: 50, minAgeForRemoval: 3 },
                      snipCompact: { protectedTailTurns: 10, minPressureThreshold: 0.5 },
                    });
                  }}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-xs text-zinc-300 hover:bg-white/[0.08] transition"
                >
                  Reset to Defaults
                </button>
              </div>
            </div>
          </Panel>
        </div>
      </AdvancedSection>

      <AdvancedSection
        id="privacy"
        title="Privacy & Redaction"
        subtitle={privacyConfigQuery.data?.redactionEnabled ? "Active" : "Disabled"}
        open={advancedOpenSection === "privacy"}
        onToggle={() => setAdvancedOpenSection(advancedOpenSection === "privacy" ? null : "privacy")}
      >
        <div className="p-4">
          <Panel>
            <PanelHeader title="Automatic Redaction" />
            <div className="p-4 space-y-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={privacyConfigQuery.data?.redactionEnabled ?? true}
                  onChange={(e) => {
                    updatePrivacyConfigMutation.mutate({
                      redactionEnabled: e.target.checked,
                    });
                  }}
                  className="h-4 w-4 rounded border-white/10 bg-zinc-950 text-cyan-500 focus:ring-2 focus:ring-cyan-500/40"
                />
                <span className="text-sm text-white">Enable Automatic Redaction</span>
              </label>

              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="text-sm font-medium text-white mb-3">Pattern Detection</div>
                <div className="space-y-2">
                  {(privacyConfigQuery.data?.patterns ?? []).map((pattern) => (
                    <div key={pattern.type} className="flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2">
                        <svg
                          className="h-3 w-3 text-zinc-500"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        <span className="text-zinc-300">{pattern.label}</span>
                      </div>
                      <Chip variant="subtle">{pattern.enabled ? "protected" : "disabled"}</Chip>
                    </div>
                  ))}
                </div>
              </div>

              {privacyConfigQuery.data?.stats?.totalRedactions ? (
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="text-sm font-medium text-white mb-2">Redaction Stats</div>
                  <div className="text-xs text-zinc-400">
                    Total redactions: {privacyConfigQuery.data.stats.totalRedactions}
                  </div>
                  {Object.keys(privacyConfigQuery.data.stats.byType).length > 0 ? (
                    <div className="mt-2 space-y-1">
                      {Object.entries(privacyConfigQuery.data.stats.byType).map(([type, count]) => (
                        <div key={type} className="flex items-center justify-between text-[10px] text-zinc-500">
                          <span>{type}</span>
                          <span>{count}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Panel>
        </div>
      </AdvancedSection>

      <AdvancedSection
        id="secrets"
        title="Secrets"
        subtitle={`${secretsQuery.data?.items?.length ?? 0} stored`}
        open={advancedOpenSection === "secrets"}
        onToggle={() => setAdvancedOpenSection(advancedOpenSection === "secrets" ? null : "secrets")}
      >
        <div className="p-4">
          <Panel>
            <PanelHeader title="Secrets Management" />
            <div className="p-4 space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                <div className="text-sm font-medium text-white">Add Secret</div>
                <div className="grid grid-cols-[1fr_2fr_auto] gap-2">
                  <input
                    type="text"
                    value={newSecretName}
                    onChange={(e) => setNewSecretName(e.target.value)}
                    placeholder="Name"
                    className="rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                  />
                  <input
                    type="password"
                    value={newSecretValue}
                    onChange={(e) => setNewSecretValue(e.target.value)}
                    placeholder="Value"
                    className="rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                  />
                  <button
                    onClick={() => {
                      if (newSecretName && newSecretValue) {
                        addSecretMutation.mutate(
                          { name: newSecretName, value: newSecretValue },
                          {
                            onSuccess: () => {
                              setNewSecretName("");
                              setNewSecretValue("");
                            },
                          }
                        );
                      }
                    }}
                    disabled={!newSecretName || !newSecretValue || addSecretMutation.isPending}
                    className="rounded-lg border border-white/10 bg-cyan-500/10 px-4 py-2 text-xs text-cyan-400 hover:bg-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    Add
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="px-4 py-2 text-left text-zinc-500 font-medium">Name</th>
                      <th className="px-4 py-2 text-left text-zinc-500 font-medium">Source</th>
                      <th className="px-4 py-2 text-left text-zinc-500 font-medium">Updated</th>
                      <th className="px-4 py-2 text-right text-zinc-500 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(secretsQuery.data?.items ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-zinc-600">
                          No secrets stored
                        </td>
                      </tr>
                    ) : (
                      (secretsQuery.data?.items ?? []).map((secret) => (
                        <tr key={secret.name} className="border-b border-white/5 last:border-0">
                          <td className="px-4 py-2 text-zinc-300">{secret.name}</td>
                          <td className="px-4 py-2">
                            <Chip variant={secret.source === "stored" ? "subtle" : "ok"}>
                              {secret.source}
                            </Chip>
                          </td>
                          <td className="px-4 py-2 text-zinc-500">
                            {secret.updatedAt
                              ? new Date(secret.updatedAt).toLocaleDateString()
                              : "\u2014"}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {secretToDelete === secret.name ? (
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => {
                                    deleteSecretMutation.mutate(secret.name, {
                                      onSuccess: () => setSecretToDelete(null),
                                    });
                                  }}
                                  className="rounded px-2 py-1 text-[10px] bg-red-500/10 text-red-400 hover:bg-red-500/20"
                                >
                                  Confirm
                                </button>
                                <button
                                  onClick={() => setSecretToDelete(null)}
                                  className="rounded px-2 py-1 text-[10px] bg-white/5 text-zinc-400 hover:bg-white/10"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setSecretToDelete(secret.name)}
                                className="rounded px-2 py-1 text-[10px] bg-white/5 text-zinc-400 hover:bg-white/10"
                              >
                                Delete
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </Panel>
        </div>
      </AdvancedSection>
    </>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bootstrapQwenAccount,
  getLspIntegrations,
  getMcpIntegrations,
  getSettings,
  listQwenAccounts,
  listQwenAccountAuthSessions,
  reauthQwenAccount,
  startQwenAccountAuth,
  updateQwenAccount,
} from "../../lib/apiClient";
import { useUiStore } from "../../store/uiStore";
import { Chip, Panel, PanelHeader } from "../UI";
import { SkillCatalog } from "../skills/SkillCatalog";
import { HookList } from "../hooks/HookList";
import { DiagnosticsView } from "./DiagnosticsView";
import { AdvancedSection, LabeledInput } from "./settings/SettingsShared";
import { SettingsProvidersSection } from "./settings/SettingsProvidersSection";
import { SettingsProfilesSection } from "./settings/SettingsProfilesSection";
import { SettingsInferenceSection } from "./settings/SettingsInferenceSection";
import { SettingsMcpSection } from "./settings/SettingsMcpSection";
import { SettingsPrivacySection } from "./settings/SettingsPrivacySection";
import { SettingsNotificationsSection } from "./settings/SettingsNotificationsSection";
import { DEFAULT_EXECUTION_PROFILES, type SettingsView } from "./settings/types";

export function SettingsControlView() {
  const queryClient = useQueryClient();
  const labsMode = useUiStore((state) => state.labsMode);
  const setLabsMode = useUiStore((state) => state.setLabsMode);
  const setActiveSection = useUiStore((state) => state.setActiveSection);
  const settingsFocusTarget = useUiStore((state) => state.settingsFocusTarget);
  const setSettingsFocusTarget = useUiStore((state) => state.setSettingsFocusTarget);
  const [view, setView] = useState<SettingsView>("essentials");
  const [newAccountLabel, setNewAccountLabel] = useState("");
  const providersSectionRef = useRef<HTMLDivElement | null>(null);
  const executionProfilesSectionRef = useRef<HTMLDivElement | null>(null);
  const accountsSectionRef = useRef<HTMLDivElement | null>(null);
  const [highlightSection, setHighlightSection] = useState<"providers" | "execution_profiles" | "accounts" | null>(null);
  const [advancedOpenSection, setAdvancedOpenSection] = useState<string | null>("profiles");

  const settingsQuery = useQuery({ queryKey: ["app-settings"], queryFn: getSettings });
  const accountsQuery = useQuery({ queryKey: ["qwen-accounts"], queryFn: listQwenAccounts });
  const authSessionsQuery = useQuery({
    queryKey: ["qwen-account-auth-sessions"],
    queryFn: listQwenAccountAuthSessions,
    refetchInterval: 2000,
  });
  const mcpIntegrationsQuery = useQuery({
    queryKey: ["settings-integrations", "mcp"],
    queryFn: getMcpIntegrations,
    enabled: view === "advanced",
    refetchInterval: 5000,
  });
  const lspIntegrationsQuery = useQuery({
    queryKey: ["settings-integrations", "lsp"],
    queryFn: getLspIntegrations,
    enabled: view === "advanced",
    refetchInterval: 5000,
  });

  const mcpServers = mcpIntegrationsQuery.data?.items ?? [];
  const lspServers = lspIntegrationsQuery.data?.items ?? [];
  const connectedMcpServers = mcpServers.filter((server) => server.connected);
  const runningLspServers = lspServers.filter((server) => server.running);

  const executionProfiles = settingsQuery.data?.items.executionProfiles ?? DEFAULT_EXECUTION_PROFILES;
  const activeExecutionProfile =
    executionProfiles.profiles.find((profile) => profile.id === executionProfiles.activeProfileId) ??
    executionProfiles.profiles[0];

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

  const authSessionMap = useMemo(
    () => new Map((authSessionsQuery.data?.items ?? []).map((item) => [item.accountId, item])),
    [authSessionsQuery.data?.items]
  );

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

  useEffect(() => {
    if (!settingsFocusTarget) return;
    const focusMap = {
      providers: { view: "essentials" as SettingsView, ref: providersSectionRef },
      execution_profiles: { view: "advanced" as SettingsView, ref: executionProfilesSectionRef },
      accounts: { view: "essentials" as SettingsView, ref: accountsSectionRef },
    };
    const target = focusMap[settingsFocusTarget];
    setView(target.view);
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
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-zinc-900/50 p-1 border border-white/5">
          {([
            { key: "essentials" as const, label: "Essentials" },
            { key: "advanced" as const, label: "Advanced" },
            { key: "diagnostics" as const, label: "Diagnostics" },
          ]).map((item) => (
            <button
              data-testid={`settings-view-${item.key}`}
              key={item.key}
              onClick={() => setView(item.key)}
              className={`px-4 py-2 rounded-md text-xs font-medium transition-colors ${view === item.key ? "bg-white/[0.08] text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
          <span className="text-xs text-zinc-400">Labs</span>
          <input aria-label="Show Labs" type="checkbox" checked={labsMode} onChange={(event) => setLabsMode(event.target.checked)} />
        </label>
      </div>

      {view === "essentials" ? (
        <SettingsProvidersSection
          providersSectionRef={providersSectionRef}
          highlightSection={highlightSection}
          setView={setView}
        />
      ) : null}

      {view === "advanced" ? (
        <div className="space-y-2">
          <AdvancedSection
            id="profiles"
            title="Execution Profiles & Routing"
            subtitle={activeExecutionProfile?.name ?? "Balanced"}
            open={advancedOpenSection === "profiles"}
            onToggle={() => setAdvancedOpenSection(advancedOpenSection === "profiles" ? null : "profiles")}
          >
            <SettingsProfilesSection
              executionProfilesSectionRef={executionProfilesSectionRef}
              highlightSection={highlightSection}
            />
          </AdvancedSection>

          <AdvancedSection
            id="runtime"
            title="Runtime & Diagnostics"
            subtitle={onPremSettings.inferenceBackendId}
            open={advancedOpenSection === "runtime"}
            onToggle={() => setAdvancedOpenSection(advancedOpenSection === "runtime" ? null : "runtime")}
          >
            <SettingsInferenceSection />
          </AdvancedSection>

          <AdvancedSection
            id="integrations"
            title="Integrations & Code Intelligence"
            subtitle={`${connectedMcpServers.length}/${mcpServers.length} MCP live · ${runningLspServers.length}/${lspServers.length} LSP running`}
            open={advancedOpenSection === "integrations"}
            onToggle={() => setAdvancedOpenSection(advancedOpenSection === "integrations" ? null : "integrations")}
          >
            <SettingsMcpSection />
          </AdvancedSection>

          <AdvancedSection
            id="labs"
            title="Labs & Experimental"
            subtitle={labsMode ? "Enabled" : "Disabled"}
            open={advancedOpenSection === "labs"}
            onToggle={() => setAdvancedOpenSection(advancedOpenSection === "labs" ? null : "labs")}
          >
          {labsMode ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
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
                <PanelHeader title="Distillation Pipeline">
                  <Chip variant="warn">hidden from users</Chip>
                </PanelHeader>
                <div className="p-4 space-y-3">
                  <div className="text-sm text-white font-medium">Model Distillation</div>
                  <div className="text-xs text-zinc-500">Full pipeline for dataset generation, training, evaluation, and model promotion with teacher-student distillation.</div>
                  <button onClick={() => setActiveSection("distillation")} className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white">Open Distillation Lab</button>
                </div>
              </Panel>

              <Panel>
                <PanelHeader title="Learnings & Memory">
                  <Chip variant="warn">self-learning</Chip>
                </PanelHeader>
                <div className="p-4 space-y-3">
                  <div className="text-sm text-white font-medium">Self-Learning Loop</div>
                  <div className="text-xs text-zinc-500">Browse patterns and antipatterns extracted from agentic runs. Consolidated principles improve future execution. Approve or dismiss auto-suggested skills.</div>
                  <button onClick={() => setActiveSection("learnings")} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white">Open Learnings Lab</button>
                </div>
              </Panel>
            </div>
          ) : (
            <div className="p-4 text-sm text-zinc-500">Enable Developer Labs at the top of this page to access benchmarks, distillation, and internal tuning tools.</div>
          )}
          </AdvancedSection>

          <AdvancedSection
            id="accounts"
            title="Accounts & Approvals"
            subtitle={`${(accountsQuery.data?.items ?? []).length} accounts`}
            open={advancedOpenSection === "accounts"}
            onToggle={() => setAdvancedOpenSection(advancedOpenSection === "accounts" ? null : "accounts")}
          >
            <div
              ref={accountsSectionRef}
              className={
                highlightSection === "accounts"
                  ? "rounded-2xl ring-1 ring-cyan-400/35 shadow-[0_0_0_1px_rgba(34,211,238,0.08),0_0_24px_rgba(34,211,238,0.08)] transition-all"
                  : "transition-all"
              }
            >
              <Panel>
                <PanelHeader title="Accounts">
                  <Chip variant="subtle">optional provider path</Chip>
                </PanelHeader>
                <div className="space-y-4 p-4">
                  <div className="rounded-xl border border-white/10 bg-zinc-950/40 p-4 space-y-3">
                    <div className="text-sm font-medium text-white">Add Qwen account</div>
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
                  </div>

                  <div className="space-y-3">
                    {(accountsQuery.data?.items ?? []).map((account) => (
                      <article key={account.id} className="rounded-xl border border-white/10 bg-zinc-900/40 p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm text-zinc-100 font-medium">{account.label}</div>
                            <div className="text-xs text-zinc-500 mt-1">{account.profilePath}</div>
                          </div>
                          {account.state === "ready" ? <Chip variant="ok">ready</Chip> : account.state === "cooldown" ? <Chip variant="warn">cooldown</Chip> : <Chip variant="stop">{account.state}</Chip>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => updateAccountMutation.mutate({ id: account.id, patch: { enabled: !account.enabled } })} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300">{account.enabled ? "Disable" : "Enable"}</button>
                          <button onClick={() => reauthMutation.mutate(account.id)} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300">Re-auth</button>
                          <button onClick={() => startAccountAuthMutation.mutate(account.id)} className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-medium text-white">{authSessionMap.get(account.id)?.status === "running" ? "Auth Running" : account.state === "auth_required" ? "Start Auth" : "Verify Auth"}</button>
                        </div>
                      </article>
                    ))}
                    {(accountsQuery.data?.items ?? []).length === 0 ? <div className="text-xs text-zinc-600">No Qwen CLI accounts configured.</div> : null}
                  </div>
                </div>
              </Panel>
            </div>
          </AdvancedSection>

          <SettingsPrivacySection
            advancedOpenSection={advancedOpenSection}
            setAdvancedOpenSection={setAdvancedOpenSection}
          />

          <AdvancedSection
            id="notifications"
            title="Notifications"
            subtitle="Webhook alerts"
            open={advancedOpenSection === "notifications"}
            onToggle={() => setAdvancedOpenSection(advancedOpenSection === "notifications" ? null : "notifications")}
          >
            <SettingsNotificationsSection />
          </AdvancedSection>

          <AdvancedSection
            id="skills"
            title="Skills"
            subtitle="Reusable agent workflows"
            open={advancedOpenSection === "skills"}
            onToggle={() => setAdvancedOpenSection(advancedOpenSection === "skills" ? null : "skills")}
          >
            <div className="p-4">
              <SkillCatalog />
            </div>
          </AdvancedSection>

          <AdvancedSection
            id="hooks"
            title="Hooks"
            subtitle="Persistent automation triggers"
            open={advancedOpenSection === "hooks"}
            onToggle={() => setAdvancedOpenSection(advancedOpenSection === "hooks" ? null : "hooks")}
          >
            <div className="p-4">
              <HookList />
            </div>
          </AdvancedSection>
        </div>
      ) : null}

      {view === "diagnostics" ? (
        <DiagnosticsView />
      ) : null}
    </div>
  );
}

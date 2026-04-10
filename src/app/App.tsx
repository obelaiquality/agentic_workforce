import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ChevronDown, Code2, FolderGit2, Settings, Terminal } from "lucide-react";
import { EmptyState } from "./components/ui/empty-state";
import { PreflightGate } from "./components/PreflightGate";
import { CodebaseView } from "./components/views/CodebaseView";
import { ConsoleView } from "./components/views/ConsoleView";
import { SettingsControlView } from "./components/views/SettingsControlView";
import { ProjectsWorkspaceView } from "./components/views/ProjectsWorkspaceView";
import { useMissionControlLiveData } from "./hooks/useMissionControlLiveData";
import { useUiStore } from "./store/uiStore";
import { CommandCenterView } from "./components/views/CommandCenterView";
import { TelemetryView } from "./components/views/TelemetryView";
import { AgentLanesView } from "./components/views/AgentLanesView";
import { PatternsView } from "./components/views/PatternsView";
import { DistillationView } from "./components/views/DistillationView";
import { BenchmarkView } from "./components/views/BenchmarkView";
import { LearningsView } from "./components/views/LearningsView";
import { ProcessingIndicator } from "./components/ui/processing-indicator";
import { Toaster } from "./components/ui/sonner";
import { CommandPalette } from "./components/CommandPalette";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { KeyboardShortcutsDialog } from "./components/KeyboardShortcutsDialog";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcut";

type SidebarSection = "live" | "codebase" | "console" | "projects" | "settings";
type LiveTab = "Execution" | "Agents" | "Patterns" | "Telemetry";

const SIDEBAR_ITEMS: Array<{ key: SidebarSection; icon: React.ReactNode; label: string }> = [
  { key: "live", icon: <Activity />, label: "Work" },
  { key: "codebase", icon: <Code2 />, label: "Codebase" },
  { key: "console", icon: <Terminal />, label: "Console" },
  { key: "projects", icon: <FolderGit2 />, label: "Projects" },
];

function normalizeSection(value: string | null | undefined): SidebarSection {
  if (value === "overseer" || value === "runs") return "live";
  if (value === "benchmarks" || value === "distillation" || value === "learnings") return "settings";
  if (value === "codebase" || value === "console" || value === "projects" || value === "settings") return value;
  return "live";
}

export default function App() {
  const activeSection = useUiStore((state) => state.activeSection);
  const setActiveSection = useUiStore((state) => state.setActiveSection);
  const setSettingsFocusTarget = useUiStore((state) => state.setSettingsFocusTarget);
  const selectedWorkflowId = useUiStore((state) => state.selectedWorkflowId);
  const codebaseScope = useUiStore((state) => state.codebaseScope);
  const labsMode = useUiStore((state) => state.labsMode);
  const mission = useMissionControlLiveData();
  const [liveTab, setLiveTab] = useState<LiveTab>("Execution");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  const sidebarSection = normalizeSection(activeSection);
  const liveTabs: LiveTab[] = labsMode ? ["Execution", "Agents", "Patterns", "Telemetry"] : ["Execution"];

  const NAV_SECTIONS = ["live", "codebase", "console", "projects", "settings"] as const;
  useKeyboardShortcuts(
    NAV_SECTIONS.map((section, i) => ({
      key: String(i + 1),
      modifiers: ["meta" as const],
      handler: () => setActiveSection(section),
    })),
  );

  useEffect(() => {
    // Only reset activeSection when navigating to a genuinely different sidebar area.
    // Sub-sections like "learnings", "distillation", "benchmarks" normalize to "settings"
    // but should NOT be overwritten, so the sub-view keeps rendering.
    if (sidebarSection !== activeSection && normalizeSection(activeSection) !== sidebarSection) {
      setActiveSection(sidebarSection);
    }
  }, [activeSection, setActiveSection, sidebarSection]);

  useEffect(() => {
    if (!liveTabs.includes(liveTab)) {
      setLiveTab("Execution");
    }
  }, [liveTab, liveTabs]);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileMenuOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [profileMenuOpen]);

  const openSettingsTarget = (target: "providers" | "execution_profiles") => {
    setActiveSection("settings");
    setSettingsFocusTarget(target);
    setProfileMenuOpen(false);
  };

  const criticalCount = mission.pendingApprovals.length + (mission.runPhase === "error" ? 1 : 0);
  const headerRepos = useMemo(() => mission.headerRepos, [mission.headerRepos]);
  const selectedWorkflowCard = useMemo(
    () => mission.workflowCards.find((workflow) => workflow.workflowId === selectedWorkflowId) || null,
    [mission.workflowCards, selectedWorkflowId]
  );
  const selectedWorkflowTicket = useMemo(
    () => mission.tickets.find((ticket) => ticket.id === selectedWorkflowId) || null,
    [mission.tickets, selectedWorkflowId]
  );
  const workflowFocusedFiles = useMemo(() => {
    if (!selectedWorkflowId) return mission.contextPack?.files || [];
    if (mission.selectedTicket?.id === selectedWorkflowId) {
      return Array.from(new Set(mission.contextPack?.files || []));
    }
    return Array.from(new Set(selectedWorkflowCard?.impactedFiles || []));
  }, [
    mission.contextPack?.files,
    mission.selectedTicket?.id,
    selectedWorkflowCard?.impactedFiles,
    selectedWorkflowId,
  ]);
  const workflowFocusedTests = useMemo(() => {
    if (!selectedWorkflowId) return mission.contextPack?.tests || [];
    if (mission.selectedTicket?.id === selectedWorkflowId) {
      return Array.from(new Set(mission.contextPack?.tests || []));
    }
    return Array.from(new Set(selectedWorkflowCard?.impactedTests || []));
  }, [mission.contextPack?.tests, mission.selectedTicket?.id, selectedWorkflowCard?.impactedTests, selectedWorkflowId]);
  const workflowFocusedDocs = useMemo(() => {
    if (!selectedWorkflowId) return mission.contextPack?.docs || [];
    if (mission.selectedTicket?.id === selectedWorkflowId) {
      return Array.from(new Set(mission.contextPack?.docs || []));
    }
    return Array.from(new Set(selectedWorkflowCard?.impactedDocs || []));
  }, [mission.contextPack?.docs, mission.selectedTicket?.id, selectedWorkflowCard?.impactedDocs, selectedWorkflowId]);
  const workflowConsoleLogs = useMemo(
    () => (selectedWorkflowId ? mission.consoleLogs.filter((log) => log.taskId === selectedWorkflowId) : []),
    [mission.consoleLogs, selectedWorkflowId]
  );
  const codebaseWorkflowTitle = selectedWorkflowTicket?.title || mission.selectedTicket?.title || null;
  const headerStatus = mission.appMode === "limited_preview"
    ? { label: "Limited Preview", className: "border-amber-500/20 bg-amber-500/10 text-amber-100" }
    : mission.appMode === "backend_unavailable"
    ? { label: "Backend Unavailable", className: "border-rose-500/20 bg-rose-500/10 text-rose-100" }
    : criticalCount > 0
    ? { label: `${criticalCount} attention`, className: "border-amber-500/20 bg-amber-500/10 text-amber-100" }
    : mission.liveState === "live"
    ? { label: "Ready", className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-100" }
    : mission.liveState === "loading"
    ? { label: "Syncing", className: "border-cyan-500/20 bg-cyan-500/10 text-cyan-100" }
    : { label: "Needs attention", className: "border-white/10 bg-white/[0.04] text-zinc-200" };
  return (
    <PreflightGate>
      <div data-testid="app-root" className="h-screen w-screen bg-[#0a0a0c] text-zinc-300 overflow-hidden flex flex-col font-sans selection:bg-purple-500/30">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-[200] focus:top-2 focus:left-2 focus:rounded-lg focus:bg-purple-600 focus:px-4 focus:py-2 focus:text-white focus:text-sm focus:font-medium focus:shadow-lg"
        >
          Skip to content
        </a>
        <style>{`
          .custom-scrollbar::-webkit-scrollbar { width: 5px; height: 5px; }
          .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 10px; }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.16); }
        `}</style>

        <header data-testid="app-header" className="h-11 border-b border-white/5 bg-black/50 flex items-center px-4 justify-between z-50 shrink-0 relative">
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-purple-500/25 to-transparent" />

          <div className="flex items-center gap-5 min-w-0">
            <div className="flex items-center gap-2 text-white shrink-0 min-w-0">
              <img src="/assets/agentic-workforce-shell.svg" alt="Agentic Workforce" className="h-5 w-5 shrink-0" />
              <span className="font-bold tracking-tight text-sm truncate">Agentic Workforce</span>
            </div>

            <div className="h-4 w-px bg-white/10 hidden md:block" />

            {sidebarSection === "live" ? (
              <nav className="hidden md:flex gap-0.5 text-xs font-medium text-zinc-500">
                {liveTabs.map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setLiveTab(tab)}
                    className={`px-3 py-1.5 rounded-md transition-colors relative ${
                      liveTab === tab ? "bg-white/5 text-zinc-100" : "hover:text-zinc-300 hover:bg-white/[0.03]"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </nav>
            ) : (
              <span className="hidden md:block text-xs text-zinc-500 font-medium">
                {sidebarSection === "codebase"
                  ? "Codebase Explorer"
                  : sidebarSection === "console"
                  ? "Console"
                  : sidebarSection === "projects"
                  ? "Projects"
                  : "Settings"}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 min-w-0">
            <div className={`hidden sm:flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${headerStatus.className}`}>
              <ProcessingIndicator
                kind="telemetry"
                active={mission.liveState === "live" && mission.appMode === "desktop"}
                size="xs"
                tone="subtle"
                className="border-0 bg-transparent p-0"
              />
              <span data-testid="app-header-status" role="status" aria-live="polite">{headerStatus.label}</span>
            </div>
            <div ref={profileMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setProfileMenuOpen((open) => !open)}
                className="relative flex items-center gap-1 rounded-full border border-white/12 bg-black/40 px-1 py-1 shadow-[0_0_14px_rgba(34,211,238,0.12)] overflow-hidden transition-all hover:border-cyan-400/30 hover:shadow-[0_0_16px_rgba(34,211,238,0.18)] focus:outline-none focus:ring-2 focus:ring-cyan-400/30"
                data-testid="app-quick-settings-trigger"
                aria-label="Open quick settings"
                title="Open quick settings"
                aria-expanded={profileMenuOpen}
              >
                <span className="relative block h-5 w-5 overflow-hidden rounded-full">
                  <span className="absolute inset-[1px] rounded-full bg-[radial-gradient(circle_at_32%_28%,rgba(255,255,255,0.85),rgba(255,255,255,0.12)_18%,rgba(0,0,0,0)_22%),linear-gradient(135deg,rgba(28,211,255,0.95)_0%,rgba(88,28,255,0.92)_55%,rgba(255,0,170,0.82)_100%)]" />
                  <span className="absolute inset-0 rounded-full ring-1 ring-inset ring-white/8" />
                  <span className="absolute -inset-x-2 bottom-[-35%] h-[65%] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.2),rgba(255,255,255,0)_70%)] blur-[6px]" />
                </span>
                <ChevronDown className={`h-3 w-3 text-zinc-400 transition-transform ${profileMenuOpen ? "rotate-180" : ""}`} />
              </button>

              {profileMenuOpen ? (
                <div className="absolute right-0 top-[calc(100%+8px)] z-50 min-w-[220px] rounded-2xl border border-white/10 bg-[#101013]/95 p-2 shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur">
                  <div className="px-2 pb-2 pt-1 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Quick settings</div>
                  {[
                    { key: "providers" as const, label: "Open Essentials", note: "Runtime mode, accounts, and approvals" },
                    { key: "execution_profiles" as const, label: "Open Advanced", note: "Profiles, routing, runtimes, and Labs" },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => openSettingsTarget(item.key)}
                      className="flex w-full items-start rounded-xl px-3 py-2.5 text-left transition hover:bg-white/[0.05]"
                    >
                      <div>
                        <div className="text-sm font-medium text-white">{item.label}</div>
                        <div className="mt-0.5 text-xs text-zinc-500">{item.note}</div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          <aside data-testid="app-sidebar" className="w-14 lg:w-56 border-r border-white/5 bg-[#0d0d0f] flex flex-col justify-between shrink-0 transition-[width] duration-200" role="navigation" aria-label="Main navigation">
            <div className="p-2 flex flex-col gap-1 pt-3">
              {SIDEBAR_ITEMS.map((item) => (
                <SidebarItem
                  key={item.key}
                  icon={item.icon}
                  label={item.label}
                  active={sidebarSection === item.key}
                  onClick={() => setActiveSection(item.key)}
                  testId={`sidebar-${item.key}`}
                />
              ))}
            </div>
            <div className="p-2 pb-4 flex flex-col gap-2">
              <div className="rounded-lg border border-white/5 bg-white/[0.02] px-2 py-2">
                <div className="hidden lg:flex items-center gap-2 mb-1.5 px-0.5">
                  <FolderGit2 className="h-3 w-3 text-cyan-400/70 shrink-0" />
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Project</span>
                </div>
                <select
                  data-testid="sidebar-project-selector"
                  value={mission.selectedRepo?.id || ""}
                  onChange={(event) => {
                    const repoId = event.target.value;
                    if (repoId) mission.activateRepo(repoId);
                  }}
                  title="Select project"
                  className="w-full bg-transparent text-xs text-zinc-300 outline-none truncate cursor-pointer hidden lg:block"
                >
                  <option value="">No project</option>
                  {headerRepos.map((repo) => (
                    <option key={repo.id} value={repo.id}>
                      {repo.displayName}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setActiveSection("projects")}
                  title={mission.selectedRepo?.displayName || "Select project"}
                  className="lg:hidden flex items-center justify-center w-full"
                >
                  <FolderGit2 className="h-4 w-4 text-cyan-400/70" />
                </button>
                {mission.selectedRepo && (
                  <div className="hidden lg:block mt-1 px-0.5 text-[10px] text-zinc-600 truncate">
                    {mission.selectedRepo.branch || mission.selectedRepo.defaultBranch || "main"}
                  </div>
                )}
              </div>
              <SidebarItem
                icon={<Settings />}
                label="Settings"
                active={sidebarSection === "settings"}
                onClick={() => setActiveSection("settings")}
                testId="sidebar-settings"
              />
            </div>
          </aside>

          <main id="main-content" data-testid="app-main-content" className="flex-1 overflow-y-auto custom-scrollbar bg-gradient-to-br from-[#0a0a0c] via-[#0c0c0e] to-[#0f0f12] p-4 md:p-5">
            {labsMode && (
              <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-300">
                <span className="font-semibold uppercase tracking-wider">Labs</span>
                <span className="text-amber-300/70">Experimental features are enabled. Some tabs and workflows may be unstable.</span>
              </div>
            )}
            <div className="max-w-[1600px] mx-auto space-y-4">
              {mission.appModeNotice ? (
                <AppModeBanner
                  title={mission.appModeNotice.title}
                  message={mission.appModeNotice.message}
                  detail={mission.appModeNotice.detail}
                  mode={mission.appMode}
                  onOpenProjects={mission.openProjects}
                  onOpenSettings={() => openSettingsTarget("providers")}
                />
              ) : null}

              {sidebarSection === "live" && (
                <>
                  <div className="flex md:hidden gap-1 bg-zinc-900/50 rounded-lg p-1 border border-white/5">
                    {liveTabs.map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setLiveTab(tab)}
                        className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                          liveTab === tab ? "bg-zinc-800 text-zinc-100" : "text-zinc-500"
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>

                  {liveTab === "Execution" && (
                    <ErrorBoundary viewName="Execution">
                      <CommandCenterView mission={mission} />
                    </ErrorBoundary>
                  )}

                  {liveTab === "Telemetry" && (
                    <ErrorBoundary viewName="Telemetry">
                      <TelemetryView />
                    </ErrorBoundary>
                  )}

                  {liveTab === "Agents" && (
                    <ErrorBoundary viewName="Agent Lanes">
                      <AgentLanesView />
                    </ErrorBoundary>
                  )}

                  {liveTab === "Patterns" && (
                    <ErrorBoundary viewName="Patterns">
                      <PatternsView />
                    </ErrorBoundary>
                  )}
                </>
              )}

              {sidebarSection === "codebase" && (
                <ErrorBoundary viewName="Codebase">
                  <CodebaseView
                    repoId={mission.selectedRepo?.id || null}
                    contextPaths={workflowFocusedFiles}
                    testPaths={workflowFocusedTests}
                    docPaths={workflowFocusedDocs}
                    workflowTitle={codebaseWorkflowTitle}
                    requestedScope={codebaseScope}
                  />
                </ErrorBoundary>
              )}

              {sidebarSection === "console" && (
                <ErrorBoundary viewName="Console">
                  <ConsoleView
                    projectId={mission.selectedRepo?.id || null}
                    snapshotEvents={mission.consoleEvents}
                    workflowId={selectedWorkflowId}
                    workflowTitle={selectedWorkflowTicket?.title || null}
                    workflowLogs={workflowConsoleLogs}
                  />
                </ErrorBoundary>
              )}

              {sidebarSection === "projects" && (
                <ErrorBoundary viewName="Projects">
                  <ProjectsWorkspaceView
                    activeRepo={mission.selectedRepo}
                    recentRepos={mission.recentRepos}
                    recentRepoPaths={mission.recentRepoPaths}
                    hasDesktopPicker={mission.hasDesktopPicker}
                    repoPickerMessage={mission.repoPickerMessage}
                    chooseLocalRepo={mission.chooseLocalRepo}
                    openNewProjectDialog={mission.openNewProjectDialog}
                    projectStarters={mission.projectStarters}
                    projectSetupState={mission.projectSetupState}
                    createBlankProject={mission.createBlankProject}
                    createProjectFromStarter={mission.createProjectFromStarter}
                    dismissProjectSetupDialog={mission.dismissProjectSetupDialog}
                    openStarterDialogForActiveProject={mission.openStarterDialogForActiveProject}
                    activeProjectIsBlank={mission.activeProjectIsBlank}
                    activeStarterId={mission.activeStarterId}
                    openWork={mission.openWork}
                    openRecentPath={mission.connectRecentPath}
                    activateRepo={mission.activateRepo}
                    syncProject={mission.syncProject}
                    githubOwner={mission.githubOwner}
                    setGithubOwner={mission.setGithubOwner}
                    githubRepo={mission.githubRepo}
                    setGithubRepo={mission.setGithubRepo}
                    connectGithubProject={mission.connectGithubProject}
                    isActing={mission.isActing}
                    actionMessage={mission.actionMessage}
                    syncingRepoId={mission.syncingRepoId}
                    isConnectingLocal={mission.isConnectingLocal}
                    isBootstrappingProject={mission.isBootstrappingProject}
                    isConnectingGithub={mission.isConnectingGithub}
                    blueprint={mission.blueprint}
                    updateBlueprint={mission.updateBlueprint}
                    regenerateBlueprint={mission.regenerateBlueprint}
                    isRefreshingBlueprint={mission.isRefreshingBlueprint}
                    labsMode={labsMode}
                  />
                </ErrorBoundary>
              )}

              {sidebarSection === "settings" && (
                <ErrorBoundary viewName={
                  activeSection === "distillation" ? "Distillation"
                    : activeSection === "benchmarks" ? "Benchmarks"
                    : activeSection === "learnings" ? "Learnings"
                    : "Settings"
                }>
                  {activeSection === "distillation" ? (
                    <DistillationView />
                  ) : activeSection === "benchmarks" ? (
                    <BenchmarkView />
                  ) : activeSection === "learnings" ? (
                    <LearningsView projectId={mission.selectedRepo?.id} />
                  ) : (
                    <SettingsControlView />
                  )}
                </ErrorBoundary>
              )}
            </div>
          </main>
        </div>
      </div>
      <CommandPalette />
      <KeyboardShortcutsDialog />
      <Toaster position="bottom-right" richColors closeButton />
    </PreflightGate>
  );
}

function SidebarItem({
  icon,
  label,
  active,
  onClick,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={`flex items-center gap-2.5 p-2.5 rounded-lg transition-all duration-150 w-full group relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/20 ${
        active ? "bg-purple-500/10 text-purple-300" : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
      }`}
    >
      <span
        className={`[&>svg]:w-4 [&>svg]:h-4 shrink-0 transition-transform duration-150 group-hover:scale-105 ${
          active ? "text-purple-400" : "text-zinc-500 group-hover:text-zinc-400"
        }`}
      >
        {icon}
      </span>
      <span className="hidden lg:block text-xs font-medium tracking-wide truncate">{label}</span>
      <span className={`absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-r bg-purple-500 transition-all duration-150 ${active ? "h-5 opacity-100" : "h-0 opacity-0"}`} />
    </button>
  );
}

function AppModeBanner({
  title,
  message,
  detail,
  mode,
  onOpenProjects,
  onOpenSettings,
}: {
  title: string;
  message: string;
  detail: string;
  mode: "desktop" | "limited_preview" | "backend_unavailable";
  onOpenProjects: () => void;
  onOpenSettings: () => void;
}) {
  const toneClass =
    mode === "backend_unavailable"
      ? "border-rose-500/20 bg-rose-500/10"
      : "border-amber-500/20 bg-amber-500/10";

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-200">{title}</div>
          <div className="text-sm text-white">{message}</div>
          <div className="text-xs text-zinc-300">{detail}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onOpenProjects}
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-100 transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/20"
          >
            Open Projects
          </button>
          {mode === "backend_unavailable" ? (
            <button
              type="button"
              onClick={onOpenSettings}
              className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-100 transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/20"
            >
              Open Essentials
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}


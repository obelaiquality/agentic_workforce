import { useEffect, useMemo, useState } from "react";
import { Activity, Code2, FolderGit2, Orbit, Settings, Terminal } from "lucide-react";
import { PreflightGate } from "./components/PreflightGate";
import { Chip } from "./components/UI";
import { CodebaseView } from "./components/views/CodebaseView";
import { ConsoleView } from "./components/views/ConsoleView";
import { SettingsControlView } from "./components/views/SettingsControlView";
import { ProjectsWorkspaceView } from "./components/views/ProjectsWorkspaceView";
import { useMissionControlLiveData } from "./hooks/useMissionControlLiveData";
import { useUiStore } from "./store/uiStore";
import { CommandCenterView } from "./components/views/CommandCenterView";

type SidebarSection = "live" | "codebase" | "console" | "projects" | "settings";
type LiveTab = "Execution" | "Agents" | "Patterns" | "Telemetry";

const SIDEBAR_ITEMS: Array<{ key: SidebarSection; icon: React.ReactNode; label: string }> = [
  { key: "live", icon: <Activity />, label: "Live State" },
  { key: "codebase", icon: <Code2 />, label: "Codebase" },
  { key: "console", icon: <Terminal />, label: "Console" },
  { key: "projects", icon: <FolderGit2 />, label: "Projects" },
];

function normalizeSection(value: string | null | undefined): SidebarSection {
  if (value === "overseer" || value === "runs") return "live";
  if (value === "benchmarks") return "settings";
  if (value === "codebase" || value === "console" || value === "projects" || value === "settings") return value;
  return "live";
}

export default function App() {
  const activeSection = useUiStore((state) => state.activeSection);
  const setActiveSection = useUiStore((state) => state.setActiveSection);
  const selectedWorkflowId = useUiStore((state) => state.selectedWorkflowId);
  const labsMode = useUiStore((state) => state.labsMode);
  const mission = useMissionControlLiveData();
  const [liveTab, setLiveTab] = useState<LiveTab>("Execution");

  const sidebarSection = normalizeSection(activeSection);
  const liveTabs: LiveTab[] = labsMode ? ["Execution", "Agents", "Patterns", "Telemetry"] : ["Execution"];

  useEffect(() => {
    if (sidebarSection !== activeSection) {
      setActiveSection(sidebarSection);
    }
  }, [activeSection, setActiveSection, sidebarSection]);

  useEffect(() => {
    if (!liveTabs.includes(liveTab)) {
      setLiveTab("Execution");
    }
  }, [liveTab, liveTabs]);

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
    if (!selectedWorkflowId) return [];
    if (mission.selectedTicket?.id === selectedWorkflowId) {
      return Array.from(new Set([...(mission.contextPack?.files || []), ...(mission.contextPack?.tests || []), ...(mission.contextPack?.docs || [])]));
    }
    return Array.from(
      new Set([
        ...(selectedWorkflowCard?.impactedFiles || []),
        ...(selectedWorkflowCard?.impactedTests || []),
        ...(selectedWorkflowCard?.impactedDocs || []),
      ])
    );
  }, [
    mission.contextPack?.docs,
    mission.contextPack?.files,
    mission.contextPack?.tests,
    mission.selectedTicket?.id,
    selectedWorkflowCard?.impactedDocs,
    selectedWorkflowCard?.impactedFiles,
    selectedWorkflowCard?.impactedTests,
    selectedWorkflowId,
  ]);
  const workflowConsoleLogs = useMemo(
    () => (selectedWorkflowId ? mission.consoleLogs.filter((log) => log.taskId === selectedWorkflowId) : []),
    [mission.consoleLogs, selectedWorkflowId]
  );
  return (
    <PreflightGate>
      <div className="h-screen w-screen bg-[#0a0a0c] text-zinc-300 overflow-hidden flex flex-col font-sans selection:bg-purple-500/30">
        <style>{`
          .custom-scrollbar::-webkit-scrollbar { width: 5px; height: 5px; }
          .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 10px; }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.16); }
        `}</style>

        <header className="h-11 border-b border-white/5 bg-black/50 flex items-center px-4 justify-between z-50 shrink-0 relative">
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-purple-500/25 to-transparent" />

          <div className="flex items-center gap-5 min-w-0">
            <div className="flex items-center gap-2 text-white shrink-0 min-w-0">
              <Orbit className="w-4 h-4 text-purple-500" />
              <span className="font-bold tracking-tight text-sm truncate">Mission Control</span>
              <Chip variant="subtle" className="text-[9px] border-purple-500/30 text-purple-400 bg-purple-500/10 uppercase tracking-widest px-1.5 py-0 hidden sm:inline-flex">
                NEXT-GEN
              </Chip>
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
                  ? "Agent Console"
                  : sidebarSection === "projects"
                  ? "Projects"
                  : "Settings"}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 min-w-0">
            <div className="hidden lg:flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 min-w-[300px] max-w-[420px]">
              <FolderGit2 className="h-3.5 w-3.5 text-cyan-300 shrink-0" />
              <select
                value={mission.selectedRepo?.id || ""}
                onChange={(event) => {
                  const repoId = event.target.value;
                  if (repoId) mission.activateRepo(repoId);
                }}
                className="min-w-0 flex-1 bg-transparent text-xs text-zinc-100 outline-none"
              >
                <option value="">No project selected</option>
                {headerRepos.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.displayName}
                  </option>
                ))}
              </select>
              <span className="text-[10px] uppercase tracking-wide text-zinc-500 whitespace-nowrap">
                {mission.selectedRepo ? mission.selectedRepo.branch || mission.selectedRepo.defaultBranch || "main" : "connect repo"}
              </span>
            </div>

            {criticalCount > 0 ? (
              <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] font-mono">
                {criticalCount} attention
              </div>
            ) : null}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded bg-black/50 border border-white/5 text-[10px] font-mono">
              <span className={`w-1.5 h-1.5 rounded-full ${mission.liveState === "live" ? "bg-emerald-500 animate-pulse shadow-[0_0_6px_rgba(16,185,129,0.8)]" : "bg-zinc-600"}`} />
              <span className={mission.liveState === "live" ? "text-emerald-400" : "text-zinc-400"}>{mission.liveState.toUpperCase()}</span>
            </div>
            <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-purple-500 to-cyan-500 shadow-[0_0_12px_rgba(168,85,247,0.35)] border border-white/20 shrink-0" />
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          <aside className="w-14 lg:w-56 border-r border-white/5 bg-[#0d0d0f] flex flex-col justify-between shrink-0">
            <div className="p-2 flex flex-col gap-1 pt-3">
              {SIDEBAR_ITEMS.map((item) => (
                <SidebarItem
                  key={item.key}
                  icon={item.icon}
                  label={item.label}
                  active={sidebarSection === item.key}
                  onClick={() => setActiveSection(item.key)}
                />
              ))}
            </div>
            <div className="p-2 pb-4">
              <SidebarItem
                icon={<Settings />}
                label="Settings"
                active={sidebarSection === "settings"}
                onClick={() => setActiveSection("settings")}
              />
            </div>
          </aside>

          <main className="flex-1 overflow-y-auto custom-scrollbar bg-gradient-to-br from-[#0a0a0c] via-[#0c0c0e] to-[#0f0f12] p-4 md:p-5">
            <div className="max-w-[1600px] mx-auto space-y-4">
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
                    <CommandCenterView mission={mission} />
                  )}

                  {liveTab !== "Execution" && (
                    <SectionHeader
                      title={`${liveTab} (Labs)`}
                      description="Advanced mission-control diagnostics stay out of the normal operator path."
                    >
                      <StatusDot color="amber" label="labs only" />
                    </SectionHeader>
                  )}
                </>
              )}

              {sidebarSection === "codebase" && (
                <>
                  <SectionHeader title="Codebase Explorer" description="Code graph files, impacted tests, and documentation pulled into the current context pack.">
                    <StatusDot
                      color={mission.selectedRepo ? "amber" : "purple"}
                      label={mission.selectedRepo ? "managed worktree" : "connect repo"}
                    />
                  </SectionHeader>
                  <CodebaseView
                    repoId={mission.selectedRepo?.id || null}
                    preferredPaths={workflowFocusedFiles}
                    workflowTitle={selectedWorkflowTicket?.title || null}
                  />
                </>
              )}

              {sidebarSection === "console" && (
                <>
                  <SectionHeader title="Agent Console" description="Execution, approvals, provider events, and verification output in one live stream.">
                    <StatusDot color="emerald" label="real event stream" animate />
                  </SectionHeader>
                  <ConsoleView
                    projectId={mission.selectedRepo?.id || null}
                    snapshotEvents={mission.consoleEvents}
                    workflowId={selectedWorkflowId}
                    workflowTitle={selectedWorkflowTicket?.title || null}
                    workflowLogs={workflowConsoleLogs}
                  />
                </>
              )}

              {sidebarSection === "projects" && (
                <>
                  <SectionHeader title="Projects" description="Connect a repo, reopen recent work, and keep the active project warm and ready.">
                    <StatusDot color="cyan" label={`${mission.recentRepos.length} recent`} />
                  </SectionHeader>
                  <ProjectsWorkspaceView
                    activeRepo={mission.selectedRepo}
                    recentRepos={mission.recentRepos}
                    recentRepoPaths={mission.recentRepoPaths}
                    hasDesktopPicker={mission.hasDesktopPicker}
                    repoPickerMessage={mission.repoPickerMessage}
                    chooseLocalRepo={mission.chooseLocalRepo}
                    startNewProject={mission.startNewProject}
                    newProjectTemplate={mission.newProjectTemplate}
                    setNewProjectTemplate={mission.setNewProjectTemplate}
                    initializeNewProject={mission.initializeNewProject}
                    pendingBootstrap={mission.pendingBootstrap}
                    openRecentPath={mission.connectRecentPath}
                    activateRepo={mission.activateRepo}
                    syncProject={mission.syncProject}
                    githubOwner={mission.githubOwner}
                    setGithubOwner={mission.setGithubOwner}
                    githubRepo={mission.githubRepo}
                    setGithubRepo={mission.setGithubRepo}
                    connectGithubProject={mission.connectGithubProject}
                    isActing={mission.isActing}
                    blueprint={mission.blueprint}
                    updateBlueprint={mission.updateBlueprint}
                    regenerateBlueprint={mission.regenerateBlueprint}
                    labsMode={labsMode}
                  />
                </>
              )}

              {sidebarSection === "settings" && (
                <>
                  <SectionHeader title="Mission Settings" description="Providers, approvals, connected accounts, and developer Labs when enabled." />
                  <SettingsControlView />
                </>
              )}
            </div>
          </main>
        </div>
      </div>
    </PreflightGate>
  );
}

function SidebarItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex items-center gap-2.5 p-2.5 rounded-lg transition-all w-full group relative ${
        active ? "bg-purple-500/10 text-purple-300" : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
      }`}
    >
      <span
        className={`[&>svg]:w-4 [&>svg]:h-4 shrink-0 transition-transform group-hover:scale-105 ${
          active ? "text-purple-400" : "text-zinc-500 group-hover:text-zinc-400"
        }`}
      >
        {icon}
      </span>
      <span className="hidden lg:block text-xs font-medium tracking-wide truncate">{label}</span>
      {active ? <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r bg-purple-500" /> : null}
    </button>
  );
}

function SectionHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 rounded-xl border border-white/5 bg-white/[0.015]">
      <div>
        <h1 className="text-base font-bold text-white">{title}</h1>
        {description ? <p className="text-xs text-zinc-500 mt-0.5">{description}</p> : null}
      </div>
      {children ? <div className="shrink-0">{children}</div> : null}
    </div>
  );
}

function StatusDot({
  color,
  label,
  animate,
}: {
  color: "emerald" | "amber" | "rose" | "purple" | "cyan";
  label: string;
  animate?: boolean;
}) {
  const dotColors = {
    emerald: "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]",
    amber: "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.6)]",
    rose: "bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.6)]",
    purple: "bg-purple-500 shadow-[0_0_6px_rgba(168,85,247,0.6)]",
    cyan: "bg-cyan-500 shadow-[0_0_6px_rgba(6,182,212,0.6)]",
  };

  return (
    <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
      <span className={`w-1.5 h-1.5 rounded-full ${dotColors[color]} ${animate ? "animate-pulse" : ""}`} />
      {label}
    </div>
  );
}

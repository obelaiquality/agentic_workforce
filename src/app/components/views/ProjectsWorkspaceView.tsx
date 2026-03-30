import { useEffect, useMemo, useState } from "react";
import { FolderGit2, Github, Plus, RefreshCw, Sparkles } from "lucide-react";
import { Chip, Panel, PanelHeader } from "../UI";
import type {
  ProjectBlueprint,
  ProjectStarterDefinition,
  ProjectStarterId,
  RepoRegistration,
} from "../../../shared/contracts";
import type { RecentRepoPath } from "../../lib/desktopBridge";
import { ProjectBlueprintPanel } from "../mission/ProjectBlueprintPanel";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { ProcessingIndicator } from "../ui/processing-indicator";

function starterLabel(starterId: ProjectStarterId | null) {
  if (!starterId) {
    return "Blank repo";
  }
  return starterId === "neutral_baseline" ? "Neutral baseline" : "TypeScript app";
}

export function ProjectsWorkspaceView({
  activeRepo,
  recentRepos,
  recentRepoPaths,
  hasDesktopPicker,
  repoPickerMessage,
  chooseLocalRepo,
  openNewProjectDialog,
  projectStarters,
  projectSetupState,
  createBlankProject,
  createProjectFromStarter,
  dismissProjectSetupDialog,
  openStarterDialogForActiveProject,
  activeProjectIsBlank,
  activeStarterId,
  openWork,
  openRecentPath,
  activateRepo,
  syncProject,
  githubOwner,
  setGithubOwner,
  githubRepo,
  setGithubRepo,
  connectGithubProject,
  isActing,
  actionMessage,
  syncingRepoId,
  isConnectingLocal,
  isBootstrappingProject,
  isConnectingGithub,
  blueprint,
  updateBlueprint,
  regenerateBlueprint,
  isRefreshingBlueprint,
  labsMode,
}: {
  activeRepo: RepoRegistration | null;
  recentRepos: RepoRegistration[];
  recentRepoPaths: RecentRepoPath[];
  hasDesktopPicker: boolean;
  repoPickerMessage: string | null;
  chooseLocalRepo: () => void;
  openNewProjectDialog: () => void;
  projectStarters: ProjectStarterDefinition[];
  projectSetupState: {
    mode: "create" | "apply";
    source: "new_project" | "empty_folder" | "active_repo";
    folderPath?: string;
    displayName?: string;
    targetRepoId?: string;
    targetRepoName?: string;
  } | null;
  createBlankProject: () => void;
  createProjectFromStarter: (starterId: ProjectStarterId) => void;
  dismissProjectSetupDialog: () => void;
  openStarterDialogForActiveProject: () => void;
  activeProjectIsBlank: boolean;
  activeStarterId: ProjectStarterId | null;
  openWork: () => void;
  openRecentPath: (path: string, label?: string) => void;
  activateRepo: (repoId: string) => void;
  syncProject: (repoId: string) => void;
  githubOwner: string;
  setGithubOwner: (value: string) => void;
  githubRepo: string;
  setGithubRepo: (value: string) => void;
  connectGithubProject: () => void;
  isActing: boolean;
  actionMessage: string | null;
  syncingRepoId: string | null;
  isConnectingLocal: boolean;
  isBootstrappingProject: boolean;
  isConnectingGithub: boolean;
  blueprint: ProjectBlueprint | null;
  updateBlueprint: (patch: Partial<ProjectBlueprint>) => void;
  regenerateBlueprint: () => void;
  isRefreshingBlueprint: boolean;
  labsMode: boolean;
}) {
  const [showGithub, setShowGithub] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  type ProjectsTab = "my_projects" | "connect_new";
  const [projectsTab, setProjectsTab] = useState<ProjectsTab>("my_projects");
  const [showBlueprint, setShowBlueprint] = useState(false);
  const workspaceActivityKind =
    isRefreshingBlueprint
      ? "blueprint"
      : syncingRepoId
      ? "routing"
      : isConnectingGithub
      ? "provider"
      : isBootstrappingProject
      ? "mutation"
      : isConnectingLocal
      ? "repo"
      : actionMessage && /(failed|error|timeout)/i.test(actionMessage)
      ? "verifying"
      : "telemetry";

  useEffect(() => {
    if (projectSetupState) {
      setProjectDialogOpen(true);
      return;
    }
    setProjectDialogOpen(false);
  }, [projectSetupState]);

  const recommendedStarter = useMemo(
    () => projectStarters.find((starter) => starter.recommended) || null,
    [projectStarters]
  );
  const emptyFolderSetup = projectSetupState?.source === "empty_folder" && projectSetupState.mode === "create";
  const projectDialogTitle =
    projectSetupState?.mode === "apply"
      ? `Apply a starter to ${projectSetupState.targetRepoName || "this repo"}`
      : emptyFolderSetup
      ? "Set up this empty folder"
      : "Create a new project";
  const projectDialogDescription =
    projectSetupState?.mode === "apply"
      ? "Pick a starter to add structure without changing the repo connection."
      : emptyFolderSetup
      ? "This folder is empty. Start blank or apply a starter before you switch back to Work."
      : "Create a blank managed repo first, or start with a focused starter.";

  function handleProjectDialogOpenChange(open: boolean) {
    setProjectDialogOpen(open);
    if (!open && projectSetupState?.source !== "empty_folder") {
      dismissProjectSetupDialog();
    }
  }

  return (
    <div className="space-y-4">
      <Dialog open={projectDialogOpen} onOpenChange={handleProjectDialogOpenChange}>
        <DialogContent className="max-w-3xl border-white/10 bg-[#121216] text-zinc-100">
          <DialogHeader>
            <DialogTitle>{projectDialogTitle}</DialogTitle>
            <DialogDescription className="text-zinc-400">{projectDialogDescription}</DialogDescription>
          </DialogHeader>

          {projectSetupState?.folderPath ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-zinc-400">
              Target folder: <span className="font-mono text-zinc-200">{projectSetupState.folderPath}</span>
            </div>
          ) : null}

          {projectSetupState?.mode === "create" ? (
            <button
              onClick={createBlankProject}
              disabled={isActing}
              className="w-full rounded-2xl border border-cyan-500/20 bg-cyan-500/8 p-4 text-left transition hover:border-cyan-400/30 hover:bg-cyan-500/12 disabled:opacity-60"
            >
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-cyan-300">
                Blank Project
                <Chip variant="subtle" className="text-[10px]">
                  Recommended
                </Chip>
              </div>
              <div className="mt-2 text-base font-medium text-white">Create a managed Git repo with no stack assumptions</div>
              <div className="mt-1 text-sm text-zinc-300">
                Initialize the repo, keep the folder generic, and decide on architecture or tooling later from Work.
              </div>
            </button>
          ) : null}

          <div className="space-y-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              {projectSetupState?.mode === "apply" ? "Available starters" : "Optional starters"}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {projectStarters.map((starter) => (
                <button
                  key={starter.id}
                  onClick={() => createProjectFromStarter(starter.id)}
                  disabled={isActing}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-white/20 hover:bg-white/[0.06] disabled:opacity-60"
                >
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                    {starter.kind === "generic" ? "Generic starter" : "Stack starter"}
                    {recommendedStarter?.id === starter.id ? (
                      <Chip variant="subtle" className="text-[10px]">
                        Recommended starter
                      </Chip>
                    ) : null}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-base font-medium text-white">
                    {starter.label}
                    <Sparkles className="h-4 w-4 text-cyan-300" />
                  </div>
                  <div className="mt-1 text-sm text-zinc-300">{starter.description}</div>
                  <div className="mt-3 text-xs text-zinc-500">
                    {starter.verificationMode === "commands"
                      ? "Runs starter-specific verification after scaffolding."
                      : "Adds minimal files only, with no package-manager or build assumptions."}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex items-center gap-1 rounded-lg bg-zinc-900/50 p-1 border border-white/5">
        {([
          { key: "my_projects" as const, label: "My Projects" },
          { key: "connect_new" as const, label: "Connect New" },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setProjectsTab(tab.key)}
            className={`flex-1 py-2 rounded-md text-xs font-medium transition-colors ${
              projectsTab === tab.key ? "bg-white/[0.08] text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {projectsTab === "my_projects" && (
        <>
          {activeRepo ? (
            <Panel>
              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-white">{activeRepo.displayName}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span>{activeRepo.branch || activeRepo.defaultBranch || "main"}</span>
                      <span>·</span>
                      <span>{activeRepo.sourceKind.replace(/_/g, " ")}</span>
                      <Chip variant="subtle" className="text-[10px]">
                        {starterLabel(activeStarterId)}
                      </Chip>
                    </div>
                  </div>
                  <Chip variant="ok">Active</Chip>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={openWork}
                    className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/30"
                  >
                    Go to Work
                  </button>
                  <button
                    onClick={() => syncProject(activeRepo.id)}
                    disabled={Boolean(syncingRepoId)}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-zinc-200 hover:bg-white/[0.08] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/20"
                  >
                    {syncingRepoId === activeRepo.id ? (
                      <ProcessingIndicator kind="repo" active size="xs" tone="accent" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    {syncingRepoId === activeRepo.id ? "Syncing..." : "Refresh"}
                  </button>
                  {activeProjectIsBlank ? (
                    <button
                      onClick={openStarterDialogForActiveProject}
                      disabled={isActing}
                      className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-zinc-200 hover:bg-white/[0.08] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/30"
                    >
                      Apply Starter
                    </button>
                  ) : null}
                  {(activeRepo || blueprint) ? (
                    <button
                      onClick={() => setShowBlueprint((v) => !v)}
                      className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-zinc-200 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/20"
                    >
                      {showBlueprint ? "Hide Blueprint" : "View Blueprint"}
                    </button>
                  ) : null}
                </div>
              </div>
            </Panel>
          ) : (
            <div className="rounded-xl border border-dashed border-white/10 p-8 text-center">
              <div className="text-sm text-zinc-400">No active project</div>
              <div className="mt-1 text-xs text-zinc-600">
                Connect or create a project from the "Connect New" tab.
              </div>
              <button
                onClick={() => setProjectsTab("connect_new")}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
              >
                <Plus className="h-4 w-4" />
                Connect a project
              </button>
            </div>
          )}

          {showBlueprint && (activeRepo || blueprint || projectSetupState) ? (
            <ProjectBlueprintPanel
              blueprint={blueprint}
              hasActiveRepo={Boolean(activeRepo)}
              isActing={isActing}
              onUpdate={updateBlueprint}
              onRegenerate={regenerateBlueprint}
              compact={false}
            />
          ) : null}

          {recentRepos.length > 0 && (
            <div className="space-y-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Recent projects</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {recentRepos.map((repo) => (
                  <div key={repo.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white truncate">{repo.displayName}</div>
                      <div className="mt-0.5 text-xs text-zinc-500">{repo.branch || repo.defaultBranch || "main"}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {repo.active ? <Chip variant="ok" className="text-[10px]">active</Chip> : null}
                      <button
                        onClick={() => activateRepo(repo.id)}
                        className="rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/30"
                      >
                        Open
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {recentRepoPaths.length > 0 && (
            <div className="space-y-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Recent local folders</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {recentRepoPaths.slice(0, 6).map((item) => (
                  <button
                    key={item.path}
                    onClick={() => openRecentPath(item.path, item.label)}
                    className="rounded-lg border border-white/10 bg-zinc-950/40 px-3 py-3 text-left hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/20"
                  >
                    <div className="text-sm text-white truncate">{item.label}</div>
                    <div className="text-xs text-zinc-500 truncate">{item.path}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {projectsTab === "connect_new" && (
        <Panel>
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={chooseLocalRepo}
                disabled={isActing}
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/30"
              >
                {isConnectingLocal ? <ProcessingIndicator kind="repo" active size="xs" tone="accent" /> : <FolderGit2 className="h-4 w-4" />}
                {isConnectingLocal ? "Opening Repo..." : "Choose Local Repo"}
              </button>
              <button
                onClick={openNewProjectDialog}
                disabled={isActing}
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/30"
              >
                {isBootstrappingProject ? "Working..." : "New Project"}
              </button>
              <button
                onClick={() => setShowGithub((value) => !value)}
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-zinc-300 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/20"
              >
                {isConnectingGithub ? <ProcessingIndicator kind="repo" active size="xs" tone="subtle" /> : <Github className="h-4 w-4" />}
                {showGithub ? "Hide GitHub" : "Connect GitHub Repo"}
              </button>
            </div>

            {actionMessage ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03]">
                    <ProcessingIndicator
                      kind={workspaceActivityKind}
                      active={Boolean(isConnectingLocal || isConnectingGithub || isBootstrappingProject || isRefreshingBlueprint || syncingRepoId)}
                      size="xs"
                      tone="subtle"
                      className="border-0 bg-transparent p-0"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Activity</div>
                    <div className="mt-1 text-sm text-zinc-200">{actionMessage}</div>
                  </div>
                </div>
              </div>
            ) : null}

            {repoPickerMessage ? (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 p-3 text-xs text-amber-100">{repoPickerMessage}</div>
            ) : !hasDesktopPicker ? (
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs text-zinc-400">
                Browser preview is limited. Use the desktop app for the repo picker and full local task execution.
              </div>
            ) : null}

            {emptyFolderSetup ? (
              <div className="rounded-xl border border-purple-500/20 bg-purple-500/8 p-4">
                <div className="text-sm font-medium text-white">This folder is empty</div>
                <div className="mt-1 text-xs text-zinc-300">
                  Start blank or apply a starter here.
                </div>
                <button
                  onClick={() => setProjectDialogOpen(true)}
                  disabled={isActing}
                  className="mt-3 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/30"
                >
                  Open New Project Flow
                </button>
              </div>
            ) : null}

            {showGithub && labsMode ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                <div className="text-sm font-medium text-white">GitHub Repo</div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <input
                    value={githubOwner}
                    onChange={(event) => setGithubOwner(event.target.value)}
                    placeholder="owner"
                    className="rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                  />
                  <input
                    value={githubRepo}
                    onChange={(event) => setGithubRepo(event.target.value)}
                    placeholder="repo"
                    className="rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                  />
                </div>
                <button
                  onClick={connectGithubProject}
                  disabled={isActing || !githubOwner.trim() || !githubRepo.trim()}
                  className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/30"
                >
                  Connect GitHub Repo
                </button>
              </div>
            ) : showGithub ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-400">
                GitHub App connection requires Developer Labs mode to be enabled in Settings.
              </div>
            ) : null}
          </div>
        </Panel>
      )}
    </div>
  );
}

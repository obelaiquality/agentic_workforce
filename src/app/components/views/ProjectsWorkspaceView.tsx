import { useState } from "react";
import { FolderGit2, Github, RefreshCw } from "lucide-react";
import { Chip, Panel, PanelHeader } from "../UI";
import type { ProjectBlueprint, RepoRegistration } from "../../../shared/contracts";
import type { RecentRepoPath } from "../../lib/desktopBridge";
import { ProjectBlueprintPanel } from "../mission/ProjectBlueprintPanel";
import { ProcessingIndicator } from "../ui/processing-indicator";

export function ProjectsWorkspaceView({
  activeRepo,
  recentRepos,
  recentRepoPaths,
  hasDesktopPicker,
  repoPickerMessage,
  chooseLocalRepo,
  startNewProject,
  newProjectTemplate,
  setNewProjectTemplate,
  initializeNewProject,
  pendingBootstrap,
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
  startNewProject: () => void;
  newProjectTemplate: "typescript_vite_react";
  setNewProjectTemplate: (template: "typescript_vite_react") => void;
  initializeNewProject: () => void;
  pendingBootstrap: { folderPath: string; suggestedTemplate: "typescript_vite_react"; displayName?: string } | null;
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

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel>
          <PanelHeader title="Connect Repo">
            <Chip variant="subtle">Local-first</Chip>
          </PanelHeader>
          <div className="p-4 space-y-4">
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/8 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/15 bg-cyan-500/[0.08]">
                  <img src="/assets/focus-reticle.svg" alt="" className="h-5 w-5 opacity-85" aria-hidden="true" />
                </div>
                <div>
                  <div className="text-sm font-medium text-white">Plug in your own repo</div>
                  <div className="mt-1 text-xs text-zinc-400">
                    Choose a local Git repo. The app works in a safe linked copy and keeps your original repo untouched.
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={chooseLocalRepo}
                  disabled={isActing}
                  className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
                >
                  {isConnectingLocal ? <ProcessingIndicator kind="repo" active size="xs" tone="accent" /> : <FolderGit2 className="h-4 w-4" />}
                  {isConnectingLocal ? "Opening Repo..." : "Choose Local Repo"}
                </button>
                <div className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5">
                  <select
                    value={newProjectTemplate}
                    onChange={(event) => setNewProjectTemplate(event.target.value as "typescript_vite_react")}
                    className="bg-transparent px-2 py-1 text-xs text-zinc-200 outline-none"
                  >
                    <option value="typescript_vite_react">TypeScript App</option>
                  </select>
                  <button
                    onClick={startNewProject}
                    disabled={isActing}
                    className="rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
                  >
                    {isBootstrappingProject ? "Initializing..." : "New Project"}
                  </button>
                </div>
                <button
                  onClick={() => setShowGithub((value) => !value)}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-zinc-300 hover:bg-white/[0.08]"
                >
                  {isConnectingGithub ? <ProcessingIndicator kind="repo" active size="xs" tone="subtle" /> : <Github className="h-4 w-4" />}
                  {showGithub ? "Hide GitHub" : "Connect GitHub Repo"}
                </button>
              </div>
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
                    <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Workspace activity</div>
                    <div className="mt-1 text-sm text-zinc-200">{actionMessage}</div>
                  </div>
                </div>
              </div>
            ) : null}

            {repoPickerMessage ? (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 p-3 text-xs text-amber-100">{repoPickerMessage}</div>
            ) : !hasDesktopPicker ? (
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs text-zinc-400">
                Repo picker is available in the desktop app. In browser preview, open a recent repo or use the desktop window.
              </div>
            ) : null}

            {pendingBootstrap ? (
              <div className="rounded-xl border border-purple-500/20 bg-purple-500/8 p-4">
                <div className="text-sm font-medium text-white">Initialize new TypeScript project</div>
                <div className="mt-1 text-xs text-zinc-300">
                  Empty folder detected. Initialize Git, create the scaffold, and run lint, tests, and build.
                </div>
                <button
                  onClick={initializeNewProject}
                  disabled={isActing}
                  className="mt-3 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
                >
                  Initialize New Project
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
                  className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
                >
                  Connect GitHub Repo
                </button>
              </div>
            ) : showGithub ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-400">
                GitHub App connection is the intended path here. Raw owner/repo entry stays hidden unless Developer Labs is enabled.
              </div>
            ) : null}

            {recentRepoPaths.length ? (
              <div>
                <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-zinc-500">Recent local folders</div>
                <div className="space-y-2">
                  {recentRepoPaths.slice(0, 5).map((item) => (
                    <button
                      key={item.path}
                      onClick={() => openRecentPath(item.path, item.label)}
                      className="w-full rounded-lg border border-white/10 bg-zinc-950/40 px-3 py-3 text-left hover:bg-white/[0.04]"
                    >
                      <div className="text-sm text-white truncate">{item.label}</div>
                      <div className="text-xs text-zinc-500 truncate">{item.path}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Active Project">
            <Chip variant={activeRepo ? "ok" : "subtle"}>{activeRepo ? "active" : "none"}</Chip>
          </PanelHeader>
          <div className="p-4 space-y-3">
            {activeRepo ? (
              <>
                <div>
                  <div className="text-lg font-semibold text-white">{activeRepo.displayName}</div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {activeRepo.branch || activeRepo.defaultBranch || "main"} · {activeRepo.sourceKind.replace(/_/g, " ")}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs text-zinc-400">
                  The project is warm and ready. Open it from the header switcher or ask the overseer for the next change.
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => syncProject(activeRepo.id)}
                    disabled={Boolean(syncingRepoId)}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-zinc-200 hover:bg-white/[0.08] disabled:opacity-60"
                  >
                    {syncingRepoId === activeRepo.id ? (
                      <ProcessingIndicator kind="repo" active size="xs" tone="accent" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    {syncingRepoId === activeRepo.id ? "Syncing..." : activeRepo.sourceKind === "github_app_bound" ? "Sync" : "Refresh"}
                  </button>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/[0.015] px-4 py-3">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                    <img src="/assets/live-orbit.svg" alt="" className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
                    Project state
                  </div>
                  <div className="mt-2 text-xs text-zinc-400">
                    {syncingRepoId === activeRepo.id
                      ? "Refreshing remote metadata and project timestamps."
                      : activeRepo.sourceKind === "github_app_bound"
                      ? "Use Sync to fetch the latest remote state and refresh project metadata."
                      : "Use Refresh to update project metadata after local changes or reconnects."}
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 p-6 text-sm text-zinc-500">No project is active yet.</div>
            )}
          </div>
        </Panel>
      </div>

      <ProjectBlueprintPanel
        blueprint={blueprint}
        hasActiveRepo={Boolean(activeRepo)}
        isActing={isActing}
        onUpdate={updateBlueprint}
        onRegenerate={regenerateBlueprint}
        compact={false}
      />

      <Panel>
        <PanelHeader title="Recent Projects">
          <Chip variant="subtle">{recentRepos.length}</Chip>
        </PanelHeader>
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {recentRepos.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 p-6 text-sm text-zinc-500">No connected projects yet.</div>
          ) : (
            recentRepos.map((repo) => (
              <div key={repo.id} className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div>
                  <div className="text-sm font-medium text-white truncate">{repo.displayName}</div>
                  <div className="mt-1 text-xs text-zinc-500">{repo.branch || repo.defaultBranch || "main"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Chip variant={repo.active ? "ok" : "subtle"} className="text-[10px]">
                    {repo.active ? "active" : "warm"}
                  </Chip>
                  <span className="text-[10px] uppercase tracking-wide text-zinc-600">{repo.sourceKind.replace(/_/g, " ")}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => activateRepo(repo.id)} className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-medium text-white hover:bg-cyan-500">Open</button>
                  <button
                    onClick={() => syncProject(repo.id)}
                    disabled={Boolean(syncingRepoId)}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300 hover:bg-white/[0.08] disabled:opacity-60"
                  >
                    {syncingRepoId === repo.id ? (
                      <ProcessingIndicator kind="repo" active size="xs" tone="subtle" />
                    ) : null}
                    {syncingRepoId === repo.id ? "Syncing..." : repo.sourceKind === "github_app_bound" ? "Sync" : "Refresh"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}

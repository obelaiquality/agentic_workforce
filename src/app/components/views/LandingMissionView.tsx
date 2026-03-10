import { ArrowRight, FolderClock, FolderGit2, Github, ScrollText, ShieldCheck, Sparkles, TestTube2 } from "lucide-react";
import { Chip, Panel } from "../UI";
import type { RecentRepoPath } from "../../lib/desktopBridge";
import type { ProjectBlueprint, RepoRegistration } from "../../../shared/contracts";

export function LandingMissionView({
  chooseLocalRepo,
  startNewProject,
  newProjectTemplate,
  setNewProjectTemplate,
  initializeNewProject,
  openProjects,
  openRecentPath,
  recentRepoPaths,
  recentProjects,
  activateRepo,
  hasDesktopPicker,
  repoPickerMessage,
  pendingBootstrap,
  isActing,
  blueprint,
}: {
  chooseLocalRepo: () => void;
  startNewProject: () => void;
  newProjectTemplate: "typescript_vite_react";
  setNewProjectTemplate: (template: "typescript_vite_react") => void;
  initializeNewProject: () => void;
  openProjects: () => void;
  openRecentPath: (path: string, label?: string) => void;
  recentRepoPaths: RecentRepoPath[];
  recentProjects: RepoRegistration[];
  activateRepo: (repoId: string) => void;
  hasDesktopPicker: boolean;
  repoPickerMessage: string | null;
  pendingBootstrap: { folderPath: string; suggestedTemplate: "typescript_vite_react"; displayName?: string } | null;
  isActing: boolean;
  blueprint?: ProjectBlueprint | null;
}) {
  return (
    <div className="space-y-4">
      <Panel className="border-white/5 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_24%),radial-gradient(circle_at_top_right,rgba(168,85,247,0.12),transparent_22%),#121214]">
        <div className="p-6 md:p-8 lg:p-10 grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,420px)]">
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.28em] text-zinc-500">
                <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                Mission Control
              </div>
              <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-white md:text-4xl">
                Connect a repo, set the objective, and ship verified changes.
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-zinc-400 md:text-base">
                The Overseer plans the route, builds the context pack, runs the change, and proves the outcome with tests, docs, and approval-aware execution.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={chooseLocalRepo}
                disabled={isActing}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-5 py-3 text-sm font-medium text-white shadow-[0_0_24px_rgba(6,182,212,0.18)] hover:bg-cyan-500 disabled:opacity-50"
              >
                <FolderGit2 className="h-4 w-4" />
                Connect Local Repo
              </button>
              <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <select
                  value={newProjectTemplate}
                  onChange={(event) => setNewProjectTemplate(event.target.value as "typescript_vite_react")}
                  className="bg-transparent text-sm text-zinc-200 outline-none"
                >
                  <option value="typescript_vite_react">TypeScript App</option>
                </select>
                <button
                  onClick={startNewProject}
                  disabled={isActing}
                  className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
                >
                  New Project
                </button>
              </div>
              <button
                onClick={openProjects}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-3 text-sm text-zinc-200 hover:bg-white/[0.08]"
              >
                <Github className="h-4 w-4" />
                Connect GitHub Repo
              </button>
            </div>

            {repoPickerMessage ? (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-sm text-amber-100">
                {repoPickerMessage}
              </div>
            ) : !hasDesktopPicker ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-400">
                Native repo picking is available in the desktop app. In browser preview, open the Electron window or reopen a recent repo.
              </div>
            ) : null}

            {pendingBootstrap ? (
              <div className="rounded-xl border border-purple-500/20 bg-purple-500/8 px-4 py-4">
                <div className="text-sm font-medium text-white">Initialize new TypeScript project</div>
                <div className="mt-1 text-xs text-zinc-300">
                  Empty folder detected. The app can initialize Git, scaffold a TypeScript app, and run lint, tests, and build.
                </div>
                <button
                  onClick={initializeNewProject}
                  disabled={isActing}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
                >
                  Initialize New Project
                </button>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <ProofCard
                icon={<Sparkles className="h-4 w-4 text-purple-400" />}
                title="Route"
                body="Pick the right lane first: Fast, Build, Review, or Escalate."
              />
              <ProofCard
                icon={<TestTube2 className="h-4 w-4 text-cyan-300" />}
                title="Verify"
                body="Tie execution to tests, impacted checks, and doc policy."
              />
              <ProofCard
                icon={<ShieldCheck className="h-4 w-4 text-emerald-400" />}
                title="Prove"
                body="Ship shareable evidence instead of hand-wavy agent output."
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-5 shadow-2xl shadow-black/40">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">How it works</div>
                  <div className="mt-1 text-lg font-medium text-white">One clean operator flow</div>
                </div>
                <Chip variant="subtle" className="text-[10px]">local-first</Chip>
              </div>
              <div className="mt-4 space-y-3">
                {[
                  "Connect repo",
                  "Confirm project blueprint",
                  "Ask Overseer for the change",
                  "Review route + context pack",
                  "Execute and inspect evidence",
                ].map((step, index) => (
                  <div key={step} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full border border-cyan-500/20 bg-cyan-500/10 text-xs font-medium text-cyan-200">
                      {index + 1}
                    </div>
                    <div className="text-sm text-zinc-200">{step}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                <FolderClock className="h-3.5 w-3.5 text-cyan-300" />
                Open Recent
              </div>
              {recentProjects.length ? (
                <div className="mt-3 space-y-2">
                  {recentProjects.slice(0, 4).map((repo) => (
                    <button
                      key={repo.id}
                      onClick={() => activateRepo(repo.id)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-left hover:bg-white/[0.05]"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">{repo.displayName}</div>
                        <div className="truncate text-xs text-zinc-500">{repo.branch || repo.defaultBranch || "main"}</div>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-zinc-500" />
                    </button>
                  ))}
                </div>
              ) : recentRepoPaths.length ? (
                <div className="mt-3 space-y-2">
                  {recentRepoPaths.slice(0, 4).map((item) => (
                    <button
                      key={item.path}
                      onClick={() => openRecentPath(item.path, item.label)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-left hover:bg-white/[0.05]"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">{item.label}</div>
                        <div className="truncate text-xs text-zinc-500">{item.path}</div>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-zinc-500" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-dashed border-white/10 px-4 py-6 text-sm text-zinc-500">
                  No recent repos yet. Connect one local repo and it will appear here.
                </div>
              )}
            </div>
          </div>
        </div>
      </Panel>

      {blueprint ? (
        <Panel className="border-white/10">
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-zinc-500">
              <ScrollText className="h-3.5 w-3.5 text-purple-400" />
              Project Blueprint
              <Chip variant="ok" className="text-[10px]">v{blueprint.version}</Chip>
            </div>
            <div className="text-sm text-white">{blueprint.charter.productIntent}</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-white/10 bg-zinc-950/40 px-3 py-2">
                <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <TestTube2 className="h-3 w-3 text-cyan-300" />
                  {blueprint.testingPolicy.requiredForBehaviorChange ? "Tests required" : "Tests optional"}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-zinc-950/40 px-3 py-2">
                <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <ScrollText className="h-3 w-3 text-purple-400" />
                  {blueprint.documentationPolicy.updateUserFacingDocs ? "Docs expected" : "Docs optional"}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-zinc-950/40 px-3 py-2">
                <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <ShieldCheck className="h-3 w-3 text-emerald-400" />
                  Escalation: {blueprint.providerPolicy.escalationPolicy.replace(/_/g, " ")}
                </div>
              </div>
            </div>
            {blueprint.charter.successCriteria.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {blueprint.charter.successCriteria.slice(0, 4).map((item) => (
                  <span key={item} className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-zinc-400">
                    {item}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Panel>
      ) : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <FooterStrip title="Project Blueprint" body="Repo rules, test policy, docs policy, and charter become one operating contract." icon={<ScrollText className="h-4 w-4 text-purple-400" />} />
        <FooterStrip title="Context Pack" body="Small models do targeting, impact, and summarization before the coding model edits." icon={<Sparkles className="h-4 w-4 text-cyan-300" />} />
        <FooterStrip title="Verified Output" body="Runs end with verification, approvals, and a shareable report instead of opaque agent chatter." icon={<ShieldCheck className="h-4 w-4 text-emerald-400" />} />
      </div>
    </div>
  );
}

function ProofCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-white">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-400">{body}</p>
    </div>
  );
}

function FooterStrip({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.015] px-4 py-4">
      <div className="flex items-center gap-2 text-sm font-medium text-white">
        {icon}
        {title}
      </div>
      <div className="mt-2 text-xs leading-5 text-zinc-500">{body}</div>
    </div>
  );
}

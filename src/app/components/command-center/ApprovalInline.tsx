import {
  ArrowRight,
  CheckCircle2,
  FolderGit2,
  Sparkles,
} from "lucide-react";
import type { MissionData } from "./types";
import { cn } from "../ui/utils";
import { Panel } from "../UI";

export interface ApprovalInlineProps {
  recentProjects: MissionData["recentRepos"];
  recentRepoPaths: MissionData["recentRepoPaths"];
  activateRepo: MissionData["activateRepo"];
  openRecentPath: MissionData["connectRecentPath"];
  openProjects: MissionData["openProjects"];
  appMode: MissionData["appMode"];
  appModeNotice: MissionData["appModeNotice"];
}

/**
 * WorkEmptyState — shown when no project is active. Provides
 * onboarding guidance, recent project links, and the connect
 * repo action.
 */
export function ApprovalInline({
  recentProjects,
  recentRepoPaths,
  activateRepo,
  openRecentPath,
  openProjects,
  appMode,
  appModeNotice,
}: ApprovalInlineProps) {
  return (
    <div data-testid="work-empty-state" className="flex flex-col items-center justify-center gap-8 py-12">
      <div className="flex flex-col items-center gap-4 text-center">
        <img src="/assets/agentic-workforce-shell.svg" alt="" className="h-12 w-12 opacity-60" aria-hidden="true" />
        <div className="space-y-2">
          <h2 className="text-xl font-semibold tracking-tight text-white">Welcome to Agentic Workforce</h2>
          <p className="max-w-md text-sm text-zinc-400">Your local AI coding agent. Connect a repo, describe a task, and let the agent handle the rest.</p>
        </div>
      </div>

      <div className="grid w-full max-w-lg grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col items-center gap-2 rounded-xl border border-white/6 bg-white/[0.02] px-4 py-5 text-center">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-500/10">
            <FolderGit2 className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="text-xs font-medium text-zinc-200">Connect</div>
          <div className="text-[11px] text-zinc-500">Link a local repo</div>
        </div>
        <div className="flex flex-col items-center gap-2 rounded-xl border border-white/6 bg-white/[0.02] px-4 py-5 text-center">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-500/10">
            <Sparkles className="h-4 w-4 text-violet-400" />
          </div>
          <div className="text-xs font-medium text-zinc-200">Describe</div>
          <div className="text-[11px] text-zinc-500">Write a task prompt</div>
        </div>
        <div className="flex flex-col items-center gap-2 rounded-xl border border-white/6 bg-white/[0.02] px-4 py-5 text-center">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="text-xs font-medium text-zinc-200">Verify</div>
          <div className="text-[11px] text-zinc-500">Review proven output</div>
        </div>
      </div>

      <button
        data-testid="work-connect-repo"
        type="button"
        onClick={openProjects}
        className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white shadow-[0_0_18px_rgba(6,182,212,0.16)] transition hover:bg-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-400/30"
      >
        <FolderGit2 className="h-4 w-4" />
        Connect a repo
      </button>

      {(recentProjects.length > 0 || recentRepoPaths.length > 0) ? (
        <div className="w-full max-w-lg space-y-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500 px-1">Recent projects</div>
          {recentProjects.slice(0, 3).map((repo) => (
            <button
              key={repo.id}
              onClick={() => activateRepo(repo.id)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/6 bg-white/[0.02] px-4 py-2.5 text-left transition hover:bg-white/[0.05]"
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-zinc-200">{repo.displayName}</div>
                <div className="truncate text-[11px] text-zinc-500">{repo.branch || repo.defaultBranch || "main"}</div>
              </div>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
            </button>
          ))}
          {!recentProjects.length && recentRepoPaths.slice(0, 3).map((item) => (
            <button
              key={item.path}
              onClick={() => openRecentPath(item.path, item.label)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/6 bg-white/[0.02] px-4 py-2.5 text-left transition hover:bg-white/[0.05]"
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-zinc-200">{item.label}</div>
                <div className="truncate text-[11px] text-zinc-500">{item.path}</div>
              </div>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
            </button>
          ))}
        </div>
      ) : null}

      {appModeNotice ? (
        <div className={cn(
          "w-full max-w-lg rounded-xl border px-4 py-3",
          appMode === "backend_unavailable" ? "border-rose-500/20 bg-rose-500/10" : "border-amber-500/20 bg-amber-500/10"
        )}>
          <div className="text-sm text-white">{appModeNotice.message}</div>
          <div className="mt-1 text-xs text-zinc-400">{appModeNotice.detail}</div>
        </div>
      ) : null}
    </div>
  );
}

/** Utility small-metric display used in various panels. */
export function SmallMetric({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const className =
    "inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#161618] px-3 py-1.5 text-[10px] uppercase tracking-[0.12em] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]";

  if (!onClick) {
    return (
      <div className={`${className} text-zinc-300`}>
        <span className="text-zinc-500">{icon}</span>
        <span>{label}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${className} text-zinc-300 transition hover:border-cyan-400/18 hover:bg-cyan-500/[0.08] hover:text-cyan-100 disabled:cursor-not-allowed disabled:text-zinc-600 disabled:hover:border-white/10 disabled:hover:bg-[#161618] disabled:hover:text-zinc-600`}
    >
      <span className={disabled ? "text-zinc-700" : "text-zinc-500"}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

/** Simple list display for file/test/doc paths. */
export function DetailBlock({ label, items, empty }: { label: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-[18px] border border-white/8 bg-black/20 p-3">
      <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{label}</div>
      {items.length ? (
        <ul className="mt-2 space-y-1 text-xs text-zinc-300">
          {items.map((item, index) => (
            <li key={`${label}-${index}`} className="truncate">
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-2 text-xs text-zinc-500">{empty}</div>
      )}
    </div>
  );
}

/** Proof card for verification/outcome display. */
export function ProofCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <Panel className="border-white/8">
      <div className="p-4">
        <div className="flex items-center gap-2 text-white text-sm font-medium">
          {icon}
          {title}
        </div>
        <div className="mt-2 text-xs leading-5 text-zinc-400">{body}</div>
      </div>
    </Panel>
  );
}

import { Activity, FolderGit2, RefreshCw, Sparkles, Square } from "lucide-react";
import { Chip } from "../UI";
import type { ExecutionRunSummary, MissionActionCapabilities, RepoRegistration, RoutingDecision } from "../../../shared/contracts";
import { executionModeLabel, modelRoleLabel, providerLabel } from "../../lib/missionLabels";

function liveStateLabel(state: "loading" | "live" | "degraded" | "disconnected" | "recovering") {
  if (state === "live") return { label: "LIVE", variant: "ok" as const };
  if (state === "degraded") return { label: "DEGRADED", variant: "warn" as const };
  if (state === "recovering") return { label: "RECOVERING", variant: "warn" as const };
  if (state === "disconnected") return { label: "NO REPO", variant: "subtle" as const };
  return { label: "LOADING", variant: "subtle" as const };
}

export function MissionHeaderStrip({
  repo,
  liveState,
  route,
  runSummary,
  actionCapabilities,
  lastUpdatedAt,
  isActing,
  onRefresh,
  onStop,
}: {
  repo: RepoRegistration | null;
  liveState: "loading" | "live" | "degraded" | "disconnected" | "recovering";
  route: RoutingDecision | null;
  runSummary: ExecutionRunSummary | null;
  actionCapabilities: MissionActionCapabilities;
  lastUpdatedAt: string | null;
  isActing: boolean;
  onRefresh: () => void;
  onStop: () => void;
}) {
  const state = liveStateLabel(liveState);

  return (
    <div className="flex flex-col gap-3 px-4 py-3 rounded-xl border border-white/5 bg-white/[0.015]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-zinc-500">
            <Activity className="h-3.5 w-3.5 text-cyan-400" />
            Agentic Workforce
          </div>
          <div className="mt-1 flex items-center gap-2 min-w-0">
            <FolderGit2 className="h-4 w-4 text-cyan-300 shrink-0" />
            <h1 className="text-base font-bold text-white truncate">{repo?.displayName || "Connect a repo to begin"}</h1>
            {repo ? <Chip variant="subtle" className="text-[10px]">{repo.branch || repo.defaultBranch || "main"}</Chip> : null}
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {route
              ? `${executionModeLabel(route.executionMode)} · ${modelRoleLabel(route.modelRole)} · ${providerLabel(route.providerId)}`
              : "Connect a repo, describe the objective, then review and execute the route."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Chip variant={state.variant} className="text-[10px]">{state.label}</Chip>
          {runSummary?.status ? <Chip variant="subtle" className="text-[10px]">run {runSummary.status}</Chip> : null}
          {route ? <Chip variant="subtle" className="text-[10px]">{route.verificationDepth} verify</Chip> : null}
          {actionCapabilities.canRefresh ? (
            <button
              onClick={onRefresh}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/[0.08]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isActing ? "animate-spin" : ""}`} />
              Refresh
            </button>
          ) : null}
          {actionCapabilities.canStop && (runSummary?.status === "queued" || runSummary?.status === "running") ? (
            <button
              onClick={onStop}
              className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500"
            >
              <Square className="h-3.5 w-3.5" />
              Stop
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-purple-400" />
          {route ? `${Math.round((route.decompositionScore || 0) * 100)}% route confidence` : "Awaiting route review"}
        </span>
        <span className="text-zinc-700">•</span>
        <span>{lastUpdatedAt ? `updated ${new Date(lastUpdatedAt).toLocaleTimeString()}` : "not yet updated"}</span>
      </div>
    </div>
  );
}

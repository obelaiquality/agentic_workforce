import type { MissionData } from "./types";
import { Chip, Panel, PanelHeader } from "../UI";
import { ProcessingIndicator } from "../ui/processing-indicator";
import { executionModeLabel, modelRoleLabel } from "../../lib/missionLabels";

export interface DiffViewerProps {
  mission: MissionData;
  onOpenSettings: () => void;
  onOpenConsole: () => void;
}

/**
 * RouteReviewPanel — displays the current plan/route status with context
 * pack details and lifecycle stage information.
 *
 * Note: this component was defined in the original monolith but is not
 * currently rendered in the main layout. It is preserved here so that
 * existing or future callers can import it without loss of functionality.
 */
export function DiffViewer({
  mission,
  onOpenSettings,
  onOpenConsole,
}: DiffViewerProps) {
  const route = mission.route;
  const contextPack = mission.contextPack;
  const hasRouteContext = Boolean(route && contextPack);
  const selectedTicketStatus = mission.selectedTicket?.status ?? null;
  const currentStage = mission.isExecuting
    ? "build"
    : mission.isReviewing
    ? "scope"
    : selectedTicketStatus === "done"
    ? "complete"
    : selectedTicketStatus === "review"
    ? "review"
    : hasRouteContext
    ? "build"
    : "scope";
  const routeConfidence = route
    ? Math.round(((route.metadata?.confidence as number | undefined) || contextPack?.confidence || 0.68) * 100)
    : Math.round((contextPack?.confidence || 0.38) * 100);
  const routeStatus = mission.isExecuting
    ? "Task is running."
    : mission.isReviewing
    ? "Reviewing the plan."
    : route && contextPack
    ? "Plan is ready to run."
    : contextPack
    ? "Context is ready."
    : "Review the plan to generate context and a route.";
  const stageHint =
    currentStage === "scope"
      ? "We turn your request into a scoped backlog task before any code changes run."
      : currentStage === "build"
      ? "The plan is scoped. Run task to move the workflow into active execution."
      : currentStage === "review"
      ? "Execution needs follow-up before it can close cleanly."
      : "Verification passed and the task is ready to close.";
  const lifecycleSummary = mission.selectedExecutionProfile
    ? `${mission.selectedExecutionProfile.name} maps the Scope, Build, Review, and Escalate stages.`
    : "Choose an execution profile in Settings if you need a different lifecycle."
  const isPatchTimeout =
    (mission.actionMessage || "").toLowerCase().includes("timed out while generating patch") ||
    (mission.actionMessage || "").toLowerCase().includes("generic patch generation timed out");

  return (
    <Panel className="border-white/8 bg-[#101114]">
      <PanelHeader title="Review the Plan">
        <Chip variant="subtle" className="text-[10px]">
          {hasRouteContext ? "ready to run" : "planning"}
        </Chip>
      </PanelHeader>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-300">
          <span className="inline-flex items-center gap-2">
            {(mission.isExecuting || mission.isReviewing) ? (
              <ProcessingIndicator kind={mission.isExecuting ? "processing" : "thinking"} active size="xs" tone="subtle" />
            ) : null}
            {routeStatus}
          </span>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Chip variant="subtle" className="text-[10px]">
                {route ? `${executionModeLabel(route.executionMode)} · ${modelRoleLabel(route.modelRole)}` : "Route pending"}
              </Chip>
              <Chip variant="subtle" className="text-[10px]">
                {mission.selectedExecutionProfile ? mission.selectedExecutionProfile.name : "Profile pending"}
              </Chip>
              <Chip variant="subtle" className="text-[10px]">
                {routeConfidence}% confidence
              </Chip>
            </div>
            <div className="mt-3 text-sm text-white">{stageHint}</div>
            <div className="mt-2 text-xs text-zinc-500">{lifecycleSummary}</div>
            {contextPack ? (
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-400">
                <span>{contextPack.files.length} files</span>
                <span>·</span>
                <span>{contextPack.tests.length} tests</span>
                <span>·</span>
                <span>{contextPack.docs.length} docs</span>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-start gap-2 lg:flex-col">
            <button
              type="button"
              onClick={onOpenSettings}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-200 transition hover:bg-white/[0.08]"
            >
              Open Advanced
            </button>
            <button
              type="button"
              onClick={onOpenConsole}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-200 transition hover:bg-white/[0.08]"
            >
              Open Console
            </button>
          </div>
        </div>

        {mission.actionMessage ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-zinc-300">
            <div>{mission.actionMessage}</div>
            {isPatchTimeout ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={mission.executeRoute}
                  disabled={mission.isActing || !mission.input.trim() || !mission.selectedRepo}
                  className="rounded-lg border border-cyan-500/20 bg-cyan-500/8 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-cyan-200 transition hover:bg-cyan-500/14 disabled:opacity-50"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={mission.reviewRoute}
                  disabled={mission.isActing || !mission.input.trim() || !mission.selectedRepo}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-zinc-300 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
                >
                  Retry smaller scope
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

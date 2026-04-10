import { useState } from "react";
import {
  ChevronDown,
  FileSearch,
  Play,
  RotateCcw,
  Square,
} from "lucide-react";
import type { MissionData } from "./types";
import { Chip, Panel } from "../UI";
import { ProcessingIndicator } from "../ui/processing-indicator";
import { cn } from "../ui/utils";
import { executionModeLabel, modelRoleLabel, providerLabel } from "../../lib/missionLabels";
import { AgenticRunDeepPanel, RunReplayPanel } from "../agentic";
import { resumeAgenticRun } from "../../lib/apiClient";

export interface ChatPanelProps {
  mission: MissionData;
  attentionCount: number;
  onOpenCodebaseScope: (scope: "context" | "tests" | "docs") => void;
  onOpenApprovals: () => void;
}

export function ChatPanel({
  mission,
  attentionCount,
  onOpenCodebaseScope,
  onOpenApprovals,
}: ChatPanelProps) {
  const [routeExpanded, setRouteExpanded] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [refineInput, setRefineInput] = useState("");
  const [refineOpen, setRefineOpen] = useState(false);
  const [rejectInput, setRejectInput] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [answerInputs, setAnswerInputs] = useState<Record<string, string>>({});

  const route = mission.route;
  const contextPack = mission.contextPack;
  const hasInput = Boolean(mission.input.trim());
  const hasRouteContext = Boolean(route && contextPack);
  const isRunning = mission.isExecuting || mission.isReviewing;
  const primaryAction =
    !mission.selectedRepo || !hasInput || isRunning || !hasRouteContext
      ? mission.reviewRoute
      : mission.executeRoute;
  const primaryLabel = mission.isExecuting
    ? "Running..."
    : mission.isReviewing
    ? "Reviewing..."
    : !hasRouteContext
    ? "Review plan"
    : "Run task";
  const showSecondaryReview = Boolean(mission.selectedRepo && hasInput && hasRouteContext && !isRunning);
  const routeConfidence = route
    ? Math.round(((route.metadata?.confidence as number | undefined) || contextPack?.confidence || 0.68) * 100)
    : contextPack
    ? Math.round((contextPack.confidence || 0.38) * 100)
    : null;
  const routeSummaryText = hasRouteContext
    ? `Plan ready · ${routeConfidence}% · ${mission.selectedExecutionProfile?.name || "Default"}`
    : contextPack
    ? `Context ready · ${routeConfidence}%`
    : null;

  return (
    <Panel className="border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.08),transparent_24%),radial-gradient(circle_at_top_right,rgba(168,85,247,0.10),transparent_22%),#111113] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />
      <div className="space-y-3.5 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight text-white">Describe the task</h2>
          <div className="flex items-center gap-2">
            <Chip variant="subtle" className="max-w-[180px] truncate text-[10px]" title={mission.selectedRepo!.displayName}>
              {mission.selectedRepo!.displayName}
            </Chip>
            <Chip variant={attentionCount ? "warn" : "ok"} className="text-[10px]">
              {attentionCount ? `${attentionCount} attention` : "ready"}
            </Chip>
          </div>
        </div>

        <div className="overflow-hidden rounded-[22px] border border-white/10 bg-[#161618] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
          <textarea
            data-testid="work-task-input"
            value={mission.input}
            onChange={(event) => mission.setInput(event.target.value)}
            placeholder={mission.activeProjectIsBlank ? "Describe what you want to build..." : "Describe the next change..."}
            aria-label="Task objective"
            className="min-h-[112px] w-full resize-none bg-transparent px-4 py-3.5 text-[15px] leading-7 text-zinc-100 outline-none placeholder:text-zinc-600 disabled:cursor-not-allowed focus-visible:outline-none"
          />

          <div className="flex items-center justify-between gap-3 border-t border-white/6 bg-black/20 px-4 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <select
                data-testid="work-profile-selector"
                value={mission.selectedExecutionProfileId}
                onChange={(event) => mission.setExecutionProfile(event.target.value)}
                disabled={!mission.selectedRepo || mission.isUpdatingExecutionProfile}
                className="rounded-lg border border-white/10 bg-[#111113] px-2.5 py-1.5 text-xs text-zinc-300 outline-none disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-cyan-400/20"
              >
                {mission.executionProfiles.profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
              <label className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#111113] px-2.5 py-1.5 text-[11px] text-zinc-300">
                <input
                  type="checkbox"
                  checked={Boolean((mission as { planModeEnabled?: boolean }).planModeEnabled)}
                  onChange={(event) =>
                    (mission as { setPlanModeEnabled?: (value: boolean) => void }).setPlanModeEnabled?.(event.target.checked)
                  }
                  className="h-3.5 w-3.5 rounded border-white/10 bg-transparent"
                />
                Plan mode
              </label>
              <label className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#111113] px-2.5 py-1.5 text-[11px] text-zinc-300">
                <input
                  type="checkbox"
                  checked={Boolean((mission as { coordinatorEnabled?: boolean }).coordinatorEnabled)}
                  onChange={(event) =>
                    (mission as { setCoordinatorEnabled?: (value: boolean) => void }).setCoordinatorEnabled?.(event.target.checked)
                  }
                  className="h-3.5 w-3.5 rounded border-white/10 bg-transparent"
                />
                Coordinator
                <span className="text-zinc-600 text-[10px]">multi-agent</span>
              </label>
              {(mission as { coordinatorEnabled?: boolean }).coordinatorEnabled && (
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-[10px] text-zinc-500">
                    Agents
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={(mission as { coordinatorMaxAgents?: number }).coordinatorMaxAgents ?? 5}
                      onChange={(e) =>
                        (mission as { setCoordinatorMaxAgents?: (value: number) => void }).setCoordinatorMaxAgents?.(Number(e.target.value))
                      }
                      className="w-12 rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-xs text-zinc-300 outline-none focus:border-cyan-500/30"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-[10px] text-zinc-500">
                    Concurrent
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={(mission as { coordinatorMaxConcurrent?: number }).coordinatorMaxConcurrent ?? 3}
                      onChange={(e) =>
                        (mission as { setCoordinatorMaxConcurrent?: (value: number) => void }).setCoordinatorMaxConcurrent?.(Number(e.target.value))
                      }
                      className="w-12 rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-xs text-zinc-300 outline-none focus:border-cyan-500/30"
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {showSecondaryReview ? (
                <button
                  onClick={mission.reviewRoute}
                  disabled={mission.isActing || !hasInput || !mission.selectedRepo}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/[0.08] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-cyan-400/20"
                >
                  <FileSearch className="h-3.5 w-3.5" />
                  Review
                </button>
              ) : null}
              {isRunning ? (
                <button
                  onClick={mission.refreshSnapshot}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20 focus-visible:ring-2 focus-visible:ring-rose-400/30"
                >
                  <Square className="h-3 w-3" />
                  Stop
                </button>
              ) : null}
              <button
                data-testid="work-primary-action"
                onClick={primaryAction}
                disabled={mission.isActing || !hasInput || !mission.selectedRepo}
                className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-[0_0_18px_rgba(6,182,212,0.16)] hover:bg-cyan-500 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-cyan-400/30"
              >
                {isRunning ? (
                  <ProcessingIndicator kind="processing" active size="xs" tone="accent" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                {primaryLabel}
              </button>
            </div>
          </div>
        </div>

        {routeSummaryText ? (
          <div className="rounded-xl border border-white/6 bg-white/[0.02]">
            <button
              type="button"
              onClick={() => setRouteExpanded((prev) => !prev)}
              className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
            >
              <span className="text-xs text-zinc-400">{routeSummaryText}</span>
              <ChevronDown className={cn("h-3.5 w-3.5 text-zinc-500 transition-transform", routeExpanded && "rotate-180")} />
            </button>
            {routeExpanded ? (
              <div className="border-t border-white/5 px-4 py-3 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {route ? (
                    <Chip variant="subtle" className="text-[10px]">
                      {executionModeLabel(route.executionMode)} · {modelRoleLabel(route.modelRole)}
                    </Chip>
                  ) : null}
                  {route ? (
                    <Chip variant="subtle" className="text-[10px]">
                      {providerLabel(route.providerId)}
                    </Chip>
                  ) : null}
                </div>
                {contextPack ? (
                  <div className="flex flex-wrap gap-3 text-[11px] text-zinc-500">
                    <button onClick={() => onOpenCodebaseScope("context")} className="hover:text-zinc-300 transition-colors">
                      {contextPack.files.length} files
                    </button>
                    <button onClick={() => onOpenCodebaseScope("tests")} className="hover:text-zinc-300 transition-colors">
                      {contextPack.tests.length} tests
                    </button>
                    <button onClick={() => onOpenCodebaseScope("docs")} className="hover:text-zinc-300 transition-colors">
                      {contextPack.docs.length} docs
                    </button>
                    {mission.pendingApprovals.length > 0 ? (
                      <button onClick={onOpenApprovals} className="text-amber-400 hover:text-amber-300 transition-colors">
                        {mission.pendingApprovals.length} approvals pending
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {mission.agenticRun ? (
          <AgenticRunSection
            mission={mission}
            resuming={resuming}
            setResuming={setResuming}
            refineInput={refineInput}
            setRefineInput={setRefineInput}
            refineOpen={refineOpen}
            setRefineOpen={setRefineOpen}
            rejectInput={rejectInput}
            setRejectInput={setRejectInput}
            rejectOpen={rejectOpen}
            setRejectOpen={setRejectOpen}
            answerInputs={answerInputs}
            setAnswerInputs={setAnswerInputs}
          />
        ) : null}
      </div>
    </Panel>
  );
}

function AgenticRunSection({
  mission,
  resuming,
  setResuming,
  refineInput,
  setRefineInput,
  refineOpen,
  setRefineOpen,
  rejectInput,
  setRejectInput,
  rejectOpen,
  setRejectOpen,
  answerInputs,
  setAnswerInputs,
}: {
  mission: MissionData;
  resuming: boolean;
  setResuming: (v: boolean) => void;
  refineInput: string;
  setRefineInput: (v: string) => void;
  refineOpen: boolean;
  setRefineOpen: (v: boolean) => void;
  rejectInput: string;
  setRejectInput: (v: string) => void;
  rejectOpen: boolean;
  setRejectOpen: (v: boolean) => void;
  answerInputs: Record<string, string>;
  setAnswerInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const agenticRun = mission.agenticRun!;

  return (
    <div className="rounded-[20px] border border-cyan-500/10 bg-[linear-gradient(180deg,rgba(7,20,28,0.9),rgba(10,12,16,0.98))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-300/80">Agentic Run</div>
          <div className="mt-1 text-sm text-zinc-400">Tracked execution, planning, tool use, and memory activity.</div>
        </div>
        <Chip variant={agenticRun.status === "running" ? "warn" : agenticRun.status === "completed" ? "ok" : "subtle"} className="text-[10px]">
          {agenticRun.status}
        </Chip>
      </div>

      {agenticRun.phase === "plan_review" ? (
        <div className="mb-3 rounded-xl border border-amber-500/20 bg-amber-500/8 p-3">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">Plan Review</div>
          <div className="mt-2 text-sm text-amber-50">
            Review the proposed plan below, then approve to resume execution or request refinement.
          </div>
          {agenticRun.plan?.planContent && (
            <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-black/30 p-3">
              <pre className="whitespace-pre-wrap text-sm text-zinc-200 font-mono leading-relaxed">
                {agenticRun.plan.planContent}
              </pre>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => (mission as { approvePlan?: (runId: string) => void }).approvePlan?.(agenticRun.runId)}
              className="rounded-lg border border-emerald-500/20 bg-emerald-500/12 px-3 py-1.5 text-xs text-emerald-100 transition hover:bg-emerald-500/20"
            >
              Approve plan
            </button>
            {refineOpen ? (
              <div className="flex-1 min-w-[200px]">
                <textarea
                  value={refineInput}
                  onChange={(e) => setRefineInput(e.target.value)}
                  placeholder="What should change in the plan?"
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/30 focus:outline-none resize-none"
                  rows={2}
                />
                <div className="mt-1.5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (refineInput.trim()) {
                        (mission as { refinePlan?: (runId: string, feedback: string) => void }).refinePlan?.(agenticRun.runId, refineInput.trim());
                        setRefineInput("");
                        setRefineOpen(false);
                      }
                    }}
                    className="rounded-lg border border-amber-500/20 bg-amber-500/12 px-3 py-1 text-xs text-amber-100 transition hover:bg-amber-500/20"
                  >
                    Submit
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRefineOpen(false); setRefineInput(""); }}
                    className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400 transition hover:bg-white/[0.06]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setRefineOpen(true)}
                className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-white/[0.08]"
              >
                Request changes
              </button>
            )}
            {rejectOpen ? (
              <div className="flex-1 min-w-[200px]">
                <textarea
                  value={rejectInput}
                  onChange={(e) => setRejectInput(e.target.value)}
                  placeholder="Why are you rejecting this plan?"
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-rose-500/30 focus:outline-none resize-none"
                  rows={2}
                />
                <div className="mt-1.5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (rejectInput.trim()) {
                        (mission as { rejectPlan?: (runId: string, reason: string) => void }).rejectPlan?.(agenticRun.runId, rejectInput.trim());
                        setRejectInput("");
                        setRejectOpen(false);
                      }
                    }}
                    className="rounded-lg border border-rose-500/20 bg-rose-500/12 px-3 py-1 text-xs text-rose-100 transition hover:bg-rose-500/20"
                  >
                    Submit
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRejectOpen(false); setRejectInput(""); }}
                    className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400 transition hover:bg-white/[0.06]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setRejectOpen(true)}
                className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-100 transition hover:bg-rose-500/16"
              >
                Reject plan
              </button>
            )}
          </div>
        </div>
      ) : null}

      {agenticRun.phase === "planning" && agenticRun.plan?.questions.some((question) => !question.answer) ? (
        <div className="mb-3 rounded-xl border border-cyan-500/20 bg-cyan-500/8 p-3">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-200">Planning Questions</div>
          <div className="mt-3 space-y-2">
            {agenticRun.plan.questions
              .filter((question) => !question.answer)
              .map((question) => (
                <div key={question.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <div className="text-sm text-zinc-100">{question.question}</div>
                  {answerInputs[question.id] !== undefined ? (
                    <div className="mt-2">
                      <textarea
                        value={answerInputs[question.id]}
                        onChange={(e) => setAnswerInputs((prev) => ({ ...prev, [question.id]: e.target.value }))}
                        placeholder="Enter your answer"
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-500/30 focus:outline-none resize-none"
                        rows={2}
                      />
                      <div className="mt-1.5 flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (answerInputs[question.id].trim()) {
                              (mission as { answerPlanQuestion?: (runId: string, questionId: string, answer: string) => void }).answerPlanQuestion?.(
                                agenticRun.runId,
                                question.id,
                                answerInputs[question.id].trim(),
                              );
                              setAnswerInputs((prev) => {
                                const next = { ...prev };
                                delete next[question.id];
                                return next;
                              });
                            }
                          }}
                          className="rounded-lg border border-cyan-500/20 bg-cyan-500/12 px-3 py-1 text-xs text-cyan-100 transition hover:bg-cyan-500/20"
                        >
                          Submit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAnswerInputs((prev) => {
                              const next = { ...prev };
                              delete next[question.id];
                              return next;
                            });
                          }}
                          className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400 transition hover:bg-white/[0.06]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAnswerInputs((prev) => ({ ...prev, [question.id]: "" }))}
                      className="mt-2 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-100 transition hover:bg-cyan-500/16"
                    >
                      Answer
                    </button>
                  )}
                </div>
              ))}
          </div>
        </div>
      ) : null}

      <AgenticRunDeepPanel run={agenticRun} ticketId={mission.selectedTicket?.id} />

      {(agenticRun.status === "failed" || agenticRun.status === "aborted") && agenticRun.resumable && (
        <div className="mt-4">
          <button
            onClick={async () => {
              setResuming(true);
              try {
                await resumeAgenticRun(agenticRun.runId);
                mission.refreshSnapshot();
              } catch (error) {
                console.error("Failed to resume run:", error);
              } finally {
                setResuming(false);
              }
            }}
            disabled={resuming}
            className={cn(
              "w-full rounded-xl border px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2",
              resuming
                ? "border-zinc-700 bg-zinc-800 text-zinc-500 cursor-not-allowed"
                : "border-emerald-500/20 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/16 hover:border-emerald-500/30"
            )}
          >
            <RotateCcw className={cn("h-4 w-4", resuming && "animate-spin")} />
            {resuming ? "Resuming Run..." : "Resume Run"}
          </button>
        </div>
      )}

      {(agenticRun.status === "completed" || agenticRun.status === "aborted" || agenticRun.status === "failed") && (
        <div className="mt-4 rounded-xl border border-white/6 bg-black/20 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/6">
            <div className="text-sm font-medium text-zinc-200">Run Replay</div>
            <div className="text-xs text-zinc-500 mt-0.5">Step through the execution timeline</div>
          </div>
          <RunReplayPanel runId={agenticRun.runId} />
        </div>
      )}
    </div>
  );
}

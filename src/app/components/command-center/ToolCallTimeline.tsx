import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Bot,
  MessageSquareText,
  PanelLeftOpen,
  SendHorizontal,
} from "lucide-react";
import type { MissionData, WorkflowCardItem, TaskDetail } from "./types";
import {
  STATUS_LABELS,
  metricTone,
  readExecutionProfileSnapshot,
  countCommentThread,
} from "./helpers";
import { Chip, Panel, PanelHeader } from "../UI";
import { ProcessingIndicator } from "../ui/processing-indicator";
import { cn } from "../ui/utils";
import { executionModeLabel, modelRoleLabel, providerLabel } from "../../lib/missionLabels";
import { SynthesizerPanel } from "../mission/SynthesizerPanel";
import { ProjectMemoryPanel } from "../mission/ProjectMemoryPanel";
import { MemoryBrowserPanel } from "../views/MemoryBrowserPanel";

export interface ToolCallTimelineProps {
  mission: MissionData;
  mode: "overseer" | "task" | "approval" | "run";
  setMode: (mode: "overseer" | "task" | "approval" | "run") => void;
  selectedWorkflow: WorkflowCardItem | null;
  selectedWorkflowId: string | null;
  taskDetail: TaskDetail;
  approvals: MissionData["pendingApprovals"];
  commentDraft: string;
  setCommentDraft: React.Dispatch<React.SetStateAction<string>>;
  replyTargetId: string | null;
  setReplyTargetId: React.Dispatch<React.SetStateAction<string | null>>;
}

export function ToolCallTimeline({
  mission,
  mode,
  setMode,
  selectedWorkflow,
  selectedWorkflowId,
  taskDetail,
  approvals,
  commentDraft,
  setCommentDraft,
  replyTargetId,
  setReplyTargetId,
}: ToolCallTimelineProps) {
  const availableModes = [
    { key: "overseer" as const, label: "Overseer", visible: true },
    { key: "task" as const, label: "Task Detail", visible: Boolean(selectedWorkflow) },
    { key: "approval" as const, label: "Approvals", visible: approvals.length > 0 },
    { key: "run" as const, label: "Run Detail", visible: Boolean(mission.runSummary) },
    { key: "memory" as const, label: "Memory", visible: Boolean(mission.selectedRepo) },
  ].filter((item) => item.visible);

  const activeMode = availableModes.some((item) => item.key === mode) ? mode : "overseer";

  return (
    <div className="min-w-0 xl:sticky xl:top-4 xl:h-fit">
      <Panel className="min-h-[720px] max-h-[calc(100vh-6rem)] border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(12,12,16,0.96)_18%)]">
        <PanelHeader title="Command Context">
          <div className="flex items-center gap-1 rounded-xl border border-white/8 bg-white/[0.03] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
            {availableModes.map((item) => (
              <button
                key={item.key}
                onClick={() => setMode(item.key)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-[10px] uppercase tracking-[0.18em] transition-colors",
                  activeMode === item.key
                    ? "border border-white/10 bg-white/[0.08] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                    : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </PanelHeader>

        {activeMode === "task" && selectedWorkflow ? (
          <TaskDetailPanel
            mission={mission}
            selectedWorkflow={selectedWorkflow}
            selectedWorkflowId={selectedWorkflowId}
            taskDetail={taskDetail}
            commentDraft={commentDraft}
            setCommentDraft={setCommentDraft}
            replyTargetId={replyTargetId}
            setReplyTargetId={setReplyTargetId}
          />
        ) : activeMode === "approval" ? (
          <ApprovalPanel mission={mission} approvals={approvals} />
        ) : activeMode === "run" ? (
          <RunDetailPanel mission={mission} />
        ) : activeMode === "memory" ? (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
            <MemoryBrowserPanel projectId={mission.selectedRepo?.id} />
            <ProjectMemoryPanel worktreePath={mission.selectedRepo?.repoRoot ?? null} />
          </div>
        ) : (
          <OverseerPanel mission={mission} selectedWorkflow={selectedWorkflow} setMode={setMode} />
        )}
      </Panel>
    </div>
  );
}

function TaskDetailPanel({
  mission,
  selectedWorkflow,
  selectedWorkflowId,
  taskDetail,
  commentDraft,
  setCommentDraft,
  replyTargetId,
  setReplyTargetId,
}: {
  mission: MissionData;
  selectedWorkflow: WorkflowCardItem;
  selectedWorkflowId: string | null;
  taskDetail: TaskDetail;
  commentDraft: string;
  setCommentDraft: React.Dispatch<React.SetStateAction<string>>;
  replyTargetId: string | null;
  setReplyTargetId: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
      <div className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(14,14,18,0.96)_26%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Selected Workflow</div>
            <div className="mt-2 text-lg font-semibold leading-7 text-white">{selectedWorkflow.title}</div>
            <div className="mt-1 text-xs leading-5 text-zinc-500">{selectedWorkflow.subtitle}</div>
          </div>
          <Chip variant="subtle" className={cn("text-[10px]", metricTone(selectedWorkflow.status))}>
            {STATUS_LABELS[selectedWorkflow.rawStatus] || selectedWorkflow.rawStatus}
          </Chip>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Chip variant="subtle" className="text-[9px] uppercase">
            {taskDetail?.route ? executionModeLabel(taskDetail.route.executionMode) : "No route"}
          </Chip>
          <Chip variant="subtle" className="text-[9px]">
            {taskDetail?.route ? modelRoleLabel(taskDetail.route.modelRole) : "Pending review"}
          </Chip>
          <Chip variant="subtle" className="text-[9px]">
            {taskDetail?.impactedFiles.length || selectedWorkflow.impactedFiles.length} context files
          </Chip>
          <Chip variant="subtle" className="text-[9px]">
            {formatDistanceToNow(new Date(selectedWorkflow.lastUpdatedAt), { addSuffix: true })}
          </Chip>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <MetaStat label="Priority" value={selectedWorkflow.priority} />
          <MetaStat label="Risk" value={selectedWorkflow.risk} />
          <MetaStat label="Tasks" value={String(Math.max(selectedWorkflow.taskCount, 1))} />
          <MetaStat label="Verification" value={selectedWorkflow.verificationState || "pending"} />
        </div>
      </div>

      <div className="rounded-[18px] border border-white/8 bg-black/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Deep Context</div>
        <div className="mt-2 text-sm leading-6 text-white">{taskDetail?.workflowSummary || "Select review or execute to deepen the workflow context."}</div>
        {taskDetail?.verificationCommand ? (
          <div className="mt-3 rounded-lg border border-violet-500/18 bg-violet-500/8 px-3 py-2 text-xs text-violet-100">
            First failing check: <span className="font-mono text-violet-50">{taskDetail.verificationCommand}</span>
          </div>
        ) : null}
        {taskDetail?.blockers?.length ? (
          <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/8 p-3 text-xs text-amber-100">{taskDetail.blockers[0]}</div>
        ) : null}
        {taskDetail?.nextSteps.length ? (
          <div className="mt-3 space-y-1.5 text-xs text-zinc-300">
            {taskDetail.nextSteps.slice(0, 3).map((step, index) => (
              <div key={`${selectedWorkflow.workflowId}-next-${index}`} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300" />
                <span>{step}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {taskDetail?.subtasks.length ? (
        <div className="rounded-[18px] border border-white/8 bg-black/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Subtasks</div>
            <div className="text-[10px] text-zinc-500">
              {taskDetail.subtasks.filter((subtask) => subtask.status === "done").length}/{taskDetail.subtasks.length} done
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {taskDetail.subtasks.map((subtask) => (
              <div key={subtask.id} className="rounded-[14px] border border-white/6 bg-white/[0.02] px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-white">{subtask.title}</div>
                  <Chip variant="subtle" className="text-[10px]">
                    {STATUS_LABELS[subtask.status] || subtask.status}
                  </Chip>
                </div>
                <div className="mt-1 text-xs text-zinc-500">{subtask.description}</div>
                {subtask.blockedBy.length ? (
                  <div className="mt-2 text-[11px] text-amber-200">Blocked by: {subtask.blockedBy.join(", ")}</div>
                ) : null}
                {subtask.notes.length ? (
                  <div className="mt-2 text-[11px] text-zinc-400">{subtask.notes[subtask.notes.length - 1]}</div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {taskDetail ? (
        <div className="rounded-[18px] border border-white/8 bg-black/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Execution Profile</div>
              <div className="mt-1 text-xs text-zinc-400">
                Ticket override controls the next scope/build/review cycle. Run snapshot shows the last resolved lifecycle.
              </div>
            </div>
          <div className="flex items-center gap-2">
            <select
              value={taskDetail.executionProfileOverrideId ?? "__project__"}
              onChange={(event) =>
                  selectedWorkflowId
                    ? mission.setTicketExecutionProfile(
                        selectedWorkflowId,
                        event.target.value === "__project__" ? null : event.target.value
                      )
                    : undefined
                }
                disabled={!selectedWorkflowId || mission.isUpdatingTicketExecutionProfile}
                className="min-w-[150px] rounded-xl border border-white/10 bg-[#111113] px-3 py-2 text-xs text-zinc-100 outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="__project__">
                Project default ({mission.selectedExecutionProfile?.name ?? "Default"})
              </option>
              {mission.executionProfiles.profiles.map((profile) => (
                  <option key={`${selectedWorkflow?.workflowId}-${profile.id}`} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
            </select>
            <Chip variant="subtle" className="text-[10px]">
              {taskDetail.executionProfileSnapshot?.profileName || mission.selectedExecutionProfile?.name || "Project default"}
            </Chip>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Ticket permission</div>
          <select
            value={taskDetail.ticketExecutionPolicy?.mode === "full_access" ? "__legacy_full_access" : taskDetail.ticketExecutionPolicy?.mode || "balanced"}
            onChange={(event) =>
              selectedWorkflowId
                ? mission.setTicketPermissionMode(
                    selectedWorkflowId,
                    event.target.value as "balanced" | "strict"
                  )
                : undefined
            }
            disabled={!selectedWorkflowId || mission.isUpdatingTicketPermissionMode}
            className="min-w-[138px] rounded-xl border border-white/10 bg-[#111113] px-3 py-2 text-xs text-zinc-100 outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            {taskDetail.ticketExecutionPolicy?.mode === "full_access" ? (
              <option value="__legacy_full_access" disabled>
                Legacy Full Access (downgrade only)
              </option>
            ) : null}
            <option value="balanced">Balanced</option>
            <option value="strict">Strict</option>
          </select>
          <Chip variant="subtle" className="text-[10px]">
            {taskDetail.ticketExecutionPolicy?.mode === "full_access"
              ? "legacy unrestricted mode"
              : taskDetail.ticketExecutionPolicy?.mode === "strict"
              ? "approval per command"
              : "approval for risky ops"}
          </Chip>
        </div>
        {taskDetail.ticketExecutionPolicy?.mode === "full_access" ? (
          <div className="mt-2 rounded-[14px] border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
            This ticket is using a legacy internal-only permission mode. You can downgrade it to Balanced or Strict, but you cannot re-enable Full Access from the standard mission UI.
          </div>
        ) : null}
        {taskDetail.executionProfileSnapshot ? (
          <div className="mt-3 space-y-2">
            {taskDetail.executionProfileSnapshot.stages.map((stage) => (
                <div
                  key={`${taskDetail.executionProfileSnapshot?.profileId}-${stage.stage}`}
                  className="flex items-center justify-between gap-3 rounded-[14px] border border-white/6 bg-white/[0.02] px-3 py-2"
                >
                  <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{stage.stage}</div>
                  <div className="text-right">
                    <div className="text-xs text-white">{modelRoleLabel(stage.role)}</div>
                    <div className="text-[11px] text-zinc-500">
                      {providerLabel(stage.providerId)} · {stage.model}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-[14px] border border-white/6 bg-white/[0.02] px-3 py-2 text-xs text-zinc-400">
              No run snapshot yet. The next scope/build/review cycle will use the selected override or the project default.
            </div>
          )}
        </div>
      ) : null}

      <div className="rounded-[18px] border border-white/8 bg-black/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Comments</div>
          <div className="text-[10px] text-zinc-500">{countCommentThread(taskDetail?.comments ?? [])}</div>
        </div>
        <div className="mt-3 space-y-2">
          <textarea
            value={commentDraft}
            onChange={(event) => setCommentDraft(event.target.value)}
            placeholder="Add a task note or comment for this workflow."
            className="min-h-[96px] w-full resize-none rounded-xl border border-white/8 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400/40"
          />
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] text-zinc-500">
              Authored notes stay with the task and support direct replies for review discussion.
            </div>
            <button
              onClick={() => {
                if (!selectedWorkflowId || !commentDraft.trim()) return;
                mission.addTaskComment(selectedWorkflowId, commentDraft.trim(), null);
                setCommentDraft("");
              }}
              disabled={!selectedWorkflowId || !commentDraft.trim() || mission.isCommenting}
              className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <SendHorizontal className="h-3.5 w-3.5" />
              Add Note
            </button>
          </div>
        </div>
        {taskDetail?.comments.length ? (
          <div className="mt-3 space-y-2">
            {taskDetail.comments.map((comment) => (
              <CommentThreadNode
                key={comment.id}
                comment={comment}
                mission={mission}
                selectedWorkflowId={selectedWorkflowId}
                replyTargetId={replyTargetId}
                setReplyTargetId={setReplyTargetId}
              />
            ))}
          </div>
        ) : (
          <div className="mt-3 text-xs text-zinc-500">No authored comments yet.</div>
        )}
      </div>

      <div className="rounded-[18px] border border-white/8 bg-black/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Activity Notes</div>
        {taskDetail?.activityNotes.length ? (
          <div className="mt-3 space-y-2">
            {taskDetail.activityNotes.slice(-8).map((comment) => (
              <div key={comment.id} className="rounded-[14px] border border-white/6 bg-white/[0.02] px-3 py-2.5">
                <div className="text-[11px] text-zinc-300">{comment.body}</div>
                <div className="mt-1 text-[10px] text-zinc-500">
                  {comment.author} · {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 text-xs text-zinc-500">No system activity notes yet.</div>
        )}
      </div>

      <div className="rounded-[18px] border border-white/8 bg-black/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Recent Logs</div>
        {taskDetail?.logs.length ? (
          <div className="mt-3 space-y-2">
            {taskDetail.logs.slice(-6).map((log) => (
              <div key={log.id} className="rounded-[14px] border border-white/6 bg-white/[0.02] px-3 py-2.5">
                <div className="text-[11px] text-zinc-300">{log.message}</div>
                <div className="mt-1 text-[10px] text-zinc-500">{formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 text-xs text-zinc-500">No task-scoped logs yet.</div>
        )}
      </div>

      {taskDetail?.verificationFailures.length ? (
        <div className="rounded-[18px] border border-violet-500/18 bg-violet-500/8 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
          <div className="text-[10px] uppercase tracking-[0.2em] text-violet-200/80">Verification Failures</div>
          <div className="mt-3 space-y-2">
            {taskDetail.verificationFailures.slice(0, 4).map((failure, index) => (
              <div key={`${selectedWorkflow.workflowId}-failure-${index}`} className="rounded-[14px] border border-violet-400/10 bg-black/20 px-3 py-2.5 text-xs text-violet-50">
                {failure}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ApprovalPanel({
  mission,
  approvals,
}: {
  mission: MissionData;
  approvals: MissionData["pendingApprovals"];
}) {
  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
      {approvals.length ? (
        approvals.map((approval) => (
          <div key={approval.approval_id} className="rounded-[18px] border border-white/8 bg-black/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-white">{approval.action_type.replace(/_/g, " ")}</div>
              <Chip variant="warn" className="text-[10px]">
                pending
              </Chip>
            </div>
            <div className="mt-2 text-xs text-zinc-400">{approval.reason || "Approval required before work can proceed."}</div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => mission.decideApproval(approval.approval_id, "approved")}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
              >
                Approve
              </button>
              <button
                onClick={() => mission.decideApproval(approval.approval_id, "rejected")}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500"
              >
                Reject
              </button>
            </div>
          </div>
        ))
      ) : (
        <div className="rounded-xl border border-dashed border-white/8 px-4 py-8 text-center text-sm text-zinc-500">No pending approvals.</div>
      )}
    </div>
  );
}

function RunDetailPanel({ mission }: { mission: MissionData }) {
  const profileSnapshot = readExecutionProfileSnapshot(mission.runSummary?.metadata);
  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
      <div className="rounded-[18px] border border-white/8 bg-black/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Run State</div>
        <div className="mt-2 text-lg font-semibold text-white">{mission.runSummary?.status || "idle"}</div>
        <div className="mt-1 text-xs text-zinc-500">
          {mission.runSummary
            ? `${providerLabel(mission.runSummary.providerId)} · ${modelRoleLabel(mission.runSummary.modelRole)} · ${executionModeLabel(mission.runSummary.executionMode)}`
            : "No active execution"}
        </div>
      </div>
      <div className="rounded-[18px] border border-white/8 bg-black/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Verification</div>
        <div className="mt-3 space-y-2 text-xs text-zinc-300">
          <div>Checks: {mission.verification?.changedFileChecks.length || 0}</div>
          <div>Tests: {mission.verification?.impactedTests.length || 0}</div>
          <div>Docs: {mission.verification?.docsChecked.length || 0}</div>
        </div>
      </div>
      {profileSnapshot ? (
        <div className="rounded-[18px] border border-white/8 bg-black/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Execution Profile</div>
            <Chip variant="subtle" className="text-[10px]">
              {profileSnapshot.profileName}
            </Chip>
          </div>
          <div className="mt-3 space-y-2">
            {profileSnapshot.stages.map((stage) => (
              <div
                key={`${profileSnapshot.profileId}-${stage.stage}`}
                className="flex items-center justify-between gap-3 rounded-[14px] border border-white/6 bg-white/[0.02] px-3 py-2"
              >
                <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{stage.stage}</div>
                <div className="text-right">
                  <div className="text-xs text-white">{modelRoleLabel(stage.role as Parameters<typeof modelRoleLabel>[0])}</div>
                  <div className="text-[11px] text-zinc-500">
                    {providerLabel(stage.providerId as Parameters<typeof providerLabel>[0])} · {stage.model}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {mission.shareReport?.summary ? (
        <div className="rounded-[18px] border border-white/8 bg-black/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Shareable Summary</div>
          <div className="mt-2 text-sm text-zinc-200">{mission.shareReport.summary}</div>
        </div>
      ) : null}
    </div>
  );
}

function OverseerPanel({
  mission,
  selectedWorkflow,
  setMode,
}: {
  mission: MissionData;
  selectedWorkflow: WorkflowCardItem | null;
  setMode: (mode: "overseer" | "task" | "approval" | "run") => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
      <div className="rounded-[18px] border border-white/8 bg-black/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Overseer</div>
            <div className="mt-1 inline-flex items-center gap-2 text-sm font-medium text-white">
              {mission.isExecuting || mission.isReviewing ? (
                <ProcessingIndicator
                  kind={mission.isExecuting ? "processing" : "thinking"}
                  active
                  size="xs"
                  tone="subtle"
                />
              ) : null}
              {mission.route ? `${executionModeLabel(mission.route.executionMode)} · ${modelRoleLabel(mission.route.modelRole)}` : "No route reviewed yet"}
            </div>
          </div>
          <Chip variant={mission.pendingApprovals.length ? "warn" : "subtle"} className="text-[10px]">
            {mission.pendingApprovals.length ? `${mission.pendingApprovals.length} pending` : "No alerts"}
          </Chip>
        </div>
        <div className="mt-2 text-xs text-zinc-400">
          {mission.contextPack
            ? `${mission.contextPack.files.length} files · ${mission.contextPack.tests.length} tests · ${mission.contextPack.docs.length} docs in current context pack.`
            : "Review the route to materialize the next context pack."}
        </div>
      </div>

      <div className="space-y-3">
        {mission.messages.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-white/8 bg-black/10 px-4 py-8 text-center text-sm text-zinc-500">
            State the objective in the command center and the Overseer will begin compacting context.
          </div>
        ) : (
          mission.messages.slice(-6).map((message) => (
            <div
              key={message.id}
              className={cn(
                "rounded-xl border px-3 py-3",
                message.role === "assistant" ? "border-white/8 bg-white/[0.02]" : "border-cyan-500/15 bg-cyan-500/8"
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  {message.role === "assistant" ? <Bot className="h-3.5 w-3.5 text-violet-400" /> : <MessageSquareText className="h-3.5 w-3.5 text-cyan-300" />}
                  <span className="capitalize">{message.role === "assistant" ? "Overseer" : message.role}</span>
                </div>
                <span className="text-[10px] text-zinc-600">{formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}</span>
              </div>
              <div className="whitespace-pre-wrap text-sm leading-6 text-zinc-200">{message.content}</div>
            </div>
          ))
        )}
      </div>

      <SynthesizerPanel
        route={mission.route}
        contextPack={mission.contextPack}
        blockedByApprovals={mission.pendingApprovals.length > 0}
        onApplyRecommendation={() => mission.reviewRoute()}
      />

      <div className="rounded-[18px] border border-white/8 bg-black/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Quick Actions</div>
        <div className="mt-3 grid grid-cols-1 gap-2">
          <button
            onClick={mission.sendMessage}
            disabled={mission.isActing || !mission.input.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-zinc-200 hover:bg-white/[0.08] disabled:opacity-50"
          >
            <SendHorizontal className="h-4 w-4" />
            Send to Overseer
          </button>
          <button
            onClick={() => selectedWorkflow && setMode("task")}
            disabled={!selectedWorkflow}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-zinc-200 hover:bg-white/[0.08] disabled:opacity-50"
          >
            <PanelLeftOpen className="h-4 w-4" />
            Open Task Detail
          </button>
        </div>
      </div>
    </div>
  );
}

function CommentThreadNode({
  comment,
  mission,
  selectedWorkflowId,
  replyTargetId,
  setReplyTargetId,
  depth = 0,
}: {
  comment: NonNullable<TaskDetail>["comments"][number];
  mission: MissionData;
  selectedWorkflowId: string | null;
  replyTargetId: string | null;
  setReplyTargetId: React.Dispatch<React.SetStateAction<string | null>>;
  depth?: number;
}) {
  const [replyDraft, setReplyDraft] = useState("");
  const isReplying = replyTargetId === comment.id;

  return (
    <div className={cn("space-y-2", depth > 0 && "ml-4 border-l border-white/8 pl-3")}>
      <div className="rounded-[14px] border border-white/6 bg-white/[0.02] px-3 py-2.5">
        <div className="text-[11px] leading-6 text-zinc-300">{comment.body}</div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="text-[10px] text-zinc-500">
            {comment.author} · {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
          </div>
          <button
            onClick={() => {
              setReplyTargetId((current) => (current === comment.id ? null : comment.id));
              setReplyDraft("");
            }}
            className="rounded-md border border-white/8 bg-white/[0.04] px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-300 hover:bg-white/[0.08]"
          >
            {isReplying ? "Cancel" : "Reply"}
          </button>
        </div>
      </div>

      {isReplying ? (
        <div className="rounded-[14px] border border-cyan-500/16 bg-cyan-500/[0.04] p-3">
          <textarea
            value={replyDraft}
            onChange={(event) => setReplyDraft(event.target.value)}
            placeholder="Reply to this note."
            className="min-h-[88px] w-full resize-none rounded-xl border border-white/8 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400/40"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              onClick={() => {
                setReplyTargetId(null);
                setReplyDraft("");
              }}
              className="rounded-lg border border-white/8 bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/[0.08]"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (!selectedWorkflowId || !replyDraft.trim()) return;
                mission.addTaskComment(selectedWorkflowId, replyDraft.trim(), comment.id);
                setReplyDraft("");
                setReplyTargetId(null);
              }}
              disabled={!selectedWorkflowId || !replyDraft.trim() || mission.isCommenting}
              className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <SendHorizontal className="h-3.5 w-3.5" />
              Reply
            </button>
          </div>
        </div>
      ) : null}

      {comment.replies.length ? (
        <div className="space-y-2">
          {comment.replies.map((reply) => (
            <CommentThreadNode
              key={reply.id}
              comment={reply}
              mission={mission}
              selectedWorkflowId={selectedWorkflowId}
              replyTargetId={replyTargetId}
              setReplyTargetId={setReplyTargetId}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MetaStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] border border-white/8 bg-black/20 px-2.5 py-2.5">
      <div className="text-[9px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-0.5 text-[13px] leading-5 text-zinc-200">{value}</div>
    </div>
  );
}

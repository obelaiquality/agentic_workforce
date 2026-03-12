import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDot,
  FileCode2,
  FileSearch,
  FolderClock,
  FolderGit2,
  Github,
  Loader2,
  MessageSquareText,
  PanelLeftOpen,
  Play,
  ScrollText,
  SendHorizontal,
  ShieldAlert,
  Sparkles,
  TestTube2,
  Workflow,
} from "lucide-react";
import type { WorkflowMoveRequest } from "../../../shared/contracts";
import type { useMissionControlLiveData } from "../../hooks/useMissionControlLiveData";
import { useUiStore } from "../../store/uiStore";
import { getMissionTaskDetailV8 } from "../../lib/apiClient";
import { executionModeLabel, modelRoleLabel, providerLabel } from "../../lib/missionLabels";
import { Chip, Panel, PanelHeader } from "../UI";
import { OutcomeDebriefDrawer } from "../mission/OutcomeDebriefDrawer";
import { cn } from "../ui/utils";

type MissionData = ReturnType<typeof useMissionControlLiveData>;
type WorkflowStatusFilter = "all" | "backlog" | "in_progress" | "needs_review" | "completed";
type WorkflowLaneKey = Exclude<WorkflowStatusFilter, "all">;
type WorkflowCardItem = MissionData["workflowCards"][number];
type TaskDetail = Awaited<ReturnType<typeof getMissionTaskDetailV8>>["item"];

const DND_TYPE = "MISSION_WORKFLOW_CARD";

const LANE_META: Array<{
  key: WorkflowLaneKey;
  label: string;
  description: string;
  dotClass: string;
  chipClass: string;
  columnClass: string;
  cardAccent: string;
}> = [
  {
    key: "backlog",
    label: "Backlog",
    description: "Queued for agent assignment.",
    dotClass: "bg-cyan-400",
    chipClass: "bg-cyan-500/10 text-cyan-300 border-cyan-500/20",
    columnClass: "border-cyan-500/18 bg-[linear-gradient(180deg,rgba(34,211,238,0.07),rgba(12,12,16,0.94))]",
    cardAccent: "border-cyan-500/18 shadow-[0_0_0_1px_rgba(34,211,238,0.03)]",
  },
  {
    key: "in_progress",
    label: "In Progress",
    description: "Active workflows and execution lanes.",
    dotClass: "bg-fuchsia-400",
    chipClass: "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/20",
    columnClass: "border-fuchsia-500/18 bg-[linear-gradient(180deg,rgba(217,70,239,0.08),rgba(12,12,16,0.94))]",
    cardAccent: "border-fuchsia-500/20 shadow-[0_0_0_1px_rgba(217,70,239,0.04)]",
  },
  {
    key: "needs_review",
    label: "Needs Review",
    description: "Ready for review or verification follow-up.",
    dotClass: "bg-violet-400",
    chipClass: "bg-violet-500/10 text-violet-300 border-violet-500/20",
    columnClass: "border-violet-500/18 bg-[linear-gradient(180deg,rgba(139,92,246,0.08),rgba(12,12,16,0.94))]",
    cardAccent: "border-violet-500/18 shadow-[0_0_0_1px_rgba(139,92,246,0.04)]",
  },
  {
    key: "completed",
    label: "Completed",
    description: "Closed workflows with verified output.",
    dotClass: "bg-emerald-400",
    chipClass: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
    columnClass: "border-emerald-500/18 bg-[linear-gradient(180deg,rgba(16,185,129,0.08),rgba(12,12,16,0.94))]",
    cardAccent: "border-emerald-500/18 shadow-[0_0_0_1px_rgba(16,185,129,0.04)]",
  },
];

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In Progress",
  review: "Needs Review",
  blocked: "Blocked",
  done: "Completed",
};

function laneMetaFor(status: WorkflowLaneKey) {
  return LANE_META.find((item) => item.key === status)!;
}

function allowedMoves(from: WorkflowLaneKey): WorkflowLaneKey[] {
  switch (from) {
    case "backlog":
      return ["in_progress"];
    case "in_progress":
      return ["backlog", "needs_review"];
    case "needs_review":
      return ["in_progress", "completed"];
    case "completed":
      return ["needs_review"];
  }
}

function toMoveRequest(item: WorkflowCardItem, toStatus: WorkflowLaneKey, beforeWorkflowId: string | null = null): WorkflowMoveRequest {
  return {
    workflowId: item.workflowId,
    fromStatus: item.status,
    toStatus,
    beforeWorkflowId,
  };
}

function progressForCard(item: WorkflowCardItem) {
  if (typeof item.progress === "number") return item.progress;
  switch (item.rawStatus) {
    case "done":
      return 100;
    case "review":
      return 82;
    case "blocked":
      return 58;
    case "in_progress":
      return 64;
    case "ready":
      return 34;
    default:
      return 18;
  }
}

function metricTone(status: WorkflowLaneKey) {
  switch (status) {
    case "completed":
      return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
    case "needs_review":
      return "bg-violet-500/10 text-violet-300 border-violet-500/20";
    case "in_progress":
      return "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/20";
    default:
      return "bg-cyan-500/10 text-cyan-300 border-cyan-500/20";
  }
}

function laneSurfaceClass(lane: WorkflowLaneKey) {
  switch (lane) {
    case "completed":
      return "bg-[linear-gradient(180deg,rgba(16,185,129,0.08),rgba(17,17,22,0.96)_28%)]";
    case "needs_review":
      return "bg-[linear-gradient(180deg,rgba(139,92,246,0.10),rgba(17,17,22,0.96)_28%)]";
    case "in_progress":
      return "bg-[linear-gradient(180deg,rgba(217,70,239,0.10),rgba(17,17,22,0.96)_30%)]";
    default:
      return "bg-[linear-gradient(180deg,rgba(34,211,238,0.08),rgba(17,17,22,0.96)_28%)]";
  }
}

export function CommandCenterView({ mission }: { mission: MissionData }) {
  const selectedWorkflowId = useUiStore((state) => state.selectedWorkflowId);
  const selectedWorkflowStatus = useUiStore((state) => state.selectedWorkflowStatus);
  const workflowViewMode = useUiStore((state) => state.workflowViewMode);
  const commandDrawerMode = useUiStore((state) => state.commandDrawerMode);
  const setSelectedWorkflowId = useUiStore((state) => state.setSelectedWorkflowId);
  const setSelectedWorkflowStatus = useUiStore((state) => state.setSelectedWorkflowStatus);
  const setWorkflowViewMode = useUiStore((state) => state.setWorkflowViewMode);
  const setCommandDrawerMode = useUiStore((state) => state.setCommandDrawerMode);
  const [commentDraft, setCommentDraft] = useState("");
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);

  const taskDetailQuery = useQuery({
    queryKey: ["command-workflow-task-detail", mission.selectedRepo?.id, selectedWorkflowId],
    queryFn: () =>
      getMissionTaskDetailV8({
        taskId: selectedWorkflowId!,
        projectId: mission.selectedRepo?.id || null,
      }),
    enabled: Boolean(selectedWorkflowId),
    refetchInterval: 8000,
  });

  const taskDetail = taskDetailQuery.data?.item || null;
  const workflowCards = mission.workflowCards ?? [];
  const selectedWorkflow = useMemo(
    () => workflowCards.find((item) => item.workflowId === selectedWorkflowId) || null,
    [selectedWorkflowId, workflowCards]
  );

  useEffect(() => {
    if (!selectedWorkflowId) {
      setCommandDrawerMode("overseer");
      return;
    }
    if (!workflowCards.some((item) => item.workflowId === selectedWorkflowId)) {
      setSelectedWorkflowId(null);
      setCommandDrawerMode("overseer");
    }
  }, [selectedWorkflowId, setCommandDrawerMode, setSelectedWorkflowId, workflowCards]);

  useEffect(() => {
    setCommentDraft("");
    setReplyTargetId(null);
  }, [selectedWorkflowId]);

  const groupedWorkflows = useMemo(
    () =>
      LANE_META.map((lane) => ({
        ...lane,
        summary: mission.workflowPillars.find((item) => item.key === lane.key) ?? {
          key: lane.key,
          label: lane.label,
          count: 0,
          blockedCount: 0,
          workflowIds: [],
        },
        items: workflowCards.filter((item) => item.status === lane.key),
      })),
    [mission.workflowPillars, workflowCards]
  );

  const selectedLane = selectedWorkflowStatus === "all" ? null : selectedWorkflowStatus;
  const attentionCount =
    mission.pendingApprovals.length +
    groupedWorkflows.reduce((count, lane) => count + (lane.summary.blockedCount ?? 0), 0);

  const workflowApprovals = useMemo(() => {
    if (taskDetail?.approvals?.length) {
      return taskDetail.approvals.map((item) => ({
        approval_id: item.approvalId,
        action_type: item.actionType,
        status: "pending" as const,
        reason: item.reason,
        payload: { aggregate_id: item.relevantToCurrentTask ? selectedWorkflowId : null },
        requested_at: item.requestedAt,
        decided_at: null,
      }));
    }
    if (!selectedWorkflowId) return mission.pendingApprovals.slice(0, 3);
    return mission.pendingApprovals.filter((item) => item.payload.aggregate_id === selectedWorkflowId || item.payload.aggregate_id === null);
  }, [mission.pendingApprovals, selectedWorkflowId, taskDetail]);

  const laneActivity = useMemo(() => {
    return groupedWorkflows.map((lane) => ({
      ...lane,
      items: lane.items.sort((left, right) => {
        if (left.isBlocked !== right.isBlocked) {
          return left.isBlocked ? -1 : 1;
        }
        if ((left.laneOrder ?? 0) !== (right.laneOrder ?? 0)) {
          return (left.laneOrder ?? 0) - (right.laneOrder ?? 0);
        }
        return new Date(right.lastUpdatedAt).getTime() - new Date(left.lastUpdatedAt).getTime();
      }),
    }));
  }, [groupedWorkflows]);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_352px]">
      <div className="min-w-0 space-y-4">
        <OverseerCommandCard
          mission={mission}
          attentionCount={attentionCount}
          onOpenProjects={mission.openProjects}
        />

        {mission.selectedRepo ? (
          <>
            <WorkflowSummaryRow
              lanes={laneActivity}
              selectedLane={selectedLane}
              onSelect={(lane) => {
                const next = selectedWorkflowStatus === lane ? "all" : lane;
                setSelectedWorkflowStatus(next);
                if (next !== "all" && selectedWorkflow?.status !== next) {
                  setSelectedWorkflowId(null);
                  setCommandDrawerMode("overseer");
                }
              }}
            />

            <Panel className="border-white/8">
              <PanelHeader title="Agent Workflows">
                <div className="flex items-center gap-2">
                  <div className="inline-flex items-center rounded-lg border border-white/10 bg-white/[0.03] p-1">
                    <button
                      onClick={() => setWorkflowViewMode("board")}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] transition-colors",
                        workflowViewMode === "board" ? "bg-white/[0.08] text-white" : "text-zinc-500 hover:text-zinc-300"
                      )}
                    >
                      Board
                    </button>
                    <button
                      onClick={() => setWorkflowViewMode("list")}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] transition-colors",
                        workflowViewMode === "list" ? "bg-white/[0.08] text-white" : "text-zinc-500 hover:text-zinc-300"
                      )}
                    >
                      List
                    </button>
                  </div>
                  <Chip variant="subtle" className="text-[10px]">
                    {selectedLane ? laneMetaFor(selectedLane).label : "All Workflows"}
                  </Chip>
                </div>
              </PanelHeader>

              <div className="p-3.5">
                {workflowViewMode === "board" ? (
                  <DndProvider backend={HTML5Backend}>
                    <div className="grid gap-2.5 xl:grid-cols-4">
                      {laneActivity.map((lane) => (
                        <WorkflowLane
                          key={lane.key}
                          lane={lane}
                          emphasized={!selectedLane || selectedLane === lane.key}
                          selectedWorkflowId={selectedWorkflowId}
                          taskDetail={taskDetail}
                          timeline={mission.timeline}
                          contextPack={mission.contextPack}
                          onSelectWorkflow={(workflowId, openDrawer) => {
                            const nextWorkflowId = workflowId === selectedWorkflowId ? null : workflowId;
                            setSelectedWorkflowId(nextWorkflowId);
                            mission.setSelectedTicketId(nextWorkflowId);
                            setCommandDrawerMode(openDrawer && nextWorkflowId ? "task" : "overseer");
                          }}
                          onMoveWorkflow={(item, nextLane, beforeWorkflowId) => {
                            if (item.status === nextLane && !beforeWorkflowId) return;
                            mission.moveWorkflow(toMoveRequest(item, nextLane, beforeWorkflowId ?? null));
                          }}
                        />
                      ))}
                    </div>
                  </DndProvider>
                ) : (
                  <div className="space-y-3">
                    {laneActivity
                      .filter((lane) => !selectedLane || lane.key === selectedLane)
                      .flatMap((lane) =>
                        lane.items.map((item) => (
                          <WorkflowCard
                            key={item.workflowId}
                            item={item}
                            lane={lane.key}
                            active={item.workflowId === selectedWorkflowId}
                            expanded={item.workflowId === selectedWorkflowId}
                            contextPack={item.workflowId === selectedWorkflowId ? mission.contextPack : null}
                            taskDetail={item.workflowId === selectedWorkflowId ? taskDetail : null}
                            timeline={item.workflowId === selectedWorkflowId ? mission.timeline : []}
                            onToggleExpand={() => {
                              const next = item.workflowId === selectedWorkflowId ? null : item.workflowId;
                              setSelectedWorkflowId(next);
                              mission.setSelectedTicketId(next);
                              if (!next) setCommandDrawerMode("overseer");
                            }}
                            onOpenDetail={() => {
                              setSelectedWorkflowId(item.workflowId);
                              mission.setSelectedTicketId(item.workflowId);
                              setCommandDrawerMode("task");
                            }}
                            onMove={(nextLane, beforeWorkflowId) =>
                              mission.moveWorkflow(toMoveRequest(item, nextLane, beforeWorkflowId ?? null))
                            }
                            dragging={false}
                            subtle={false}
                          />
                        ))
                      )}
                  </div>
                )}
              </div>
            </Panel>

            <OutcomeDebriefDrawer
              runSummary={mission.runSummary}
              verification={mission.verification}
              shareReport={mission.shareReport}
              blueprint={mission.blueprint}
            />
          </>
        ) : (
          <ConnectSurface
            recentProjects={mission.recentRepos}
            recentRepoPaths={mission.recentRepoPaths}
            activateRepo={mission.activateRepo}
            openRecentPath={mission.connectRecentPath}
            chooseLocalRepo={mission.chooseLocalRepo}
            openProjects={mission.openProjects}
            hasDesktopPicker={mission.hasDesktopPicker}
            repoPickerMessage={mission.repoPickerMessage}
          />
        )}
      </div>

      <CommandContextDrawer
        mission={mission}
        mode={commandDrawerMode}
        setMode={setCommandDrawerMode}
        selectedWorkflow={selectedWorkflow}
        selectedWorkflowId={selectedWorkflowId}
        taskDetail={taskDetail}
        approvals={workflowApprovals}
        commentDraft={commentDraft}
        setCommentDraft={setCommentDraft}
        replyTargetId={replyTargetId}
        setReplyTargetId={setReplyTargetId}
      />
    </div>
  );
}

function OverseerCommandCard({
  mission,
  attentionCount,
  onOpenProjects,
}: {
  mission: MissionData;
  attentionCount: number;
  onOpenProjects: () => void;
}) {
  const route = mission.route;
  const contextPack = mission.contextPack;
  const routeConfidence = route
    ? Math.round(((mission.route?.metadata?.confidence as number | undefined) || contextPack?.confidence || 0.68) * 100)
    : Math.round((contextPack?.confidence || 0.38) * 100);

  return (
    <Panel className="border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.08),transparent_24%),radial-gradient(circle_at_top_right,rgba(168,85,247,0.10),transparent_22%),#111113] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />
      <div className="grid grid-cols-1 gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1.45fr)_328px]">
        <div className="space-y-3.5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.26em] text-zinc-500">
                <Workflow className="h-3.5 w-3.5 text-cyan-300" />
                Overseer Command
              </div>
              <h2 className="text-[1.22rem] font-semibold tracking-tight text-white lg:text-[1.28rem]">
                {mission.selectedRepo ? "Issue one command, then drill into the workflow." : "Plug in your own repo"}
              </h2>
              <p className="max-w-xl text-sm leading-5 text-zinc-400">
                {mission.selectedRepo
                  ? "Start in chat. We scope your objective into a backlog ticket, then execution drives lifecycle transitions automatically."
                  : "Choose a local Git repo or connect GitHub. The app works in a linked copy and keeps your original repository untouched."}
              </p>
            </div>
          <div className="flex max-w-[320px] flex-wrap items-center justify-end gap-2">
              {mission.selectedRepo ? (
                <>
                  <Chip variant="subtle" className="max-w-[220px] truncate text-[10px]" title={mission.selectedRepo.displayName}>
                    {mission.selectedRepo.displayName}
                  </Chip>
                  <Chip variant="subtle" className="text-[10px]">
                    {mission.selectedRepo.branch || mission.selectedRepo.defaultBranch || "main"}
                  </Chip>
                  <Chip variant={attentionCount ? "warn" : "ok"} className="text-[10px]">
                    {attentionCount ? `${attentionCount} attention` : mission.liveState}
                  </Chip>
                </>
              ) : (
                <Chip variant="subtle" className="text-[10px]">
                  Local-first
                </Chip>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-[22px] border border-white/10 bg-[#161618] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
            <textarea
              value={mission.input}
              onChange={(event) => mission.setInput(event.target.value)}
              disabled={!mission.selectedRepo}
              placeholder={
                mission.selectedRepo
                  ? "Describe the next change. Example: Add CSV export to the client list and verify the tests."
                  : "Connect a repo to start issuing objectives from the command center."
              }
              className="min-h-[128px] w-full resize-none bg-transparent px-4 py-4 text-[15px] leading-7 text-zinc-100 outline-none placeholder:text-zinc-600 disabled:cursor-not-allowed"
            />

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/6 bg-black/20 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                {mission.selectedRepo ? (
                  <>
                    <SmallMetric icon={<FileCode2 className="h-3 w-3" />} label={`Context ${contextPack?.files.length || 0} files`} />
                    <SmallMetric icon={<TestTube2 className="h-3 w-3" />} label={`${contextPack?.tests.length || 0} tests`} />
                    <SmallMetric icon={<ScrollText className="h-3 w-3" />} label={`${contextPack?.docs.length || 0} docs`} />
                    <SmallMetric icon={<ShieldAlert className="h-3 w-3" />} label={`${mission.pendingApprovals.length} approvals`} />
                  </>
                ) : (
                  <>
                    <button
                      onClick={mission.chooseLocalRepo}
                      disabled={mission.isActing}
                      className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-medium text-white shadow-[0_0_18px_rgba(6,182,212,0.16)] hover:bg-cyan-500 disabled:opacity-50"
                    >
                      <FolderGit2 className="h-4 w-4" />
                      Choose Local Repo
                    </button>
                    <button
                      onClick={onOpenProjects}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-zinc-200 hover:bg-white/[0.08]"
                    >
                      <Github className="h-4 w-4" />
                      Connect GitHub Repo
                    </button>
                    <button
                      onClick={onOpenProjects}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-zinc-200 hover:bg-white/[0.08]"
                    >
                      <FolderClock className="h-4 w-4" />
                      Open Recent
                    </button>
                  </>
                )}
              </div>

              {mission.selectedRepo ? (
                <span className="text-[11px] leading-5 text-zinc-500">Scope Ticket creates/updates backlog. Start Work moves to In Progress and auto-sends successful runs to Needs Review.</span>
              ) : (
                <span className="text-[11px] leading-5 text-zinc-500">Desktop app enables the native repo picker. Browser preview keeps the same shell but limits native actions.</span>
              )}
            </div>
          </div>

          {mission.selectedRepo && mission.blueprint ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <CommandRuleCard
                icon={<TestTube2 className="h-3.5 w-3.5 text-cyan-300" />}
                label="Testing"
                value={mission.blueprint.testingPolicy.requiredForBehaviorChange ? "Behavior changes require tests" : "Tests are optional by default"}
              />
              <CommandRuleCard
                icon={<ScrollText className="h-3.5 w-3.5 text-violet-300" />}
                label="Documentation"
                value={mission.blueprint.documentationPolicy.updateUserFacingDocs ? "User-facing docs should be updated" : "Docs updates are optional"}
              />
              <CommandRuleCard
                icon={<ShieldAlert className="h-3.5 w-3.5 text-amber-300" />}
                label="Execution"
                value={`${mission.blueprint.providerPolicy.escalationPolicy.replace(/_/g, " ")} escalation · ${mission.blueprint.executionPolicy.maxChangedFilesBeforeReview} files before review`}
              />
            </div>
          ) : null}

          {mission.repoPickerMessage ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-sm text-amber-100">
              {mission.repoPickerMessage}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <div className="rounded-[22px] border border-white/10 bg-[#111113] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
            <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.22em] text-zinc-500">
              <span>Execution Route</span>
              <button
                onClick={mission.refreshSnapshot}
                disabled={mission.isActing}
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] text-zinc-300 hover:bg-white/[0.08] disabled:opacity-50"
              >
                <Activity className="h-3 w-3" />
                Refresh
              </button>
            </div>
            <div className="mt-3 rounded-[18px] border border-white/8 bg-[#161618] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-white">
                  {route ? `${executionModeLabel(route.executionMode)} · ${modelRoleLabel(route.modelRole)}` : "Review the route"}
                </div>
                <Chip variant="subtle" className="text-[9px]">
                  {mission.isExecuting ? "Executing" : mission.isReviewing ? "Reviewing" : route ? "Ready" : "Pending"}
                </Chip>
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {mission.isExecuting
                  ? "Running execution pipeline..."
                  : mission.isReviewing
                  ? "Computing route and context pack..."
                  : route
                  ? `${providerLabel(route.providerId)} · ${route.verificationDepth} verification · max ${route.maxLanes} lane${route.maxLanes === 1 ? "" : "s"}`
                  : "No route locked yet"}
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full bg-gradient-to-r from-cyan-500 via-violet-500 to-cyan-300",
                    mission.isExecuting || mission.isReviewing ? "animate-pulse" : ""
                  )}
                  style={{ width: `${Math.max(18, routeConfidence)}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
                <span>{route ? `${routeConfidence}% route confidence` : `${Math.round((contextPack?.confidence || 0.3) * 100)}% context confidence`}</span>
                <span>{contextPack ? `${contextPack.tokenBudget} token budget` : "Awaiting context pack"}</span>
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-[22px] border border-white/10 bg-[#111113] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Mode</div>
            <select
              value={mission.selectedModelRole}
              onChange={(event) => mission.setSelectedModelRole(event.target.value as typeof mission.selectedModelRole)}
              disabled={!mission.selectedRepo}
              className="w-full rounded-[16px] border border-white/10 bg-[#161618] px-3 py-3 text-sm text-zinc-100 outline-none disabled:cursor-not-allowed"
            >
              {Object.entries(mission.roleLabels).map(([role, label]) => (
                <option key={role} value={role}>
                  {label}
                </option>
              ))}
            </select>

            {mission.actionMessage ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-xs text-zinc-300">
                {mission.actionMessage}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                onClick={mission.reviewRoute}
                disabled={mission.isActing || !mission.input.trim() || !mission.selectedRepo}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-zinc-200 hover:bg-white/[0.08] disabled:opacity-50"
              >
                {mission.isReviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
                {mission.isReviewing ? "Scoping..." : "Scope Ticket"}
              </button>
              <button
                onClick={mission.executeRoute}
                disabled={mission.isActing || !mission.input.trim() || !mission.selectedRepo}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-3 text-sm font-medium text-white shadow-[0_0_18px_rgba(6,182,212,0.16)] hover:bg-cyan-500 disabled:opacity-50"
              >
                {mission.isExecuting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {mission.isExecuting ? "Starting..." : "Start Work"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function WorkflowSummaryRow({
  lanes,
  selectedLane,
  onSelect,
}: {
  lanes: Array<{
    key: WorkflowLaneKey;
    label: string;
    description: string;
    summary: MissionData["workflowPillars"][number];
  }>;
  selectedLane: WorkflowLaneKey | null;
  onSelect: (lane: WorkflowLaneKey) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-4">
      {lanes.map((lane) => {
        const meta = laneMetaFor(lane.key);
        const active = selectedLane === lane.key;
        return (
          <button
            key={lane.key}
            onClick={() => onSelect(lane.key)}
            className={cn(
              "rounded-[22px] border px-4 py-3.5 text-left transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]",
              meta.columnClass,
              active ? "ring-1 ring-white/12 shadow-[0_0_18px_rgba(255,255,255,0.04)]" : "hover:border-white/16 hover:bg-white/[0.015]"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-zinc-400">
                  <span className={cn("h-2.5 w-2.5 rounded-full", meta.dotClass, active ? "animate-pulse" : "")} />
                  {lane.label}
                </div>
              </div>
              <div className={cn("inline-flex h-8 min-w-8 items-center justify-center rounded-lg border px-2.5 py-1 text-xs font-medium", meta.chipClass)}>
                {lane.summary.count}
              </div>
            </div>
            <div className="mt-2.5 max-w-[16rem] text-[13px] leading-5 text-zinc-400">{lane.description}</div>
            {lane.summary.blockedCount ? (
              <div className="mt-2.5 text-[11px] text-amber-300">
                {lane.summary.blockedCount} blocked in this lane
              </div>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function WorkflowLane({
  lane,
  emphasized,
  selectedWorkflowId,
  taskDetail,
  timeline,
  contextPack,
  onSelectWorkflow,
  onMoveWorkflow,
}: {
  lane: {
    key: WorkflowLaneKey;
    label: string;
    description: string;
    items: WorkflowCardItem[];
    summary: MissionData["workflowPillars"][number];
  };
  emphasized: boolean;
  selectedWorkflowId: string | null;
  taskDetail: TaskDetail;
  timeline: MissionData["timeline"];
  contextPack: MissionData["contextPack"] | null;
  onSelectWorkflow: (workflowId: string, openDrawer: boolean) => void;
  onMoveWorkflow: (item: WorkflowCardItem, nextLane: WorkflowLaneKey, beforeWorkflowId?: string | null) => void;
}) {
  const meta = laneMetaFor(lane.key);
  const [{ isOver, canDrop }, dropRef] = useDrop(
    () => ({
      accept: DND_TYPE,
      canDrop: (dragged: WorkflowCardItem) =>
        dragged.status === lane.key ? true : allowedMoves(dragged.status).includes(lane.key),
      drop: (dragged: WorkflowCardItem) => {
        if (dragged.status === lane.key || allowedMoves(dragged.status).includes(lane.key)) {
          onMoveWorkflow(dragged, lane.key, null);
        }
      },
      collect: (monitor) => ({
        isOver: monitor.isOver({ shallow: true }),
        canDrop: monitor.canDrop(),
      }),
    }),
    [lane.key, onMoveWorkflow]
  );

  return (
    <div
      ref={dropRef}
      className={cn(
        "overflow-hidden rounded-[24px] border transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]",
        meta.columnClass,
        emphasized ? "opacity-100" : "opacity-58",
        isOver && canDrop ? "ring-1 ring-cyan-300/30 border-cyan-300/30 shadow-[0_0_20px_rgba(34,211,238,0.07)]" : ""
      )}
    >
      <div className="flex items-start justify-between gap-2 border-b border-white/6 bg-white/[0.02] px-4 py-3.5">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-zinc-400">
            <span className={cn("h-2.5 w-2.5 rounded-full", meta.dotClass, lane.key === "in_progress" ? "animate-pulse" : "")} />
            {lane.label}
          </div>
          <div className="mt-2 max-w-[15rem] text-[13px] leading-5 text-zinc-400">{lane.description}</div>
        </div>
        <Chip variant="subtle" className={cn("h-8 min-w-8 justify-center px-2.5 text-[10px]", meta.chipClass)}>
          {lane.items.length}
        </Chip>
      </div>

      <div className="min-h-[332px] space-y-3 p-4">
        {lane.items.length === 0 ? (
          <div className="rounded-[22px] border border-dashed border-white/8 bg-black/10 px-4 py-12 text-center text-sm text-zinc-600">
            Nothing active in this lane.
          </div>
        ) : (
          lane.items.map((item) => (
            <WorkflowCard
              key={item.workflowId}
              item={item}
              lane={lane.key}
              active={item.workflowId === selectedWorkflowId}
              expanded={item.workflowId === selectedWorkflowId}
              contextPack={item.workflowId === selectedWorkflowId ? contextPack : null}
              taskDetail={item.workflowId === selectedWorkflowId ? taskDetail : null}
              timeline={item.workflowId === selectedWorkflowId ? timeline : []}
              onToggleExpand={() => onSelectWorkflow(item.workflowId, false)}
              onOpenDetail={() => onSelectWorkflow(item.workflowId, true)}
              onMove={(nextLane, beforeWorkflowId) => onMoveWorkflow(item, nextLane, beforeWorkflowId)}
              subtle={!emphasized}
            />
          ))
        )}
      </div>
    </div>
  );
}

function WorkflowCard({
  item,
  lane,
  active,
  expanded,
  contextPack,
  taskDetail,
  timeline,
  onToggleExpand,
  onOpenDetail,
  onMove,
  subtle,
}: {
  item: WorkflowCardItem;
  lane: WorkflowLaneKey;
  active: boolean;
  expanded: boolean;
  contextPack: MissionData["contextPack"] | null;
  taskDetail: TaskDetail;
  timeline: MissionData["timeline"];
  onToggleExpand: () => void;
  onOpenDetail: () => void;
  onMove: (nextLane: WorkflowLaneKey, beforeWorkflowId?: string | null) => void;
  subtle: boolean;
}) {
  const meta = laneMetaFor(lane);
  const [{ isDragging }, dragRef] = useDrag(
    () => ({
      type: DND_TYPE,
      item,
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
      }),
    }),
    [item]
  );
  const [{ isOver: isCardOver, canDrop: canDropOnCard }, dropRef] = useDrop(
    () => ({
      accept: DND_TYPE,
      canDrop: (dragged: WorkflowCardItem) => {
        if (dragged.workflowId === item.workflowId) return false;
        if (dragged.status === lane) return true;
        return allowedMoves(dragged.status).includes(lane);
      },
      drop: (dragged: WorkflowCardItem) => {
        if (dragged.workflowId === item.workflowId) return;
        onMove(lane, item.workflowId);
      },
      collect: (monitor) => ({
        isOver: monitor.isOver({ shallow: true }),
        canDrop: monitor.canDrop(),
      }),
    }),
    [item.workflowId, lane, onMove]
  );

  const events = timeline.filter((event) => event.task_id === item.workflowId).slice(-3);
  const allowedTransitions = allowedMoves(item.status);
  const hasImpactSummary = item.impactedFiles.length > 0 || item.impactedTests.length > 0 || item.impactedDocs.length > 0;
  const summaryToggleProps = {
    role: "button" as const,
    tabIndex: 0,
    onClick: onToggleExpand,
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onToggleExpand();
      }
    },
  };

  return (
    <article
      ref={(node) => {
        dragRef(node);
        dropRef(node);
      }}
      className={cn(
        "overflow-hidden rounded-[24px] border transition-all",
        laneSurfaceClass(lane),
        meta.cardAccent,
        active ? "ring-1 ring-white/12 shadow-[0_0_20px_rgba(255,255,255,0.05)]" : "hover:border-white/14 hover:shadow-[0_0_16px_rgba(255,255,255,0.03)]",
        item.isBlocked ? "border-amber-400/30 shadow-[0_0_0_1px_rgba(245,158,11,0.08),0_0_18px_rgba(245,158,11,0.06)]" : "",
        subtle ? "opacity-90" : "opacity-100",
        isDragging ? "opacity-55" : "",
        isCardOver && canDropOnCard ? "ring-1 ring-cyan-300/35 border-cyan-300/30 shadow-[0_0_20px_rgba(34,211,238,0.08)]" : ""
      )}
    >
      <div className="px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <div
            {...summaryToggleProps}
            className="min-w-0 cursor-pointer rounded-[18px] outline-none transition focus-visible:ring-1 focus-visible:ring-cyan-300/30"
            aria-label={expanded ? "Collapse workflow" : "Expand workflow"}
          >
            <div className="flex items-start justify-between gap-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2.5">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", meta.dotClass, lane === "in_progress" ? "animate-pulse" : "")} />
                  <div className="min-w-0 flex-1">
                    <h3 className="line-clamp-2 text-[14px] font-semibold leading-5 text-white">{item.title}</h3>
                    {item.isBlocked || item.verificationState ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {item.isBlocked ? (
                          <Chip variant="warn" className="text-[9px]">
                            Blocked
                          </Chip>
                        ) : null}
                        {item.verificationState ? (
                          <Chip variant="subtle" className={cn("text-[9px]", metricTone(lane))}>
                            {item.verificationState}
                          </Chip>
                        ) : null}
                      </div>
                    ) : null}
                    <p className="mt-1.5 line-clamp-3 text-[13px] leading-6 text-zinc-400">{item.subtitle}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <Chip variant="subtle" className="px-2 py-1 text-[9px] uppercase">
                {item.priority}
              </Chip>
              <Chip variant="subtle" className="px-2 py-1 text-[9px]">
                {item.risk}
              </Chip>
              {item.ownerLabel ? (
                <Chip variant="subtle" className="px-2 py-1 text-[9px]">
                  {item.ownerLabel}
                </Chip>
              ) : null}
              {lane === "needs_review" ? (
                <Chip variant="subtle" className="px-2 py-1 border-violet-500/20 bg-violet-500/10 text-[9px] text-violet-200">
                  Review Ready
                </Chip>
              ) : null}
              {lane === "completed" ? (
                <Chip variant="subtle" className="px-2 py-1 border-emerald-500/20 bg-emerald-500/10 text-[9px] text-emerald-200">
                  Verified
                </Chip>
              ) : null}
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[10px] text-zinc-500">
              {hasImpactSummary ? (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    <FileCode2 className="h-3 w-3 text-zinc-600" />
                    {item.impactedFiles.length} files
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <TestTube2 className="h-3 w-3 text-zinc-600" />
                    {item.impactedTests.length} tests
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <ScrollText className="h-3 w-3 text-zinc-600" />
                    {item.impactedDocs.length} docs
                  </span>
                </>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                  Impact pending
                </span>
              )}
              <span>{formatDistanceToNow(new Date(item.lastUpdatedAt), { addSuffix: true })}</span>
            </div>

            {lane === "in_progress" ? (
              <div className="mt-3">
                <MicroBar label="Progress" value={`${progressForCard(item)}%`} progress={progressForCard(item)} tone="from-fuchsia-500 to-fuchsia-300" />
              </div>
            ) : null}

            {lane === "completed" ? (
              <div className="mt-3 inline-flex items-center gap-2 text-xs text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Verified output ready
              </div>
            ) : null}

            {lane === "needs_review" ? (
              <div className="mt-3 inline-flex items-center gap-2 text-xs text-violet-300">
                <CircleDot className="h-3.5 w-3.5" />
                Awaiting review follow-up
              </div>
            ) : null}

            {lane !== "in_progress" ? (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
                <div
                  className={cn(
                    "h-full rounded-full",
                    lane === "completed"
                      ? "bg-gradient-to-r from-emerald-500 to-emerald-300"
                      : lane === "needs_review"
                      ? "bg-gradient-to-r from-violet-500 to-violet-300"
                      : "bg-gradient-to-r from-cyan-500 to-cyan-300"
                  )}
                  style={{ width: `${progressForCard(item)}%` }}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {expanded ? (
        <div className="overflow-hidden border-t border-white/6 bg-black/[0.08]">
          <div className="space-y-2.5 px-3 pb-3.5 pt-3">
            <div className="grid grid-cols-2 gap-1.5">
              <MetaStat label="Priority" value={item.priority} />
              <MetaStat label="Risk" value={item.risk} />
              <MetaStat label="Status" value={STATUS_LABELS[item.rawStatus] || item.rawStatus} />
              <MetaStat label="Verification" value={item.verificationState || "pending"} />
            </div>

            <div className="rounded-[16px] border border-white/8 bg-black/20 p-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Execution Snapshot</div>
                  <div className="mt-1.5 text-[13px] leading-5 text-white">
                    {taskDetail?.route
                      ? `${executionModeLabel(taskDetail.route.executionMode)} · ${modelRoleLabel(taskDetail.route.modelRole)}`
                      : item.blockedReason || "Route review will sharpen the execution plan."}
                  </div>
                </div>
                <Chip variant="subtle" className={cn("text-[9px]", metricTone(lane))}>
                  {progressForCard(item)}%
                </Chip>
              </div>
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
                <div
                  className={cn(
                    "h-full rounded-full",
                    lane === "completed"
                      ? "bg-gradient-to-r from-emerald-500 to-emerald-300"
                      : lane === "needs_review"
                      ? "bg-gradient-to-r from-violet-500 to-violet-300"
                      : lane === "in_progress"
                      ? "bg-gradient-to-r from-fuchsia-500 to-fuchsia-300"
                      : "bg-gradient-to-r from-cyan-500 to-cyan-300"
                  )}
                  style={{ width: `${progressForCard(item)}%` }}
                />
              </div>
              <div className="mt-1.5 text-[11px] text-zinc-500">
                Updated {formatDistanceToNow(new Date(item.lastUpdatedAt), { addSuffix: true })}
              </div>
              {item.blockedReason ? (
                <div className="mt-2.5 rounded-lg border border-amber-500/20 bg-amber-500/8 p-2.5 text-xs text-amber-100">{item.blockedReason}</div>
              ) : null}
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <MiniCountCard
                label="Files"
                value={taskDetail?.impactedFiles.length || contextPack?.files.length || item.impactedFiles.length}
              />
              <MiniCountCard
                label="Tests"
                value={taskDetail?.impactedTests.length || contextPack?.tests.length || item.impactedTests.length}
              />
              <MiniCountCard
                label="Docs"
                value={taskDetail?.impactedDocs.length || contextPack?.docs.length || item.impactedDocs.length}
              />
            </div>

            <div className="rounded-[16px] border border-white/8 bg-black/20 p-2.5">
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">At a Glance</div>
              <div className="mt-1.5 space-y-2">
                <div className="text-[13px] leading-5 text-white">
                  {taskDetail?.workflowSummary || "Open detail for files, notes, logs, and full verification context."}
                </div>
                {events.length ? (
                  <div className="flex items-start gap-2 text-xs text-zinc-400">
                    <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
                    <div className="min-w-0">
                      <div className="line-clamp-2">{events[events.length - 1]?.message}</div>
                      <div className="mt-1 text-[10px] text-zinc-500">
                        {formatDistanceToNow(new Date(events[events.length - 1]!.timestamp), { addSuffix: true })}
                      </div>
                    </div>
                  </div>
                ) : null}
                {taskDetail?.verification.length ? (
                  <div className="text-xs text-zinc-400">
                    {taskDetail.verification.length} verification signals captured
                  </div>
                ) : (
                  <div className="text-xs text-zinc-500">Verification will appear after execution or review.</div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-0.5">
              {allowedTransitions.map((nextLane) => (
                <button
                  key={`${item.workflowId}-${nextLane}`}
                  onClick={() => onMove(nextLane, null)}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-zinc-200 hover:bg-white/[0.08]"
                >
                  Move to {laneMetaFor(nextLane).label}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              ))}
              <button
                onClick={onOpenDetail}
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/8 px-3 py-2 text-xs text-cyan-100 hover:bg-cyan-500/12"
              >
                <PanelLeftOpen className="h-3.5 w-3.5" />
                Open Detail
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function MiniCountCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[12px] border border-white/8 bg-black/20 px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-0.5 text-[22px] font-semibold leading-none text-white">{value}</div>
    </div>
  );
}

function MicroBar({ label, value, progress, tone }: { label: string; value: string; progress: number; tone: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-500">
        <span>{label}</span>
        <span className="font-mono">{value}</span>
      </div>
      <div className="h-1 rounded-full bg-white/[0.05] overflow-hidden">
        <div className={cn("h-full rounded-full bg-gradient-to-r", tone)} style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

function CommandContextDrawer({
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
}: {
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
}) {
  const availableModes = [
    { key: "overseer" as const, label: "Overseer", visible: true },
    { key: "task" as const, label: "Task Detail", visible: Boolean(selectedWorkflow) },
    { key: "approval" as const, label: "Approvals", visible: approvals.length > 0 },
    { key: "run" as const, label: "Run Detail", visible: Boolean(mission.runSummary) },
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

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-[18px] border border-white/8 bg-black/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Metadata</div>
                <div className="mt-3 space-y-2 text-xs text-zinc-300">
                  <div>
                    Route: {taskDetail?.route ? `${executionModeLabel(taskDetail.route.executionMode)} · ${modelRoleLabel(taskDetail.route.modelRole)}` : "Not reviewed yet"}
                  </div>
                  <div>Context files: {taskDetail?.impactedFiles.length || selectedWorkflow.impactedFiles.length}</div>
                  <div>Tests in scope: {taskDetail?.impactedTests.length || selectedWorkflow.impactedTests.length}</div>
                  <div>Docs in scope: {taskDetail?.impactedDocs.length || selectedWorkflow.impactedDocs.length}</div>
                </div>
              </div>

              <div className="rounded-[18px] border border-white/8 bg-black/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Workflow Summary</div>
                <div className="mt-2 text-sm leading-6 text-white">{taskDetail?.workflowSummary || "Select review or execute to deepen the workflow context."}</div>
                {taskDetail?.blockers?.length ? (
                  <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/8 p-3 text-xs text-amber-100">{taskDetail.blockers[0]}</div>
                ) : null}
              </div>
            </div>

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
          </div>
        ) : activeMode === "approval" ? (
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
        ) : activeMode === "run" ? (
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
            {mission.shareReport?.summary ? (
              <div className="rounded-[18px] border border-white/8 bg-black/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Shareable Summary</div>
                <div className="mt-2 text-sm text-zinc-200">{mission.shareReport.summary}</div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
            <div className="rounded-[18px] border border-white/8 bg-black/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Overseer</div>
                  <div className="mt-1 text-sm font-medium text-white">
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
        )}
      </Panel>
    </div>
  );
}

function countCommentThread(comments: TaskDetail["comments"]) {
  return comments.reduce((count, comment) => count + 1 + countCommentThread(comment.replies), 0);
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

function ConnectSurface({
  recentProjects,
  recentRepoPaths,
  activateRepo,
  openRecentPath,
  chooseLocalRepo,
  openProjects,
  hasDesktopPicker,
  repoPickerMessage,
}: {
  recentProjects: MissionData["recentRepos"];
  recentRepoPaths: MissionData["recentRepoPaths"];
  activateRepo: MissionData["activateRepo"];
  openRecentPath: MissionData["connectRecentPath"];
  chooseLocalRepo: MissionData["chooseLocalRepo"];
  openProjects: MissionData["openProjects"];
  hasDesktopPicker: boolean;
  repoPickerMessage: string | null;
}) {
  return (
    <>
      <Panel className="border-white/8">
        <PanelHeader title="Recent Projects">
          <Chip variant="subtle" className="text-[10px]">
            {recentProjects.length || recentRepoPaths.length}
          </Chip>
        </PanelHeader>
        <div className="p-4 space-y-3">
          {recentProjects.length ? (
            recentProjects.slice(0, 4).map((repo) => (
              <button
                key={repo.id}
                onClick={() => activateRepo(repo.id)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/20 px-4 py-3 text-left hover:bg-white/[0.04]"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white">{repo.displayName}</div>
                  <div className="truncate text-xs text-zinc-500">{repo.branch || repo.defaultBranch || "main"}</div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-zinc-500" />
              </button>
            ))
          ) : recentRepoPaths.length ? (
            recentRepoPaths.slice(0, 4).map((item) => (
              <button
                key={item.path}
                onClick={() => openRecentPath(item.path, item.label)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/20 px-4 py-3 text-left hover:bg-white/[0.04]"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white">{item.label}</div>
                  <div className="truncate text-xs text-zinc-500">{item.path}</div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-zinc-500" />
              </button>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-white/8 px-4 py-8 text-center text-sm text-zinc-500">
              No recent repos yet. Connect one local repo and it will appear here.
            </div>
          )}
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <ProofCard
          icon={<Sparkles className="h-4 w-4 text-violet-400" />}
          title="Route"
          body="Start with one command. The Overseer picks the route and keeps the parent context intact."
        />
        <ProofCard
          icon={<TestTube2 className="h-4 w-4 text-cyan-300" />}
          title="Verify"
          body="Verification stays tied to tests, docs, and project policy instead of generic agent output."
        />
        <ProofCard
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />}
          title="Prove"
          body="Runs end with evidence and a report, not claims."
        />
      </div>

      {repoPickerMessage && !hasDesktopPicker ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-400">
          {repoPickerMessage}
          <button onClick={openProjects} className="ml-2 text-cyan-300 hover:text-cyan-200">
            Open Projects
          </button>
        </div>
      ) : null}

      <button onClick={chooseLocalRepo} className="hidden" aria-hidden="true" />
    </>
  );
}

function SmallMetric({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#161618] px-3 py-1.5 text-[10px] uppercase tracking-[0.12em] text-zinc-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <span className="text-zinc-500">{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function CommandRuleCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-white/8 bg-[#111113] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-sm text-zinc-200">{value}</div>
    </div>
  );
}

function DetailBlock({ label, items, empty }: { label: string; items: string[]; empty: string }) {
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

function MetaStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] border border-white/8 bg-black/20 px-2.5 py-2.5">
      <div className="text-[9px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-0.5 text-[13px] leading-5 text-zinc-200">{value}</div>
    </div>
  );
}

function ProofCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
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

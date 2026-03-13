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
  ChevronDown,
  ChevronUp,
  FileCode2,
  FileSearch,
  FolderClock,
  FolderGit2,
  Github,
  MessageSquareText,
  PanelRightClose,
  PanelLeftOpen,
  Play,
  ScrollText,
  SendHorizontal,
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
import { ProcessingIndicator } from "../ui/processing-indicator";
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

function readExecutionProfileSnapshot(metadata: Record<string, unknown> | null | undefined) {
  const record = (metadata?.execution_profile_snapshot ?? null) as
    | {
        profileId?: unknown;
        profileName?: unknown;
        stages?: Array<{
          stage?: unknown;
          role?: unknown;
          providerId?: unknown;
          model?: unknown;
        }>;
      }
    | null;

  if (!record || typeof record.profileId !== "string" || typeof record.profileName !== "string" || !Array.isArray(record.stages)) {
    return null;
  }

  const stages = record.stages
    .map((stage) =>
      typeof stage?.stage === "string" &&
      typeof stage?.role === "string" &&
      typeof stage?.providerId === "string" &&
      typeof stage?.model === "string"
        ? {
            stage: stage.stage,
            role: stage.role,
            providerId: stage.providerId,
            model: stage.model,
          }
        : null
    )
    .filter(Boolean) as Array<{
    stage: string;
    role: string;
    providerId: string;
    model: string;
  }>;

  if (!stages.length) {
    return null;
  }

  return {
    profileId: record.profileId,
    profileName: record.profileName,
    stages,
  };
}

export function CommandCenterView({ mission }: { mission: MissionData }) {
  const selectedWorkflowId = useUiStore((state) => state.selectedWorkflowId);
  const selectedWorkflowStatus = useUiStore((state) => state.selectedWorkflowStatus);
  const workflowViewMode = useUiStore((state) => state.workflowViewMode);
  const commandDrawerMode = useUiStore((state) => state.commandDrawerMode);
  const setActiveSection = useUiStore((state) => state.setActiveSection);
  const setCodebaseScope = useUiStore((state) => state.setCodebaseScope);
  const setSelectedWorkflowId = useUiStore((state) => state.setSelectedWorkflowId);
  const setWorkflowViewMode = useUiStore((state) => state.setWorkflowViewMode);
  const setCommandDrawerMode = useUiStore((state) => state.setCommandDrawerMode);
  const [commentDraft, setCommentDraft] = useState("");
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [contextPanelOpen, setContextPanelOpen] = useState(false);

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

  const showOutcomeDebrief = Boolean(
    mission.verification ||
      mission.shareReport?.summary ||
      (mission.runSummary?.status && !["idle", "planned"].includes(mission.runSummary.status.toLowerCase()))
  );

  const detailPinned = contextPanelOpen && commandDrawerMode !== "overseer";

  function selectWorkflow(workflowId: string, options?: { openDrawer?: boolean }) {
    const openDrawer = options?.openDrawer ?? false;
    if (openDrawer) {
      setSelectedWorkflowId(workflowId);
      mission.setSelectedTicketId(workflowId);
      setCommandDrawerMode("task");
      setContextPanelOpen(true);
      return;
    }

    if (detailPinned && selectedWorkflowId === workflowId) {
      return;
    }

    const nextWorkflowId = workflowId === selectedWorkflowId ? null : workflowId;
    setSelectedWorkflowId(nextWorkflowId);
    mission.setSelectedTicketId(nextWorkflowId);
    if (!nextWorkflowId) {
      setCommandDrawerMode("overseer");
    }
  }

  function openApprovalContext(workflowId?: string | null) {
    const targetWorkflowId = workflowId || selectedWorkflowId || mission.selectedTicket?.id || null;
    if (targetWorkflowId) {
      setSelectedWorkflowId(targetWorkflowId);
      mission.setSelectedTicketId(targetWorkflowId);
    }
    setCommandDrawerMode("approval");
    setContextPanelOpen(true);
  }

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4",
        contextPanelOpen ? "xl:grid-cols-[minmax(0,1fr)_352px]" : "xl:grid-cols-1"
      )}
    >
      <div className="min-w-0 space-y-4">
        {mission.selectedRepo ? (
          <div className="flex items-center justify-end">
            {contextPanelOpen ? (
              <button
                onClick={() => setContextPanelOpen(false)}
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
              >
                <PanelRightClose className="h-3.5 w-3.5" />
                Hide Context
              </button>
            ) : null}
          </div>
        ) : null}

        <OverseerCommandCard
          mission={mission}
          attentionCount={attentionCount}
          onOpenProjects={mission.openProjects}
          onOpenSettings={() => setActiveSection("settings")}
          onOpenConsole={() => setActiveSection("console")}
          onOpenCodebaseScope={(scope) => {
            setCodebaseScope(scope);
            setActiveSection("codebase");
          }}
          onOpenApprovals={openApprovalContext}
        />

        {mission.selectedRepo ? (
          <>
            <Panel className="border-white/8">
              <PanelHeader
                title={
                  <span className="inline-flex items-center gap-2">
                    <img src="/assets/autonomous-kanban.svg" alt="" className="h-4 w-4 opacity-80" aria-hidden="true" />
                    <span>Agent Workflows</span>
                  </span>
                }
              >
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
                          detailPinned={detailPinned}
                          taskDetail={taskDetail}
                          timeline={mission.timeline}
                          contextPack={mission.contextPack}
                          onSelectWorkflow={(workflowId, openDrawer) => selectWorkflow(workflowId, { openDrawer })}
                          onOpenApprovals={openApprovalContext}
                          onMoveWorkflow={(item, nextLane, beforeWorkflowId) => {
                            if (item.status === nextLane && !beforeWorkflowId) return;
                            mission.moveWorkflow(toMoveRequest(item, nextLane, beforeWorkflowId ?? null));
                          }}
                          onAddTaskComment={mission.addTaskComment}
                          isCommenting={mission.isCommenting}
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
                            detailPinned={detailPinned}
                            contextPack={item.workflowId === selectedWorkflowId ? mission.contextPack : null}
                            taskDetail={item.workflowId === selectedWorkflowId ? taskDetail : null}
                            timeline={item.workflowId === selectedWorkflowId ? mission.timeline : []}
                            onToggleExpand={() => selectWorkflow(item.workflowId)}
                            onOpenDetail={() => selectWorkflow(item.workflowId, { openDrawer: true })}
                            onOpenApprovals={openApprovalContext}
                            onMove={(nextLane, beforeWorkflowId) =>
                              mission.moveWorkflow(toMoveRequest(item, nextLane, beforeWorkflowId ?? null))
                            }
                            onAddTaskComment={mission.addTaskComment}
                            isCommenting={mission.isCommenting}
                            subtle={false}
                          />
                        ))
                      )}
                  </div>
                )}
              </div>
            </Panel>

            {showOutcomeDebrief ? (
              <OutcomeDebriefDrawer
                runSummary={mission.runSummary}
                verification={mission.verification}
                shareReport={mission.shareReport}
                blueprint={mission.blueprint}
              />
            ) : null}
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

      {contextPanelOpen ? (
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
      ) : null}
    </div>
  );
}

function OverseerCommandCard({
  mission,
  attentionCount,
  onOpenProjects,
  onOpenSettings,
  onOpenConsole,
  onOpenCodebaseScope,
  onOpenApprovals,
}: {
  mission: MissionData;
  attentionCount: number;
  onOpenProjects: () => void;
  onOpenSettings: () => void;
  onOpenConsole: () => void;
  onOpenCodebaseScope: (scope: "context" | "tests" | "docs") => void;
  onOpenApprovals: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const route = mission.route;
  const contextPack = mission.contextPack;
  const hasInput = Boolean(mission.input.trim());
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
    ? Math.round(((mission.route?.metadata?.confidence as number | undefined) || contextPack?.confidence || 0.68) * 100)
    : Math.round((contextPack?.confidence || 0.38) * 100);
  const routeStatus = mission.isExecuting
    ? "Running execution pipeline..."
    : mission.isReviewing
    ? "Scoping objective and context..."
    : route && contextPack
    ? "Route ready for execution."
    : contextPack
    ? "Context pack ready for route review"
    : "Awaiting context pack";
  const primaryAction =
    !mission.selectedRepo || !hasInput || mission.isExecuting || mission.isReviewing || !hasRouteContext
      ? mission.reviewRoute
      : mission.executeRoute;
  const primaryLabel = mission.isExecuting
    ? "Starting..."
    : mission.isReviewing
    ? "Scoping..."
    : !hasRouteContext
    ? "Scope Ticket"
    : selectedTicketStatus === "review"
    ? "Resume Review"
    : selectedTicketStatus === "in_progress"
    ? "Continue Work"
    : "Start Work";
  const stageHint =
    currentStage === "scope"
      ? "We’ll create a backlog ticket from this objective using the project blueprint."
      : currentStage === "build"
      ? "Route scoped. Start work to move the ticket into active execution."
      : currentStage === "review"
      ? "Execution needs review follow-up before the workflow can close."
      : "Verification passed and the workflow is ready to close out.";
  const lifecycleSummary = mission.selectedExecutionProfile
    ? (["scope", "build", "review", "escalate"] as const)
        .map((stage) => `${stage}: ${mission.roleLabels[mission.selectedExecutionProfileStages[stage]]}`)
        .join(" · ")
    : "Lifecycle profile pending";
  const isPatchTimeout =
    (mission.actionMessage || "").toLowerCase().includes("timed out while generating patch") ||
    (mission.actionMessage || "").toLowerCase().includes("generic patch generation timed out");

  return (
    <Panel className="border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.08),transparent_24%),radial-gradient(circle_at_top_right,rgba(168,85,247,0.10),transparent_22%),#111113] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />
      <div className="space-y-3.5 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.26em] text-zinc-500">
                <img src="/assets/hypercube.svg" alt="" className="h-3.5 w-3.5 opacity-80" aria-hidden="true" />
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
            <div className="flex max-w-[420px] flex-wrap items-center justify-end gap-2">
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

          {mission.selectedRepo ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400">
              <span className="inline-flex items-center gap-2">
                {mission.isExecuting || mission.isReviewing ? (
                  <ProcessingIndicator
                    kind={mission.isExecuting ? "processing" : "thinking"}
                    active
                    size="xs"
                    tone="subtle"
                  />
                ) : null}
                {routeStatus}
              </span>
              <button
                type="button"
                onClick={() => setShowDetails((value) => !value)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
              >
                Details
                {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            </div>
          ) : null}

          {mission.selectedRepo && showDetails ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-[11px] text-zinc-300">
              <div className="flex flex-wrap items-center gap-2">
                <Chip variant="subtle" className="text-[10px]">
                  {route ? `${executionModeLabel(route.executionMode)} · ${modelRoleLabel(route.modelRole)}` : "Route pending"}
                </Chip>
                <Chip variant="subtle" className="text-[10px]">
                  {mission.selectedExecutionProfile ? `Profile · ${mission.selectedExecutionProfile.name}` : "Profile pending"}
                </Chip>
                <Chip variant="subtle" className="text-[10px]">
                  {routeConfidence}% confidence
                </Chip>
                <Chip variant="subtle" className="text-[10px]">
                  Stage · {currentStage}
                </Chip>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-zinc-400">
                <span>{stageHint}</span>
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
                >
                  Lifecycle Models
                </button>
              </div>
              <div className="mt-1.5 text-zinc-500">{lifecycleSummary}</div>
            </div>
          ) : null}

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
                    <SmallMetric
                      icon={<img src="/assets/hypercube.svg" alt="" aria-hidden="true" className="h-3.5 w-3.5 opacity-90" />}
                      label={`Context ${contextPack?.files.length || 0} files`}
                      onClick={() => onOpenCodebaseScope("context")}
                      disabled={!contextPack?.files.length}
                    />
                    <SmallMetric
                      icon={<img src="/assets/benchmark-reactor.svg" alt="" aria-hidden="true" className="h-3.5 w-3.5 opacity-90" />}
                      label={`${contextPack?.tests.length || 0} tests`}
                      onClick={() => onOpenCodebaseScope("tests")}
                      disabled={!contextPack?.tests.length}
                    />
                    <SmallMetric
                      icon={<img src="/assets/structural-blueprint.svg" alt="" aria-hidden="true" className="h-3.5 w-3.5 opacity-90" />}
                      label={`${contextPack?.docs.length || 0} docs`}
                      onClick={() => onOpenCodebaseScope("docs")}
                      disabled={!contextPack?.docs.length}
                    />
                    <SmallMetric
                      icon={<img src="/assets/aegis-eye.svg" alt="" aria-hidden="true" className="h-3.5 w-3.5 opacity-90" />}
                      label={`${mission.pendingApprovals.length} approvals`}
                      onClick={onOpenApprovals}
                      disabled={!mission.pendingApprovals.length}
                    />
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
                <div className="ml-auto flex min-w-[300px] flex-wrap items-center justify-end gap-2">
                  <select
                    value={mission.selectedExecutionProfileId}
                    onChange={(event) => mission.setExecutionProfile(event.target.value)}
                    disabled={!mission.selectedRepo || mission.isUpdatingExecutionProfile}
                    className="min-w-[130px] rounded-xl border border-white/10 bg-[#111113] px-3 py-2 text-xs text-zinc-100 outline-none disabled:cursor-not-allowed"
                  >
                    {mission.executionProfiles.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                  {mission.isUpdatingExecutionProfile ? (
                    <div className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/8 px-2.5 py-2 text-[10px] uppercase tracking-[0.16em] text-cyan-200">
                      <ProcessingIndicator kind="processing" active size="xs" tone="accent" />
                      Updating profile
                    </div>
                  ) : null}
                  <button
                    onClick={primaryAction}
                    disabled={mission.isActing || !hasInput || !mission.selectedRepo}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-3.5 py-2 text-xs font-medium text-white shadow-[0_0_18px_rgba(6,182,212,0.16)] hover:bg-cyan-500 disabled:opacity-50"
                  >
                    {mission.isExecuting || mission.isReviewing ? (
                      <ProcessingIndicator kind={mission.isExecuting ? "processing" : "thinking"} active size="xs" tone="accent" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    {primaryLabel}
                  </button>
                  {hasRouteContext ? (
                    <button
                      onClick={mission.reviewRoute}
                      disabled={mission.isActing || !hasInput || !mission.selectedRepo}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs text-zinc-200 hover:bg-white/[0.08] disabled:opacity-50"
                    >
                      <FileSearch className="h-3.5 w-3.5" />
                      Re-scope
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          {mission.actionMessage ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs text-zinc-300">
              <div>{mission.actionMessage}</div>
              {isPatchTimeout ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={mission.executeRoute}
                    disabled={mission.isActing || !hasInput || !mission.selectedRepo}
                    className="rounded-lg border border-cyan-500/20 bg-cyan-500/8 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-cyan-200 transition hover:bg-cyan-500/14 disabled:opacity-50"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={mission.reviewRoute}
                    disabled={mission.isActing || !hasInput || !mission.selectedRepo}
                    className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-zinc-300 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
                  >
                    Retry Smaller Scope
                  </button>
                  <button
                    type="button"
                    onClick={onOpenConsole}
                    className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
                  >
                    Open Console
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {mission.repoPickerMessage ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-sm text-amber-100">
              {mission.repoPickerMessage}
            </div>
          ) : null}
      </div>
    </Panel>
  );
}

function WorkflowLane({
  lane,
  emphasized,
  selectedWorkflowId,
  detailPinned,
  taskDetail,
  timeline,
  contextPack,
  onSelectWorkflow,
  onOpenApprovals,
  onMoveWorkflow,
  onAddTaskComment,
  isCommenting,
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
  detailPinned: boolean;
  taskDetail: TaskDetail;
  timeline: MissionData["timeline"];
  contextPack: MissionData["contextPack"] | null;
  onSelectWorkflow: (workflowId: string, openDrawer: boolean) => void;
  onOpenApprovals: (workflowId?: string | null) => void;
  onMoveWorkflow: (item: WorkflowCardItem, nextLane: WorkflowLaneKey, beforeWorkflowId?: string | null) => void;
  onAddTaskComment: (taskId: string, body: string, parentCommentId?: string | null) => void;
  isCommenting: boolean;
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
            <span className={cn("h-2.5 w-2.5 rounded-full", meta.dotClass)} />
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
              detailPinned={detailPinned}
              contextPack={item.workflowId === selectedWorkflowId ? contextPack : null}
              taskDetail={item.workflowId === selectedWorkflowId ? taskDetail : null}
              timeline={item.workflowId === selectedWorkflowId ? timeline : []}
              onToggleExpand={() => onSelectWorkflow(item.workflowId, false)}
              onOpenDetail={() => onSelectWorkflow(item.workflowId, true)}
              onOpenApprovals={() => onOpenApprovals(item.workflowId)}
              onMove={(nextLane, beforeWorkflowId) => onMoveWorkflow(item, nextLane, beforeWorkflowId)}
              onAddTaskComment={onAddTaskComment}
              isCommenting={isCommenting}
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
  detailPinned,
  contextPack,
  taskDetail,
  timeline,
  onToggleExpand,
  onOpenDetail,
  onOpenApprovals,
  onMove,
  onAddTaskComment,
  isCommenting,
  subtle,
}: {
  item: WorkflowCardItem;
  lane: WorkflowLaneKey;
  active: boolean;
  expanded: boolean;
  detailPinned: boolean;
  contextPack: MissionData["contextPack"] | null;
  taskDetail: TaskDetail;
  timeline: MissionData["timeline"];
  onToggleExpand: () => void;
  onOpenDetail: () => void;
  onOpenApprovals: () => void;
  onMove: (nextLane: WorkflowLaneKey, beforeWorkflowId?: string | null) => void;
  onAddTaskComment: (taskId: string, body: string, parentCommentId?: string | null) => void;
  isCommenting: boolean;
  subtle: boolean;
}) {
  const setActiveSection = useUiStore((state) => state.setActiveSection);
  const setCodebaseScope = useUiStore((state) => state.setCodebaseScope);
  const meta = laneMetaFor(lane);
  const [{ isDragging }, dragRef] = useDrag(
    () => ({
      type: DND_TYPE,
      item,
      canDrag: () => !expanded,
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
      }),
    }),
    [expanded, item]
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
  const [noteDraft, setNoteDraft] = useState("");

  const events = timeline.filter((event) => event.task_id === item.workflowId).slice(-3);
  const allowedTransitions = allowedMoves(item.status);
  const hasImpactSummary = item.impactedFiles.length > 0 || item.impactedTests.length > 0 || item.impactedDocs.length > 0;
  const linkedFiles = taskDetail?.impactedFiles.length ? taskDetail.impactedFiles : contextPack?.files.length ? contextPack.files : item.impactedFiles;
  const linkedTests = taskDetail?.impactedTests.length ? taskDetail.impactedTests : contextPack?.tests.length ? contextPack.tests : item.impactedTests;
  const linkedDocs = taskDetail?.impactedDocs.length ? taskDetail.impactedDocs : contextPack?.docs.length ? contextPack.docs : item.impactedDocs;
  const latestEvent = events.length ? events[events.length - 1] : null;
  const verificationSignalCount = taskDetail?.verification.length ?? 0;
  const commentCount = countCommentThread(taskDetail?.comments ?? []);
  const recentComments = taskDetail?.comments.slice(-2) ?? [];
  const verificationLabel =
    lane === "completed"
      ? "verified"
      : item.verificationFailure
      ? "failed"
      : lane === "needs_review"
      ? "review pending"
      : item.verificationState
      ? item.verificationState.replace(/_/g, " ")
      : "pending";
  const executionSnapshotSummary = taskDetail?.route
    ? `${executionModeLabel(taskDetail.route.executionMode)} · ${modelRoleLabel(taskDetail.route.modelRole)}`
    : lane === "completed"
    ? "Execution and verification completed."
    : lane === "needs_review"
    ? item.verificationFailure || "Awaiting review follow-up."
    : lane === "in_progress"
    ? "Execution in progress."
    : item.blockedReason || "Ready to execute.";
  const atAGlanceSummary = lane === "completed"
    ? `Verified with ${verificationSignalCount} signal${verificationSignalCount === 1 ? "" : "s"}.`
    : lane === "needs_review"
    ? item.verificationFailure || taskDetail?.verificationCommand || "Needs review follow-up."
    : lane === "in_progress"
    ? `Working set: ${linkedFiles.length} files · ${linkedTests.length} tests · ${linkedDocs.length} docs.`
    : "Ticket scoped and ready for execution.";
  const openCodebaseScope = (scope: "context" | "tests" | "docs") => {
    setCodebaseScope(scope);
    setActiveSection("codebase");
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
          <button
            type="button"
            onClick={() => {
              if (detailPinned && expanded) return;
              onToggleExpand();
            }}
            className="min-w-0 w-full cursor-pointer rounded-[18px] px-1.5 text-left outline-none transition focus-visible:ring-1 focus-visible:ring-cyan-300/30"
            aria-label={expanded ? "Collapse workflow" : "Expand workflow"}
          >
            <div className="flex items-start justify-between gap-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2.5">
                  <span className={cn("mt-1.5 ml-0.5 h-2 w-2 shrink-0 rounded-full", meta.dotClass)} />
                  <div className="min-w-0 flex-1">
                    <h3 className="line-clamp-2 break-words [overflow-wrap:anywhere] text-[14px] font-semibold leading-5 text-white">{item.title}</h3>
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
                    <p className="mt-1.5 line-clamp-3 break-words [overflow-wrap:anywhere] text-[13px] leading-6 text-zinc-400">{item.subtitle}</p>
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
              {item.executionProfileOverrideName ? (
                <Chip
                  variant="subtle"
                  className="px-2 py-1 border-cyan-500/18 bg-cyan-500/8 text-[9px] text-cyan-100"
                  title={`Ticket override: ${item.executionProfileOverrideName}`}
                >
                  Profile · {item.executionProfileOverrideName}
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
                  {lane === "completed" ? "Impact captured" : lane === "needs_review" ? "Review context pending" : "Impact pending"}
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
                {item.verificationFailure || "Awaiting review follow-up"}
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
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="overflow-hidden border-t border-white/6 bg-black/[0.08]">
          <div className="space-y-2.5 px-3 pb-3.5 pt-3">
            <div className="grid grid-cols-2 gap-1.5">
              <MetaStat label="Priority" value={item.priority} />
              <MetaStat label="Risk" value={item.risk} />
              <MetaStat label="Status" value={STATUS_LABELS[item.rawStatus] || item.rawStatus} />
              <MetaStat label="Verification" value={verificationLabel} />
            </div>

            <div className="rounded-[16px] border border-white/8 bg-black/20 p-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Execution Snapshot</div>
                  <div className="mt-1.5 text-[13px] leading-5 text-white">{executionSnapshotSummary}</div>
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

            <div className="grid grid-cols-2 gap-1.5 xl:grid-cols-4">
              <MiniCountCard
                label="Files"
                value={linkedFiles.length}
                onClick={() => openCodebaseScope("context")}
                disabled={!linkedFiles.length}
              />
              <MiniCountCard
                label="Tests"
                value={linkedTests.length}
                onClick={() => openCodebaseScope("tests")}
                disabled={!linkedTests.length}
              />
              <MiniCountCard
                label="Docs"
                value={linkedDocs.length}
                onClick={() => openCodebaseScope("docs")}
                disabled={!linkedDocs.length}
              />
              <MiniCountCard
                label="Approvals"
                value={taskDetail?.approvals.length ?? 0}
                onClick={onOpenApprovals}
                disabled={!(taskDetail?.approvals.length ?? 0)}
              />
            </div>

            <div className="rounded-[16px] border border-white/8 bg-black/20 p-2.5">
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">At a Glance</div>
              <div className="mt-1.5 space-y-2">
                {taskDetail?.route ? (
                  <div className="text-[13px] leading-5 text-white">
                    {`${executionModeLabel(taskDetail.route.executionMode)} · ${modelRoleLabel(taskDetail.route.modelRole)} · ${providerLabel(taskDetail.route.providerId)}`}
                  </div>
                ) : null}
                <div className="text-[13px] leading-5 text-white">{atAGlanceSummary}</div>
                {latestEvent ? (
                  <div className="flex items-start gap-2 text-xs text-zinc-400">
                    <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
                    <div className="min-w-0">
                      <div className="line-clamp-2">{latestEvent.message}</div>
                      <div className="mt-1 text-[10px] text-zinc-500">
                        {formatDistanceToNow(new Date(latestEvent.timestamp), { addSuffix: true })}
                      </div>
                    </div>
                  </div>
                ) : null}
                {item.verificationFailure ? (
                  <div className="rounded-lg border border-violet-500/18 bg-violet-500/8 px-3 py-2 text-xs text-violet-100">
                    {item.verificationFailure}
                  </div>
                ) : null}
                {taskDetail?.verification.length ? (
                  <div className="text-xs text-zinc-400">
                    {taskDetail.verification.length} verification signals captured
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-[16px] border border-white/8 bg-black/20 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Worker Notes</div>
                <Chip variant="subtle" className="text-[9px]">
                  {commentCount} notes
                </Chip>
              </div>
              <div className="mt-1.5 text-[11px] leading-5 text-zinc-500">
                Notes are included in the next scope/build/review cycle for this ticket.
              </div>
              <textarea
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                placeholder="Add note for AI workers…"
                className="mt-2 min-h-[72px] w-full resize-none rounded-xl border border-white/8 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400/40"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="text-[10px] text-zinc-500">
                  {recentComments.length ? "Recent notes shown below." : "No notes yet."}
                </div>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!noteDraft.trim()) return;
                    onAddTaskComment(item.workflowId, noteDraft.trim(), null);
                    setNoteDraft("");
                  }}
                  disabled={!noteDraft.trim() || isCommenting}
                  className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <SendHorizontal className="h-3.5 w-3.5" />
                  Add Note
                </button>
              </div>
              {recentComments.length ? (
                <div className="mt-2 space-y-1.5">
                  {recentComments.map((comment) => (
                    <div key={comment.id} className="rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-2">
                      <div className="text-[12px] leading-5 text-zinc-300">{comment.body}</div>
                      <div className="mt-1 text-[10px] text-zinc-500">
                        {comment.author} · {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2 pt-0.5">
              {allowedTransitions.map((nextLane) => (
                <button
                  key={`${item.workflowId}-${nextLane}`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onMove(nextLane, null);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-zinc-200 hover:bg-white/[0.08]"
                >
                  Move to {laneMetaFor(nextLane).label}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              ))}
              {detailPinned ? (
                <button
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenDetail();
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/8 px-3 py-2 text-xs text-cyan-100 hover:bg-cyan-500/12"
                >
                  <PanelLeftOpen className="h-3.5 w-3.5" />
                  Open Detail
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function MiniCountCard({
  label,
  value,
  onClick,
  disabled,
}: {
  label: string;
  value: number;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const className =
    "rounded-[12px] border px-2.5 py-2 transition";

  if (!onClick) {
    return (
      <div className={`${className} border-white/8 bg-black/20`}>
        <div className="text-[9px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
        <div className="mt-0.5 text-[22px] font-semibold leading-none text-white">{value}</div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className={`${className} border-white/8 bg-black/20 text-left hover:border-cyan-400/18 hover:bg-cyan-500/[0.06] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-white/8 disabled:hover:bg-black/20`}
    >
      <div className="text-[9px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-0.5 text-[22px] font-semibold leading-none text-white">{value}</div>
    </button>
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
            {(() => {
              const profileSnapshot = readExecutionProfileSnapshot(mission.runSummary?.metadata);
              return (
                <>
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
                </>
              );
            })()}
          </div>
        ) : (
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

function SmallMetric({
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

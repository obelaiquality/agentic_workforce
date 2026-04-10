import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  FileCode2,
  PanelLeftOpen,
  ScrollText,
  SendHorizontal,
  TestTube2,
} from "lucide-react";
import type { MissionData, WorkflowLaneKey, WorkflowCardItem, TaskDetail } from "./types";
import {
  DND_TYPE,
  LANE_META,
  STATUS_LABELS,
  laneMetaFor,
  allowedMoves,
  toMoveRequest,
  progressForCard,
  metricTone,
  lifecycleNoticeToneClass,
  laneSurfaceClass,
  countCommentThread,
} from "./helpers";
import { Chip, Panel, PanelHeader } from "../UI";
import { ProcessingIndicator } from "../ui/processing-indicator";
import { cn } from "../ui/utils";
import { useUiStore } from "../../store/uiStore";
import { executionModeLabel, modelRoleLabel, providerLabel } from "../../lib/missionLabels";

export interface WorkflowBoardProps {
  mission: MissionData;
  workflowCards: WorkflowCardItem[];
  selectedWorkflowId: string | null;
  detailPinned: boolean;
  taskDetail: TaskDetail;
  laneActivity: Array<{
    key: WorkflowLaneKey;
    label: string;
    description: string;
    items: WorkflowCardItem[];
    summary: MissionData["workflowPillars"][number];
    dotClass: string;
    chipClass: string;
    columnClass: string;
    cardAccent: string;
  }>;
  selectedLane: WorkflowLaneKey | null;
  workflowViewMode: "board" | "list";
  onSelectWorkflow: (workflowId: string, options?: { openDrawer?: boolean }) => void;
  onOpenApprovals: (workflowId?: string | null) => void;
  onSetWorkflowViewMode: (mode: "board" | "list") => void;
}

export function WorkflowBoard({
  mission,
  selectedWorkflowId,
  detailPinned,
  taskDetail,
  laneActivity,
  selectedLane,
  workflowViewMode,
  onSelectWorkflow,
  onOpenApprovals,
  onSetWorkflowViewMode,
}: WorkflowBoardProps) {
  return (
    <Panel data-testid="work-task-board" className="border-white/8">
      <PanelHeader
        title={
          <span className="inline-flex items-center gap-2">
            <img src="/assets/autonomous-kanban.svg" alt="" className="h-4 w-4 opacity-80" aria-hidden="true" />
            <span>Task Board</span>
          </span>
        }
      >
        <div className="flex items-center gap-2">
          <div data-testid="work-view-toggle" className="inline-flex items-center rounded-lg border border-white/10 bg-white/[0.03] p-1">
            <button
              onClick={() => onSetWorkflowViewMode("board")}
              className={cn(
                "rounded-md px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] transition-colors",
                workflowViewMode === "board" ? "bg-white/[0.08] text-white" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              Board
            </button>
            <button
              onClick={() => onSetWorkflowViewMode("list")}
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
                  onSelectWorkflow={(workflowId, openDrawer) => onSelectWorkflow(workflowId, { openDrawer })}
                  onOpenApprovals={onOpenApprovals}
                  onMoveWorkflow={(item, nextLane, beforeWorkflowId) => {
                    if (item.status === nextLane && !beforeWorkflowId) return;
                    mission.moveWorkflow(toMoveRequest(item, nextLane, beforeWorkflowId ?? null));
                  }}
                  onAddTaskComment={mission.addTaskComment}
                  isCommenting={mission.isCommenting}
                  ticketLifecycleNotices={mission.ticketLifecycleNotices ?? {}}
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
                    onToggleExpand={() => onSelectWorkflow(item.workflowId)}
                    onOpenDetail={() => onSelectWorkflow(item.workflowId, { openDrawer: true })}
                    onOpenApprovals={() => onOpenApprovals()}
                    onMove={(nextLane, beforeWorkflowId) =>
                      mission.moveWorkflow(toMoveRequest(item, nextLane, beforeWorkflowId ?? null))
                    }
                    onAddTaskComment={mission.addTaskComment}
                    isCommenting={mission.isCommenting}
                    lifecycleNotice={mission.ticketLifecycleNotices?.[item.workflowId] ?? null}
                    subtle={false}
                  />
                ))
              )}
          </div>
        )}
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
  ticketLifecycleNotices,
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
  ticketLifecycleNotices: Record<string, { message: string; tone: "info" | "success" | "warn"; at: string }>;
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
      data-testid={`work-lane-${lane.key}`}
      ref={dropRef}
      className={cn(
        "overflow-hidden rounded-2xl border transition-all",
        meta.columnClass,
        emphasized ? "opacity-100" : "opacity-82",
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
          <div className="rounded-[22px] border border-dashed border-white/6 bg-black/10 px-4 py-10 text-center text-sm text-zinc-600">
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
              lifecycleNotice={ticketLifecycleNotices[item.workflowId] ?? null}
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
  lifecycleNotice,
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
  lifecycleNotice?: { message: string; tone: "info" | "success" | "warn"; at: string } | null;
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
        "overflow-hidden rounded-xl border transition-all",
        laneSurfaceClass(lane),
        meta.cardAccent,
        active ? "ring-1 ring-cyan-300/35 border-cyan-300/28 shadow-[0_0_22px_rgba(34,211,238,0.08)]" : "hover:border-white/14 hover:shadow-[0_0_16px_rgba(255,255,255,0.03)]",
        item.isBlocked ? "border-amber-400/30 shadow-[0_0_0_1px_rgba(245,158,11,0.08),0_0_18px_rgba(245,158,11,0.06)]" : "",
        subtle ? "opacity-94" : "opacity-100",
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

            {lifecycleNotice ? (
              <div
                className={cn(
                  "mt-2.5 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]",
                  lifecycleNoticeToneClass(lifecycleNotice.tone)
                )}
              >
                <ProcessingIndicator
                  kind={
                    lifecycleNotice.tone === "success" ? "verifying" : lifecycleNotice.tone === "warn" ? "provider" : "processing"
                  }
                  size="xs"
                />
                <span className="line-clamp-2">{lifecycleNotice.message}</span>
              </div>
            ) : null}

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

            <div className="rounded-lg bg-white/[0.02] p-2.5">
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

            <div className="rounded-lg bg-white/[0.02] p-2.5">
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

            <div className="rounded-lg bg-white/[0.02] p-2.5">
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

function MetaStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] border border-white/8 bg-black/20 px-2.5 py-2.5">
      <div className="text-[9px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-0.5 text-[13px] leading-5 text-zinc-200">{value}</div>
    </div>
  );
}

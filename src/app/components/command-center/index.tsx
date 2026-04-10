import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PanelRightClose } from "lucide-react";
import type { MissionData, WorkflowLaneKey } from "./types";
import { LANE_META } from "./helpers";
import { useUiStore } from "../../store/uiStore";
import { getMissionTaskDetailV8 } from "../../lib/apiClient";
import { cn } from "../ui/utils";
import { MissionHeaderStrip } from "../mission/MissionHeaderStrip";
import { OutcomeDebriefDrawer } from "../mission/OutcomeDebriefDrawer";

import { ChatPanel } from "./ChatPanel";
import { WorkflowBoard } from "./WorkflowBoard";
import { AgentStatusSidebar } from "./AgentStatusSidebar";
import { ToolCallTimeline } from "./ToolCallTimeline";
import { ApprovalInline } from "./ApprovalInline";

export { ChatPanel } from "./ChatPanel";
export { WorkflowBoard } from "./WorkflowBoard";
export { AgentStatusSidebar } from "./AgentStatusSidebar";
export { ToolCallTimeline } from "./ToolCallTimeline";
export { DiffViewer } from "./DiffViewer";
export { ApprovalInline, SmallMetric, DetailBlock, ProofCard } from "./ApprovalInline";

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

  const selectedLane: WorkflowLaneKey | null = selectedWorkflowStatus === "all" ? null : (selectedWorkflowStatus as WorkflowLaneKey);
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
        return left.workflowId.localeCompare(right.workflowId);
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
          <>
          <MissionHeaderStrip
            repo={mission.selectedRepo}
            liveState={mission.liveState}
            route={mission.route}
            runSummary={mission.runSummary}
            actionCapabilities={mission.actionCapabilities ?? { canRefresh: false, canStop: false, canReview: false, canExecute: false }}
            lastUpdatedAt={mission.lastUpdatedAt ?? null}
            isActing={mission.isActing}
            onRefresh={mission.refreshSnapshot}
            onStop={mission.stopExecution}
          />
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
          </>
        ) : null}

                {mission.selectedRepo ? (
                  <>
            <ChatPanel
              mission={mission}
              attentionCount={attentionCount}
              onOpenCodebaseScope={(scope) => {
                setCodebaseScope(scope);
                setActiveSection("codebase");
              }}
              onOpenApprovals={openApprovalContext}
            />


            {(mission.experimentalAutonomy?.channels?.length > 0 || mission.experimentalAutonomy?.subagents?.length > 0) && (
              <AgentStatusSidebar mission={mission} onOpenSettings={() => setActiveSection("settings")} />
            )}

            <WorkflowBoard
              mission={mission}
              workflowCards={workflowCards}
              selectedWorkflowId={selectedWorkflowId}
              detailPinned={detailPinned}
              taskDetail={taskDetail}
              laneActivity={laneActivity}
              selectedLane={selectedLane}
              workflowViewMode={workflowViewMode}
              onSelectWorkflow={selectWorkflow}
              onOpenApprovals={openApprovalContext}
              onSetWorkflowViewMode={setWorkflowViewMode}
            />

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
          <ApprovalInline
            recentProjects={mission.recentRepos}
            recentRepoPaths={mission.recentRepoPaths}
            activateRepo={mission.activateRepo}
            openRecentPath={mission.connectRecentPath}
            openProjects={mission.openProjects}
            appMode={mission.appMode}
            appModeNotice={mission.appModeNotice}
          />
        )}
      </div>

      {contextPanelOpen ? (
        <ToolCallTimeline
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

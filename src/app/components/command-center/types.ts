import type { WorkflowMoveRequest } from "../../../shared/contracts";
import type { useMissionControlLiveData } from "../../hooks/useMissionControlLiveData";
import type { getMissionTaskDetailV8 } from "../../lib/apiClient";

export type MissionData = ReturnType<typeof useMissionControlLiveData>;
export type WorkflowStatusFilter = "all" | "backlog" | "in_progress" | "needs_review" | "completed";
export type WorkflowLaneKey = Exclude<WorkflowStatusFilter, "all">;
export type WorkflowCardItem = MissionData["workflowCards"][number];
export type TaskDetail = Awaited<ReturnType<typeof getMissionTaskDetailV8>>["item"];

export { type WorkflowMoveRequest };

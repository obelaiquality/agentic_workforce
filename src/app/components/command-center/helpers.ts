import type { WorkflowLaneKey, WorkflowCardItem, WorkflowMoveRequest } from "./types";

export const DND_TYPE = "MISSION_WORKFLOW_CARD";

export const LANE_META: Array<{
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
    columnClass: "border-cyan-500/12 bg-[linear-gradient(180deg,rgba(34,211,238,0.04),rgba(12,12,16,0.96))]",
    cardAccent: "border-cyan-500/14 shadow-[0_0_0_1px_rgba(34,211,238,0.02)]",
  },
  {
    key: "in_progress",
    label: "In Progress",
    description: "Active workflows and execution lanes.",
    dotClass: "bg-fuchsia-400",
    chipClass: "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/20",
    columnClass: "border-fuchsia-500/12 bg-[linear-gradient(180deg,rgba(217,70,239,0.05),rgba(12,12,16,0.96))]",
    cardAccent: "border-fuchsia-500/14 shadow-[0_0_0_1px_rgba(217,70,239,0.03)]",
  },
  {
    key: "needs_review",
    label: "Needs Review",
    description: "Ready for review or verification follow-up.",
    dotClass: "bg-violet-400",
    chipClass: "bg-violet-500/10 text-violet-300 border-violet-500/20",
    columnClass: "border-violet-500/12 bg-[linear-gradient(180deg,rgba(139,92,246,0.05),rgba(12,12,16,0.96))]",
    cardAccent: "border-violet-500/14 shadow-[0_0_0_1px_rgba(139,92,246,0.03)]",
  },
  {
    key: "completed",
    label: "Completed",
    description: "Closed workflows with verified output.",
    dotClass: "bg-emerald-400",
    chipClass: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
    columnClass: "border-emerald-500/12 bg-[linear-gradient(180deg,rgba(16,185,129,0.05),rgba(12,12,16,0.96))]",
    cardAccent: "border-emerald-500/14 shadow-[0_0_0_1px_rgba(16,185,129,0.03)]",
  },
];

export const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In Progress",
  review: "Needs Review",
  blocked: "Blocked",
  done: "Completed",
};

export function laneMetaFor(status: WorkflowLaneKey) {
  return LANE_META.find((item) => item.key === status)!;
}

export function allowedMoves(from: WorkflowLaneKey): WorkflowLaneKey[] {
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

export function toMoveRequest(item: WorkflowCardItem, toStatus: WorkflowLaneKey, beforeWorkflowId: string | null = null): WorkflowMoveRequest {
  return {
    workflowId: item.workflowId,
    fromStatus: item.status,
    toStatus,
    beforeWorkflowId,
  };
}

export function progressForCard(item: WorkflowCardItem) {
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

export function metricTone(status: WorkflowLaneKey) {
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

export function formatAgenticEventLabel(type: string) {
  return type.replace(/_/g, " ");
}

export function lifecycleNoticeToneClass(tone: "info" | "success" | "warn") {
  switch (tone) {
    case "success":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-100";
    case "warn":
      return "border-amber-500/20 bg-amber-500/10 text-amber-100";
    default:
      return "border-cyan-500/20 bg-cyan-500/10 text-cyan-100";
  }
}

export function laneSurfaceClass(lane: WorkflowLaneKey) {
  switch (lane) {
    case "completed":
      return "bg-[linear-gradient(180deg,rgba(16,185,129,0.05),rgba(17,17,22,0.98)_28%)]";
    case "needs_review":
      return "bg-[linear-gradient(180deg,rgba(139,92,246,0.06),rgba(17,17,22,0.98)_28%)]";
    case "in_progress":
      return "bg-[linear-gradient(180deg,rgba(217,70,239,0.06),rgba(17,17,22,0.98)_30%)]";
    default:
      return "bg-[linear-gradient(180deg,rgba(34,211,238,0.05),rgba(17,17,22,0.98)_28%)]";
  }
}

export function readExecutionProfileSnapshot(metadata: Record<string, unknown> | null | undefined) {
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

export function countCommentThread(comments: Array<{ replies: Array<unknown> }>) {
  return comments.reduce(
    (count, comment) => count + 1 + countCommentThread(comment.replies as Array<{ replies: Array<unknown> }>),
    0
  );
}

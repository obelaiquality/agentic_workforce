import { prisma } from "../db";
import { publishEvent } from "../eventBus";
import type {
  AgenticEvent,
  ChannelEventRecord,
  ChatMessageDto,
  ChatSessionDto,
  ConsoleEvent,
  ExecutionRunSummary,
  MissionControlSnapshot,
  MissionUiApprovalCard,
  MissionUiRouteSummary,
  ProviderId,
  RepoRegistration,
  RoutingDecision,
  ShareableRunReport,
  SubagentActivityRecord,
  Ticket,
  VerificationBundle,
  V2CommandLogItem,
  V2PolicyPendingItem,
  WorkflowCardSummary,
  WorkflowStatusPillar,
  WorkflowTaskDetail,
} from "../../shared/contracts";
import { ChatService } from "./chatService";
import { CodeGraphService } from "./codeGraphService";
import { ContextService } from "./contextService";
import { GitHubService } from "./githubService";
import { ProjectBlueprintService } from "./projectBlueprintService";
import { RepoService } from "./repoService";
import { RouterService } from "./routerService";
import { TicketService } from "./ticketService";
import { V2QueryService } from "./v2QueryService";
import { SubtaskService, createPrismaSubtaskPersistence } from "./subtaskService";

interface GetSnapshotInput {
  projectId?: string | null;
  ticketId?: string | null;
  runId?: string | null;
  sessionId?: string | null;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toRecord(value: unknown) {
  return (value ?? {}) as Record<string, unknown>;
}

function summarize(text: string, max = 120) {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 3)}...`;
}

function deriveBriefStatus(ticket: Ticket): "success" | "active" | "failed" {
  if (ticket.status === "blocked") return "failed";
  if (ticket.status === "done" || ticket.status === "review") return "success";
  return "active";
}

function deriveTaskPhase(ticket: Ticket) {
  return ticket.status === "in_progress" ? "implementing" : ticket.status === "review" ? "verifying" : ticket.status.replace(/_/g, " ");
}

function buildRouteSummary(route: RoutingDecision | null): MissionUiRouteSummary | null {
  if (!route) return null;
  return {
    executionMode: route.executionMode,
    providerId: route.providerId,
    modelRole: route.modelRole,
    verificationDepth: route.verificationDepth,
    confidence: Math.max(0.25, Math.min(0.97, 0.45 + route.decompositionScore * 0.4)),
  };
}

function buildApprovals(approvals: V2PolicyPendingItem[], selectedTicketId: string | null): MissionUiApprovalCard[] {
  return approvals.map((approval) => {
    const aggregateId = typeof approval.payload?.aggregate_id === "string" ? approval.payload.aggregate_id : null;
    return {
      approvalId: approval.approval_id,
      actionType: approval.action_type,
      requestedAt: approval.requested_at,
      relevantToCurrentTask: selectedTicketId ? aggregateId === null || aggregateId === selectedTicketId : aggregateId === null,
      reason: approval.reason,
    };
  });
}

function deriveRunPhase(
  runSummary: ExecutionRunSummary | null,
  pendingApprovals: V2PolicyPendingItem[],
  selectedTicket: Ticket | null
): MissionControlSnapshot["runPhase"] {
  if (runSummary?.status === "failed" || selectedTicket?.status === "blocked") return "error";
  if (runSummary?.status === "completed" || runSummary?.status === "verified") return "completed";
  if (pendingApprovals.length > 0) return "single_task_validation";
  if (runSummary?.status === "queued" || runSummary?.status === "planned") return "starting";
  if (runSummary?.status === "running" || selectedTicket?.status === "in_progress") return "parallel_running";
  if (selectedTicket?.status === "review") return "draining";
  return "idle";
}

function buildChangeBriefs(tickets: Ticket[], runSummary: ExecutionRunSummary | null, packFiles: string[]) {
  return tickets.slice(0, 8).map((ticket) => ({
    task_id: ticket.id,
    title: ticket.title,
    status: deriveBriefStatus(ticket),
    summary: summarize(ticket.description || "Objective queued for planning."),
    patches_applied: ticket.id === runSummary?.ticketId ? packFiles.length : 0,
    token_total: 0,
    worker_id: null,
    generated_at: ticket.updatedAt,
    files: ticket.id === runSummary?.ticketId ? packFiles : [],
  }));
}

function buildStreams(tickets: Ticket[], pendingApprovals: V2PolicyPendingItem[], runSummary: ExecutionRunSummary | null) {
  const backlog = tickets.filter((ticket) => ticket.status === "backlog" || ticket.status === "ready").length;
  const inProgress = tickets.filter((ticket) => ticket.status === "in_progress").length;
  const review = tickets.filter((ticket) => ticket.status === "review").length;
  const blocked = tickets.filter((ticket) => ticket.status === "blocked").length;
  const completed = tickets.filter((ticket) => ticket.status === "done").length;
  const focusTicket = tickets.find((ticket) => ticket.status === "in_progress") ?? tickets[0] ?? null;

  return [
    {
      workstream: "Execution",
      risk: (blocked > 0 ? "critical" : inProgress > 0 ? "warn" : "ok") as "critical" | "warn" | "ok",
      queued: backlog,
      in_progress: inProgress,
      blocked,
      failed: blocked,
      completed,
      top_task_id: focusTicket?.id ?? null,
    },
    {
      workstream: "Verification",
      risk: (pendingApprovals.length > 0 ? "warn" : review > 0 ? "warn" : "ok") as "critical" | "warn" | "ok",
      queued: review,
      in_progress: runSummary?.status === "queued" ? 1 : 0,
      blocked: pendingApprovals.length,
      failed: 0,
      completed: runSummary?.status === "completed" || runSummary?.status === "verified" ? 1 : 0,
      top_task_id: focusTicket?.id ?? null,
    },
    {
      workstream: "Approvals",
      risk: (pendingApprovals.length > 0 ? "critical" : "ok") as "critical" | "warn" | "ok",
      queued: pendingApprovals.length,
      in_progress: 0,
      blocked: 0,
      failed: 0,
      completed: 0,
      top_task_id: focusTicket?.id ?? null,
    },
  ];
}

function mapCommandSeverity(command: V2CommandLogItem): "INFO" | "WARNING" | "ERROR" {
  if (command.status === "failed" || command.status === "rejected") return "ERROR";
  if (command.status === "queued") return "WARNING";
  return "INFO";
}

function buildTimeline(commands: V2CommandLogItem[], approvals: V2PolicyPendingItem[]) {
  const commandEvents = commands.slice(0, 18).map((command) => ({
    id: command.id,
    phase: (command.command_type === "execution.request" ? "parallel_running" : "single_task_validation") as MissionControlSnapshot["runPhase"],
    severity: mapCommandSeverity(command),
    kind: command.command_type,
    timestamp: command.created_at,
    message: summarize(`${command.command_type} ${command.status}`, 96),
    task_id: command.aggregate_id ?? undefined,
  }));

  const approvalEvents = approvals.slice(0, 8).map((approval) => ({
    id: approval.approval_id,
    phase: "single_task_validation" as MissionControlSnapshot["runPhase"],
    severity: (approval.status === "pending" ? "WARNING" : approval.status === "rejected" ? "ERROR" : "INFO") as
      | "INFO"
      | "WARNING"
      | "ERROR",
    kind: approval.action_type,
    timestamp: approval.requested_at,
    message: approval.reason || `${approval.action_type} ${approval.status}`,
    task_id: typeof approval.payload?.aggregate_id === "string" ? approval.payload.aggregate_id : undefined,
  }));

  return [...commandEvents, ...approvalEvents]
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, 24)
    .reverse();
}

function mapAgenticTimelineEvent(row: { id: string; kind: string; payload: unknown; createdAt: Date }) {
  const payload = toRecord(row.payload);
  const event = toRecord(payload.event);
  const taskId =
    (typeof payload.ticketId === "string" ? payload.ticketId : null) ||
    (typeof payload.ticket_id === "string" ? payload.ticket_id : null) ||
    undefined;

  let phase: MissionControlSnapshot["runPhase"] = "parallel_running";
  let severity: "INFO" | "WARNING" | "ERROR" = "INFO";
  let message = row.kind.replace(/_/g, " ");

  switch (row.kind) {
    case "tool_approval_needed":
      phase = "single_task_validation";
      severity = "WARNING";
      message = typeof event.message === "string" ? event.message : "Agentic tool approval required.";
      break;
    case "tool_denied":
    case "doom_loop_detected":
    case "budget_warning":
      severity = "WARNING";
      message = typeof event.reason === "string" ? event.reason : message;
      break;
    case "execution_aborted":
    case "error":
      phase = "error";
      severity = "ERROR";
      message =
        (typeof event.reason === "string" ? event.reason : null) ||
        (typeof event.error === "string" ? event.error : null) ||
        "Agentic execution failed.";
      break;
    case "execution_complete":
      phase = "completed";
      message = typeof event.finalMessage === "string" ? summarize(event.finalMessage, 96) : "Agentic execution completed.";
      break;
    case "context_compacted":
      message = "Context compacted to keep the run moving.";
      break;
    case "escalating":
      message =
        typeof event.toRole === "string" ? `Escalated to ${event.toRole.replace(/_/g, " ")}.` : "Escalated agent role.";
      break;
    case "iteration_start":
      message =
        typeof event.iteration === "number" ? `Iteration ${event.iteration} started.` : "Agentic iteration started.";
      break;
    default:
      message = summarize(message, 96);
      break;
  }

  return {
    id: row.id,
    phase,
    severity,
    kind: `agentic.${row.kind}`,
    timestamp: row.createdAt.toISOString(),
    message,
    task_id: taskId,
  };
}

function buildAgenticRunSnapshot(input: {
  runId: string;
  ticketId: string | null;
  projectId: string | null;
  runSummary: ExecutionRunSummary | null;
  rows: Array<{ id: string; runId: string | null; kind: string; payload: unknown; createdAt: Date }>;
}): MissionControlSnapshot["agenticRun"] {
  if (!input.runId) {
    return null;
  }

  const recentEvents = input.rows
    .slice(-12)
    .map((row) => {
      const payload = toRecord(row.payload);
      const event = toRecord(payload.event);
      return {
        id: row.id,
        runId: input.runId,
        ticketId:
          (typeof payload.ticketId === "string" ? payload.ticketId : null) ||
          (typeof payload.ticket_id === "string" ? payload.ticket_id : null) ||
          input.ticketId,
        projectId:
          (typeof payload.projectId === "string" ? payload.projectId : null) ||
          (typeof payload.project_id === "string" ? payload.project_id : null) ||
          input.projectId,
        type: row.kind as AgenticEvent["type"],
        createdAt: row.createdAt.toISOString(),
        payload: event,
      };
    });

  let iterationCount = 0;
  let toolCallCount = 0;
  let approvalCount = 0;
  let deniedCount = 0;
  let compactionCount = 0;
  let doomLoopCount = 0;
  let escalationCount = 0;
  let thinkingTokenCount = 0;
  let lastReason: string | null = null;
  let latestRole = input.runSummary?.modelRole ?? null;
  let lastAssistantText =
    (typeof input.runSummary?.metadata?.final_message === "string" ? input.runSummary?.metadata?.final_message : null) ?? null;
  const metadata = toRecord(input.runSummary?.metadata);
  const budget = toRecord(metadata.budget);
  const pendingToolCalls = new Map<string, { iteration: number; name: string; args: Record<string, unknown>; timestamp: string }>();
  const toolCalls: NonNullable<MissionControlSnapshot["agenticRun"]>["toolCalls"] = [];
  const compactionEvents: NonNullable<MissionControlSnapshot["agenticRun"]>["compactionEvents"] = [];
  const escalations: NonNullable<MissionControlSnapshot["agenticRun"]>["escalations"] = [];
  const doomLoops: NonNullable<MissionControlSnapshot["agenticRun"]>["doomLoops"] = [];
  const skillEvents = new Map<string, NonNullable<MissionControlSnapshot["agenticRun"]>["skillEvents"][number]>();
  const hookEvents: NonNullable<MissionControlSnapshot["agenticRun"]>["hookEvents"] = [];
  const memoryExtractions: NonNullable<MissionControlSnapshot["agenticRun"]>["memoryExtractions"] = [];
  const thinkingLog: string[] = [];
  const tokenTimeline: Array<{ iteration: number; tokens: number; timestamp: string }> = [];
  let phase = metadata.agentic_plan_phase === "planning" ||
    metadata.agentic_plan_phase === "plan_review" ||
    metadata.agentic_plan_phase === "executing" ||
    metadata.agentic_plan_phase === "completed" ||
    metadata.agentic_plan_phase === "failed" ||
    metadata.agentic_plan_phase === "aborted"
      ? metadata.agentic_plan_phase
      : ("executing" as const);
  const plan = metadata.agenticPlan && typeof metadata.agenticPlan === "object"
    ? metadata.agenticPlan as NonNullable<MissionControlSnapshot["agenticRun"]>["plan"]
    : null;

  for (const row of input.rows) {
    const payload = toRecord(row.payload);
    const event = toRecord(payload.event);

    if (row.kind === "iteration_start" && typeof event.iteration === "number") {
      iterationCount = Math.max(iterationCount, event.iteration);
    }
    if (row.kind === "tool_use_started") {
      toolCallCount += 1;
      pendingToolCalls.set(String(event.id || row.id), {
        iteration: iterationCount || 1,
        name: typeof event.name === "string" ? event.name : row.kind,
        args: toRecord(event.input),
        timestamp: row.createdAt.toISOString(),
      });
    }
    if (row.kind === "tool_approval_needed") {
      approvalCount += 1;
      if (typeof event.message === "string") {
        lastReason = event.message;
      }
      toolCalls.push({
        id: typeof event.id === "string" ? event.id : row.id,
        iteration: iterationCount || 1,
        name: typeof event.name === "string" ? event.name : "unknown",
        args: {},
        result: {
          type: "approval_required",
          approvalId: typeof event.approvalId === "string" ? event.approvalId : "",
          message: typeof event.message === "string" ? event.message : "Approval required",
        },
        policyDecision: "approval_required",
        durationMs: 0,
        timestamp: row.createdAt.toISOString(),
      });
    }
    if (row.kind === "tool_denied") {
      deniedCount += 1;
      toolCalls.push({
        id: typeof event.id === "string" ? event.id : row.id,
        iteration: iterationCount || 1,
        name: typeof event.name === "string" ? event.name : "unknown",
        args: {},
        result: {
          type: "error",
          error: Array.isArray(event.reasons) ? event.reasons.join("; ") : "Denied by policy",
        },
        policyDecision: "deny",
        durationMs: 0,
        timestamp: row.createdAt.toISOString(),
      });
    }
    if (row.kind === "context_compacted") {
      compactionCount += 1;
      compactionEvents.push({
        iteration: iterationCount || 1,
        stage: typeof event.stage === "number" || typeof event.stage === "string" ? event.stage : "unknown",
        tokensBefore: typeof event.tokensBefore === "number" ? event.tokensBefore : 0,
        tokensAfter: typeof event.tokensAfter === "number" ? event.tokensAfter : 0,
        timestamp: row.createdAt.toISOString(),
      });
    }
    if (row.kind === "doom_loop_detected") {
      doomLoopCount += 1;
      if (typeof event.reason === "string") {
        lastReason = event.reason;
      }
      doomLoops.push({
        iteration: iterationCount || 1,
        reason: typeof event.reason === "string" ? event.reason : "Loop detected",
        suggestion: typeof event.suggestion === "string" ? event.suggestion : "",
        timestamp: row.createdAt.toISOString(),
      });
    }
    if (row.kind === "escalating") {
      escalationCount += 1;
      if (typeof event.toRole === "string") {
        latestRole = event.toRole as ExecutionRunSummary["modelRole"];
      }
      escalations.push({
        iteration: iterationCount || 1,
        fromRole: event.fromRole as NonNullable<MissionControlSnapshot["agenticRun"]>["escalations"][number]["fromRole"],
        toRole: event.toRole as NonNullable<MissionControlSnapshot["agenticRun"]>["escalations"][number]["toRole"],
        reason: typeof event.reason === "string" ? event.reason : "",
        timestamp: row.createdAt.toISOString(),
      });
    }
    if (row.kind === "execution_aborted" && typeof event.reason === "string") {
      lastReason = event.reason;
      phase = "aborted";
    }
    if (row.kind === "error" && typeof event.error === "string") {
      lastReason = event.error;
      phase = "failed";
    }
    if (row.kind === "execution_complete") {
      if (typeof event.finalMessage === "string") {
        lastAssistantText = event.finalMessage;
      }
      if (typeof event.totalIterations === "number") {
        iterationCount = Math.max(iterationCount, event.totalIterations);
      }
      if (typeof event.totalToolCalls === "number") {
        toolCallCount = Math.max(toolCallCount, event.totalToolCalls);
      }
      phase = "completed";
    }
    if (row.kind === "tool_result") {
      const id = typeof event.id === "string" ? event.id : row.id;
      const pending = pendingToolCalls.get(id);
      const rawResult = toRecord(event.result);
      toolCalls.push({
        id,
        iteration: pending?.iteration || iterationCount || 1,
        name: typeof event.name === "string" ? event.name : pending?.name || "unknown",
        args: pending?.args || {},
        result:
          rawResult.type === "success"
            ? {
                type: "success",
                content: typeof rawResult.content === "string" ? rawResult.content : "",
                metadata: toRecord(rawResult.metadata),
              }
            : rawResult.type === "approval_required"
            ? {
                type: "approval_required",
                approvalId: typeof rawResult.approvalId === "string" ? rawResult.approvalId : "",
                message: typeof rawResult.message === "string" ? rawResult.message : "",
              }
            : {
                type: "error",
                error: typeof rawResult.error === "string" ? rawResult.error : "Tool execution failed",
                metadata: toRecord(rawResult.metadata),
              },
        policyDecision:
          rawResult.type === "approval_required"
            ? "approval_required"
            : rawResult.type === "error" && rawResult.error?.toString().includes("denied by policy")
            ? "deny"
            : "allow",
        durationMs: typeof event.durationMs === "number" ? event.durationMs : 0,
        timestamp: row.createdAt.toISOString(),
      });
      pendingToolCalls.delete(id);
    }
    if (row.kind === "assistant_thinking" && typeof event.value === "string") {
      thinkingLog.push(event.value);
      thinkingTokenCount += Math.ceil(event.value.length / 4);
    }
    if (row.kind === "budget_warning") {
      const consumed = typeof event.consumed === "number" ? event.consumed : null;
      if (consumed !== null) {
        tokenTimeline.push({
          iteration: iterationCount || 1,
          tokens: consumed,
          timestamp: row.createdAt.toISOString(),
        });
      }
    }
    if (row.kind === "plan_started") phase = "planning";
    if (row.kind === "plan_submitted") phase = "plan_review";
    if (row.kind === "plan_approved") phase = "executing";
    if (row.kind === "plan_rejected") phase = "failed";
    if (row.kind === "plan_refine_requested" || row.kind === "plan_question_answered") phase = "planning";
    if (row.kind === "skill_invoked") {
      const id = typeof event.invocationId === "string" ? event.invocationId : row.id;
      skillEvents.set(id, {
        invocationId: id,
        skillId: typeof event.skillId === "string" ? event.skillId : "",
        skillName: typeof event.skillName === "string" ? event.skillName : "skill",
        status: "running",
        output: null,
        childRunId: null,
        timestamp: row.createdAt.toISOString(),
      });
    }
    if (row.kind === "skill_completed" || row.kind === "skill_failed") {
      const id = typeof event.invocationId === "string" ? event.invocationId : row.id;
      const current = skillEvents.get(id) || {
        invocationId: id,
        skillId: "",
        skillName: "skill",
        status: "running" as const,
        output: null,
        childRunId: null,
        timestamp: row.createdAt.toISOString(),
      };
      skillEvents.set(id, {
        ...current,
        status: row.kind === "skill_completed" ? "completed" : "failed",
        output:
          typeof event.output === "string"
            ? event.output
            : typeof event.error === "string"
            ? event.error
            : null,
      });
    }
    if (row.kind === "hook_executed") {
      hookEvents.push({
        hookId: typeof event.hookId === "string" ? event.hookId : "",
        hookName: typeof event.hookName === "string" ? event.hookName : "hook",
        eventType: (typeof event.eventType === "string" ? event.eventType : "Notification") as NonNullable<MissionControlSnapshot["agenticRun"]>["hookEvents"][number]["eventType"],
        success: event.success === true,
        output: null,
        error: null,
        timestamp: row.createdAt.toISOString(),
      });
    }
    if (row.kind === "memory_extracted") {
      memoryExtractions.push({
        memoryId: typeof event.memoryId === "string" ? event.memoryId : row.id,
        summary: typeof event.summary === "string" ? event.summary : "",
        timestamp: row.createdAt.toISOString(),
      });
    }
  }
  const status =
    input.runSummary?.status === "completed"
      ? "completed"
      : input.runSummary?.status === "aborted"
      ? "aborted"
      : input.runSummary?.status === "failed"
      ? "failed"
      : input.runSummary?.status
      ? "running"
      : "idle";

  // A run is resumable if it's aborted or failed and we expect a checkpoint to exist
  const resumable = (status === "aborted" || status === "failed") && iterationCount > 0;

  return {
    runId: input.runId,
    status,
    phase,
    plan,
    iterationCount,
    toolCallCount,
    approvalCount,
    deniedCount,
    compactionCount,
    doomLoopCount,
    escalationCount,
    thinkingTokenCount,
    lastAssistantText,
    lastReason,
    latestRole,
    resumable,
    budget: {
      tokensConsumed: typeof metadata.total_tokens === "number" ? metadata.total_tokens : null,
      maxTokens: typeof budget.maxTokens === "number" ? budget.maxTokens : null,
      costUsdConsumed: typeof metadata.total_cost_usd === "number" ? metadata.total_cost_usd : null,
      maxCostUsd: typeof budget.maxCostUsd === "number" ? budget.maxCostUsd : null,
      iterationsConsumed: iterationCount || null,
      maxIterations: typeof metadata.max_iterations === "number" ? metadata.max_iterations : null,
      tokenTimeline,
    },
    recentEvents,
    toolCalls,
    compactionEvents,
    escalations,
    doomLoops,
    skillEvents: Array.from(skillEvents.values()),
    hookEvents,
    memoryExtractions,
    thinkingLog: thinkingLog.length > 0 ? thinkingLog.join("\n") : null,
  };
}

function buildSpotlight(
  ticket: Ticket | null,
  workflowSummary: string | null,
  nextSteps: string[],
  blockers: string[],
  route: RoutingDecision | null,
  packFiles: string[],
  verification: VerificationBundle | null,
  relatedEvents: MissionControlSnapshot["timeline"]
) {
  if (!ticket) {
    return null;
  }

  const llmOutputs = packFiles.length ? [packFiles.map((file) => `+ target ${file}`).join("\n")] : [];

  return {
    task_id: ticket.id,
    title: ticket.title,
    lifecycle: {
      current_phase: route?.executionMode || ticket.status,
      events: relatedEvents.slice(-6).map((event) => ({
        timestamp: event.timestamp,
        severity: event.severity,
        message: event.message,
      })),
    },
    latest_transition_reason: workflowSummary || route?.rationale?.[0] || "Route ready.",
    phase_durations: undefined,
    latest_artifact: {
      payload: {
        outcome: {
          success: verification?.pass ?? ticket.status === "done",
          attempts: 1,
          patches_applied: packFiles.length,
          worker_id: null,
          token_usage: {
            total_tokens: 0,
          },
        },
        llm_outputs: llmOutputs,
      },
      markdown_summary: [
        workflowSummary,
        nextSteps.length ? `Next: ${nextSteps.join(" · ")}` : null,
        blockers.length ? `Blockers: ${blockers.join(" · ")}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      llm_output_count: llmOutputs.length,
    },
    failure: verification?.failures.length ? { error: verification.failures.join(" | ") } : {},
  };
}

function buildCodebaseFiles(changedFiles: string[], contextPack: MissionControlSnapshot["contextPack"], modelRole: string | null) {
  const seen = new Set<string>();
  const ordered = [...(contextPack?.files ?? []), ...(contextPack?.tests ?? []), ...(contextPack?.docs ?? [])].filter((filePath) => {
    if (!filePath || seen.has(filePath)) return false;
    seen.add(filePath);
    return true;
  });

  return ordered.map((filePath) => ({
    path: filePath,
    status: (changedFiles.includes(filePath) ? "modified" : contextPack?.docs.includes(filePath) ? "added" : "unchanged") as
      | "modified"
      | "added"
      | "deleted"
      | "unchanged",
    lines: 0,
    agent: modelRole,
    taskId: null,
  }));
}

function buildConsoleLogs(commands: V2CommandLogItem[], approvals: V2PolicyPendingItem[]) {
  const commandLogs = commands.slice(0, 60).map((command) => ({
    id: command.id,
    level:
      command.status === "failed" || command.status === "rejected"
        ? ("error" as const)
        : command.status === "queued"
        ? ("warn" as const)
        : command.command_type === "execution.request"
        ? ("success" as const)
        : ("info" as const),
    timestamp: command.created_at,
    message: `${command.command_type} ${command.status}`,
    source: command.command_type,
    taskId: command.aggregate_id ?? undefined,
  }));

  const approvalLogs = approvals.slice(0, 20).map((approval) => ({
    id: approval.approval_id,
    level: (approval.status === "pending" ? "warn" : approval.status === "rejected" ? "error" : "info") as
      | "info"
      | "warn"
      | "error"
      | "debug"
      | "success",
    timestamp: approval.requested_at,
    message: approval.reason || `${approval.action_type} ${approval.status}`,
    source: "approval",
  }));

  return [...commandLogs, ...approvalLogs]
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
    .slice(-120);
}

function buildActionCapabilities(runSummary: ExecutionRunSummary | null, ticket: Ticket | null) {
  return {
    canRefresh: true,
    canStop: false,
    canRequeue: false,
    canMarkActive: false,
    canComplete: false,
    canRetry: Boolean(runSummary && (runSummary.status === "failed" || runSummary.status === "rejected")) || ticket?.status === "blocked",
  };
}

function workflowStatusForTicket(status: Ticket["status"]): WorkflowCardSummary["status"] {
  if (status === "backlog" || status === "ready") return "backlog";
  if (status === "review") return "needs_review";
  if (status === "done") return "completed";
  return "in_progress";
}

function progressForTicketStatus(status: Ticket["status"]) {
  switch (status) {
    case "done":
      return 100;
    case "review":
      return 82;
    case "blocked":
      return 58;
    case "in_progress":
      return 64;
    case "ready":
      return 30;
    default:
      return 18;
  }
}

function readExecutionProfileNames(value: unknown) {
  const record = toRecord(value);
  const profiles = Array.isArray(record.profiles) ? record.profiles : [];
  const map = new Map<string, string>();
  for (const profile of profiles) {
    const item = toRecord(profile);
    const id = typeof item.id === "string" ? item.id : null;
    const name = typeof item.name === "string" ? item.name : null;
    if (id && name) {
      map.set(id, name);
    }
  }
  return map;
}

function summarizeTicketEvent(type: string, payload: Record<string, unknown>) {
  if (type === "ticket.created") {
    const status = typeof payload.status === "string" ? payload.status.replace(/_/g, " ") : "backlog";
    return `Ticket created in ${status}.`;
  }
  if (type === "ticket.updated") {
    const keys = Object.keys(payload).filter(Boolean);
    if (!keys.length) {
      return "Ticket details updated.";
    }
    return `Updated ${keys.join(", ")}.`;
  }
  if (type === "ticket.moved") {
    const status = typeof payload.status === "string" ? payload.status.replace(/_/g, " ") : "updated";
    return `Moved to ${status}.`;
  }
  if (type === "ticket.workflow_moved") {
    const lane = typeof payload.lane === "string" ? payload.lane.replace(/_/g, " ") : "the selected lane";
    return `Moved on the command board to ${lane}.`;
  }
  if (type === "ticket.execution_profile_set") {
    const executionProfileId =
      typeof payload.executionProfileId === "string" && payload.executionProfileId.trim()
        ? payload.executionProfileId
        : "the selected profile";
    return `Ticket override set to ${executionProfileId}.`;
  }
  if (type === "ticket.execution_profile_cleared") {
    return "Ticket override cleared. Using project default profile.";
  }
  return type.replace(/^ticket\./, "").replace(/[._]/g, " ");
}

function firstFailingVerificationCommand(input: {
  failures?: string[];
  impactedTests?: string[];
  changedFileChecks?: string[];
}) {
  const explicit = (input.failures ?? []).find((failure) => failure.startsWith("command_failed:"));
  if (explicit) {
    return explicit.replace(/^command_failed:/, "").trim() || null;
  }
  if ((input.impactedTests ?? []).length > 0) {
    return input.impactedTests![0] ?? null;
  }
  if ((input.changedFileChecks ?? []).length > 0) {
    return input.changedFileChecks![0] ?? null;
  }
  return null;
}

function summarizeVerificationFailure(input: {
  failures?: string[];
  impactedTests?: string[];
  changedFileChecks?: string[];
}) {
  const command = firstFailingVerificationCommand(input);
  if (command) {
    return `Failing check: ${command}`;
  }
  const firstFailure = (input.failures ?? [])[0];
  if (!firstFailure) {
    return null;
  }
  return summarize(firstFailure.replace(/^command_failed:/, "").replace(/_/g, " "), 88);
}

function buildWorkflowCards(
  tickets: Ticket[],
  runSummary: ExecutionRunSummary | null,
  contextPack: MissionControlSnapshot["contextPack"],
  laneCounts: Map<string, number>,
  latestRunByTicket: Map<string, { status: string; runId: string }>,
  latestVerificationByRun: Map<string, { pass: boolean; failures: string[]; impactedTests: string[]; changedFileChecks: string[] }>,
  ticketExecutionProfileOverrides: Map<string, string | null>,
  executionProfileNames: Map<string, string>
): WorkflowCardSummary[] {
  const activeTicketId = runSummary?.ticketId ?? null;
  return tickets
    .map((ticket) => {
      const impactedFiles = ticket.id === activeTicketId ? contextPack?.files ?? [] : [];
      const impactedTests = ticket.id === activeTicketId ? contextPack?.tests ?? [] : [];
      const impactedDocs = ticket.id === activeTicketId ? contextPack?.docs ?? [] : [];
      const isBlocked = ticket.status === "blocked";
      const workflowStatus = workflowStatusForTicket(ticket.status);
      const latestRun = latestRunByTicket.get(ticket.id);
      const latestVerification = latestRun ? latestVerificationByRun.get(latestRun.runId) : undefined;
      const verificationFailure =
        latestVerification && !latestVerification.pass
          ? summarizeVerificationFailure(latestVerification)
          : latestRun?.status === "failed"
          ? "Execution failed before verification completed."
          : null;
      const verificationCommand =
        latestVerification && !latestVerification.pass ? firstFailingVerificationCommand(latestVerification) : null;
      const executionProfileOverrideId = ticketExecutionProfileOverrides.get(ticket.id) ?? null;
      return {
        workflowId: ticket.id,
        title: ticket.title,
        subtitle: summarize(ticket.description || "Objective queued for refinement."),
        status: workflowStatus,
        laneOrder: ticket.laneOrder,
        rawStatus: ticket.status,
        priority: ticket.priority,
        risk: ticket.risk,
        taskCount: 1,
        isBlocked,
        blockedReason: isBlocked ? summarize(ticket.description || "Blocked pending follow-up.", 96) : null,
        impactedFiles,
        impactedTests,
        impactedDocs,
        lastUpdatedAt: ticket.updatedAt,
        verificationState: ticket.id === activeTicketId ? runSummary?.status ?? null : null,
        verificationFailure,
        verificationCommand,
        confidence: ticket.id === activeTicketId ? contextPack?.confidence ?? null : null,
        progress: progressForTicketStatus(ticket.status),
        ownerLabel: laneCounts.get(ticket.id) ? `${laneCounts.get(ticket.id)} active lane${laneCounts.get(ticket.id) === 1 ? "" : "s"}` : null,
        executionProfileOverrideId,
        executionProfileOverrideName: executionProfileOverrideId ? executionProfileNames.get(executionProfileOverrideId) ?? executionProfileOverrideId : null,
        laneCount: laneCounts.get(ticket.id) ?? 0,
      };
    })
    .sort((left, right) => {
      if (left.status !== right.status) {
        return 0;
      }
      if (left.isBlocked !== right.isBlocked) {
        return left.isBlocked ? -1 : 1;
      }
      if ((left.laneOrder ?? 0) !== (right.laneOrder ?? 0)) {
        return (left.laneOrder ?? 0) - (right.laneOrder ?? 0);
      }
      return new Date(right.lastUpdatedAt).getTime() - new Date(left.lastUpdatedAt).getTime();
    });
}

function buildWorkflowPillars(cards: WorkflowCardSummary[]): WorkflowStatusPillar[] {
  const order: Array<{ key: WorkflowStatusPillar["key"]; label: string }> = [
    { key: "backlog", label: "Backlog" },
    { key: "in_progress", label: "In Progress" },
    { key: "needs_review", label: "Needs Review" },
    { key: "completed", label: "Completed" },
  ];
  return order.map((pillar) => {
    const matching = cards.filter((card) => card.status === pillar.key);
    return {
      key: pillar.key,
      label: pillar.label,
      count: matching.length,
      blockedCount: matching.filter((card) => card.isBlocked).length || undefined,
      workflowIds: matching.map((card) => card.workflowId),
    };
  });
}

function mapConsoleLogLevel(level: "info" | "warn" | "error" | "debug" | "success"): ConsoleEvent["level"] {
  if (level === "warn") return "warn";
  if (level === "error") return "error";
  return "info";
}

function mapConsoleLogCategory(source: string): ConsoleEvent["category"] {
  if (source === "approval") return "approval";
  if (source.includes("verify") || source.includes("test") || source.includes("lint") || source.includes("build")) return "verification";
  if (source.includes("index")) return "indexing";
  if (source.includes("provider") || source.includes("qwen") || source.includes("openai")) return "provider";
  return "execution";
}

function mapRunSummary(row: {
  runId: string;
  ticketId: string | null;
  status: string;
  providerId: string | null;
  metadata: unknown;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
} | null, routingDecision: { id: string; repoId: string | null; executionMode: string; modelRole: string; providerId: string; verificationDepth: string } | null): ExecutionRunSummary | null {
  if (!row) return null;
  const metadata = toRecord(row.metadata);
  return {
    runId: row.runId,
    ticketId: row.ticketId,
    status: row.status,
    providerId: (row.providerId as ProviderId | null) || ((routingDecision?.providerId as ProviderId | undefined) ?? null),
    modelRole: (typeof metadata.model_role === "string" ? metadata.model_role : null) || routingDecision?.modelRole || null,
    routingDecisionId: typeof metadata.routing_decision_id === "string" ? metadata.routing_decision_id : routingDecision?.id || null,
    repoId: (typeof metadata.repo_id === "string" ? metadata.repo_id : null) || routingDecision?.repoId || null,
    executionMode: (typeof metadata.execution_mode === "string" ? metadata.execution_mode : null) || routingDecision?.executionMode || null,
    verificationDepth:
      ((typeof metadata.verification_depth === "string" ? metadata.verification_depth : null) as ExecutionRunSummary["verificationDepth"]) ||
      ((routingDecision?.verificationDepth as ExecutionRunSummary["verificationDepth"]) ?? null),
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    metadata,
  };
}

export class MissionControlService {
  constructor(
    private readonly repoService: RepoService,
    private readonly projectBlueprintService: ProjectBlueprintService,
    private readonly chatService: ChatService,
    private readonly ticketService: TicketService,
    private readonly v2QueryService: V2QueryService,
    private readonly routerService: RouterService,
    private readonly contextService: ContextService,
    private readonly codeGraphService: CodeGraphService,
    private readonly githubService: GitHubService,
    private readonly dreamStatusProvider?: () => { running: boolean; lastDreamAt: string | null; dreamCount: number }
  ) {}

  private async autoHealStaleReviewTickets(repoId: string) {
    const reviewTickets = await prisma.ticket.findMany({
      where: { repoId, status: "review" },
      select: { id: true },
    });
    if (reviewTickets.length === 0) {
      return;
    }

    const latestRuns = await prisma.runProjection.findMany({
      where: {
        ticketId: { in: reviewTickets.map((ticket) => ticket.id) },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        runId: true,
        ticketId: true,
        status: true,
      },
    });

    const latestRunByTicket = new Map<string, { runId: string; status: string }>();
    for (const row of latestRuns) {
      if (!row.ticketId || latestRunByTicket.has(row.ticketId)) continue;
      latestRunByTicket.set(row.ticketId, {
        runId: row.runId,
        status: row.status,
      });
    }

    const verificationRows = await prisma.verificationBundle.findMany({
      where: {
        runId: {
          in: Array.from(latestRunByTicket.values()).map((row) => row.runId),
        },
      },
      orderBy: [{ createdAt: "desc" }],
      select: {
        runId: true,
        pass: true,
      },
    });
    const verificationByRun = new Map<string, boolean>();
    for (const row of verificationRows) {
      if (!verificationByRun.has(row.runId)) {
        verificationByRun.set(row.runId, row.pass);
      }
    }

    for (const ticket of reviewTickets) {
      const latest = latestRunByTicket.get(ticket.id);
      if (!latest) continue;
      const verificationPass = verificationByRun.get(latest.runId);
      if (verificationPass === false || (verificationPass == null && latest.status === "failed")) {
        await this.ticketService.moveTicket(ticket.id, "in_progress");
      }
    }
  }

  async getSnapshot(input: GetSnapshotInput = {}): Promise<MissionControlSnapshot & { overseer: { sessions: ChatSessionDto[]; selectedSessionId: string | null; messages: ChatMessageDto[] } }> {
    const repos = await this.repoService.listRepos();
    const activeRepo = input.projectId ? await this.repoService.getRepo(input.projectId) : await this.repoService.getActiveRepo();
    const project = activeRepo || repos[0] || null;

    if (project) {
      await this.autoHealStaleReviewTickets(project.id);
    }

    const [blueprint, guidelines, projectState, sessions, tickets, approvals, commands, contextPack, codeGraphStatus, latestAttempt, laneRows] =
      await Promise.all([
      project ? this.projectBlueprintService.get(project.id) : Promise.resolve(null),
      project ? this.repoService.getGuidelines(project.id) : Promise.resolve(null),
      project ? this.repoService.getState(project.id) : Promise.resolve(null),
      project ? this.chatService.listSessions(project.id) : Promise.resolve([] as ChatSessionDto[]),
      project ? this.ticketService.listTickets(project.id) : Promise.resolve([] as Ticket[]),
      this.v2QueryService.getPendingPolicy(),
      this.v2QueryService.getRecentCommands(120),
      project ? this.codeGraphService.getLatestContextPack(project.id) : Promise.resolve(null),
      project ? this.codeGraphService.getStatus(project.id) : Promise.resolve(null),
      project
        ? prisma.executionAttempt.findFirst({
            where: { repoId: project.id },
            orderBy: [{ startedAt: "desc" }, { updatedAt: "desc" }],
          })
        : Promise.resolve(null),
      project
        ? prisma.agentLane.findMany({
            where: { repoId: project.id },
            select: { ticketId: true, state: true },
          })
        : Promise.resolve([] as Array<{ ticketId: string; state: string }>),
    ]);

    const selectedTicket =
      tickets.find((ticket) => ticket.id === input.ticketId) ??
      tickets.find((ticket) => ticket.status === "in_progress" || ticket.status === "review") ??
      tickets[0] ??
      null;
    const selectedSession = sessions.find((session) => session.id === input.sessionId) ?? sessions[0] ?? null;
    const messages = selectedSession ? await this.chatService.listMessages(selectedSession.id) : [];

    const latestExecutionCommand = selectedTicket
      ? commands.find((item) => item.command_type === "execution.request" && item.aggregate_id === selectedTicket.id) ?? null
      : null;

    const inferredRunId =
      input.runId ||
      projectState?.selectedRunId ||
      (typeof latestExecutionCommand?.result?.run_id === "string" ? latestExecutionCommand.result.run_id : null) ||
      latestAttempt?.runId ||
      null;

    const routingFromTicket = selectedTicket ? await this.routerService.listRecentForAggregate(selectedTicket.id) : [];
    const preliminaryRoute = routingFromTicket[0] ?? null;
    const routingDecisionId =
      (typeof preliminaryRoute?.id === "string" ? preliminaryRoute.id : null) ||
      (typeof latestExecutionCommand?.result?.routing_decision_id === "string" ? latestExecutionCommand.result.routing_decision_id : null) ||
      latestAttempt?.routingDecisionId ||
      null;

    const runProjection = inferredRunId ? await prisma.runProjection.findUnique({ where: { runId: inferredRunId } }) : null;
    const persistedRoutingDecision = routingDecisionId
      ? await prisma.routingDecisionProjection.findUnique({ where: { id: routingDecisionId } })
      : null;
    const runSummary = mapRunSummary(runProjection, persistedRoutingDecision);

    const [workflowState, verification, shareReport, recentChannelAuditRows, recentSubagentRows, agenticRunRows] = await Promise.all([
      selectedTicket ? this.contextService.getWorkflowState(selectedTicket.id) : Promise.resolve(null),
      inferredRunId ? this.codeGraphService.getVerificationBundle(inferredRunId) : Promise.resolve(null),
      inferredRunId ? this.githubService.getShareReport(inferredRunId) : Promise.resolve(null as ShareableRunReport | null),
      project
        ? prisma.auditEvent.findMany({
            where: {
              eventType: "channel.event.received",
              payload: {
                path: ["projectId"],
                equals: project.id,
              },
            },
            orderBy: { createdAt: "desc" },
            take: 8,
          })
        : Promise.resolve([]),
      project
        ? prisma.runEvent.findMany({
            where: {
              kind: "subagent_activity",
              payload: {
                path: ["projectId"],
                equals: project.id,
              },
            },
            orderBy: { createdAt: "desc" },
            take: 12,
          })
        : Promise.resolve([]),
      inferredRunId
        ? prisma.runEvent.findMany({
            where: {
              runId: inferredRunId,
              kind: {
                not: "subagent_activity",
              },
            },
            orderBy: { createdAt: "asc" },
            take: 120,
          })
        : Promise.resolve([]),
    ]);
    const experimentalAutonomy = {
      channels: recentChannelAuditRows
        .map((row) => row.payload as ChannelEventRecord)
        .filter((item) => item && typeof item.id === "string"),
      subagents: recentSubagentRows
        .map((row) => row.payload as SubagentActivityRecord)
        .filter((item) => item && typeof item.id === "string"),
    };

    const effectiveRoute = preliminaryRoute || (persistedRoutingDecision
      ? ({
          id: persistedRoutingDecision.id,
          repoId: persistedRoutingDecision.repoId,
          ticketId: persistedRoutingDecision.ticketId,
          runId: persistedRoutingDecision.runId,
          executionMode: persistedRoutingDecision.executionMode,
          modelRole: persistedRoutingDecision.modelRole,
          providerId: persistedRoutingDecision.providerId,
          maxLanes: persistedRoutingDecision.maxLanes,
          risk: persistedRoutingDecision.risk,
          verificationDepth: persistedRoutingDecision.verificationDepth,
          decompositionScore: persistedRoutingDecision.decompositionScore,
          estimatedFileOverlap: persistedRoutingDecision.estimatedFileOverlap,
          rationale: asStringArray(persistedRoutingDecision.rationale),
          metadata: toRecord(persistedRoutingDecision.metadata),
          createdAt: persistedRoutingDecision.createdAt.toISOString(),
        } as RoutingDecision)
      : null);

    const filteredApprovals = approvals.filter((item) => item.action_type !== "provider_change");
    const relevantApprovals = filteredApprovals.filter((item) => {
      const aggregateId = typeof item.payload?.aggregate_id === "string" ? item.payload.aggregate_id : null;
      if (!selectedTicket?.id) {
        return aggregateId === null;
      }
      return aggregateId === null || aggregateId === selectedTicket.id;
    });

    const packFiles = contextPack?.files ?? [];
    const changedFiles = asStringArray(runSummary?.metadata?.changed_files);
    const agenticTimeline = agenticRunRows.map(mapAgenticTimelineEvent);
    const timeline = [...buildTimeline(commands, relevantApprovals), ...agenticTimeline]
      .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
      .slice(-36);
    const laneCounts = laneRows.reduce((map, lane) => {
      map.set(lane.ticketId, (map.get(lane.ticketId) ?? 0) + 1);
      return map;
    }, new Map<string, number>());
    const ticketIds = tickets.map((ticket) => ticket.id);
    const latestRuns = project && ticketIds.length > 0
      ? await prisma.runProjection.findMany({
          where: {
            ticketId: { in: ticketIds },
          },
          orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
          select: {
            ticketId: true,
            runId: true,
            status: true,
          },
        })
      : [];
    const latestRunByTicket = new Map<string, { status: string; runId: string }>();
    for (const row of latestRuns) {
      if (!row.ticketId || latestRunByTicket.has(row.ticketId)) continue;
      latestRunByTicket.set(row.ticketId, {
        status: row.status,
        runId: row.runId,
      });
    }
    const latestVerificationRows =
      latestRuns.length > 0
        ? await prisma.verificationBundle.findMany({
            where: {
              runId: {
                in: Array.from(latestRunByTicket.values()).map((row) => row.runId),
              },
            },
            orderBy: [{ createdAt: "desc" }],
            select: {
              runId: true,
              pass: true,
              failures: true,
              impactedTests: true,
              changedFileChecks: true,
            },
          })
        : [];
    const latestVerificationByRun = new Map<string, { pass: boolean; failures: string[]; impactedTests: string[]; changedFileChecks: string[] }>();
    for (const row of latestVerificationRows) {
      if (latestVerificationByRun.has(row.runId)) continue;
      latestVerificationByRun.set(row.runId, {
        pass: row.pass,
        failures: asStringArray(row.failures),
        impactedTests: asStringArray(row.impactedTests),
        changedFileChecks: asStringArray(row.changedFileChecks),
      });
    }
    const executionProfilesSetting = await prisma.appSetting.findUnique({
      where: { key: "execution_profiles" },
      select: { value: true },
    });
    const executionProfileNames = readExecutionProfileNames(executionProfilesSetting?.value);
    const ticketExecutionProfileEvents =
      ticketIds.length > 0
        ? await prisma.ticketEvent.findMany({
            where: {
              ticketId: { in: ticketIds },
              type: {
                in: ["ticket.execution_profile_set", "ticket.execution_profile_cleared"],
              },
            },
            orderBy: [{ createdAt: "desc" }],
            select: {
              ticketId: true,
              payload: true,
            },
          })
        : [];
    const ticketExecutionProfileOverrides = new Map<string, string | null>();
    for (const event of ticketExecutionProfileEvents) {
      if (ticketExecutionProfileOverrides.has(event.ticketId)) continue;
      const payload = toRecord(event.payload);
      ticketExecutionProfileOverrides.set(
        event.ticketId,
        typeof payload.executionProfileId === "string" ? payload.executionProfileId : null
      );
    }
    const workflowCards = buildWorkflowCards(
      tickets,
      runSummary,
      contextPack,
      laneCounts,
      latestRunByTicket,
      latestVerificationByRun,
      ticketExecutionProfileOverrides,
      executionProfileNames
    );
    const workflowPillars = buildWorkflowPillars(workflowCards);

    return {
      project,
      recentProjects: repos,
      blueprint,
      route: effectiveRoute,
      routeSummary: buildRouteSummary(effectiveRoute),
      actionCapabilities: buildActionCapabilities(runSummary, selectedTicket),
      contextPack,
      runPhase: deriveRunPhase(runSummary, relevantApprovals, selectedTicket),
      runSummary,
      verification,
      selectedTicket,
      tickets,
      workflowPillars,
      workflowCards,
      changeBriefs: buildChangeBriefs(tickets, runSummary, packFiles),
      streams: buildStreams(tickets, relevantApprovals, runSummary),
      timeline,
      tasks: tickets.slice(0, 12).map((ticket) => ({
        task_id: ticket.id,
        title: ticket.title,
        phase: deriveTaskPhase(ticket),
      })),
      spotlight: buildSpotlight(
        selectedTicket,
        workflowState?.summary || null,
        workflowState?.nextSteps || [],
        workflowState?.blockers || [],
        effectiveRoute,
        packFiles,
        verification,
        timeline.filter((event) => event.task_id === selectedTicket?.id)
      ),
      codebaseFiles: buildCodebaseFiles(changedFiles, contextPack, runSummary?.modelRole || null),
      consoleLogs: buildConsoleLogs(commands, relevantApprovals),
      experimentalAutonomy,
      agenticRun: buildAgenticRunSnapshot({
        runId: inferredRunId || "",
        ticketId: selectedTicket?.id || null,
        projectId: project?.id || null,
        runSummary,
        rows: agenticRunRows,
      }),
      approvals: buildApprovals(relevantApprovals, selectedTicket?.id || null),
      guidelines,
      projectState,
      codeGraphStatus,
      shareReport,
      memoryStats: (() => {
        try {
          if (!project) return null;
          const worktreePath = `${project.managedWorktreeRoot}/active`;
          const { MemoryService } = require("./memoryService");
          const memSvc = new MemoryService(worktreePath);
          memSvc.loadEpisodicMemory();
          const all = memSvc.getRelevantEpisodicMemories("");
          return {
            episodicCount: memSvc.episodicCount(),
            successCount: all.filter((m: { outcome: string }) => m.outcome === "success").length,
            failureCount: all.filter((m: { outcome: string }) => m.outcome === "failure").length,
            partialCount: all.filter((m: { outcome: string }) => m.outcome === "partial").length,
            newestCreatedAt: all.length > 0
              ? all.reduce((newest: { createdAt: string }, m: { createdAt: string }) =>
                  new Date(m.createdAt) > new Date(newest.createdAt) ? m : newest
                ).createdAt
              : null,
            dreamStatus: this.dreamStatusProvider
              ? {
                  running: this.dreamStatusProvider().running,
                  lastDreamAt: this.dreamStatusProvider().lastDreamAt,
                  dreamCount: this.dreamStatusProvider().dreamCount,
                }
              : null,
          };
        } catch (e) {
          publishEvent("global", "mission.memory.failed", { error: String(e) });
          return null;
        }
      })(),
      lastUpdatedAt: project?.updatedAt || null,
      overseer: {
        sessions,
        selectedSessionId: selectedSession?.id || null,
        messages,
      },
    };
  }

  async getTaskDetail(input: { projectId?: string | null; taskId: string }): Promise<WorkflowTaskDetail | null> {
    const snapshot = await this.getSnapshot({
      projectId: input.projectId || null,
      ticketId: input.taskId,
    });
    const ticket = snapshot.tickets.find((item) => item.id === input.taskId) ?? null;
    if (!ticket) {
      return null;
    }
    const [workflowState, executionProfileOverrideId, ticketExecutionPolicy] = await Promise.all([
      this.contextService.getWorkflowState(ticket.id),
      this.ticketService.getTicketExecutionProfileOverride(ticket.id),
      this.ticketService.getTicketExecutionPolicy(ticket.id),
    ]);
    const ticketEvents = await prisma.ticketEvent.findMany({
      where: { ticketId: ticket.id },
      orderBy: [{ createdAt: "desc" }],
      take: 20,
    });

    const logs: ConsoleEvent[] = snapshot.consoleLogs
      .filter((log) => log.taskId === input.taskId)
      .slice(-20)
      .map((log) => ({
        id: log.id,
        projectId: snapshot.project?.id ?? "",
        category: mapConsoleLogCategory(log.source),
        level: mapConsoleLogLevel(log.level),
        message: log.message,
        createdAt: log.timestamp,
        taskId: log.taskId,
      }));

    const verification = [
      ...(snapshot.verification?.changedFileChecks ?? []),
      ...(snapshot.verification?.impactedTests ?? []),
      ...(snapshot.verification?.docsChecked ?? []),
    ];
    const verificationFailures = snapshot.verification?.failures ?? [];
    const executionProfileRecord = toRecord(snapshot.runSummary?.metadata?.execution_profile_snapshot);
    const executionProfileStages = Array.isArray(executionProfileRecord.stages)
      ? executionProfileRecord.stages
          .map((item) => {
            const row = toRecord(item);
            return {
              stage:
                row.stage === "scope" || row.stage === "build" || row.stage === "review" || row.stage === "escalate"
                  ? row.stage
                  : null,
              role:
                row.role === "utility_fast" || row.role === "coder_default" || row.role === "review_deep" || row.role === "overseer_escalation"
                  ? row.role
                  : null,
              providerId:
                row.providerId === "qwen-cli" ||
                row.providerId === "openai-compatible" ||
                row.providerId === "onprem-qwen" ||
                row.providerId === "openai-responses"
                  ? row.providerId
                  : null,
              model: typeof row.model === "string" ? row.model : null,
              reasoningMode:
                row.reasoningMode === "off" || row.reasoningMode === "on" || row.reasoningMode === "auto"
                  ? row.reasoningMode
                  : undefined,
            };
          })
          .filter(
            (item): item is NonNullable<WorkflowTaskDetail["executionProfileSnapshot"]>["stages"][number] =>
              Boolean(item.stage && item.role && item.providerId && item.model)
          )
      : [];

    const comments = await this.ticketService.listTicketComments(ticket.id, 50);
    const subtasks = await new SubtaskService(createPrismaSubtaskPersistence()).listSubtasks(ticket.id, {
      includeCompleted: true,
    });

    const activityNotes = ticketEvents
      .slice()
      .reverse()
      .map((event) => ({
        id: event.id,
        author: "system",
        body: summarizeTicketEvent(event.type, toRecord(event.payload)),
        createdAt: event.createdAt.toISOString(),
      }));

    return {
      taskId: ticket.id,
      title: ticket.title,
      status: ticket.status,
      comments,
      activityNotes,
      metadata: {
        priority: ticket.priority,
        risk: ticket.risk,
        acceptanceCriteria: ticket.acceptanceCriteria,
        dependencies: ticket.dependencies,
        lastUpdatedAt: ticket.updatedAt,
      },
      logs,
      approvals: snapshot.approvals.filter((approval) => approval.relevantToCurrentTask),
      verification,
      impactedFiles: snapshot.selectedTicket?.id === ticket.id ? snapshot.contextPack?.files ?? [] : [],
      impactedTests: snapshot.selectedTicket?.id === ticket.id ? snapshot.contextPack?.tests ?? [] : [],
      impactedDocs: snapshot.selectedTicket?.id === ticket.id ? snapshot.contextPack?.docs ?? [] : [],
      workflowSummary: workflowState?.summary || null,
      blockers: workflowState?.blockers || [],
      nextSteps: workflowState?.nextSteps || [],
      verificationFailures,
      verificationCommand: firstFailingVerificationCommand({
        failures: snapshot.verification?.failures ?? [],
        impactedTests: snapshot.verification?.impactedTests ?? [],
        changedFileChecks: snapshot.verification?.changedFileChecks ?? [],
      }),
      route: snapshot.selectedTicket?.id === ticket.id ? snapshot.routeSummary : null,
      subtasks,
      executionProfileOverrideId: executionProfileOverrideId ?? null,
      executionProfileSnapshot:
        typeof executionProfileRecord.profileId === "string" && typeof executionProfileRecord.profileName === "string" && executionProfileStages.length
          ? {
              profileId: executionProfileRecord.profileId,
              profileName: executionProfileRecord.profileName,
              stages: executionProfileStages,
            }
          : null,
      ticketExecutionPolicy,
    };
  }
}

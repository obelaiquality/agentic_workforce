import { CommandEngine } from "../../services/commandEngine";
import { TicketService } from "../../services/ticketService";
import { V2EventService } from "../../services/v2EventService";
import { syncTaskProjectionFromTicket } from "./ticketProjection";
import type { ApprovalService } from "../../services/approvalService";
import type { TicketStatus } from "../../../shared/contracts";
import { buildCommandPlan, commandPlanFromRecord } from "../../services/commandSpecs";

type ApprovalDecision = Awaited<ReturnType<ApprovalService["decideApproval"]>>;

export async function handleCommandInvocationApprovalDecision(input: {
  approval: ApprovalDecision;
  decision: "approved" | "rejected";
  actor: string;
  executeApprovedCommand: boolean;
  requeueBlockedStage: boolean;
  ticketService: TicketService;
  commandEngine: CommandEngine;
  v2EventService: V2EventService;
}) {
  if (input.decision !== "approved" || input.approval.actionType !== "command_tool_invocation") {
    return {
      commandExecution: null as
        | null
        | {
            toolEventId: string;
            policyDecision: "allowed" | "approval_required" | "denied";
            exitCode: number | null;
            summary: string;
          },
      requeue: null as
        | null
        | {
            ticketId: string;
            from: TicketStatus;
            to: TicketStatus;
            reason: string;
          },
    };
  }

  const payload = (input.approval.payload || {}) as Record<string, unknown>;
  const runId = typeof payload.run_id === "string" ? payload.run_id : null;
  const ticketId = typeof payload.ticket_id === "string" ? payload.ticket_id : null;
  const repoIdFromPayload =
    (typeof payload.repo_id === "string" && payload.repo_id) ||
    (typeof payload.project_id === "string" && payload.project_id) ||
    null;
  const stage =
    payload.stage === "scope" || payload.stage === "build" || payload.stage === "review" || payload.stage === "escalate"
      ? payload.stage
      : null;
  const displayCommand =
    typeof payload.display_command === "string"
      ? payload.display_command
      : typeof payload.command === "string"
      ? payload.command
      : null;
  const worktreePath =
    typeof payload.worktree_path === "string"
      ? payload.worktree_path
      : typeof payload.cwd === "string"
      ? payload.cwd
      : null;
  const toolType =
    payload.tool_type === "repo.read" ||
    payload.tool_type === "repo.edit" ||
    payload.tool_type === "repo.verify" ||
    payload.tool_type === "repo.install" ||
    payload.tool_type === "git.meta"
      ? payload.tool_type
      : undefined;
  const riskLevel =
    payload.risk_level === "low" || payload.risk_level === "medium" || payload.risk_level === "high"
      ? payload.risk_level
      : undefined;
  const commandPlan =
    commandPlanFromRecord(payload.command_plan) ||
    (displayCommand ? buildCommandPlan(displayCommand) : null);

  let commandExecution:
    | null
    | {
        toolEventId: string;
        policyDecision: "allowed" | "approval_required" | "denied";
        exitCode: number | null;
        summary: string;
  } = null;

  const ticket = ticketId ? await input.ticketService.getTicket(ticketId) : null;
  const repoId = repoIdFromPayload || ticket?.repoId || null;
  if (input.executeApprovedCommand && runId && ticketId && repoId && stage && commandPlan && worktreePath) {
    const invoked = await input.commandEngine.invoke({
      runId,
      repoId,
      ticketId,
      stage,
      actor: input.actor,
      worktreePath,
      commandPlan,
      toolType,
      riskLevel,
      approvedApprovalId: input.approval.id,
    });
    commandExecution = {
      toolEventId: invoked.event.id,
      policyDecision: invoked.event.policyDecision,
      exitCode: invoked.event.exitCode,
      summary: invoked.event.summary,
    };

    await input.v2EventService.appendEvent({
      type: "command.tool.approval.executed",
      aggregateId: runId,
      actor: input.actor,
      payload: {
        approval_id: input.approval.id,
        ticket_id: ticketId,
        command: displayCommand,
        stage,
        tool_event_id: invoked.event.id,
        policy_decision: invoked.event.policyDecision,
        exit_code: invoked.event.exitCode,
      },
      correlationId: input.approval.id,
    });
  }

  let requeue:
    | null
    | {
        ticketId: string;
        from: TicketStatus;
        to: TicketStatus;
        reason: string;
      } = null;

  if (input.requeueBlockedStage && ticket && ticket.status === "review") {
    const moved = await input.ticketService.moveTicket(ticket.id, "in_progress");
    await syncTaskProjectionFromTicket(moved);
    requeue = {
      ticketId: ticket.id,
      from: "review",
      to: "in_progress",
      reason: "approved_command_requeue",
    };
  }

  return {
    commandExecution,
    requeue,
  };
}

export async function decideApprovalWithCommandFollowup(input: {
  approvalId: string;
  decision: "approved" | "rejected";
  reason?: string;
  actor: string;
  executeApprovedCommand: boolean;
  requeueBlockedStage: boolean;
  approvalService: ApprovalService;
  ticketService: TicketService;
  commandEngine: CommandEngine;
  v2EventService: V2EventService;
}) {
  const item = await input.approvalService.decideApproval(input.approvalId, {
    decision: input.decision,
    reason: input.reason,
    decidedBy: input.actor,
  });
  const followup = await handleCommandInvocationApprovalDecision({
    approval: item,
    decision: input.decision,
    actor: input.actor,
    executeApprovedCommand: input.executeApprovedCommand,
    requeueBlockedStage: input.requeueBlockedStage,
    ticketService: input.ticketService,
    commandEngine: input.commandEngine,
    v2EventService: input.v2EventService,
  });

  return {
    item,
    commandExecution: followup.commandExecution,
    lifecycleRequeue: followup.requeue,
  };
}

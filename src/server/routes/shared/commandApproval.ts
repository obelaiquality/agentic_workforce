import { prisma } from "../../db";
import { CommandEngine } from "../../services/commandEngine";
import { ExecutionService } from "../../services/executionService";
import { ProjectBlueprintService } from "../../services/projectBlueprintService";
import { RepoService } from "../../services/repoService";
import { TicketService } from "../../services/ticketService";
import { V2EventService } from "../../services/v2EventService";
import { buildVerificationPlan } from "../../services/verificationPolicy";
import { syncTaskProjectionFromTicket } from "./ticketProjection";
import type { ApprovalService } from "../../services/approvalService";
import type { ModelRole, ProviderId, TicketStatus } from "../../../shared/contracts";
import { buildCommandPlan, commandPlanFromRecord } from "../../services/commandSpecs";

type ApprovalDecision = Awaited<ReturnType<ApprovalService["decideApproval"]>>;

function toRecord(value: unknown) {
  return (value ?? {}) as Record<string, unknown>;
}

async function resumeApprovedExecutionRequest(input: {
  approval: ApprovalDecision;
  actor: string;
  executionService: ExecutionService;
  projectBlueprintService: ProjectBlueprintService;
  repoService: RepoService;
  ticketService: TicketService;
}) {
  const payload = (input.approval.payload || {}) as Record<string, unknown>;
  const runId = typeof payload.run_id === "string" ? payload.run_id : null;
  const ticketId = typeof payload.ticket_id === "string" ? payload.ticket_id : null;
  const prompt = typeof payload.prompt === "string" ? payload.prompt : null;

  if (!runId || !ticketId || !prompt) {
    return null;
  }

  const runProjection = await prisma.runProjection.findUnique({
    where: { runId },
    select: {
      metadata: true,
    },
  });
  const runMetadata = toRecord(runProjection?.metadata);
  const ticket = await input.ticketService.getTicket(ticketId);
  if (!ticket?.repoId) {
    throw new Error(`Execution request is missing a ticket-bound repo for run ${runId}`);
  }

  const repoId =
    (typeof payload.repo_id === "string" && payload.repo_id) ||
    (typeof payload.project_id === "string" && payload.project_id) ||
    (typeof runMetadata.repo_id === "string" && runMetadata.repo_id) ||
    ticket.repoId;
  if (!repoId) {
    throw new Error(`Execution request is missing a repo for run ${runId}`);
  }

  const worktreePath =
    (typeof runMetadata.worktree_path === "string" && runMetadata.worktree_path) ||
    (await input.repoService.getActiveWorktreePath(repoId));
  const modelRole =
    ((typeof payload.model_role === "string" ? payload.model_role : null) ||
      (typeof runMetadata.model_role === "string" ? runMetadata.model_role : null)) as ModelRole | null;
  const providerId =
    ((typeof payload.provider_id === "string" ? payload.provider_id : null) ||
      (typeof runMetadata.provider_id === "string" ? runMetadata.provider_id : null)) as ProviderId | null;
  const routingDecisionId =
    (typeof payload.routing_decision_id === "string" ? payload.routing_decision_id : null) ||
    (typeof runMetadata.routing_decision_id === "string" ? runMetadata.routing_decision_id : null);

  if (!modelRole || !providerId) {
    throw new Error(`Execution request is missing provider routing for run ${runId}`);
  }

  if (ticket.status === "review") {
    const resumedTicket = await input.ticketService.moveTicket(ticket.id, "in_progress");
    await syncTaskProjectionFromTicket(resumedTicket);
  }

  const attempt = await input.executionService.startExecution({
    actor: input.actor,
    runId,
    repoId,
    projectId: repoId,
    worktreePath,
    objective: prompt,
    modelRole,
    providerId,
    routingDecisionId,
  });

  const [blueprint, guidelines] = await Promise.all([
    input.projectBlueprintService.get(repoId),
    input.repoService.getGuidelines(repoId),
  ]);
  const verificationPlan = buildVerificationPlan({
    blueprint,
    guidelines,
    includeInstall: false,
  });
  const verification = verificationPlan.commands.length
    ? await input.executionService.verifyExecution({
        actor: input.actor,
        runId,
        repoId,
        worktreePath,
        executionAttemptId: attempt.id,
        commands: verificationPlan.commands,
        docsRequired: verificationPlan.docsRequired,
        fullSuiteRun: verificationPlan.fullSuiteRun,
        metadata: {
          verification_commands: verificationPlan.commands.map((item) => item.displayCommand),
          verification_reasons: verificationPlan.reasons,
          enforced_rules: verificationPlan.enforcedRules,
        },
      })
    : null;

  const refreshedTicket = await input.ticketService.getTicket(ticketId);
  if (verification?.pass && refreshedTicket) {
    const reviewTicket = refreshedTicket.status === "review" ? refreshedTicket : await input.ticketService.moveTicket(ticketId, "review");
    await syncTaskProjectionFromTicket(reviewTicket);
    const doneTicket = reviewTicket.status === "done" ? reviewTicket : await input.ticketService.moveTicket(ticketId, "done");
    await syncTaskProjectionFromTicket(doneTicket);
  }

  return {
    attemptId: attempt.id,
    verified: verification?.pass ?? null,
  };
}

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
  executionService: ExecutionService;
  projectBlueprintService: ProjectBlueprintService;
  repoService: RepoService;
  ticketService: TicketService;
  commandEngine: CommandEngine;
  v2EventService: V2EventService;
}) {
  const item = await input.approvalService.decideApproval(input.approvalId, {
    decision: input.decision,
    reason: input.reason,
    decidedBy: input.actor,
  });

  if (input.decision === "approved" && item.actionType === "execution_request") {
    const payload = (item.payload || {}) as Record<string, unknown>;
    const runId = typeof payload.run_id === "string" ? payload.run_id : item.id;
    await input.v2EventService.appendEvent({
      type: "execution.requested",
      aggregateId: runId,
      actor: input.actor,
      payload: {
        ...payload,
        status: "queued",
        approved_via: item.id,
      },
      correlationId: item.id,
    });

    await resumeApprovedExecutionRequest({
      approval: item,
      actor: input.actor,
      executionService: input.executionService,
      projectBlueprintService: input.projectBlueprintService,
      repoService: input.repoService,
      ticketService: input.ticketService,
    });
  }

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

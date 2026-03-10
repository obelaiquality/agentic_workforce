import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { publishEvent } from "../eventBus";
import { SidecarClient } from "../sidecar/client";
import { ProviderOrchestrator } from "./providerOrchestrator";
import { RouterService } from "./routerService";
import { V2EventService } from "./v2EventService";
import type { ModelRole, ProviderId, RoutingDecision, TaskLifecycleStatus } from "../../shared/contracts";

const STATUS_TO_LEGACY: Partial<Record<TaskLifecycleStatus, "backlog" | "ready" | "in_progress" | "review" | "blocked" | "done">> = {
  inactive: "backlog",
  reserved: "ready",
  active: "ready",
  in_progress: "in_progress",
  blocked: "blocked",
  completed: "done",
};

export class V2CommandService {
  constructor(
    private readonly sidecar: SidecarClient,
    private readonly providerOrchestrator: ProviderOrchestrator,
    private readonly events: V2EventService,
    private readonly routerService: RouterService
  ) {}

  private async logCommand(commandType: string, actor: string, aggregateId: string | null, payload: Record<string, unknown>) {
    return prisma.commandLog.create({
      data: {
        commandType,
        actor,
        aggregateId,
        payload,
        status: "queued",
      },
    });
  }

  private async completeCommand(id: string, status: "executed" | "approved" | "rejected" | "failed", result: Record<string, unknown>) {
    return prisma.commandLog.update({
      where: { id },
      data: {
        status,
        result,
      },
    });
  }

  private async checkProviderHealth(providerId: "qwen-cli" | "openai-compatible" | "onprem-qwen" | "openai-responses") {
    return this.providerOrchestrator.checkProviderHealth(providerId);
  }

  private async resolveExecutionRoute(input: {
    ticket_id: string;
    repo_id?: string;
    actor: string;
    prompt: string;
    retrieval_context_ids: string[];
    workspace_path?: string;
    risk_level?: "low" | "medium" | "high";
    routing_decision_id?: string;
    model_role?: ModelRole;
    provider_id?: ProviderId;
  }): Promise<{
    routingDecision: RoutingDecision | null;
    routingDecisionId: string | null;
    modelRole: ModelRole;
    providerId: ProviderId;
    usedExistingDecision: boolean;
  }> {
    let routingDecision: RoutingDecision | null = null;
    let usedExistingDecision = false;

    if (input.routing_decision_id) {
      routingDecision = await this.routerService.getDecision(input.routing_decision_id);
      usedExistingDecision = Boolean(routingDecision);
    }

    if (!routingDecision) {
      routingDecision = (await this.routerService.listRecentForAggregate(input.ticket_id))[0] ?? null;
      usedExistingDecision = Boolean(routingDecision);
    }

    if (!routingDecision) {
      routingDecision = await this.routerService.planRoute({
        actor: input.actor,
        repo_id: input.repo_id,
        ticket_id: input.ticket_id,
        prompt: input.prompt,
        risk_level: input.risk_level,
        workspace_path: input.workspace_path,
        retrieval_context_ids: input.retrieval_context_ids,
        active_files: [],
      });
      usedExistingDecision = false;
    }

    const modelRole = input.model_role || routingDecision?.modelRole || "coder_default";
    const roleBinding = await this.providerOrchestrator.getModelRoleBinding(modelRole);
    const providerId = input.provider_id || routingDecision?.providerId || roleBinding.providerId;

    return {
      routingDecision,
      routingDecisionId: routingDecision?.id || null,
      modelRole,
      providerId,
      usedExistingDecision,
    };
  }

  async evaluatePolicy(input: {
    action_type: string;
    actor: string;
    risk_level: string;
    workspace_path: string;
    payload: Record<string, unknown>;
    dry_run?: boolean;
    aggregate_id?: string;
  }) {
    const command = await this.logCommand("policy.decide", input.actor, input.aggregate_id || null, {
      action_type: input.action_type,
      risk_level: input.risk_level,
      workspace_path: input.workspace_path,
      payload: input.payload,
      dry_run: Boolean(input.dry_run),
    });

    const decision = await this.sidecar.evaluatePolicy({
      action_type: input.action_type,
      actor: input.actor,
      risk_level: input.risk_level,
      workspace_path: input.workspace_path,
      payload_json: JSON.stringify(input.payload),
      dry_run: Boolean(input.dry_run),
    });

    await this.events.appendEvent({
      type: "policy.decision",
      aggregateId: input.aggregate_id || command.id,
      actor: input.actor,
      payload: {
        approval_id: command.id,
        action_type: input.action_type,
        status: decision.requires_approval ? "pending" : decision.decision === "deny" ? "rejected" : "approved",
        decision,
      },
      correlationId: command.id,
    });

    await this.completeCommand(command.id, decision.decision === "deny" ? "rejected" : "approved", {
      decision,
    });

    return {
      command_id: command.id,
      decision,
    };
  }

  async intakeTask(input: {
    strategy: "weighted-random-next" | "deterministic-next";
    actor: string;
    seed?: string;
    reservation_ttl_seconds?: number;
  }) {
    const command = await this.logCommand("task.intake", input.actor, null, input);

    const decision = await this.sidecar.evaluatePolicy({
      action_type: "task_intake",
      actor: input.actor,
      risk_level: "low",
      workspace_path: process.cwd(),
      payload_json: JSON.stringify(input),
      dry_run: false,
    });

    if (decision.decision === "deny") {
      await this.completeCommand(command.id, "rejected", { decision });
      return { command_id: command.id, decision, allocation: null };
    }

    const allocation = await this.sidecar.allocateTask({
      strategy: input.strategy,
      seed: input.seed,
      actor: input.actor,
      reservation_ttl_seconds: input.reservation_ttl_seconds || 4 * 60 * 60,
    });

    await this.completeCommand(command.id, "executed", {
      decision,
      allocation,
    });

    publishEvent("global", "v2.command.task.intake", {
      command_id: command.id,
      allocation,
      decision,
    });

    return {
      command_id: command.id,
      decision,
      allocation,
    };
  }

  async reserveTask(input: { ticket_id: string; actor: string; reservation_ttl_seconds?: number }) {
    const command = await this.logCommand("task.reserve", input.actor, input.ticket_id, input);

    const expiresAt = new Date(Date.now() + (input.reservation_ttl_seconds || 4 * 60 * 60) * 1000).toISOString();

    await this.events.appendEvent({
      type: "task.reserve",
      aggregateId: input.ticket_id,
      actor: input.actor,
      payload: {
        ticket_id: input.ticket_id,
        agent_id: input.actor,
        reservation_expires_at: expiresAt,
      },
      correlationId: command.id,
    });

    await this.completeCommand(command.id, "executed", {
      ticket_id: input.ticket_id,
      reservation_expires_at: expiresAt,
    });

    return {
      command_id: command.id,
      reservation_expires_at: expiresAt,
    };
  }

  async transitionTask(input: {
    ticket_id: string;
    actor: string;
    status: TaskLifecycleStatus;
    risk_level?: "low" | "medium" | "high";
  }) {
    const command = await this.logCommand("task.transition", input.actor, input.ticket_id, input);

    const decision = await this.sidecar.evaluatePolicy({
      action_type: "task_transition",
      actor: input.actor,
      risk_level: input.risk_level || "low",
      workspace_path: process.cwd(),
      payload_json: JSON.stringify(input),
      dry_run: false,
    });

    if (decision.decision === "deny") {
      await this.completeCommand(command.id, "rejected", { decision });
      return { command_id: command.id, decision, transitioned: false };
    }

    await this.events.appendEvent({
      type: "task.transition",
      aggregateId: input.ticket_id,
      actor: input.actor,
      payload: {
        ticket_id: input.ticket_id,
        status: input.status,
        agent_id: input.actor,
      },
      correlationId: command.id,
    });

    const legacyStatus = STATUS_TO_LEGACY[input.status];
    if (legacyStatus) {
      await prisma.ticket.updateMany({
        where: { id: input.ticket_id },
        data: { status: legacyStatus },
      });
    }

    await this.completeCommand(command.id, "executed", {
      decision,
      transitioned: true,
    });

    return {
      command_id: command.id,
      decision,
      transitioned: true,
    };
  }

  async requestExecution(input: {
    ticket_id: string;
    repo_id?: string;
    actor: string;
    prompt: string;
    retrieval_context_ids: string[];
    workspace_path?: string;
    risk_level?: "low" | "medium" | "high";
    routing_decision_id?: string;
    model_role?: ModelRole;
    provider_id?: ProviderId;
  }) {
    const command = await this.logCommand("execution.request", input.actor, input.ticket_id, input);

    if (!input.retrieval_context_ids?.length) {
      await this.completeCommand(command.id, "failed", {
        error: "retrieval_context_ids is required for execution.request",
      });
      throw new Error("execution.request requires retrieval_context_ids");
    }

    const resolvedRoute = await this.resolveExecutionRoute(input);
    const workspacePath = input.workspace_path || process.cwd();

    const policy = await this.sidecar.evaluatePolicy({
      action_type: "run_command",
      actor: input.actor,
      risk_level: input.risk_level || "medium",
      workspace_path: workspacePath,
      payload_json: JSON.stringify({
        ...input,
        routing_decision_id: resolvedRoute.routingDecisionId,
        model_role: resolvedRoute.modelRole,
        provider_id: resolvedRoute.providerId,
      }),
      dry_run: false,
    });

    const runId = randomUUID();
    const runStatus =
      policy.decision === "deny" ? "rejected" : policy.requires_approval ? "approval_required" : "queued";

    await prisma.runProjection.upsert({
      where: { runId },
      update: {
        ticketId: input.ticket_id,
        status: runStatus,
        providerId: resolvedRoute.providerId,
        startedAt: new Date(),
        endedAt: runStatus === "rejected" ? new Date() : null,
        metadata: {
          repo_id: input.repo_id || null,
          prompt: input.prompt,
          retrieval_context_ids: input.retrieval_context_ids,
          workspace_path: workspacePath,
          routing_decision_id: resolvedRoute.routingDecisionId,
          model_role: resolvedRoute.modelRole,
          provider_id: resolvedRoute.providerId,
          execution_mode: resolvedRoute.routingDecision?.executionMode || null,
          verification_depth: resolvedRoute.routingDecision?.verificationDepth || null,
          used_existing_routing_decision: resolvedRoute.usedExistingDecision,
          risk_level: input.risk_level || resolvedRoute.routingDecision?.risk || "medium",
        },
      },
      create: {
        runId,
        ticketId: input.ticket_id,
        status: runStatus,
        providerId: resolvedRoute.providerId,
        startedAt: new Date(),
        endedAt: runStatus === "rejected" ? new Date() : null,
        metadata: {
          repo_id: input.repo_id || null,
          prompt: input.prompt,
          retrieval_context_ids: input.retrieval_context_ids,
          workspace_path: workspacePath,
          routing_decision_id: resolvedRoute.routingDecisionId,
          model_role: resolvedRoute.modelRole,
          provider_id: resolvedRoute.providerId,
          execution_mode: resolvedRoute.routingDecision?.executionMode || null,
          verification_depth: resolvedRoute.routingDecision?.verificationDepth || null,
          used_existing_routing_decision: resolvedRoute.usedExistingDecision,
          risk_level: input.risk_level || resolvedRoute.routingDecision?.risk || "medium",
        },
      },
    });

    await prisma.workflowStateProjection.create({
      data: {
        repoId: input.repo_id || null,
        aggregateId: runId,
        phase: "execution",
        status: runStatus,
        summary: `Execution ${runStatus} via ${resolvedRoute.providerId}/${resolvedRoute.modelRole}`,
        nextSteps:
          runStatus === "approval_required"
            ? ["await_approval", "execute"]
            : resolvedRoute.routingDecision?.executionMode === "single_agent"
            ? ["execute", "verify"]
            : ["spawn_lanes", "execute", "prepare_merge_verification"],
        blockers: runStatus === "approval_required" ? ["approval_pending"] : [],
        metadata: {
          ticketId: input.ticket_id,
          repoId: input.repo_id || null,
          routingDecisionId: resolvedRoute.routingDecisionId,
          modelRole: resolvedRoute.modelRole,
          providerId: resolvedRoute.providerId,
        },
      },
    });

    await this.events.appendEvent({
      type: "execution.requested",
      aggregateId: runId,
      actor: input.actor,
      payload: {
        run_id: runId,
        ticket_id: input.ticket_id,
        prompt: input.prompt,
        retrieval_context_ids: input.retrieval_context_ids,
        routing_decision_id: resolvedRoute.routingDecisionId,
        model_role: resolvedRoute.modelRole,
        provider_id: resolvedRoute.providerId,
        status: runStatus,
      },
      correlationId: command.id,
    });

    if (policy.decision === "deny") {
      await this.completeCommand(command.id, "rejected", {
        policy,
        run_id: runId,
        routing_decision_id: resolvedRoute.routingDecisionId,
        model_role: resolvedRoute.modelRole,
        provider_id: resolvedRoute.providerId,
      });
      return {
        command_id: command.id,
        run_id: runId,
        policy,
        routing_decision_id: resolvedRoute.routingDecisionId,
        model_role: resolvedRoute.modelRole,
        provider_id: resolvedRoute.providerId,
        status: "rejected",
      };
    }

    if (policy.requires_approval) {
      const approval = await prisma.approvalRequest.create({
        data: {
          actionType: "execution_request",
          payload: {
            run_id: runId,
            ticket_id: input.ticket_id,
            prompt: input.prompt,
            retrieval_context_ids: input.retrieval_context_ids,
            routing_decision_id: resolvedRoute.routingDecisionId,
            model_role: resolvedRoute.modelRole,
            provider_id: resolvedRoute.providerId,
          },
        },
      });

      await this.events.appendEvent({
        type: "policy.decision",
        aggregateId: approval.id,
        actor: input.actor,
        payload: {
          approval_id: approval.id,
          action_type: "execution_request",
          status: "pending",
          reason: policy.reasons.join(" | "),
        },
      });

      await this.completeCommand(command.id, "approved", {
        policy,
        run_id: runId,
        approval_id: approval.id,
        routing_decision_id: resolvedRoute.routingDecisionId,
        model_role: resolvedRoute.modelRole,
        provider_id: resolvedRoute.providerId,
      });

      return {
        command_id: command.id,
        run_id: runId,
        policy,
        routing_decision_id: resolvedRoute.routingDecisionId,
        model_role: resolvedRoute.modelRole,
        provider_id: resolvedRoute.providerId,
        status: "approval_required",
        approval_id: approval.id,
      };
    }

    await this.completeCommand(command.id, "executed", {
      policy,
      run_id: runId,
      routing_decision_id: resolvedRoute.routingDecisionId,
      model_role: resolvedRoute.modelRole,
      provider_id: resolvedRoute.providerId,
      status: "queued",
    });

    return {
      command_id: command.id,
      run_id: runId,
      policy,
      routing_decision_id: resolvedRoute.routingDecisionId,
      model_role: resolvedRoute.modelRole,
      provider_id: resolvedRoute.providerId,
      status: "queued",
    };
  }

  async activateProvider(input: { provider_id: "qwen-cli" | "openai-compatible" | "onprem-qwen" | "openai-responses"; actor: string }) {
    const command = await this.logCommand("provider.activate", input.actor, input.provider_id, input);
    const health = await this.checkProviderHealth(input.provider_id);

    if (!health.ok) {
      await this.completeCommand(command.id, "failed", {
        provider_id: input.provider_id,
        health,
      });
      return {
        command_id: command.id,
        status: "rejected" as const,
        policy: {
          decision: "deny" as const,
          requires_approval: false,
          reasons: [health.reason],
          required_scopes: [],
          policy_version: "v2-health-1",
        },
      };
    }

    const policy = await this.sidecar.evaluatePolicy({
      action_type: "provider_change",
      actor: input.actor,
      risk_level: "medium",
      workspace_path: process.cwd(),
      payload_json: JSON.stringify(input),
      dry_run: false,
    });

    if (policy.decision === "deny") {
      await this.completeCommand(command.id, "rejected", { policy });
      return { command_id: command.id, policy, status: "rejected" };
    }

    if (policy.requires_approval) {
      const approval = await prisma.approvalRequest.create({
        data: {
          actionType: "provider_change",
          payload: {
            providerId: input.provider_id,
          },
        },
      });

      await this.events.appendEvent({
        type: "policy.decision",
        aggregateId: approval.id,
        actor: input.actor,
        payload: {
          approval_id: approval.id,
          action_type: "provider_change",
          status: "pending",
          reason: policy.reasons.join(" | "),
        },
      });

      await this.completeCommand(command.id, "approved", {
        policy,
        approval_id: approval.id,
      });

      return {
        command_id: command.id,
        policy,
        status: "approval_required",
        approval_id: approval.id,
      };
    }

    await this.providerOrchestrator.setActiveProvider(input.provider_id);

    await this.events.appendEvent({
      type: "provider.activated",
      aggregateId: input.provider_id,
      actor: input.actor,
      payload: {
        provider_id: input.provider_id,
      },
      correlationId: command.id,
    });

    await this.completeCommand(command.id, "executed", {
      policy,
      provider_id: input.provider_id,
    });

    return {
      command_id: command.id,
      policy,
      status: "activated",
    };
  }

  async stopExecution(input: { run_id: string; repo_id: string; actor: string; reason?: string }) {
    const command = await this.logCommand("execution.stop", input.actor, input.run_id, input);

    await this.events.appendEvent({
      type: "execution.stopped",
      aggregateId: input.run_id,
      actor: input.actor,
      payload: {
        run_id: input.run_id,
        repo_id: input.repo_id,
        reason: input.reason || "Stopped by operator",
      },
      correlationId: command.id,
    });

    await prisma.executionRun.updateMany({
      where: { id: input.run_id },
      data: { status: "failed", endedAt: new Date() },
    });

    await this.completeCommand(command.id, "executed", { stopped: true });

    return { command_id: command.id, stopped: true };
  }

  async requeueTask(input: { ticket_id: string; actor: string; reason?: string }) {
    const command = await this.logCommand("task.requeue", input.actor, input.ticket_id, input);

    await this.events.appendEvent({
      type: "task.requeued",
      aggregateId: input.ticket_id,
      actor: input.actor,
      payload: {
        ticket_id: input.ticket_id,
        reason: input.reason || "Requeued by operator",
      },
      correlationId: command.id,
    });

    await prisma.ticket.updateMany({
      where: { id: input.ticket_id },
      data: { status: "ready" },
    });

    await this.completeCommand(command.id, "executed", { requeued: true });

    return { command_id: command.id, requeued: true };
  }
}

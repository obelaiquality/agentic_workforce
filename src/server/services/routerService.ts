import { prisma } from "../db";
import { publishEvent } from "../eventBus";
import type { RoutingDecision } from "../../shared/contracts";
import { SidecarClient } from "../sidecar/client";
import { V2EventService } from "./v2EventService";

interface PlanRouteInput {
  actor: string;
  repo_id?: string;
  ticket_id?: string;
  run_id?: string;
  prompt: string;
  risk_level?: "low" | "medium" | "high";
  workspace_path?: string;
  retrieval_context_ids?: string[];
  active_files?: string[];
}

function mapDecision(row: {
  id: string;
  repoId: string | null;
  ticketId: string | null;
  runId: string | null;
  executionMode: string;
  modelRole: string;
  providerId: string;
  maxLanes: number;
  risk: string;
  verificationDepth: string;
  decompositionScore: number;
  estimatedFileOverlap: number;
  rationale: unknown;
  metadata: unknown;
  createdAt: Date;
}) {
  return {
    id: row.id,
    repoId: row.repoId,
    ticketId: row.ticketId,
    runId: row.runId,
    executionMode: row.executionMode,
    modelRole: row.modelRole,
    providerId: row.providerId,
    maxLanes: row.maxLanes,
    risk: row.risk,
    verificationDepth: row.verificationDepth,
    decompositionScore: row.decompositionScore,
    estimatedFileOverlap: row.estimatedFileOverlap,
    rationale: Array.isArray(row.rationale) ? (row.rationale as string[]) : [],
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
  } as RoutingDecision;
}

export class RouterService {
  constructor(private readonly sidecar: SidecarClient, private readonly events: V2EventService) {}

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

  async planRoute(input: PlanRouteInput) {
    const aggregateId = input.run_id || input.ticket_id || null;
    const command = await this.logCommand("router.plan", input.actor, aggregateId, input as Record<string, unknown>);

    const decision = await this.sidecar.planRoute({
      ticket_id: input.ticket_id,
      run_id: input.run_id,
      actor: input.actor,
      prompt: input.prompt,
      risk_level: input.risk_level || "medium",
      workspace_path: input.workspace_path || process.cwd(),
      retrieval_context_count: input.retrieval_context_ids?.length || 0,
      active_files_count: input.active_files?.length || 0,
    });

    const projection = await prisma.routingDecisionProjection.create({
      data: {
        ticketId: input.ticket_id || null,
        repoId: input.repo_id || null,
        runId: input.run_id || null,
        executionMode: decision.execution_mode,
        modelRole: decision.model_role,
        providerId: decision.provider_id,
        maxLanes: decision.max_lanes,
        risk: decision.risk,
        verificationDepth: decision.verification_depth,
        decompositionScore: decision.decomposition_score,
        estimatedFileOverlap: decision.estimated_file_overlap,
        rationale: decision.rationale,
        metadata: {
          prompt: input.prompt,
          retrieval_context_ids: input.retrieval_context_ids || [],
          active_files: input.active_files || [],
        },
      },
    });

    await prisma.workflowStateProjection.create({
      data: {
        aggregateId: input.run_id || input.ticket_id || projection.id,
        phase: "routing",
        status: "planned",
        summary: `Execution mode ${decision.execution_mode} via ${decision.provider_id}/${decision.model_role}`,
        nextSteps:
          decision.execution_mode === "single_agent"
            ? ["materialize_context", "queue_execution"]
            : ["materialize_context", "spawn_lanes", "prepare_merge_verification"],
        blockers: [],
        metadata: {
          routingDecisionId: projection.id,
          repoId: input.repo_id || null,
        },
      },
    });

    await this.events.appendEvent({
      type: "router.planned",
      aggregateId: input.run_id || input.ticket_id || projection.id,
      actor: input.actor,
      payload: {
        routing_decision_id: projection.id,
        repo_id: input.repo_id || null,
        ticket_id: input.ticket_id || null,
        run_id: input.run_id || null,
        execution_mode: decision.execution_mode,
        model_role: decision.model_role,
        provider_id: decision.provider_id,
        max_lanes: decision.max_lanes,
        rationale: decision.rationale,
      },
      correlationId: command.id,
    });

    publishEvent("global", "router.planned", {
      routingDecisionId: projection.id,
      ticketId: input.ticket_id || null,
      repoId: input.repo_id || null,
      runId: input.run_id || null,
      executionMode: decision.execution_mode,
      modelRole: decision.model_role,
      providerId: decision.provider_id,
      maxLanes: decision.max_lanes,
    });

    const dto = mapDecision(projection);
    await this.completeCommand(command.id, "executed", { routing_decision: dto });
    return dto;
  }

  async getDecision(id: string) {
    const row = await prisma.routingDecisionProjection.findUnique({ where: { id } });
    if (!row) {
      return null;
    }
    return mapDecision(row);
  }

  async listRecentForAggregate(aggregateId: string) {
    const rows = await prisma.routingDecisionProjection.findMany({
      where: {
        OR: [{ ticketId: aggregateId }, { runId: aggregateId }],
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return rows.map(mapDecision);
  }
}

import { prisma } from "../db";
import { SidecarClient } from "../sidecar/client";
import type { KnowledgeHit, TaskLifecycleStatus, V2TaskCard } from "../../shared/contracts";

const ORDERED_STATUSES: TaskLifecycleStatus[] = [
  "inactive",
  "reserved",
  "active",
  "in_progress",
  "blocked",
  "completed",
];

export class V2QueryService {
  constructor(private readonly sidecar: SidecarClient) {}

  async getTaskBoard(repoId?: string) {
    const tasks = await prisma.taskProjection.findMany({
      where: repoId ? { repoId } : undefined,
      include: { reservation: true },
      orderBy: [{ updatedAt: "desc" }],
    });

    const now = Date.now();
    const columns: Record<TaskLifecycleStatus, V2TaskCard[]> = {
      inactive: [],
      reserved: [],
      active: [],
      in_progress: [],
      blocked: [],
      completed: [],
    };

    for (const task of tasks) {
      const reservation = task.reservation
        ? {
            reserved_by: task.reservation.reservedBy,
            reserved_at: task.reservation.reservedAt.toISOString(),
            expires_at: task.reservation.expiresAt.toISOString(),
            stale: task.reservation.expiresAt.getTime() < now,
          }
        : null;

      columns[task.status].push({
        ticket_id: task.ticketId,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        risk: task.risk,
        assignee_agent_id: task.assigneeAgentId,
        last_transition_at: task.lastTransitionAt?.toISOString() ?? null,
        reservation,
      });
    }

    return {
      columns,
      ordered_statuses: ORDERED_STATUSES,
      stale_reservations: columns.reserved.filter((task) => Boolean(task.reservation?.stale)).length,
      total_tasks: tasks.length,
    };
  }

  async getTaskTimeline(ticketId: string, limit = 300) {
    const events = await prisma.eventLog.findMany({
      where: { aggregateId: ticketId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return events.map((event) => ({
      event_id: event.eventId,
      aggregate_id: event.aggregateId,
      causation_id: event.causationId,
      correlation_id: event.correlationId,
      actor: event.actor,
      timestamp: event.createdAt.toISOString(),
      type: event.eventType,
      payload_json: JSON.stringify(event.payload),
      schema_version: event.schemaVersion,
    }));
  }

  async getRunReplay(runId: string, limit = 1000) {
    return this.sidecar.replay({
      aggregate_id: runId,
      limit,
    });
  }

  async getPendingPolicy() {
    const pending = await prisma.approvalProjection.findMany({
      where: { status: "pending" },
      orderBy: { requestedAt: "desc" },
      take: 200,
    });

    return pending.map((item) => ({
      approval_id: item.approvalId,
      action_type: item.actionType,
      status: item.status,
      reason: item.reason,
      payload: item.payload,
      requested_at: item.requestedAt.toISOString(),
      decided_at: item.decidedAt?.toISOString() ?? null,
    }));
  }

  async searchKnowledge(query: string): Promise<KnowledgeHit[]> {
    if (!query.trim()) {
      return [];
    }

    const rows = await prisma.knowledgeIndexMetadata.findMany({
      where: {
        OR: [
          { path: { contains: query, mode: "insensitive" } },
          { source: { contains: query, mode: "insensitive" } },
          { snippet: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
      take: 30,
    });

    return rows.map((row) => ({
      id: row.id,
      source: row.source,
      path: row.path,
      snippet: row.snippet,
      score: row.score,
      embedding_id: row.embeddingId,
    }));
  }

  async getRecentCommands(limit = 100) {
    const rows = await prisma.commandLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return rows.map((row) => ({
      id: row.id,
      command_type: row.commandType,
      aggregate_id: row.aggregateId,
      status: row.status,
      payload: row.payload,
      result: row.result,
      actor: row.actor,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    }));
  }
}

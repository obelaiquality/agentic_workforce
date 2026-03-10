import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db";
import { publishEvent } from "../eventBus";
import type { AgentLane } from "../../shared/contracts";
import { SidecarClient } from "../sidecar/client";
import { V2EventService } from "./v2EventService";

interface SpawnLaneInput {
  actor: string;
  repo_id?: string;
  ticket_id: string;
  run_id?: string;
  role: AgentLane["role"];
  context_manifest_id?: string;
  lease_minutes?: number;
  summary?: string;
}

interface ReclaimLaneInput {
  actor: string;
  lane_id?: string;
  reason?: string;
}

function mapLane(row: {
  id: string;
  repoId: string | null;
  ticketId: string;
  runId: string | null;
  role: string;
  worktreePath: string;
  leaseExpiresAt: Date;
  lastHeartbeatAt: Date | null;
  state: string;
  contextManifestId: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): AgentLane {
  return {
    id: row.id,
    repoId: row.repoId,
    ticketId: row.ticketId,
    runId: row.runId,
    role: row.role as AgentLane["role"],
    worktreePath: row.worktreePath,
    leaseExpiresAt: row.leaseExpiresAt.toISOString(),
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    state: row.state as AgentLane["state"],
    contextManifestId: row.contextManifestId,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class LaneService {
  constructor(private readonly sidecar: SidecarClient, private readonly events: V2EventService) {}

  async spawnLane(input: SpawnLaneInput) {
    const leaseMinutes = Math.max(1, input.lease_minutes || 20);
    const laneRoot = path.join(process.cwd(), ".local", "lanes", input.run_id || input.ticket_id);
    fs.mkdirSync(laneRoot, { recursive: true });

    const row = await prisma.agentLane.create({
      data: {
        repoId: input.repo_id || null,
        ticketId: input.ticket_id,
        runId: input.run_id || null,
        role: input.role,
        state: "queued",
        worktreePath: path.join(laneRoot, `${input.role}-${Date.now()}`),
        contextManifestId: input.context_manifest_id || null,
        leaseExpiresAt: new Date(Date.now() + leaseMinutes * 60 * 1000),
        lastHeartbeatAt: new Date(),
        metadata: {
          summary: input.summary || `${input.role} lane spawned`,
        },
      },
    });

    fs.mkdirSync(row.worktreePath, { recursive: true });

    await prisma.worktreeLease.create({
      data: {
        repoId: input.repo_id || null,
        laneId: row.id,
        worktreePath: row.worktreePath,
        leaseOwner: input.actor,
        expiresAt: row.leaseExpiresAt,
        metadata: {
          ticket_id: input.ticket_id,
          repo_id: input.repo_id || null,
          run_id: input.run_id || null,
        },
      },
    });

    await this.sidecar.heartbeat({
      agent_id: row.id,
      status: "queued",
      summary: input.summary || `${input.role} lane queued`,
      metadata_json: JSON.stringify({
        ticket_id: input.ticket_id,
        run_id: input.run_id || null,
        role: input.role,
        repo_id: input.repo_id || null,
        worktree_path: row.worktreePath,
      }),
    });

    await this.events.appendEvent({
      type: "agent.spawned",
      aggregateId: input.run_id || input.ticket_id,
      actor: input.actor,
      payload: {
        lane_id: row.id,
        role: input.role,
        repo_id: input.repo_id || null,
        ticket_id: input.ticket_id,
        run_id: input.run_id || null,
        worktree_path: row.worktreePath,
      },
    });

    publishEvent("global", "agent.spawned", {
      laneId: row.id,
      role: input.role,
      ticketId: input.ticket_id,
      runId: input.run_id || null,
    });

    return mapLane(row);
  }

  async reclaimLane(input: ReclaimLaneInput) {
    const now = new Date();
    const rows = await prisma.agentLane.findMany({
      where: input.lane_id
        ? { id: input.lane_id }
        : {
            state: { in: ["queued", "running", "blocked"] },
            OR: [{ leaseExpiresAt: { lte: now } }, { lastHeartbeatAt: { lte: new Date(now.getTime() - 60_000) } }],
          },
    });

    const reclaimed: AgentLane[] = [];
    for (const row of rows) {
      const next = await prisma.agentLane.update({
        where: { id: row.id },
        data: {
          state: "stale",
          metadata: {
            ...(row.metadata as Record<string, unknown> | undefined),
            reclaim_reason: input.reason || "stale_lease",
          },
        },
      });

      await prisma.worktreeLease.updateMany({
        where: { laneId: row.id },
        data: {
          expiresAt: now,
        },
      });

      await this.events.appendEvent({
        type: "agent.reclaimed",
        aggregateId: row.runId || row.ticketId,
        actor: input.actor,
        payload: {
          lane_id: row.id,
          reason: input.reason || "stale_lease",
        },
      });

      reclaimed.push(mapLane(next));
    }

    return reclaimed;
  }

  async listLanes(filter?: { ticketId?: string; runId?: string }) {
    const rows = await prisma.agentLane.findMany({
      where: {
        ...(filter?.ticketId ? { ticketId: filter.ticketId } : {}),
        ...(filter?.runId ? { runId: filter.runId } : {}),
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 100,
    });

    return rows.map(mapLane);
  }
}

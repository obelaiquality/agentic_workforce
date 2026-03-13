import { prisma } from "../db";
import type { Ticket, TicketCommentThread, TicketStatus } from "../../shared/contracts";

type CanonicalWorkflowLane = "backlog" | "in_progress" | "needs_review" | "completed";

type TicketRow = {
  id: string;
  repoId: string | null;
  title: string;
  description: string;
  status: TicketStatus;
  laneOrder: number;
  priority: Ticket["priority"];
  acceptanceCriteria: string[];
  dependencies: string[];
  risk: Ticket["risk"];
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

type TicketCommentRow = {
  id: string;
  ticketId: string;
  parentCommentId: string | null;
  author: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
};

function mapTicketCommentThread(
  row: TicketCommentRow,
  replyMap: Map<string, TicketCommentRow[]>
): TicketCommentThread {
  const replies = (replyMap.get(row.id) ?? []).map((reply) => mapTicketCommentThread(reply, replyMap));
  return {
    id: row.id,
    author: row.author,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    parentCommentId: row.parentCommentId,
    replies,
  };
}

function mapTicket(ticket: TicketRow): Ticket {
  return {
    id: ticket.id,
    repoId: ticket.repoId,
    title: ticket.title,
    description: ticket.description,
    status: ticket.status,
    laneOrder: ticket.laneOrder,
    priority: ticket.priority,
    acceptanceCriteria: ticket.acceptanceCriteria,
    dependencies: ticket.dependencies,
    risk: ticket.risk,
    metadata: ticket.metadata ?? undefined,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  };
}

function canonicalLaneForStatus(status: TicketStatus): CanonicalWorkflowLane {
  if (status === "backlog" || status === "ready") return "backlog";
  if (status === "review") return "needs_review";
  if (status === "done") return "completed";
  return "in_progress";
}

function primaryStatusForLane(lane: CanonicalWorkflowLane): TicketStatus {
  switch (lane) {
    case "backlog":
      return "backlog";
    case "needs_review":
      return "review";
    case "completed":
      return "done";
    default:
      return "in_progress";
  }
}

function statusesForLane(lane: CanonicalWorkflowLane): TicketStatus[] {
  switch (lane) {
    case "backlog":
      return ["backlog", "ready"];
    case "needs_review":
      return ["review"];
    case "completed":
      return ["done"];
    default:
      return ["in_progress", "blocked"];
  }
}

function laneRank(status: TicketStatus) {
  switch (canonicalLaneForStatus(status)) {
    case "backlog":
      return 0;
    case "in_progress":
      return 1;
    case "needs_review":
      return 2;
    default:
      return 3;
  }
}

function sortTickets(rows: TicketRow[]) {
  return [...rows].sort((left, right) => {
    const laneDelta = laneRank(left.status) - laneRank(right.status);
    if (laneDelta !== 0) return laneDelta;
    if (left.laneOrder !== right.laneOrder) return left.laneOrder - right.laneOrder;
    return right.updatedAt.getTime() - left.updatedAt.getTime();
  });
}

async function resequenceTickets(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  orderedIds: string[],
  overrides: Record<string, Partial<Pick<TicketRow, "status">>> = {}
) {
  for (const [index, ticketId] of orderedIds.entries()) {
    await tx.ticket.update({
      where: { id: ticketId },
      data: {
        laneOrder: (index + 1) * 1000,
        ...(overrides[ticketId] ?? {}),
      },
    });
  }
}

export class TicketService {
  async listTickets(repoId?: string) {
    const rows = await prisma.ticket.findMany({
      where: repoId ? { repoId } : undefined,
      orderBy: [{ laneOrder: "asc" }, { updatedAt: "desc" }],
    });
    return sortTickets(rows as unknown as TicketRow[]).map((row) => mapTicket(row));
  }

  async getBoard(repoId?: string) {
    const tickets = await this.listTickets(repoId);
    const columns: Record<TicketStatus, Ticket[]> = {
      backlog: [],
      ready: [],
      in_progress: [],
      review: [],
      blocked: [],
      done: [],
    };

    for (const ticket of tickets) {
      columns[ticket.status].push(ticket);
    }

    return columns;
  }

  async createTicket(input: {
    repoId?: string | null;
    title: string;
    description?: string;
    priority?: Ticket["priority"];
    risk?: Ticket["risk"];
    acceptanceCriteria?: string[];
    dependencies?: string[];
    status?: TicketStatus;
  }) {
    const lane = canonicalLaneForStatus(input.status ?? "backlog");
    const laneStatuses = statusesForLane(lane);
    const latestInLane = await prisma.ticket.findFirst({
      where: {
        repoId: input.repoId || null,
        status: { in: laneStatuses },
      },
      orderBy: [{ laneOrder: "desc" }, { updatedAt: "desc" }],
    });

    const ticket = await prisma.ticket.create({
      data: {
        repoId: input.repoId || null,
        title: input.title,
        description: input.description ?? "",
        laneOrder: latestInLane?.laneOrder ? latestInLane.laneOrder + 1000 : 1000,
        priority: input.priority ?? "p2",
        risk: input.risk ?? "medium",
        acceptanceCriteria: input.acceptanceCriteria ?? [],
        dependencies: input.dependencies ?? [],
        status: input.status ?? "backlog",
      },
    });

    await prisma.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: "ticket.created",
        payload: {
          status: ticket.status,
          priority: ticket.priority,
        },
      },
    });

    await prisma.auditEvent.create({
      data: {
        actor: "user",
        eventType: "ticket.created",
        payload: {
          ticketId: ticket.id,
        },
      },
    });

    return mapTicket(ticket as unknown as TicketRow);
  }

  async updateTicket(
    ticketId: string,
    patch: Partial<{
      title: string;
      description: string;
      priority: Ticket["priority"];
      risk: Ticket["risk"];
      acceptanceCriteria: string[];
      dependencies: string[];
    }>
  ) {
    const ticket = await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        title: patch.title,
        description: patch.description,
        priority: patch.priority,
        risk: patch.risk,
        acceptanceCriteria: patch.acceptanceCriteria,
        dependencies: patch.dependencies,
      },
    });

    await prisma.ticketEvent.create({
      data: {
        ticketId,
        type: "ticket.updated",
        payload: patch,
      },
    });

    await prisma.auditEvent.create({
      data: {
        actor: "user",
        eventType: "ticket.updated",
        payload: {
          ticketId,
          patch,
        },
      },
    });

    return mapTicket(ticket as unknown as TicketRow);
  }

  async moveTicket(ticketId: string, status: TicketStatus) {
    const ticket = await prisma.$transaction(
      async (tx) => {
        const current = (await tx.ticket.findUnique({
          where: { id: ticketId },
        })) as unknown as TicketRow | null;
        if (!current) {
          throw new Error(`Ticket not found: ${ticketId}`);
        }

        const lane = canonicalLaneForStatus(status);
        const laneStatuses = statusesForLane(lane);
        const latestInLane = await tx.ticket.findFirst({
          where: {
            repoId: current.repoId,
            status: { in: laneStatuses },
            NOT: { id: ticketId },
          },
          orderBy: [{ laneOrder: "desc" }, { updatedAt: "desc" }],
        });

        return (await tx.ticket.update({
          where: { id: ticketId },
          data: {
            status,
            laneOrder: latestInLane?.laneOrder ? latestInLane.laneOrder + 1000 : 1000,
          },
        })) as unknown as TicketRow;
      },
      {
        maxWait: 15000,
        timeout: 30000,
      }
    );

    await prisma.ticketEvent.create({
      data: {
        ticketId,
        type: "ticket.moved",
        payload: {
          status,
        },
      },
    });

    await prisma.auditEvent.create({
      data: {
        actor: "user",
        eventType: "ticket.moved",
        payload: {
          ticketId,
          status,
        },
      },
    });

    return mapTicket(ticket);
  }

  async moveWorkflow(
    ticketId: string,
    toLane: CanonicalWorkflowLane,
    beforeTicketId?: string | null
  ) {
    const ticket = await prisma.$transaction(
      async (tx) => {
        const current = (await tx.ticket.findUnique({
          where: { id: ticketId },
        })) as unknown as TicketRow | null;
        if (!current) {
          throw new Error(`Ticket not found: ${ticketId}`);
        }

        const sourceLane = canonicalLaneForStatus(current.status);
        const targetLane = toLane;
        const targetStatuses = statusesForLane(targetLane);
        const targetRows = (await tx.ticket.findMany({
          where: {
            repoId: current.repoId,
            status: { in: targetStatuses },
          },
          orderBy: [{ laneOrder: "asc" }, { updatedAt: "desc" }],
        })) as unknown as TicketRow[];

        const targetIds = sortTickets(targetRows)
          .map((row) => row.id)
          .filter((id) => id !== ticketId);

        const insertIndex =
          beforeTicketId && targetIds.includes(beforeTicketId) ? targetIds.indexOf(beforeTicketId) : targetIds.length;
        targetIds.splice(insertIndex, 0, ticketId);

        const statusOverride =
          sourceLane === targetLane ? current.status : primaryStatusForLane(targetLane);

        if (sourceLane !== targetLane) {
          const sourceRows = (await tx.ticket.findMany({
            where: {
              repoId: current.repoId,
              status: { in: statusesForLane(sourceLane) },
            },
            orderBy: [{ laneOrder: "asc" }, { updatedAt: "desc" }],
          })) as unknown as TicketRow[];
          const sourceIds = sortTickets(sourceRows)
            .map((row) => row.id)
            .filter((id) => id !== ticketId);
          await resequenceTickets(tx, sourceIds);
        }

        await resequenceTickets(tx, targetIds, {
          [ticketId]: { status: statusOverride },
        });

        return (await tx.ticket.findUnique({
          where: { id: ticketId },
        })) as unknown as TicketRow;
      },
      {
        maxWait: 15000,
        timeout: 30000,
      }
    );

    await prisma.ticketEvent.create({
      data: {
        ticketId,
        type: "ticket.workflow_moved",
        payload: {
          lane: toLane,
          beforeTicketId: beforeTicketId ?? null,
        },
      },
    });

    await prisma.auditEvent.create({
      data: {
        actor: "user",
        eventType: "ticket.workflow_moved",
        payload: {
          ticketId,
          lane: toLane,
          beforeTicketId: beforeTicketId ?? null,
        },
      },
    });

    return mapTicket(ticket);
  }

  async listTicketComments(ticketId: string, limit = 50) {
    const rows = (await prisma.ticketComment.findMany({
      where: { ticketId },
      orderBy: [{ createdAt: "asc" }],
      take: limit,
    })) as unknown as TicketCommentRow[];

    const replyMap = new Map<string, TicketCommentRow[]>();
    const rootRows: TicketCommentRow[] = [];

    for (const row of rows) {
      if (!row.parentCommentId) {
        rootRows.push(row);
        continue;
      }
      const existing = replyMap.get(row.parentCommentId) ?? [];
      existing.push(row);
      replyMap.set(row.parentCommentId, existing);
    }

    return rootRows.map((row) => mapTicketCommentThread(row, replyMap));
  }

  async addTicketComment(input: {
    ticketId: string;
    author?: string | null;
    body: string;
    parentCommentId?: string | null;
  }) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: input.ticketId },
      select: { id: true },
    });
    if (!ticket) {
      throw new Error(`Ticket not found: ${input.ticketId}`);
    }

    let parentCommentId: string | null = null;
    if (input.parentCommentId) {
      const parent = await prisma.ticketComment.findUnique({
        where: { id: input.parentCommentId },
        select: { id: true, ticketId: true },
      });
      if (!parent || parent.ticketId !== input.ticketId) {
        throw new Error(`Parent comment not found on ticket: ${input.parentCommentId}`);
      }
      parentCommentId = parent.id;
    }

    const comment = (await prisma.ticketComment.create({
      data: {
        ticketId: input.ticketId,
        parentCommentId,
        author: input.author?.trim() || "operator",
        body: input.body.trim(),
      },
    })) as unknown as TicketCommentRow;

    await prisma.ticketEvent.create({
      data: {
        ticketId: input.ticketId,
        type: "ticket.comment_added",
        payload: {
          commentId: comment.id,
          author: comment.author,
          parentCommentId: comment.parentCommentId,
        },
      },
    });

    await prisma.auditEvent.create({
      data: {
        actor: comment.author,
        eventType: "ticket.comment_added",
        payload: {
          ticketId: input.ticketId,
          commentId: comment.id,
        },
      },
    });

    return {
      id: comment.id,
      author: comment.author,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      parentCommentId: comment.parentCommentId,
      replies: [],
    };
  }

  async getTicketExecutionProfileOverride(ticketId: string) {
    const event = await prisma.ticketEvent.findFirst({
      where: {
        ticketId,
        type: {
          in: ["ticket.execution_profile_set", "ticket.execution_profile_cleared"],
        },
      },
      orderBy: [{ createdAt: "desc" }],
    });

    if (!event) {
      return undefined;
    }

    const payload = (event.payload ?? {}) as Record<string, unknown>;
    return typeof payload.executionProfileId === "string" ? payload.executionProfileId : null;
  }

  async setTicketExecutionProfileOverride(input: {
    ticketId: string;
    executionProfileId: string | null;
    actor?: string | null;
  }) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: input.ticketId },
      select: { id: true },
    });
    if (!ticket) {
      throw new Error(`Ticket not found: ${input.ticketId}`);
    }

    const executionProfileId = input.executionProfileId?.trim() || null;
    await prisma.ticketEvent.create({
      data: {
        ticketId: input.ticketId,
        type: executionProfileId ? "ticket.execution_profile_set" : "ticket.execution_profile_cleared",
        payload: {
          executionProfileId,
        },
      },
    });

    await prisma.auditEvent.create({
      data: {
        actor: input.actor?.trim() || "user",
        eventType: executionProfileId ? "ticket.execution_profile_set" : "ticket.execution_profile_cleared",
        payload: {
          ticketId: input.ticketId,
          executionProfileId,
        },
      },
    });

    return {
      ticketId: input.ticketId,
      executionProfileId,
    };
  }
}

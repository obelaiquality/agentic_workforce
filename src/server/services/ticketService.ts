import { prisma } from "../db";
import type { Ticket, TicketStatus } from "../../shared/contracts";

function mapTicket(ticket: {
  id: string;
  repoId: string | null;
  title: string;
  description: string;
  status: TicketStatus;
  priority: Ticket["priority"];
  acceptanceCriteria: string[];
  dependencies: string[];
  risk: Ticket["risk"];
  createdAt: Date;
  updatedAt: Date;
}): Ticket {
  return {
    id: ticket.id,
    repoId: ticket.repoId,
    title: ticket.title,
    description: ticket.description,
    status: ticket.status,
    priority: ticket.priority,
    acceptanceCriteria: ticket.acceptanceCriteria,
    dependencies: ticket.dependencies,
    risk: ticket.risk,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  };
}

export class TicketService {
  async listTickets(repoId?: string) {
    const rows = await prisma.ticket.findMany({
      where: repoId ? { repoId } : undefined,
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    });
    return rows.map((row) => mapTicket(row as unknown as Parameters<typeof mapTicket>[0]));
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
    const ticket = await prisma.ticket.create({
      data: {
        repoId: input.repoId || null,
        title: input.title,
        description: input.description ?? "",
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

    return mapTicket(ticket as unknown as Parameters<typeof mapTicket>[0]);
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

    return mapTicket(ticket as unknown as Parameters<typeof mapTicket>[0]);
  }

  async moveTicket(ticketId: string, status: TicketStatus) {
    const ticket = await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        status,
      },
    });

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

    return mapTicket(ticket as unknown as Parameters<typeof mapTicket>[0]);
  }
}

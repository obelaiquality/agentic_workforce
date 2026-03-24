import { prisma } from "../../db";
import type { TicketStatus } from "../../../shared/contracts";

export function mapLegacyToLifecycle(status: TicketStatus) {
  if (status === "backlog") return "inactive";
  if (status === "ready") return "active";
  if (status === "in_progress") return "in_progress";
  if (status === "blocked") return "blocked";
  if (status === "done") return "completed";
  return "active";
}

export async function syncTaskProjectionFromTicket(ticket: {
  id: string;
  repoId?: string | null;
  title: string;
  description: string;
  status: TicketStatus;
  priority: "p0" | "p1" | "p2" | "p3";
  risk: "low" | "medium" | "high";
  acceptanceCriteria: string[];
  dependencies: string[];
}) {
  await prisma.taskProjection.upsert({
    where: { ticketId: ticket.id },
    update: {
      repoId: ticket.repoId || null,
      title: ticket.title,
      description: ticket.description,
      status: mapLegacyToLifecycle(ticket.status),
      priority: ticket.priority,
      risk: ticket.risk,
      acceptanceCriteria: ticket.acceptanceCriteria,
      dependencies: ticket.dependencies,
    },
    create: {
      ticketId: ticket.id,
      repoId: ticket.repoId || null,
      title: ticket.title,
      description: ticket.description,
      status: mapLegacyToLifecycle(ticket.status),
      priority: ticket.priority,
      risk: ticket.risk,
      acceptanceCriteria: ticket.acceptanceCriteria,
      dependencies: ticket.dependencies,
    },
  });
}

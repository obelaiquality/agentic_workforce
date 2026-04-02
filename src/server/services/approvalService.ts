import { prisma } from "../db";

export class ApprovalService {
  private async syncProjection(approval: {
    id: string;
    actionType: string;
    status: "pending" | "approved" | "rejected";
    reason: string | null;
    payload: unknown;
    requestedAt: Date;
    decidedAt: Date | null;
  }) {
    await prisma.approvalProjection.upsert({
      where: { approvalId: approval.id },
      update: {
        actionType: approval.actionType,
        status: approval.status,
        reason: approval.reason,
        payload: approval.payload,
        requestedAt: approval.requestedAt,
        decidedAt: approval.decidedAt,
      },
      create: {
        approvalId: approval.id,
        actionType: approval.actionType,
        status: approval.status,
        reason: approval.reason,
        payload: approval.payload,
        requestedAt: approval.requestedAt,
        decidedAt: approval.decidedAt,
      },
    });
  }

  async createApproval(req: {
    runId: string;
    toolName: string;
    toolInput: unknown;
    actor: string;
    ticketId?: string | null;
    repoId?: string | null;
    stage?: string | null;
    reason?: string | null;
  }): Promise<{ id: string }> {
    const approval = await prisma.approvalRequest.create({
      data: {
        actionType: req.toolName,
        reason: req.reason ?? null,
        payload: {
          runId: req.runId,
          run_id: req.runId,
          aggregate_id: req.ticketId || null,
          ticket_id: req.ticketId || null,
          repo_id: req.repoId || null,
          stage: req.stage || null,
          toolInput: req.toolInput,
          actor: req.actor,
        },
      },
    });
    await this.syncProjection(approval);
    return { id: approval.id };
  }

  async listApprovals() {
    return prisma.approvalRequest.findMany({
      orderBy: { requestedAt: "desc" },
      take: 100,
    });
  }

  async decideApproval(id: string, input: { decision: "approved" | "rejected"; reason?: string; decidedBy?: string }) {
    const approval = await prisma.approvalRequest.update({
      where: { id },
      data: {
        status: input.decision,
        reason: input.reason,
        decidedBy: input.decidedBy ?? "user",
        decidedAt: new Date(),
      },
    });

    await this.syncProjection(approval);

    await prisma.auditEvent.create({
      data: {
        actor: input.decidedBy ?? "user",
        eventType: "approval.decided",
        payload: {
          approvalId: id,
          decision: input.decision,
          reason: input.reason,
        },
      },
    });

    return approval;
  }
}

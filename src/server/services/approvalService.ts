import { prisma } from "../db";

export class ApprovalService {
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

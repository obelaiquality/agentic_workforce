import { prisma } from "../db";

export class AuditService {
  async listEvents(limit = 200) {
    return prisma.auditEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}

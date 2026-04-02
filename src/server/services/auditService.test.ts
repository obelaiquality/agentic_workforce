import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../db";
import { AuditService } from "./auditService";

vi.mock("../db", () => ({
  prisma: {
    auditEvent: {
      findMany: vi.fn(),
    },
  },
}));

describe("AuditService", () => {
  let svc: AuditService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new AuditService();
  });

  // ── listEvents ──────────────────────────────────────────────────────

  describe("listEvents", () => {
    it("calls prisma with correct orderBy", async () => {
      (prisma.auditEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await svc.listEvents();

      const call = (prisma.auditEvent.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.orderBy).toEqual({ createdAt: "desc" });
    });

    it("respects limit parameter", async () => {
      (prisma.auditEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await svc.listEvents(50);

      const call = (prisma.auditEvent.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.take).toBe(50);
    });

    it("returns empty array when no events", async () => {
      (prisma.auditEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await svc.listEvents();
      expect(result).toEqual([]);
    });

    it("returns events in descending timestamp order", async () => {
      const events = [
        { id: "e2", createdAt: new Date("2025-01-02"), eventType: "approval.decided", actor: "admin", payload: {} },
        { id: "e1", createdAt: new Date("2025-01-01"), eventType: "task.started", actor: "agent", payload: {} },
      ];
      (prisma.auditEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(events);

      const result = await svc.listEvents();

      expect(result).toEqual(events);
      expect(prisma.auditEvent.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: "desc" },
        take: 200,
      });
    });

    it("uses default limit of 200 when not specified", async () => {
      (prisma.auditEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await svc.listEvents();

      const call = (prisma.auditEvent.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.take).toBe(200);
    });
  });
});

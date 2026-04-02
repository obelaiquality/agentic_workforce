import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../db";
import { ApprovalService } from "./approvalService";

vi.mock("../db", () => ({
  prisma: {
    approvalRequest: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    approvalProjection: {
      upsert: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
  },
}));

describe("ApprovalService", () => {
  let svc: ApprovalService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new ApprovalService();
  });

  // ── createApproval ──────────────────────────────────────────────────

  describe("createApproval", () => {
    it("creates request with all fields and calls syncProjection", async () => {
      const fakeApproval = {
        id: "apr-1",
        actionType: "shell_exec",
        status: "pending" as const,
        reason: "dangerous command",
        payload: {
          runId: "run-1",
          run_id: "run-1",
          aggregate_id: "ticket-1",
          ticket_id: "ticket-1",
          repo_id: "repo-1",
          stage: "build",
          toolInput: { cmd: "rm -rf /" },
          actor: "agent-1",
        },
        requestedAt: new Date("2025-01-01"),
        decidedAt: null,
      };

      (prisma.approvalRequest.create as ReturnType<typeof vi.fn>).mockResolvedValue(fakeApproval);
      (prisma.approvalProjection.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const result = await svc.createApproval({
        runId: "run-1",
        toolName: "shell_exec",
        toolInput: { cmd: "rm -rf /" },
        actor: "agent-1",
        ticketId: "ticket-1",
        repoId: "repo-1",
        stage: "build",
        reason: "dangerous command",
      });

      expect(prisma.approvalRequest.create).toHaveBeenCalledWith({
        data: {
          actionType: "shell_exec",
          reason: "dangerous command",
          payload: {
            runId: "run-1",
            run_id: "run-1",
            aggregate_id: "ticket-1",
            ticket_id: "ticket-1",
            repo_id: "repo-1",
            stage: "build",
            toolInput: { cmd: "rm -rf /" },
            actor: "agent-1",
          },
        },
      });

      expect(prisma.approvalProjection.upsert).toHaveBeenCalledWith({
        where: { approvalId: "apr-1" },
        update: expect.objectContaining({ actionType: "shell_exec", status: "pending" }),
        create: expect.objectContaining({ approvalId: "apr-1", actionType: "shell_exec", status: "pending" }),
      });

      expect(result).toEqual({ id: "apr-1" });
    });

    it("handles optional fields (ticketId, repoId, stage, reason as null)", async () => {
      const fakeApproval = {
        id: "apr-2",
        actionType: "write_file",
        status: "pending" as const,
        reason: null,
        payload: {
          runId: "run-2",
          run_id: "run-2",
          aggregate_id: null,
          ticket_id: null,
          repo_id: null,
          stage: null,
          toolInput: { path: "/a.ts" },
          actor: "agent-2",
        },
        requestedAt: new Date("2025-01-02"),
        decidedAt: null,
      };

      (prisma.approvalRequest.create as ReturnType<typeof vi.fn>).mockResolvedValue(fakeApproval);
      (prisma.approvalProjection.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});

      await svc.createApproval({
        runId: "run-2",
        toolName: "write_file",
        toolInput: { path: "/a.ts" },
        actor: "agent-2",
      });

      expect(prisma.approvalRequest.create).toHaveBeenCalledWith({
        data: {
          actionType: "write_file",
          reason: null,
          payload: expect.objectContaining({
            aggregate_id: null,
            ticket_id: null,
            repo_id: null,
            stage: null,
          }),
        },
      });
    });

    it("returns generated id", async () => {
      const fakeApproval = {
        id: "apr-unique-42",
        actionType: "read_file",
        status: "pending" as const,
        reason: null,
        payload: {},
        requestedAt: new Date(),
        decidedAt: null,
      };

      (prisma.approvalRequest.create as ReturnType<typeof vi.fn>).mockResolvedValue(fakeApproval);
      (prisma.approvalProjection.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const result = await svc.createApproval({
        runId: "run-3",
        toolName: "read_file",
        toolInput: {},
        actor: "agent-3",
      });

      expect(result.id).toBe("apr-unique-42");
    });
  });

  // ── listApprovals ───────────────────────────────────────────────────

  describe("listApprovals", () => {
    it("returns ordered by requestedAt desc", async () => {
      const fakeList = [
        { id: "apr-2", requestedAt: new Date("2025-01-02") },
        { id: "apr-1", requestedAt: new Date("2025-01-01") },
      ];

      (prisma.approvalRequest.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(fakeList);

      const result = await svc.listApprovals();

      expect(prisma.approvalRequest.findMany).toHaveBeenCalledWith({
        orderBy: { requestedAt: "desc" },
        take: 100,
      });
      expect(result).toEqual(fakeList);
    });

    it("respects take limit of 100", async () => {
      (prisma.approvalRequest.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await svc.listApprovals();

      const call = (prisma.approvalRequest.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.take).toBe(100);
    });

    it("returns empty array when no approvals", async () => {
      (prisma.approvalRequest.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await svc.listApprovals();
      expect(result).toEqual([]);
    });
  });

  // ── decideApproval ──────────────────────────────────────────────────

  describe("decideApproval", () => {
    const makeApproval = (overrides: Record<string, unknown> = {}) => ({
      id: "apr-1",
      actionType: "shell_exec",
      status: "approved" as const,
      reason: null,
      payload: {},
      requestedAt: new Date("2025-01-01"),
      decidedAt: new Date("2025-01-02"),
      ...overrides,
    });

    it("updates status to approved with decidedAt", async () => {
      const approved = makeApproval({ status: "approved" });
      (prisma.approvalRequest.update as ReturnType<typeof vi.fn>).mockResolvedValue(approved);
      (prisma.approvalProjection.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prisma.auditEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

      await svc.decideApproval("apr-1", { decision: "approved" });

      const updateCall = (prisma.approvalRequest.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(updateCall.where).toEqual({ id: "apr-1" });
      expect(updateCall.data.status).toBe("approved");
      expect(updateCall.data.decidedAt).toBeInstanceOf(Date);
    });

    it("updates status to rejected with reason", async () => {
      const rejected = makeApproval({ status: "rejected", reason: "too risky" });
      (prisma.approvalRequest.update as ReturnType<typeof vi.fn>).mockResolvedValue(rejected);
      (prisma.approvalProjection.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prisma.auditEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

      await svc.decideApproval("apr-1", { decision: "rejected", reason: "too risky" });

      const updateCall = (prisma.approvalRequest.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(updateCall.data.status).toBe("rejected");
      expect(updateCall.data.reason).toBe("too risky");
    });

    it("creates audit event with correct payload", async () => {
      const approved = makeApproval();
      (prisma.approvalRequest.update as ReturnType<typeof vi.fn>).mockResolvedValue(approved);
      (prisma.approvalProjection.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prisma.auditEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

      await svc.decideApproval("apr-1", { decision: "approved", reason: "looks safe", decidedBy: "admin" });

      expect(prisma.auditEvent.create).toHaveBeenCalledWith({
        data: {
          actor: "admin",
          eventType: "approval.decided",
          payload: {
            approvalId: "apr-1",
            decision: "approved",
            reason: "looks safe",
          },
        },
      });
    });

    it("calls syncProjection with updated approval", async () => {
      const approved = makeApproval({ id: "apr-5", status: "approved" });
      (prisma.approvalRequest.update as ReturnType<typeof vi.fn>).mockResolvedValue(approved);
      (prisma.approvalProjection.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prisma.auditEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

      await svc.decideApproval("apr-5", { decision: "approved" });

      expect(prisma.approvalProjection.upsert).toHaveBeenCalledWith({
        where: { approvalId: "apr-5" },
        update: expect.objectContaining({ status: "approved" }),
        create: expect.objectContaining({ approvalId: "apr-5", status: "approved" }),
      });
    });

    it("uses default decidedBy 'user' when not provided", async () => {
      const approved = makeApproval();
      (prisma.approvalRequest.update as ReturnType<typeof vi.fn>).mockResolvedValue(approved);
      (prisma.approvalProjection.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prisma.auditEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

      await svc.decideApproval("apr-1", { decision: "approved" });

      const updateCall = (prisma.approvalRequest.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(updateCall.data.decidedBy).toBe("user");

      const auditCall = (prisma.auditEvent.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(auditCall.data.actor).toBe("user");
    });
  });

  // ── syncProjection ──────────────────────────────────────────────────

  describe("syncProjection", () => {
    it("upserts with correct where/update/create", async () => {
      const fakeApproval = {
        id: "apr-proj",
        actionType: "shell_exec",
        status: "pending" as const,
        reason: "testing",
        payload: { foo: "bar" },
        requestedAt: new Date("2025-03-01"),
        decidedAt: null,
      };

      (prisma.approvalRequest.create as ReturnType<typeof vi.fn>).mockResolvedValue(fakeApproval);
      (prisma.approvalProjection.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});

      await svc.createApproval({
        runId: "run-proj",
        toolName: "shell_exec",
        toolInput: {},
        actor: "agent-proj",
        reason: "testing",
      });

      expect(prisma.approvalProjection.upsert).toHaveBeenCalledWith({
        where: { approvalId: "apr-proj" },
        update: {
          actionType: "shell_exec",
          status: "pending",
          reason: "testing",
          payload: { foo: "bar" },
          requestedAt: new Date("2025-03-01"),
          decidedAt: null,
        },
        create: {
          approvalId: "apr-proj",
          actionType: "shell_exec",
          status: "pending",
          reason: "testing",
          payload: { foo: "bar" },
          requestedAt: new Date("2025-03-01"),
          decidedAt: null,
        },
      });
    });
  });
});

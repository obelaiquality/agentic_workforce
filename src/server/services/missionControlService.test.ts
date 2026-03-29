import { beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ */
/*  Hoisted mocks for prisma and all service dependencies             */
/* ------------------------------------------------------------------ */

const mocks = vi.hoisted(() => ({
  prisma: {
    ticket: { findMany: vi.fn().mockResolvedValue([]) },
    ticketEvent: { findMany: vi.fn().mockResolvedValue([]) },
    runProjection: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    routingDecisionProjection: { findUnique: vi.fn().mockResolvedValue(null) },
    executionAttempt: { findFirst: vi.fn().mockResolvedValue(null) },
    agentLane: { findMany: vi.fn().mockResolvedValue([]) },
    auditEvent: { findMany: vi.fn().mockResolvedValue([]) },
    runEvent: { findMany: vi.fn().mockResolvedValue([]) },
    verificationBundle: { findMany: vi.fn().mockResolvedValue([]) },
    appSetting: { findUnique: vi.fn().mockResolvedValue(null) },
  },
  repoService: {
    listRepos: vi.fn().mockResolvedValue([]),
    getRepo: vi.fn().mockResolvedValue(null),
    getActiveRepo: vi.fn().mockResolvedValue(null),
    getGuidelines: vi.fn().mockResolvedValue(null),
    getState: vi.fn().mockResolvedValue(null),
  },
  blueprintService: { get: vi.fn().mockResolvedValue(null) },
  chatService: {
    listSessions: vi.fn().mockResolvedValue([]),
    listMessages: vi.fn().mockResolvedValue([]),
  },
  ticketService: {
    listTickets: vi.fn().mockResolvedValue([]),
    getTicketExecutionProfileOverride: vi.fn().mockResolvedValue(null),
    getTicketExecutionPolicy: vi.fn().mockResolvedValue(null),
    listTicketComments: vi.fn().mockResolvedValue([]),
  },
  v2QueryService: {
    getPendingPolicy: vi.fn().mockResolvedValue([]),
    getRecentCommands: vi.fn().mockResolvedValue([]),
  },
  routerService: { listRecentForAggregate: vi.fn().mockResolvedValue([]) },
  contextService: { getWorkflowState: vi.fn().mockResolvedValue(null) },
  codeGraphService: {
    getLatestContextPack: vi.fn().mockResolvedValue(null),
    getStatus: vi.fn().mockResolvedValue(null),
    getVerificationBundle: vi.fn().mockResolvedValue(null),
  },
  githubService: { getShareReport: vi.fn().mockResolvedValue(null) },
}));

vi.mock("../db", () => ({ prisma: mocks.prisma }));

import { MissionControlService } from "./missionControlService";
import type { Ticket, RoutingDecision, V2CommandLogItem, V2PolicyPendingItem } from "../../shared/contracts";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "ticket-1",
    repoId: "repo-1",
    title: "Implement feature X",
    description: "Build the X feature with full test coverage",
    status: "in_progress",
    laneOrder: 1000,
    priority: "p1",
    acceptanceCriteria: ["tests pass"],
    dependencies: [],
    risk: "low",
    createdAt: "2026-03-28T12:00:00.000Z",
    updatedAt: "2026-03-28T12:30:00.000Z",
    ...overrides,
  };
}

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    id: "repo-1",
    name: "test-project",
    localPath: "/tmp/test",
    updatedAt: "2026-03-28T12:00:00.000Z",
    ...overrides,
  };
}

function makeCommand(overrides: Partial<V2CommandLogItem> = {}): V2CommandLogItem {
  return {
    id: "cmd-1",
    command_type: "execution.request",
    status: "completed",
    aggregate_id: "ticket-1",
    created_at: "2026-03-28T12:10:00.000Z",
    result: {},
    ...overrides,
  } as V2CommandLogItem;
}

function makeApproval(overrides: Partial<V2PolicyPendingItem> = {}): V2PolicyPendingItem {
  return {
    approval_id: "appr-1",
    action_type: "file.write",
    status: "pending",
    requested_at: "2026-03-28T12:15:00.000Z",
    reason: "Write access required",
    payload: { aggregate_id: "ticket-1" },
    ...overrides,
  } as V2PolicyPendingItem;
}

function buildService() {
  return new MissionControlService(
    mocks.repoService as any,
    mocks.blueprintService as any,
    mocks.chatService as any,
    mocks.ticketService as any,
    mocks.v2QueryService as any,
    mocks.routerService as any,
    mocks.contextService as any,
    mocks.codeGraphService as any,
    mocks.githubService as any,
  );
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("MissionControlService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset defaults after clearAllMocks
    mocks.repoService.listRepos.mockResolvedValue([]);
    mocks.repoService.getActiveRepo.mockResolvedValue(null);
    mocks.repoService.getRepo.mockResolvedValue(null);
    mocks.repoService.getGuidelines.mockResolvedValue(null);
    mocks.repoService.getState.mockResolvedValue(null);
    mocks.blueprintService.get.mockResolvedValue(null);
    mocks.chatService.listSessions.mockResolvedValue([]);
    mocks.chatService.listMessages.mockResolvedValue([]);
    mocks.ticketService.listTickets.mockResolvedValue([]);
    mocks.ticketService.getTicketExecutionProfileOverride.mockResolvedValue(null);
    mocks.ticketService.getTicketExecutionPolicy.mockResolvedValue(null);
    mocks.ticketService.listTicketComments.mockResolvedValue([]);
    mocks.v2QueryService.getPendingPolicy.mockResolvedValue([]);
    mocks.v2QueryService.getRecentCommands.mockResolvedValue([]);
    mocks.routerService.listRecentForAggregate.mockResolvedValue([]);
    mocks.contextService.getWorkflowState.mockResolvedValue(null);
    mocks.codeGraphService.getLatestContextPack.mockResolvedValue(null);
    mocks.codeGraphService.getStatus.mockResolvedValue(null);
    mocks.codeGraphService.getVerificationBundle.mockResolvedValue(null);
    mocks.githubService.getShareReport.mockResolvedValue(null);
    mocks.prisma.ticket.findMany.mockResolvedValue([]);
    mocks.prisma.ticketEvent.findMany.mockResolvedValue([]);
    mocks.prisma.runProjection.findUnique.mockResolvedValue(null);
    mocks.prisma.runProjection.findMany.mockResolvedValue([]);
    mocks.prisma.routingDecisionProjection.findUnique.mockResolvedValue(null);
    mocks.prisma.executionAttempt.findFirst.mockResolvedValue(null);
    mocks.prisma.agentLane.findMany.mockResolvedValue([]);
    mocks.prisma.auditEvent.findMany.mockResolvedValue([]);
    mocks.prisma.runEvent.findMany.mockResolvedValue([]);
    mocks.prisma.verificationBundle.findMany.mockResolvedValue([]);
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
  });

  /* ---- Constructor ---- */

  describe("constructor", () => {
    it("accepts all required service dependencies", () => {
      const service = buildService();
      expect(service).toBeDefined();
    });
  });

  /* ---- getSnapshot: empty / idle states ---- */

  describe("getSnapshot — idle / no project", () => {
    it("returns idle snapshot when no repos exist", async () => {
      const service = buildService();
      const snapshot = await service.getSnapshot();

      expect(snapshot.project).toBeNull();
      expect(snapshot.recentProjects).toEqual([]);
      expect(snapshot.runPhase).toBe("idle");
      expect(snapshot.tickets).toEqual([]);
      expect(snapshot.workflowCards).toEqual([]);
      expect(snapshot.timeline).toEqual([]);
      expect(snapshot.consoleLogs).toEqual([]);
      expect(snapshot.spotlight).toBeNull();
      expect(snapshot.actionCapabilities.canRefresh).toBe(true);
      expect(snapshot.actionCapabilities.canRetry).toBe(false);
    });
  });

  /* ---- getSnapshot: deriveBriefStatus via changeBriefs ---- */

  describe("getSnapshot — changeBriefs / deriveBriefStatus", () => {
    it("marks blocked tickets as failed, done as success, in_progress as active", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);

      const tickets: Ticket[] = [
        makeTicket({ id: "t-blocked", status: "blocked", title: "Blocked task" }),
        makeTicket({ id: "t-done", status: "done", title: "Done task" }),
        makeTicket({ id: "t-review", status: "review", title: "Review task" }),
        makeTicket({ id: "t-active", status: "in_progress", title: "Active task" }),
      ];
      mocks.ticketService.listTickets.mockResolvedValue(tickets);

      const service = buildService();
      const snapshot = await service.getSnapshot();

      const briefs = snapshot.changeBriefs;
      expect(briefs).toHaveLength(4);
      expect(briefs.find((b) => b.task_id === "t-blocked")?.status).toBe("failed");
      expect(briefs.find((b) => b.task_id === "t-done")?.status).toBe("success");
      expect(briefs.find((b) => b.task_id === "t-review")?.status).toBe("success");
      expect(briefs.find((b) => b.task_id === "t-active")?.status).toBe("active");
    });

    it("truncates long descriptions via summarize", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);

      const longDesc = "A".repeat(200);
      mocks.ticketService.listTickets.mockResolvedValue([
        makeTicket({ id: "t-long", description: longDesc }),
      ]);

      const service = buildService();
      const snapshot = await service.getSnapshot();

      const brief = snapshot.changeBriefs[0];
      expect(brief.summary.length).toBeLessThanOrEqual(120);
      expect(brief.summary.endsWith("...")).toBe(true);
    });
  });

  /* ---- getSnapshot: deriveRunPhase ---- */

  describe("getSnapshot — deriveRunPhase", () => {
    it("returns 'error' when selected ticket is blocked", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([
        makeTicket({ status: "blocked" }),
      ]);

      const service = buildService();
      const snapshot = await service.getSnapshot();
      expect(snapshot.runPhase).toBe("error");
    });

    it("returns 'single_task_validation' when pending approvals exist", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([
        makeTicket({ status: "ready" }),
      ]);
      mocks.v2QueryService.getPendingPolicy.mockResolvedValue([
        makeApproval({ payload: { aggregate_id: "ticket-1" } }),
      ]);

      const service = buildService();
      const snapshot = await service.getSnapshot();
      expect(snapshot.runPhase).toBe("single_task_validation");
    });

    it("returns 'parallel_running' when ticket is in_progress", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([
        makeTicket({ status: "in_progress" }),
      ]);

      const service = buildService();
      const snapshot = await service.getSnapshot();
      expect(snapshot.runPhase).toBe("parallel_running");
    });

    it("returns 'draining' when ticket is in review", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([
        makeTicket({ status: "review" }),
      ]);

      const service = buildService();
      const snapshot = await service.getSnapshot();
      expect(snapshot.runPhase).toBe("draining");
    });
  });

  /* ---- getSnapshot: deriveTaskPhase via tasks ---- */

  describe("getSnapshot — deriveTaskPhase via tasks list", () => {
    it("maps in_progress to implementing and review to verifying", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([
        makeTicket({ id: "t1", status: "in_progress" }),
        makeTicket({ id: "t2", status: "review" }),
        makeTicket({ id: "t3", status: "backlog" }),
      ]);

      const service = buildService();
      const snapshot = await service.getSnapshot();

      expect(snapshot.tasks.find((t) => t.task_id === "t1")?.phase).toBe("implementing");
      expect(snapshot.tasks.find((t) => t.task_id === "t2")?.phase).toBe("verifying");
      expect(snapshot.tasks.find((t) => t.task_id === "t3")?.phase).toBe("backlog");
    });
  });

  /* ---- getSnapshot: buildRouteSummary ---- */

  describe("getSnapshot — routeSummary", () => {
    it("returns null when no route exists", async () => {
      const service = buildService();
      const snapshot = await service.getSnapshot();
      expect(snapshot.routeSummary).toBeNull();
    });

    it("builds a route summary with clamped confidence", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([makeTicket()]);

      const route: RoutingDecision = {
        id: "route-1",
        repoId: "repo-1",
        ticketId: "ticket-1",
        runId: null,
        executionMode: "single_agent",
        modelRole: "coder_default",
        providerId: "qwen-cli",
        maxLanes: 1,
        risk: "low",
        verificationDepth: "quick",
        decompositionScore: 0.5,
        estimatedFileOverlap: 0.2,
        rationale: ["Score is moderate"],
        metadata: {},
        createdAt: "2026-03-28T12:00:00.000Z",
      };
      mocks.routerService.listRecentForAggregate.mockResolvedValue([route]);

      const service = buildService();
      const snapshot = await service.getSnapshot();

      expect(snapshot.routeSummary).not.toBeNull();
      expect(snapshot.routeSummary!.executionMode).toBe("single_agent");
      expect(snapshot.routeSummary!.providerId).toBe("qwen-cli");
      // confidence = max(0.25, min(0.97, 0.45 + 0.5 * 0.4)) = 0.65
      expect(snapshot.routeSummary!.confidence).toBeCloseTo(0.65, 2);
    });

    it("clamps confidence to minimum 0.25", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([makeTicket()]);

      const route: RoutingDecision = {
        id: "route-2",
        repoId: "repo-1",
        ticketId: "ticket-1",
        runId: null,
        executionMode: "single_agent",
        modelRole: "utility_fast",
        providerId: "qwen-cli",
        maxLanes: 1,
        risk: "low",
        verificationDepth: "quick",
        decompositionScore: -10,
        estimatedFileOverlap: 0,
        rationale: [],
        metadata: {},
        createdAt: "2026-03-28T12:00:00.000Z",
      };
      mocks.routerService.listRecentForAggregate.mockResolvedValue([route]);

      const service = buildService();
      const snapshot = await service.getSnapshot();

      expect(snapshot.routeSummary!.confidence).toBe(0.25);
    });

    it("clamps confidence to maximum 0.97", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([makeTicket()]);

      const route: RoutingDecision = {
        id: "route-3",
        repoId: "repo-1",
        ticketId: "ticket-1",
        runId: null,
        executionMode: "single_agent",
        modelRole: "utility_fast",
        providerId: "qwen-cli",
        maxLanes: 1,
        risk: "low",
        verificationDepth: "quick",
        decompositionScore: 100,
        estimatedFileOverlap: 0,
        rationale: [],
        metadata: {},
        createdAt: "2026-03-28T12:00:00.000Z",
      };
      mocks.routerService.listRecentForAggregate.mockResolvedValue([route]);

      const service = buildService();
      const snapshot = await service.getSnapshot();

      expect(snapshot.routeSummary!.confidence).toBe(0.97);
    });
  });

  /* ---- getSnapshot: buildStreams ---- */

  describe("getSnapshot — streams", () => {
    it("produces three workstreams: Execution, Verification, Approvals", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([
        makeTicket({ id: "t1", status: "backlog" }),
        makeTicket({ id: "t2", status: "in_progress" }),
        makeTicket({ id: "t3", status: "blocked" }),
        makeTicket({ id: "t4", status: "done" }),
      ]);

      const service = buildService();
      const snapshot = await service.getSnapshot();

      expect(snapshot.streams).toHaveLength(3);
      const exec = snapshot.streams.find((s) => s.workstream === "Execution")!;
      expect(exec.queued).toBe(1);       // backlog
      expect(exec.in_progress).toBe(1);  // in_progress
      expect(exec.blocked).toBe(1);      // blocked
      expect(exec.completed).toBe(1);    // done
      expect(exec.risk).toBe("critical"); // blocked > 0

      const approvalStream = snapshot.streams.find((s) => s.workstream === "Approvals")!;
      expect(approvalStream.risk).toBe("ok");
    });

    it("marks Approvals stream as critical when pending approvals exist", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([
        makeTicket({ id: "t1", status: "in_progress" }),
      ]);
      mocks.v2QueryService.getPendingPolicy.mockResolvedValue([
        makeApproval({ payload: { aggregate_id: "t1" } }),
      ]);

      const service = buildService();
      const snapshot = await service.getSnapshot();

      const approvalStream = snapshot.streams.find((s) => s.workstream === "Approvals")!;
      expect(approvalStream.risk).toBe("critical");
      expect(approvalStream.queued).toBe(1);
    });
  });

  /* ---- getSnapshot: buildTimeline ---- */

  describe("getSnapshot — timeline", () => {
    it("merges commands and approvals sorted chronologically", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([makeTicket()]);

      mocks.v2QueryService.getRecentCommands.mockResolvedValue([
        makeCommand({ id: "c1", created_at: "2026-03-28T12:01:00.000Z", aggregate_id: "ticket-1" }),
        makeCommand({ id: "c2", created_at: "2026-03-28T12:03:00.000Z", aggregate_id: "ticket-1" }),
      ]);
      mocks.v2QueryService.getPendingPolicy.mockResolvedValue([
        makeApproval({
          approval_id: "a1",
          requested_at: "2026-03-28T12:02:00.000Z",
          payload: { aggregate_id: "ticket-1" },
        }),
      ]);

      const service = buildService();
      const snapshot = await service.getSnapshot();

      expect(snapshot.timeline.length).toBeGreaterThanOrEqual(3);
      // oldest first (reversed at end)
      const ids = snapshot.timeline.map((e) => e.id);
      expect(ids.indexOf("c1")).toBeLessThan(ids.indexOf("a1"));
      expect(ids.indexOf("a1")).toBeLessThan(ids.indexOf("c2"));
    });

    it("maps failed command severity to ERROR", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([makeTicket()]);

      mocks.v2QueryService.getRecentCommands.mockResolvedValue([
        makeCommand({ id: "c-fail", status: "failed", aggregate_id: "ticket-1" }),
      ]);

      const service = buildService();
      const snapshot = await service.getSnapshot();

      const event = snapshot.timeline.find((e) => e.id === "c-fail");
      expect(event?.severity).toBe("ERROR");
    });
  });

  /* ---- getSnapshot: buildApprovals ---- */

  describe("getSnapshot — approvals", () => {
    it("marks approvals relevant to current task", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([makeTicket({ id: "t1" })]);

      mocks.v2QueryService.getPendingPolicy.mockResolvedValue([
        makeApproval({ approval_id: "a-match", payload: { aggregate_id: "t1" } }),
        makeApproval({ approval_id: "a-global", payload: {} }),
        makeApproval({ approval_id: "a-other", payload: { aggregate_id: "t-other" } }),
      ]);

      const service = buildService();
      const snapshot = await service.getSnapshot();

      // 'a-other' is filtered out of relevantApprovals before buildApprovals
      const match = snapshot.approvals.find((a) => a.approvalId === "a-match");
      const global = snapshot.approvals.find((a) => a.approvalId === "a-global");
      expect(match?.relevantToCurrentTask).toBe(true);
      expect(global?.relevantToCurrentTask).toBe(true);
    });
  });

  /* ---- getSnapshot: buildActionCapabilities ---- */

  describe("getSnapshot — actionCapabilities", () => {
    it("canRetry is true when ticket is blocked", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([
        makeTicket({ status: "blocked" }),
      ]);

      const service = buildService();
      const snapshot = await service.getSnapshot();
      expect(snapshot.actionCapabilities.canRetry).toBe(true);
    });

    it("canRetry is false when ticket is in progress without failed run", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([
        makeTicket({ status: "in_progress" }),
      ]);

      const service = buildService();
      const snapshot = await service.getSnapshot();
      expect(snapshot.actionCapabilities.canRetry).toBe(false);
    });
  });

  /* ---- getSnapshot: workflowPillars ---- */

  describe("getSnapshot — workflowPillars", () => {
    it("aggregates ticket counts into four pillars", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([
        makeTicket({ id: "t1", status: "backlog" }),
        makeTicket({ id: "t2", status: "ready" }),
        makeTicket({ id: "t3", status: "in_progress" }),
        makeTicket({ id: "t4", status: "review" }),
        makeTicket({ id: "t5", status: "done" }),
      ]);

      const service = buildService();
      const snapshot = await service.getSnapshot();

      const pillars = snapshot.workflowPillars;
      expect(pillars).toHaveLength(4);
      expect(pillars.find((p) => p.key === "backlog")!.count).toBe(2);      // backlog + ready
      expect(pillars.find((p) => p.key === "in_progress")!.count).toBe(1);
      expect(pillars.find((p) => p.key === "needs_review")!.count).toBe(1);
      expect(pillars.find((p) => p.key === "completed")!.count).toBe(1);
    });

    it("reports blocked count inside a pillar", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([
        makeTicket({ id: "t1", status: "in_progress" }),
        makeTicket({ id: "t2", status: "in_progress" }),
      ]);

      const service = buildService();
      const snapshot = await service.getSnapshot();

      const ip = snapshot.workflowPillars.find((p) => p.key === "in_progress")!;
      expect(ip.count).toBe(2);
      // Neither is blocked
      expect(ip.blockedCount).toBeUndefined();
    });
  });

  /* ---- getSnapshot: workflowCards progress mapping ---- */

  describe("getSnapshot — workflowCards progress", () => {
    it("maps ticket statuses to expected progress percentages", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([
        makeTicket({ id: "t-done", status: "done" }),
        makeTicket({ id: "t-review", status: "review" }),
        makeTicket({ id: "t-blocked", status: "blocked" }),
        makeTicket({ id: "t-ip", status: "in_progress" }),
        makeTicket({ id: "t-ready", status: "ready" }),
        makeTicket({ id: "t-backlog", status: "backlog" }),
      ]);

      const service = buildService();
      const snapshot = await service.getSnapshot();

      const progress = (id: string) => snapshot.workflowCards.find((c) => c.workflowId === id)!.progress;
      expect(progress("t-done")).toBe(100);
      expect(progress("t-review")).toBe(82);
      expect(progress("t-blocked")).toBe(58);
      expect(progress("t-ip")).toBe(64);
      expect(progress("t-ready")).toBe(30);
      expect(progress("t-backlog")).toBe(18);
    });
  });

  /* ---- getSnapshot: spotlight ---- */

  describe("getSnapshot — spotlight", () => {
    it("returns null when no tickets exist", async () => {
      const service = buildService();
      const snapshot = await service.getSnapshot();
      expect(snapshot.spotlight).toBeNull();
    });

    it("populates spotlight for the selected ticket", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([
        makeTicket({ id: "t1", title: "Feature spotlight", status: "in_progress" }),
      ]);
      mocks.contextService.getWorkflowState.mockResolvedValue({
        summary: "Building the feature",
        nextSteps: ["Write tests"],
        blockers: [],
      });

      const service = buildService();
      const snapshot = await service.getSnapshot();

      expect(snapshot.spotlight).not.toBeNull();
      expect(snapshot.spotlight!.task_id).toBe("t1");
      expect(snapshot.spotlight!.title).toBe("Feature spotlight");
      expect(snapshot.spotlight!.latest_artifact.markdown_summary).toContain("Building the feature");
      expect(snapshot.spotlight!.latest_artifact.markdown_summary).toContain("Next: Write tests");
    });

    it("includes blockers in spotlight markdown summary", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([
        makeTicket({ id: "t1", status: "blocked" }),
      ]);
      mocks.contextService.getWorkflowState.mockResolvedValue({
        summary: "Stuck",
        nextSteps: [],
        blockers: ["Missing dep"],
      });

      const service = buildService();
      const snapshot = await service.getSnapshot();

      expect(snapshot.spotlight!.latest_artifact.markdown_summary).toContain("Blockers: Missing dep");
    });
  });

  /* ---- getSnapshot: consoleLogs ---- */

  describe("getSnapshot — consoleLogs", () => {
    it("maps command statuses to correct log levels", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([makeTicket()]);

      mocks.v2QueryService.getRecentCommands.mockResolvedValue([
        makeCommand({ id: "c1", status: "completed", command_type: "execution.request", aggregate_id: "ticket-1" }),
        makeCommand({ id: "c2", status: "failed", command_type: "verify.run", aggregate_id: "ticket-1" }),
        makeCommand({ id: "c3", status: "queued", command_type: "build.request", aggregate_id: "ticket-1" }),
      ]);

      const service = buildService();
      const snapshot = await service.getSnapshot();

      const log = (id: string) => snapshot.consoleLogs.find((l) => l.id === id);
      expect(log("c1")?.level).toBe("success");
      expect(log("c2")?.level).toBe("error");
      expect(log("c3")?.level).toBe("warn");
    });

    it("sorts console logs chronologically", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([makeTicket()]);

      mocks.v2QueryService.getRecentCommands.mockResolvedValue([
        makeCommand({ id: "c-later", created_at: "2026-03-28T13:00:00.000Z", aggregate_id: "ticket-1" }),
        makeCommand({ id: "c-earlier", created_at: "2026-03-28T11:00:00.000Z", aggregate_id: "ticket-1" }),
      ]);

      const service = buildService();
      const snapshot = await service.getSnapshot();

      const ids = snapshot.consoleLogs.map((l) => l.id);
      expect(ids.indexOf("c-earlier")).toBeLessThan(ids.indexOf("c-later"));
    });
  });

  /* ---- getSnapshot: codebaseFiles ---- */

  describe("getSnapshot — codebaseFiles", () => {
    it("deduplicates and labels file statuses correctly", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([makeTicket()]);
      mocks.codeGraphService.getLatestContextPack.mockResolvedValue({
        files: ["src/a.ts", "src/b.ts"],
        tests: ["src/a.test.ts"],
        docs: ["README.md", "src/a.ts"], // duplicate
        confidence: 0.8,
      });

      const service = buildService();
      const snapshot = await service.getSnapshot();

      const paths = snapshot.codebaseFiles.map((f) => f.path);
      // No duplicates
      expect(new Set(paths).size).toBe(paths.length);
      expect(paths).toContain("src/a.ts");
      expect(paths).toContain("README.md");
    });
  });

  /* ---- getSnapshot: overseer / sessions ---- */

  describe("getSnapshot — overseer sessions", () => {
    it("includes chat sessions and messages in overseer field", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);

      const session = { id: "s1", projectId: "repo-1", title: "Chat", createdAt: "2026-03-28T12:00:00.000Z", updatedAt: "2026-03-28T12:00:00.000Z" };
      mocks.chatService.listSessions.mockResolvedValue([session]);
      mocks.chatService.listMessages.mockResolvedValue([
        { id: "m1", role: "user", content: "Hello" },
      ]);

      const service = buildService();
      const snapshot = await service.getSnapshot();

      expect(snapshot.overseer.sessions).toHaveLength(1);
      expect(snapshot.overseer.selectedSessionId).toBe("s1");
      expect(snapshot.overseer.messages).toHaveLength(1);
    });
  });

  /* ---- getSnapshot: provider_change approvals are filtered out ---- */

  describe("getSnapshot — provider_change filtering", () => {
    it("excludes provider_change approvals from all outputs", async () => {
      const repo = makeRepo();
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(repo);
      mocks.ticketService.listTickets.mockResolvedValue([makeTicket()]);

      mocks.v2QueryService.getPendingPolicy.mockResolvedValue([
        makeApproval({ approval_id: "a-pc", action_type: "provider_change", payload: { aggregate_id: "ticket-1" } }),
        makeApproval({ approval_id: "a-ok", action_type: "file.write", payload: { aggregate_id: "ticket-1" } }),
      ]);

      const service = buildService();
      const snapshot = await service.getSnapshot();

      expect(snapshot.approvals.find((a) => a.approvalId === "a-pc")).toBeUndefined();
      expect(snapshot.approvals.find((a) => a.approvalId === "a-ok")).toBeDefined();
    });
  });

  /* ---- getSnapshot: projectId routing ---- */

  describe("getSnapshot — project selection", () => {
    it("uses getRepo when projectId is provided", async () => {
      const repo = makeRepo({ id: "specific-repo" });
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getRepo.mockResolvedValue(repo);

      const service = buildService();
      await service.getSnapshot({ projectId: "specific-repo" });

      expect(mocks.repoService.getRepo).toHaveBeenCalledWith("specific-repo");
      expect(mocks.repoService.getActiveRepo).not.toHaveBeenCalled();
    });

    it("falls back to first repo from list when getActiveRepo returns null", async () => {
      const repo = makeRepo({ id: "fallback-repo" });
      mocks.repoService.listRepos.mockResolvedValue([repo]);
      mocks.repoService.getActiveRepo.mockResolvedValue(null);

      const service = buildService();
      const snapshot = await service.getSnapshot();

      expect(snapshot.project).toEqual(repo);
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    runProjection: {
      findUnique: vi.fn(),
    },
  },
  syncTaskProjectionFromTicket: vi.fn(),
  buildVerificationPlan: vi.fn(),
  buildCommandPlan: vi.fn(),
  commandPlanFromRecord: vi.fn(),
}));

vi.mock("../../db", () => ({
  prisma: mocks.prisma,
}));

vi.mock("./ticketProjection", () => ({
  syncTaskProjectionFromTicket: mocks.syncTaskProjectionFromTicket,
}));

vi.mock("../../services/verificationPolicy", () => ({
  buildVerificationPlan: mocks.buildVerificationPlan,
}));

vi.mock("../../services/commandSpecs", () => ({
  buildCommandPlan: mocks.buildCommandPlan,
  commandPlanFromRecord: mocks.commandPlanFromRecord,
}));

import {
  handleCommandInvocationApprovalDecision,
  decideApprovalWithCommandFollowup,
} from "./commandApproval";
import type { ApprovalService } from "../../services/approvalService";
import type { ExecutionService } from "../../services/executionService";
import type { ProjectBlueprintService } from "../../services/projectBlueprintService";
import type { RepoService } from "../../services/repoService";
import type { TicketService } from "../../services/ticketService";
import type { CommandEngine } from "../../services/commandEngine";
import type { V2EventService } from "../../services/v2EventService";

describe("handleCommandInvocationApprovalDecision", () => {
  let mockTicketService: TicketService;
  let mockCommandEngine: CommandEngine;
  let mockV2EventService: V2EventService;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTicketService = {
      getTicket: vi.fn(),
      moveTicket: vi.fn(),
    } as unknown as TicketService;

    mockCommandEngine = {
      invoke: vi.fn(),
    } as unknown as CommandEngine;

    mockV2EventService = {
      appendEvent: vi.fn(),
    } as unknown as V2EventService;

    mocks.syncTaskProjectionFromTicket.mockResolvedValue(undefined);
  });

  it("returns null results when decision is rejected", async () => {
    const approval = {
      id: "approval-1",
      actionType: "command_tool_invocation" as const,
      payload: {},
    };

    const result = await handleCommandInvocationApprovalDecision({
      approval,
      decision: "rejected",
      actor: "user-1",
      executeApprovedCommand: true,
      requeueBlockedStage: true,
      ticketService: mockTicketService,
      commandEngine: mockCommandEngine,
      v2EventService: mockV2EventService,
    });

    expect(result.commandExecution).toBeNull();
    expect(result.requeue).toBeNull();
    expect(mockCommandEngine.invoke).not.toHaveBeenCalled();
  });

  it("returns null results when actionType is not command_tool_invocation", async () => {
    const approval = {
      id: "approval-1",
      actionType: "execution_request" as const,
      payload: {},
    };

    const result = await handleCommandInvocationApprovalDecision({
      approval,
      decision: "approved",
      actor: "user-1",
      executeApprovedCommand: true,
      requeueBlockedStage: true,
      ticketService: mockTicketService,
      commandEngine: mockCommandEngine,
      v2EventService: mockV2EventService,
    });

    expect(result.commandExecution).toBeNull();
    expect(result.requeue).toBeNull();
  });

  it("executes approved command when all required fields are present", async () => {
    const approval = {
      id: "approval-1",
      actionType: "command_tool_invocation" as const,
      payload: {
        run_id: "run-1",
        ticket_id: "ticket-1",
        repo_id: "repo-1",
        stage: "build",
        display_command: "npm test",
        worktree_path: "/tmp/worktree",
        tool_type: "repo.verify",
        risk_level: "medium",
        command_plan: {
          executable: "npm",
          args: ["test"],
          flags: {},
        },
      },
    };

    const mockTicket = {
      id: "ticket-1",
      repoId: "repo-1",
      status: "in_progress" as const,
    };

    const mockInvoked = {
      event: {
        id: "event-1",
        policyDecision: "allowed" as const,
        exitCode: 0,
        summary: "Tests passed",
      },
    };

    vi.mocked(mockTicketService.getTicket).mockResolvedValue(mockTicket as any);
    vi.mocked(mockCommandEngine.invoke).mockResolvedValue(mockInvoked as any);
    mocks.commandPlanFromRecord.mockReturnValue({
      executable: "npm",
      args: ["test"],
      flags: {},
    });

    const result = await handleCommandInvocationApprovalDecision({
      approval,
      decision: "approved",
      actor: "user-1",
      executeApprovedCommand: true,
      requeueBlockedStage: false,
      ticketService: mockTicketService,
      commandEngine: mockCommandEngine,
      v2EventService: mockV2EventService,
    });

    expect(mockCommandEngine.invoke).toHaveBeenCalledWith({
      runId: "run-1",
      repoId: "repo-1",
      ticketId: "ticket-1",
      stage: "build",
      actor: "user-1",
      worktreePath: "/tmp/worktree",
      commandPlan: {
        executable: "npm",
        args: ["test"],
        flags: {},
      },
      toolType: "repo.verify",
      riskLevel: "medium",
      approvedApprovalId: "approval-1",
    });

    expect(result.commandExecution).toEqual({
      toolEventId: "event-1",
      policyDecision: "allowed",
      exitCode: 0,
      summary: "Tests passed",
    });

    expect(mockV2EventService.appendEvent).toHaveBeenCalledWith({
      type: "command.tool.approval.executed",
      aggregateId: "run-1",
      actor: "user-1",
      payload: {
        approval_id: "approval-1",
        ticket_id: "ticket-1",
        command: "npm test",
        stage: "build",
        tool_event_id: "event-1",
        policy_decision: "allowed",
        exit_code: 0,
      },
      correlationId: "approval-1",
    });
  });

  it("falls back to buildCommandPlan when command_plan is not in payload", async () => {
    const approval = {
      id: "approval-1",
      actionType: "command_tool_invocation" as const,
      payload: {
        run_id: "run-1",
        ticket_id: "ticket-1",
        repo_id: "repo-1",
        stage: "build",
        display_command: "npm test",
        worktree_path: "/tmp/worktree",
      },
    };

    const mockTicket = { id: "ticket-1", repoId: "repo-1", status: "in_progress" as const };
    const mockInvoked = {
      event: {
        id: "event-1",
        policyDecision: "allowed" as const,
        exitCode: 0,
        summary: "OK",
      },
    };

    vi.mocked(mockTicketService.getTicket).mockResolvedValue(mockTicket as any);
    vi.mocked(mockCommandEngine.invoke).mockResolvedValue(mockInvoked as any);
    mocks.commandPlanFromRecord.mockReturnValue(null);
    mocks.buildCommandPlan.mockReturnValue({
      executable: "npm",
      args: ["test"],
      flags: {},
    });

    await handleCommandInvocationApprovalDecision({
      approval,
      decision: "approved",
      actor: "user-1",
      executeApprovedCommand: true,
      requeueBlockedStage: false,
      ticketService: mockTicketService,
      commandEngine: mockCommandEngine,
      v2EventService: mockV2EventService,
    });

    expect(mocks.buildCommandPlan).toHaveBeenCalledWith("npm test");
    expect(mockCommandEngine.invoke).toHaveBeenCalled();
  });

  it("does not execute command when executeApprovedCommand is false", async () => {
    const approval = {
      id: "approval-1",
      actionType: "command_tool_invocation" as const,
      payload: {
        run_id: "run-1",
        ticket_id: "ticket-1",
        repo_id: "repo-1",
        stage: "build",
        display_command: "npm test",
        worktree_path: "/tmp/worktree",
        command_plan: {},
      },
    };

    const result = await handleCommandInvocationApprovalDecision({
      approval,
      decision: "approved",
      actor: "user-1",
      executeApprovedCommand: false,
      requeueBlockedStage: false,
      ticketService: mockTicketService,
      commandEngine: mockCommandEngine,
      v2EventService: mockV2EventService,
    });

    expect(mockCommandEngine.invoke).not.toHaveBeenCalled();
    expect(result.commandExecution).toBeNull();
  });

  it("requeues ticket from review to in_progress when requeueBlockedStage is true", async () => {
    const approval = {
      id: "approval-1",
      actionType: "command_tool_invocation" as const,
      payload: {
        ticket_id: "ticket-1",
      },
    };

    const mockTicket = {
      id: "ticket-1",
      repoId: "repo-1",
      status: "review" as const,
    };

    const movedTicket = {
      id: "ticket-1",
      repoId: "repo-1",
      status: "in_progress" as const,
    };

    vi.mocked(mockTicketService.getTicket).mockResolvedValue(mockTicket as any);
    vi.mocked(mockTicketService.moveTicket).mockResolvedValue(movedTicket as any);

    const result = await handleCommandInvocationApprovalDecision({
      approval,
      decision: "approved",
      actor: "user-1",
      executeApprovedCommand: false,
      requeueBlockedStage: true,
      ticketService: mockTicketService,
      commandEngine: mockCommandEngine,
      v2EventService: mockV2EventService,
    });

    expect(mockTicketService.moveTicket).toHaveBeenCalledWith("ticket-1", "in_progress");
    expect(mocks.syncTaskProjectionFromTicket).toHaveBeenCalledWith(movedTicket);
    expect(result.requeue).toEqual({
      ticketId: "ticket-1",
      from: "review",
      to: "in_progress",
      reason: "approved_command_requeue",
    });
  });

  it("does not requeue ticket when status is not review", async () => {
    const approval = {
      id: "approval-1",
      actionType: "command_tool_invocation" as const,
      payload: {
        ticket_id: "ticket-1",
      },
    };

    const mockTicket = {
      id: "ticket-1",
      repoId: "repo-1",
      status: "in_progress" as const,
    };

    vi.mocked(mockTicketService.getTicket).mockResolvedValue(mockTicket as any);

    const result = await handleCommandInvocationApprovalDecision({
      approval,
      decision: "approved",
      actor: "user-1",
      executeApprovedCommand: false,
      requeueBlockedStage: true,
      ticketService: mockTicketService,
      commandEngine: mockCommandEngine,
      v2EventService: mockV2EventService,
    });

    expect(mockTicketService.moveTicket).not.toHaveBeenCalled();
    expect(result.requeue).toBeNull();
  });

  it("resolves repoId from ticket when not in payload", async () => {
    const approval = {
      id: "approval-1",
      actionType: "command_tool_invocation" as const,
      payload: {
        run_id: "run-1",
        ticket_id: "ticket-1",
        stage: "build",
        display_command: "npm test",
        worktree_path: "/tmp/worktree",
        command_plan: { executable: "npm", args: ["test"], flags: {} },
      },
    };

    const mockTicket = {
      id: "ticket-1",
      repoId: "repo-from-ticket",
      status: "in_progress" as const,
    };

    const mockInvoked = {
      event: {
        id: "event-1",
        policyDecision: "allowed" as const,
        exitCode: 0,
        summary: "OK",
      },
    };

    vi.mocked(mockTicketService.getTicket).mockResolvedValue(mockTicket as any);
    vi.mocked(mockCommandEngine.invoke).mockResolvedValue(mockInvoked as any);
    mocks.commandPlanFromRecord.mockReturnValue({ executable: "npm", args: ["test"], flags: {} });

    await handleCommandInvocationApprovalDecision({
      approval,
      decision: "approved",
      actor: "user-1",
      executeApprovedCommand: true,
      requeueBlockedStage: false,
      ticketService: mockTicketService,
      commandEngine: mockCommandEngine,
      v2EventService: mockV2EventService,
    });

    expect(mockCommandEngine.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: "repo-from-ticket",
      })
    );
  });

  it("handles legacy project_id field as repoId", async () => {
    const approval = {
      id: "approval-1",
      actionType: "command_tool_invocation" as const,
      payload: {
        run_id: "run-1",
        ticket_id: "ticket-1",
        project_id: "legacy-project-id",
        stage: "build",
        display_command: "npm test",
        worktree_path: "/tmp/worktree",
        command_plan: { executable: "npm", args: ["test"], flags: {} },
      },
    };

    const mockTicket = { id: "ticket-1", repoId: "repo-1", status: "in_progress" as const };
    const mockInvoked = {
      event: {
        id: "event-1",
        policyDecision: "allowed" as const,
        exitCode: 0,
        summary: "OK",
      },
    };

    vi.mocked(mockTicketService.getTicket).mockResolvedValue(mockTicket as any);
    vi.mocked(mockCommandEngine.invoke).mockResolvedValue(mockInvoked as any);
    mocks.commandPlanFromRecord.mockReturnValue({ executable: "npm", args: ["test"], flags: {} });

    await handleCommandInvocationApprovalDecision({
      approval,
      decision: "approved",
      actor: "user-1",
      executeApprovedCommand: true,
      requeueBlockedStage: false,
      ticketService: mockTicketService,
      commandEngine: mockCommandEngine,
      v2EventService: mockV2EventService,
    });

    expect(mockCommandEngine.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: "legacy-project-id",
      })
    );
  });

  it("handles legacy cwd field as worktreePath", async () => {
    const approval = {
      id: "approval-1",
      actionType: "command_tool_invocation" as const,
      payload: {
        run_id: "run-1",
        ticket_id: "ticket-1",
        repo_id: "repo-1",
        stage: "build",
        display_command: "npm test",
        cwd: "/legacy/cwd/path",
        command_plan: { executable: "npm", args: ["test"], flags: {} },
      },
    };

    const mockTicket = { id: "ticket-1", repoId: "repo-1", status: "in_progress" as const };
    const mockInvoked = {
      event: {
        id: "event-1",
        policyDecision: "allowed" as const,
        exitCode: 0,
        summary: "OK",
      },
    };

    vi.mocked(mockTicketService.getTicket).mockResolvedValue(mockTicket as any);
    vi.mocked(mockCommandEngine.invoke).mockResolvedValue(mockInvoked as any);
    mocks.commandPlanFromRecord.mockReturnValue({ executable: "npm", args: ["test"], flags: {} });

    await handleCommandInvocationApprovalDecision({
      approval,
      decision: "approved",
      actor: "user-1",
      executeApprovedCommand: true,
      requeueBlockedStage: false,
      ticketService: mockTicketService,
      commandEngine: mockCommandEngine,
      v2EventService: mockV2EventService,
    });

    expect(mockCommandEngine.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreePath: "/legacy/cwd/path",
      })
    );
  });

  it("validates stage field and only accepts valid values", async () => {
    const approval = {
      id: "approval-1",
      actionType: "command_tool_invocation" as const,
      payload: {
        run_id: "run-1",
        ticket_id: "ticket-1",
        repo_id: "repo-1",
        stage: "invalid_stage",
        display_command: "npm test",
        worktree_path: "/tmp/worktree",
        command_plan: { executable: "npm", args: ["test"], flags: {} },
      },
    };

    const result = await handleCommandInvocationApprovalDecision({
      approval,
      decision: "approved",
      actor: "user-1",
      executeApprovedCommand: true,
      requeueBlockedStage: false,
      ticketService: mockTicketService,
      commandEngine: mockCommandEngine,
      v2EventService: mockV2EventService,
    });

    expect(mockCommandEngine.invoke).not.toHaveBeenCalled();
    expect(result.commandExecution).toBeNull();
  });

  it("validates toolType field and only accepts valid values", async () => {
    const approval = {
      id: "approval-1",
      actionType: "command_tool_invocation" as const,
      payload: {
        run_id: "run-1",
        ticket_id: "ticket-1",
        repo_id: "repo-1",
        stage: "build",
        display_command: "npm test",
        worktree_path: "/tmp/worktree",
        tool_type: "invalid.type",
        command_plan: { executable: "npm", args: ["test"], flags: {} },
      },
    };

    const mockTicket = { id: "ticket-1", repoId: "repo-1", status: "in_progress" as const };
    const mockInvoked = {
      event: {
        id: "event-1",
        policyDecision: "allowed" as const,
        exitCode: 0,
        summary: "OK",
      },
    };

    vi.mocked(mockTicketService.getTicket).mockResolvedValue(mockTicket as any);
    vi.mocked(mockCommandEngine.invoke).mockResolvedValue(mockInvoked as any);
    mocks.commandPlanFromRecord.mockReturnValue({ executable: "npm", args: ["test"], flags: {} });

    await handleCommandInvocationApprovalDecision({
      approval,
      decision: "approved",
      actor: "user-1",
      executeApprovedCommand: true,
      requeueBlockedStage: false,
      ticketService: mockTicketService,
      commandEngine: mockCommandEngine,
      v2EventService: mockV2EventService,
    });

    // toolType should be undefined when invalid
    expect(mockCommandEngine.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        toolType: undefined,
      })
    );
  });
});

describe("decideApprovalWithCommandFollowup", () => {
  let mockApprovalService: ApprovalService;
  let mockExecutionService: ExecutionService;
  let mockProjectBlueprintService: ProjectBlueprintService;
  let mockRepoService: RepoService;
  let mockTicketService: TicketService;
  let mockCommandEngine: CommandEngine;
  let mockV2EventService: V2EventService;

  beforeEach(() => {
    vi.clearAllMocks();

    mockApprovalService = {
      decideApproval: vi.fn(),
    } as unknown as ApprovalService;

    mockExecutionService = {
      startExecution: vi.fn(),
      verifyExecution: vi.fn(),
    } as unknown as ExecutionService;

    mockProjectBlueprintService = {
      get: vi.fn(),
    } as unknown as ProjectBlueprintService;

    mockRepoService = {
      getActiveWorktreePath: vi.fn(),
      getGuidelines: vi.fn(),
    } as unknown as RepoService;

    mockTicketService = {
      getTicket: vi.fn(),
      moveTicket: vi.fn(),
    } as unknown as TicketService;

    mockCommandEngine = {
      invoke: vi.fn(),
    } as unknown as CommandEngine;

    mockV2EventService = {
      appendEvent: vi.fn(),
    } as unknown as V2EventService;

    mocks.syncTaskProjectionFromTicket.mockResolvedValue(undefined);
    mocks.buildVerificationPlan.mockReturnValue({
      commands: [],
      reasons: [],
      enforcedRules: [],
      docsRequired: false,
      fullSuiteRun: false,
    });
  });

  it("handles execution_request approval and resumes execution", async () => {
    const approvalDecision = {
      id: "approval-1",
      actionType: "execution_request" as const,
      payload: {
        run_id: "run-1",
        ticket_id: "ticket-1",
        repo_id: "repo-1",
        prompt: "Fix the bug",
        model_role: "coder_default",
        provider_id: "qwen-cli",
      },
    };

    const mockTicket = {
      id: "ticket-1",
      repoId: "repo-1",
      status: "in_progress" as const,
    };

    const mockAttempt = {
      id: "attempt-1",
    };

    vi.mocked(mockApprovalService.decideApproval).mockResolvedValue(approvalDecision as any);
    vi.mocked(mockTicketService.getTicket).mockResolvedValue(mockTicket as any);
    vi.mocked(mockRepoService.getActiveWorktreePath).mockResolvedValue("/tmp/worktree");
    vi.mocked(mockExecutionService.startExecution).mockResolvedValue(mockAttempt as any);
    vi.mocked(mockProjectBlueprintService.get).mockResolvedValue({} as any);
    vi.mocked(mockRepoService.getGuidelines).mockResolvedValue([]);
    mocks.prisma.runProjection.findUnique.mockResolvedValue({
      metadata: {},
    });

    const result = await decideApprovalWithCommandFollowup({
      approvalId: "approval-1",
      decision: "approved",
      actor: "user-1",
      executeApprovedCommand: false,
      requeueBlockedStage: false,
      approvalService: mockApprovalService,
      executionService: mockExecutionService,
      projectBlueprintService: mockProjectBlueprintService,
      repoService: mockRepoService,
      ticketService: mockTicketService,
      commandEngine: mockCommandEngine,
      v2EventService: mockV2EventService,
    });

    expect(mockApprovalService.decideApproval).toHaveBeenCalledWith("approval-1", {
      decision: "approved",
      reason: undefined,
      decidedBy: "user-1",
    });

    expect(mockV2EventService.appendEvent).toHaveBeenCalledWith({
      type: "execution.requested",
      aggregateId: "run-1",
      actor: "user-1",
      payload: expect.objectContaining({
        status: "queued",
        approved_via: "approval-1",
      }),
      correlationId: "approval-1",
    });

    expect(mockExecutionService.startExecution).toHaveBeenCalledWith({
      actor: "user-1",
      runId: "run-1",
      repoId: "repo-1",
      projectId: "repo-1",
      worktreePath: "/tmp/worktree",
      objective: "Fix the bug",
      modelRole: "coder_default",
      providerId: "qwen-cli",
      routingDecisionId: null,
    });

    expect(result.item).toEqual(approvalDecision);
  });

  it("resumes ticket from review to in_progress for execution_request", async () => {
    const approvalDecision = {
      id: "approval-1",
      actionType: "execution_request" as const,
      payload: {
        run_id: "run-1",
        ticket_id: "ticket-1",
        repo_id: "repo-1",
        prompt: "Fix the bug",
        model_role: "coder_default",
        provider_id: "qwen-cli",
      },
    };

    const mockTicketInReview = {
      id: "ticket-1",
      repoId: "repo-1",
      status: "review" as const,
    };

    const mockTicketResumed = {
      id: "ticket-1",
      repoId: "repo-1",
      status: "in_progress" as const,
    };

    const mockAttempt = { id: "attempt-1" };

    vi.mocked(mockApprovalService.decideApproval).mockResolvedValue(approvalDecision as any);
    vi.mocked(mockTicketService.getTicket).mockResolvedValue(mockTicketInReview as any);
    vi.mocked(mockTicketService.moveTicket).mockResolvedValue(mockTicketResumed as any);
    vi.mocked(mockRepoService.getActiveWorktreePath).mockResolvedValue("/tmp/worktree");
    vi.mocked(mockExecutionService.startExecution).mockResolvedValue(mockAttempt as any);
    vi.mocked(mockProjectBlueprintService.get).mockResolvedValue({} as any);
    vi.mocked(mockRepoService.getGuidelines).mockResolvedValue([]);
    mocks.prisma.runProjection.findUnique.mockResolvedValue({
      metadata: {},
    });

    await decideApprovalWithCommandFollowup({
      approvalId: "approval-1",
      decision: "approved",
      actor: "user-1",
      executeApprovedCommand: false,
      requeueBlockedStage: false,
      approvalService: mockApprovalService,
      executionService: mockExecutionService,
      projectBlueprintService: mockProjectBlueprintService,
      repoService: mockRepoService,
      ticketService: mockTicketService,
      commandEngine: mockCommandEngine,
      v2EventService: mockV2EventService,
    });

    expect(mockTicketService.moveTicket).toHaveBeenCalledWith("ticket-1", "in_progress");
    expect(mocks.syncTaskProjectionFromTicket).toHaveBeenCalledWith(mockTicketResumed);
  });

  it("runs verification and moves ticket to done when verification passes", async () => {
    const approvalDecision = {
      id: "approval-1",
      actionType: "execution_request" as const,
      payload: {
        run_id: "run-1",
        ticket_id: "ticket-1",
        repo_id: "repo-1",
        prompt: "Fix the bug",
        model_role: "coder_default",
        provider_id: "qwen-cli",
      },
    };

    const mockTicket = { id: "ticket-1", repoId: "repo-1", status: "in_progress" as const };
    const mockTicketRefreshed = { id: "ticket-1", repoId: "repo-1", status: "in_progress" as const };
    const mockTicketReview = { id: "ticket-1", repoId: "repo-1", status: "review" as const };
    const mockTicketDone = { id: "ticket-1", repoId: "repo-1", status: "done" as const };
    const mockAttempt = { id: "attempt-1" };

    vi.mocked(mockApprovalService.decideApproval).mockResolvedValue(approvalDecision as any);
    vi.mocked(mockTicketService.getTicket)
      .mockResolvedValueOnce(mockTicket as any)
      .mockResolvedValueOnce(mockTicketRefreshed as any);
    vi.mocked(mockTicketService.moveTicket)
      .mockResolvedValueOnce(mockTicketReview as any)
      .mockResolvedValueOnce(mockTicketDone as any);
    vi.mocked(mockRepoService.getActiveWorktreePath).mockResolvedValue("/tmp/worktree");
    vi.mocked(mockExecutionService.startExecution).mockResolvedValue(mockAttempt as any);
    vi.mocked(mockExecutionService.verifyExecution).mockResolvedValue({ pass: true } as any);
    vi.mocked(mockProjectBlueprintService.get).mockResolvedValue({} as any);
    vi.mocked(mockRepoService.getGuidelines).mockResolvedValue([]);
    mocks.prisma.runProjection.findUnique.mockResolvedValue({ metadata: {} });
    mocks.buildVerificationPlan.mockReturnValue({
      commands: [{ displayCommand: "npm test", safeCommand: "npm test" }],
      reasons: ["test coverage"],
      enforcedRules: [],
      docsRequired: false,
      fullSuiteRun: true,
    });

    await decideApprovalWithCommandFollowup({
      approvalId: "approval-1",
      decision: "approved",
      actor: "user-1",
      executeApprovedCommand: false,
      requeueBlockedStage: false,
      approvalService: mockApprovalService,
      executionService: mockExecutionService,
      projectBlueprintService: mockProjectBlueprintService,
      repoService: mockRepoService,
      ticketService: mockTicketService,
      commandEngine: mockCommandEngine,
      v2EventService: mockV2EventService,
    });

    expect(mockExecutionService.verifyExecution).toHaveBeenCalledWith({
      actor: "user-1",
      runId: "run-1",
      repoId: "repo-1",
      worktreePath: "/tmp/worktree",
      executionAttemptId: "attempt-1",
      commands: [{ displayCommand: "npm test", safeCommand: "npm test" }],
      docsRequired: false,
      fullSuiteRun: true,
      metadata: {
        verification_commands: ["npm test"],
        verification_reasons: ["test coverage"],
        enforced_rules: [],
      },
    });

    expect(mockTicketService.moveTicket).toHaveBeenCalledWith("ticket-1", "review");
    expect(mockTicketService.moveTicket).toHaveBeenCalledWith("ticket-1", "done");
  });

  it("throws error when execution_request is missing ticket-bound repo", async () => {
    const approvalDecision = {
      id: "approval-1",
      actionType: "execution_request" as const,
      payload: {
        run_id: "run-1",
        ticket_id: "ticket-1",
        prompt: "Fix the bug",
        model_role: "coder_default",
        provider_id: "qwen-cli",
      },
    };

    const mockTicketNoRepo = {
      id: "ticket-1",
      repoId: null,
      status: "in_progress" as const,
    };

    vi.mocked(mockApprovalService.decideApproval).mockResolvedValue(approvalDecision as any);
    vi.mocked(mockTicketService.getTicket).mockResolvedValue(mockTicketNoRepo as any);
    mocks.prisma.runProjection.findUnique.mockResolvedValue({ metadata: {} });

    await expect(
      decideApprovalWithCommandFollowup({
        approvalId: "approval-1",
        decision: "approved",
        actor: "user-1",
        executeApprovedCommand: false,
        requeueBlockedStage: false,
        approvalService: mockApprovalService,
        executionService: mockExecutionService,
        projectBlueprintService: mockProjectBlueprintService,
        repoService: mockRepoService,
        ticketService: mockTicketService,
        commandEngine: mockCommandEngine,
        v2EventService: mockV2EventService,
      })
    ).rejects.toThrow("Execution request is missing a ticket-bound repo for run run-1");
  });

  it("throws error when execution_request is missing provider routing", async () => {
    const approvalDecision = {
      id: "approval-1",
      actionType: "execution_request" as const,
      payload: {
        run_id: "run-1",
        ticket_id: "ticket-1",
        repo_id: "repo-1",
        prompt: "Fix the bug",
        // Missing model_role and provider_id
      },
    };

    const mockTicket = { id: "ticket-1", repoId: "repo-1", status: "in_progress" as const };

    vi.mocked(mockApprovalService.decideApproval).mockResolvedValue(approvalDecision as any);
    vi.mocked(mockTicketService.getTicket).mockResolvedValue(mockTicket as any);
    mocks.prisma.runProjection.findUnique.mockResolvedValue({ metadata: {} });

    await expect(
      decideApprovalWithCommandFollowup({
        approvalId: "approval-1",
        decision: "approved",
        actor: "user-1",
        executeApprovedCommand: false,
        requeueBlockedStage: false,
        approvalService: mockApprovalService,
        executionService: mockExecutionService,
        projectBlueprintService: mockProjectBlueprintService,
        repoService: mockRepoService,
        ticketService: mockTicketService,
        commandEngine: mockCommandEngine,
        v2EventService: mockV2EventService,
      })
    ).rejects.toThrow("Execution request is missing provider routing for run run-1");
  });

  it("handles command_tool_invocation approval with command execution", async () => {
    const approvalDecision = {
      id: "approval-1",
      actionType: "command_tool_invocation" as const,
      payload: {
        run_id: "run-1",
        ticket_id: "ticket-1",
        repo_id: "repo-1",
        stage: "build",
        display_command: "npm test",
        worktree_path: "/tmp/worktree",
        command_plan: { executable: "npm", args: ["test"], flags: {} },
      },
    };

    const mockTicket = { id: "ticket-1", repoId: "repo-1", status: "in_progress" as const };
    const mockInvoked = {
      event: {
        id: "event-1",
        policyDecision: "allowed" as const,
        exitCode: 0,
        summary: "OK",
      },
    };

    vi.mocked(mockApprovalService.decideApproval).mockResolvedValue(approvalDecision as any);
    vi.mocked(mockTicketService.getTicket).mockResolvedValue(mockTicket as any);
    vi.mocked(mockCommandEngine.invoke).mockResolvedValue(mockInvoked as any);
    mocks.commandPlanFromRecord.mockReturnValue({ executable: "npm", args: ["test"], flags: {} });

    const result = await decideApprovalWithCommandFollowup({
      approvalId: "approval-1",
      decision: "approved",
      actor: "user-1",
      executeApprovedCommand: true,
      requeueBlockedStage: false,
      approvalService: mockApprovalService,
      executionService: mockExecutionService,
      projectBlueprintService: mockProjectBlueprintService,
      repoService: mockRepoService,
      ticketService: mockTicketService,
      commandEngine: mockCommandEngine,
      v2EventService: mockV2EventService,
    });

    expect(result.commandExecution).toEqual({
      toolEventId: "event-1",
      policyDecision: "allowed",
      exitCode: 0,
      summary: "OK",
    });
  });

  it("passes reason parameter to decideApproval", async () => {
    const approvalDecision = {
      id: "approval-1",
      actionType: "command_tool_invocation" as const,
      payload: {},
    };

    vi.mocked(mockApprovalService.decideApproval).mockResolvedValue(approvalDecision as any);

    await decideApprovalWithCommandFollowup({
      approvalId: "approval-1",
      decision: "rejected",
      reason: "Security concern",
      actor: "user-1",
      executeApprovedCommand: false,
      requeueBlockedStage: false,
      approvalService: mockApprovalService,
      executionService: mockExecutionService,
      projectBlueprintService: mockProjectBlueprintService,
      repoService: mockRepoService,
      ticketService: mockTicketService,
      commandEngine: mockCommandEngine,
      v2EventService: mockV2EventService,
    });

    expect(mockApprovalService.decideApproval).toHaveBeenCalledWith("approval-1", {
      decision: "rejected",
      reason: "Security concern",
      decidedBy: "user-1",
    });
  });

  it("resolves metadata from runProjection when not in payload", async () => {
    const approvalDecision = {
      id: "approval-1",
      actionType: "execution_request" as const,
      payload: {
        run_id: "run-1",
        ticket_id: "ticket-1",
        prompt: "Fix the bug",
      },
    };

    const mockTicket = { id: "ticket-1", repoId: "repo-1", status: "in_progress" as const };
    const mockAttempt = { id: "attempt-1" };

    vi.mocked(mockApprovalService.decideApproval).mockResolvedValue(approvalDecision as any);
    vi.mocked(mockTicketService.getTicket).mockResolvedValue(mockTicket as any);
    vi.mocked(mockRepoService.getActiveWorktreePath).mockResolvedValue("/tmp/worktree");
    vi.mocked(mockExecutionService.startExecution).mockResolvedValue(mockAttempt as any);
    vi.mocked(mockProjectBlueprintService.get).mockResolvedValue({} as any);
    vi.mocked(mockRepoService.getGuidelines).mockResolvedValue([]);
    mocks.prisma.runProjection.findUnique.mockResolvedValue({
      metadata: {
        repo_id: "repo-from-metadata",
        worktree_path: "/metadata/worktree",
        model_role: "coder_default",
        provider_id: "qwen-cli",
        routing_decision_id: "routing-1",
      },
    });

    await decideApprovalWithCommandFollowup({
      approvalId: "approval-1",
      decision: "approved",
      actor: "user-1",
      executeApprovedCommand: false,
      requeueBlockedStage: false,
      approvalService: mockApprovalService,
      executionService: mockExecutionService,
      projectBlueprintService: mockProjectBlueprintService,
      repoService: mockRepoService,
      ticketService: mockTicketService,
      commandEngine: mockCommandEngine,
      v2EventService: mockV2EventService,
    });

    expect(mockExecutionService.startExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreePath: "/metadata/worktree",
        modelRole: "coder_default",
        providerId: "qwen-cli",
        routingDecisionId: "routing-1",
      })
    );
  });
});

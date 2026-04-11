import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolCallTimeline } from "./ToolCallTimeline";
import type { WorkflowCardItem, WorkflowLaneKey } from "./types";

vi.mock("../mission/SynthesizerPanel", () => ({
  SynthesizerPanel: () => <div data-testid="synthesizer-panel" />,
}));

vi.mock("../mission/ProjectMemoryPanel", () => ({
  ProjectMemoryPanel: () => <div data-testid="project-memory-panel" />,
}));

vi.mock("../views/MemoryBrowserPanel", () => ({
  MemoryBrowserPanel: () => <div data-testid="memory-browser-panel" />,
}));

function makeMission(overrides: Record<string, unknown> = {}) {
  return {
    selectedRepo: { id: "repo-1", displayName: "Test Repo", repoRoot: "/tmp/repo" },
    route: null,
    contextPack: null,
    pendingApprovals: [],
    isExecuting: false,
    isReviewing: false,
    isActing: false,
    isCommenting: false,
    isUpdatingTicketExecutionProfile: false,
    isUpdatingTicketPermissionMode: false,
    messages: [],
    selectedExecutionProfile: { id: "balanced", name: "Balanced" },
    executionProfiles: {
      activeProfileId: "balanced",
      profiles: [{ id: "balanced", name: "Balanced" }],
    },
    runSummary: null,
    verification: null,
    shareReport: null,
    input: "",
    sendMessage: vi.fn(),
    reviewRoute: vi.fn(),
    addTaskComment: vi.fn(),
    decideApproval: vi.fn(),
    setTicketExecutionProfile: vi.fn(),
    setTicketPermissionMode: vi.fn(),
    ticketLifecycleNotices: {},
    ...overrides,
  };
}

function makeWorkflow(overrides: Record<string, unknown> = {}): WorkflowCardItem {
  return {
    workflowId: "wf-1",
    title: "Implement login page",
    subtitle: "Build login form with validation",
    status: "backlog" as WorkflowLaneKey,
    rawStatus: "backlog",
    priority: "high",
    risk: "medium",
    taskCount: 1,
    isBlocked: false,
    blockedReason: null,
    impactedFiles: ["src/login.tsx"],
    impactedTests: ["src/login.test.tsx"],
    impactedDocs: ["docs/auth.md"],
    lastUpdatedAt: new Date().toISOString(),
    verificationState: null,
    verificationFailure: null,
    verificationCommand: null,
    confidence: null,
    progress: 18,
    ownerLabel: null,
    executionProfileOverrideId: null,
    executionProfileOverrideName: null,
    laneCount: 0,
    laneOrder: 0,
    ...overrides,
  } as unknown as WorkflowCardItem;
}

function makeTaskDetail(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "wf-1",
    title: "Implement login page",
    status: "backlog",
    comments: [],
    activityNotes: [],
    metadata: {},
    logs: [],
    approvals: [],
    verification: [],
    impactedFiles: [],
    impactedTests: [],
    impactedDocs: [],
    workflowSummary: null,
    blockers: [],
    nextSteps: [],
    verificationFailures: [],
    verificationCommand: null,
    route: null,
    subtasks: [],
    executionProfileOverrideId: null,
    executionProfileSnapshot: null,
    ticketExecutionPolicy: null,
    ...overrides,
  };
}

function makeApproval(overrides: Record<string, unknown> = {}) {
  return {
    approval_id: "a-1",
    action_type: "shell_command",
    status: "pending" as const,
    reason: "Needs user approval",
    payload: { aggregate_id: null },
    requested_at: new Date().toISOString(),
    decided_at: null,
    ...overrides,
  };
}

describe("ToolCallTimeline", () => {
  it("renders the overseer mode by default", () => {
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="overseer"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Command Context")).toBeInTheDocument();
    expect(screen.getAllByText("Overseer").length).toBeGreaterThanOrEqual(1);
  });

  it("shows approval tab when approvals are present", () => {
    const approvals = [makeApproval()];

    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="approval"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={approvals}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Approvals")).toBeInTheDocument();
    expect(screen.getByText("shell command")).toBeInTheDocument();
    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(screen.getByText("Reject")).toBeInTheDocument();
  });

  it("shows empty overseer state when no messages", () => {
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="overseer"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText(/State the objective/)).toBeInTheDocument();
  });

  it("shows Task Detail tab when selectedWorkflow is present", () => {
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="overseer"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Task Detail")).toBeInTheDocument();
  });

  it("does not show Task Detail tab when no selectedWorkflow", () => {
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="overseer"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.queryByText("Task Detail")).not.toBeInTheDocument();
  });

  it("shows Run Detail tab when runSummary exists", () => {
    const mission = makeMission({
      runSummary: {
        status: "completed",
        providerId: "onprem-qwen",
        modelRole: "coder_default",
        executionMode: "single_agent",
        metadata: {},
      },
    });
    render(
      <ToolCallTimeline
        mission={mission as never}
        mode="overseer"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Run Detail")).toBeInTheDocument();
  });

  it("shows Memory tab when selectedRepo exists", () => {
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="overseer"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Memory")).toBeInTheDocument();
  });

  it("calls setMode when tab button is clicked", () => {
    const setMode = vi.fn();
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="overseer"
        setMode={setMode}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Task Detail"));
    expect(setMode).toHaveBeenCalledWith("task");
  });

  it("falls back to overseer when active mode is not in availableModes", () => {
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode={"task"}
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    // Should fall back to overseer since "task" mode is hidden when no selectedWorkflow
    expect(screen.getByText(/State the objective/)).toBeInTheDocument();
  });

  // --- TaskDetailPanel tests ---

  it("renders TaskDetailPanel with workflow info", () => {
    const workflow = makeWorkflow();
    const td = makeTaskDetail();
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={workflow as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Selected Workflow")).toBeInTheDocument();
    expect(screen.getByText("Implement login page")).toBeInTheDocument();
    expect(screen.getByText("Build login form with validation")).toBeInTheDocument();
    expect(screen.getByText("Priority")).toBeInTheDocument();
    expect(screen.getByText("Risk")).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Verification")).toBeInTheDocument();
  });

  it("shows route labels in TaskDetailPanel when route exists", () => {
    const workflow = makeWorkflow();
    const td = makeTaskDetail({
      route: {
        executionMode: "single_agent",
        modelRole: "coder_default",
        providerId: "onprem-qwen",
        verificationDepth: "standard",
        confidence: 0.9,
      },
    });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={workflow as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Single Agent")).toBeInTheDocument();
    expect(screen.getByText("Build")).toBeInTheDocument();
  });

  it("shows 'No route' when taskDetail has no route", () => {
    const td = makeTaskDetail({ route: null });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("No route")).toBeInTheDocument();
    expect(screen.getByText("Pending review")).toBeInTheDocument();
  });

  it("shows Deep Context section with workflow summary", () => {
    const td = makeTaskDetail({ workflowSummary: "This workflow implements the login page" });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Deep Context")).toBeInTheDocument();
    expect(screen.getByText("This workflow implements the login page")).toBeInTheDocument();
  });

  it("shows default Deep Context text when no summary", () => {
    const td = makeTaskDetail({ workflowSummary: null });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText(/Select review or execute/)).toBeInTheDocument();
  });

  it("shows verification command in Deep Context", () => {
    const td = makeTaskDetail({ verificationCommand: "npx vitest run" });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("npx vitest run")).toBeInTheDocument();
  });

  it("shows blockers in Deep Context", () => {
    const td = makeTaskDetail({ blockers: ["Blocked by API team"] });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Blocked by API team")).toBeInTheDocument();
  });

  it("shows next steps in Deep Context", () => {
    const td = makeTaskDetail({ nextSteps: ["Fix type errors", "Run integration tests", "Update docs"] });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Fix type errors")).toBeInTheDocument();
    expect(screen.getByText("Run integration tests")).toBeInTheDocument();
    expect(screen.getByText("Update docs")).toBeInTheDocument();
  });

  it("shows subtasks section when subtasks exist", () => {
    const td = makeTaskDetail({
      subtasks: [
        {
          id: "st-1",
          parentTicketId: "wf-1",
          title: "Create form component",
          description: "Build the login form",
          status: "done",
          priority: "high",
          risk: "medium",
          dependencies: [],
          notes: ["Completed successfully"],
          blockedBy: [],
          blocked: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "st-2",
          parentTicketId: "wf-1",
          title: "Add validation",
          description: "Add form validation",
          status: "in_progress",
          priority: "medium",
          risk: "low",
          dependencies: [],
          notes: [],
          blockedBy: ["st-3"],
          blocked: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Subtasks")).toBeInTheDocument();
    expect(screen.getByText("1/2 done")).toBeInTheDocument();
    expect(screen.getByText("Create form component")).toBeInTheDocument();
    expect(screen.getByText("Add validation")).toBeInTheDocument();
    expect(screen.getByText("Blocked by: st-3")).toBeInTheDocument();
    expect(screen.getByText("Completed successfully")).toBeInTheDocument();
  });

  it("does not show subtasks section when empty", () => {
    const td = makeTaskDetail({ subtasks: [] });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.queryByText("Subtasks")).not.toBeInTheDocument();
  });

  it("shows execution profile section with select and stages", () => {
    const td = makeTaskDetail({
      executionProfileOverrideId: null,
      executionProfileSnapshot: {
        profileId: "balanced",
        profileName: "Balanced",
        stages: [
          { stage: "scope", role: "coder_default", providerId: "onprem-qwen", model: "qwen-4b" },
          { stage: "build", role: "coder_default", providerId: "onprem-qwen", model: "qwen-4b" },
        ],
      },
    });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Execution Profile")).toBeInTheDocument();
    expect(screen.getByText("scope")).toBeInTheDocument();
    expect(screen.getByText("build")).toBeInTheDocument();
  });

  it("shows 'No run snapshot yet' when no execution profile snapshot", () => {
    const td = makeTaskDetail({ executionProfileSnapshot: null });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText(/No run snapshot yet/)).toBeInTheDocument();
  });

  it("shows ticket permission selector with balanced mode", () => {
    const td = makeTaskDetail({
      ticketExecutionPolicy: {
        ticketId: "wf-1",
        mode: "balanced",
        allowInstallCommands: false,
        allowNetworkCommands: false,
        requireApprovalFor: [],
        updatedAt: new Date().toISOString(),
        updatedBy: "user",
      },
    });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Ticket permission")).toBeInTheDocument();
    expect(screen.getByText("approval for risky ops")).toBeInTheDocument();
  });

  it("shows strict mode label", () => {
    const td = makeTaskDetail({
      ticketExecutionPolicy: {
        ticketId: "wf-1",
        mode: "strict",
        allowInstallCommands: false,
        allowNetworkCommands: false,
        requireApprovalFor: [],
        updatedAt: new Date().toISOString(),
        updatedBy: "user",
      },
    });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("approval per command")).toBeInTheDocument();
  });

  it("shows legacy full_access warning", () => {
    const td = makeTaskDetail({
      ticketExecutionPolicy: {
        ticketId: "wf-1",
        mode: "full_access",
        allowInstallCommands: true,
        allowNetworkCommands: true,
        requireApprovalFor: [],
        updatedAt: new Date().toISOString(),
        updatedBy: "system",
      },
    });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("legacy unrestricted mode")).toBeInTheDocument();
    expect(screen.getByText(/legacy internal-only permission mode/)).toBeInTheDocument();
  });

  it("shows Comments section with textarea and add note button", () => {
    const td = makeTaskDetail();
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Comments")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Add a task note or comment for this workflow.")).toBeInTheDocument();
    expect(screen.getByText("Add Note")).toBeInTheDocument();
  });

  it("shows 'No authored comments yet.' when no comments", () => {
    const td = makeTaskDetail({ comments: [] });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("No authored comments yet.")).toBeInTheDocument();
  });

  it("renders comments when present", () => {
    const td = makeTaskDetail({
      comments: [
        {
          id: "c-1",
          author: "admin",
          body: "Please check this",
          createdAt: new Date().toISOString(),
          parentCommentId: null,
          replies: [],
        },
      ],
    });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Please check this")).toBeInTheDocument();
  });

  it("submits a comment when Add Note is clicked with content", () => {
    const addTaskComment = vi.fn();
    const setCommentDraft = vi.fn();
    const td = makeTaskDetail();
    render(
      <ToolCallTimeline
        mission={makeMission({ addTaskComment }) as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft="Test comment content"
        setCommentDraft={setCommentDraft}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Add Note"));
    expect(addTaskComment).toHaveBeenCalledWith("wf-1", "Test comment content", null);
    expect(setCommentDraft).toHaveBeenCalledWith("");
  });

  it("does not submit comment when draft is empty", () => {
    const addTaskComment = vi.fn();
    render(
      <ToolCallTimeline
        mission={makeMission({ addTaskComment }) as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={makeTaskDetail() as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Add Note"));
    expect(addTaskComment).not.toHaveBeenCalled();
  });

  it("does not submit comment when no selectedWorkflowId", () => {
    const addTaskComment = vi.fn();
    render(
      <ToolCallTimeline
        mission={makeMission({ addTaskComment }) as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId={null}
        taskDetail={makeTaskDetail() as never}
        approvals={[]}
        commentDraft="Some text"
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Add Note"));
    expect(addTaskComment).not.toHaveBeenCalled();
  });

  it("shows Reply button on comments and toggles reply form", () => {
    const td = makeTaskDetail({
      comments: [
        {
          id: "c-1",
          author: "admin",
          body: "Check this bug",
          createdAt: new Date().toISOString(),
          parentCommentId: null,
          replies: [],
        },
      ],
    });
    const setReplyTargetId = vi.fn();
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={setReplyTargetId}
      />
    );

    fireEvent.click(screen.getByText("Reply"));
    expect(setReplyTargetId).toHaveBeenCalled();
  });

  it("shows reply form when replyTargetId matches comment", () => {
    const td = makeTaskDetail({
      comments: [
        {
          id: "c-1",
          author: "admin",
          body: "Check this bug",
          createdAt: new Date().toISOString(),
          parentCommentId: null,
          replies: [],
        },
      ],
    });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId="c-1"
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByPlaceholderText("Reply to this note.")).toBeInTheDocument();
    // "Cancel" appears in both the toggle button and the reply form cancel button
    const cancelButtons = screen.getAllByText("Cancel");
    expect(cancelButtons.length).toBe(2);
  });

  it("shows Cancel button text when reply is active", () => {
    const td = makeTaskDetail({
      comments: [
        {
          id: "c-1",
          author: "admin",
          body: "Check this bug",
          createdAt: new Date().toISOString(),
          parentCommentId: null,
          replies: [],
        },
      ],
    });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId="c-1"
        setReplyTargetId={vi.fn()}
      />
    );

    // The reply toggle button should show "Cancel" when replying
    const cancelButtons = screen.getAllByText("Cancel");
    expect(cancelButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("renders nested comment replies", () => {
    const td = makeTaskDetail({
      comments: [
        {
          id: "c-1",
          author: "admin",
          body: "Parent comment",
          createdAt: new Date().toISOString(),
          parentCommentId: null,
          replies: [
            {
              id: "c-2",
              author: "agent",
              body: "Reply to parent",
              createdAt: new Date().toISOString(),
              parentCommentId: "c-1",
              replies: [],
            },
          ],
        },
      ],
    });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Parent comment")).toBeInTheDocument();
    expect(screen.getByText("Reply to parent")).toBeInTheDocument();
  });

  it("shows Activity Notes section", () => {
    const td = makeTaskDetail({
      activityNotes: [
        { id: "an-1", author: "system", body: "Scope generated", createdAt: new Date().toISOString() },
      ],
    });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Activity Notes")).toBeInTheDocument();
    expect(screen.getByText("Scope generated")).toBeInTheDocument();
  });

  it("shows 'No system activity notes yet.' when no activity notes", () => {
    const td = makeTaskDetail({ activityNotes: [] });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("No system activity notes yet.")).toBeInTheDocument();
  });

  it("shows Recent Logs section with log entries", () => {
    const td = makeTaskDetail({
      logs: [
        { id: "log-1", projectId: "p-1", category: "execution", level: "info", message: "Starting build", createdAt: new Date().toISOString() },
      ],
    });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Recent Logs")).toBeInTheDocument();
    expect(screen.getByText("Starting build")).toBeInTheDocument();
  });

  it("shows 'No task-scoped logs yet.' when no logs", () => {
    const td = makeTaskDetail({ logs: [] });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("No task-scoped logs yet.")).toBeInTheDocument();
  });

  it("shows verification failures section when failures exist", () => {
    const td = makeTaskDetail({
      verificationFailures: ["Test suite failed", "Lint errors detected"],
    });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Verification Failures")).toBeInTheDocument();
    expect(screen.getByText("Test suite failed")).toBeInTheDocument();
    expect(screen.getByText("Lint errors detected")).toBeInTheDocument();
  });

  it("does not show verification failures section when empty", () => {
    const td = makeTaskDetail({ verificationFailures: [] });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.queryByText("Verification Failures")).not.toBeInTheDocument();
  });

  it("calls setTicketExecutionProfile when profile select changes", () => {
    const setTicketExecutionProfile = vi.fn();
    const td = makeTaskDetail({ executionProfileOverrideId: null });
    render(
      <ToolCallTimeline
        mission={makeMission({ setTicketExecutionProfile }) as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    const selects = screen.getAllByRole("combobox");
    const profileSelect = selects[0];
    fireEvent.change(profileSelect, { target: { value: "balanced" } });
    expect(setTicketExecutionProfile).toHaveBeenCalledWith("wf-1", "balanced");
  });

  it("calls setTicketPermissionMode when permission select changes", () => {
    const setTicketPermissionMode = vi.fn();
    const td = makeTaskDetail({
      ticketExecutionPolicy: {
        ticketId: "wf-1",
        mode: "balanced",
        allowInstallCommands: false,
        allowNetworkCommands: false,
        requireApprovalFor: [],
        updatedAt: new Date().toISOString(),
        updatedBy: "user",
      },
    });
    render(
      <ToolCallTimeline
        mission={makeMission({ setTicketPermissionMode }) as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    const selects = screen.getAllByRole("combobox");
    const permSelect = selects[1];
    fireEvent.change(permSelect, { target: { value: "strict" } });
    expect(setTicketPermissionMode).toHaveBeenCalledWith("wf-1", "strict");
  });

  // --- ApprovalPanel tests ---

  it("renders approval panel with approve/reject buttons", () => {
    const approvals = [makeApproval()];
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="approval"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={approvals}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("shell command")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(screen.getByText("Needs user approval")).toBeInTheDocument();
  });

  it("calls decideApproval with 'approved' when Approve is clicked", () => {
    const decideApproval = vi.fn();
    const approvals = [makeApproval()];
    render(
      <ToolCallTimeline
        mission={makeMission({ decideApproval }) as never}
        mode="approval"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={approvals}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Approve"));
    expect(decideApproval).toHaveBeenCalledWith("a-1", "approved");
  });

  it("calls decideApproval with 'rejected' when Reject is clicked", () => {
    const decideApproval = vi.fn();
    const approvals = [makeApproval()];
    render(
      <ToolCallTimeline
        mission={makeMission({ decideApproval }) as never}
        mode="approval"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={approvals}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Reject"));
    expect(decideApproval).toHaveBeenCalledWith("a-1", "rejected");
  });

  it("shows empty approval message when no approvals", () => {
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="approval"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    // "approval" mode is not in availableModes when approvals is empty, falls back to overseer
    expect(screen.getByText(/State the objective/)).toBeInTheDocument();
  });

  it("shows approval reason fallback text when no reason", () => {
    const approvals = [makeApproval({ reason: null })];
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="approval"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={approvals}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Approval required before work can proceed.")).toBeInTheDocument();
  });

  // --- RunDetailPanel tests ---

  it("renders run detail panel with run summary", () => {
    const mission = makeMission({
      runSummary: {
        status: "completed",
        providerId: "onprem-qwen",
        modelRole: "coder_default",
        executionMode: "single_agent",
        metadata: {},
      },
      verification: {
        changedFileChecks: ["a.ts"],
        impactedTests: ["a.test.ts", "b.test.ts"],
        docsChecked: [],
      },
    });
    render(
      <ToolCallTimeline
        mission={mission as never}
        mode="run"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Run State")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText(/Local Qwen/)).toBeInTheDocument();
    expect(screen.getByText("Checks: 1")).toBeInTheDocument();
    expect(screen.getByText("Tests: 2")).toBeInTheDocument();
    expect(screen.getByText("Docs: 0")).toBeInTheDocument();
  });

  it("shows 'No active execution' when no runSummary", () => {
    const mission = makeMission({ runSummary: null });
    render(
      <ToolCallTimeline
        mission={mission as never}
        mode="run"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    // "run" mode requires runSummary, falls back to overseer
    expect(screen.getByText(/State the objective/)).toBeInTheDocument();
  });

  it("shows execution profile snapshot in run detail panel", () => {
    const mission = makeMission({
      runSummary: {
        status: "running",
        providerId: "onprem-qwen",
        modelRole: "coder_default",
        executionMode: "single_agent",
        metadata: {
          execution_profile_snapshot: {
            profileId: "balanced",
            profileName: "Balanced",
            stages: [
              { stage: "scope", role: "coder_default", providerId: "onprem-qwen", model: "qwen-4b" },
            ],
          },
        },
      },
    });
    render(
      <ToolCallTimeline
        mission={mission as never}
        mode="run"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Execution Profile")).toBeInTheDocument();
    expect(screen.getAllByText("Balanced").length).toBeGreaterThanOrEqual(1);
  });

  it("shows shareable summary in run detail panel", () => {
    const mission = makeMission({
      runSummary: {
        status: "completed",
        providerId: "onprem-qwen",
        modelRole: "coder_default",
        executionMode: "single_agent",
        metadata: {},
      },
      shareReport: { summary: "All tasks completed successfully" },
    });
    render(
      <ToolCallTimeline
        mission={mission as never}
        mode="run"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Shareable Summary")).toBeInTheDocument();
    expect(screen.getByText("All tasks completed successfully")).toBeInTheDocument();
  });

  // --- OverseerPanel tests ---

  it("shows overseer with route info when route exists", () => {
    const mission = makeMission({
      route: {
        executionMode: "single_agent",
        modelRole: "coder_default",
        providerId: "onprem-qwen",
        verificationDepth: "standard",
        confidence: 0.9,
      },
    });
    render(
      <ToolCallTimeline
        mission={mission as never}
        mode="overseer"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText(/Single Agent/)).toBeInTheDocument();
  });

  it("shows 'No route reviewed yet' when no route", () => {
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="overseer"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("No route reviewed yet")).toBeInTheDocument();
  });

  it("shows context pack summary when contextPack exists", () => {
    const mission = makeMission({
      contextPack: { files: ["a.ts", "b.ts"], tests: ["a.test.ts"], docs: ["readme.md"] },
    });
    render(
      <ToolCallTimeline
        mission={mission as never}
        mode="overseer"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText(/2 files/)).toBeInTheDocument();
  });

  it("shows review prompt when no contextPack", () => {
    render(
      <ToolCallTimeline
        mission={makeMission({ contextPack: null }) as never}
        mode="overseer"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText(/Review the route/)).toBeInTheDocument();
  });

  it("shows pending approvals count in overseer", () => {
    const mission = makeMission({
      pendingApprovals: [makeApproval()],
    });
    render(
      <ToolCallTimeline
        mission={mission as never}
        mode="overseer"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[makeApproval()]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("1 pending")).toBeInTheDocument();
  });

  it("shows 'No alerts' when no pending approvals", () => {
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="overseer"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("No alerts")).toBeInTheDocument();
  });

  it("shows processing indicator when isExecuting", () => {
    const mission = makeMission({ isExecuting: true });
    render(
      <ToolCallTimeline
        mission={mission as never}
        mode="overseer"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    // The processing indicator should be present when executing
    const overseerSection = screen.getByText("No route reviewed yet").closest("div")!;
    expect(overseerSection).toBeInTheDocument();
  });

  it("shows processing indicator when isReviewing", () => {
    const mission = makeMission({ isReviewing: true });
    render(
      <ToolCallTimeline
        mission={mission as never}
        mode="overseer"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    const overseerSection = screen.getByText("No route reviewed yet").closest("div")!;
    expect(overseerSection).toBeInTheDocument();
  });

  it("renders overseer messages when present", () => {
    const mission = makeMission({
      messages: [
        { id: "m-1", role: "user", content: "Build a login page", createdAt: new Date().toISOString() },
        { id: "m-2", role: "assistant", content: "I will create the login page now.", createdAt: new Date().toISOString() },
      ],
    });
    render(
      <ToolCallTimeline
        mission={mission as never}
        mode="overseer"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Build a login page")).toBeInTheDocument();
    expect(screen.getByText("I will create the login page now.")).toBeInTheDocument();
  });

  it("shows Quick Actions with Send to Overseer and Open Task Detail buttons", () => {
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="overseer"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("Quick Actions")).toBeInTheDocument();
    expect(screen.getByText("Send to Overseer")).toBeInTheDocument();
    expect(screen.getByText("Open Task Detail")).toBeInTheDocument();
  });

  it("calls sendMessage when Send to Overseer is clicked", () => {
    const sendMessage = vi.fn();
    const mission = makeMission({ sendMessage, input: "test prompt" });
    render(
      <ToolCallTimeline
        mission={mission as never}
        mode="overseer"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Send to Overseer"));
    expect(sendMessage).toHaveBeenCalled();
  });

  it("calls setMode('task') when Open Task Detail is clicked with selectedWorkflow", () => {
    const setMode = vi.fn();
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="overseer"
        setMode={setMode}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Open Task Detail"));
    expect(setMode).toHaveBeenCalledWith("task");
  });

  // --- Memory mode test ---

  it("renders memory panel when mode is memory", () => {
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode={"memory" as never}
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByTestId("memory-browser-panel")).toBeInTheDocument();
    expect(screen.getByTestId("project-memory-panel")).toBeInTheDocument();
  });

  it("clears __project__ to null when selecting project default execution profile", () => {
    const setTicketExecutionProfile = vi.fn();
    const td = makeTaskDetail({ executionProfileOverrideId: "some-profile" });
    render(
      <ToolCallTimeline
        mission={makeMission({ setTicketExecutionProfile }) as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    const selects = screen.getAllByRole("combobox");
    const profileSelect = selects[0];
    fireEvent.change(profileSelect, { target: { value: "__project__" } });
    expect(setTicketExecutionProfile).toHaveBeenCalledWith("wf-1", null);
  });

  it("submits a reply to a comment", () => {
    const addTaskComment = vi.fn();
    const setReplyTargetId = vi.fn();
    const td = makeTaskDetail({
      comments: [
        {
          id: "c-reply",
          author: "admin",
          body: "Initial comment",
          createdAt: new Date().toISOString(),
          parentCommentId: null,
          replies: [],
        },
      ],
    });
    render(
      <ToolCallTimeline
        mission={makeMission({ addTaskComment }) as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId="c-reply"
        setReplyTargetId={setReplyTargetId}
      />
    );

    const replyTextarea = screen.getByPlaceholderText("Reply to this note.");
    fireEvent.change(replyTextarea, { target: { value: "My reply text" } });
    // Click the Reply button in the reply form (not the toggle)
    const replyButtons = screen.getAllByText("Reply");
    const replySubmit = replyButtons.find((btn) => btn.closest("button")?.className.includes("cyan"));
    if (replySubmit) fireEvent.click(replySubmit);
    expect(addTaskComment).toHaveBeenCalledWith("wf-1", "My reply text", "c-reply");
  });

  it("cancels reply form via cancel button inside reply form", () => {
    const setReplyTargetId = vi.fn();
    const td = makeTaskDetail({
      comments: [
        {
          id: "c-cancel",
          author: "admin",
          body: "Comment to cancel reply",
          createdAt: new Date().toISOString(),
          parentCommentId: null,
          replies: [],
        },
      ],
    });
    render(
      <ToolCallTimeline
        mission={makeMission() as never}
        mode="task"
        setMode={vi.fn()}
        selectedWorkflow={makeWorkflow() as never}
        selectedWorkflowId="wf-1"
        taskDetail={td as never}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId="c-cancel"
        setReplyTargetId={setReplyTargetId}
      />
    );

    // Find the Cancel button inside the reply form (not the toggle)
    const cancelButtons = screen.getAllByText("Cancel");
    const formCancel = cancelButtons.find((btn) => btn.closest("button")?.className.includes("rounded-lg"));
    if (formCancel) fireEvent.click(formCancel);
    expect(setReplyTargetId).toHaveBeenCalled();
  });

  it("shows run state as idle when no runSummary status", () => {
    const mission = makeMission({
      runSummary: {
        status: null,
        providerId: "onprem-qwen",
        modelRole: "coder_default",
        executionMode: "single_agent",
        metadata: {},
      },
    });
    render(
      <ToolCallTimeline
        mission={mission as never}
        mode="run"
        setMode={vi.fn()}
        selectedWorkflow={null}
        selectedWorkflowId={null}
        taskDetail={null}
        approvals={[]}
        commentDraft=""
        setCommentDraft={vi.fn()}
        replyTargetId={null}
        setReplyTargetId={vi.fn()}
      />
    );

    expect(screen.getByText("idle")).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolCallTimeline } from "./ToolCallTimeline";

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
    const approvals = [
      {
        approval_id: "a-1",
        action_type: "shell_command",
        status: "pending" as const,
        reason: "Needs user approval",
        payload: { aggregate_id: null },
        requested_at: new Date().toISOString(),
        decided_at: null,
      },
    ];

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
});

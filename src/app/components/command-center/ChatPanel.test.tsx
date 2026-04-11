import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ChatPanel } from "./ChatPanel";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { item: null } }),
}));

vi.mock("../agentic", () => ({
  AgenticRunDeepPanel: () => <div data-testid="agentic-deep-panel" />,
  RunReplayPanel: () => <div data-testid="run-replay-panel" />,
}));

const mockResumeAgenticRun = vi.fn();
vi.mock("../../lib/apiClient", () => ({
  resumeAgenticRun: (...args: unknown[]) => mockResumeAgenticRun(...args),
}));

function makeMission(overrides: Record<string, unknown> = {}) {
  return {
    selectedRepo: { id: "repo-1", displayName: "Test Repo", branch: "main", defaultBranch: "main" },
    selectedTicket: null,
    input: "",
    setInput: vi.fn(),
    activeProjectIsBlank: false,
    route: null,
    contextPack: null,
    isExecuting: false,
    isReviewing: false,
    isActing: false,
    isUpdatingExecutionProfile: false,
    reviewRoute: vi.fn(),
    executeRoute: vi.fn(),
    refreshSnapshot: vi.fn(),
    selectedExecutionProfileId: "balanced",
    selectedExecutionProfile: { id: "balanced", name: "Balanced" },
    executionProfiles: {
      activeProfileId: "balanced",
      profiles: [{ id: "balanced", name: "Balanced" }],
    },
    setExecutionProfile: vi.fn(),
    pendingApprovals: [],
    agenticRun: null,
    planModeEnabled: false,
    setPlanModeEnabled: vi.fn(),
    coordinatorEnabled: false,
    setCoordinatorEnabled: vi.fn(),
    coordinatorMaxAgents: 5,
    setCoordinatorMaxAgents: vi.fn(),
    coordinatorMaxConcurrent: 3,
    setCoordinatorMaxConcurrent: vi.fn(),
    actionMessage: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockResumeAgenticRun.mockReset();
});

describe("ChatPanel", () => {
  it("renders the task input and primary action button", () => {
    render(
      <ChatPanel
        mission={makeMission() as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Describe the task" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Describe the next change...")).toBeInTheDocument();
    expect(screen.getByTestId("work-primary-action")).toBeInTheDocument();
    expect(screen.getByText("Review plan")).toBeInTheDocument();
  });

  it("shows blank project placeholder when activeProjectIsBlank is true", () => {
    render(
      <ChatPanel
        mission={makeMission({ activeProjectIsBlank: true }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );

    expect(screen.getByPlaceholderText("Describe what you want to build...")).toBeInTheDocument();
  });

  it("calls setInput when typing in textarea", () => {
    const setInput = vi.fn();
    render(
      <ChatPanel
        mission={makeMission({ setInput }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );

    const textarea = screen.getByPlaceholderText("Describe the next change...");
    fireEvent.change(textarea, { target: { value: "Add tests" } });
    expect(setInput).toHaveBeenCalledWith("Add tests");
  });

  it("shows attention count when non-zero", () => {
    render(
      <ChatPanel
        mission={makeMission() as never}
        attentionCount={3}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );

    expect(screen.getByText("3 attention")).toBeInTheDocument();
  });

  it("shows running state when isExecuting is true", () => {
    render(
      <ChatPanel
        mission={makeMission({ isExecuting: true }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );

    expect(screen.getByText("Running...")).toBeInTheDocument();
    expect(screen.getByText("Stop")).toBeInTheDocument();
  });

  it("shows 'ready' chip when attentionCount is 0", () => {
    render(
      <ChatPanel
        mission={makeMission() as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.getByText("ready")).toBeInTheDocument();
  });

  it("shows Reviewing state when isReviewing is true", () => {
    render(
      <ChatPanel
        mission={makeMission({ isReviewing: true }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.getByText("Reviewing...")).toBeInTheDocument();
    expect(screen.getByText("Stop")).toBeInTheDocument();
  });

  it("calls refreshSnapshot when Stop is clicked", () => {
    const refreshSnapshot = vi.fn();
    render(
      <ChatPanel
        mission={makeMission({ isExecuting: true, refreshSnapshot }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Stop"));
    expect(refreshSnapshot).toHaveBeenCalledTimes(1);
  });

  it("calls setExecutionProfile when profile selector changes", () => {
    const setExecutionProfile = vi.fn();
    render(
      <ChatPanel
        mission={makeMission({
          setExecutionProfile,
          executionProfiles: {
            activeProfileId: "balanced",
            profiles: [
              { id: "balanced", name: "Balanced" },
              { id: "fast", name: "Fast" },
            ],
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    const select = screen.getByTestId("work-profile-selector");
    fireEvent.change(select, { target: { value: "fast" } });
    expect(setExecutionProfile).toHaveBeenCalledWith("fast");
  });

  it("toggles plan mode checkbox", () => {
    const setPlanModeEnabled = vi.fn();
    render(
      <ChatPanel
        mission={makeMission({ setPlanModeEnabled }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    const checkbox = screen.getByLabelText(/Plan mode/);
    fireEvent.click(checkbox);
    expect(setPlanModeEnabled).toHaveBeenCalledWith(true);
  });

  it("toggles coordinator checkbox", () => {
    const setCoordinatorEnabled = vi.fn();
    render(
      <ChatPanel
        mission={makeMission({ setCoordinatorEnabled }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    const checkbox = screen.getByRole("checkbox", { name: /Coordinator/i });
    fireEvent.click(checkbox);
    expect(setCoordinatorEnabled).toHaveBeenCalledWith(true);
  });

  it("shows coordinator agent/concurrent inputs when coordinator is enabled", () => {
    render(
      <ChatPanel
        mission={makeMission({ coordinatorEnabled: true }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/Agents/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Concurrent/i)).toBeInTheDocument();
  });

  it("does not show coordinator inputs when coordinator is disabled", () => {
    render(
      <ChatPanel
        mission={makeMission({ coordinatorEnabled: false }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.queryByLabelText(/Agents/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Concurrent/i)).not.toBeInTheDocument();
  });

  it("calls setCoordinatorMaxAgents when agents input changes", () => {
    const setCoordinatorMaxAgents = vi.fn();
    render(
      <ChatPanel
        mission={makeMission({ coordinatorEnabled: true, setCoordinatorMaxAgents }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    const agentsInput = screen.getByLabelText(/Agents/i);
    fireEvent.change(agentsInput, { target: { value: "8" } });
    expect(setCoordinatorMaxAgents).toHaveBeenCalledWith(8);
  });

  it("calls setCoordinatorMaxConcurrent when concurrent input changes", () => {
    const setCoordinatorMaxConcurrent = vi.fn();
    render(
      <ChatPanel
        mission={makeMission({ coordinatorEnabled: true, setCoordinatorMaxConcurrent }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    const concurrentInput = screen.getByLabelText(/Concurrent/i);
    fireEvent.change(concurrentInput, { target: { value: "2" } });
    expect(setCoordinatorMaxConcurrent).toHaveBeenCalledWith(2);
  });

  it("shows 'Run task' and Review button when route + input + repo + not running", () => {
    render(
      <ChatPanel
        mission={makeMission({
          input: "Add a feature",
          route: { executionMode: "single_agent", modelRole: "coder_default", providerId: "onprem-qwen", metadata: { confidence: 0.85 } },
          contextPack: { confidence: 0.85, files: [], tests: [], docs: [] },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.getByText("Run task")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("calls executeRoute when Run task is clicked", () => {
    const executeRoute = vi.fn();
    render(
      <ChatPanel
        mission={makeMission({
          input: "Add feature",
          executeRoute,
          route: { executionMode: "single_agent", modelRole: "coder_default", providerId: "onprem-qwen", metadata: {} },
          contextPack: { confidence: 0.8, files: [], tests: [], docs: [] },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId("work-primary-action"));
    expect(executeRoute).toHaveBeenCalledTimes(1);
  });

  it("calls reviewRoute when Review button is clicked", () => {
    const reviewRoute = vi.fn();
    render(
      <ChatPanel
        mission={makeMission({
          input: "Do something",
          reviewRoute,
          route: { executionMode: "single_agent", modelRole: "coder_default", providerId: "onprem-qwen", metadata: {} },
          contextPack: { confidence: 0.8, files: [], tests: [], docs: [] },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Review"));
    expect(reviewRoute).toHaveBeenCalledTimes(1);
  });

  it("calls reviewRoute when primary action clicked without route context", () => {
    const reviewRoute = vi.fn();
    render(
      <ChatPanel
        mission={makeMission({ input: "task", reviewRoute }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId("work-primary-action"));
    expect(reviewRoute).toHaveBeenCalledTimes(1);
  });

  it("shows route summary with confidence when route and contextPack exist", () => {
    render(
      <ChatPanel
        mission={makeMission({
          input: "task",
          route: { executionMode: "single_agent", modelRole: "coder_default", providerId: "onprem-qwen", metadata: { confidence: 0.92 } },
          contextPack: { confidence: 0.85, files: ["a.ts"], tests: ["a.test.ts"], docs: [] },
          selectedExecutionProfile: { id: "balanced", name: "Balanced" },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.getByText(/Plan ready · 92% · Balanced/)).toBeInTheDocument();
  });

  it("shows context-only summary when contextPack exists without route", () => {
    render(
      <ChatPanel
        mission={makeMission({
          input: "task",
          contextPack: { confidence: 0.45, files: [], tests: [], docs: [] },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.getByText(/Context ready · 45%/)).toBeInTheDocument();
  });

  it("expands route details on click", () => {
    render(
      <ChatPanel
        mission={makeMission({
          input: "task",
          route: { executionMode: "single_agent", modelRole: "coder_default", providerId: "onprem-qwen", metadata: { confidence: 0.8 } },
          contextPack: { confidence: 0.8, files: ["a.ts", "b.ts"], tests: ["a.test.ts"], docs: ["README.md"] },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    // Click to expand
    fireEvent.click(screen.getByText(/Plan ready/));
    expect(screen.getByText(/Single Agent · Build/)).toBeInTheDocument();
    expect(screen.getByText(/Local Qwen/)).toBeInTheDocument();
    expect(screen.getByText("2 files")).toBeInTheDocument();
    expect(screen.getByText("1 tests")).toBeInTheDocument();
    expect(screen.getByText("1 docs")).toBeInTheDocument();
  });

  it("calls onOpenCodebaseScope with correct scope", () => {
    const onOpenCodebaseScope = vi.fn();
    render(
      <ChatPanel
        mission={makeMission({
          input: "task",
          route: { executionMode: "single_agent", modelRole: "coder_default", providerId: "onprem-qwen", metadata: {} },
          contextPack: { confidence: 0.8, files: ["a.ts"], tests: ["a.test.ts"], docs: ["d.md"] },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={onOpenCodebaseScope}
        onOpenApprovals={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText(/Plan ready/));
    fireEvent.click(screen.getByText("1 files"));
    expect(onOpenCodebaseScope).toHaveBeenCalledWith("context");
    fireEvent.click(screen.getByText("1 tests"));
    expect(onOpenCodebaseScope).toHaveBeenCalledWith("tests");
    fireEvent.click(screen.getByText("1 docs"));
    expect(onOpenCodebaseScope).toHaveBeenCalledWith("docs");
  });

  it("shows pending approvals button and calls onOpenApprovals", () => {
    const onOpenApprovals = vi.fn();
    render(
      <ChatPanel
        mission={makeMission({
          input: "task",
          route: { executionMode: "single_agent", modelRole: "coder_default", providerId: "onprem-qwen", metadata: {} },
          contextPack: { confidence: 0.8, files: [], tests: [], docs: [] },
          pendingApprovals: [{ id: "a1" }, { id: "a2" }],
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={onOpenApprovals}
      />
    );
    fireEvent.click(screen.getByText(/Plan ready/));
    fireEvent.click(screen.getByText("2 approvals pending"));
    expect(onOpenApprovals).toHaveBeenCalledTimes(1);
  });

  it("collapses route details on second click", () => {
    render(
      <ChatPanel
        mission={makeMission({
          input: "task",
          route: { executionMode: "single_agent", modelRole: "coder_default", providerId: "onprem-qwen", metadata: {} },
          contextPack: { confidence: 0.8, files: ["a.ts"], tests: [], docs: [] },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    const toggle = screen.getByText(/Plan ready/);
    fireEvent.click(toggle);
    expect(screen.getByText("1 files")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByText("1 files")).not.toBeInTheDocument();
  });

  it("uses contextPack confidence as fallback when route metadata has no confidence", () => {
    render(
      <ChatPanel
        mission={makeMission({
          input: "task",
          route: { executionMode: "single_agent", modelRole: "coder_default", providerId: "onprem-qwen", metadata: {} },
          contextPack: { confidence: 0.72, files: [], tests: [], docs: [] },
          selectedExecutionProfile: { id: "balanced", name: "Balanced" },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.getByText(/Plan ready · 72% · Balanced/)).toBeInTheDocument();
  });

  it("does not show route summary when no route or contextPack", () => {
    render(
      <ChatPanel
        mission={makeMission({ input: "task" }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.queryByText(/Plan ready/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Context ready/)).not.toBeInTheDocument();
  });

  // --- AgenticRun section ---
  it("renders agentic run section when agenticRun is present", () => {
    render(
      <ChatPanel
        mission={makeMission({
          agenticRun: {
            runId: "run-1",
            status: "running",
            phase: "execution",
            resumable: false,
            plan: null,
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.getByText("Agentic Run")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByTestId("agentic-deep-panel")).toBeInTheDocument();
  });

  it("renders completed agentic run with run replay panel", () => {
    render(
      <ChatPanel
        mission={makeMission({
          agenticRun: {
            runId: "run-2",
            status: "completed",
            phase: "done",
            resumable: false,
            plan: null,
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText("Run Replay")).toBeInTheDocument();
    expect(screen.getByTestId("run-replay-panel")).toBeInTheDocument();
  });

  it("renders aborted agentic run with replay and resume button", () => {
    render(
      <ChatPanel
        mission={makeMission({
          agenticRun: {
            runId: "run-3",
            status: "aborted",
            phase: "done",
            resumable: true,
            plan: null,
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.getByText("aborted")).toBeInTheDocument();
    expect(screen.getByText("Resume Run")).toBeInTheDocument();
    expect(screen.getByTestId("run-replay-panel")).toBeInTheDocument();
  });

  it("renders failed agentic run with resume button and replay", () => {
    render(
      <ChatPanel
        mission={makeMission({
          agenticRun: {
            runId: "run-4",
            status: "failed",
            phase: "done",
            resumable: true,
            plan: null,
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("Resume Run")).toBeInTheDocument();
    expect(screen.getByText("Run Replay")).toBeInTheDocument();
  });

  it("does not show resume button when not resumable", () => {
    render(
      <ChatPanel
        mission={makeMission({
          agenticRun: {
            runId: "run-5",
            status: "failed",
            phase: "done",
            resumable: false,
            plan: null,
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.queryByText("Resume Run")).not.toBeInTheDocument();
  });

  it("calls resumeAgenticRun when resume button is clicked", async () => {
    mockResumeAgenticRun.mockResolvedValue({});
    const refreshSnapshot = vi.fn();
    render(
      <ChatPanel
        mission={makeMission({
          refreshSnapshot,
          agenticRun: {
            runId: "run-6",
            status: "failed",
            phase: "done",
            resumable: true,
            plan: null,
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Resume Run"));
    expect(screen.getByText("Resuming Run...")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockResumeAgenticRun).toHaveBeenCalledWith("run-6");
    });
    await waitFor(() => {
      expect(refreshSnapshot).toHaveBeenCalled();
    });
  });

  it("handles resume failure gracefully", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockResumeAgenticRun.mockRejectedValue(new Error("network"));
    render(
      <ChatPanel
        mission={makeMission({
          agenticRun: {
            runId: "run-7",
            status: "failed",
            phase: "done",
            resumable: true,
            plan: null,
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Resume Run"));
    await waitFor(() => {
      expect(consoleError).toHaveBeenCalled();
    });
    // Button should be re-enabled after failure
    await waitFor(() => {
      expect(screen.getByText("Resume Run")).toBeInTheDocument();
    });
    consoleError.mockRestore();
  });

  // --- Plan review phase ---
  it("renders plan review UI when phase is plan_review", () => {
    render(
      <ChatPanel
        mission={makeMission({
          approvePlan: vi.fn(),
          refinePlan: vi.fn(),
          rejectPlan: vi.fn(),
          agenticRun: {
            runId: "run-8",
            status: "running",
            phase: "plan_review",
            resumable: false,
            plan: { planContent: "Step 1: do X\nStep 2: do Y", questions: [] },
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.getByText("Plan Review")).toBeInTheDocument();
    expect(screen.getByText(/Step 1: do X/)).toBeInTheDocument();
    expect(screen.getByText(/Step 2: do Y/)).toBeInTheDocument();
    expect(screen.getByText("Approve plan")).toBeInTheDocument();
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("Reject plan")).toBeInTheDocument();
  });

  it("calls approvePlan on approve button click", () => {
    const approvePlan = vi.fn();
    render(
      <ChatPanel
        mission={makeMission({
          approvePlan,
          agenticRun: {
            runId: "run-9",
            status: "running",
            phase: "plan_review",
            resumable: false,
            plan: { planContent: "Plan", questions: [] },
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Approve plan"));
    expect(approvePlan).toHaveBeenCalledWith("run-9");
  });

  it("opens refine input and submits feedback", () => {
    const refinePlan = vi.fn();
    render(
      <ChatPanel
        mission={makeMission({
          refinePlan,
          agenticRun: {
            runId: "run-10",
            status: "running",
            phase: "plan_review",
            resumable: false,
            plan: { planContent: "Plan", questions: [] },
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Request changes"));
    const textarea = screen.getByPlaceholderText("What should change in the plan?");
    fireEvent.change(textarea, { target: { value: "Add error handling" } });
    fireEvent.click(screen.getByText("Submit"));
    expect(refinePlan).toHaveBeenCalledWith("run-10", "Add error handling");
  });

  it("does not submit refine when input is empty", () => {
    const refinePlan = vi.fn();
    render(
      <ChatPanel
        mission={makeMission({
          refinePlan,
          agenticRun: {
            runId: "run-10b",
            status: "running",
            phase: "plan_review",
            resumable: false,
            plan: { planContent: "Plan", questions: [] },
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Request changes"));
    // Submit with empty input
    fireEvent.click(screen.getByText("Submit"));
    expect(refinePlan).not.toHaveBeenCalled();
  });

  it("cancels refine input", () => {
    render(
      <ChatPanel
        mission={makeMission({
          agenticRun: {
            runId: "run-11",
            status: "running",
            phase: "plan_review",
            resumable: false,
            plan: { planContent: "Plan", questions: [] },
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Request changes"));
    expect(screen.getByPlaceholderText("What should change in the plan?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByPlaceholderText("What should change in the plan?")).not.toBeInTheDocument();
  });

  it("opens reject input and submits rejection", () => {
    const rejectPlan = vi.fn();
    render(
      <ChatPanel
        mission={makeMission({
          rejectPlan,
          agenticRun: {
            runId: "run-12",
            status: "running",
            phase: "plan_review",
            resumable: false,
            plan: { planContent: "Plan", questions: [] },
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Reject plan"));
    const textarea = screen.getByPlaceholderText("Why are you rejecting this plan?");
    fireEvent.change(textarea, { target: { value: "Wrong approach" } });
    // There are two Submit buttons (refine + reject), click the one in reject section
    const submitButtons = screen.getAllByText("Submit");
    fireEvent.click(submitButtons[submitButtons.length - 1]);
    expect(rejectPlan).toHaveBeenCalledWith("run-12", "Wrong approach");
  });

  it("does not submit reject when input is empty", () => {
    const rejectPlan = vi.fn();
    render(
      <ChatPanel
        mission={makeMission({
          rejectPlan,
          agenticRun: {
            runId: "run-12b",
            status: "running",
            phase: "plan_review",
            resumable: false,
            plan: { planContent: "Plan", questions: [] },
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Reject plan"));
    const submitButtons = screen.getAllByText("Submit");
    fireEvent.click(submitButtons[submitButtons.length - 1]);
    expect(rejectPlan).not.toHaveBeenCalled();
  });

  it("cancels reject input", () => {
    render(
      <ChatPanel
        mission={makeMission({
          agenticRun: {
            runId: "run-13",
            status: "running",
            phase: "plan_review",
            resumable: false,
            plan: { planContent: "Plan", questions: [] },
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Reject plan"));
    expect(screen.getByPlaceholderText("Why are you rejecting this plan?")).toBeInTheDocument();
    const cancelButtons = screen.getAllByText("Cancel");
    fireEvent.click(cancelButtons[cancelButtons.length - 1]);
    expect(screen.queryByPlaceholderText("Why are you rejecting this plan?")).not.toBeInTheDocument();
  });

  // --- Planning questions ---
  it("renders planning questions when phase is planning with unanswered questions", () => {
    render(
      <ChatPanel
        mission={makeMission({
          answerPlanQuestion: vi.fn(),
          agenticRun: {
            runId: "run-14",
            status: "running",
            phase: "planning",
            resumable: false,
            plan: {
              planContent: null,
              questions: [
                { id: "q1", question: "What framework?", answer: null },
                { id: "q2", question: "Which DB?", answer: "postgres" },
              ],
            },
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.getByText("Planning Questions")).toBeInTheDocument();
    expect(screen.getByText("What framework?")).toBeInTheDocument();
    // Already answered question should not be displayed
    expect(screen.queryByText("Which DB?")).not.toBeInTheDocument();
  });

  it("opens answer input and submits answer", () => {
    const answerPlanQuestion = vi.fn();
    render(
      <ChatPanel
        mission={makeMission({
          answerPlanQuestion,
          agenticRun: {
            runId: "run-15",
            status: "running",
            phase: "planning",
            resumable: false,
            plan: {
              planContent: null,
              questions: [
                { id: "q1", question: "What framework?", answer: null },
              ],
            },
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Answer"));
    const textarea = screen.getByPlaceholderText("Enter your answer");
    fireEvent.change(textarea, { target: { value: "React" } });
    fireEvent.click(screen.getByText("Submit"));
    expect(answerPlanQuestion).toHaveBeenCalledWith("run-15", "q1", "React");
  });

  it("does not submit answer when input is empty", () => {
    const answerPlanQuestion = vi.fn();
    render(
      <ChatPanel
        mission={makeMission({
          answerPlanQuestion,
          agenticRun: {
            runId: "run-15b",
            status: "running",
            phase: "planning",
            resumable: false,
            plan: {
              planContent: null,
              questions: [
                { id: "q1", question: "What framework?", answer: null },
              ],
            },
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Answer"));
    fireEvent.click(screen.getByText("Submit"));
    expect(answerPlanQuestion).not.toHaveBeenCalled();
  });

  it("cancels answer input", () => {
    render(
      <ChatPanel
        mission={makeMission({
          agenticRun: {
            runId: "run-16",
            status: "running",
            phase: "planning",
            resumable: false,
            plan: {
              planContent: null,
              questions: [
                { id: "q1", question: "What framework?", answer: null },
              ],
            },
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Answer"));
    expect(screen.getByPlaceholderText("Enter your answer")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByPlaceholderText("Enter your answer")).not.toBeInTheDocument();
  });

  it("does not render planning questions when all are answered", () => {
    render(
      <ChatPanel
        mission={makeMission({
          agenticRun: {
            runId: "run-17",
            status: "running",
            phase: "planning",
            resumable: false,
            plan: {
              planContent: null,
              questions: [
                { id: "q1", question: "What?", answer: "React" },
              ],
            },
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.queryByText("Planning Questions")).not.toBeInTheDocument();
  });

  it("does not render agentic run section when agenticRun is null", () => {
    render(
      <ChatPanel
        mission={makeMission({ agenticRun: null }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.queryByText("Agentic Run")).not.toBeInTheDocument();
  });

  it("plan_review without planContent does not show pre block", () => {
    render(
      <ChatPanel
        mission={makeMission({
          agenticRun: {
            runId: "run-18",
            status: "running",
            phase: "plan_review",
            resumable: false,
            plan: { planContent: null, questions: [] },
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.getByText("Plan Review")).toBeInTheDocument();
    // No pre element since planContent is null
    expect(document.querySelector("pre")).not.toBeInTheDocument();
  });

  it("shows ok chip for completed agentic run and warn chip for running", () => {
    const { rerender } = render(
      <ChatPanel
        mission={makeMission({
          agenticRun: {
            runId: "run-19",
            status: "completed",
            phase: "done",
            resumable: false,
            plan: null,
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.getByText("completed")).toBeInTheDocument();

    rerender(
      <ChatPanel
        mission={makeMission({
          agenticRun: {
            runId: "run-20",
            status: "running",
            phase: "execution",
            resumable: false,
            plan: null,
          },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("uses default 0.68 confidence when route metadata and contextPack have no confidence", () => {
    render(
      <ChatPanel
        mission={makeMission({
          input: "task",
          route: { executionMode: "single_agent", modelRole: "coder_default", providerId: "onprem-qwen", metadata: {} },
          contextPack: { files: [], tests: [], docs: [] },
          selectedExecutionProfile: { id: "balanced", name: "Balanced" },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.getByText(/Plan ready · 68% · Balanced/)).toBeInTheDocument();
  });

  it("uses 0.38 default confidence for contextPack-only route summary", () => {
    render(
      <ChatPanel
        mission={makeMission({
          input: "task",
          contextPack: { files: [], tests: [], docs: [] },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    expect(screen.getByText(/Context ready · 38%/)).toBeInTheDocument();
  });

  it("renders context-only summary expanded without route chips", () => {
    render(
      <ChatPanel
        mission={makeMission({
          input: "task",
          contextPack: { confidence: 0.5, files: ["a.ts"], tests: [], docs: [] },
        }) as never}
        attentionCount={0}
        onOpenCodebaseScope={vi.fn()}
        onOpenApprovals={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText(/Context ready/));
    // Should show file counts but no route-specific chips
    expect(screen.getByText("1 files")).toBeInTheDocument();
    expect(screen.queryByText(/Single Agent/)).not.toBeInTheDocument();
  });
});

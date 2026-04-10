import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatPanel } from "./ChatPanel";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { item: null } }),
}));

vi.mock("../agentic", () => ({
  AgenticRunDeepPanel: () => <div data-testid="agentic-deep-panel" />,
  RunReplayPanel: () => <div data-testid="run-replay-panel" />,
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
});

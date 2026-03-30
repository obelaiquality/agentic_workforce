import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandCenterView } from "./CommandCenterView";
import { useUiStore } from "../../store/uiStore";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { item: null } }),
}));

vi.mock("react-dnd", () => ({
  DndProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDrag: () => [{ isDragging: false }, () => {}],
  useDrop: () => [{ isOver: false, canDrop: false }, () => {}],
}));

vi.mock("react-dnd-html5-backend", () => ({
  HTML5Backend: {},
}));

vi.mock("../mission/OutcomeDebriefDrawer", () => ({
  OutcomeDebriefDrawer: () => (
    <section>
      <h2>Outcome summary</h2>
    </section>
  ),
}));

function makeMission(overrides: Record<string, unknown> = {}) {
  return {
    selectedRepo: null,
    selectedTicket: null,
    recentRepos: [],
    recentRepoPaths: [],
    activateRepo: vi.fn(),
    connectRecentPath: vi.fn(),
    openProjects: vi.fn(),
    appMode: "desktop",
    appModeNotice: null,
    workflowCards: [],
    workflowPillars: [],
    pendingApprovals: [],
    timeline: [],
    contextPack: null,
    input: "",
    setInput: vi.fn(),
    isExecuting: false,
    isReviewing: false,
    reviewRoute: vi.fn(),
    executeRoute: vi.fn(),
    route: null,
    selectedExecutionProfileId: "balanced",
    selectedExecutionProfile: { id: "balanced", name: "Balanced" },
    executionProfiles: {
      activeProfileId: "balanced",
      profiles: [{ id: "balanced", name: "Balanced" }],
    },
    setExecutionProfile: vi.fn(),
    isUpdatingExecutionProfile: false,
    isActing: false,
    actionMessage: null,
    moveWorkflow: vi.fn(),
    addTaskComment: vi.fn(),
    isCommenting: false,
    ticketLifecycleNotices: {},
    runSummary: null,
    verification: null,
    shareReport: null,
    blueprint: null,
    setSelectedTicketId: vi.fn(),
    experimentalAutonomy: { channels: [], subagents: [] },
    refreshSnapshot: vi.fn(),
    ...overrides,
  };
}

describe("CommandCenterView", () => {
  beforeEach(() => {
    useUiStore.setState({
      selectedWorkflowId: null,
      selectedWorkflowStatus: "all",
      workflowViewMode: "board",
      commandDrawerMode: "overseer",
      activeSection: "live",
      codebaseScope: "all",
    });
  });

  it("shows the new Work empty state without the composer when no project is active", () => {
    render(
      <CommandCenterView
        mission={makeMission({
          recentRepos: [{ id: "repo-1", displayName: "Agentic Workforce", branch: "main", defaultBranch: "main" }],
          appMode: "limited_preview",
          appModeNotice: {
            title: "Preview mode",
            message: "Desktop features are unavailable in browser preview.",
            detail: "Open the desktop app to connect a local repo.",
          },
        }) as never}
      />
    );

    expect(screen.getByRole("heading", { name: "Welcome to Agentic Workforce" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect a repo/ })).toBeInTheDocument();
    expect(screen.getByText("Agentic Workforce")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Describe the task" })).not.toBeInTheDocument();
  });

  it("renders the Work surface in composer, board, outcome order", () => {
    render(
      <CommandCenterView
        mission={makeMission({
          selectedRepo: { id: "repo-1", displayName: "Agentic Workforce", branch: "main", defaultBranch: "main" },
          contextPack: { files: ["src/app/App.tsx"], tests: ["src/app/App.test.tsx"], docs: ["README.md"], confidence: 0.82 },
          input: "Simplify first-run UX",
          route: { executionMode: "single_agent", modelRole: "coder_default", metadata: { confidence: 0.87 }, providerId: "onprem-qwen" },
          runSummary: { status: "completed" },
        }) as never}
      />
    );

    const taskHeading = screen.getByRole("heading", { name: "Describe the task" });
    const boardHeading = screen.getByText("Task Board");
    const outcomeHeading = screen.getByRole("heading", { name: "Outcome summary" });

    expect(taskHeading.compareDocumentPosition(boardHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(boardHeading.compareDocumentPosition(outcomeHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("How this works")).not.toBeInTheDocument();
    expect(screen.queryByText("Prompt starters")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Describe the next change...")).toBeInTheDocument();
  });

  it("removes persistent onboarding helpers from the active project composer", () => {
    render(
      <CommandCenterView
        mission={makeMission({
          selectedRepo: { id: "repo-1", displayName: "Agentic Workforce", branch: "main", defaultBranch: "main" },
          input: "",
          route: null,
        }) as never}
      />
    );

    expect(screen.queryByText("How this works")).not.toBeInTheDocument();
    expect(screen.queryByText("Prompt starters")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a status badge component with tests" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename the hero headline and update the test" })).not.toBeInTheDocument();
  });

  it("shows a stable blank-project layout without duplicate review-plan actions", () => {
    render(
      <CommandCenterView
        mission={makeMission({
          selectedRepo: { id: "repo-blank", displayName: "Blank Repo", branch: "main", defaultBranch: "main" },
          activeProjectIsBlank: true,
          input: "Plan the architecture for a new Python CLI from scratch",
          contextPack: null,
          route: null,
        }) as never}
      />
    );

    expect(screen.getByPlaceholderText("Describe what you want to build...")).toBeInTheDocument();
    expect(screen.queryByText("How this works")).not.toBeInTheDocument();
    expect(screen.queryByText("Prompt starters")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Review plan" })).toHaveLength(1);
  });
});

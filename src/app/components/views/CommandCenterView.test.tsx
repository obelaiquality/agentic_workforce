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

    expect(screen.getByRole("heading", { name: "Choose a project before you start a task" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Projects" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen Agentic Workforce" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Describe the task" })).not.toBeInTheDocument();
  });

  it("renders the Work surface in composer, review, board, outcome order", () => {
    render(
      <CommandCenterView
        mission={makeMission({
          selectedRepo: { id: "repo-1", displayName: "Agentic Workforce", branch: "main", defaultBranch: "main" },
          contextPack: { files: ["src/app/App.tsx"], tests: ["src/app/App.test.tsx"], docs: ["README.md"], confidence: 0.82 },
          input: "Simplify first-run UX",
          route: { executionMode: "single_agent", modelRole: "coder_default", metadata: { confidence: 0.87 } },
          runSummary: { status: "completed" },
        }) as never}
      />
    );

    const taskHeading = screen.getByRole("heading", { name: "Describe the task" });
    const reviewHeading = screen.getByText("Review the Plan");
    const boardHeading = screen.getByText("Task Board");
    const outcomeHeading = screen.getByRole("heading", { name: "Outcome summary" });

    expect(taskHeading.compareDocumentPosition(reviewHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reviewHeading.compareDocumentPosition(boardHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(boardHeading.compareDocumentPosition(outcomeHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("How this works")).toBeInTheDocument();
    expect(screen.getByText("Good first prompts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a status badge component with tests" })).toBeInTheDocument();
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

    expect(screen.getByText("This repo is still blank. Describe what you want to build, and we will help shape the initial structure before implementation starts.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create the initial README and repo charter for this project" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plan the architecture for a new Python CLI from scratch" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Review plan" })).toHaveLength(1);
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: null }),
}));

vi.mock("../../store/uiStore", () => ({
  useUiStore: Object.assign(
    vi.fn((selector: (state: any) => any) =>
      selector({
        selectedWorkflowId: null,
        selectedWorkflowStatus: "all",
        workflowViewMode: "board",
        commandDrawerMode: "overseer",
        setSelectedWorkflowId: vi.fn(),
        setSelectedWorkflowStatus: vi.fn(),
        setWorkflowViewMode: vi.fn(),
        setCommandDrawerMode: vi.fn(),
        setActiveSection: vi.fn(),
        setCodebaseScope: vi.fn(),
      })
    ),
    { getState: vi.fn(() => ({})), setState: vi.fn() }
  ),
}));

vi.mock("../../lib/apiClient", () => ({
  getMissionTaskDetailV8: vi.fn(),
}));

vi.mock("../ui/utils", () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(" "),
}));

vi.mock("../mission/MissionHeaderStrip", () => ({
  MissionHeaderStrip: () => <div data-testid="mission-header-strip" />,
}));

vi.mock("../mission/OutcomeDebriefDrawer", () => ({
  OutcomeDebriefDrawer: () => <div data-testid="outcome-debrief-drawer" />,
}));

vi.mock("./ChatPanel", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));

vi.mock("./WorkflowBoard", () => ({
  WorkflowBoard: () => <div data-testid="workflow-board" />,
}));

vi.mock("./AgentStatusSidebar", () => ({
  AgentStatusSidebar: () => <div data-testid="agent-sidebar" />,
}));

vi.mock("./ToolCallTimeline", () => ({
  ToolCallTimeline: () => <div data-testid="tool-timeline" />,
}));

vi.mock("./DiffViewer", () => ({
  DiffViewer: () => <div data-testid="diff-viewer" />,
}));

vi.mock("./ApprovalInline", () => ({
  ApprovalInline: (props: any) => <div data-testid="approval-inline" />,
  SmallMetric: () => <div data-testid="small-metric" />,
  DetailBlock: () => <div data-testid="detail-block" />,
  ProofCard: () => <div data-testid="proof-card" />,
}));

function makeMission(overrides: Record<string, unknown> = {}) {
  return {
    selectedRepo: {
      id: "repo-1",
      displayName: "Test Repo",
      branch: "main",
      defaultBranch: "main",
    },
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
    stopExecution: vi.fn(),
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
    liveState: null,
    runSummary: null,
    verification: null,
    shareReport: null,
    blueprint: null,
    actionCapabilities: {
      canRefresh: false,
      canStop: false,
      canReview: false,
      canExecute: false,
    },
    lastUpdatedAt: null,
    workflowCards: [],
    workflowPillars: [],
    setSelectedTicketId: vi.fn(),
    experimentalAutonomy: { channels: [], subagents: [] },
    recentRepos: [],
    recentRepoPaths: [],
    activateRepo: vi.fn(),
    connectRecentPath: vi.fn(),
    openProjects: vi.fn(),
    appMode: "desktop",
    appModeNotice: null,
    ...overrides,
  };
}

describe("CommandCenterView barrel re-exports", () => {
  it("re-exports ChatPanel", async () => {
    const mod = await import("./index");
    expect(mod.ChatPanel).toBeDefined();
  });

  it("re-exports WorkflowBoard", async () => {
    const mod = await import("./index");
    expect(mod.WorkflowBoard).toBeDefined();
  });

  it("re-exports AgentStatusSidebar", async () => {
    const mod = await import("./index");
    expect(mod.AgentStatusSidebar).toBeDefined();
  });

  it("re-exports SmallMetric, DetailBlock, ProofCard", async () => {
    const mod = await import("./index");
    expect(mod.SmallMetric).toBeDefined();
    expect(mod.DetailBlock).toBeDefined();
    expect(mod.ProofCard).toBeDefined();
  });

  it("re-exports ToolCallTimeline and DiffViewer", async () => {
    const mod = await import("./index");
    expect(mod.ToolCallTimeline).toBeDefined();
    expect(mod.DiffViewer).toBeDefined();
  });
});

describe("CommandCenterView", () => {
  it("renders without crash with a selected repo", async () => {
    const { CommandCenterView } = await import("./index");
    const mission = makeMission();
    render(<CommandCenterView mission={mission as never} />);
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    expect(screen.getByTestId("workflow-board")).toBeInTheDocument();
  });

  it("renders ApprovalInline when no repo is selected", async () => {
    const { CommandCenterView } = await import("./index");
    const mission = makeMission({ selectedRepo: null });
    render(<CommandCenterView mission={mission as never} />);
    expect(screen.getByTestId("approval-inline")).toBeInTheDocument();
  });

  it("renders MissionHeaderStrip when repo is selected", async () => {
    const { CommandCenterView } = await import("./index");
    const mission = makeMission();
    render(<CommandCenterView mission={mission as never} />);
    expect(screen.getByTestId("mission-header-strip")).toBeInTheDocument();
  });

  it("renders AgentStatusSidebar when experimental autonomy has channels", async () => {
    const { CommandCenterView } = await import("./index");
    const mission = makeMission({
      experimentalAutonomy: {
        channels: [{ id: "ch-1", source: "webhook" }],
        subagents: [],
      },
    });
    render(<CommandCenterView mission={mission as never} />);
    expect(screen.getByTestId("agent-sidebar")).toBeInTheDocument();
  });

  it("renders AgentStatusSidebar when experimental autonomy has subagents", async () => {
    const { CommandCenterView } = await import("./index");
    const mission = makeMission({
      experimentalAutonomy: {
        channels: [],
        subagents: [{ id: "sa-1", role: "coder" }],
      },
    });
    render(<CommandCenterView mission={mission as never} />);
    expect(screen.getByTestId("agent-sidebar")).toBeInTheDocument();
  });

  it("does not render AgentStatusSidebar when no autonomy activity", async () => {
    const { CommandCenterView } = await import("./index");
    const mission = makeMission({
      experimentalAutonomy: { channels: [], subagents: [] },
    });
    render(<CommandCenterView mission={mission as never} />);
    expect(screen.queryByTestId("agent-sidebar")).not.toBeInTheDocument();
  });

  it("renders OutcomeDebriefDrawer when verification is present", async () => {
    const { CommandCenterView } = await import("./index");
    const mission = makeMission({
      verification: { passed: true },
    });
    render(<CommandCenterView mission={mission as never} />);
    expect(screen.getByTestId("outcome-debrief-drawer")).toBeInTheDocument();
  });

  it("renders OutcomeDebriefDrawer when shareReport summary is present", async () => {
    const { CommandCenterView } = await import("./index");
    const mission = makeMission({
      shareReport: { summary: "Task completed successfully" },
    });
    render(<CommandCenterView mission={mission as never} />);
    expect(screen.getByTestId("outcome-debrief-drawer")).toBeInTheDocument();
  });

  it("renders OutcomeDebriefDrawer when runSummary has non-idle status", async () => {
    const { CommandCenterView } = await import("./index");
    const mission = makeMission({
      runSummary: { status: "completed" },
    });
    render(<CommandCenterView mission={mission as never} />);
    expect(screen.getByTestId("outcome-debrief-drawer")).toBeInTheDocument();
  });

  it("does not render OutcomeDebriefDrawer for idle runSummary", async () => {
    const { CommandCenterView } = await import("./index");
    const mission = makeMission({
      runSummary: { status: "idle" },
    });
    render(<CommandCenterView mission={mission as never} />);
    expect(screen.queryByTestId("outcome-debrief-drawer")).not.toBeInTheDocument();
  });

  it("does not render OutcomeDebriefDrawer for planned runSummary", async () => {
    const { CommandCenterView } = await import("./index");
    const mission = makeMission({
      runSummary: { status: "planned" },
    });
    render(<CommandCenterView mission={mission as never} />);
    expect(screen.queryByTestId("outcome-debrief-drawer")).not.toBeInTheDocument();
  });
});

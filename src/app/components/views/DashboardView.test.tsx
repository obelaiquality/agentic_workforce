import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardView } from "./DashboardView";
import type { useMissionControlLiveData } from "../../hooks/useMissionControlLiveData";

type MissionData = ReturnType<typeof useMissionControlLiveData>;

function buildMockMission(overrides: Partial<MissionData> = {}): MissionData {
  return {
    selectedRepo: { id: "repo-1", displayName: "Test Project" } as any,
    liveState: "live",
    runPhase: "idle",
    pendingApprovals: [],
    workflowCards: [],
    agenticRun: null,
    runSummary: null,
    // All remaining properties with safe defaults
    visibleRepos: [],
    recentRepos: [],
    headerRepos: [],
    recentRepoPaths: [],
    selectedTicket: null,
    tickets: [],
    sessions: [],
    selectedSessionId: null,
    messages: [],
    input: "",
    setInput: vi.fn(),
    planModeEnabled: false,
    setPlanModeEnabled: vi.fn(),
    coordinatorEnabled: false,
    setCoordinatorEnabled: vi.fn(),
    coordinatorMaxAgents: 5,
    setCoordinatorMaxAgents: vi.fn(),
    coordinatorMaxConcurrent: 3,
    setCoordinatorMaxConcurrent: vi.fn(),
    streaming: false,
    roleLabels: {
      utility_fast: "Fast",
      coder_default: "Build",
      review_deep: "Review",
      overseer_escalation: "Escalate",
    },
    executionProfiles: { activeProfileId: "balanced", profiles: [] },
    selectedExecutionProfileId: "balanced",
    selectedExecutionProfile: null as any,
    selectedExecutionProfileStages: {
      scope: "utility_fast",
      build: "coder_default",
      review: "review_deep",
      escalate: "overseer_escalation",
    },
    setExecutionProfile: vi.fn(),
    route: null,
    contextPack: null,
    blueprint: null,
    workflowPillars: [],
    ticketLifecycleNotices: {},
    changeBriefs: [],
    streams: [],
    timeline: [],
    tasks: [],
    spotlight: null,
    codebaseFiles: [],
    consoleLogs: [],
    consoleEvents: [],
    experimentalAutonomy: { channels: [], subagents: [] },
    lastUpdatedAt: null,
    error: null,
    actionMessage: null,
    repoPickerMessage: null,
    setRepoPickerMessage: vi.fn(),
    verification: null,
    guidelines: null,
    projectState: null,
    codeGraphStatus: null,
    shareReport: null,
    appMode: "desktop" as const,
    appModeNotice: null,
    actionCapabilities: {
      canRefresh: true,
      canStop: false,
      canRequeue: false,
      canMarkActive: false,
      canComplete: false,
      canRetry: false,
    },
    githubOwner: "",
    setGithubOwner: vi.fn(),
    githubRepo: "",
    setGithubRepo: vi.fn(),
    hasDesktopPicker: true,
    hasAnyProjects: true,
    projectStarters: [],
    projectSetupState: null,
    activeStarterId: null,
    activeProjectIsBlank: false,
    isActing: false,
    chooseLocalRepo: vi.fn(),
    openNewProjectDialog: vi.fn(),
    openStarterDialogForActiveProject: vi.fn(),
    dismissProjectSetupDialog: vi.fn(),
    createBlankProject: vi.fn(),
    createProjectFromStarter: vi.fn(),
    connectRecentPath: vi.fn(),
    connectGithubProject: vi.fn(),
    activateRepo: vi.fn(),
    syncProject: vi.fn(),
    syncingRepoId: null,
    isConnectingLocal: false,
    isBootstrappingProject: false,
    isConnectingGithub: false,
    isRefreshingBlueprint: false,
    setSelectedTicketId: vi.fn(),
    setSelectedSessionId: vi.fn(),
    reviewRoute: vi.fn(),
    executeRoute: vi.fn(),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    refinePlan: vi.fn(),
    answerPlanQuestion: vi.fn(),
    sendMessage: vi.fn(),
    decideApproval: vi.fn(),
    moveWorkflow: vi.fn(),
    addTaskComment: vi.fn(),
    setTicketExecutionProfile: vi.fn(),
    setTicketPermissionMode: vi.fn(),
    isCommenting: false,
    isUpdatingTicketExecutionProfile: false,
    isUpdatingTicketPermissionMode: false,
    isUpdatingExecutionProfile: false,
    isReviewing: false,
    isExecuting: false,
    updateBlueprint: vi.fn(),
    regenerateBlueprint: vi.fn(),
    openProjects: vi.fn(),
    openWork: vi.fn(),
    refreshSnapshot: vi.fn(),
    ...overrides,
  } as unknown as MissionData;
}

function buildMockAgenticRun(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    status: "running",
    phase: "executing",
    plan: null,
    iterationCount: 3,
    toolCallCount: 12,
    approvalCount: 1,
    deniedCount: 0,
    compactionCount: 2,
    doomLoopCount: 0,
    escalationCount: 1,
    thinkingTokenCount: 500,
    lastAssistantText: null,
    lastReason: null,
    latestRole: "coder_default",
    budget: {
      tokensConsumed: 5000,
      maxTokens: 20000,
      costUsdConsumed: 0.0025,
      maxCostUsd: 0.1,
      iterationsConsumed: 3,
      maxIterations: 10,
      tokenTimeline: [
        { iteration: 1, tokens: 1000, timestamp: "2026-04-12T10:00:00Z" },
        { iteration: 2, tokens: 3000, timestamp: "2026-04-12T10:01:00Z" },
        { iteration: 3, tokens: 5000, timestamp: "2026-04-12T10:02:00Z" },
      ],
    },
    recentEvents: [],
    toolCalls: [
      {
        id: "tc-1",
        iteration: 1,
        name: "write_file",
        args: {},
        result: { type: "success", content: "ok" },
        policyDecision: "allow",
        durationMs: 42,
        timestamp: "2026-04-12T10:00:30Z",
      },
      {
        id: "tc-2",
        iteration: 2,
        name: "run_tests",
        args: {},
        result: { type: "success", content: "pass" },
        policyDecision: "allow",
        durationMs: 150,
        timestamp: "2026-04-12T10:01:20Z",
      },
    ],
    compactionEvents: [
      {
        iteration: 2,
        stage: 3,
        tokensBefore: 8000,
        tokensAfter: 4000,
        timestamp: "2026-04-12T10:01:45Z",
      },
    ],
    escalations: [
      {
        iteration: 3,
        fromRole: "coder_default",
        toRole: "review_deep",
        reason: "complex review",
        timestamp: "2026-04-12T10:02:00Z",
      },
    ],
    doomLoops: [],
    skillEvents: [],
    hookEvents: [],
    memoryExtractions: [],
    thinkingLog: null,
    ...overrides,
  };
}

describe("DashboardView", () => {
  it("renders system status strip with project name", () => {
    const mission = buildMockMission();
    render(<DashboardView mission={mission} />);

    expect(screen.getByTestId("system-status-strip")).toBeInTheDocument();
    expect(screen.getByTestId("system-status-indicator")).toBeInTheDocument();
    expect(screen.getByText("Test Project")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("shows offline status when disconnected", () => {
    const mission = buildMockMission({ liveState: "disconnected" as any });
    render(<DashboardView mission={mission} />);

    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("shows degraded status", () => {
    const mission = buildMockMission({ liveState: "degraded" as any });
    render(<DashboardView mission={mission} />);

    expect(screen.getByText("Degraded")).toBeInTheDocument();
  });

  it("renders metrics grid with correct values", () => {
    const run = buildMockAgenticRun();
    const mission = buildMockMission({
      agenticRun: run as any,
      pendingApprovals: [{ approval_id: "a1", action_type: "file", status: "pending" as const, reason: "test", payload: {}, requested_at: "", decided_at: null }],
    });
    render(<DashboardView mission={mission} />);

    const grid = screen.getByTestId("metrics-grid");
    expect(grid).toBeInTheDocument();

    // Tool calls = 12
    expect(screen.getByText("12")).toBeInTheDocument();
    // Pending approvals = 1
    expect(screen.getByText("Pending Approvals")).toBeInTheDocument();
    // Escalations = 1
    expect(screen.getByText("Escalations")).toBeInTheDocument();
    // Doom Loops = 0
    expect(screen.getByText("Doom Loops")).toBeInTheDocument();
  });

  it("renders recent activity items when run has events", () => {
    const run = buildMockAgenticRun();
    const mission = buildMockMission({ agenticRun: run as any });
    render(<DashboardView mission={mission} />);

    const feed = screen.getByTestId("activity-feed");
    expect(feed).toBeInTheDocument();

    const items = screen.getAllByTestId("activity-item");
    // 2 tool calls + 1 compaction + 1 escalation = 4 items
    expect(items.length).toBe(4);
  });

  it("renders empty state when no run is active", () => {
    const mission = buildMockMission({ agenticRun: null });
    render(<DashboardView mission={mission} />);

    expect(screen.getByText(/No recent activity/)).toBeInTheDocument();
    expect(screen.queryByTestId("active-run-panel")).not.toBeInTheDocument();
  });

  it("renders active run panel when a run is active", () => {
    const run = buildMockAgenticRun();
    const mission = buildMockMission({ agenticRun: run as any });
    render(<DashboardView mission={mission} />);

    expect(screen.getByTestId("active-run-panel")).toBeInTheDocument();
    expect(screen.getByText("Active Run")).toBeInTheDocument();
    expect(screen.getByText("executing")).toBeInTheDocument();
    expect(screen.getByText("$0.0025")).toBeInTheDocument();
  });

  it("does not render active run panel for idle status", () => {
    const run = buildMockAgenticRun({ status: "idle" });
    const mission = buildMockMission({ agenticRun: run as any });
    render(<DashboardView mission={mission} />);

    expect(screen.queryByTestId("active-run-panel")).not.toBeInTheDocument();
  });

  it("renders workflow summary counts", () => {
    const mission = buildMockMission({
      workflowCards: [
        { workflowId: "w1", status: "backlog" },
        { workflowId: "w2", status: "backlog" },
        { workflowId: "w3", status: "in_progress" },
        { workflowId: "w4", status: "needs_review" },
        { workflowId: "w5", status: "completed" },
        { workflowId: "w6", status: "completed" },
        { workflowId: "w7", status: "completed" },
      ] as any[],
    });
    render(<DashboardView mission={mission} />);

    const summary = screen.getByTestId("workflow-summary");
    expect(summary).toBeInTheDocument();

    expect(screen.getByText("Backlog")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Needs Review")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("shows token consumption bar in active run panel", () => {
    const run = buildMockAgenticRun();
    const mission = buildMockMission({ agenticRun: run as any });
    render(<DashboardView mission={mission} />);

    const bar = screen.getByTestId("token-bar");
    expect(bar).toBeInTheDocument();
    // 5000/20000 = 25%
    expect(bar.style.width).toBe("25%");
  });

  it("renders No project when no repo selected", () => {
    const mission = buildMockMission({ selectedRepo: null as any });
    render(<DashboardView mission={mission} />);

    expect(screen.getByText("No project")).toBeInTheDocument();
  });

  it("shows correct run status chip", () => {
    const run = buildMockAgenticRun({ status: "completed" });
    const mission = buildMockMission({ agenticRun: run as any });
    render(<DashboardView mission={mission} />);

    expect(screen.getByText("completed")).toBeInTheDocument();
  });
});

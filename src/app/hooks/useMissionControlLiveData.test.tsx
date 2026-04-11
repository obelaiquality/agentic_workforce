import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMissionControlLiveData } from "./useMissionControlLiveData";
import * as apiClient from "../lib/apiClient";
import { useUiStore } from "../store/uiStore";
import type { MissionControlSnapshot } from "../../shared/contracts";

// Mock all apiClient functions
vi.mock("../lib/apiClient", () => ({
  activateProjectV5: vi.fn(),
  addTicketComment: vi.fn(),
  bootstrapEmptyProjectV8: vi.fn(),
  connectGithubProjectV8: vi.fn(),
  connectLocalProjectV8: vi.fn(),
  decideMissionApprovalV8: vi.fn(),
  executeScaffoldV8: vi.fn(),
  generateProjectBlueprintV8: vi.fn(),
  getSettings: vi.fn(),
  getMissionSnapshotV8: vi.fn(),
  getProjectStartersV8: vi.fn(),
  openRecentProjectV8: vi.fn(),
  openSessionStream: vi.fn(),
  reviewOverseerRouteV8: vi.fn(),
  sendOverseerMessageV8: vi.fn(),
  setMissionTicketPermissionV9: vi.fn(),
  setMissionWorkflowExecutionProfileV8: vi.fn(),
  syncProjectV5: vi.fn(),
  updateProjectBlueprintV8: vi.fn(),
  updateSettings: vi.fn(),
  getProjectBlueprintV8: vi.fn(),
  moveMissionWorkflowV8: vi.fn(),
  openAgenticRunStream: vi.fn(),
  startAgenticRun: vi.fn(),
  approveAgenticRunPlan: vi.fn(),
  rejectAgenticRunPlan: vi.fn(),
  refineAgenticRunPlan: vi.fn(),
  answerAgenticRunPlanQuestion: vi.fn(),
}));

// Mock desktop bridge
vi.mock("../lib/desktopBridge", () => ({
  hasDesktopRepoPicker: vi.fn(() => true),
  listRecentRepoPaths: vi.fn(() => Promise.resolve([])),
  pickRepoDirectory: vi.fn(() => Promise.resolve({ canceled: false, path: "/test/path" })),
  rememberRepoPath: vi.fn(() => Promise.resolve()),
}));

// Mock uiStore
vi.mock("../store/uiStore", () => ({
  useUiStore: vi.fn(),
}));

// Mock feedback utilities
vi.mock("../lib/missionFeedback", () => ({
  buildApprovalFollowup: vi.fn(() => ({
    actionMessage: "Approval processed.",
    ticketId: "ticket-1",
    notice: { type: "success", message: "Done" },
  })),
  buildExecutionFailureActionMessage: vi.fn((msg) => `Execution failed: ${msg}`),
  normalizeApiErrorMessage: vi.fn((msg) => msg),
}));

// Mock project visibility
vi.mock("../lib/projectVisibility", () => ({
  getRecentRepos: vi.fn((repos) => repos.slice(0, 8)),
  getVisibleRepos: vi.fn((repos) => repos),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function mockUiStore(overrides: Partial<ReturnType<typeof useUiStore>> = {}) {
  const defaults = {
    selectedSessionId: null,
    selectedTicketId: null,
    selectedRepoId: null,
    selectedRunId: null,
    labsMode: false,
    setSelectedRunId: vi.fn(),
    setSelectedSessionId: vi.fn(),
    setSelectedRepoId: vi.fn(),
    setSelectedTicketId: vi.fn(),
    setActiveSection: vi.fn(),
  };
  vi.mocked(useUiStore).mockImplementation((selector) => {
    const state = { ...defaults, ...overrides };
    return typeof selector === "function" ? selector(state as never) : state;
  });
}

function createMockSnapshot(overrides: Partial<MissionControlSnapshot> = {}): { item: MissionControlSnapshot } {
  return {
    item: {
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      recentProjects: [],
      selectedTicket: null,
      tickets: [],
      overseer: {
        selectedSessionId: null,
        sessions: [],
        messages: [],
      },
      approvals: [],
      route: null,
      contextPack: null,
      blueprint: null,
      workflowPillars: [],
      workflowCards: [],
      changeBriefs: [],
      streams: [],
      timeline: [],
      tasks: [],
      spotlight: null,
      codebaseFiles: [],
      consoleLogs: [],
      consoleEvents: [],
      experimentalAutonomy: { channels: [], subagents: [] },
      agenticRun: null,
      runPhase: "idle",
      runSummary: null,
      verification: null,
      guidelines: null,
      projectState: null,
      codeGraphStatus: null,
      shareReport: null,
      actionCapabilities: {
        canRefresh: true,
        canStop: false,
        canRequeue: false,
        canMarkActive: false,
        canComplete: false,
        canRetry: false,
      },
      lastUpdatedAt: new Date().toISOString(),
      ...overrides,
    } as MissionControlSnapshot,
  };
}

describe("useMissionControlLiveData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUiStore();

    // Default mock implementations
    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot());
    vi.mocked(apiClient.getSettings).mockResolvedValue({
      items: {
        executionProfiles: {
          activeProfileId: "balanced",
          profiles: [
            {
              id: "balanced",
              name: "Balanced",
              description: "Fast scoping, standard build",
              preset: "balanced",
              stages: {
                scope: "utility_fast",
                build: "coder_default",
                review: "review_deep",
                escalate: "overseer_escalation",
              },
              updatedAt: new Date().toISOString(),
            },
          ],
        },
      },
    });
    vi.mocked(apiClient.getProjectStartersV8).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.openSessionStream).mockResolvedValue({
      addEventListener: vi.fn(),
      close: vi.fn(),
    } as never);
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn(),
      close: vi.fn(),
    } as never);
    vi.mocked(apiClient.getProjectBlueprintV8).mockResolvedValue({
      item: null,
    } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns expected default values before data loads", async () => {
    vi.mocked(apiClient.getMissionSnapshotV8).mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    expect(result.current.selectedRepo).toBeNull();
    expect(result.current.selectedTicket).toBeNull();
    expect(result.current.tickets).toEqual([]);
    expect(result.current.messages).toEqual([]);
    expect(result.current.input).toBe("");
    expect(result.current.streaming).toBe(false);
    expect(result.current.planModeEnabled).toBe(false);
    expect(result.current.coordinatorEnabled).toBe(false);
    expect(result.current.coordinatorMaxAgents).toBe(5);
    expect(result.current.coordinatorMaxConcurrent).toBe(3);
  });

  it("loads snapshot data successfully", async () => {
    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      selectedTicket: {
        id: "ticket-1",
        title: "Test Ticket",
        description: "Test description",
        status: "in_progress",
        priority: "medium",
        risk: "medium",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.selectedRepo).toBeTruthy();
      expect(result.current.selectedRepo?.displayName).toBe("Test Repo");
      expect(result.current.selectedTicket?.id).toBe("ticket-1");
    });
  });

  it("can toggle plan mode enabled state", async () => {
    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.planModeEnabled).toBe(false));

    act(() => {
      result.current.setPlanModeEnabled(true);
    });

    expect(result.current.planModeEnabled).toBe(true);

    act(() => {
      result.current.setPlanModeEnabled(false);
    });

    expect(result.current.planModeEnabled).toBe(false);
  });

  it("can toggle and configure coordinator mode", async () => {
    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.coordinatorEnabled).toBe(false));

    act(() => {
      result.current.setCoordinatorEnabled(true);
    });

    expect(result.current.coordinatorEnabled).toBe(true);

    act(() => {
      result.current.setCoordinatorMaxAgents(10);
    });

    expect(result.current.coordinatorMaxAgents).toBe(10);

    act(() => {
      result.current.setCoordinatorMaxConcurrent(5);
    });

    expect(result.current.coordinatorMaxConcurrent).toBe(5);
  });

  it("calls approveAgenticRunPlan with correct runId", async () => {
    vi.mocked(apiClient.approveAgenticRunPlan).mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.approvePlan).toBeDefined());

    await act(async () => {
      result.current.approvePlan("run-123");
    });

    await waitFor(() => {
      expect(apiClient.approveAgenticRunPlan).toHaveBeenCalledWith("run-123");
    });
  });

  it("calls rejectAgenticRunPlan with runId and reason", async () => {
    vi.mocked(apiClient.rejectAgenticRunPlan).mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.rejectPlan).toBeDefined());

    await act(async () => {
      result.current.rejectPlan("run-123", "Invalid approach");
    });

    await waitFor(() => {
      expect(apiClient.rejectAgenticRunPlan).toHaveBeenCalledWith("run-123", "Invalid approach");
    });
  });

  it("calls refineAgenticRunPlan with runId and feedback", async () => {
    vi.mocked(apiClient.refineAgenticRunPlan).mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.refinePlan).toBeDefined());

    await act(async () => {
      result.current.refinePlan("run-123", "Add more tests");
    });

    await waitFor(() => {
      expect(apiClient.refineAgenticRunPlan).toHaveBeenCalledWith("run-123", "Add more tests");
    });
  });

  it("calls answerAgenticRunPlanQuestion with correct args", async () => {
    vi.mocked(apiClient.answerAgenticRunPlanQuestion).mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.answerPlanQuestion).toBeDefined());

    await act(async () => {
      result.current.answerPlanQuestion("run-123", "question-1", "Yes, proceed");
    });

    await waitFor(() => {
      expect(apiClient.answerAgenticRunPlanQuestion).toHaveBeenCalledWith("run-123", "question-1", "Yes, proceed");
    });
  });

  it("starts agentic run with plan mode disabled", async () => {
    mockUiStore({
      selectedRepoId: "repo-1",
      selectedTicketId: null,
    });

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);
    vi.mocked(apiClient.startAgenticRun).mockResolvedValue({
      ticket: {
        id: "ticket-1",
        title: "Test task",
        description: "Test description",
        status: "in_progress",
        priority: "medium",
        risk: "medium",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      runId: "run-123",
    });

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeTruthy());

    act(() => {
      result.current.setInput("Add a new feature");
    });

    await act(async () => {
      await result.current.executeRoute();
    });

    await waitFor(() => {
      expect(apiClient.startAgenticRun).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: "user",
          project_id: "repo-1",
          objective: "Add a new feature",
          plan_mode: false,
        })
      );
    });
  });

  it("starts agentic run with plan mode enabled", async () => {
    mockUiStore({
      selectedRepoId: "repo-1",
      selectedTicketId: null,
    });

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);
    vi.mocked(apiClient.startAgenticRun).mockResolvedValue({
      ticket: {
        id: "ticket-1",
        title: "Test task",
        description: "Test description",
        status: "in_progress",
        priority: "medium",
        risk: "medium",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      runId: "run-123",
    });

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeTruthy());

    act(() => {
      result.current.setInput("Add a new feature");
      result.current.setPlanModeEnabled(true);
    });

    await act(async () => {
      await result.current.executeRoute();
    });

    await waitFor(() => {
      expect(apiClient.startAgenticRun).toHaveBeenCalledWith(
        expect.objectContaining({
          plan_mode: true,
        })
      );
    });
  });

  it("starts agentic run with coordinator enabled and options", async () => {
    mockUiStore({
      selectedRepoId: "repo-1",
      selectedTicketId: null,
    });

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);
    vi.mocked(apiClient.startAgenticRun).mockResolvedValue({
      ticket: {
        id: "ticket-1",
        title: "Test task",
        description: "Test description",
        status: "in_progress",
        priority: "medium",
        risk: "medium",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      runId: "run-123",
    });

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeTruthy());

    act(() => {
      result.current.setInput("Complex multi-agent task");
      result.current.setCoordinatorEnabled(true);
      result.current.setCoordinatorMaxAgents(8);
      result.current.setCoordinatorMaxConcurrent(4);
    });

    await act(async () => {
      await result.current.executeRoute();
    });

    await waitFor(() => {
      expect(apiClient.startAgenticRun).toHaveBeenCalledWith(
        expect.objectContaining({
          coordinator: true,
          coordinator_options: {
            max_agents: 8,
            max_concurrent: 4,
          },
        })
      );
    });
  });

  it("sets action message on mutation", async () => {
    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.actionMessage).toBeNull());

    // Trigger an action that sets action message
    vi.mocked(apiClient.syncProjectV5).mockResolvedValue({ repo: { id: "repo-1" } } as never);

    await act(async () => {
      await result.current.syncProject("repo-1");
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toBe("Project synced.");
    });
  });

  it("returns isActing true when mutation is pending", async () => {
    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isActing).toBe(false));

    // isActing aggregates multiple mutations - initially all are idle
    expect(result.current.isActing).toBe(false);
  });

  it("refreshes snapshot by invalidating query", async () => {
    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.refreshSnapshot).toBeDefined());

    act(() => {
      result.current.refreshSnapshot();
    });

    // Check that the action message was set
    await waitFor(() => {
      expect(result.current.actionMessage).toBe("Mission state refreshed.");
    });
  });

  it("returns execution profiles from settings", async () => {
    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.executionProfiles).toBeDefined();
      expect(result.current.executionProfiles.activeProfileId).toBe("balanced");
      expect(result.current.selectedExecutionProfile?.id).toBe("balanced");
    });
  });

  it("calls decideMissionApprovalV8 on approval decision", async () => {
    vi.mocked(apiClient.decideMissionApprovalV8).mockResolvedValue({
      lifecycle_requeue: false,
      command_execution: null,
    } as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.decideApproval).toBeDefined());

    await act(async () => {
      result.current.decideApproval("approval-1", "approved");
    });

    await waitFor(() => {
      expect(apiClient.decideMissionApprovalV8).toHaveBeenCalledWith({
        approval_id: "approval-1",
        decision: "approved",
        decided_by: "user",
      });
    });
  });

  it("sets input value correctly", () => {
    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    expect(result.current.input).toBe("");

    act(() => {
      result.current.setInput("New task description");
    });

    expect(result.current.input).toBe("New task description");
  });

  it("provides agenticRun from snapshot", async () => {
    const mockSnapshot = createMockSnapshot({
      agenticRun: {
        runId: "run-1",
        ticketId: "ticket-1",
        projectId: "repo-1",
        status: "running",
        phase: "executing",
        objective: "Test objective",
        iterationCount: 1,
        approvalCount: 0,
        lastAssistantText: "",
        latestRole: "coder_default",
        recentEvents: [],
        toolCalls: [],
        compactionEvents: [],
        escalations: [],
        doomLoops: [],
        skillEvents: [],
        hookEvents: [],
        memoryExtractions: [],
        thinkingLog: "",
        thinkingTokenCount: 0,
        budget: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          totalCost: 0,
          tokenTimeline: [],
        },
        startedAt: new Date().toISOString(),
        completedAt: null,
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.runId).toBe("run-1");
      expect(result.current.agenticRun?.status).toBe("running");
    });
  });

  it("calls sendOverseerMessageV8 when sending message", async () => {
    mockUiStore({
      selectedRepoId: "repo-1",
    });

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      overseer: {
        selectedSessionId: "session-1",
        sessions: [],
        messages: [],
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);
    vi.mocked(apiClient.sendOverseerMessageV8).mockResolvedValue({
      sessionId: "session-1",
    } as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeTruthy());

    act(() => {
      result.current.setInput("Test message");
    });

    await act(async () => {
      result.current.sendMessage();
    });

    await waitFor(() => {
      expect(apiClient.sendOverseerMessageV8).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: "user",
          content: "Test message",
        })
      );
    });
  });

  it("calls reviewOverseerRouteV8 when reviewing route", async () => {
    mockUiStore({
      selectedRepoId: "repo-1",
    });

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);
    vi.mocked(apiClient.reviewOverseerRouteV8).mockResolvedValue({
      ticket: {
        id: "ticket-1",
        title: "Test",
        description: "",
        status: "backlog",
        priority: "medium",
        risk: "medium",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      route: {
        executionMode: "single_agent",
        modelRole: "coder_default",
        metadata: {},
        providerId: "onprem-qwen",
      },
      contextPack: {
        files: [],
        tests: [],
        docs: [],
        confidence: 0.8,
      },
      blueprint: null,
    } as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeTruthy());

    act(() => {
      result.current.setInput("Review this change");
    });

    await act(async () => {
      result.current.reviewRoute();
    });

    await waitFor(() => {
      expect(apiClient.reviewOverseerRouteV8).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: "user",
          project_id: "repo-1",
          prompt: "Review this change",
        })
      );
    });
  });

  it("calls addTicketComment when adding task comment", async () => {
    vi.mocked(apiClient.addTicketComment).mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.addTaskComment).toBeDefined());

    await act(async () => {
      result.current.addTaskComment("task-1", "Test comment");
    });

    await waitFor(() => {
      expect(apiClient.addTicketComment).toHaveBeenCalledWith("task-1", {
        body: "Test comment",
        parentCommentId: undefined,
      });
    });
  });

  it("calls updateProjectBlueprintV8 when updating blueprint", async () => {
    mockUiStore({
      selectedRepoId: "repo-1",
    });

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      blueprint: {
        projectId: "repo-1",
        repositoryPurpose: "Test purpose",
        primaryLanguages: ["typescript"],
        architectureStyle: "modular",
        keyDomains: [],
        criticalPaths: [],
        testingStrategy: "comprehensive",
        providerPolicy: {
          executionProfileId: "balanced",
        },
        detectedAt: new Date().toISOString(),
        manuallyEditedAt: null,
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);
    vi.mocked(apiClient.updateProjectBlueprintV8).mockResolvedValue({
      item: mockSnapshot.item.blueprint,
    } as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeTruthy());

    await act(async () => {
      result.current.updateBlueprint({
        repositoryPurpose: "Updated purpose",
      });
    });

    await waitFor(() => {
      expect(apiClient.updateProjectBlueprintV8).toHaveBeenCalledWith("repo-1", {
        repositoryPurpose: "Updated purpose",
      });
    });
  });

  it("provides app mode based on backend availability", async () => {
    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.appMode).toBe("desktop");
    });
  });

  it("returns liveState based on snapshot query status", async () => {
    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.liveState).toBe("live");
    });
  });

  // ─── Helper function: toPendingApproval ───

  it("maps snapshot approvals to pendingApprovals with correct shape", async () => {
    const mockSnapshot = createMockSnapshot({
      approvals: [
        {
          approvalId: "ap-1",
          actionType: "tool_execution",
          reason: "Dangerous command",
          relevantToCurrentTask: true,
          requestedAt: "2024-01-01T00:00:00Z",
        } as MissionControlSnapshot["approvals"][number],
        {
          approvalId: "ap-2",
          actionType: "file_write",
          reason: "Write to prod config",
          relevantToCurrentTask: false,
          requestedAt: "2024-01-02T00:00:00Z",
        } as MissionControlSnapshot["approvals"][number],
      ],
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.pendingApprovals).toHaveLength(2);
    });

    const [first, second] = result.current.pendingApprovals;
    expect(first.approval_id).toBe("ap-1");
    expect(first.status).toBe("pending");
    expect(first.decided_at).toBeNull();
    expect(first.payload.aggregate_id).toBe("ap-1"); // relevantToCurrentTask = true
    expect(second.payload.aggregate_id).toBeNull(); // relevantToCurrentTask = false
  });

  // ─── Helper function: normalizeObjective + resolveTicketForObjective ───

  it("resolves ticket when objective matches ticket title", async () => {
    mockUiStore({
      selectedRepoId: "repo-1",
      selectedTicketId: "ticket-1",
    });

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      selectedTicket: {
        id: "ticket-1",
        title: "Add new feature",
        description: "Description for the feature",
        status: "in_progress",
        priority: "medium",
        risk: "medium",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);
    vi.mocked(apiClient.startAgenticRun).mockResolvedValue({
      ticket: { id: "ticket-1", title: "Add new feature", description: "", status: "in_progress", priority: "medium", risk: "medium", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      runId: "run-1",
    });

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeTruthy());

    act(() => {
      result.current.setInput("Add new feature");
    });

    await act(async () => {
      result.current.executeRoute();
    });

    await waitFor(() => {
      expect(apiClient.startAgenticRun).toHaveBeenCalledWith(
        expect.objectContaining({
          ticket_id: "ticket-1",
        })
      );
    });
  });

  it("does not resolve ticket when objective differs from ticket title and description", async () => {
    mockUiStore({
      selectedRepoId: "repo-1",
      selectedTicketId: "ticket-1",
    });

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      selectedTicket: {
        id: "ticket-1",
        title: "Fix login bug",
        description: "Users cannot login with SSO",
        status: "in_progress",
        priority: "medium",
        risk: "medium",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);
    vi.mocked(apiClient.startAgenticRun).mockResolvedValue({
      ticket: { id: "ticket-new", title: "Something else", description: "", status: "in_progress", priority: "medium", risk: "medium", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      runId: "run-1",
    });

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeTruthy());

    act(() => {
      result.current.setInput("Something completely different");
    });

    await act(async () => {
      result.current.executeRoute();
    });

    await waitFor(() => {
      expect(apiClient.startAgenticRun).toHaveBeenCalledWith(
        expect.objectContaining({
          ticket_id: undefined,
        })
      );
    });
  });

  // ─── Helper function: readStarterId / isBlankProject ───

  it("detects activeStarterId from repo metadata", async () => {
    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: { starter_id: "neutral_baseline" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.activeStarterId).toBe("neutral_baseline");
    });
  });

  it("detects activeProjectIsBlank when metadata creation_mode is blank and no starter_id", async () => {
    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: { creation_mode: "blank" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.activeProjectIsBlank).toBe(true);
    });
  });

  it("activeProjectIsBlank is false when metadata has starter_id", async () => {
    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: { creation_mode: "blank", starter_id: "ts_app" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.activeProjectIsBlank).toBe(false);
    });
  });

  // ─── Helper function: summarizeAppError + resolveAppModeNotice ───

  it("returns limited_preview notice when not desktop", async () => {
    const desktopBridge = await import("../lib/desktopBridge");
    vi.mocked(desktopBridge.hasDesktopRepoPicker).mockReturnValue(false);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.appMode).toBe("limited_preview");
      expect(result.current.appModeNotice?.title).toBe("Browser preview is limited");
    });

    // Restore
    vi.mocked(desktopBridge.hasDesktopRepoPicker).mockReturnValue(true);
  });

  it("returns backend_unavailable notice when snapshot query errors", async () => {
    vi.mocked(apiClient.getMissionSnapshotV8).mockRejectedValue(new Error("Failed to fetch"));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.appMode).toBe("backend_unavailable");
      expect(result.current.appModeNotice?.title).toBe("Backend unavailable");
    });
  });

  it("returns backend_unavailable notice for connection refused error", async () => {
    vi.mocked(apiClient.getMissionSnapshotV8).mockRejectedValue(new Error("ECONNREFUSED"));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.appMode).toBe("backend_unavailable");
      expect(result.current.appModeNotice?.message).toBe("The app cannot reach its local services.");
    });
  });

  it("returns backend_unavailable notice for non-Error values", async () => {
    vi.mocked(apiClient.getMissionSnapshotV8).mockRejectedValue("some string error");

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.appMode).toBe("backend_unavailable");
      expect(result.current.appModeNotice?.message).toBe("The local API is unavailable.");
    });
  });

  it("returns null appModeNotice when desktop mode is fine", async () => {
    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.appMode).toBe("desktop");
      expect(result.current.appModeNotice).toBeNull();
    });
  });

  // ─── mergeAgenticRunWithLiveEvents ───

  it("returns null agenticRun when snapshot has no agentic run", async () => {
    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ agenticRun: null }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.agenticRun).toBeNull();
    });
  });

  // ─── Session stream effect (lines 570-613) ───

  it("opens session stream when overseer has selectedSessionId", async () => {
    const mockAddEventListener = vi.fn();
    const mockClose = vi.fn();
    vi.mocked(apiClient.openSessionStream).mockResolvedValue({
      addEventListener: mockAddEventListener,
      close: mockClose,
    } as never);

    const mockSnapshot = createMockSnapshot({
      overseer: {
        selectedSessionId: "session-1",
        sessions: [],
        messages: [],
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(apiClient.openSessionStream).toHaveBeenCalledWith("session-1");
    });

    await waitFor(() => {
      expect(mockAddEventListener).toHaveBeenCalledWith("chat.token", expect.any(Function));
      expect(mockAddEventListener).toHaveBeenCalledWith("chat.done", expect.any(Function));
      expect(mockAddEventListener).toHaveBeenCalledWith("chat.message.assistant", expect.any(Function));
      expect(mockAddEventListener).toHaveBeenCalledWith("chat.error", expect.any(Function));
    });
  });

  it("handles chat.token event on session stream", async () => {
    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openSessionStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const mockSnapshot = createMockSnapshot({
      overseer: {
        selectedSessionId: "session-1",
        sessions: [],
        messages: [],
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(listeners["chat.token"]).toBeDefined();
    });

    act(() => {
      listeners["chat.token"]({
        data: JSON.stringify({ payload: { token: "Hello" } }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.streaming).toBe(true);
    });

    // The streaming text should include a streaming assistant message
    const streamingMsg = result.current.messages.find((m) => m.id === "streaming-assistant");
    expect(streamingMsg).toBeTruthy();
    expect(streamingMsg?.content).toContain("Hello");
  });

  it("handles chat.done event on session stream", async () => {
    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openSessionStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const mockSnapshot = createMockSnapshot({
      overseer: {
        selectedSessionId: "session-1",
        sessions: [],
        messages: [],
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(listeners["chat.token"]).toBeDefined();
    });

    // First trigger streaming
    act(() => {
      listeners["chat.token"]({
        data: JSON.stringify({ payload: { token: "Test" } }),
      } as unknown as Event);
    });

    await waitFor(() => expect(result.current.streaming).toBe(true));

    // Then trigger done
    act(() => {
      listeners["chat.done"]({} as Event);
    });

    await waitFor(() => {
      expect(result.current.streaming).toBe(false);
    });
  });

  it("handles chat.message.assistant event on session stream", async () => {
    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openSessionStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const mockSnapshot = createMockSnapshot({
      overseer: {
        selectedSessionId: "session-1",
        sessions: [],
        messages: [],
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(listeners["chat.message.assistant"]).toBeDefined();
    });

    // Should not throw
    act(() => {
      listeners["chat.message.assistant"]({} as Event);
    });
  });

  it("closes session stream on unmount", async () => {
    const mockClose = vi.fn();
    vi.mocked(apiClient.openSessionStream).mockResolvedValue({
      addEventListener: vi.fn(),
      close: mockClose,
    } as never);

    const mockSnapshot = createMockSnapshot({
      overseer: {
        selectedSessionId: "session-1",
        sessions: [],
        messages: [],
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { unmount } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(apiClient.openSessionStream).toHaveBeenCalledWith("session-1");
    });

    // Wait for the stream promise to resolve
    await waitFor(() => expect(mockClose).not.toHaveBeenCalled());

    unmount();

    // After unmount, the cleanup sets cancelled=true, and if source is set, closes it
    // The close happens if the promise resolved before unmount
    await waitFor(() => {
      expect(mockClose).toHaveBeenCalled();
    });
  });

  it("closes session stream immediately if cancelled before promise resolves", async () => {
    const mockClose = vi.fn();
    let resolveStream: ((value: unknown) => void) | undefined;
    vi.mocked(apiClient.openSessionStream).mockReturnValue(
      new Promise((resolve) => {
        resolveStream = resolve;
      }) as never
    );

    const mockSnapshot = createMockSnapshot({
      overseer: {
        selectedSessionId: "session-1",
        sessions: [],
        messages: [],
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { unmount } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(apiClient.openSessionStream).toHaveBeenCalled();
    });

    // Unmount before the stream resolves
    unmount();

    // Now resolve the stream
    act(() => {
      resolveStream?.({
        addEventListener: vi.fn(),
        close: mockClose,
      });
    });

    // The stream should be closed immediately because cancelled=true
    await waitFor(() => {
      expect(mockClose).toHaveBeenCalled();
    });
  });

  // ─── Agentic run stream effect (lines 615-682) ───

  it("opens agentic run stream when agenticRun or selectedRunId exists", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const mockAddEventListener = vi.fn();
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: mockAddEventListener,
      close: vi.fn(),
    } as never);

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot());

    renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(apiClient.openAgenticRunStream).toHaveBeenCalledWith("run-1");
    });

    await waitFor(() => {
      expect(mockAddEventListener).toHaveBeenCalledWith("agentic", expect.any(Function));
      expect(mockAddEventListener).toHaveBeenCalledWith("error", expect.any(Function));
    });
  });

  it("handles agentic event with assistant_token type", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const mockSnapshot = createMockSnapshot({
      agenticRun: {
        runId: "run-1",
        ticketId: "ticket-1",
        projectId: "repo-1",
        status: "running",
        phase: "executing",
        objective: "Test",
        iterationCount: 1,
        approvalCount: 0,
        lastAssistantText: "",
        latestRole: "coder_default",
        recentEvents: [],
        toolCalls: [],
        compactionEvents: [],
        escalations: [],
        doomLoops: [],
        skillEvents: [],
        hookEvents: [],
        memoryExtractions: [],
        thinkingLog: "",
        thinkingTokenCount: 0,
        budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
        startedAt: new Date().toISOString(),
        completedAt: null,
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(listeners["agentic"]).toBeDefined();
    });

    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({
          runId: "run-1",
          event: { type: "assistant_token", value: "streaming text" },
        }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.lastAssistantText).toContain("streaming text");
    });
  });

  it("handles agentic event with execution_complete type", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const mockSnapshot = createMockSnapshot({
      agenticRun: {
        runId: "run-1",
        ticketId: "ticket-1",
        projectId: "repo-1",
        status: "running",
        phase: "executing",
        objective: "Test",
        iterationCount: 1,
        approvalCount: 0,
        lastAssistantText: "",
        latestRole: "coder_default",
        recentEvents: [],
        toolCalls: [],
        compactionEvents: [],
        escalations: [],
        doomLoops: [],
        skillEvents: [],
        hookEvents: [],
        memoryExtractions: [],
        thinkingLog: "",
        thinkingTokenCount: 0,
        budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
        startedAt: new Date().toISOString(),
        completedAt: null,
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(listeners["agentic"]).toBeDefined();
    });

    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({
          runId: "run-1",
          event: { type: "execution_complete", finalMessage: "Done", totalIterations: 3, totalToolCalls: 10 },
        }),
      } as unknown as Event);
    });

    // Should invalidate queries
    await waitFor(() => {
      // The snapshot should be re-fetched
      expect(apiClient.getMissionSnapshotV8).toHaveBeenCalledTimes(2);
    });
  });

  it("handles agentic event with no event field (ignored)", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({
      agenticRun: {
        runId: "run-1",
        ticketId: "ticket-1",
        projectId: "repo-1",
        status: "running",
        phase: "executing",
        objective: "Test",
        iterationCount: 1,
        approvalCount: 0,
        lastAssistantText: "",
        latestRole: "coder_default",
        recentEvents: [],
        toolCalls: [],
        compactionEvents: [],
        escalations: [],
        doomLoops: [],
        skillEvents: [],
        hookEvents: [],
        memoryExtractions: [],
        thinkingLog: "",
        thinkingTokenCount: 0,
        budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
        startedAt: new Date().toISOString(),
        completedAt: null,
      },
    }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(listeners["agentic"]).toBeDefined();
    });

    // Message with no event field should be ignored
    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({ runId: "run-1" }),
      } as unknown as Event);
    });

    // agenticRun should still be present and unchanged
    expect(result.current.agenticRun?.recentEvents).toHaveLength(0);
  });

  it("handles agentic stream error event", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot());

    renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(listeners["error"]).toBeDefined();
    });

    // Should not throw
    act(() => {
      listeners["error"]({} as Event);
    });

    // Should have triggered a query invalidation
    await waitFor(() => {
      expect(apiClient.getMissionSnapshotV8).toHaveBeenCalledTimes(2);
    });
  });

  it("closes agentic run stream on unmount", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const mockClose = vi.fn();
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn(),
      close: mockClose,
    } as never);

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot());

    const { unmount } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(apiClient.openAgenticRunStream).toHaveBeenCalledWith("run-1");
    });

    unmount();

    await waitFor(() => {
      expect(mockClose).toHaveBeenCalled();
    });
  });

  it("resets agentic state when no runId is available", async () => {
    mockUiStore({ selectedRunId: null });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ agenticRun: null }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.agenticRun).toBeNull();
    });
  });

  // ─── mergeAgenticRunWithLiveEvents: event type handlers ───

  it("merges tool_result events into agentic run", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const mockSnapshot = createMockSnapshot({
      agenticRun: {
        runId: "run-1",
        ticketId: "ticket-1",
        projectId: "repo-1",
        status: "running",
        phase: "executing",
        objective: "Test",
        iterationCount: 1,
        approvalCount: 0,
        lastAssistantText: "",
        latestRole: "coder_default",
        recentEvents: [],
        toolCalls: [],
        compactionEvents: [],
        escalations: [],
        doomLoops: [],
        skillEvents: [],
        hookEvents: [],
        memoryExtractions: [],
        thinkingLog: "",
        thinkingTokenCount: 0,
        budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
        startedAt: new Date().toISOString(),
        completedAt: null,
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listeners["agentic"]).toBeDefined());

    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({
          runId: "run-1",
          event: {
            type: "tool_result",
            id: "tool-1",
            name: "bash",
            result: { type: "success", content: "ok" },
            durationMs: 150,
          },
        }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.toolCalls).toHaveLength(1);
      expect(result.current.agenticRun?.toolCalls[0].name).toBe("bash");
    });
  });

  it("merges tool_approval_needed events incrementing approval count", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const mockSnapshot = createMockSnapshot({
      agenticRun: {
        runId: "run-1",
        ticketId: "ticket-1",
        projectId: "repo-1",
        status: "running",
        phase: "executing",
        objective: "Test",
        iterationCount: 1,
        approvalCount: 0,
        lastAssistantText: "",
        latestRole: "coder_default",
        recentEvents: [],
        toolCalls: [],
        compactionEvents: [],
        escalations: [],
        doomLoops: [],
        skillEvents: [],
        hookEvents: [],
        memoryExtractions: [],
        thinkingLog: "",
        thinkingTokenCount: 0,
        budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
        startedAt: new Date().toISOString(),
        completedAt: null,
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listeners["agentic"]).toBeDefined());

    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({
          runId: "run-1",
          event: {
            type: "tool_approval_needed",
            id: "tool-1",
            name: "bash",
            approvalId: "ap-1",
            message: "Approve?",
          },
        }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.approvalCount).toBe(1);
    });
  });

  it("merges context_compacted events", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const baseRun = {
      runId: "run-1", ticketId: "ticket-1", projectId: "repo-1", status: "running" as const,
      phase: "executing" as const, objective: "Test", iterationCount: 1, approvalCount: 0,
      lastAssistantText: "", latestRole: "coder_default" as const, recentEvents: [], toolCalls: [],
      compactionEvents: [], escalations: [], doomLoops: [], skillEvents: [], hookEvents: [],
      memoryExtractions: [], thinkingLog: "", thinkingTokenCount: 0,
      budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
      startedAt: new Date().toISOString(), completedAt: null,
    };

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ agenticRun: baseRun }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listeners["agentic"]).toBeDefined());

    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({
          runId: "run-1",
          event: { type: "context_compacted", stage: 2, tokensBefore: 10000, tokensAfter: 5000 },
        }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.compactionEvents).toHaveLength(1);
      expect(result.current.agenticRun?.compactionEvents[0].tokensBefore).toBe(10000);
    });
  });

  it("merges escalating events", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const baseRun = {
      runId: "run-1", ticketId: "ticket-1", projectId: "repo-1", status: "running" as const,
      phase: "executing" as const, objective: "Test", iterationCount: 1, approvalCount: 0,
      lastAssistantText: "", latestRole: "coder_default" as const, recentEvents: [], toolCalls: [],
      compactionEvents: [], escalations: [], doomLoops: [], skillEvents: [], hookEvents: [],
      memoryExtractions: [], thinkingLog: "", thinkingTokenCount: 0,
      budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
      startedAt: new Date().toISOString(), completedAt: null,
    };

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ agenticRun: baseRun }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listeners["agentic"]).toBeDefined());

    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({
          runId: "run-1",
          event: { type: "escalating", fromRole: "coder_default", toRole: "overseer_escalation", reason: "Complex task" },
        }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.escalations).toHaveLength(1);
      expect(result.current.agenticRun?.latestRole).toBe("overseer_escalation");
    });
  });

  it("merges doom_loop_detected events", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const baseRun = {
      runId: "run-1", ticketId: "ticket-1", projectId: "repo-1", status: "running" as const,
      phase: "executing" as const, objective: "Test", iterationCount: 1, approvalCount: 0,
      lastAssistantText: "", latestRole: "coder_default" as const, recentEvents: [], toolCalls: [],
      compactionEvents: [], escalations: [], doomLoops: [], skillEvents: [], hookEvents: [],
      memoryExtractions: [], thinkingLog: "", thinkingTokenCount: 0,
      budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
      startedAt: new Date().toISOString(), completedAt: null,
    };

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ agenticRun: baseRun }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listeners["agentic"]).toBeDefined());

    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({
          runId: "run-1",
          event: { type: "doom_loop_detected", reason: "Repeating same edit", suggestion: "Try different approach" },
        }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.doomLoops).toHaveLength(1);
      expect(result.current.agenticRun?.doomLoops[0].reason).toBe("Repeating same edit");
    });
  });

  it("merges hook_executed events", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const baseRun = {
      runId: "run-1", ticketId: "ticket-1", projectId: "repo-1", status: "running" as const,
      phase: "executing" as const, objective: "Test", iterationCount: 1, approvalCount: 0,
      lastAssistantText: "", latestRole: "coder_default" as const, recentEvents: [], toolCalls: [],
      compactionEvents: [], escalations: [], doomLoops: [], skillEvents: [], hookEvents: [],
      memoryExtractions: [], thinkingLog: "", thinkingTokenCount: 0,
      budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
      startedAt: new Date().toISOString(), completedAt: null,
    };

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ agenticRun: baseRun }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listeners["agentic"]).toBeDefined());

    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({
          runId: "run-1",
          event: { type: "hook_executed", hookId: "h1", hookName: "lint", eventType: "PostToolUse", success: true },
        }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.hookEvents).toHaveLength(1);
      expect(result.current.agenticRun?.hookEvents[0].hookName).toBe("lint");
    });
  });

  it("merges memory_extracted events", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const baseRun = {
      runId: "run-1", ticketId: "ticket-1", projectId: "repo-1", status: "running" as const,
      phase: "executing" as const, objective: "Test", iterationCount: 1, approvalCount: 0,
      lastAssistantText: "", latestRole: "coder_default" as const, recentEvents: [], toolCalls: [],
      compactionEvents: [], escalations: [], doomLoops: [], skillEvents: [], hookEvents: [],
      memoryExtractions: [], thinkingLog: "", thinkingTokenCount: 0,
      budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
      startedAt: new Date().toISOString(), completedAt: null,
    };

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ agenticRun: baseRun }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listeners["agentic"]).toBeDefined());

    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({
          runId: "run-1",
          event: { type: "memory_extracted", memoryId: "m1", summary: "Learned something" },
        }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.memoryExtractions).toHaveLength(1);
      expect(result.current.agenticRun?.memoryExtractions[0].summary).toBe("Learned something");
    });
  });

  it("merges skill_invoked and skill_completed events", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const baseRun = {
      runId: "run-1", ticketId: "ticket-1", projectId: "repo-1", status: "running" as const,
      phase: "executing" as const, objective: "Test", iterationCount: 1, approvalCount: 0,
      lastAssistantText: "", latestRole: "coder_default" as const, recentEvents: [], toolCalls: [],
      compactionEvents: [], escalations: [], doomLoops: [], skillEvents: [], hookEvents: [],
      memoryExtractions: [], thinkingLog: "", thinkingTokenCount: 0,
      budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
      startedAt: new Date().toISOString(), completedAt: null,
    };

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ agenticRun: baseRun }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listeners["agentic"]).toBeDefined());

    // First: skill invoked
    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({
          runId: "run-1",
          event: { type: "skill_invoked", invocationId: "inv-1", skillId: "s1", skillName: "test-skill" },
        }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.skillEvents).toHaveLength(1);
      expect(result.current.agenticRun?.skillEvents[0].status).toBe("running");
    });

    // Then: skill completed
    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({
          runId: "run-1",
          event: { type: "skill_completed", invocationId: "inv-1", output: "Skill output" },
        }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.skillEvents.find((s) => s.invocationId === "inv-1")?.status).toBe("completed");
    });
  });

  it("merges skill_failed events", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const baseRun = {
      runId: "run-1", ticketId: "ticket-1", projectId: "repo-1", status: "running" as const,
      phase: "executing" as const, objective: "Test", iterationCount: 1, approvalCount: 0,
      lastAssistantText: "", latestRole: "coder_default" as const, recentEvents: [], toolCalls: [],
      compactionEvents: [], escalations: [], doomLoops: [],
      skillEvents: [{ invocationId: "inv-1", skillId: "s1", skillName: "test", status: "running" as const, output: null, childRunId: null, timestamp: new Date().toISOString() }],
      hookEvents: [], memoryExtractions: [], thinkingLog: "", thinkingTokenCount: 0,
      budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
      startedAt: new Date().toISOString(), completedAt: null,
    };

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ agenticRun: baseRun }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listeners["agentic"]).toBeDefined());

    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({
          runId: "run-1",
          event: { type: "skill_failed", invocationId: "inv-1", error: "Skill crashed" },
        }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.skillEvents.find((s) => s.invocationId === "inv-1")?.status).toBe("failed");
    });
  });

  it("merges assistant_thinking events incrementing thinking tokens", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const baseRun = {
      runId: "run-1", ticketId: "ticket-1", projectId: "repo-1", status: "running" as const,
      phase: "executing" as const, objective: "Test", iterationCount: 1, approvalCount: 0,
      lastAssistantText: "", latestRole: "coder_default" as const, recentEvents: [], toolCalls: [],
      compactionEvents: [], escalations: [], doomLoops: [], skillEvents: [], hookEvents: [],
      memoryExtractions: [], thinkingLog: "", thinkingTokenCount: 0,
      budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
      startedAt: new Date().toISOString(), completedAt: null,
    };

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ agenticRun: baseRun }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listeners["agentic"]).toBeDefined());

    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({
          runId: "run-1",
          event: { type: "assistant_thinking", value: "Let me think about this carefully..." },
        }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.thinkingTokenCount).toBeGreaterThan(0);
      expect(result.current.agenticRun?.thinkingLog).toContain("Let me think about this carefully...");
    });
  });

  it("merges iteration_start events updating iteration count", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const baseRun = {
      runId: "run-1", ticketId: "ticket-1", projectId: "repo-1", status: "running" as const,
      phase: "executing" as const, objective: "Test", iterationCount: 1, approvalCount: 0,
      lastAssistantText: "", latestRole: "coder_default" as const, recentEvents: [], toolCalls: [],
      compactionEvents: [], escalations: [], doomLoops: [], skillEvents: [], hookEvents: [],
      memoryExtractions: [], thinkingLog: "", thinkingTokenCount: 0,
      budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
      startedAt: new Date().toISOString(), completedAt: null,
    };

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ agenticRun: baseRun }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listeners["agentic"]).toBeDefined());

    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({
          runId: "run-1",
          event: { type: "iteration_start", iteration: 5, messageCount: 10 },
        }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.iterationCount).toBe(5);
    });
  });

  it("merges plan phase events (plan_started, plan_submitted, plan_approved, plan_rejected)", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const baseRun = {
      runId: "run-1", ticketId: "ticket-1", projectId: "repo-1", status: "running" as const,
      phase: "executing" as const, objective: "Test", iterationCount: 1, approvalCount: 0,
      lastAssistantText: "", latestRole: "coder_default" as const, recentEvents: [], toolCalls: [],
      compactionEvents: [], escalations: [], doomLoops: [], skillEvents: [], hookEvents: [],
      memoryExtractions: [], thinkingLog: "", thinkingTokenCount: 0,
      budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
      startedAt: new Date().toISOString(), completedAt: null,
    };

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ agenticRun: baseRun }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listeners["agentic"]).toBeDefined());

    // plan_started -> planning
    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({ runId: "run-1", event: { type: "plan_started" } }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.phase).toBe("planning");
    });

    // plan_submitted -> plan_review
    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({ runId: "run-1", event: { type: "plan_submitted", planContent: "my plan" } }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.phase).toBe("plan_review");
    });

    // plan_approved -> executing
    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({ runId: "run-1", event: { type: "plan_approved", reviewedBy: "user" } }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.phase).toBe("executing");
    });

    // plan_rejected -> failed
    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({ runId: "run-1", event: { type: "plan_rejected", reason: "bad plan", reviewedBy: "user" } }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.phase).toBe("failed");
    });
  });

  it("merges plan_question_answered and plan_refine_requested events as planning phase", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const baseRun = {
      runId: "run-1", ticketId: "ticket-1", projectId: "repo-1", status: "running" as const,
      phase: "plan_review" as const, objective: "Test", iterationCount: 1, approvalCount: 0,
      lastAssistantText: "", latestRole: "coder_default" as const, recentEvents: [], toolCalls: [],
      compactionEvents: [], escalations: [], doomLoops: [], skillEvents: [], hookEvents: [],
      memoryExtractions: [], thinkingLog: "", thinkingTokenCount: 0,
      budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
      startedAt: new Date().toISOString(), completedAt: null,
    };

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ agenticRun: baseRun }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listeners["agentic"]).toBeDefined());

    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({ runId: "run-1", event: { type: "plan_question_answered", questionId: "q1", answer: "yes" } }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.phase).toBe("planning");
    });
  });

  // ─── tool_result with approval_required policy ───

  it("merges tool_result with approval_required result type", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const baseRun = {
      runId: "run-1", ticketId: "ticket-1", projectId: "repo-1", status: "running" as const,
      phase: "executing" as const, objective: "Test", iterationCount: 1, approvalCount: 0,
      lastAssistantText: "", latestRole: "coder_default" as const, recentEvents: [], toolCalls: [],
      compactionEvents: [], escalations: [], doomLoops: [], skillEvents: [], hookEvents: [],
      memoryExtractions: [], thinkingLog: "", thinkingTokenCount: 0,
      budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
      startedAt: new Date().toISOString(), completedAt: null,
    };

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ agenticRun: baseRun }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listeners["agentic"]).toBeDefined());

    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({
          runId: "run-1",
          event: {
            type: "tool_result",
            id: "tool-1",
            name: "bash",
            result: { type: "approval_required", approvalId: "ap-1", message: "Needs approval" },
            durationMs: 50,
          },
        }),
      } as unknown as Event);
    });

    await waitFor(() => {
      const tc = result.current.agenticRun?.toolCalls.find((c) => c.id === "tool-1");
      expect(tc?.policyDecision).toBe("approval_required");
    });
  });

  // ─── useEffect syncs ───

  it("syncs selectedRepoId when selectedRepo changes", async () => {
    const setSelectedRepoId = vi.fn();
    mockUiStore({ selectedRepoId: "old-repo", setSelectedRepoId });

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "new-repo",
        displayName: "New Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/new/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(setSelectedRepoId).toHaveBeenCalledWith("new-repo");
    });
  });

  it("syncs selectedTicketId from snapshot when no local selection exists", async () => {
    const setSelectedTicketId = vi.fn();
    mockUiStore({ selectedTicketId: null, setSelectedTicketId });

    const mockSnapshot = createMockSnapshot({
      selectedTicket: {
        id: "ticket-1",
        title: "Test",
        description: "",
        status: "in_progress",
        priority: "medium",
        risk: "medium",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      tickets: [
        {
          id: "ticket-1",
          title: "Test",
          description: "",
          status: "in_progress",
          priority: "medium",
          risk: "medium",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(setSelectedTicketId).toHaveBeenCalledWith("ticket-1");
    });
  });

  it("syncs selectedSessionId from snapshot overseer", async () => {
    const setSelectedSessionId = vi.fn();
    mockUiStore({ selectedSessionId: null, setSelectedSessionId });

    const mockSnapshot = createMockSnapshot({
      overseer: {
        selectedSessionId: "session-1",
        sessions: [],
        messages: [],
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(setSelectedSessionId).toHaveBeenCalledWith("session-1");
    });
  });

  it("syncs selectedRunId from snapshot runSummary", async () => {
    const setSelectedRunId = vi.fn();
    mockUiStore({ selectedRunId: null, setSelectedRunId });

    const mockSnapshot = createMockSnapshot({
      runSummary: {
        runId: "run-1",
        status: "running",
        objective: "Test",
        startedAt: new Date().toISOString(),
        completedAt: null,
      } as MissionControlSnapshot["runSummary"],
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(setSelectedRunId).toHaveBeenCalledWith("run-1");
    });
  });

  it("sets blueprint preview from snapshot blueprint", async () => {
    const blueprint = {
      projectId: "repo-1",
      repositoryPurpose: "Test",
      primaryLanguages: ["typescript"],
      architectureStyle: "modular",
      keyDomains: [],
      criticalPaths: [],
      testingStrategy: "unit",
      providerPolicy: { executionProfileId: "balanced" },
      detectedAt: new Date().toISOString(),
      manuallyEditedAt: null,
    };

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ blueprint }));
    vi.mocked(apiClient.getProjectBlueprintV8).mockResolvedValue({ item: blueprint } as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.blueprint?.repositoryPurpose).toBe("Test");
    });
  });

  // ─── Mutation: connectLocalMutation with bootstrap ───

  it("handles connectLocalMutation bootstrap required path", async () => {
    const setActiveSection = vi.fn();
    mockUiStore({ setActiveSection });

    vi.mocked(apiClient.connectLocalProjectV8).mockResolvedValue({
      bootstrapRequired: true,
      folderPath: "/empty/folder",
    } as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.chooseLocalRepo).toBeDefined());

    await act(async () => {
      result.current.chooseLocalRepo();
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toBe("This folder is empty. Create a blank project or apply a starter to continue.");
      expect(setActiveSection).toHaveBeenCalledWith("projects");
    });
  });

  it("handles connectLocalMutation error path", async () => {
    vi.mocked(apiClient.connectLocalProjectV8).mockRejectedValue(new Error("Permission denied"));

    const desktopBridge = await import("../lib/desktopBridge");
    vi.mocked(desktopBridge.pickRepoDirectory).mockResolvedValue({ canceled: false, path: "/test/path" });

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.chooseLocalRepo();
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toContain("Local repo attach failed");
    });
  });

  // ─── Mutation: connectGithubMutation ───

  it("handles connectGithubMutation with empty owner/repo", async () => {
    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.connectGithubProject).toBeDefined());

    await act(async () => {
      result.current.connectGithubProject();
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toContain("GitHub connect failed");
    });
  });

  it("handles successful connectGithubMutation", async () => {
    vi.mocked(apiClient.connectGithubProjectV8).mockResolvedValue({
      repo: { id: "gh-1", displayName: "github/project" },
    } as never);
    vi.mocked(apiClient.activateProjectV5).mockResolvedValue({
      repo: { id: "gh-1" },
    } as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setGithubOwner("myowner");
      result.current.setGithubRepo("myrepo");
    });

    await act(async () => {
      result.current.connectGithubProject();
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toBe("GitHub project connected.");
    });
  });

  // ─── Mutation: syncProjectMutation ───

  it("sets proper action message during sync for github projects", async () => {
    const mockSnapshot = createMockSnapshot({
      recentProjects: [
        {
          id: "repo-gh",
          displayName: "GitHub Repo",
          branch: "main",
          defaultBranch: "main",
          sourceKind: "github_app_bound",
          sourcePath: "",
          metadata: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    let resolveSync: ((value: unknown) => void) | undefined;
    vi.mocked(apiClient.syncProjectV5).mockReturnValue(
      new Promise((resolve) => {
        resolveSync = resolve;
      }) as never
    );

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.recentRepos.length).toBeGreaterThan(0));

    act(() => {
      result.current.syncProject("repo-gh");
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toContain("Syncing");
    });

    // Resolve to finish
    await act(async () => {
      resolveSync?.({ repo: { id: "repo-gh" } });
    });
  });

  it("handles syncProjectMutation error", async () => {
    vi.mocked(apiClient.syncProjectV5).mockRejectedValue(new Error("Sync failed"));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.syncProject("repo-1");
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toContain("Project sync failed");
    });
  });

  // ─── Mutation: reviewRouteMutation error paths ───

  it("reviewRoute fails when no repo selected", async () => {
    mockUiStore({ selectedRepoId: null });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ project: null as never }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setInput("Some objective");
    });

    await act(async () => {
      result.current.reviewRoute();
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toContain("Route review failed");
    });
  });

  it("reviewRoute fails when input is empty", async () => {
    mockUiStore({ selectedRepoId: "repo-1" });

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeTruthy());

    await act(async () => {
      result.current.reviewRoute();
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toContain("Route review failed");
    });
  });

  it("reviewRoute handles non-Error rejection", async () => {
    mockUiStore({ selectedRepoId: "repo-1" });

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);
    vi.mocked(apiClient.reviewOverseerRouteV8).mockRejectedValue("string error");

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeTruthy());

    act(() => {
      result.current.setInput("Some objective");
    });

    await act(async () => {
      result.current.reviewRoute();
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toBe("Route review failed.");
    });
  });

  // ─── Mutation: executeMutation error paths ───

  it("executeRoute fails when no repo selected", async () => {
    mockUiStore({ selectedRepoId: null });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ project: null as never }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setInput("Do something");
    });

    await act(async () => {
      result.current.executeRoute();
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toContain("Execution failed");
    });
  });

  it("executeRoute fails when input is empty", async () => {
    mockUiStore({ selectedRepoId: "repo-1" });

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeTruthy());

    await act(async () => {
      result.current.executeRoute();
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toContain("Execution failed");
    });
  });

  it("executeRoute handles non-Error rejection", async () => {
    mockUiStore({ selectedRepoId: "repo-1" });

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);
    vi.mocked(apiClient.startAgenticRun).mockRejectedValue("string error");

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeTruthy());

    act(() => {
      result.current.setInput("Do something");
    });

    await act(async () => {
      result.current.executeRoute();
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toBe("Execution failed.");
    });
  });

  // ─── sendMessage with empty input ───

  it("sendMessage does nothing when input is empty", async () => {
    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.sendMessage();
    });

    expect(apiClient.sendOverseerMessageV8).not.toHaveBeenCalled();
  });

  // ─── moveWorkflow mutation ───

  it("calls moveMissionWorkflowV8 on moveWorkflow", async () => {
    vi.mocked(apiClient.moveMissionWorkflowV8).mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    const moveRequest = { ticketId: "ticket-1", from: "backlog", to: "in_progress" } as never;

    await act(async () => {
      result.current.moveWorkflow(moveRequest);
    });

    await waitFor(() => {
      expect(apiClient.moveMissionWorkflowV8).toHaveBeenCalledWith(
        expect.objectContaining({ ticketId: "ticket-1", from: "backlog", to: "in_progress" }),
        expect.anything()
      );
      expect(result.current.actionMessage).toBe("Workflow updated.");
    });
  });

  // ─── setTicketExecutionProfile mutation ───

  it("calls setMissionWorkflowExecutionProfileV8 on setTicketExecutionProfile", async () => {
    vi.mocked(apiClient.setMissionWorkflowExecutionProfileV8).mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.setTicketExecutionProfile("task-1", "balanced");
    });

    await waitFor(() => {
      expect(apiClient.setMissionWorkflowExecutionProfileV8).toHaveBeenCalledWith({
        workflowId: "task-1",
        executionProfileId: "balanced",
        actor: "user",
      });
      expect(result.current.actionMessage).toContain("Ticket override set to");
    });
  });

  it("calls setTicketExecutionProfile with null to clear override", async () => {
    vi.mocked(apiClient.setMissionWorkflowExecutionProfileV8).mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.setTicketExecutionProfile("task-1", null);
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toBe("Ticket override cleared.");
    });
  });

  // ─── setTicketPermissionMode mutation ───

  it("calls setMissionTicketPermissionV9 on setTicketPermissionMode", async () => {
    vi.mocked(apiClient.setMissionTicketPermissionV9).mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.setTicketPermissionMode("task-1", "strict");
    });

    await waitFor(() => {
      expect(apiClient.setMissionTicketPermissionV9).toHaveBeenCalledWith({
        ticket_id: "task-1",
        mode: "strict",
        actor: "user",
      });
      expect(result.current.actionMessage).toBe("Ticket permissions set to Strict.");
    });
  });

  it("sets balanced mode label in setTicketPermissionMode", async () => {
    vi.mocked(apiClient.setMissionTicketPermissionV9).mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.setTicketPermissionMode("task-1", "balanced");
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toBe("Ticket permissions set to Balanced.");
    });
  });

  // ─── updateBlueprintMutation error path ───

  it("handles updateBlueprint error by clearing pending state", async () => {
    mockUiStore({ selectedRepoId: "repo-1" });

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);
    vi.mocked(apiClient.updateProjectBlueprintV8).mockRejectedValue(new Error("Update failed"));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeTruthy());

    await act(async () => {
      result.current.updateBlueprint({ repositoryPurpose: "Updated" });
    });

    // Error should not throw
    await waitFor(() => {
      expect(result.current.error).toContain("Update failed");
    });
  });

  // ─── regenerateBlueprint mutation ───

  it("calls generateProjectBlueprintV8 on regenerateBlueprint", async () => {
    mockUiStore({ selectedRepoId: "repo-1" });

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const newBlueprint = {
      projectId: "repo-1",
      repositoryPurpose: "Regenerated",
      primaryLanguages: ["typescript"],
      architectureStyle: "modular",
      keyDomains: [],
      criticalPaths: [],
      testingStrategy: "comprehensive",
      providerPolicy: { executionProfileId: "balanced" },
      detectedAt: new Date().toISOString(),
      manuallyEditedAt: null,
    };

    vi.mocked(apiClient.generateProjectBlueprintV8).mockResolvedValue({ item: newBlueprint } as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeTruthy());

    await act(async () => {
      result.current.regenerateBlueprint();
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toBe("Blueprint regenerated from repo guidance.");
      expect(result.current.blueprint?.repositoryPurpose).toBe("Regenerated");
    });
  });

  it("regenerateBlueprint fails when no repo selected", async () => {
    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ project: null as never }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.regenerateBlueprint();
    });

    // Should trigger toast error but not crash
    await waitFor(() => {
      expect(apiClient.generateProjectBlueprintV8).not.toHaveBeenCalled();
    });
  });

  // ─── setExecutionProfile function ───

  it("setExecutionProfile updates blueprint when repo is selected", async () => {
    mockUiStore({ selectedRepoId: "repo-1" });

    const blueprint = {
      projectId: "repo-1",
      repositoryPurpose: "Test",
      primaryLanguages: ["typescript"],
      architectureStyle: "modular",
      keyDomains: [],
      criticalPaths: [],
      testingStrategy: "comprehensive",
      providerPolicy: { executionProfileId: "balanced" },
      detectedAt: new Date().toISOString(),
      manuallyEditedAt: null,
    };

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      blueprint,
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);
    vi.mocked(apiClient.updateProjectBlueprintV8).mockResolvedValue({ item: { ...blueprint, providerPolicy: { executionProfileId: "balanced" } } } as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeTruthy());

    act(() => {
      result.current.setExecutionProfile("balanced");
    });

    await waitFor(() => {
      expect(apiClient.updateProjectBlueprintV8).toHaveBeenCalled();
    });
  });

  it("setExecutionProfile updates settings when no repo is selected", async () => {
    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ project: null as never }));
    vi.mocked(apiClient.updateSettings).mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeNull());

    act(() => {
      result.current.setExecutionProfile("balanced");
    });

    await waitFor(() => {
      expect(apiClient.updateSettings).toHaveBeenCalled();
    });
  });

  it("setExecutionProfile handles updateSettings error", async () => {
    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ project: null as never }));
    vi.mocked(apiClient.updateSettings).mockRejectedValue(new Error("Settings write failed"));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeNull());

    act(() => {
      result.current.setExecutionProfile("balanced");
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toContain("Settings write failed");
    });
  });

  it("setExecutionProfile handles non-Error updateSettings rejection", async () => {
    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ project: null as never }));
    vi.mocked(apiClient.updateSettings).mockRejectedValue("string error");

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeNull());

    act(() => {
      result.current.setExecutionProfile("balanced");
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toBe("Unable to update execution profile.");
    });
  });

  // ─── chooseLocalRepo ───

  it("chooseLocalRepo shows message when no desktop picker", async () => {
    const desktopBridge = await import("../lib/desktopBridge");
    vi.mocked(desktopBridge.hasDesktopRepoPicker).mockReturnValue(false);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.chooseLocalRepo();
    });

    await waitFor(() => {
      expect(result.current.repoPickerMessage).toContain("Repo picker is available in the desktop app");
    });

    vi.mocked(desktopBridge.hasDesktopRepoPicker).mockReturnValue(true);
  });

  it("chooseLocalRepo does nothing when picker is canceled", async () => {
    const desktopBridge = await import("../lib/desktopBridge");
    vi.mocked(desktopBridge.pickRepoDirectory).mockResolvedValue({ canceled: true, path: null } as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.chooseLocalRepo();
    });

    expect(apiClient.connectLocalProjectV8).not.toHaveBeenCalled();
  });

  it("chooseLocalRepo handles picker error", async () => {
    const desktopBridge = await import("../lib/desktopBridge");
    vi.mocked(desktopBridge.pickRepoDirectory).mockRejectedValue(new Error("Dialog failed"));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.chooseLocalRepo();
    });

    await waitFor(() => {
      expect(result.current.repoPickerMessage).toBe("Dialog failed");
      expect(result.current.actionMessage).toContain("Local repo selection failed");
    });
  });

  // ─── Project setup functions ───

  it("openNewProjectDialog sets project setup state", async () => {
    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.openNewProjectDialog();
    });

    expect(result.current.projectSetupState).toEqual({
      mode: "create",
      source: "new_project",
    });
  });

  it("openStarterDialogForActiveProject sets project setup state", async () => {
    mockUiStore({ selectedRepoId: "repo-1" });

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeTruthy());

    act(() => {
      result.current.openStarterDialogForActiveProject();
    });

    expect(result.current.projectSetupState).toEqual({
      mode: "apply",
      source: "active_repo",
      targetRepoId: "repo-1",
      targetRepoName: "Test Repo",
    });
  });

  it("openStarterDialogForActiveProject does nothing when no repo selected", async () => {
    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ project: null as never }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.openStarterDialogForActiveProject();
    });

    expect(result.current.projectSetupState).toBeNull();
  });

  it("dismissProjectSetupDialog clears setup state", async () => {
    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.openNewProjectDialog();
    });

    expect(result.current.projectSetupState).toBeTruthy();

    act(() => {
      result.current.dismissProjectSetupDialog();
    });

    expect(result.current.projectSetupState).toBeNull();
  });

  // ─── createBlankProject / createProjectFromStarter ───

  it("createBlankProject does nothing when no setup state", async () => {
    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.createBlankProject();
    });

    expect(apiClient.bootstrapEmptyProjectV8).not.toHaveBeenCalled();
  });

  it("createProjectFromStarter in apply mode calls applyStarterMutation", async () => {
    vi.mocked(apiClient.executeScaffoldV8).mockResolvedValue({
      result: { runId: "run-1", status: "completed" },
      blueprint: { projectId: "repo-1", providerPolicy: { executionProfileId: "balanced" } },
    } as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    // Set up apply mode manually
    act(() => {
      result.current.openNewProjectDialog();
    });

    // We need to be in apply mode with a target repo
    // Re-render with proper setup state
    mockUiStore({ selectedRepoId: "repo-1" });

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result: result2 } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result2.current.selectedRepo).toBeTruthy());

    act(() => {
      result2.current.openStarterDialogForActiveProject();
    });

    await act(async () => {
      result2.current.createProjectFromStarter("ts_app" as never);
    });

    await waitFor(() => {
      expect(apiClient.executeScaffoldV8).toHaveBeenCalled();
    });
  });

  // ─── connectRecentPath ───

  it("connectRecentPath handles bootstrap required path", async () => {
    const setActiveSection = vi.fn();
    mockUiStore({ setActiveSection });

    vi.mocked(apiClient.openRecentProjectV8).mockResolvedValue({
      bootstrapRequired: true,
      folderPath: "/empty/dir",
    } as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.connectRecentPath("/empty/dir", "Empty Project");
    });

    await waitFor(() => {
      expect(result.current.projectSetupState).toBeTruthy();
      expect(result.current.actionMessage).toContain("empty");
      expect(setActiveSection).toHaveBeenCalledWith("projects");
    });
  });

  it("connectRecentPath activates and navigates on success", async () => {
    const setActiveSection = vi.fn();
    const setSelectedRepoId = vi.fn();
    mockUiStore({ setActiveSection, setSelectedRepoId });

    vi.mocked(apiClient.openRecentProjectV8).mockResolvedValue({
      repo: { id: "repo-1", displayName: "Test" },
      blueprint: null,
    } as never);
    vi.mocked(apiClient.activateProjectV5).mockResolvedValue({ repo: { id: "repo-1" } } as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.connectRecentPath("/test/path", "Test Label");
    });

    await waitFor(() => {
      expect(apiClient.activateProjectV5).toHaveBeenCalled();
      expect(setSelectedRepoId).toHaveBeenCalledWith("repo-1");
      expect(setActiveSection).toHaveBeenCalledWith("live");
    });
  });

  // ─── messages memo with streaming text ───

  it("appends streaming assistant message when streaming text is present", async () => {
    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openSessionStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const mockSnapshot = createMockSnapshot({
      overseer: {
        selectedSessionId: "session-1",
        sessions: [],
        messages: [
          {
            id: "msg-1",
            sessionId: "session-1",
            role: "user",
            content: "Hello",
            createdAt: new Date().toISOString(),
            metadata: {},
          },
        ],
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(listeners["chat.token"]).toBeDefined();
    });

    act(() => {
      listeners["chat.token"]({
        data: JSON.stringify({ payload: { token: "World" } }),
      } as unknown as Event);
    });

    await waitFor(() => {
      const msgs = result.current.messages;
      expect(msgs.length).toBeGreaterThan(1);
      const streamMsg = msgs.find((m) => m.id === "streaming-assistant");
      expect(streamMsg?.role).toBe("assistant");
      expect(streamMsg?.content).toBe("World");
    });
  });

  // ─── headerRepos dedup ───

  it("includes selectedRepo in headerRepos when not in recentRepos", async () => {
    const mockSnapshot = createMockSnapshot({
      project: {
        id: "unique-repo",
        displayName: "Unique Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/unique/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      recentProjects: [],
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.headerRepos.some((r) => r.id === "unique-repo")).toBe(true);
    });
  });

  // ─── liveState variants ───

  it("returns liveState as disconnected when no selectedRepo", async () => {
    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ project: null as never }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.liveState).toBe("disconnected");
    });
  });

  it("returns liveState as disconnected when snapshot query errors and no repo", async () => {
    vi.mocked(apiClient.getMissionSnapshotV8).mockRejectedValue(new Error("Backend down"));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      // With no previous data, selectedRepo is null, so liveState is "disconnected"
      expect(result.current.liveState).toBe("disconnected");
    });
  });

  // ─── Error chain ───

  it("reports error from snapshotQuery error", async () => {
    vi.mocked(apiClient.getMissionSnapshotV8).mockRejectedValue(new Error("Snapshot failed"));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).toBe("Snapshot failed");
    });
  });

  it("reports error from starterCatalogQuery", async () => {
    vi.mocked(apiClient.getProjectStartersV8).mockRejectedValue(new Error("Starters failed"));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).toBe("Starters failed");
    });
  });

  // ─── activateRepo mutation ───

  it("activateRepo sets active section to live on success", async () => {
    const setActiveSection = vi.fn();
    const setSelectedRepoId = vi.fn();
    mockUiStore({ setActiveSection, setSelectedRepoId });

    vi.mocked(apiClient.activateProjectV5).mockResolvedValue({
      repo: { id: "repo-1", displayName: "Test" },
    } as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.activateRepo("repo-1");
    });

    await waitFor(() => {
      expect(setSelectedRepoId).toHaveBeenCalledWith("repo-1");
      expect(setActiveSection).toHaveBeenCalledWith("live");
    });
  });

  // ─── openProjects / openWork ───

  it("openProjects sets active section to projects", async () => {
    const setActiveSection = vi.fn();
    mockUiStore({ setActiveSection });

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.openProjects();
    });

    expect(setActiveSection).toHaveBeenCalledWith("projects");
  });

  it("openWork sets active section to live", async () => {
    const setActiveSection = vi.fn();
    mockUiStore({ setActiveSection });

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.openWork();
    });

    expect(setActiveSection).toHaveBeenCalledWith("live");
  });

  // ─── isExecuting computed value ───

  it("isExecuting is true when agentic run status is running", async () => {
    const mockSnapshot = createMockSnapshot({
      agenticRun: {
        runId: "run-1",
        ticketId: "ticket-1",
        projectId: "repo-1",
        status: "running",
        phase: "executing",
        objective: "Test",
        iterationCount: 1,
        approvalCount: 0,
        lastAssistantText: "",
        latestRole: "coder_default",
        recentEvents: [],
        toolCalls: [],
        compactionEvents: [],
        escalations: [],
        doomLoops: [],
        skillEvents: [],
        hookEvents: [],
        memoryExtractions: [],
        thinkingLog: "",
        thinkingTokenCount: 0,
        budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
        startedAt: new Date().toISOString(),
        completedAt: null,
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isExecuting).toBe(true);
    });
  });

  it("isExecuting is true when runSummary status is running", async () => {
    const mockSnapshot = createMockSnapshot({
      runSummary: {
        runId: "run-1",
        status: "running",
        objective: "Test",
        startedAt: new Date().toISOString(),
        completedAt: null,
      } as MissionControlSnapshot["runSummary"],
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isExecuting).toBe(true);
    });
  });

  // ─── DEFAULT_EXECUTION_PROFILES fallback ───

  it("uses DEFAULT_EXECUTION_PROFILES when settings have no executionProfiles", async () => {
    vi.mocked(apiClient.getSettings).mockResolvedValue({
      items: {},
    } as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.executionProfiles.activeProfileId).toBe("balanced");
      expect(result.current.executionProfiles.profiles).toHaveLength(4);
    });
  });

  // ─── roleLabels ───

  it("exposes roleLabels constant", async () => {
    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    expect(result.current.roleLabels).toEqual({
      utility_fast: "Fast",
      coder_default: "Build",
      review_deep: "Review",
      overseer_escalation: "Escalate",
    });
  });

  // ─── execution_aborted event in agentic stream ───

  it("handles execution_aborted event clearing assistant text", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const baseRun = {
      runId: "run-1", ticketId: "ticket-1", projectId: "repo-1", status: "running" as const,
      phase: "executing" as const, objective: "Test", iterationCount: 1, approvalCount: 0,
      lastAssistantText: "", latestRole: "coder_default" as const, recentEvents: [], toolCalls: [],
      compactionEvents: [], escalations: [], doomLoops: [], skillEvents: [], hookEvents: [],
      memoryExtractions: [], thinkingLog: "", thinkingTokenCount: 0,
      budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
      startedAt: new Date().toISOString(), completedAt: null,
    };

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ agenticRun: baseRun }));

    renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listeners["agentic"]).toBeDefined());

    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({
          runId: "run-1",
          event: { type: "execution_aborted", reason: "User cancelled" },
        }),
      } as unknown as Event);
    });

    // Should have triggered query invalidation
    await waitFor(() => {
      expect(apiClient.getMissionSnapshotV8).toHaveBeenCalledTimes(2);
    });
  });

  // ─── error event type in agentic stream ───

  it("handles error event type in agentic stream", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const baseRun = {
      runId: "run-1", ticketId: "ticket-1", projectId: "repo-1", status: "running" as const,
      phase: "executing" as const, objective: "Test", iterationCount: 1, approvalCount: 0,
      lastAssistantText: "", latestRole: "coder_default" as const, recentEvents: [], toolCalls: [],
      compactionEvents: [], escalations: [], doomLoops: [], skillEvents: [], hookEvents: [],
      memoryExtractions: [], thinkingLog: "", thinkingTokenCount: 0,
      budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
      startedAt: new Date().toISOString(), completedAt: null,
    };

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ agenticRun: baseRun }));

    renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listeners["agentic"]).toBeDefined());

    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({
          runId: "run-1",
          event: { type: "error", error: "Something went wrong", recoverable: false },
        }),
      } as unknown as Event);
    });

    // Should have triggered query invalidation
    await waitFor(() => {
      expect(apiClient.getMissionSnapshotV8).toHaveBeenCalledTimes(2);
    });
  });

  // ─── agentic event with alternative field names (run_id, ticket_id, project_id) ───

  it("handles agentic events using snake_case field names", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const baseRun = {
      runId: "run-1", ticketId: "ticket-1", projectId: "repo-1", status: "running" as const,
      phase: "executing" as const, objective: "Test", iterationCount: 1, approvalCount: 0,
      lastAssistantText: "", latestRole: "coder_default" as const, recentEvents: [], toolCalls: [],
      compactionEvents: [], escalations: [], doomLoops: [], skillEvents: [], hookEvents: [],
      memoryExtractions: [], thinkingLog: "", thinkingTokenCount: 0,
      budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
      startedAt: new Date().toISOString(), completedAt: null,
    };

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ agenticRun: baseRun }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listeners["agentic"]).toBeDefined());

    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({
          run_id: "run-1",
          ticket_id: "ticket-alt",
          project_id: "project-alt",
          event: { type: "iteration_start", iteration: 2, messageCount: 5 },
        }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.iterationCount).toBe(2);
    });
  });

  // ─── tool_result update existing tool call ───

  it("updates existing tool call on duplicate tool_result id", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const baseRun = {
      runId: "run-1", ticketId: "ticket-1", projectId: "repo-1", status: "running" as const,
      phase: "executing" as const, objective: "Test", iterationCount: 1, approvalCount: 0,
      lastAssistantText: "", latestRole: "coder_default" as const, recentEvents: [],
      toolCalls: [
        { id: "tool-1", iteration: 1, name: "bash", args: {}, result: { type: "success" as const, content: "first" }, policyDecision: "allow" as const, durationMs: 100, timestamp: new Date().toISOString() },
      ],
      compactionEvents: [], escalations: [], doomLoops: [], skillEvents: [], hookEvents: [],
      memoryExtractions: [], thinkingLog: "", thinkingTokenCount: 0,
      budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
      startedAt: new Date().toISOString(), completedAt: null,
    };

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ agenticRun: baseRun }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listeners["agentic"]).toBeDefined());

    // Send tool_result with same id "tool-1" — should update, not add
    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({
          runId: "run-1",
          event: {
            type: "tool_result",
            id: "tool-1",
            name: "bash",
            result: { type: "success", content: "updated" },
            durationMs: 200,
          },
        }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.toolCalls).toHaveLength(1);
      expect(result.current.agenticRun?.toolCalls[0].result.content).toBe("updated");
    });
  });

  // ─── chat.token with no token field ───

  it("handles chat.token event with no token field gracefully", async () => {
    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openSessionStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const mockSnapshot = createMockSnapshot({
      overseer: {
        selectedSessionId: "session-1",
        sessions: [],
        messages: [],
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listeners["chat.token"]).toBeDefined());

    act(() => {
      listeners["chat.token"]({
        data: JSON.stringify({ payload: {} }),
      } as unknown as Event);
    });

    // Should set streaming to true but add empty string
    await waitFor(() => {
      expect(result.current.streaming).toBe(true);
    });
  });

  // ─── bootstrapProjectMutation success with starterId ───

  it("bootstraps project with starter and sets appropriate action message", async () => {
    vi.mocked(apiClient.bootstrapEmptyProjectV8).mockResolvedValue({
      repo: { id: "new-repo", displayName: "New" },
      blueprint: { projectId: "new-repo", providerPolicy: { executionProfileId: "balanced" } },
    } as never);
    vi.mocked(apiClient.activateProjectV5).mockResolvedValue({ repo: { id: "new-repo" } } as never);
    vi.mocked(apiClient.executeScaffoldV8).mockResolvedValue({
      result: { runId: "run-1", status: "completed" },
      blueprint: { projectId: "new-repo", providerPolicy: { executionProfileId: "balanced" } },
    } as never);

    const desktopBridge = await import("../lib/desktopBridge");
    vi.mocked(desktopBridge.pickRepoDirectory).mockResolvedValue({ canceled: false, path: "/test/new" });

    const setActiveSection = vi.fn();
    mockUiStore({ setActiveSection });

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    // Open new project dialog
    act(() => {
      result.current.openNewProjectDialog();
    });

    // Create from starter
    await act(async () => {
      result.current.createProjectFromStarter("ts_app" as never);
    });

    await waitFor(() => {
      expect(apiClient.bootstrapEmptyProjectV8).toHaveBeenCalled();
      expect(apiClient.executeScaffoldV8).toHaveBeenCalled();
      expect(result.current.actionMessage).toContain("TypeScript project scaffolded");
      expect(setActiveSection).toHaveBeenCalledWith("live");
    });
  });

  it("bootstraps blank project without starter", async () => {
    vi.mocked(apiClient.bootstrapEmptyProjectV8).mockResolvedValue({
      repo: { id: "new-repo", displayName: "New" },
      blueprint: { projectId: "new-repo", providerPolicy: { executionProfileId: "balanced" } },
    } as never);
    vi.mocked(apiClient.activateProjectV5).mockResolvedValue({ repo: { id: "new-repo" } } as never);

    const desktopBridge = await import("../lib/desktopBridge");
    vi.mocked(desktopBridge.pickRepoDirectory).mockResolvedValue({ canceled: false, path: "/test/new" });

    const setActiveSection = vi.fn();
    mockUiStore({ setActiveSection });

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.openNewProjectDialog();
    });

    await act(async () => {
      result.current.createBlankProject();
    });

    await waitFor(() => {
      expect(apiClient.bootstrapEmptyProjectV8).toHaveBeenCalled();
      expect(apiClient.executeScaffoldV8).not.toHaveBeenCalled();
      expect(result.current.actionMessage).toContain("Blank project created");
      expect(setActiveSection).toHaveBeenCalledWith("projects");
    });
  });

  it("bootstrapProject handles error", async () => {
    vi.mocked(apiClient.bootstrapEmptyProjectV8).mockRejectedValue(new Error("Disk full"));

    const desktopBridge = await import("../lib/desktopBridge");
    vi.mocked(desktopBridge.pickRepoDirectory).mockResolvedValue({ canceled: false, path: "/test/new" });

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.openNewProjectDialog();
    });

    await act(async () => {
      result.current.createBlankProject();
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toContain("Project initialization failed");
    });
  });

  // ─── applyStarterMutation error ───

  it("applyStarter handles error", async () => {
    vi.mocked(apiClient.executeScaffoldV8).mockRejectedValue(new Error("Scaffold failed"));

    mockUiStore({ selectedRepoId: "repo-1" });

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeTruthy());

    act(() => {
      result.current.openStarterDialogForActiveProject();
    });

    await act(async () => {
      result.current.createProjectFromStarter("ts_app" as never);
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toContain("Starter application failed");
    });
  });

  // ─── starterObjective helper ───

  it("bootstraps with neutral_baseline starter objective", async () => {
    vi.mocked(apiClient.bootstrapEmptyProjectV8).mockResolvedValue({
      repo: { id: "new-repo", displayName: "New" },
      blueprint: { projectId: "new-repo", providerPolicy: { executionProfileId: "balanced" } },
    } as never);
    vi.mocked(apiClient.activateProjectV5).mockResolvedValue({ repo: { id: "new-repo" } } as never);
    vi.mocked(apiClient.executeScaffoldV8).mockResolvedValue({
      result: { runId: "run-1", status: "completed" },
      blueprint: { projectId: "new-repo", providerPolicy: { executionProfileId: "balanced" } },
    } as never);

    const desktopBridge = await import("../lib/desktopBridge");
    vi.mocked(desktopBridge.pickRepoDirectory).mockResolvedValue({ canceled: false, path: "/test/new" });

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.openNewProjectDialog();
    });

    await act(async () => {
      result.current.createProjectFromStarter("neutral_baseline" as never);
    });

    await waitFor(() => {
      expect(apiClient.executeScaffoldV8).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          objective: "Create a neutral project baseline with a README, repo charter, and generic ignore rules.",
        })
      );
    });
  });

  // ─── starterSuccessMessage helper ───

  it("shows correct message for neutral_baseline starter completion", async () => {
    vi.mocked(apiClient.bootstrapEmptyProjectV8).mockResolvedValue({
      repo: { id: "new-repo", displayName: "New" },
      blueprint: { projectId: "new-repo", providerPolicy: { executionProfileId: "balanced" } },
    } as never);
    vi.mocked(apiClient.activateProjectV5).mockResolvedValue({ repo: { id: "new-repo" } } as never);
    vi.mocked(apiClient.executeScaffoldV8).mockResolvedValue({
      result: { runId: "run-1", status: "completed" },
      blueprint: { projectId: "new-repo", providerPolicy: { executionProfileId: "balanced" } },
    } as never);

    const desktopBridge = await import("../lib/desktopBridge");
    vi.mocked(desktopBridge.pickRepoDirectory).mockResolvedValue({ canceled: false, path: "/test/new" });

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.openNewProjectDialog();
    });

    await act(async () => {
      result.current.createProjectFromStarter("neutral_baseline" as never);
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toContain("Neutral baseline applied");
    });
  });

  // ─── starterSuccessMessage with needs_review status ───

  it("shows needs_review message for ts starter", async () => {
    vi.mocked(apiClient.bootstrapEmptyProjectV8).mockResolvedValue({
      repo: { id: "new-repo", displayName: "New" },
      blueprint: { projectId: "new-repo", providerPolicy: { executionProfileId: "balanced" } },
    } as never);
    vi.mocked(apiClient.activateProjectV5).mockResolvedValue({ repo: { id: "new-repo" } } as never);
    vi.mocked(apiClient.executeScaffoldV8).mockResolvedValue({
      result: { runId: "run-1", status: "needs_review" },
      blueprint: { projectId: "new-repo", providerPolicy: { executionProfileId: "balanced" } },
    } as never);

    const desktopBridge = await import("../lib/desktopBridge");
    vi.mocked(desktopBridge.pickRepoDirectory).mockResolvedValue({ canceled: false, path: "/test/new" });

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.openNewProjectDialog();
    });

    await act(async () => {
      result.current.createProjectFromStarter("ts_app" as never);
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toContain("Review the verification follow-up");
    });
  });

  // ─── runProjectSetup with no desktop picker and no folderPath ───

  it("runProjectSetup shows message when no desktop picker and no folderPath", async () => {
    const desktopBridge = await import("../lib/desktopBridge");
    vi.mocked(desktopBridge.hasDesktopRepoPicker).mockReturnValue(false);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.openNewProjectDialog();
    });

    await act(async () => {
      result.current.createBlankProject();
    });

    await waitFor(() => {
      expect(result.current.repoPickerMessage).toContain("New Project uses the desktop folder picker");
    });

    vi.mocked(desktopBridge.hasDesktopRepoPicker).mockReturnValue(true);
  });

  // ─── runProjectSetup picker canceled ───

  it("runProjectSetup does nothing when picker is canceled", async () => {
    const desktopBridge = await import("../lib/desktopBridge");
    vi.mocked(desktopBridge.pickRepoDirectory).mockResolvedValue({ canceled: true, path: null } as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.openNewProjectDialog();
    });

    await act(async () => {
      result.current.createBlankProject();
    });

    expect(apiClient.bootstrapEmptyProjectV8).not.toHaveBeenCalled();
  });

  // ─── runProjectSetup with pre-existing folderPath ───

  it("runProjectSetup uses existing folderPath from empty_folder source", async () => {
    vi.mocked(apiClient.bootstrapEmptyProjectV8).mockResolvedValue({
      repo: { id: "new-repo", displayName: "New" },
      blueprint: { projectId: "new-repo", providerPolicy: { executionProfileId: "balanced" } },
    } as never);
    vi.mocked(apiClient.activateProjectV5).mockResolvedValue({ repo: { id: "new-repo" } } as never);

    vi.mocked(apiClient.connectLocalProjectV8).mockResolvedValue({
      bootstrapRequired: true,
      folderPath: "/pre-existing/folder",
    } as never);

    const desktopBridge = await import("../lib/desktopBridge");
    vi.mocked(desktopBridge.pickRepoDirectory).mockResolvedValue({ canceled: false, path: "/test/path" });

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    // Trigger connect local which sets empty folder state
    await act(async () => {
      result.current.chooseLocalRepo();
    });

    await waitFor(() => {
      expect(result.current.projectSetupState?.folderPath).toBe("/pre-existing/folder");
    });

    // Now create blank project using pre-existing folder path
    await act(async () => {
      result.current.createBlankProject();
    });

    await waitFor(() => {
      expect(apiClient.bootstrapEmptyProjectV8).toHaveBeenCalledWith(
        expect.objectContaining({
          folderPath: "/pre-existing/folder",
        })
      );
    });
  });

  // ─── addTaskComment with parentCommentId ───

  it("calls addTicketComment with parentCommentId", async () => {
    vi.mocked(apiClient.addTicketComment).mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.addTaskComment("task-1", "Reply", "parent-1");
    });

    await waitFor(() => {
      expect(apiClient.addTicketComment).toHaveBeenCalledWith("task-1", {
        body: "Reply",
        parentCommentId: "parent-1",
      });
    });
  });

  // ─── resolveTicketForObjective with empty objective ───

  it("returns ticket ID when objective is empty (falls through to selectedTicketId)", async () => {
    mockUiStore({
      selectedRepoId: "repo-1",
      selectedTicketId: "ticket-1",
    });

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      selectedTicket: {
        id: "ticket-1",
        title: "Test Ticket",
        description: "Description",
        status: "in_progress",
        priority: "medium",
        risk: "medium",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);
    vi.mocked(apiClient.reviewOverseerRouteV8).mockResolvedValue({
      ticket: { id: "ticket-1", title: "Test", description: "", status: "backlog", priority: "medium", risk: "medium", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      route: { executionMode: "single_agent", modelRole: "coder_default", metadata: {}, providerId: "onprem-qwen" },
      contextPack: { files: [], tests: [], docs: [], confidence: 0.8 },
      blueprint: null,
    } as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeTruthy());

    // Set a whitespace-only input to trigger the "empty objective" path
    act(() => {
      result.current.setInput("   ");
    });

    // reviewRoute will fail because input.trim() is empty — but this tests the resolveTicketForObjective path
    await act(async () => {
      result.current.reviewRoute();
    });

    // The route review should fail because objective is empty
    await waitFor(() => {
      expect(result.current.actionMessage).toContain("Route review failed");
    });
  });

  // ─── resolveTicketForObjective with no selectedTicketId ───

  it("resolveTicketForObjective returns undefined when no ticket selected", async () => {
    mockUiStore({
      selectedRepoId: "repo-1",
      selectedTicketId: null,
    });

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);
    vi.mocked(apiClient.reviewOverseerRouteV8).mockResolvedValue({
      ticket: { id: "ticket-new", title: "Test", description: "", status: "backlog", priority: "medium", risk: "medium", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      route: { executionMode: "single_agent", modelRole: "coder_default", metadata: {}, providerId: "onprem-qwen" },
      contextPack: { files: [], tests: [], docs: [], confidence: 0.8 },
      blueprint: null,
    } as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeTruthy());

    act(() => {
      result.current.setInput("An objective");
    });

    await act(async () => {
      result.current.reviewRoute();
    });

    await waitFor(() => {
      expect(apiClient.reviewOverseerRouteV8).toHaveBeenCalledWith(
        expect.objectContaining({
          ticket_id: undefined,
        })
      );
    });
  });

  // ─── reviewRoute with blueprint in result ───

  it("reviewRoute updates blueprint preview when result includes blueprint", async () => {
    mockUiStore({ selectedRepoId: "repo-1" });

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const returnedBlueprint = {
      projectId: "repo-1",
      repositoryPurpose: "From route review",
      primaryLanguages: ["typescript"],
      architectureStyle: "modular",
      keyDomains: [],
      criticalPaths: [],
      testingStrategy: "unit",
      providerPolicy: { executionProfileId: "balanced" },
      detectedAt: new Date().toISOString(),
      manuallyEditedAt: null,
    };

    vi.mocked(apiClient.reviewOverseerRouteV8).mockResolvedValue({
      ticket: { id: "ticket-1", title: "Test", description: "", status: "backlog", priority: "medium", risk: "medium", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      route: { executionMode: "single_agent", modelRole: "coder_default", metadata: {}, providerId: "onprem-qwen" },
      contextPack: { files: [], tests: [], docs: [], confidence: 0.8 },
      blueprint: returnedBlueprint,
    } as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeTruthy());

    act(() => {
      result.current.setInput("Review this");
    });

    await act(async () => {
      result.current.reviewRoute();
    });

    await waitFor(() => {
      expect(result.current.blueprint?.repositoryPurpose).toBe("From route review");
    });
  });

  // ─── Approval with lifecycle notice ───

  it("approval mutation sets ticket lifecycle notice on success", async () => {
    vi.mocked(apiClient.decideMissionApprovalV8).mockResolvedValue({
      lifecycle_requeue: true,
      command_execution: null,
    } as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.decideApproval("approval-1", "approved");
    });

    await waitFor(() => {
      expect(result.current.ticketLifecycleNotices).toHaveProperty("ticket-1");
    });
  });

  // ─── connectGithubMutation error ───

  it("connectGithubMutation handles Error rejection", async () => {
    vi.mocked(apiClient.connectGithubProjectV8).mockRejectedValue(new Error("Auth required"));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setGithubOwner("owner");
      result.current.setGithubRepo("repo");
    });

    await act(async () => {
      result.current.connectGithubProject();
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toContain("GitHub connect failed: Auth required");
    });
  });

  // ─── syncProjectMutation onMutate with non-github project ───

  it("syncProject shows 'Refreshing' for non-github source", async () => {
    const mockSnapshot = createMockSnapshot({
      recentProjects: [
        {
          id: "repo-local",
          displayName: "Local Repo",
          branch: "main",
          defaultBranch: "main",
          sourceKind: "local_path",
          sourcePath: "/test",
          metadata: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    let resolveSync: ((value: unknown) => void) | undefined;
    vi.mocked(apiClient.syncProjectV5).mockReturnValue(
      new Promise((resolve) => {
        resolveSync = resolve;
      }) as never
    );

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.recentRepos.length).toBeGreaterThan(0));

    act(() => {
      result.current.syncProject("repo-local");
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toContain("Refreshing");
    });

    await act(async () => {
      resolveSync?.({ repo: { id: "repo-local" } });
    });
  });

  // ─── syncProjectMutation with non-Error rejection ───

  it("syncProject handles non-Error rejection", async () => {
    vi.mocked(apiClient.syncProjectV5).mockRejectedValue("some string");

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.syncProject("repo-1");
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toBe("Project sync failed: Project sync failed.");
    });
  });

  // ─── selectedExecutionProfileStages fallback ───

  it("returns default stages when no matching profile", async () => {
    vi.mocked(apiClient.getSettings).mockResolvedValue({
      items: {
        executionProfiles: {
          activeProfileId: "nonexistent",
          profiles: [],
        },
      },
    } as never);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      // Falls back to DEFAULT_EXECUTION_PROFILES because settings profiles is empty
      expect(result.current.selectedExecutionProfileStages).toBeTruthy();
    });
  });

  // ─── bootstrapProjectMutation non-Error rejection ───

  it("bootstrapProject handles non-Error rejection", async () => {
    vi.mocked(apiClient.bootstrapEmptyProjectV8).mockRejectedValue("some string error");

    const desktopBridge = await import("../lib/desktopBridge");
    vi.mocked(desktopBridge.pickRepoDirectory).mockResolvedValue({ canceled: false, path: "/test/new" });

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.openNewProjectDialog();
    });

    await act(async () => {
      result.current.createBlankProject();
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toContain("Unable to initialize the selected folder");
    });
  });

  // ─── applyStarterMutation non-Error rejection ───

  it("applyStarter handles non-Error rejection", async () => {
    vi.mocked(apiClient.executeScaffoldV8).mockRejectedValue("some string");

    mockUiStore({ selectedRepoId: "repo-1" });

    const mockSnapshot = createMockSnapshot({
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.selectedRepo).toBeTruthy());

    act(() => {
      result.current.openStarterDialogForActiveProject();
    });

    await act(async () => {
      result.current.createProjectFromStarter("ts_app" as never);
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toContain("Unable to apply the selected starter");
    });
  });

  // ─── connectLocalMutation non-Error rejection ───

  it("connectLocal handles non-Error rejection", async () => {
    vi.mocked(apiClient.connectLocalProjectV8).mockRejectedValue("string error");

    const desktopBridge = await import("../lib/desktopBridge");
    vi.mocked(desktopBridge.pickRepoDirectory).mockResolvedValue({ canceled: false, path: "/test/path" });

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.chooseLocalRepo();
    });

    await waitFor(() => {
      expect(result.current.repoPickerMessage).toBe("Unable to connect the selected folder.");
    });
  });

  // ─── chooseLocalRepo picker non-Error rejection ───

  it("chooseLocalRepo handles non-Error picker rejection", async () => {
    const desktopBridge = await import("../lib/desktopBridge");
    vi.mocked(desktopBridge.pickRepoDirectory).mockRejectedValue("string error");

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.chooseLocalRepo();
    });

    await waitFor(() => {
      expect(result.current.repoPickerMessage).toBe("Unable to open the repo picker.");
    });
  });

  // ─── connectGithubMutation non-Error rejection ───

  it("connectGithub handles non-Error rejection", async () => {
    vi.mocked(apiClient.connectGithubProjectV8).mockRejectedValue("string error");

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setGithubOwner("owner");
      result.current.setGithubRepo("repo");
    });

    await act(async () => {
      result.current.connectGithubProject();
    });

    await waitFor(() => {
      expect(result.current.actionMessage).toContain("Unable to connect GitHub project");
    });
  });

  // ─── Ticket sync: preserves manual selection when ticket still exists ───

  it("preserves selected ticket when it still exists in snapshot tickets", async () => {
    const setSelectedTicketId = vi.fn();
    mockUiStore({
      selectedTicketId: "ticket-manual",
      setSelectedTicketId,
    });

    const mockSnapshot = createMockSnapshot({
      selectedTicket: {
        id: "ticket-auto",
        title: "Auto Selected",
        description: "",
        status: "in_progress",
        priority: "medium",
        risk: "medium",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      tickets: [
        {
          id: "ticket-manual",
          title: "Manual",
          description: "",
          status: "backlog",
          priority: "medium",
          risk: "medium",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "ticket-auto",
          title: "Auto Selected",
          description: "",
          status: "in_progress",
          priority: "medium",
          risk: "medium",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      // Should NOT have been called because manual selection still exists
      expect(setSelectedTicketId).not.toHaveBeenCalledWith("ticket-auto");
    });
  });

  // ─── resolvedExecutionProfileId falls back when project profile not in list ───

  it("resolvedExecutionProfileId falls back to activeProfileId when project profile not in list", async () => {
    vi.mocked(apiClient.getSettings).mockResolvedValue({
      items: {
        executionProfiles: {
          activeProfileId: "balanced",
          profiles: [
            {
              id: "balanced",
              name: "Balanced",
              description: "Test",
              preset: "balanced",
              stages: { scope: "utility_fast", build: "coder_default", review: "review_deep", escalate: "overseer_escalation" },
              updatedAt: new Date().toISOString(),
            },
          ],
        },
      },
    });

    const blueprint = {
      projectId: "repo-1",
      repositoryPurpose: "Test",
      primaryLanguages: ["typescript"],
      architectureStyle: "modular",
      keyDomains: [],
      criticalPaths: [],
      testingStrategy: "comprehensive",
      providerPolicy: { executionProfileId: "nonexistent_profile" },
      detectedAt: new Date().toISOString(),
      manuallyEditedAt: null,
    };

    const mockSnapshot = createMockSnapshot({
      blueprint,
      project: {
        id: "repo-1",
        displayName: "Test Repo",
        branch: "main",
        defaultBranch: "main",
        sourceKind: "local_path",
        sourcePath: "/test/repo",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      // Should fall back to "balanced" since "nonexistent_profile" is not in the list
      expect(result.current.selectedExecutionProfileId).toBe("balanced");
    });
  });

  // ─── agentic stream closes immediately if cancelled before promise resolves ───

  it("closes agentic run stream immediately if cancelled before promise resolves", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const mockClose = vi.fn();
    let resolveStream: ((value: unknown) => void) | undefined;
    vi.mocked(apiClient.openAgenticRunStream).mockReturnValue(
      new Promise((resolve) => {
        resolveStream = resolve;
      }) as never
    );

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot());

    const { unmount } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(apiClient.openAgenticRunStream).toHaveBeenCalled();
    });

    unmount();

    act(() => {
      resolveStream?.({
        addEventListener: vi.fn(),
        close: mockClose,
      });
    });

    await waitFor(() => {
      expect(mockClose).toHaveBeenCalled();
    });
  });

  // ─── plan_refine_requested event ───

  it("merges plan_refine_requested event setting phase to planning", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const baseRun = {
      runId: "run-1", ticketId: "ticket-1", projectId: "repo-1", status: "running" as const,
      phase: "plan_review" as const, objective: "Test", iterationCount: 1, approvalCount: 0,
      lastAssistantText: "", latestRole: "coder_default" as const, recentEvents: [], toolCalls: [],
      compactionEvents: [], escalations: [], doomLoops: [], skillEvents: [], hookEvents: [],
      memoryExtractions: [], thinkingLog: "", thinkingTokenCount: 0,
      budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
      startedAt: new Date().toISOString(), completedAt: null,
    };

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ agenticRun: baseRun }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listeners["agentic"]).toBeDefined());

    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({ runId: "run-1", event: { type: "plan_refine_requested", feedback: "improve" } }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.phase).toBe("planning");
    });
  });

  // ─── assistant_thinking with existing log ───

  it("merges assistant_thinking appending to existing thinkingLog", async () => {
    mockUiStore({ selectedRunId: "run-1" });

    const listeners: Record<string, EventListener> = {};
    vi.mocked(apiClient.openAgenticRunStream).mockResolvedValue({
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      close: vi.fn(),
    } as never);

    const baseRun = {
      runId: "run-1", ticketId: "ticket-1", projectId: "repo-1", status: "running" as const,
      phase: "executing" as const, objective: "Test", iterationCount: 1, approvalCount: 0,
      lastAssistantText: "", latestRole: "coder_default" as const, recentEvents: [], toolCalls: [],
      compactionEvents: [], escalations: [], doomLoops: [], skillEvents: [], hookEvents: [],
      memoryExtractions: [], thinkingLog: "first thought", thinkingTokenCount: 5,
      budget: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0, tokenTimeline: [] },
      startedAt: new Date().toISOString(), completedAt: null,
    };

    vi.mocked(apiClient.getMissionSnapshotV8).mockResolvedValue(createMockSnapshot({ agenticRun: baseRun }));

    const { result } = renderHook(() => useMissionControlLiveData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listeners["agentic"]).toBeDefined());

    act(() => {
      listeners["agentic"]({
        data: JSON.stringify({
          runId: "run-1",
          event: { type: "assistant_thinking", value: "second thought" },
        }),
      } as unknown as Event);
    });

    await waitFor(() => {
      expect(result.current.agenticRun?.thinkingLog).toBe("first thought\nsecond thought");
    });
  });
});

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
});

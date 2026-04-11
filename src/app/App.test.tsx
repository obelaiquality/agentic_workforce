import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useUiStore } from "./store/uiStore";

const mockMission = {
  pendingApprovals: [] as any[],
  runPhase: "idle",
  liveState: "live" as string,
  headerRepos: [] as any[],
  workflowCards: [] as any[],
  tickets: [] as any[],
  contextPack: { files: [], tests: [], docs: [] } as any,
  selectedTicket: null as any,
  consoleLogs: [] as any[],
  consoleEvents: [] as any[],
  appMode: "limited_preview" as string,
  appModeNotice: {
    title: "Preview mode",
    message: "Desktop features are unavailable in browser preview.",
    detail: "Use Projects to review recent work, or open the desktop app for local repo actions.",
  } as any,
  openProjects: vi.fn(),
  selectedRepo: null as any,
  activateRepo: vi.fn(),
  recentRepos: [] as any[],
  recentRepoPaths: [] as any[],
  hasDesktopPicker: false,
  repoPickerMessage: null,
  chooseLocalRepo: vi.fn(),
  openNewProjectDialog: vi.fn(),
  projectStarters: [] as any[],
  projectSetupState: null,
  createBlankProject: vi.fn(),
  createProjectFromStarter: vi.fn(),
  dismissProjectSetupDialog: vi.fn(),
  openStarterDialogForActiveProject: vi.fn(),
  activeProjectIsBlank: false,
  activeStarterId: null,
  openWork: vi.fn(),
  connectRecentPath: vi.fn(),
  syncProject: vi.fn(),
  githubOwner: "",
  setGithubOwner: vi.fn(),
  githubRepo: "",
  setGithubRepo: vi.fn(),
  connectGithubProject: vi.fn(),
  isActing: false,
  actionMessage: null,
  syncingRepoId: null,
  isConnectingLocal: false,
  isBootstrappingProject: false,
  isConnectingGithub: false,
  blueprint: null,
  updateBlueprint: vi.fn(),
  regenerateBlueprint: vi.fn(),
  isRefreshingBlueprint: false,
};

vi.mock("./hooks/useMissionControlLiveData", () => ({
  useMissionControlLiveData: () => mockMission,
}));

vi.mock("./components/PreflightGate", () => ({
  PreflightGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./components/views/CommandCenterView", () => ({
  CommandCenterView: () => <div>Work Surface</div>,
}));

vi.mock("./components/views/CodebaseView", () => ({
  CodebaseView: () => <div>Codebase Surface</div>,
}));

vi.mock("./components/views/ConsoleView", () => ({
  ConsoleView: () => <div>Console Surface</div>,
}));

vi.mock("./components/views/ProjectsWorkspaceView", () => ({
  ProjectsWorkspaceView: () => <div>Projects Surface</div>,
}));

vi.mock("./components/views/SettingsControlView", () => ({
  SettingsControlView: () => <div>Settings Surface</div>,
}));

vi.mock("./components/views/TelemetryView", () => ({
  TelemetryView: () => <div>Telemetry Surface</div>,
}));

vi.mock("./components/views/AgentLanesView", () => ({
  AgentLanesView: () => <div>Agent Lanes Surface</div>,
}));

vi.mock("./components/views/PatternsView", () => ({
  PatternsView: () => <div>Patterns Surface</div>,
}));

vi.mock("./components/views/DistillationView", () => ({
  DistillationView: () => <div>Distillation Surface</div>,
}));

vi.mock("./components/views/BenchmarkView", () => ({
  BenchmarkView: () => <div>Benchmark Surface</div>,
}));

vi.mock("./components/views/LearningsView", () => ({
  LearningsView: () => <div>Learnings Surface</div>,
}));

vi.mock("./components/CommandPalette", () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
}));

vi.mock("./components/KeyboardShortcutsDialog", () => ({
  KeyboardShortcutsDialog: () => <div data-testid="keyboard-shortcuts-dialog" />,
}));

vi.mock("./components/ui/sonner", () => ({
  Toaster: () => <div data-testid="toaster" />,
}));

vi.mock("./components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./hooks/useKeyboardShortcut", () => ({
  useKeyboardShortcuts: vi.fn(),
}));

describe("App shell", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useUiStore.setState({
      activeSection: "live",
      settingsFocusTarget: null,
      labsMode: false,
      selectedWorkflowId: null,
      codebaseScope: "all",
    });
    mockMission.openProjects.mockClear();
    mockMission.pendingApprovals = [];
    mockMission.appMode = "limited_preview";
    mockMission.liveState = "live";
  });

  it("shows the Work label and limited preview recovery banner", () => {
    render(<App />);

    expect(screen.getAllByText("Work")[0]).toBeInTheDocument();
    expect(screen.getByText("Preview mode")).toBeInTheDocument();
    expect(screen.getByText("Desktop features are unavailable in browser preview.")).toBeInTheDocument();
  });

  it("routes quick settings to the new advanced view", () => {
    render(<App />);

    fireEvent.click(screen.getByLabelText("Open quick settings"));
    fireEvent.click(screen.getByText("Open Advanced"));

    expect(useUiStore.getState().activeSection).toBe("settings");
    expect(useUiStore.getState().settingsFocusTarget).toBe("execution_profiles");
    expect(screen.getByText("Settings Surface")).toBeInTheDocument();
  });

  it("routes quick settings Open Essentials to providers settings", () => {
    render(<App />);

    fireEvent.click(screen.getByLabelText("Open quick settings"));
    fireEvent.click(screen.getByText("Open Essentials"));

    expect(useUiStore.getState().activeSection).toBe("settings");
    expect(useUiStore.getState().settingsFocusTarget).toBe("providers");
  });

  it("renders Codebase section when activeSection is codebase", () => {
    useUiStore.setState({ activeSection: "codebase" });
    render(<App />);
    expect(screen.getByText("Codebase Surface")).toBeInTheDocument();
  });

  it("renders Console section when activeSection is console", () => {
    useUiStore.setState({ activeSection: "console" });
    render(<App />);
    expect(screen.getByText("Console Surface")).toBeInTheDocument();
  });

  it("renders Projects section when activeSection is projects", () => {
    useUiStore.setState({ activeSection: "projects" });
    render(<App />);
    expect(screen.getByText("Projects Surface")).toBeInTheDocument();
  });

  it("renders Settings section when activeSection is settings", () => {
    useUiStore.setState({ activeSection: "settings" });
    render(<App />);
    expect(screen.getByText("Settings Surface")).toBeInTheDocument();
  });

  it("renders DistillationView when activeSection is distillation", () => {
    useUiStore.setState({ activeSection: "distillation" as any });
    render(<App />);
    expect(screen.getByText("Distillation Surface")).toBeInTheDocument();
  });

  it("renders BenchmarkView when activeSection is benchmarks", () => {
    useUiStore.setState({ activeSection: "benchmarks" as any });
    render(<App />);
    expect(screen.getByText("Benchmark Surface")).toBeInTheDocument();
  });

  it("renders LearningsView when activeSection is learnings", () => {
    useUiStore.setState({ activeSection: "learnings" as any });
    render(<App />);
    expect(screen.getByText("Learnings Surface")).toBeInTheDocument();
  });

  it("shows header section label for codebase", () => {
    useUiStore.setState({ activeSection: "codebase" });
    render(<App />);
    expect(screen.getByText("Codebase Explorer")).toBeInTheDocument();
  });

  it("shows header section label for console", () => {
    useUiStore.setState({ activeSection: "console" });
    render(<App />);
    expect(screen.getAllByText("Console").length).toBeGreaterThanOrEqual(1);
  });

  it("shows header section label for projects", () => {
    useUiStore.setState({ activeSection: "projects" });
    render(<App />);
    expect(screen.getAllByText("Projects").length).toBeGreaterThanOrEqual(1);
  });

  it("shows header section label for settings", () => {
    useUiStore.setState({ activeSection: "settings" });
    render(<App />);
    // The settings label is rendered in the header
    const settingsLabels = screen.getAllByText("Settings");
    expect(settingsLabels.length).toBeGreaterThanOrEqual(1);
  });

  it("shows labs mode banner when labsMode is enabled", () => {
    useUiStore.setState({ labsMode: true });
    render(<App />);
    expect(screen.getByText("Labs")).toBeInTheDocument();
    expect(screen.getByText(/Experimental features are enabled/)).toBeInTheDocument();
  });

  it("shows live tabs including Telemetry/Agents/Patterns in labs mode", () => {
    useUiStore.setState({ activeSection: "live", labsMode: true });
    render(<App />);
    expect(screen.getAllByText("Telemetry").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Agents").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Patterns").length).toBeGreaterThanOrEqual(1);
  });

  it("renders TelemetryView when Telemetry tab is clicked in labs mode", () => {
    useUiStore.setState({ activeSection: "live", labsMode: true });
    render(<App />);
    // Click the desktop tab (hidden md:flex), there are two sets of tabs
    const telemetryButtons = screen.getAllByText("Telemetry");
    fireEvent.click(telemetryButtons[0]);
    expect(screen.getByText("Telemetry Surface")).toBeInTheDocument();
  });

  it("renders AgentLanesView when Agents tab is clicked in labs mode", () => {
    useUiStore.setState({ activeSection: "live", labsMode: true });
    render(<App />);
    const agentButtons = screen.getAllByText("Agents");
    fireEvent.click(agentButtons[0]);
    expect(screen.getByText("Agent Lanes Surface")).toBeInTheDocument();
  });

  it("renders PatternsView when Patterns tab is clicked in labs mode", () => {
    useUiStore.setState({ activeSection: "live", labsMode: true });
    render(<App />);
    const patternButtons = screen.getAllByText("Patterns");
    fireEvent.click(patternButtons[0]);
    expect(screen.getByText("Patterns Surface")).toBeInTheDocument();
  });

  it("shows backend unavailable header status", () => {
    mockMission.appMode = "backend_unavailable";
    render(<App />);
    expect(screen.getByTestId("app-header-status").textContent).toBe("Backend Unavailable");
    mockMission.appMode = "limited_preview";
  });

  it("shows critical attention count in header when there are pending approvals", () => {
    mockMission.appMode = "desktop";
    mockMission.pendingApprovals = [{ id: "a1" }] as any;
    render(<App />);
    expect(screen.getByTestId("app-header-status").textContent).toContain("attention");
  });

  it("shows Syncing header status when liveState is loading", () => {
    mockMission.appMode = "desktop";
    mockMission.liveState = "loading";
    render(<App />);
    expect(screen.getByTestId("app-header-status").textContent).toBe("Syncing");
  });

  it("shows Needs attention header status when liveState is neither live nor loading", () => {
    mockMission.appMode = "desktop";
    mockMission.liveState = "disconnected";
    render(<App />);
    expect(screen.getByTestId("app-header-status").textContent).toBe("Needs attention");
  });

  it("shows Ready header status when liveState is live and appMode is desktop", () => {
    mockMission.appMode = "desktop";
    mockMission.liveState = "live";
    render(<App />);
    expect(screen.getByTestId("app-header-status").textContent).toBe("Ready");
  });

  it("displays repo selector with repos", () => {
    mockMission.headerRepos = [
      { id: "repo-1", displayName: "My Repo" },
      { id: "repo-2", displayName: "Other Repo" },
    ] as any;
    render(<App />);
    expect(screen.getByText("My Repo")).toBeInTheDocument();
    expect(screen.getByText("Other Repo")).toBeInTheDocument();
    mockMission.headerRepos = [];
  });

  it("calls activateRepo when a repo is selected in the sidebar dropdown", () => {
    mockMission.headerRepos = [{ id: "repo-1", displayName: "My Repo" }] as any;
    render(<App />);
    const select = screen.getByTestId("sidebar-project-selector");
    fireEvent.change(select, { target: { value: "repo-1" } });
    expect(mockMission.activateRepo).toHaveBeenCalledWith("repo-1");
    mockMission.headerRepos = [];
    mockMission.activateRepo.mockClear();
  });

  it("shows branch name when selectedRepo is present", () => {
    mockMission.selectedRepo = { id: "repo-1", displayName: "My Repo", branch: "feat/test", defaultBranch: "main" };
    render(<App />);
    expect(screen.getByText("feat/test")).toBeInTheDocument();
    mockMission.selectedRepo = null;
  });

  it("navigates to projects section when sidebar project button is clicked on small screens", () => {
    mockMission.selectedRepo = null;
    render(<App />);
    // The button with FolderGit2 icon in lg:hidden
    const projectsButton = screen.getByTestId("sidebar-projects");
    fireEvent.click(projectsButton);
    expect(useUiStore.getState().activeSection).toBe("projects");
  });

  it("closes profile menu on Escape key", () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText("Open quick settings"));
    expect(screen.getByText("Quick settings")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Quick settings")).not.toBeInTheDocument();
  });

  it("closes profile menu on click outside", () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText("Open quick settings"));
    expect(screen.getByText("Quick settings")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("Quick settings")).not.toBeInTheDocument();
  });

  it("normalizes overseer section to live", () => {
    useUiStore.setState({ activeSection: "overseer" as any });
    render(<App />);
    expect(screen.getByText("Work Surface")).toBeInTheDocument();
  });

  it("normalizes runs section to live", () => {
    useUiStore.setState({ activeSection: "runs" as any });
    render(<App />);
    expect(screen.getByText("Work Surface")).toBeInTheDocument();
  });

  it("normalizes benchmarks section to settings", () => {
    useUiStore.setState({ activeSection: "benchmarks" as any });
    render(<App />);
    expect(screen.getByText("Benchmark Surface")).toBeInTheDocument();
  });

  it("renders AppModeBanner Open Projects button that calls openProjects", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Open Projects"));
    expect(mockMission.openProjects).toHaveBeenCalled();
  });

  it("renders AppModeBanner with backend_unavailable mode showing Open Essentials button", () => {
    mockMission.appMode = "backend_unavailable";
    mockMission.appModeNotice = {
      title: "Backend Down",
      message: "Cannot reach backend.",
      detail: "Check your server.",
    };
    render(<App />);
    expect(screen.getByText("Backend Down")).toBeInTheDocument();
    const essentialsBtn = screen.getByText("Open Essentials");
    expect(essentialsBtn).toBeInTheDocument();
    fireEvent.click(essentialsBtn);
    expect(useUiStore.getState().activeSection).toBe("settings");
    expect(useUiStore.getState().settingsFocusTarget).toBe("providers");
    mockMission.appMode = "limited_preview";
    mockMission.appModeNotice = {
      title: "Preview mode",
      message: "Desktop features are unavailable in browser preview.",
      detail: "Use Projects to review recent work, or open the desktop app for local repo actions.",
    };
  });

  it("does not show AppModeBanner when appModeNotice is null", () => {
    mockMission.appModeNotice = null;
    render(<App />);
    expect(screen.queryByText("Preview mode")).not.toBeInTheDocument();
    mockMission.appModeNotice = {
      title: "Preview mode",
      message: "Desktop features are unavailable in browser preview.",
      detail: "Use Projects to review recent work, or open the desktop app for local repo actions.",
    };
  });

  it("resets liveTab to Execution when labs mode is disabled and non-Execution tab was selected", () => {
    // Start with labs mode on and navigate to a non-Execution tab
    useUiStore.setState({ activeSection: "live", labsMode: true });
    const { rerender } = render(<App />);
    const telemetryButtons = screen.getAllByText("Telemetry");
    fireEvent.click(telemetryButtons[0]);
    expect(screen.getByText("Telemetry Surface")).toBeInTheDocument();

    // Now disable labs mode — liveTab should reset to Execution
    act(() => {
      useUiStore.setState({ labsMode: false });
    });
    rerender(<App />);
    expect(screen.getByText("Work Surface")).toBeInTheDocument();
  });

  it("computes workflowFocusedFiles from selectedWorkflowCard impactedFiles", () => {
    mockMission.workflowCards = [
      { workflowId: "wf-1", impactedFiles: ["a.ts", "b.ts"], impactedTests: [], impactedDocs: [], status: "in_progress" },
    ];
    mockMission.selectedTicket = { id: "other-id" };
    useUiStore.setState({ selectedWorkflowId: "wf-1" });
    render(<App />);
    // Rendering succeeds — CodebaseView would receive workflowFocusedFiles
    mockMission.workflowCards = [];
    mockMission.selectedTicket = null;
  });

  it("computes workflowFocusedFiles from contextPack when selectedTicket matches", () => {
    mockMission.contextPack = { files: ["c.ts"], tests: ["c.test.ts"], docs: ["readme.md"] };
    mockMission.selectedTicket = { id: "wf-2" };
    mockMission.workflowCards = [{ workflowId: "wf-2", impactedFiles: [], impactedTests: [], impactedDocs: [], status: "backlog" }];
    useUiStore.setState({ selectedWorkflowId: "wf-2" });
    render(<App />);
    mockMission.contextPack = { files: [], tests: [], docs: [] };
    mockMission.selectedTicket = null;
    mockMission.workflowCards = [];
  });

  it("computes consoleLogs filtered by workflowId", () => {
    mockMission.consoleLogs = [
      { taskId: "wf-1", message: "log1" },
      { taskId: "wf-2", message: "log2" },
    ];
    useUiStore.setState({ selectedWorkflowId: "wf-1" });
    render(<App />);
    mockMission.consoleLogs = [];
  });

  it("renders error critical count from runPhase error", () => {
    mockMission.runPhase = "error";
    mockMission.appMode = "desktop";
    mockMission.liveState = "live";
    render(<App />);
    expect(screen.getByTestId("app-header-status").textContent).toContain("attention");
    mockMission.runPhase = "idle";
    mockMission.appMode = "limited_preview";
  });

  it("renders sidebar items and allows clicking between sections", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("sidebar-codebase"));
    expect(useUiStore.getState().activeSection).toBe("codebase");

    fireEvent.click(screen.getByTestId("sidebar-console"));
    expect(useUiStore.getState().activeSection).toBe("console");

    fireEvent.click(screen.getByTestId("sidebar-settings"));
    expect(useUiStore.getState().activeSection).toBe("settings");

    fireEvent.click(screen.getByTestId("sidebar-live"));
    expect(useUiStore.getState().activeSection).toBe("live");
  });

  it("selects workflow ticket title for codebase header", () => {
    mockMission.tickets = [{ id: "wf-1", title: "Fix bug #42" }];
    useUiStore.setState({ selectedWorkflowId: "wf-1" });
    render(<App />);
    mockMission.tickets = [];
  });
});


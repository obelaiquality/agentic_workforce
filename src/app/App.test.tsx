import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useUiStore } from "./store/uiStore";

const mockMission = {
  pendingApprovals: [],
  runPhase: "idle",
  liveState: "live",
  headerRepos: [],
  workflowCards: [],
  tickets: [],
  contextPack: { files: [], tests: [], docs: [] },
  selectedTicket: null,
  consoleLogs: [],
  appMode: "limited_preview" as const,
  appModeNotice: {
    title: "Preview mode",
    message: "Desktop features are unavailable in browser preview.",
    detail: "Use Projects to review recent work, or open the desktop app for local repo actions.",
  },
  openProjects: vi.fn(),
  selectedRepo: null,
  activateRepo: vi.fn(),
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
});


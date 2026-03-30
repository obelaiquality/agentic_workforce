import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectsWorkspaceView } from "./ProjectsWorkspaceView";

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    activeRepo: null,
    recentRepos: [
      {
        id: "repo-1",
        displayName: "Agentic Workforce",
        branch: "main",
        defaultBranch: "main",
        active: false,
        sourceKind: "local_directory",
        metadata: {},
      },
    ],
    recentRepoPaths: [],
    hasDesktopPicker: false,
    repoPickerMessage: null,
    chooseLocalRepo: vi.fn(),
    openNewProjectDialog: vi.fn(),
    projectStarters: [
      {
        id: "neutral_baseline",
        label: "Neutral Baseline",
        description: "Create a minimal README, repo charter, and generic ignore file without choosing a stack.",
        kind: "generic",
        recommended: true,
        verificationMode: "none",
      },
      {
        id: "typescript_vite_react",
        label: "TypeScript App",
        description: "Scaffold the current Vite + React + TypeScript starter and verify it.",
        kind: "stack",
        recommended: false,
        verificationMode: "commands",
      },
    ],
    projectSetupState: null,
    createBlankProject: vi.fn(),
    createProjectFromStarter: vi.fn(),
    dismissProjectSetupDialog: vi.fn(),
    openStarterDialogForActiveProject: vi.fn(),
    activeProjectIsBlank: false,
    activeStarterId: null,
    openWork: vi.fn(),
    openRecentPath: vi.fn(),
    activateRepo: vi.fn(),
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
    labsMode: false,
    ...overrides,
  };
}

describe("ProjectsWorkspaceView", () => {
  it("shows My Projects tab by default with no active project guidance", () => {
    render(<ProjectsWorkspaceView {...makeProps()} />);

    expect(screen.getByRole("button", { name: "My Projects" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect New" })).toBeInTheDocument();
    expect(screen.getByText("No active project")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect a project/ })).toBeInTheDocument();
  });

  it("opens the starter dialog and shows blank-first choices", () => {
    const props = makeProps({
      projectSetupState: {
        mode: "create",
        source: "new_project",
      },
    });

    render(<ProjectsWorkspaceView {...props} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Blank Project")).toBeInTheDocument();
    expect(screen.getByText("Neutral Baseline")).toBeInTheDocument();
    expect(screen.getByText("TypeScript App")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Create a managed Git repo with no stack assumptions/i }));
    expect(props.createBlankProject).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /TypeScript App/i }));
    expect(props.createProjectFromStarter).toHaveBeenCalledWith("typescript_vite_react");
  });

  it("shows active project card with Go to Work and Apply Starter buttons", () => {
    const props = makeProps({
      activeRepo: {
        id: "repo-blank",
        displayName: "Blank Starterless Repo",
        branch: "main",
        defaultBranch: "main",
        active: true,
        sourceKind: "local_attached",
        metadata: {
          creation_mode: "blank",
        },
      },
      activeProjectIsBlank: true,
    });

    render(<ProjectsWorkspaceView {...props} />);

    expect(screen.getByText("Blank Starterless Repo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to Work" }));
    expect(props.openWork).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply Starter" }));
    expect(props.openStarterDialogForActiveProject).toHaveBeenCalled();
  });
});

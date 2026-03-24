import { render, screen } from "@testing-library/react";
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
      },
    ],
    recentRepoPaths: [],
    hasDesktopPicker: false,
    repoPickerMessage: null,
    chooseLocalRepo: vi.fn(),
    startNewProject: vi.fn(),
    newProjectTemplate: "typescript_vite_react" as const,
    setNewProjectTemplate: vi.fn(),
    initializeNewProject: vi.fn(),
    pendingBootstrap: null,
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
  it("keeps repo connection in Projects and shows limited browser guidance", () => {
    render(<ProjectsWorkspaceView {...makeProps()} />);

    expect(screen.getByText("Connect or Create")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose Local Repo" })).toBeInTheDocument();
    expect(screen.getByText("Project connection lives here. Once a project is active, switch back to Work to plan and run tasks.")).toBeInTheDocument();
    expect(screen.getByText("Browser preview is limited. Use the desktop app for the repo picker and full local task execution.")).toBeInTheDocument();
    expect(screen.getByText("Recent Projects")).toBeInTheDocument();
  });
});

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApprovalInline, SmallMetric, DetailBlock, ProofCard } from "./ApprovalInline";

describe("ApprovalInline", () => {
  it("renders the empty state with welcome message", () => {
    render(
      <ApprovalInline
        recentProjects={[]}
        recentRepoPaths={[]}
        activateRepo={vi.fn()}
        openRecentPath={vi.fn()}
        openProjects={vi.fn()}
        appMode="desktop"
        appModeNotice={null}
      />,
    );
    expect(screen.getByTestId("work-empty-state")).toBeInTheDocument();
    expect(screen.getByText("Welcome to Agentic Workforce")).toBeInTheDocument();
  });

  it("renders recent projects when provided", () => {
    const repos = [
      { id: "repo-1", displayName: "my-project", branch: "main" },
    ] as any;

    render(
      <ApprovalInline
        recentProjects={repos}
        recentRepoPaths={[]}
        activateRepo={vi.fn()}
        openRecentPath={vi.fn()}
        openProjects={vi.fn()}
        appMode="desktop"
        appModeNotice={null}
      />,
    );
    expect(screen.getByText("my-project")).toBeInTheDocument();
  });

  it("calls openProjects when the connect repo button is clicked", () => {
    const openProjects = vi.fn();
    render(
      <ApprovalInline
        recentProjects={[]}
        recentRepoPaths={[]}
        activateRepo={vi.fn()}
        openRecentPath={vi.fn()}
        openProjects={openProjects}
        appMode="desktop"
        appModeNotice={null}
      />,
    );
    fireEvent.click(screen.getByTestId("work-connect-repo"));
    expect(openProjects).toHaveBeenCalledTimes(1);
  });

  it("renders multiple recent projects and calls activateRepo on click", () => {
    const activateRepo = vi.fn();
    const repos = [
      { id: "repo-1", displayName: "Alpha", branch: "main" },
      { id: "repo-2", displayName: "Beta", branch: null, defaultBranch: "develop" },
      { id: "repo-3", displayName: "Gamma", branch: null, defaultBranch: null },
    ] as any;

    render(
      <ApprovalInline
        recentProjects={repos}
        recentRepoPaths={[]}
        activateRepo={activateRepo}
        openRecentPath={vi.fn()}
        openProjects={vi.fn()}
        appMode="desktop"
        appModeNotice={null}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
    // Branch fallback display: branch -> defaultBranch -> "main"
    expect(screen.getByText("develop")).toBeInTheDocument();
    // Gamma has no branch or defaultBranch, so shows "main"
    const mainEntries = screen.getAllByText("main");
    expect(mainEntries.length).toBeGreaterThanOrEqual(2); // Alpha's "main" + Gamma's fallback "main"

    fireEvent.click(screen.getByText("Beta"));
    expect(activateRepo).toHaveBeenCalledWith("repo-2");
  });

  it("limits recent projects to 3", () => {
    const repos = [
      { id: "r1", displayName: "P1", branch: "main" },
      { id: "r2", displayName: "P2", branch: "main" },
      { id: "r3", displayName: "P3", branch: "main" },
      { id: "r4", displayName: "P4", branch: "main" },
    ] as any;

    render(
      <ApprovalInline
        recentProjects={repos}
        recentRepoPaths={[]}
        activateRepo={vi.fn()}
        openRecentPath={vi.fn()}
        openProjects={vi.fn()}
        appMode="desktop"
        appModeNotice={null}
      />,
    );
    expect(screen.getByText("P1")).toBeInTheDocument();
    expect(screen.getByText("P3")).toBeInTheDocument();
    expect(screen.queryByText("P4")).not.toBeInTheDocument();
  });

  it("renders recentRepoPaths when recentProjects is empty and calls openRecentPath", () => {
    const openRecentPath = vi.fn();
    const paths = [
      { path: "/home/user/project-a", label: "project-a" },
      { path: "/home/user/project-b", label: "project-b" },
    ];

    render(
      <ApprovalInline
        recentProjects={[]}
        recentRepoPaths={paths}
        activateRepo={vi.fn()}
        openRecentPath={openRecentPath}
        openProjects={vi.fn()}
        appMode="desktop"
        appModeNotice={null}
      />,
    );
    expect(screen.getByText("project-a")).toBeInTheDocument();
    expect(screen.getByText("/home/user/project-a")).toBeInTheDocument();
    expect(screen.getByText("project-b")).toBeInTheDocument();

    fireEvent.click(screen.getByText("project-a"));
    expect(openRecentPath).toHaveBeenCalledWith("/home/user/project-a", "project-a");
  });

  it("limits recentRepoPaths to 3", () => {
    const paths = [
      { path: "/p1", label: "p1" },
      { path: "/p2", label: "p2" },
      { path: "/p3", label: "p3" },
      { path: "/p4", label: "p4" },
    ];

    render(
      <ApprovalInline
        recentProjects={[]}
        recentRepoPaths={paths}
        activateRepo={vi.fn()}
        openRecentPath={vi.fn()}
        openProjects={vi.fn()}
        appMode="desktop"
        appModeNotice={null}
      />,
    );
    expect(screen.getByText("p1")).toBeInTheDocument();
    expect(screen.getByText("p3")).toBeInTheDocument();
    expect(screen.queryByText("p4")).not.toBeInTheDocument();
  });

  it("does not render recentRepoPaths if recentProjects exist", () => {
    const repos = [
      { id: "repo-1", displayName: "my-project", branch: "main" },
    ] as any;
    const paths = [
      { path: "/home/user/other", label: "other" },
    ];

    render(
      <ApprovalInline
        recentProjects={repos}
        recentRepoPaths={paths}
        activateRepo={vi.fn()}
        openRecentPath={vi.fn()}
        openProjects={vi.fn()}
        appMode="desktop"
        appModeNotice={null}
      />,
    );
    expect(screen.getByText("my-project")).toBeInTheDocument();
    expect(screen.queryByText("other")).not.toBeInTheDocument();
  });

  it("renders backend_unavailable app mode notice with rose styling", () => {
    render(
      <ApprovalInline
        recentProjects={[]}
        recentRepoPaths={[]}
        activateRepo={vi.fn()}
        openRecentPath={vi.fn()}
        openProjects={vi.fn()}
        appMode="backend_unavailable"
        appModeNotice={{ message: "Backend offline", detail: "Restart server" }}
      />,
    );
    expect(screen.getByText("Backend offline")).toBeInTheDocument();
    expect(screen.getByText("Restart server")).toBeInTheDocument();
  });

  it("renders non-backend_unavailable app mode notice with amber styling", () => {
    render(
      <ApprovalInline
        recentProjects={[]}
        recentRepoPaths={[]}
        activateRepo={vi.fn()}
        openRecentPath={vi.fn()}
        openProjects={vi.fn()}
        appMode="limited"
        appModeNotice={{ message: "Running in limited mode", detail: "Some features restricted" }}
      />,
    );
    expect(screen.getByText("Running in limited mode")).toBeInTheDocument();
    expect(screen.getByText("Some features restricted")).toBeInTheDocument();
  });

  it("does not render recent projects section when both lists are empty", () => {
    render(
      <ApprovalInline
        recentProjects={[]}
        recentRepoPaths={[]}
        activateRepo={vi.fn()}
        openRecentPath={vi.fn()}
        openProjects={vi.fn()}
        appMode="desktop"
        appModeNotice={null}
      />,
    );
    expect(screen.queryByText("Recent projects")).not.toBeInTheDocument();
  });

  it("renders the onboarding step cards", () => {
    render(
      <ApprovalInline
        recentProjects={[]}
        recentRepoPaths={[]}
        activateRepo={vi.fn()}
        openRecentPath={vi.fn()}
        openProjects={vi.fn()}
        appMode="desktop"
        appModeNotice={null}
      />,
    );
    expect(screen.getByText("Connect")).toBeInTheDocument();
    expect(screen.getByText("Describe")).toBeInTheDocument();
    expect(screen.getByText("Verify")).toBeInTheDocument();
    expect(screen.getByText("Link a local repo")).toBeInTheDocument();
    expect(screen.getByText("Write a task prompt")).toBeInTheDocument();
    expect(screen.getByText("Review proven output")).toBeInTheDocument();
  });
});

describe("SmallMetric", () => {
  it("renders as a div without onClick", () => {
    render(<SmallMetric icon={<span>I</span>} label="Count" />);
    expect(screen.getByText("Count")).toBeInTheDocument();
    expect(screen.getByText("I")).toBeInTheDocument();
    // Should not be a button
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders as a button with onClick and fires handler", () => {
    const handler = vi.fn();
    render(<SmallMetric icon={<span>I</span>} label="Click me" onClick={handler} />);
    const btn = screen.getByRole("button");
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("renders as disabled button", () => {
    const handler = vi.fn();
    render(<SmallMetric icon={<span>I</span>} label="Disabled" onClick={handler} disabled />);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
  });
});

describe("DetailBlock", () => {
  it("renders items list when items are provided", () => {
    render(<DetailBlock label="Files" items={["a.ts", "b.ts"]} empty="No files" />);
    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("b.ts")).toBeInTheDocument();
    expect(screen.queryByText("No files")).not.toBeInTheDocument();
  });

  it("renders empty message when items list is empty", () => {
    render(<DetailBlock label="Files" items={[]} empty="No files" />);
    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByText("No files")).toBeInTheDocument();
  });
});

describe("ProofCard", () => {
  it("renders icon, title, and body", () => {
    render(<ProofCard icon={<span data-testid="icon">*</span>} title="Test Passed" body="All green" />);
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByText("Test Passed")).toBeInTheDocument();
    expect(screen.getByText("All green")).toBeInTheDocument();
  });
});

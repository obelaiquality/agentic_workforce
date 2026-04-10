import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApprovalInline } from "./ApprovalInline";

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
});

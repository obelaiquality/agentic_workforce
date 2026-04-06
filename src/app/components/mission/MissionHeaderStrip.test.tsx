import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MissionHeaderStrip } from "./MissionHeaderStrip";
import type { RepoRegistration, RoutingDecision, ExecutionRunSummary, MissionActionCapabilities } from "../../../shared/contracts";

const mockRepo: RepoRegistration = {
  id: "repo-123",
  displayName: "test-project",
  branch: "main",
  defaultBranch: "main",
  worktreePath: "/tmp/test",
  gitRepoPath: "/home/user/test",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockRoute: RoutingDecision = {
  executionMode: "single_agent",
  modelRole: "coder_default",
  providerId: "onprem-qwen",
  verificationDepth: "standard",
  decompositionScore: 0.85,
  rationale: ["High confidence in single-agent approach"],
  maxLanes: 1,
  estimatedComplexity: "medium",
};

const mockRunSummary: ExecutionRunSummary = {
  runId: "run-456",
  status: "running",
  executionMode: "single_agent",
  modelRole: "coder_default",
  providerId: "onprem-qwen",
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockActionCapabilities: MissionActionCapabilities = {
  canRefresh: true,
  canStop: true,
};

describe("MissionHeaderStrip", () => {
  it("renders repo information when connected", () => {
    render(
      <MissionHeaderStrip
        repo={mockRepo}
        liveState="live"
        route={mockRoute}
        runSummary={mockRunSummary}
        actionCapabilities={mockActionCapabilities}
        lastUpdatedAt={new Date().toISOString()}
        isActing={false}
        onRefresh={vi.fn()}
        onStop={vi.fn()}
      />
    );

    expect(screen.getByText("test-project")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("LIVE")).toBeInTheDocument();
  });

  it("renders disconnected state when no repo", () => {
    render(
      <MissionHeaderStrip
        repo={null}
        liveState="disconnected"
        route={null}
        runSummary={null}
        actionCapabilities={mockActionCapabilities}
        lastUpdatedAt={null}
        isActing={false}
        onRefresh={vi.fn()}
        onStop={vi.fn()}
      />
    );

    expect(screen.getByText("Connect a repo to begin")).toBeInTheDocument();
    expect(screen.getByText("NO REPO")).toBeInTheDocument();
  });

  it("displays route information", () => {
    render(
      <MissionHeaderStrip
        repo={mockRepo}
        liveState="live"
        route={mockRoute}
        runSummary={null}
        actionCapabilities={mockActionCapabilities}
        lastUpdatedAt={null}
        isActing={false}
        onRefresh={vi.fn()}
        onStop={vi.fn()}
      />
    );

    expect(screen.getByText(/Single Agent/)).toBeInTheDocument();
    expect(screen.getByText(/standard verify/)).toBeInTheDocument();
    expect(screen.getByText(/85% route confidence/)).toBeInTheDocument();
  });

  it("shows stop button when run is active and capability is enabled", () => {
    const onStop = vi.fn();
    render(
      <MissionHeaderStrip
        repo={mockRepo}
        liveState="live"
        route={mockRoute}
        runSummary={mockRunSummary}
        actionCapabilities={mockActionCapabilities}
        lastUpdatedAt={null}
        isActing={false}
        onRefresh={vi.fn()}
        onStop={onStop}
      />
    );

    const stopButton = screen.getByText("Stop");
    expect(stopButton).toBeInTheDocument();
    fireEvent.click(stopButton);
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("calls onRefresh when refresh button is clicked", () => {
    const onRefresh = vi.fn();
    render(
      <MissionHeaderStrip
        repo={mockRepo}
        liveState="live"
        route={mockRoute}
        runSummary={null}
        actionCapabilities={mockActionCapabilities}
        lastUpdatedAt={null}
        isActing={false}
        onRefresh={onRefresh}
        onStop={vi.fn()}
      />
    );

    const refreshButton = screen.getByText("Refresh");
    fireEvent.click(refreshButton);
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("shows spinning icon when acting", () => {
    const { container } = render(
      <MissionHeaderStrip
        repo={mockRepo}
        liveState="live"
        route={mockRoute}
        runSummary={null}
        actionCapabilities={mockActionCapabilities}
        lastUpdatedAt={null}
        isActing={true}
        onRefresh={vi.fn()}
        onStop={vi.fn()}
      />
    );

    const spinningIcon = container.querySelector(".animate-spin");
    expect(spinningIcon).toBeInTheDocument();
  });
});

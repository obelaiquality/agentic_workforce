import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiffViewer } from "./DiffViewer";

function makeMission(overrides: Record<string, unknown> = {}) {
  return {
    route: null,
    contextPack: null,
    isExecuting: false,
    isReviewing: false,
    isActing: false,
    selectedTicket: null,
    selectedExecutionProfile: { id: "balanced", name: "Balanced" },
    actionMessage: null,
    input: "",
    selectedRepo: null,
    reviewRoute: vi.fn(),
    executeRoute: vi.fn(),
    ...overrides,
  };
}

describe("DiffViewer", () => {
  it("renders the plan review panel in planning state", () => {
    render(
      <DiffViewer
        mission={makeMission() as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );

    expect(screen.getByText("Review the Plan")).toBeInTheDocument();
    expect(screen.getByText("planning")).toBeInTheDocument();
    expect(screen.getByText("Review the plan to generate context and a route.")).toBeInTheDocument();
  });

  it("shows ready to run state when route and context pack exist", () => {
    render(
      <DiffViewer
        mission={makeMission({
          route: { executionMode: "single_agent", modelRole: "coder_default", metadata: { confidence: 0.92 }, providerId: "onprem-qwen" },
          contextPack: { files: ["a.ts"], tests: ["a.test.ts"], docs: [], confidence: 0.92 },
        }) as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );

    expect(screen.getByText("ready to run")).toBeInTheDocument();
    expect(screen.getByText("Plan is ready to run.")).toBeInTheDocument();
  });

  it("renders action buttons", () => {
    render(
      <DiffViewer
        mission={makeMission() as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );

    expect(screen.getByText("Open Advanced")).toBeInTheDocument();
    expect(screen.getByText("Open Console")).toBeInTheDocument();
  });

  it("shows executing state with processing indicator", () => {
    render(
      <DiffViewer
        mission={makeMission({ isExecuting: true }) as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );
    expect(screen.getByText("Task is running.")).toBeInTheDocument();
  });

  it("shows reviewing state with thinking indicator", () => {
    render(
      <DiffViewer
        mission={makeMission({ isReviewing: true }) as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );
    expect(screen.getByText("Reviewing the plan.")).toBeInTheDocument();
  });

  it("shows context ready when contextPack exists without route", () => {
    render(
      <DiffViewer
        mission={makeMission({
          contextPack: { files: ["a.ts"], tests: [], docs: ["d.md"], confidence: 0.5 },
        }) as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );
    expect(screen.getByText("Context is ready.")).toBeInTheDocument();
    expect(screen.getByText("50% confidence")).toBeInTheDocument();
    expect(screen.getByText("1 files")).toBeInTheDocument();
    expect(screen.getByText("0 tests")).toBeInTheDocument();
    expect(screen.getByText("1 docs")).toBeInTheDocument();
  });

  it("derives complete stage from ticket status done", () => {
    render(
      <DiffViewer
        mission={makeMission({
          selectedTicket: { status: "done" },
        }) as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );
    expect(screen.getByText("Verification passed and the task is ready to close.")).toBeInTheDocument();
  });

  it("derives review stage from ticket status review", () => {
    render(
      <DiffViewer
        mission={makeMission({
          selectedTicket: { status: "review" },
        }) as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );
    expect(screen.getByText("Execution needs follow-up before it can close cleanly.")).toBeInTheDocument();
  });

  it("shows lifecycle summary when no execution profile", () => {
    render(
      <DiffViewer
        mission={makeMission({ selectedExecutionProfile: null }) as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );
    expect(screen.getByText("Choose an execution profile in Settings if you need a different lifecycle.")).toBeInTheDocument();
  });

  it("shows lifecycle summary with execution profile name", () => {
    render(
      <DiffViewer
        mission={makeMission({
          selectedExecutionProfile: { id: "fast", name: "Fast" },
        }) as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );
    expect(screen.getByText("Fast maps the Scope, Build, Review, and Escalate stages.")).toBeInTheDocument();
  });

  it("shows action message when present", () => {
    render(
      <DiffViewer
        mission={makeMission({
          actionMessage: "Something happened during execution",
        }) as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );
    expect(screen.getByText("Something happened during execution")).toBeInTheDocument();
  });

  it("shows patch timeout retry buttons", () => {
    const executeRoute = vi.fn();
    const reviewRoute = vi.fn();
    render(
      <DiffViewer
        mission={makeMission({
          actionMessage: "Error: timed out while generating patch for the task",
          executeRoute,
          reviewRoute,
          input: "some input",
          selectedRepo: { id: "r1" },
        }) as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );
    expect(screen.getByText("Retry")).toBeInTheDocument();
    expect(screen.getByText("Retry smaller scope")).toBeInTheDocument();
  });

  it("shows patch timeout retry for generic patch generation timed out", () => {
    render(
      <DiffViewer
        mission={makeMission({
          actionMessage: "generic patch generation timed out",
          input: "test",
          selectedRepo: { id: "r1" },
        }) as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("disables retry buttons when isActing is true", () => {
    render(
      <DiffViewer
        mission={makeMission({
          actionMessage: "timed out while generating patch",
          isActing: true,
          input: "test",
          selectedRepo: { id: "r1" },
        }) as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );
    const retryBtn = screen.getByText("Retry");
    expect(retryBtn.closest("button")).toBeDisabled();
  });

  it("disables retry buttons when input is empty", () => {
    render(
      <DiffViewer
        mission={makeMission({
          actionMessage: "timed out while generating patch",
          input: "  ",
          selectedRepo: { id: "r1" },
        }) as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );
    const retryBtn = screen.getByText("Retry");
    expect(retryBtn.closest("button")).toBeDisabled();
  });

  it("uses route metadata confidence when available", () => {
    render(
      <DiffViewer
        mission={makeMission({
          route: { executionMode: "single_agent", modelRole: "coder_default", metadata: { confidence: 0.85 }, providerId: "onprem-qwen" },
          contextPack: { files: [], tests: [], docs: [], confidence: 0.5 },
        }) as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );
    expect(screen.getByText("85% confidence")).toBeInTheDocument();
  });

  it("falls back to contextPack confidence when route has no metadata confidence", () => {
    render(
      <DiffViewer
        mission={makeMission({
          route: { executionMode: "single_agent", modelRole: "coder_default", metadata: {}, providerId: "onprem-qwen" },
          contextPack: { files: [], tests: [], docs: [], confidence: 0.75 },
        }) as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );
    expect(screen.getByText("75% confidence")).toBeInTheDocument();
  });

  it("calls onOpenSettings and onOpenConsole callbacks", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const onOpenSettings = vi.fn();
    const onOpenConsole = vi.fn();
    render(
      <DiffViewer
        mission={makeMission() as never}
        onOpenSettings={onOpenSettings}
        onOpenConsole={onOpenConsole}
      />
    );
    fireEvent.click(screen.getByText("Open Advanced"));
    expect(onOpenSettings).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Open Console"));
    expect(onOpenConsole).toHaveBeenCalled();
  });

  it("shows Route pending chip when no route is present", () => {
    render(
      <DiffViewer
        mission={makeMission() as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );
    expect(screen.getByText("Route pending")).toBeInTheDocument();
  });

  it("shows Profile pending chip when no execution profile", () => {
    render(
      <DiffViewer
        mission={makeMission({ selectedExecutionProfile: null }) as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );
    expect(screen.getByText("Profile pending")).toBeInTheDocument();
  });

  it("shows build stage hint when isExecuting but not isReviewing", () => {
    render(
      <DiffViewer
        mission={makeMission({
          isExecuting: true,
          route: { executionMode: "single_agent", modelRole: "coder_default", metadata: {}, providerId: "x" },
          contextPack: { files: [], tests: [], docs: [], confidence: 0.68 },
        }) as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );
    expect(screen.getByText("The plan is scoped. Run task to move the workflow into active execution.")).toBeInTheDocument();
  });
});

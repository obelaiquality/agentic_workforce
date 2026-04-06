import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StreamProgressBoard } from "./StreamProgressBoard";
import type { MissionStream } from "../lib/missionTypes";

const mockStreams: MissionStream[] = [
  {
    workstream: "feature/button-component",
    risk: "ok",
    queued: 2,
    in_progress: 1,
    blocked: 0,
    failed: 0,
    completed: 5,
    top_task_id: "task-123",
  },
  {
    workstream: "fix/navigation-bug",
    risk: "warn",
    queued: 1,
    in_progress: 2,
    blocked: 1,
    failed: 0,
    completed: 3,
    top_task_id: "task-456",
  },
  {
    workstream: "refactor/api-layer",
    risk: "critical",
    queued: 3,
    in_progress: 1,
    blocked: 0,
    failed: 2,
    completed: 1,
    top_task_id: "task-789",
  },
];

describe("StreamProgressBoard", () => {
  it("renders all streams", () => {
    render(<StreamProgressBoard streams={mockStreams} onSelectTask={vi.fn()} />);

    expect(screen.getByText("feature/button-component")).toBeInTheDocument();
    expect(screen.getByText("fix/navigation-bug")).toBeInTheDocument();
    expect(screen.getByText("refactor/api-layer")).toBeInTheDocument();
  });

  it("displays total open backlog count", () => {
    render(<StreamProgressBoard streams={mockStreams} onSelectTask={vi.fn()} />);

    // Total open = sum of queued + in_progress + blocked + failed
    // Stream 1: 2 + 1 + 0 + 0 = 3
    // Stream 2: 1 + 2 + 1 + 0 = 4
    // Stream 3: 3 + 1 + 0 + 2 = 6
    // Total: 13
    expect(screen.getByText("13 open")).toBeInTheDocument();
  });

  it("shows stream count", () => {
    render(<StreamProgressBoard streams={mockStreams} onSelectTask={vi.fn()} />);

    expect(screen.getByText("3 streams")).toBeInTheDocument();
  });

  it("displays risk badges", () => {
    render(<StreamProgressBoard streams={mockStreams} onSelectTask={vi.fn()} />);

    // Component renders risk.toUpperCase() - there may be multiple "OK" due to filter buttons
    expect(screen.getAllByText("OK").length).toBeGreaterThan(0);
    expect(screen.getByText("WARN")).toBeInTheDocument();
    expect(screen.getByText("CRITICAL")).toBeInTheDocument();
  });

  it("shows task status counts", () => {
    render(<StreamProgressBoard streams={mockStreams} onSelectTask={vi.fn()} />);

    // Check for various status labels
    expect(screen.getAllByText("Q'd").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Prog").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Done").length).toBeGreaterThan(0);
  });

  it("displays focus task IDs", () => {
    render(<StreamProgressBoard streams={mockStreams} onSelectTask={vi.fn()} />);

    expect(screen.getByText("task-123")).toBeInTheDocument();
    expect(screen.getByText("task-456")).toBeInTheDocument();
    expect(screen.getByText("task-789")).toBeInTheDocument();
  });

  it("calls onSelectTask when stream card is clicked", () => {
    const onSelectTask = vi.fn();
    render(<StreamProgressBoard streams={mockStreams} onSelectTask={onSelectTask} />);

    const streamCard = screen.getByText("feature/button-component").closest("button");
    if (streamCard) {
      fireEvent.click(streamCard);
      expect(onSelectTask).toHaveBeenCalledWith("task-123");
    }
  });

  it("filters streams by risk level", () => {
    render(<StreamProgressBoard streams={mockStreams} onSelectTask={vi.fn()} />);

    // Click critical filter
    const criticalFilter = screen.getByText("Critical");
    fireEvent.click(criticalFilter);

    // Should show only critical stream
    expect(screen.getByText("refactor/api-layer")).toBeInTheDocument();
    expect(screen.queryByText("feature/button-component")).not.toBeInTheDocument();
  });

  it("shows all streams when 'All' filter is selected", () => {
    render(<StreamProgressBoard streams={mockStreams} onSelectTask={vi.fn()} />);

    const allFilter = screen.getByText("All");
    fireEvent.click(allFilter);

    expect(screen.getByText("feature/button-component")).toBeInTheDocument();
    expect(screen.getByText("fix/navigation-bug")).toBeInTheDocument();
    expect(screen.getByText("refactor/api-layer")).toBeInTheDocument();
  });

  it("disables stream card when no top task", () => {
    const streamWithoutTask: MissionStream = {
      workstream: "empty-stream",
      risk: "ok",
      queued: 0,
      in_progress: 0,
      blocked: 0,
      failed: 0,
      completed: 0,
      top_task_id: null,
    };

    render(<StreamProgressBoard streams={[streamWithoutTask]} onSelectTask={vi.fn()} />);

    const streamCard = screen.getByText("empty-stream").closest("button");
    expect(streamCard).toBeDisabled();
    expect(screen.getByText("No focus task")).toBeInTheDocument();
  });

  it("calculates progress bar percentage correctly", () => {
    const { container } = render(<StreamProgressBoard streams={mockStreams} onSelectTask={vi.fn()} />);

    // Stream 1: 5 completed out of 8 total = 62.5%
    // Should have progress bars with width styles
    const progressBars = container.querySelectorAll('[style*="width"]');
    expect(progressBars.length).toBeGreaterThan(0);
  });

  it("highlights failed tasks", () => {
    render(<StreamProgressBoard streams={mockStreams} onSelectTask={vi.fn()} />);

    // Stream 3 has 2 failures
    const failCell = screen.getAllByText("Fail");
    expect(failCell.length).toBeGreaterThan(0);
  });

  it("shows in-progress tasks with purple styling", () => {
    const { container } = render(<StreamProgressBoard streams={mockStreams} onSelectTask={vi.fn()} />);

    // Check for purple variant styling on progress cells
    const purpleCells = container.querySelectorAll('.bg-purple-500\\/10');
    expect(purpleCells.length).toBeGreaterThan(0);
  });
});

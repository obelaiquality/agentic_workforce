import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RunTimelineRail } from "./RunTimelineRail";
import type { MissionRunPhase, MissionTimelineEvent } from "../lib/missionTypes";

const mockTimeline: MissionTimelineEvent[] = [
  {
    id: "event-1",
    timestamp: new Date().toISOString(),
    severity: "INFO",
    message: "Run started successfully",
    kind: "run_lifecycle",
    task_id: null,
  },
  {
    id: "event-2",
    timestamp: new Date().toISOString(),
    severity: "WARNING",
    message: "High memory usage detected",
    kind: "resource_monitor",
    task_id: "task-123",
  },
  {
    id: "event-3",
    timestamp: new Date().toISOString(),
    severity: "ERROR",
    message: "Test suite failed",
    kind: "verification",
    task_id: "task-456",
  },
];

describe("RunTimelineRail", () => {
  it("renders phase stepper", () => {
    render(<RunTimelineRail runPhase="parallel_running" timeline={mockTimeline} />);

    expect(screen.getByText("Starting")).toBeInTheDocument();
    expect(screen.getByText("Validation")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Draining")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("highlights current phase", () => {
    render(<RunTimelineRail runPhase="single_task_validation" timeline={mockTimeline} />);

    expect(screen.getByText("phase: single_task_validation")).toBeInTheDocument();
  });

  it("displays timeline events", () => {
    render(<RunTimelineRail runPhase="parallel_running" timeline={mockTimeline} />);

    expect(screen.getByText("Run started successfully")).toBeInTheDocument();
    expect(screen.getByText("High memory usage detected")).toBeInTheDocument();
    expect(screen.getByText("Test suite failed")).toBeInTheDocument();
  });

  it("shows event severities with correct styling", () => {
    render(<RunTimelineRail runPhase="parallel_running" timeline={mockTimeline} />);

    expect(screen.getByText("INFO")).toBeInTheDocument();
    expect(screen.getByText("WARNING")).toBeInTheDocument();
    expect(screen.getByText("ERROR")).toBeInTheDocument();
  });

  it("displays event kinds", () => {
    render(<RunTimelineRail runPhase="parallel_running" timeline={mockTimeline} />);

    expect(screen.getByText("run_lifecycle")).toBeInTheDocument();
    expect(screen.getByText("resource_monitor")).toBeInTheDocument();
    expect(screen.getByText("verification")).toBeInTheDocument();
  });

  it("shows task IDs for events", () => {
    render(<RunTimelineRail runPhase="parallel_running" timeline={mockTimeline} />);

    expect(screen.getByText("task-123")).toBeInTheDocument();
    expect(screen.getByText("task-456")).toBeInTheDocument();
  });

  it("toggles event log visibility", () => {
    render(<RunTimelineRail runPhase="parallel_running" timeline={mockTimeline} />);

    // Events should be visible initially (expanded=true by default)
    expect(screen.getByText("Run started successfully")).toBeInTheDocument();

    // Find the toggle button
    const toggleButton = screen.getByRole("button", { name: "" });
    fireEvent.click(toggleButton);

    // After collapse, events should not be visible
    expect(screen.queryByText("Run started successfully")).not.toBeInTheDocument();
  });

  it("shows completed phase at 100%", () => {
    const { container } = render(<RunTimelineRail runPhase="completed" timeline={mockTimeline} />);

    const progressBar = container.querySelector('[style*="width"]');
    expect(progressBar).toHaveStyle({ width: "calc(100% - 2rem)" });
  });

  it("renders empty timeline", () => {
    render(<RunTimelineRail runPhase="starting" timeline={[]} />);

    expect(screen.getByText("phase: starting")).toBeInTheDocument();
    // No events should be shown
    expect(screen.queryByText("run_lifecycle")).not.toBeInTheDocument();
  });

  it("formats timestamps correctly", () => {
    const now = new Date();
    const timeline: MissionTimelineEvent[] = [
      {
        id: "event-1",
        timestamp: now.toISOString(),
        severity: "INFO",
        message: "Test event",
        kind: null,
        task_id: null,
      },
    ];

    render(<RunTimelineRail runPhase="starting" timeline={timeline} />);

    // Should display time in HH:mm:ss format
    const timeElement = screen.getByText(/\d{2}:\d{2}:\d{2}/);
    expect(timeElement).toBeInTheDocument();
  });
});

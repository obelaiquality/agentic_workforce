import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActiveExecutionPanel } from "./ActiveExecutionPanel";
import type { MissionTaskCard, TaskSpotlight } from "../lib/missionTypes";

const mockTasks: MissionTaskCard[] = [
  {
    task_id: "task-1",
    title: "Implement button component",
    phase: "execution",
  },
  {
    task_id: "task-2",
    title: "Add tests for button",
    phase: "testing",
  },
  {
    task_id: "task-3",
    title: "Update documentation",
    phase: "completed",
  },
];

const mockSpotlight: TaskSpotlight = {
  task_id: "task-1",
  title: "Implement button component",
  lifecycle: {
    current_phase: "execution",
    events: [
      {
        timestamp: new Date().toISOString(),
        severity: "INFO",
        message: "Task started",
      },
    ],
  },
  phase_durations: {
    planning: 5,
    execution: 12,
  },
  latest_transition_reason: "Ready for execution",
  latest_artifact: {
    payload: {
      outcome: {
        worker_id: 1,
        token_usage: {
          total_tokens: 1500,
        },
      },
    },
  },
};

describe("ActiveExecutionPanel", () => {
  it("renders task list", () => {
    render(
      <ActiveExecutionPanel
        tasks={mockTasks}
        selectedTaskId="task-1"
        spotlight={null}
        onSelectTask={vi.fn()}
      />
    );

    expect(screen.getByText("3 active tasks")).toBeInTheDocument();
    expect(screen.getByText("Implement button component")).toBeInTheDocument();
    expect(screen.getByText("Add tests for button")).toBeInTheDocument();
    expect(screen.getByText("Update documentation")).toBeInTheDocument();
  });

  it("highlights selected task", () => {
    const { container } = render(
      <ActiveExecutionPanel
        tasks={mockTasks}
        selectedTaskId="task-2"
        spotlight={null}
        onSelectTask={vi.fn()}
      />
    );

    const selectedButton = container.querySelector(".shadow-\\[inset_3px_0_0_0_\\#a855f7\\]");
    expect(selectedButton).toBeInTheDocument();
  });

  it("calls onSelectTask when task is clicked", () => {
    const onSelectTask = vi.fn();
    render(
      <ActiveExecutionPanel
        tasks={mockTasks}
        selectedTaskId="task-1"
        spotlight={null}
        onSelectTask={onSelectTask}
      />
    );

    const task2Button = screen.getByText("Add tests for button");
    fireEvent.click(task2Button);
    expect(onSelectTask).toHaveBeenCalledWith("task-2");
  });

  it("shows empty spotlight when no task selected", () => {
    render(
      <ActiveExecutionPanel
        tasks={mockTasks}
        selectedTaskId="task-1"
        spotlight={null}
        onSelectTask={vi.fn()}
      />
    );

    expect(screen.getByText("Select a task to view spotlight details")).toBeInTheDocument();
  });

  it("displays spotlight details", () => {
    render(
      <ActiveExecutionPanel
        tasks={mockTasks}
        selectedTaskId="task-1"
        spotlight={mockSpotlight}
        onSelectTask={vi.fn()}
      />
    );

    expect(screen.getByText("Spotlight")).toBeInTheDocument();
    // task-1 and title appear in both the task list and spotlight, use getAllByText
    expect(screen.getAllByText("task-1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Implement button component").length).toBeGreaterThan(0);
    // Component renders phase with underscores replaced by spaces in the Chip
    expect(screen.getByText("Current Phase")).toBeInTheDocument();
  });

  it("displays phase durations", () => {
    render(
      <ActiveExecutionPanel
        tasks={mockTasks}
        selectedTaskId="task-1"
        spotlight={mockSpotlight}
        onSelectTask={vi.fn()}
      />
    );

    // Phase names have underscores replaced with spaces, and appear multiple times
    expect(screen.getAllByText(/planning/).length).toBeGreaterThan(0);
    expect(screen.getByText("5s")).toBeInTheDocument();
    expect(screen.getAllByText(/execution/).length).toBeGreaterThan(0);
    expect(screen.getByText("12s")).toBeInTheDocument();
  });

  it("shows worker information", () => {
    render(
      <ActiveExecutionPanel
        tasks={mockTasks}
        selectedTaskId="task-1"
        spotlight={mockSpotlight}
        onSelectTask={vi.fn()}
      />
    );

    expect(screen.getByText(/Worker-1/)).toBeInTheDocument();
    expect(screen.getByText(/1,500 tokens/)).toBeInTheDocument();
  });

  it("displays action buttons when capabilities are enabled", () => {
    const onRequeue = vi.fn();
    const onMarkActive = vi.fn();
    const onComplete = vi.fn();

    render(
      <ActiveExecutionPanel
        tasks={mockTasks}
        selectedTaskId="task-1"
        spotlight={mockSpotlight}
        onSelectTask={vi.fn()}
        canRequeue={true}
        canMarkActive={true}
        canComplete={true}
        onRequeue={onRequeue}
        onMarkActive={onMarkActive}
        onComplete={onComplete}
      />
    );

    const requeueButton = screen.getByText("Requeue");
    const markActiveButton = screen.getByText("Mark Active");
    const completeButton = screen.getByText("Complete");

    expect(requeueButton).toBeInTheDocument();
    expect(markActiveButton).toBeInTheDocument();
    expect(completeButton).toBeInTheDocument();

    fireEvent.click(requeueButton);
    expect(onRequeue).toHaveBeenCalledOnce();

    fireEvent.click(markActiveButton);
    expect(onMarkActive).toHaveBeenCalledOnce();

    fireEvent.click(completeButton);
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("shows transition reason", () => {
    render(
      <ActiveExecutionPanel
        tasks={mockTasks}
        selectedTaskId="task-1"
        spotlight={mockSpotlight}
        onSelectTask={vi.fn()}
      />
    );

    expect(screen.getByText(/Ready for execution/)).toBeInTheDocument();
  });
});

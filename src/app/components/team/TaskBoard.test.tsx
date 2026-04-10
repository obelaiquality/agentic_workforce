import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskBoard } from "./TaskBoard";

function makeTask(overrides: Partial<{
  id: string;
  name: string;
  description: string;
  assignedTo: string | null;
  priority: number;
  status: string;
  leaseExpires: string | null;
  result: string | null;
}> = {}) {
  return {
    id: "t-1",
    name: "Implement login",
    description: "Add user login endpoint",
    assignedTo: null,
    priority: 5,
    status: "pending",
    leaseExpires: null,
    result: null,
    ...overrides,
  };
}

describe("TaskBoard", () => {
  it("renders three column headers", () => {
    render(<TaskBoard tasks={[]} />);

    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("shows 'No tasks' in empty columns", () => {
    render(<TaskBoard tasks={[]} />);

    const noTasks = screen.getAllByText("No tasks");
    expect(noTasks).toHaveLength(3);
  });

  it("renders a pending task in the Pending column", () => {
    render(<TaskBoard tasks={[makeTask()]} />);

    expect(screen.getByText("Implement login")).toBeInTheDocument();
    expect(screen.getByText("Add user login endpoint")).toBeInTheDocument();
    expect(screen.getByText("P5")).toBeInTheDocument();
  });

  it("places executing tasks in the In Progress column", () => {
    render(
      <TaskBoard
        tasks={[makeTask({ status: "executing", assignedTo: "worker-alpha" })]}
      />,
    );

    expect(screen.getByText("worker-alpha")).toBeInTheDocument();
  });

  it("places completed tasks in the Completed column", () => {
    render(
      <TaskBoard
        tasks={[
          makeTask({
            status: "completed",
            result: "All tests pass",
          }),
        ]}
      />,
    );

    expect(screen.getByText("All tests pass")).toBeInTheDocument();
  });

  it("shows assigned worker on task card", () => {
    render(
      <TaskBoard
        tasks={[makeTask({ assignedTo: "worker-beta" })]}
      />,
    );

    expect(screen.getByText("worker-beta")).toBeInTheDocument();
  });

  it("distributes tasks across columns correctly", () => {
    render(
      <TaskBoard
        tasks={[
          makeTask({ id: "t-1", name: "Task A", status: "pending" }),
          makeTask({ id: "t-2", name: "Task B", status: "executing" }),
          makeTask({ id: "t-3", name: "Task C", status: "completed" }),
          makeTask({ id: "t-4", name: "Task D", status: "blocked" }),
          makeTask({ id: "t-5", name: "Task E", status: "failed" }),
        ]}
      />,
    );

    expect(screen.getByText("Task A")).toBeInTheDocument();
    expect(screen.getByText("Task B")).toBeInTheDocument();
    expect(screen.getByText("Task C")).toBeInTheDocument();
    expect(screen.getByText("Task D")).toBeInTheDocument();
    expect(screen.getByText("Task E")).toBeInTheDocument();
  });

  it("renders high priority with stop variant", () => {
    render(<TaskBoard tasks={[makeTask({ priority: 9 })]} />);

    expect(screen.getByText("P9")).toBeInTheDocument();
  });

  it("renders low priority with subtle variant", () => {
    render(<TaskBoard tasks={[makeTask({ priority: 2 })]} />);

    expect(screen.getByText("P2")).toBeInTheDocument();
  });

  it("shows lease time when present", () => {
    const futureDate = new Date(Date.now() + 120000).toISOString(); // 2 minutes from now
    render(
      <TaskBoard tasks={[makeTask({ leaseExpires: futureDate, status: "executing" })]} />,
    );

    expect(screen.getByText(/Lease:/)).toBeInTheDocument();
  });
});

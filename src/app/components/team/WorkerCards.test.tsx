import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkerCards } from "./WorkerCards";

function makeWorker(overrides: Partial<{
  id: string;
  workerId: string;
  role: string;
  status: string;
  currentTaskId: string | null;
  lastHeartbeatAt: string;
}> = {}) {
  return {
    id: "w-1",
    workerId: "worker-alpha",
    role: "coder",
    status: "executing",
    currentTaskId: null,
    lastHeartbeatAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("WorkerCards", () => {
  it("renders empty state when no workers", () => {
    render(<WorkerCards workers={[]} />);

    expect(screen.getByText("No workers active yet.")).toBeInTheDocument();
  });

  it("renders worker card with id and role", () => {
    render(<WorkerCards workers={[makeWorker()]} />);

    expect(screen.getByText("worker-alpha")).toBeInTheDocument();
    expect(screen.getByText("coder")).toBeInTheDocument();
  });

  it("renders worker status chip", () => {
    render(<WorkerCards workers={[makeWorker({ status: "executing" })]} />);

    expect(screen.getByText("executing")).toBeInTheDocument();
  });

  it("renders current task id when assigned", () => {
    render(
      <WorkerCards
        workers={[makeWorker({ currentTaskId: "task-42" })]}
      />,
    );

    expect(screen.getByText("task-42")).toBeInTheDocument();
  });

  it("does not render task id when not assigned", () => {
    render(<WorkerCards workers={[makeWorker({ currentTaskId: null })]} />);

    expect(screen.queryByText("Task:")).not.toBeInTheDocument();
  });

  it("renders multiple workers", () => {
    render(
      <WorkerCards
        workers={[
          makeWorker({ id: "w-1", workerId: "worker-alpha" }),
          makeWorker({ id: "w-2", workerId: "worker-beta", role: "reviewer", status: "idle" }),
        ]}
      />,
    );

    expect(screen.getByText("worker-alpha")).toBeInTheDocument();
    expect(screen.getByText("worker-beta")).toBeInTheDocument();
    expect(screen.getByText("reviewer")).toBeInTheDocument();
  });

  it("renders heartbeat time", () => {
    const recentDate = new Date().toISOString();
    render(
      <WorkerCards workers={[makeWorker({ lastHeartbeatAt: recentDate })]} />,
    );

    // Should show "0s ago" or a similar recent timestamp
    expect(screen.getByText(/ago/)).toBeInTheDocument();
  });

  it("applies failed border styling for failed workers", () => {
    const { container } = render(
      <WorkerCards workers={[makeWorker({ status: "failed" })]} />,
    );

    const card = container.querySelector(".border-rose-500\\/30");
    expect(card).not.toBeNull();
  });
});

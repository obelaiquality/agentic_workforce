import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RalphControls } from "./RalphControls";

describe("RalphControls", () => {
  const defaultProps = {
    sessionId: "ralph-1",
    status: "running",
    iteration: 2,
    maxIterations: 5,
    onPause: vi.fn(),
    onResume: vi.fn(),
  };

  it("renders iteration counter", () => {
    render(<RalphControls {...defaultProps} />);

    expect(screen.getByText("Iter 2/5")).toBeInTheDocument();
  });

  it("renders running status chip", () => {
    render(<RalphControls {...defaultProps} />);

    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("shows pause button when running", () => {
    render(<RalphControls {...defaultProps} />);

    expect(screen.getByText("Pause")).toBeInTheDocument();
    expect(screen.queryByText("Resume")).not.toBeInTheDocument();
  });

  it("calls onPause when pause button is clicked", () => {
    const onPause = vi.fn();
    render(<RalphControls {...defaultProps} onPause={onPause} />);

    fireEvent.click(screen.getByText("Pause"));

    expect(onPause).toHaveBeenCalledOnce();
  });

  it("shows resume button when paused", () => {
    render(<RalphControls {...defaultProps} status="paused" />);

    expect(screen.getByText("Resume")).toBeInTheDocument();
    expect(screen.queryByText("Pause")).not.toBeInTheDocument();
  });

  it("calls onResume when resume button is clicked", () => {
    const onResume = vi.fn();
    render(<RalphControls {...defaultProps} status="paused" onResume={onResume} />);

    fireEvent.click(screen.getByText("Resume"));

    expect(onResume).toHaveBeenCalledOnce();
  });

  it("hides action buttons when completed", () => {
    render(<RalphControls {...defaultProps} status="completed" />);

    expect(screen.queryByText("Pause")).not.toBeInTheDocument();
    expect(screen.queryByText("Resume")).not.toBeInTheDocument();
  });

  it("hides action buttons when failed", () => {
    render(<RalphControls {...defaultProps} status="failed" />);

    expect(screen.queryByText("Pause")).not.toBeInTheDocument();
    expect(screen.queryByText("Resume")).not.toBeInTheDocument();
  });

  it("renders paused status chip", () => {
    render(<RalphControls {...defaultProps} status="paused" />);

    expect(screen.getByText("paused")).toBeInTheDocument();
  });
});

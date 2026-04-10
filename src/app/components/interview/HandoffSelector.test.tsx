import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HandoffSelector } from "./HandoffSelector";

describe("HandoffSelector", () => {
  const defaultProps = {
    onHandoff: vi.fn(),
    specContent: "Build a REST API with user authentication and rate limiting.",
  };

  it("renders spec preview", () => {
    render(<HandoffSelector {...defaultProps} />);

    expect(screen.getByText("Crystallized Spec")).toBeInTheDocument();
    expect(
      screen.getByText("Build a REST API with user authentication and rate limiting."),
    ).toBeInTheDocument();
  });

  it("renders all three handoff options", () => {
    render(<HandoffSelector {...defaultProps} />);

    expect(screen.getByText("Ralph Mode")).toBeInTheDocument();
    expect(screen.getByText("Team Mode")).toBeInTheDocument();
    expect(screen.getByText("Autopilot")).toBeInTheDocument();
  });

  it("calls onHandoff with 'ralph' when Ralph Mode is clicked", () => {
    const onHandoff = vi.fn();
    render(<HandoffSelector onHandoff={onHandoff} specContent="spec" />);

    fireEvent.click(screen.getByText("Ralph Mode"));

    expect(onHandoff).toHaveBeenCalledWith("ralph");
  });

  it("calls onHandoff with 'team' when Team Mode is clicked", () => {
    const onHandoff = vi.fn();
    render(<HandoffSelector onHandoff={onHandoff} specContent="spec" />);

    fireEvent.click(screen.getByText("Team Mode"));

    expect(onHandoff).toHaveBeenCalledWith("team");
  });

  it("calls onHandoff with 'autopilot' when Autopilot is clicked", () => {
    const onHandoff = vi.fn();
    render(<HandoffSelector onHandoff={onHandoff} specContent="spec" />);

    fireEvent.click(screen.getByText("Autopilot"));

    expect(onHandoff).toHaveBeenCalledWith("autopilot");
  });

  it("truncates long spec content to 400 characters", () => {
    const longSpec = "A".repeat(500);
    render(<HandoffSelector onHandoff={vi.fn()} specContent={longSpec} />);

    const specElement = screen.getByText(/^A+\.\.\.$/);
    // The truncated text should be 400 'A's + "..."
    expect(specElement.textContent).toBe("A".repeat(400) + "...");
  });

  it("does not truncate spec content under 400 characters", () => {
    const shortSpec = "Short spec content.";
    render(<HandoffSelector onHandoff={vi.fn()} specContent={shortSpec} />);

    expect(screen.getByText("Short spec content.")).toBeInTheDocument();
  });

  it("renders descriptions for each mode", () => {
    render(<HandoffSelector {...defaultProps} />);

    expect(screen.getByText(/Solo deep-work agent/)).toBeInTheDocument();
    expect(screen.getByText(/Multi-agent collaboration/)).toBeInTheDocument();
    expect(screen.getByText(/Automatic selection/)).toBeInTheDocument();
  });
});

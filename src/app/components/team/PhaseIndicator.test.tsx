import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PhaseIndicator } from "./PhaseIndicator";
import type { TeamPhase } from "../../../shared/contracts";

describe("PhaseIndicator", () => {
  it("renders Planning for team_plan phase", () => {
    render(<PhaseIndicator phase="team_plan" />);
    expect(screen.getByText("Planning")).toBeInTheDocument();
  });

  it("renders Executing for team_exec phase", () => {
    render(<PhaseIndicator phase="team_exec" />);
    expect(screen.getByText("Executing")).toBeInTheDocument();
  });

  it("renders Verifying for team_verify phase", () => {
    render(<PhaseIndicator phase="team_verify" />);
    expect(screen.getByText("Verifying")).toBeInTheDocument();
  });

  it("renders Fixing for team_fix phase", () => {
    render(<PhaseIndicator phase="team_fix" />);
    expect(screen.getByText("Fixing")).toBeInTheDocument();
  });

  it("renders Complete for team_complete phase", () => {
    render(<PhaseIndicator phase="team_complete" />);
    expect(screen.getByText("Complete")).toBeInTheDocument();
  });

  it("applies correct color class for executing phase", () => {
    const { container } = render(<PhaseIndicator phase="team_exec" />);
    const chip = container.firstElementChild;
    expect(chip?.className).toContain("text-blue-400");
  });

  it("applies correct color class for complete phase", () => {
    const { container } = render(<PhaseIndicator phase="team_complete" />);
    const chip = container.firstElementChild;
    expect(chip?.className).toContain("text-emerald-400");
  });

  it("falls back to team_plan config for unknown phase", () => {
    render(<PhaseIndicator phase={"unknown_phase" as TeamPhase} />);
    expect(screen.getByText("Planning")).toBeInTheDocument();
  });
});

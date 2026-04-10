import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PhaseTimeline } from "./PhaseTimeline";
import type { RalphPhase } from "../../../shared/contracts";

describe("PhaseTimeline", () => {
  it("renders all phase labels", () => {
    render(<PhaseTimeline currentPhase="intake" completedPhases={[]} />);

    expect(screen.getByText("Intake")).toBeInTheDocument();
    expect(screen.getByText("Execute")).toBeInTheDocument();
    expect(screen.getByText("Verify")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("Deslop")).toBeInTheDocument();
    expect(screen.getByText("Regression")).toBeInTheDocument();
    expect(screen.getByText("Complete")).toBeInTheDocument();
  });

  it("highlights current phase with purple color", () => {
    render(<PhaseTimeline currentPhase="execute" completedPhases={["intake"]} />);

    const executeLabel = screen.getByText("Execute");
    expect(executeLabel.className).toContain("text-purple-400");
  });

  it("shows completed phases with emerald color", () => {
    render(
      <PhaseTimeline
        currentPhase="verify"
        completedPhases={["intake", "execute"]}
      />,
    );

    const intakeLabel = screen.getByText("Intake");
    expect(intakeLabel.className).toContain("text-emerald-400");

    const executeLabel = screen.getByText("Execute");
    expect(executeLabel.className).toContain("text-emerald-400");
  });

  it("shows pending phases with zinc color", () => {
    render(<PhaseTimeline currentPhase="intake" completedPhases={[]} />);

    const verifyLabel = screen.getByText("Verify");
    expect(verifyLabel.className).toContain("text-zinc-500");
  });

  it("handles all phases completed", () => {
    const allPhases: RalphPhase[] = [
      "intake",
      "execute",
      "verify",
      "architect_review",
      "deslop",
      "regression",
    ];

    render(
      <PhaseTimeline currentPhase="complete" completedPhases={allPhases} />,
    );

    // Current phase should be purple
    const completeLabel = screen.getByText("Complete");
    expect(completeLabel.className).toContain("text-purple-400");

    // All other phases should be emerald
    const intakeLabel = screen.getByText("Intake");
    expect(intakeLabel.className).toContain("text-emerald-400");
  });
});

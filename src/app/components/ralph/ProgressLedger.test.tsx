import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressLedger } from "./ProgressLedger";
import type { RalphProgressLedger } from "../../../shared/contracts";

function makeLedger(overrides: Partial<RalphProgressLedger> = {}): RalphProgressLedger {
  return {
    completedPhases: [],
    currentObjective: "Implement authentication module",
    filesModified: ["src/auth.ts", "src/middleware.ts"],
    testResults: {},
    verificationsPassed: 2,
    deslopIssuesFound: 4,
    deslopIssuesFixed: 3,
    ...overrides,
  };
}

describe("ProgressLedger", () => {
  it("renders empty state when ledger is null", () => {
    render(<ProgressLedger ledger={null} phaseExecutions={[]} />);

    expect(screen.getByText("Ledger not available yet")).toBeInTheDocument();
  });

  it("renders current objective", () => {
    render(<ProgressLedger ledger={makeLedger()} phaseExecutions={[]} />);

    expect(screen.getByText("Implement authentication module")).toBeInTheDocument();
  });

  it("renders files modified section", () => {
    render(<ProgressLedger ledger={makeLedger()} phaseExecutions={[]} />);

    expect(screen.getByText("Files Modified")).toBeInTheDocument();
  });

  it("expands files modified section on click to show file list", () => {
    render(<ProgressLedger ledger={makeLedger()} phaseExecutions={[]} />);

    fireEvent.click(screen.getByText("Files Modified"));

    expect(screen.getByText("src/auth.ts")).toBeInTheDocument();
    expect(screen.getByText("src/middleware.ts")).toBeInTheDocument();
  });

  it("shows deslop issues section", () => {
    render(<ProgressLedger ledger={makeLedger()} phaseExecutions={[]} />);

    expect(screen.getByText("Deslop Issues")).toBeInTheDocument();
  });

  it("expands deslop section to show found and fixed counts", () => {
    render(<ProgressLedger ledger={makeLedger()} phaseExecutions={[]} />);

    fireEvent.click(screen.getByText("Deslop Issues"));

    expect(screen.getByText("4")).toBeInTheDocument(); // found
    expect(screen.getByText("3")).toBeInTheDocument(); // fixed
  });

  it("renders verifications passed count", () => {
    render(
      <ProgressLedger
        ledger={makeLedger({ verificationsPassed: 7, filesModified: [] })}
        phaseExecutions={[]}
      />,
    );

    expect(screen.getByText("Verifications passed:")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("renders phase execution history when present", () => {
    const phaseExecutions = [
      { phase: "execute", iteration: 1, status: "completed", output: "Generated 3 files" },
      { phase: "verify", iteration: 1, status: "failed", output: "Test failed" },
    ];

    render(<ProgressLedger ledger={makeLedger()} phaseExecutions={phaseExecutions} />);

    expect(screen.getByText("Phase History")).toBeInTheDocument();
  });

  it("expands phase history to show executions", () => {
    const phaseExecutions = [
      { phase: "execute", iteration: 1, status: "completed", output: "Generated 3 files" },
    ];

    render(<ProgressLedger ledger={makeLedger()} phaseExecutions={phaseExecutions} />);

    fireEvent.click(screen.getByText("Phase History"));

    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText("execute (iter 1)")).toBeInTheDocument();
  });

  it("does not show phase history when empty", () => {
    render(<ProgressLedger ledger={makeLedger()} phaseExecutions={[]} />);

    expect(screen.queryByText("Phase History")).not.toBeInTheDocument();
  });

  it("shows None when no files modified", () => {
    render(
      <ProgressLedger
        ledger={makeLedger({ filesModified: [] })}
        phaseExecutions={[]}
      />,
    );

    fireEvent.click(screen.getByText("Files Modified"));

    expect(screen.getByText("None")).toBeInTheDocument();
  });
});

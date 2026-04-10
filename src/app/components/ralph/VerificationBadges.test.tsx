import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VerificationBadges } from "./VerificationBadges";

describe("VerificationBadges", () => {
  it("renders empty state when no verifications exist", () => {
    render(<VerificationBadges verifications={[]} />);

    expect(screen.getByText("No verifications yet")).toBeInTheDocument();
  });

  it("renders badges for the latest verification", () => {
    const verifications = [
      {
        tier: "THOROUGH",
        testsPassed: true,
        lintsPassed: true,
        deslopPassed: false,
        regressionsPassed: true,
      },
    ];

    render(<VerificationBadges verifications={verifications} />);

    expect(screen.getByText("Tests")).toBeInTheDocument();
    expect(screen.getByText("Lints")).toBeInTheDocument();
    expect(screen.getByText("Deslop")).toBeInTheDocument();
    expect(screen.getByText("Regression")).toBeInTheDocument();
    expect(screen.getByText("THOROUGH")).toBeInTheDocument();
  });

  it("shows the latest verification when multiple exist", () => {
    const verifications = [
      {
        tier: "FAST",
        testsPassed: false,
        lintsPassed: false,
        deslopPassed: false,
        regressionsPassed: false,
      },
      {
        tier: "THOROUGH",
        testsPassed: true,
        lintsPassed: true,
        deslopPassed: true,
        regressionsPassed: true,
      },
    ];

    render(<VerificationBadges verifications={verifications} />);

    // Should show the latest tier
    expect(screen.getByText("THOROUGH")).toBeInTheDocument();
  });

  it("renders correct visual indicators for passed checks", () => {
    const verifications = [
      {
        tier: "FAST",
        testsPassed: true,
        lintsPassed: false,
        deslopPassed: true,
        regressionsPassed: false,
      },
    ];

    render(<VerificationBadges verifications={verifications} />);

    const testsLabel = screen.getByText("Tests");
    const testsContainer = testsLabel.closest("div");
    expect(testsContainer?.className).toContain("bg-emerald");

    const lintsLabel = screen.getByText("Lints");
    const lintsContainer = lintsLabel.closest("div");
    expect(lintsContainer?.className).toContain("bg-rose");
  });

  it("renders verification label", () => {
    const verifications = [
      {
        tier: "FAST",
        testsPassed: true,
        lintsPassed: true,
        deslopPassed: true,
        regressionsPassed: true,
      },
    ];

    render(<VerificationBadges verifications={verifications} />);

    expect(screen.getByText("Verification")).toBeInTheDocument();
  });
});

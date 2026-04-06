import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OutcomeDebriefDrawer } from "./OutcomeDebriefDrawer";
import type { ExecutionRunSummary, ProjectBlueprint, ShareableRunReport, VerificationBundle } from "../../../shared/contracts";

const mockRunSummary: ExecutionRunSummary = {
  runId: "run-123",
  status: "completed",
  executionMode: "single_agent",
  modelRole: "coder_default",
  providerId: "onprem-qwen",
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockVerification: VerificationBundle = {
  pass: true,
  changedFileChecks: ["npm test -- Button.test.tsx"],
  impactedTests: ["Button.test.tsx", "UI.test.tsx"],
  docsChecked: ["README.md"],
  artifacts: ["dist/bundle.js"],
  failures: [],
  metadata: {
    verification_reasons: ["Behavior change detected"],
    enforced_rules: ["Tests required"],
  },
};

const mockShareReport: ShareableRunReport = {
  runId: "run-123",
  summary: "Successfully implemented new button component with tests.",
  objective: "Add button component",
  createdAt: new Date().toISOString(),
  metadata: {},
};

const mockBlueprint: ProjectBlueprint = {
  version: 1,
  sourceMode: "repo_extracted",
  confidence: "high",
  charter: {
    productIntent: "Build a UI component library",
    successCriteria: ["Components are tested", "Documentation is complete"],
  },
  testingPolicy: {
    requiredForBehaviorChange: true,
  },
  documentationPolicy: {
    updateUserFacingDocs: true,
  },
  executionPolicy: {
    allowParallelExecution: false,
  },
  providerPolicy: {
    escalationPolicy: "manual",
  },
  extractedFrom: ["README.md", "package.json"],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("OutcomeDebriefDrawer", () => {
  it("renders verified outcome", () => {
    render(
      <OutcomeDebriefDrawer
        runSummary={mockRunSummary}
        verification={mockVerification}
        shareReport={mockShareReport}
        blueprint={mockBlueprint}
      />
    );

    expect(screen.getByText("verified")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
  });

  it("renders empty state when no verification", () => {
    render(
      <OutcomeDebriefDrawer
        runSummary={null}
        verification={null}
        shareReport={null}
        blueprint={null}
      />
    );

    expect(screen.getByText("idle")).toBeInTheDocument();
    expect(screen.getByText("No execution yet")).toBeInTheDocument();
  });

  it("displays verification failures", () => {
    const failedVerification: VerificationBundle = {
      ...mockVerification,
      pass: false,
      failures: ["Test suite failed", "Linting errors found"],
    };

    render(
      <OutcomeDebriefDrawer
        runSummary={mockRunSummary}
        verification={failedVerification}
        shareReport={mockShareReport}
        blueprint={mockBlueprint}
      />
    );

    expect(screen.getByText("Verification failures")).toBeInTheDocument();
    expect(screen.getByText(/Test suite failed/)).toBeInTheDocument();
    expect(screen.getByText("needs follow-up")).toBeInTheDocument();
  });

  it("displays shareable summary", () => {
    render(
      <OutcomeDebriefDrawer
        runSummary={mockRunSummary}
        verification={mockVerification}
        shareReport={mockShareReport}
        blueprint={mockBlueprint}
      />
    );

    expect(screen.getByText("Shareable summary")).toBeInTheDocument();
    expect(screen.getByText(/Successfully implemented new button component/)).toBeInTheDocument();
  });

  it("shows verification stats", () => {
    render(
      <OutcomeDebriefDrawer
        runSummary={mockRunSummary}
        verification={mockVerification}
        shareReport={mockShareReport}
        blueprint={mockBlueprint}
      />
    );

    expect(screen.getByText("Checks")).toBeInTheDocument();
    expect(screen.getByText("Tests")).toBeInTheDocument();
    expect(screen.getByText("Docs")).toBeInTheDocument();
    expect(screen.getByText("Artifacts")).toBeInTheDocument();

    // Find the stats grid and verify counts
    const checksLabel = screen.getByText("Checks");
    const checksValue = checksLabel.parentElement?.querySelector("div:nth-child(2)");
    expect(checksValue?.textContent).toBe("1");

    const testsLabel = screen.getByText("Tests");
    const testsValue = testsLabel.parentElement?.querySelector("div:nth-child(2)");
    expect(testsValue?.textContent).toBe("2");
  });

  it("displays enforced rules", () => {
    render(
      <OutcomeDebriefDrawer
        runSummary={mockRunSummary}
        verification={mockVerification}
        shareReport={mockShareReport}
        blueprint={mockBlueprint}
      />
    );

    expect(screen.getByText("Rules enforced")).toBeInTheDocument();
    expect(screen.getByText("Tests required")).toBeInTheDocument();
  });
});

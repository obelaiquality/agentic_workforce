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

  it("falls back to shareMetadata for verification_reasons when verification metadata is empty", () => {
    const verificationNoReasons: VerificationBundle = {
      ...mockVerification,
      metadata: {},
    };
    const shareWithReasons: ShareableRunReport = {
      ...mockShareReport,
      metadata: {
        verification_reasons: ["Changed test file detected"],
      },
    };

    render(
      <OutcomeDebriefDrawer
        runSummary={mockRunSummary}
        verification={verificationNoReasons}
        shareReport={shareWithReasons}
        blueprint={mockBlueprint}
      />
    );

    expect(screen.getByText("Why these checks ran")).toBeInTheDocument();
    expect(screen.getByText(/Changed test file detected/)).toBeInTheDocument();
  });

  it("falls back to shareMetadata for enforced_rules when verification metadata is empty", () => {
    const verificationNoRules: VerificationBundle = {
      ...mockVerification,
      metadata: {},
    };
    const shareWithRules: ShareableRunReport = {
      ...mockShareReport,
      metadata: {
        enforced_rules: ["Lint must pass"],
      },
    };

    render(
      <OutcomeDebriefDrawer
        runSummary={mockRunSummary}
        verification={verificationNoRules}
        shareReport={shareWithRules}
        blueprint={mockBlueprint}
      />
    );

    expect(screen.getByText("Rules enforced")).toBeInTheDocument();
    expect(screen.getByText("Lint must pass")).toBeInTheDocument();
  });

  it("falls back to changedFileChecks + impactedTests for verification commands", () => {
    const verificationNoCommands: VerificationBundle = {
      ...mockVerification,
      metadata: {},
      changedFileChecks: ["npm test -- changed.test.tsx"],
      impactedTests: ["impacted.test.tsx"],
    };

    render(
      <OutcomeDebriefDrawer
        runSummary={mockRunSummary}
        verification={verificationNoCommands}
        shareReport={{ ...mockShareReport, metadata: {} }}
        blueprint={mockBlueprint}
      />
    );

    expect(screen.getByText("Verification commands")).toBeInTheDocument();
    expect(screen.getByText("npm test -- changed.test.tsx")).toBeInTheDocument();
    expect(screen.getByText("impacted.test.tsx")).toBeInTheDocument();
  });

  it("displays verification commands from verification metadata", () => {
    const verificationWithCommands: VerificationBundle = {
      ...mockVerification,
      metadata: {
        verification_commands: ["npm run lint", "npm test"],
        verification_reasons: ["Behavior change detected"],
        enforced_rules: ["Tests required"],
      },
    };

    render(
      <OutcomeDebriefDrawer
        runSummary={mockRunSummary}
        verification={verificationWithCommands}
        shareReport={mockShareReport}
        blueprint={mockBlueprint}
      />
    );

    expect(screen.getByText("Verification commands")).toBeInTheDocument();
    expect(screen.getByText("npm run lint")).toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();
  });

  it("displays repaired files from verification metadata", () => {
    const verificationWithRepairs: VerificationBundle = {
      ...mockVerification,
      metadata: {
        repaired_files: ["src/Button.tsx", "src/Input.tsx"],
        verification_reasons: ["Behavior change detected"],
        enforced_rules: ["Tests required"],
      },
    };

    render(
      <OutcomeDebriefDrawer
        runSummary={mockRunSummary}
        verification={verificationWithRepairs}
        shareReport={mockShareReport}
        blueprint={mockBlueprint}
      />
    );

    expect(screen.getByText("Repair loop touched")).toBeInTheDocument();
    expect(screen.getByText(/src\/Button\.tsx/)).toBeInTheDocument();
    expect(screen.getByText(/src\/Input\.tsx/)).toBeInTheDocument();
  });

  it("falls back to shareMetadata for repaired_files", () => {
    const verificationNoRepairs: VerificationBundle = {
      ...mockVerification,
      metadata: {},
    };
    const shareWithRepairs: ShareableRunReport = {
      ...mockShareReport,
      metadata: {
        repaired_files: ["src/Card.tsx"],
      },
    };

    render(
      <OutcomeDebriefDrawer
        runSummary={mockRunSummary}
        verification={verificationNoRepairs}
        shareReport={shareWithRepairs}
        blueprint={mockBlueprint}
      />
    );

    expect(screen.getByText("Repair loop touched")).toBeInTheDocument();
    expect(screen.getByText(/src\/Card\.tsx/)).toBeInTheDocument();
  });

  it("shows blueprint defaults when no enforced rules and blueprint is provided", () => {
    const verificationNoRules: VerificationBundle = {
      ...mockVerification,
      metadata: {},
    };

    render(
      <OutcomeDebriefDrawer
        runSummary={mockRunSummary}
        verification={verificationNoRules}
        shareReport={{ ...mockShareReport, metadata: {} }}
        blueprint={mockBlueprint}
      />
    );

    expect(screen.getByText("Blueprint defaults")).toBeInTheDocument();
    expect(screen.getByText("Tests required for behavior changes")).toBeInTheDocument();
    expect(screen.getByText("Docs updates expected")).toBeInTheDocument();
  });

  it("shows blueprint defaults with optional policies", () => {
    const blueprintOptional: ProjectBlueprint = {
      ...mockBlueprint,
      testingPolicy: {
        requiredForBehaviorChange: false,
      },
      documentationPolicy: {
        updateUserFacingDocs: false,
      },
    };
    const verificationNoRules: VerificationBundle = {
      ...mockVerification,
      metadata: {},
    };

    render(
      <OutcomeDebriefDrawer
        runSummary={mockRunSummary}
        verification={verificationNoRules}
        shareReport={{ ...mockShareReport, metadata: {} }}
        blueprint={blueprintOptional}
      />
    );

    expect(screen.getByText("Blueprint defaults")).toBeInTheDocument();
    expect(screen.getByText("Tests optional by default")).toBeInTheDocument();
    expect(screen.getByText("Docs optional by default")).toBeInTheDocument();
  });

  it("renders run summary with provider, model role, and execution mode labels", () => {
    render(
      <OutcomeDebriefDrawer
        runSummary={mockRunSummary}
        verification={mockVerification}
        shareReport={mockShareReport}
        blueprint={mockBlueprint}
      />
    );

    // onprem-qwen => "Local Qwen", coder_default => "Build", single_agent => "Single Agent"
    expect(screen.getByText(/Local Qwen/)).toBeInTheDocument();
    expect(screen.getByText(/Build/)).toBeInTheDocument();
    expect(screen.getByText(/Single Agent/)).toBeInTheDocument();
  });

  it("renders pass icon (CheckCircle2) when verification passes", () => {
    render(
      <OutcomeDebriefDrawer
        runSummary={mockRunSummary}
        verification={mockVerification}
        shareReport={mockShareReport}
        blueprint={mockBlueprint}
      />
    );

    expect(screen.getByText("Verification bundle")).toBeInTheDocument();
    expect(screen.getByText("verified")).toBeInTheDocument();
  });

  it("renders idle chip and descriptive text when no run summary or verification", () => {
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
    expect(screen.getByText(/Review a route and execute to see/)).toBeInTheDocument();
  });

  it("shows 0 for all stats when verification is null", () => {
    render(
      <OutcomeDebriefDrawer
        runSummary={null}
        verification={null}
        shareReport={null}
        blueprint={null}
      />
    );

    const checksLabel = screen.getByText("Checks");
    const checksValue = checksLabel.parentElement?.querySelector("div:nth-child(2)");
    expect(checksValue?.textContent).toBe("0");
  });
});

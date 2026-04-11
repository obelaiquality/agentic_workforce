import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectBlueprintPanel } from "./ProjectBlueprintPanel";
import type { ProjectBlueprint } from "../../../shared/contracts";

const mockBlueprint: ProjectBlueprint = {
  version: 1,
  sourceMode: "repo_extracted",
  confidence: "high",
  charter: {
    productIntent: "Build a modern UI component library for React",
    successCriteria: ["Components are tested", "Documentation is complete", "Accessible by default"],
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
  extractedFrom: ["README.md", "CONTRIBUTING.md", "package.json"],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("ProjectBlueprintPanel", () => {
  it("renders empty state when no blueprint and no active repo", () => {
    render(<ProjectBlueprintPanel blueprint={null} hasActiveRepo={false} />);

    expect(screen.getByText("draft pending")).toBeInTheDocument();
    expect(screen.getByText(/Connect a repo to generate/)).toBeInTheDocument();
  });

  it("shows generate button when repo is active but no blueprint", () => {
    const onRegenerate = vi.fn();
    render(
      <ProjectBlueprintPanel
        blueprint={null}
        hasActiveRepo={true}
        onRegenerate={onRegenerate}
      />
    );

    expect(screen.getByText(/No blueprint yet/)).toBeInTheDocument();
    const generateButton = screen.getByText("Generate Blueprint");
    expect(generateButton).toBeInTheDocument();

    fireEvent.click(generateButton);
    expect(onRegenerate).toHaveBeenCalledOnce();
  });

  it("displays blueprint summary", () => {
    render(<ProjectBlueprintPanel blueprint={mockBlueprint} />);

    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getAllByText("Build a modern UI component library for React").length).toBeGreaterThan(0);
    expect(screen.getByText("Tests required on behavior changes")).toBeInTheDocument();
    expect(screen.getByText("Docs update expected")).toBeInTheDocument();
  });

  it("shows customized badge for repo_plus_override mode", () => {
    const customizedBlueprint: ProjectBlueprint = {
      ...mockBlueprint,
      sourceMode: "repo_plus_override",
    };

    render(<ProjectBlueprintPanel blueprint={customizedBlueprint} />);
    expect(screen.getByText("customized")).toBeInTheDocument();
  });

  it("displays success criteria as chips", () => {
    render(<ProjectBlueprintPanel blueprint={mockBlueprint} />);

    expect(screen.getByText("Components are tested")).toBeInTheDocument();
    expect(screen.getByText("Documentation is complete")).toBeInTheDocument();
  });

  it("renders compact mode correctly", () => {
    render(<ProjectBlueprintPanel blueprint={mockBlueprint} compact={true} />);

    expect(screen.getByText("v1")).toBeInTheDocument();
    // In compact mode, we still see the blueprint but in a condensed format
    expect(screen.queryByText("Product intent")).not.toBeInTheDocument();
  });

  it("calls onUpdate when save blueprint is clicked", () => {
    const onUpdate = vi.fn();
    render(
      <ProjectBlueprintPanel
        blueprint={mockBlueprint}
        hasActiveRepo={true}
        onUpdate={onUpdate}
      />
    );

    const saveButton = screen.getByText("Save blueprint");
    fireEvent.click(saveButton);
    expect(onUpdate).toHaveBeenCalled();
  });

  it("allows editing product intent", () => {
    const onUpdate = vi.fn();
    render(
      <ProjectBlueprintPanel
        blueprint={mockBlueprint}
        hasActiveRepo={true}
        onUpdate={onUpdate}
      />
    );

    const textarea = screen.getByDisplayValue(/Build a modern UI component library/);
    expect(textarea).toBeInTheDocument();
    fireEvent.change(textarea, { target: { value: "Updated intent" } });
    expect(textarea).toHaveValue("Updated intent");
  });

  it("toggles policy checkboxes", () => {
    const onUpdate = vi.fn();
    render(
      <ProjectBlueprintPanel
        blueprint={mockBlueprint}
        hasActiveRepo={true}
        onUpdate={onUpdate}
      />
    );

    const testCheckbox = screen.getByLabelText("Require tests for behavior changes");
    fireEvent.click(testCheckbox);
    expect(onUpdate).toHaveBeenCalled();
  });

  it("shows extracted sources count", () => {
    render(<ProjectBlueprintPanel blueprint={mockBlueprint} />);

    expect(screen.getByText(/Extracted from 3 repo source/)).toBeInTheDocument();
  });

  it("shows singular source text for single extracted source", () => {
    const singleSource: ProjectBlueprint = {
      ...mockBlueprint,
      extractedFrom: ["README.md"],
    };
    render(<ProjectBlueprintPanel blueprint={singleSource} />);

    expect(screen.getByText(/Extracted from 1 repo source\./)).toBeInTheDocument();
  });

  it("displays tests optional summary when requiredForBehaviorChange is false", () => {
    const optionalTests: ProjectBlueprint = {
      ...mockBlueprint,
      testingPolicy: { requiredForBehaviorChange: false },
    };
    render(<ProjectBlueprintPanel blueprint={optionalTests} />);

    expect(screen.getByText("Tests optional by default")).toBeInTheDocument();
  });

  it("displays docs update optional summary when updateUserFacingDocs is false", () => {
    const optionalDocs: ProjectBlueprint = {
      ...mockBlueprint,
      documentationPolicy: { updateUserFacingDocs: false },
    };
    render(<ProjectBlueprintPanel blueprint={optionalDocs} />);

    expect(screen.getByText("Docs update optional")).toBeInTheDocument();
  });

  it("displays parallel execution allowed summary", () => {
    const parallel: ProjectBlueprint = {
      ...mockBlueprint,
      executionPolicy: { allowParallelExecution: true },
    };
    render(<ProjectBlueprintPanel blueprint={parallel} />);

    expect(screen.getByText("Parallel execution allowed")).toBeInTheDocument();
  });

  it("does not show confidence chip when confidence is null", () => {
    const noConfidence: ProjectBlueprint = {
      ...mockBlueprint,
      confidence: null,
    };
    render(<ProjectBlueprintPanel blueprint={noConfidence} />);

    expect(screen.queryByText(/confidence/)).not.toBeInTheDocument();
  });

  it("shows isActing state with Generating text on generate button", () => {
    const onRegenerate = vi.fn();
    render(
      <ProjectBlueprintPanel
        blueprint={null}
        hasActiveRepo={true}
        isActing={true}
        onRegenerate={onRegenerate}
      />
    );

    expect(screen.getByText("Generating...")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /Generating/i });
    expect(button).toBeDisabled();
  });

  it("does not show generate button when no onRegenerate and no blueprint", () => {
    render(<ProjectBlueprintPanel blueprint={null} hasActiveRepo={true} />);

    expect(screen.getByText(/No blueprint yet/)).toBeInTheDocument();
    expect(screen.queryByText("Generate Blueprint")).not.toBeInTheDocument();
  });

  it("toggles docs policy checkbox", () => {
    const onUpdate = vi.fn();
    render(
      <ProjectBlueprintPanel
        blueprint={mockBlueprint}
        hasActiveRepo={true}
        onUpdate={onUpdate}
      />
    );

    const docsCheckbox = screen.getByLabelText("Expect user-facing docs updates");
    fireEvent.click(docsCheckbox);
    expect(onUpdate).toHaveBeenCalledWith({
      documentationPolicy: expect.objectContaining({ updateUserFacingDocs: false }),
    });
  });

  it("toggles parallel execution checkbox", () => {
    const onUpdate = vi.fn();
    render(
      <ProjectBlueprintPanel
        blueprint={mockBlueprint}
        hasActiveRepo={true}
        onUpdate={onUpdate}
      />
    );

    const executionCheckbox = screen.getByLabelText("Allow parallel execution");
    fireEvent.click(executionCheckbox);
    expect(onUpdate).toHaveBeenCalledWith({
      executionPolicy: expect.objectContaining({ allowParallelExecution: true }),
    });
  });

  it("changes escalation policy via select (non-compact)", () => {
    const onUpdate = vi.fn();
    render(
      <ProjectBlueprintPanel
        blueprint={mockBlueprint}
        hasActiveRepo={true}
        onUpdate={onUpdate}
      />
    );

    const escalationSelect = screen.getByDisplayValue("Manual");
    fireEvent.change(escalationSelect, { target: { value: "auto" } });
    expect(onUpdate).toHaveBeenCalledWith({
      providerPolicy: expect.objectContaining({ escalationPolicy: "auto" }),
    });
  });

  it("shows refresh button with isActing state on existing blueprint", () => {
    const onRegenerate = vi.fn();
    render(
      <ProjectBlueprintPanel
        blueprint={mockBlueprint}
        hasActiveRepo={true}
        isActing={true}
        onRegenerate={onRegenerate}
      />
    );

    expect(screen.getByText("Refreshing...")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /Refreshing/i });
    expect(button).toBeDisabled();
  });

  it("saves blueprint with edited product intent and success criteria", () => {
    const onUpdate = vi.fn();
    render(
      <ProjectBlueprintPanel
        blueprint={mockBlueprint}
        hasActiveRepo={true}
        onUpdate={onUpdate}
      />
    );

    // Edit product intent
    const intentTextarea = screen.getByDisplayValue(/Build a modern UI component library/);
    fireEvent.change(intentTextarea, { target: { value: "New product intent" } });

    // Edit success criteria
    const criteriaTextarea = screen.getByDisplayValue(/Components are tested/);
    fireEvent.change(criteriaTextarea, { target: { value: "Criterion A\nCriterion B" } });

    // Click save
    const saveButton = screen.getByText("Save blueprint");
    fireEvent.click(saveButton);

    expect(onUpdate).toHaveBeenCalledWith({
      charter: expect.objectContaining({
        productIntent: "New product intent",
        successCriteria: ["Criterion A", "Criterion B"],
      }),
    });
  });

  it("does not call onUpdate when save is clicked but canSave is false", () => {
    // No onUpdate provided, so canSave is false
    render(
      <ProjectBlueprintPanel
        blueprint={mockBlueprint}
        hasActiveRepo={true}
      />
    );

    const saveButton = screen.getByText("Save blueprint");
    expect(saveButton).toBeDisabled();
  });

  it("renders compact mode with onUpdate showing CompactToggles", () => {
    const onUpdate = vi.fn();
    render(
      <ProjectBlueprintPanel
        blueprint={mockBlueprint}
        compact={true}
        onUpdate={onUpdate}
      />
    );

    // Compact toggles should be present
    const testsCheckbox = screen.getByLabelText("Tests required");
    expect(testsCheckbox).toBeInTheDocument();
    fireEvent.click(testsCheckbox);
    expect(onUpdate).toHaveBeenCalledWith({
      testingPolicy: expect.objectContaining({ requiredForBehaviorChange: false }),
    });

    const docsCheckbox = screen.getByLabelText("Docs expected");
    expect(docsCheckbox).toBeInTheDocument();
    fireEvent.click(docsCheckbox);
    expect(onUpdate).toHaveBeenCalledWith({
      documentationPolicy: expect.objectContaining({ updateUserFacingDocs: false }),
    });
  });

  it("renders compact mode escalation select", () => {
    const onUpdate = vi.fn();
    render(
      <ProjectBlueprintPanel
        blueprint={mockBlueprint}
        compact={true}
        onUpdate={onUpdate}
      />
    );

    const escalationSelect = screen.getByDisplayValue("Manual");
    fireEvent.change(escalationSelect, { target: { value: "high_risk_only" } });
    expect(onUpdate).toHaveBeenCalledWith({
      providerPolicy: expect.objectContaining({ escalationPolicy: "high_risk_only" }),
    });
  });

  it("renders compact mode with onRegenerate button", () => {
    const onRegenerate = vi.fn();
    render(
      <ProjectBlueprintPanel
        blueprint={mockBlueprint}
        compact={true}
        onRegenerate={onRegenerate}
      />
    );

    const refreshButton = screen.getByRole("button", { name: /refresh/i });
    expect(refreshButton).toBeInTheDocument();
    fireEvent.click(refreshButton);
    expect(onRegenerate).toHaveBeenCalledOnce();
  });

  it("renders compact mode with isActing on refresh button", () => {
    const onRegenerate = vi.fn();
    render(
      <ProjectBlueprintPanel
        blueprint={mockBlueprint}
        compact={true}
        isActing={true}
        onRegenerate={onRegenerate}
      />
    );

    expect(screen.getByText("Refreshing...")).toBeInTheDocument();
  });

  it("renders compact mode with onOpenDetails showing Refine button", () => {
    const onOpenDetails = vi.fn();
    render(
      <ProjectBlueprintPanel
        blueprint={mockBlueprint}
        compact={true}
        onOpenDetails={onOpenDetails}
      />
    );

    const refineButton = screen.getByRole("button", { name: /refine/i });
    expect(refineButton).toBeInTheDocument();
    fireEvent.click(refineButton);
    expect(onOpenDetails).toHaveBeenCalledOnce();
  });

  it("does not show CompactToggles when onUpdate is not provided in compact mode", () => {
    render(<ProjectBlueprintPanel blueprint={mockBlueprint} compact={true} />);

    expect(screen.queryByLabelText("Tests required")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Docs expected")).not.toBeInTheDocument();
  });

  it("displays compact mode extracted sources with singular text", () => {
    const singleSource: ProjectBlueprint = {
      ...mockBlueprint,
      extractedFrom: ["README.md"],
    };
    render(<ProjectBlueprintPanel blueprint={singleSource} compact={true} />);

    expect(screen.getByText(/1 guidance source informing/)).toBeInTheDocument();
  });

  it("displays compact mode extracted sources with plural text", () => {
    render(<ProjectBlueprintPanel blueprint={mockBlueprint} compact={true} />);

    expect(screen.getByText(/3 guidance sources informing/)).toBeInTheDocument();
  });

  it("does not show refresh button in compact mode when onRegenerate is not provided", () => {
    render(<ProjectBlueprintPanel blueprint={mockBlueprint} compact={true} />);

    expect(screen.queryByRole("button", { name: /refresh/i })).not.toBeInTheDocument();
  });

  it("does not show Refine button in compact mode when onOpenDetails is not provided", () => {
    render(<ProjectBlueprintPanel blueprint={mockBlueprint} compact={true} />);

    expect(screen.queryByRole("button", { name: /refine/i })).not.toBeInTheDocument();
  });

  it("limits success criteria to 3 items in compact mode", () => {
    const manySuccessCriteria: ProjectBlueprint = {
      ...mockBlueprint,
      charter: {
        ...mockBlueprint.charter,
        successCriteria: ["A", "B", "C", "D", "E"],
      },
    };
    render(<ProjectBlueprintPanel blueprint={manySuccessCriteria} compact={true} />);

    // In compact mode, only 3 criteria should be displayed
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();
    expect(screen.queryByText("D")).not.toBeInTheDocument();
    expect(screen.queryByText("E")).not.toBeInTheDocument();
  });

  it("shows up to 5 success criteria in non-compact mode", () => {
    const manySuccessCriteria: ProjectBlueprint = {
      ...mockBlueprint,
      charter: {
        ...mockBlueprint.charter,
        successCriteria: ["A", "B", "C", "D", "E", "F"],
      },
    };
    render(<ProjectBlueprintPanel blueprint={manySuccessCriteria} />);

    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("E")).toBeInTheDocument();
    expect(screen.queryByText("F")).not.toBeInTheDocument();
  });

  it("does not show refresh button in non-compact when onRegenerate is not provided", () => {
    render(<ProjectBlueprintPanel blueprint={mockBlueprint} />);

    expect(screen.queryByRole("button", { name: /Refresh from repo/i })).not.toBeInTheDocument();
  });

  it("shows Refresh from repo button when onRegenerate is provided (non-compact)", () => {
    const onRegenerate = vi.fn();
    render(
      <ProjectBlueprintPanel
        blueprint={mockBlueprint}
        onRegenerate={onRegenerate}
      />
    );

    const refreshButton = screen.getByRole("button", { name: /Refresh from repo/i });
    expect(refreshButton).toBeInTheDocument();
    fireEvent.click(refreshButton);
    expect(onRegenerate).toHaveBeenCalledOnce();
  });

  it("displays confidence chip when confidence is set", () => {
    render(<ProjectBlueprintPanel blueprint={mockBlueprint} />);

    expect(screen.getByText("high confidence")).toBeInTheDocument();
  });

  it("edits success criteria textarea", () => {
    const onUpdate = vi.fn();
    render(
      <ProjectBlueprintPanel
        blueprint={mockBlueprint}
        hasActiveRepo={true}
        onUpdate={onUpdate}
      />
    );

    const criteriaTextarea = screen.getByDisplayValue(/Components are tested/);
    fireEvent.change(criteriaTextarea, { target: { value: "New criterion\nAnother one" } });
    expect(criteriaTextarea).toHaveValue("New criterion\nAnother one");
  });

  it("displays extracted source file names truncated to last 2 segments", () => {
    const deepPaths: ProjectBlueprint = {
      ...mockBlueprint,
      extractedFrom: ["repo/src/deep/README.md"],
    };
    render(<ProjectBlueprintPanel blueprint={deepPaths} />);

    // Should show last 2 segments: "deep/README.md"
    expect(screen.getByText("deep/README.md")).toBeInTheDocument();
  });
});

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
});

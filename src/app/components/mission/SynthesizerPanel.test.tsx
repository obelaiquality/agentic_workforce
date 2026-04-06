import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SynthesizerPanel } from "./SynthesizerPanel";
import type { ContextPack, RoutingDecision } from "../../../shared/contracts";

const mockRoute: RoutingDecision = {
  executionMode: "single_agent",
  modelRole: "coder_default",
  providerId: "onprem-qwen",
  verificationDepth: "standard",
  decompositionScore: 0.85,
  rationale: ["High confidence in single-file approach", "Minimal cross-file dependencies"],
  maxLanes: 1,
  estimatedComplexity: "medium",
};

const mockContextPack: ContextPack = {
  files: ["src/components/Button.tsx", "src/components/Input.tsx"],
  tests: ["src/components/Button.test.tsx"],
  docs: ["README.md"],
  why: ["Button component is central to the UI", "Input component shares similar patterns"],
};

describe("SynthesizerPanel", () => {
  it("renders idle state when no route", () => {
    render(
      <SynthesizerPanel
        route={null}
        contextPack={null}
        blockedByApprovals={false}
        onApplyRecommendation={vi.fn()}
      />
    );

    expect(screen.getByText("idle")).toBeInTheDocument();
    expect(screen.getByText(/Review a route to see the recommended lane/)).toBeInTheDocument();
  });

  it("renders ready state when route is available", () => {
    render(
      <SynthesizerPanel
        route={mockRoute}
        contextPack={mockContextPack}
        blockedByApprovals={false}
        onApplyRecommendation={vi.fn()}
      />
    );

    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(screen.getByText(/Single Agent via Build/)).toBeInTheDocument();
  });

  it("displays approval gate warning when blocked", () => {
    render(
      <SynthesizerPanel
        route={mockRoute}
        contextPack={mockContextPack}
        blockedByApprovals={true}
        onApplyRecommendation={vi.fn()}
      />
    );

    expect(screen.getByText("approval gate")).toBeInTheDocument();
    expect(screen.getByText("Approval required")).toBeInTheDocument();
    expect(screen.getByText(/Resolve the pending approval/)).toBeInTheDocument();
  });

  it("displays route rationale", () => {
    render(
      <SynthesizerPanel
        route={mockRoute}
        contextPack={mockContextPack}
        blockedByApprovals={false}
        onApplyRecommendation={vi.fn()}
      />
    );

    expect(screen.getByText("High confidence in single-file approach")).toBeInTheDocument();
  });

  it("shows context pack information", () => {
    render(
      <SynthesizerPanel
        route={mockRoute}
        contextPack={mockContextPack}
        blockedByApprovals={false}
        onApplyRecommendation={vi.fn()}
      />
    );

    expect(screen.getByText("Context Pack")).toBeInTheDocument();
    expect(screen.getByText("2 files / 1 tests")).toBeInTheDocument();
  });

  it("displays confidence percentage", () => {
    render(
      <SynthesizerPanel
        route={mockRoute}
        contextPack={mockContextPack}
        blockedByApprovals={false}
        onApplyRecommendation={vi.fn()}
      />
    );

    expect(screen.getByText("Confidence")).toBeInTheDocument();
    // Confidence is calculated from decompositionScore
    expect(screen.getByText(/79%/)).toBeInTheDocument();
  });

  it("displays context rationale when available", () => {
    render(
      <SynthesizerPanel
        route={mockRoute}
        contextPack={mockContextPack}
        blockedByApprovals={false}
        onApplyRecommendation={vi.fn()}
      />
    );

    expect(screen.getByText("Why this context")).toBeInTheDocument();
    expect(screen.getByText("Button component is central to the UI")).toBeInTheDocument();
    expect(screen.getByText("Input component shares similar patterns")).toBeInTheDocument();
  });

  it("calls onApplyRecommendation when button is clicked", () => {
    const onApplyRecommendation = vi.fn();
    render(
      <SynthesizerPanel
        route={mockRoute}
        contextPack={mockContextPack}
        blockedByApprovals={false}
        onApplyRecommendation={onApplyRecommendation}
      />
    );

    const applyButton = screen.getByText("Apply Recommendation");
    fireEvent.click(applyButton);
    expect(onApplyRecommendation).toHaveBeenCalledOnce();
  });

  it("disables apply button when no route", () => {
    render(
      <SynthesizerPanel
        route={null}
        contextPack={null}
        blockedByApprovals={false}
        onApplyRecommendation={vi.fn()}
      />
    );

    const applyButton = screen.getByText("Apply Recommendation");
    expect(applyButton).toBeDisabled();
  });

  it("shows not built yet when no context pack", () => {
    render(
      <SynthesizerPanel
        route={mockRoute}
        contextPack={null}
        blockedByApprovals={false}
        onApplyRecommendation={vi.fn()}
      />
    );

    expect(screen.getByText("Not built yet")).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiffViewer } from "./DiffViewer";

function makeMission(overrides: Record<string, unknown> = {}) {
  return {
    route: null,
    contextPack: null,
    isExecuting: false,
    isReviewing: false,
    isActing: false,
    selectedTicket: null,
    selectedExecutionProfile: { id: "balanced", name: "Balanced" },
    actionMessage: null,
    input: "",
    selectedRepo: null,
    reviewRoute: vi.fn(),
    executeRoute: vi.fn(),
    ...overrides,
  };
}

describe("DiffViewer", () => {
  it("renders the plan review panel in planning state", () => {
    render(
      <DiffViewer
        mission={makeMission() as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );

    expect(screen.getByText("Review the Plan")).toBeInTheDocument();
    expect(screen.getByText("planning")).toBeInTheDocument();
    expect(screen.getByText("Review the plan to generate context and a route.")).toBeInTheDocument();
  });

  it("shows ready to run state when route and context pack exist", () => {
    render(
      <DiffViewer
        mission={makeMission({
          route: { executionMode: "single_agent", modelRole: "coder_default", metadata: { confidence: 0.92 }, providerId: "onprem-qwen" },
          contextPack: { files: ["a.ts"], tests: ["a.test.ts"], docs: [], confidence: 0.92 },
        }) as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );

    expect(screen.getByText("ready to run")).toBeInTheDocument();
    expect(screen.getByText("Plan is ready to run.")).toBeInTheDocument();
  });

  it("renders action buttons", () => {
    render(
      <DiffViewer
        mission={makeMission() as never}
        onOpenSettings={vi.fn()}
        onOpenConsole={vi.fn()}
      />
    );

    expect(screen.getByText("Open Advanced")).toBeInTheDocument();
    expect(screen.getByText("Open Console")).toBeInTheDocument();
  });
});

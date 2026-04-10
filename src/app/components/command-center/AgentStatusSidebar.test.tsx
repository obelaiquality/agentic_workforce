import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentStatusSidebar } from "./AgentStatusSidebar";

function makeMission(overrides: Record<string, unknown> = {}) {
  return {
    experimentalAutonomy: { channels: [], subagents: [] },
    ...overrides,
  } as any;
}

describe("AgentStatusSidebar", () => {
  it("renders idle state when no activity", () => {
    render(<AgentStatusSidebar mission={makeMission()} onOpenSettings={vi.fn()} />);
    expect(screen.getByText(/experimental idle/i)).toBeInTheDocument();
  });

  it("renders activity state with channels", () => {
    const mission = makeMission({
      experimentalAutonomy: {
        channels: [{ id: "ch-1", source: "webhook", senderId: "ci", trustLevel: "trusted", content: "Build passed", createdAt: new Date().toISOString() }],
        subagents: [],
      },
    });
    render(<AgentStatusSidebar mission={mission} onOpenSettings={vi.fn()} />);
    expect(screen.getByText(/experimental activity/i)).toBeInTheDocument();
    expect(screen.getByText("webhook")).toBeInTheDocument();
  });

  it("shows configure button", () => {
    const onSettings = vi.fn();
    render(<AgentStatusSidebar mission={makeMission()} onOpenSettings={onSettings} />);
    expect(screen.getByText("Configure")).toBeInTheDocument();
  });
});

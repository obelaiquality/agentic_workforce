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

  it("shows configure button and calls onOpenSettings when clicked", () => {
    const onSettings = vi.fn();
    render(<AgentStatusSidebar mission={makeMission()} onOpenSettings={onSettings} />);
    const btn = screen.getByText("Configure");
    expect(btn).toBeInTheDocument();
    btn.click();
    expect(onSettings).toHaveBeenCalled();
  });

  it("renders subagent entries with correct status chips", () => {
    const mission = makeMission({
      experimentalAutonomy: {
        channels: [],
        subagents: [
          { id: "sa-1", role: "code_writer", status: "completed", summary: "Wrote feature code", createdAt: new Date().toISOString() },
          { id: "sa-2", role: "test_runner", status: "failed", summary: "Tests failed", createdAt: new Date().toISOString() },
          { id: "sa-3", role: "reviewer", status: "pending", summary: "Awaiting review", createdAt: new Date().toISOString() },
        ],
      },
    });
    render(<AgentStatusSidebar mission={mission} onOpenSettings={vi.fn()} />);
    expect(screen.getByText("code writer")).toBeInTheDocument();
    expect(screen.getByText("test runner")).toBeInTheDocument();
    expect(screen.getByText("reviewer")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(screen.getByText("Wrote feature code")).toBeInTheDocument();
  });

  it("shows empty channel message when no channels exist", () => {
    render(<AgentStatusSidebar mission={makeMission()} onOpenSettings={vi.fn()} />);
    expect(screen.getByText(/No inbound channel activity yet/i)).toBeInTheDocument();
  });

  it("shows empty subagent message when no subagents exist", () => {
    render(<AgentStatusSidebar mission={makeMission()} onOpenSettings={vi.fn()} />);
    expect(screen.getByText(/No subagent plans recorded yet/i)).toBeInTheDocument();
  });

  it("renders untrusted channel with warn chip", () => {
    const mission = makeMission({
      experimentalAutonomy: {
        channels: [{ id: "ch-2", source: "telegram", senderId: "user123", trustLevel: "untrusted", content: "Deploy now", createdAt: new Date().toISOString() }],
        subagents: [],
      },
    });
    render(<AgentStatusSidebar mission={mission} onOpenSettings={vi.fn()} />);
    expect(screen.getByText("untrusted")).toBeInTheDocument();
    expect(screen.getByText("telegram")).toBeInTheDocument();
    expect(screen.getByText("Deploy now")).toBeInTheDocument();
  });

  it("renders multiple channels up to 4", () => {
    const channels = Array.from({ length: 6 }, (_, i) => ({
      id: `ch-${i}`,
      source: `source-${i}`,
      senderId: `sender-${i}`,
      trustLevel: "trusted",
      content: `Message ${i}`,
      createdAt: new Date().toISOString(),
    }));
    const mission = makeMission({
      experimentalAutonomy: { channels, subagents: [] },
    });
    render(<AgentStatusSidebar mission={mission} onOpenSettings={vi.fn()} />);
    // Only first 4 should render (slice(0, 4))
    expect(screen.getByText("source-0")).toBeInTheDocument();
    expect(screen.getByText("source-3")).toBeInTheDocument();
    expect(screen.queryByText("source-4")).not.toBeInTheDocument();
  });
});

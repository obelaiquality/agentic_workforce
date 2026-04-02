import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgenticRunDeepPanel } from "./AgenticRunDeepPanel";
import type { AgenticRunSnapshot } from "../../../shared/contracts";

function createRun(): AgenticRunSnapshot {
  const now = new Date().toISOString();
  return {
    runId: "run-1",
    status: "running",
    phase: "executing",
    plan: null,
    iterationCount: 3,
    toolCallCount: 2,
    approvalCount: 1,
    deniedCount: 0,
    compactionCount: 1,
    doomLoopCount: 1,
    escalationCount: 1,
    thinkingTokenCount: 120,
    lastAssistantText: "Latest assistant output",
    lastReason: "Awaiting final verification",
    latestRole: "coder_default",
    budget: {
      tokensConsumed: 900,
      maxTokens: 2000,
      costUsdConsumed: 0.12,
      maxCostUsd: 1,
      iterationsConsumed: 3,
      maxIterations: 10,
      tokenTimeline: [
        { iteration: 1, tokens: 200, timestamp: now },
        { iteration: 2, tokens: 500, timestamp: now },
        { iteration: 3, tokens: 900, timestamp: now },
      ],
    },
    recentEvents: [],
    toolCalls: [
      {
        id: "tool-1",
        iteration: 1,
        name: "read_file",
        args: { path: "src/app.ts" },
        result: { type: "success", content: "ok" },
        policyDecision: "allow",
        durationMs: 14,
        timestamp: now,
      },
    ],
    compactionEvents: [
      {
        iteration: 2,
        stage: "mid_run",
        tokensBefore: 1200,
        tokensAfter: 700,
        timestamp: now,
      },
    ],
    escalations: [
      {
        iteration: 3,
        fromRole: "coder_default",
        toRole: "review_deep",
        reason: "Need deeper review",
        timestamp: now,
      },
    ],
    doomLoops: [
      {
        iteration: 3,
        reason: "Repeated failing tool call",
        suggestion: "Escalate to review",
        timestamp: now,
      },
    ],
    skillEvents: [],
    hookEvents: [],
    memoryExtractions: [],
    thinkingLog: "Reasoning trace",
  };
}

describe("AgenticRunDeepPanel", () => {
  it("renders the expanded agentic run sections", () => {
    render(<AgenticRunDeepPanel run={createRun()} />);

    expect(screen.getByText("Awaiting final verification")).toBeInTheDocument();
    expect(screen.getByText("Latest assistant output")).toBeInTheDocument();
    expect(screen.getByText("Repeated failing tool call")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Tool Calls/i }));
    expect(screen.getByText("read_file")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Context Compaction/i }));
    expect(screen.getByText(/\(500 saved\)/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Escalations/i }));
    expect(screen.getByText("Need deeper review")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Thinking Log/i }));
    expect(screen.getByText("Reasoning trace")).toBeInTheDocument();
  });
});

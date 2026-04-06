import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskInsightPanel } from "./TaskInsightPanel";
import type { TaskSpotlight } from "../lib/missionTypes";

const mockSpotlight: TaskSpotlight = {
  task_id: "task-123",
  title: "Implement button component",
  lifecycle: {
    current_phase: "execution",
    events: [
      {
        timestamp: new Date().toISOString(),
        severity: "INFO",
        message: "Task started",
      },
      {
        timestamp: new Date().toISOString(),
        severity: "WARNING",
        message: "Memory usage high",
      },
    ],
  },
  phase_durations: {
    planning: 5,
    execution: 12,
  },
  latest_transition_reason: "Ready for execution",
  latest_artifact: {
    payload: {
      outcome: {
        success: true,
        worker_id: 1,
        attempts: 2,
        patches_applied: 3,
        token_usage: {
          total_tokens: 1500,
        },
      },
      llm_outputs: [
        "diff --git a/Button.tsx b/Button.tsx\n--- a/Button.tsx\n+++ b/Button.tsx\n@@ -1,3 +1,5 @@\n+import React from 'react';\n+\n export function Button() {\n   return <button>Click me</button>;\n }",
      ],
    },
    llm_output_count: 1,
    markdown_summary: "Successfully created Button component with tests",
  },
};

describe("TaskInsightPanel", () => {
  it("renders empty state when no spotlight", () => {
    render(<TaskInsightPanel spotlight={null} />);

    expect(screen.getByText("Task Insight Report")).toBeInTheDocument();
    expect(screen.getByText(/Select a task to view artifact summary/)).toBeInTheDocument();
  });

  it("displays task ID and title", () => {
    render(<TaskInsightPanel spotlight={mockSpotlight} />);

    expect(screen.getByText("task-123")).toBeInTheDocument();
  });

  it("shows key metrics", () => {
    render(<TaskInsightPanel spotlight={mockSpotlight} />);

    expect(screen.getByText("Attempts")).toBeInTheDocument();
    const attemptsCell = screen.getByText("Attempts").closest("div");
    expect(attemptsCell?.textContent).toContain("2");

    expect(screen.getByText("Patches")).toBeInTheDocument();
    const patchesCell = screen.getByText("Patches").closest("div");
    expect(patchesCell?.textContent).toContain("3");

    expect(screen.getByText("Worker")).toBeInTheDocument();
    const workerCell = screen.getByText("Worker").closest("div");
    expect(workerCell?.textContent).toContain("1");
  });

  it("displays token usage", () => {
    render(<TaskInsightPanel spotlight={mockSpotlight} />);

    expect(screen.getByText("Tokens")).toBeInTheDocument();
    expect(screen.getByText("1.5k")).toBeInTheDocument(); // 1500 tokens formatted
  });

  it("shows success status", () => {
    render(<TaskInsightPanel spotlight={mockSpotlight} />);

    expect(screen.getByText("Success")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
  });

  it("displays failure status for failed tasks", () => {
    const failedSpotlight: TaskSpotlight = {
      ...mockSpotlight,
      latest_artifact: {
        ...mockSpotlight.latest_artifact,
        payload: {
          ...mockSpotlight.latest_artifact!.payload,
          outcome: {
            success: false,
            worker_id: 1,
            attempts: 3,
            patches_applied: 0,
            token_usage: { total_tokens: 800 },
          },
        },
      },
    };

    render(<TaskInsightPanel spotlight={failedSpotlight} />);

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Fail")).toBeInTheDocument();
  });

  it("shows markdown summary", () => {
    render(<TaskInsightPanel spotlight={mockSpotlight} />);

    expect(screen.getByText("Run Summary")).toBeInTheDocument();
    expect(screen.getByText("Successfully created Button component with tests")).toBeInTheDocument();
  });

  it("displays collapsible patch preview", () => {
    render(<TaskInsightPanel spotlight={mockSpotlight} />);

    expect(screen.getByText("Latest Patch Preview")).toBeInTheDocument();
    expect(screen.getByText(/1 output/)).toBeInTheDocument();
  });

  it("expands patch preview on click", () => {
    render(<TaskInsightPanel spotlight={mockSpotlight} />);

    const expandButton = screen.getByText("Latest Patch Preview").closest("button");
    expect(expandButton).toBeInTheDocument();

    if (expandButton) {
      fireEvent.click(expandButton);
      // After expanding, should show diff content
      expect(screen.getByText(/import React from 'react'/)).toBeInTheDocument();
    }
  });

  it("displays lifecycle events", () => {
    render(<TaskInsightPanel spotlight={mockSpotlight} />);

    expect(screen.getByText("Recent Events")).toBeInTheDocument();
    expect(screen.getByText("Task started")).toBeInTheDocument();
    expect(screen.getByText("Memory usage high")).toBeInTheDocument();
  });

  it("shows event severities", () => {
    render(<TaskInsightPanel spotlight={mockSpotlight} />);

    expect(screen.getByText("INFO")).toBeInTheDocument();
    expect(screen.getByText("WARNING")).toBeInTheDocument();
  });

  it("formats timestamps in events", () => {
    render(<TaskInsightPanel spotlight={mockSpotlight} />);

    // Should display time in HH:mm:ss format
    const timeElements = screen.getAllByText(/\d{2}:\d{2}:\d{2}/);
    expect(timeElements.length).toBeGreaterThan(0);
  });

  it("handles spotlight without artifact", () => {
    const spotlightWithoutArtifact: TaskSpotlight = {
      ...mockSpotlight,
      latest_artifact: null,
    };

    render(<TaskInsightPanel spotlight={spotlightWithoutArtifact} />);

    // Should still render basic info
    expect(screen.getByText("task-123")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument(); // Worker shows em dash
  });

  it("shows LLM output count", () => {
    render(<TaskInsightPanel spotlight={mockSpotlight} />);

    expect(screen.getByText("LLM Out")).toBeInTheDocument();
    const llmOutCell = screen.getByText("LLM Out").closest("div");
    expect(llmOutCell?.textContent).toContain("1");
  });

  it("handles multiple LLM outputs", () => {
    const multiOutputSpotlight: TaskSpotlight = {
      ...mockSpotlight,
      latest_artifact: {
        ...mockSpotlight.latest_artifact!,
        payload: {
          ...mockSpotlight.latest_artifact!.payload,
          llm_outputs: ["output1", "output2", "output3"],
        },
        llm_output_count: 3,
      },
    };

    render(<TaskInsightPanel spotlight={multiOutputSpotlight} />);

    expect(screen.getByText(/3 outputs/)).toBeInTheDocument();
  });
});

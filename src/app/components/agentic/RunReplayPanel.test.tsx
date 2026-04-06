import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RunReplayPanel } from "./RunReplayPanel";
import * as apiClient from "../../lib/apiClient";
import type { DomainEvent } from "../../../shared/contracts";

vi.mock("../../lib/apiClient");

const mockGetRunReplayV2 = vi.mocked(apiClient.getRunReplayV2);

function createMockEvent(overrides?: Partial<DomainEvent>): DomainEvent {
  return {
    event_id: "evt-1",
    aggregate_id: "run-1",
    causation_id: "cause-1",
    correlation_id: "corr-1",
    actor: "system",
    timestamp: new Date().toISOString(),
    type: "ToolUseStarted",
    payload_json: JSON.stringify({ name: "test_tool", input: { arg: "value" } }),
    schema_version: 1,
    ...overrides,
  };
}

describe("RunReplayPanel", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it("renders loading state initially", () => {
    mockGetRunReplayV2.mockReturnValue(new Promise(() => {}));

    render(<RunReplayPanel runId="run-1" />, { wrapper });

    expect(screen.getByText("Loading replay...")).toBeInTheDocument();
  });

  it("renders error state when API fails", async () => {
    mockGetRunReplayV2.mockRejectedValue(new Error("API error"));

    render(<RunReplayPanel runId="run-1" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Failed to load replay")).toBeInTheDocument();
      expect(screen.getByText("API error")).toBeInTheDocument();
    });
  });

  it("renders empty state when no events", async () => {
    mockGetRunReplayV2.mockResolvedValue({ items: [] });

    render(<RunReplayPanel runId="run-1" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("No events recorded for this run")).toBeInTheDocument();
    });
  });

  it("renders timeline with events", async () => {
    const events: DomainEvent[] = [
      createMockEvent({ event_id: "evt-1", type: "ToolUseStarted", timestamp: "2024-01-01T10:00:00Z" }),
      createMockEvent({ event_id: "evt-2", type: "ToolUseCompleted", timestamp: "2024-01-01T10:00:05Z" }),
      createMockEvent({ event_id: "evt-3", type: "MessageSent", timestamp: "2024-01-01T10:00:10Z" }),
    ];

    mockGetRunReplayV2.mockResolvedValue({ items: events });

    render(<RunReplayPanel runId="run-1" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
      expect(screen.getAllByText("Tool Use Started").length).toBeGreaterThan(0);
    });
  });

  it("navigates to next step", async () => {
    const events: DomainEvent[] = [
      createMockEvent({ event_id: "evt-1", type: "ToolUseStarted" }),
      createMockEvent({ event_id: "evt-2", type: "ToolUseCompleted" }),
    ];

    mockGetRunReplayV2.mockResolvedValue({ items: events });

    render(<RunReplayPanel runId="run-1" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    });

    const nextButton = screen.getByTitle("Next step");
    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();
    });
  });

  it("navigates to previous step", async () => {
    const events: DomainEvent[] = [
      createMockEvent({ event_id: "evt-1", type: "ToolUseStarted" }),
      createMockEvent({ event_id: "evt-2", type: "ToolUseCompleted" }),
    ];

    mockGetRunReplayV2.mockResolvedValue({ items: events });

    render(<RunReplayPanel runId="run-1" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    });

    // Go to step 2
    const nextButton = screen.getByTitle("Next step");
    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();
    });

    // Go back to step 1
    const prevButton = screen.getByTitle("Previous step");
    fireEvent.click(prevButton);

    await waitFor(() => {
      expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    });
  });

  it("jumps to start", async () => {
    const events: DomainEvent[] = [
      createMockEvent({ event_id: "evt-1", type: "ToolUseStarted" }),
      createMockEvent({ event_id: "evt-2", type: "MessageSent" }),
      createMockEvent({ event_id: "evt-3", type: "ToolUseCompleted" }),
    ];

    mockGetRunReplayV2.mockResolvedValue({ items: events });

    render(<RunReplayPanel runId="run-1" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    });

    // Go to end
    const jumpEndButton = screen.getByTitle("Jump to end");
    fireEvent.click(jumpEndButton);

    await waitFor(() => {
      expect(screen.getByText("Step 3 of 3")).toBeInTheDocument();
    });

    // Jump back to start
    const jumpStartButton = screen.getByTitle("Jump to start");
    fireEvent.click(jumpStartButton);

    await waitFor(() => {
      expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    });
  });

  it("displays event metadata", async () => {
    const event = createMockEvent({
      event_id: "evt-123",
      aggregate_id: "run-456",
      actor: "test-user",
      type: "ToolUseStarted",
    });

    mockGetRunReplayV2.mockResolvedValue({ items: [event] });

    render(<RunReplayPanel runId="run-1" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("evt-123")).toBeInTheDocument();
      expect(screen.getByText("run-456")).toBeInTheDocument();
      expect(screen.getByText("test-user")).toBeInTheDocument();
    });
  });

  it("displays tool use payload", async () => {
    const event = createMockEvent({
      type: "ToolUseStarted",
      payload_json: JSON.stringify({
        name: "read_file",
        input: { path: "/test/file.txt" },
        duration_ms: 123,
      }),
    });

    mockGetRunReplayV2.mockResolvedValue({ items: [event] });

    render(<RunReplayPanel runId="run-1" />, { wrapper });

    await waitFor(() => {
      // Check that event payload section is visible
      expect(screen.getByText("Event Payload")).toBeInTheDocument();
      // Check the payload is rendered (either special view or JSON)
      const payloadTexts = screen.getAllByText(/read_file/);
      expect(payloadTexts.length).toBeGreaterThan(0);
    });
  });

  it("handles click on timeline node", async () => {
    const events: DomainEvent[] = [
      createMockEvent({ event_id: "evt-1", type: "ToolUseStarted" }),
      createMockEvent({ event_id: "evt-2", type: "MessageSent" }),
      createMockEvent({ event_id: "evt-3", type: "ToolUseCompleted" }),
    ];

    mockGetRunReplayV2.mockResolvedValue({ items: events });

    render(<RunReplayPanel runId="run-1" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    });

    // Click on third event in timeline
    const thirdNode = screen.getAllByRole("button").find(btn =>
      btn.textContent?.includes("Tool Use Completed")
    );

    if (thirdNode) {
      fireEvent.click(thirdNode);

      await waitFor(() => {
        expect(screen.getByText("Step 3 of 3")).toBeInTheDocument();
      });
    }
  });

  it("disables navigation buttons at boundaries", async () => {
    const events: DomainEvent[] = [
      createMockEvent({ event_id: "evt-1" }),
      createMockEvent({ event_id: "evt-2" }),
    ];

    mockGetRunReplayV2.mockResolvedValue({ items: events });

    render(<RunReplayPanel runId="run-1" />, { wrapper });

    await waitFor(() => {
      const prevButton = screen.getByTitle("Previous step");
      const jumpStartButton = screen.getByTitle("Jump to start");

      expect(prevButton).toBeDisabled();
      expect(jumpStartButton).toBeDisabled();
    });

    // Navigate to end
    const jumpEndButton = screen.getByTitle("Jump to end");
    fireEvent.click(jumpEndButton);

    await waitFor(() => {
      const nextButton = screen.getByTitle("Next step");
      const jumpEndButtonAgain = screen.getByTitle("Jump to end");

      expect(nextButton).toBeDisabled();
      expect(jumpEndButtonAgain).toBeDisabled();
    });
  });
});

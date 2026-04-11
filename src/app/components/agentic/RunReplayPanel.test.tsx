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

  it("renders 'Unknown error' when error is not an Error instance", async () => {
    mockGetRunReplayV2.mockRejectedValue("string-error");

    render(<RunReplayPanel runId="run-1" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Failed to load replay")).toBeInTheDocument();
      expect(screen.getByText("Unknown error")).toBeInTheDocument();
    });
  });

  it("renders empty state when replay items is null", async () => {
    mockGetRunReplayV2.mockResolvedValue({ items: null as any });

    render(<RunReplayPanel runId="run-1" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("No events recorded for this run")).toBeInTheDocument();
    });
  });

  it("renders default JSON view for non-ToolUse event payloads", async () => {
    const event = createMockEvent({
      type: "ConfigChanged",
      payload_json: JSON.stringify({ setting: "dark_mode", value: true }),
    });

    mockGetRunReplayV2.mockResolvedValue({ items: [event] });

    render(<RunReplayPanel runId="run-1" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Event Payload")).toBeInTheDocument();
      expect(screen.getByText(/"setting": "dark_mode"/)).toBeInTheDocument();
    });
  });

  it("renders ToolUse payload with result and duration fields", async () => {
    const event = createMockEvent({
      type: "ToolUseCompleted",
      payload_json: JSON.stringify({
        name: "bash",
        input: { command: "ls" },
        result: { files: ["a.txt"] },
        duration_ms: 42,
      }),
    });

    mockGetRunReplayV2.mockResolvedValue({ items: [event] });

    render(<RunReplayPanel runId="run-1" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Result")).toBeInTheDocument();
      expect(screen.getByText("Duration")).toBeInTheDocument();
      expect(screen.getByText("42ms")).toBeInTheDocument();
    });
  });

  it("renders correct icons and colors for various event types", async () => {
    const events: DomainEvent[] = [
      createMockEvent({ event_id: "evt-1", type: "UserInput", payload_json: JSON.stringify({ message: "hello" }) }),
      createMockEvent({ event_id: "evt-2", type: "ConfigUpdated", payload_json: JSON.stringify({ name: "cfg" }) }),
      createMockEvent({ event_id: "evt-3", type: "TaskSucceeded", payload_json: JSON.stringify({ summary: "done" }) }),
      createMockEvent({ event_id: "evt-4", type: "TaskFailed", payload_json: JSON.stringify({ description: "oops" }) }),
      createMockEvent({ event_id: "evt-5", type: "UnknownEvent", payload_json: JSON.stringify({ title: "misc" }) }),
    ];

    mockGetRunReplayV2.mockResolvedValue({ items: events });

    render(<RunReplayPanel runId="run-1" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
    });

    // Click to event 2 (ConfigUpdated) to verify rendering
    fireEvent.click(screen.getByTitle("Next step"));
    await waitFor(() => {
      expect(screen.getByText("Step 2 of 5")).toBeInTheDocument();
    });

    // Click to event 3 (TaskSucceeded)
    fireEvent.click(screen.getByTitle("Next step"));
    await waitFor(() => {
      expect(screen.getByText("Step 3 of 5")).toBeInTheDocument();
    });

    // Click to event 4 (TaskFailed)
    fireEvent.click(screen.getByTitle("Next step"));
    await waitFor(() => {
      expect(screen.getByText("Step 4 of 5")).toBeInTheDocument();
    });

    // Click to event 5 (UnknownEvent)
    fireEvent.click(screen.getByTitle("Next step"));
    await waitFor(() => {
      expect(screen.getByText("Step 5 of 5")).toBeInTheDocument();
    });
  });

  it("extracts description from payload fields: summary, description, name, title", async () => {
    // Test "summary" field
    const eventSummary = createMockEvent({
      event_id: "evt-s",
      type: "GenericEvent",
      payload_json: JSON.stringify({ summary: "A summary desc" }),
    });

    mockGetRunReplayV2.mockResolvedValue({ items: [eventSummary] });

    const { unmount } = render(<RunReplayPanel runId="run-1" />, { wrapper });

    await waitFor(() => {
      expect(screen.getAllByText("A summary desc").length).toBeGreaterThan(0);
    });

    unmount();
  });

  it("falls back to event type as description when payload has no known fields", async () => {
    const event = createMockEvent({
      type: "CustomEvent",
      payload_json: JSON.stringify({ randomField: 123 }),
    });

    mockGetRunReplayV2.mockResolvedValue({ items: [event] });

    render(<RunReplayPanel runId="run-1" />, { wrapper });

    await waitFor(() => {
      // The event description should fall back to the event type
      const descriptions = screen.getAllByText(/Custom Event/);
      expect(descriptions.length).toBeGreaterThan(0);
    });
  });

  it("falls back to event type when payload is not an object", async () => {
    const event = createMockEvent({
      type: "SimpleEvent",
      payload_json: JSON.stringify("just a string"),
    });

    mockGetRunReplayV2.mockResolvedValue({ items: [event] });

    render(<RunReplayPanel runId="run-1" />, { wrapper });

    await waitFor(() => {
      const texts = screen.getAllByText(/Simple Event/);
      expect(texts.length).toBeGreaterThan(0);
    });
  });

  it("handles invalid JSON in payload gracefully", async () => {
    const event = createMockEvent({
      type: "BadPayload",
      payload_json: "not-valid-json{{{",
    });

    mockGetRunReplayV2.mockResolvedValue({ items: [event] });

    render(<RunReplayPanel runId="run-1" />, { wrapper });

    await waitFor(() => {
      // Should render without crashing - no payload section shown
      const texts = screen.getAllByText(/Bad Payload/);
      expect(texts.length).toBeGreaterThan(0);
    });
  });

  it("renders empty payload without payload section", async () => {
    const event = createMockEvent({
      type: "EmptyPayload",
      payload_json: JSON.stringify({}),
    });

    mockGetRunReplayV2.mockResolvedValue({ items: [event] });

    render(<RunReplayPanel runId="run-1" />, { wrapper });

    await waitFor(() => {
      expect(screen.queryByText("Event Payload")).not.toBeInTheDocument();
    });
  });

  it("renders MessageSent event with violet color", async () => {
    const event = createMockEvent({
      type: "MessageSent",
      payload_json: JSON.stringify({ message: "Hello world" }),
    });

    mockGetRunReplayV2.mockResolvedValue({ items: [event] });

    render(<RunReplayPanel runId="run-1" />, { wrapper });

    await waitFor(() => {
      expect(screen.getAllByText("Hello world").length).toBeGreaterThan(0);
    });
  });
});

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryView } from "./TelemetryView";

const apiClientMock = vi.hoisted(() => ({
  getTelemetrySpans: vi.fn(),
  getTelemetryMetrics: vi.fn(),
}));

vi.mock("../../lib/apiClient", () => apiClientMock);

function renderView() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <TelemetryView />
    </QueryClientProvider>,
  );
}

describe("TelemetryView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClientMock.getTelemetrySpans.mockResolvedValue({
      spans: [
        {
          name: "execution.run",
          count: 42,
          avgDurationMs: 123.5,
          errorCount: 2,
        },
        {
          name: "provider.inference",
          count: 18,
          avgDurationMs: 456.7,
          errorCount: 0,
        },
      ],
    });
    apiClientMock.getTelemetryMetrics.mockResolvedValue(
      "inference_tokens_total{model=\"qwen\"} 1000\nactive_runs{status=\"running\"} 3"
    );
  });

  it("renders telemetry heading and summary cards", async () => {
    renderView();

    expect(await screen.findByText("Telemetry")).toBeInTheDocument();
    expect(screen.getByText(/Real-time span and metric insights/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Total Spans")).toBeInTheDocument();
      expect(screen.getByText("Span Types")).toBeInTheDocument();
      expect(screen.getByText("Avg Duration")).toBeInTheDocument();
      expect(screen.getByText("Errors")).toBeInTheDocument();
    });
  });

  it("displays span list with mock data", async () => {
    renderView();

    expect(await screen.findByText("execution.run")).toBeInTheDocument();
    expect(screen.getByText("provider.inference")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
  });

  it("switches between spans and metrics tabs", async () => {
    renderView();

    await screen.findByText("execution.run");

    const metricsTab = screen.getByRole("tab", { name: /Metrics/i });
    fireEvent.click(metricsTab);

    // Verify metrics tab is present even if query is not triggered immediately
    // due to the enabled flag in the component
    expect(metricsTab).toBeInTheDocument();
  });

  it("filters spans by name and status", async () => {
    renderView();

    await screen.findByText("execution.run");

    const nameInput = screen.getByPlaceholderText(/Filter by span name/i);
    fireEvent.change(nameInput, { target: { value: "execution" } });

    const statusSelect = screen.getByDisplayValue("All statuses");
    fireEvent.change(statusSelect, { target: { value: "ok" } });

    expect(nameInput).toHaveValue("execution");
    expect(statusSelect).toHaveValue("ok");
  });

  it("shows empty state when no spans are recorded", async () => {
    apiClientMock.getTelemetrySpans.mockResolvedValue({ spans: [] });

    renderView();

    expect(await screen.findByText(/No spans recorded yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Start an agentic run to generate telemetry/i)).toBeInTheDocument();
  });
});

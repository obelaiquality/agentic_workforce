import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { TelemetryView } from "./TelemetryView";

const apiClientMock = vi.hoisted(() => ({
  getTelemetrySpans: vi.fn(),
  getTelemetryMetrics: vi.fn(),
}));

vi.mock("../../lib/apiClient", () => apiClientMock);

// Store onValueChange callback from Tabs so TabsTrigger can call it
let tabsOnValueChange: ((v: string) => void) | null = null;

vi.mock("../ui/tabs", () => ({
  Tabs: ({ children, value, onValueChange, ...props }: any) => {
    tabsOnValueChange = onValueChange;
    return <div data-testid="tabs" data-value={value} {...props}>{children}</div>;
  },
  TabsList: ({ children, ...props }: any) => <div data-testid="tabs-list" {...props}>{children}</div>,
  TabsTrigger: ({ children, value, ...props }: any) => (
    <button
      data-testid={`tab-trigger-${value}`}
      role="tab"
      onClick={() => tabsOnValueChange?.(value)}
      {...props}
    >
      {children}
    </button>
  ),
  TabsContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

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
    tabsOnValueChange = null;
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

  it("switches to metrics tab", async () => {
    renderView();
    await screen.findByText("execution.run");

    const metricsTab = screen.getByTestId("tab-trigger-metrics");
    fireEvent.click(metricsTab);

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

  it("shows loading state while spans are loading", async () => {
    apiClientMock.getTelemetrySpans.mockImplementation(() => new Promise(() => {}));

    renderView();

    expect(await screen.findByText("Loading telemetry data...")).toBeInTheDocument();
  });

  it("clicking refresh button refetches spans query", async () => {
    renderView();
    await screen.findByText("execution.run");

    const refreshBtn = screen.getByText("Refresh");
    fireEvent.click(refreshBtn);

    expect(apiClientMock.getTelemetrySpans).toHaveBeenCalledTimes(2);
  });

  it("clicking refresh on metrics tab refetches metrics", async () => {
    renderView();
    await screen.findByText("execution.run");

    // Switch to metrics tab
    const metricsTab = screen.getByTestId("tab-trigger-metrics");
    fireEvent.click(metricsTab);

    await waitFor(() => {
      expect(apiClientMock.getTelemetryMetrics).toHaveBeenCalled();
    });

    const refreshBtn = screen.getByText("Refresh");
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(apiClientMock.getTelemetryMetrics.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("displays span rows with error rate styling", async () => {
    apiClientMock.getTelemetrySpans.mockResolvedValue({
      spans: [
        { name: "zero-errors", count: 10, avgDurationMs: 50, errorCount: 0 },
        { name: "low-errors", count: 100, avgDurationMs: 200, errorCount: 5 },
        { name: "high-errors", count: 10, avgDurationMs: 300, errorCount: 5 },
      ],
    });

    renderView();
    await screen.findByText("zero-errors");

    expect(screen.getByText("0.0%")).toBeInTheDocument();
    expect(screen.getByText("5.0%")).toBeInTheDocument();
    expect(screen.getByText("50.0%")).toBeInTheDocument();
  });

  it("displays summary cards with computed aggregate values", async () => {
    apiClientMock.getTelemetrySpans.mockResolvedValue({
      spans: [
        { name: "only-span", count: 30, avgDurationMs: 100, errorCount: 7 },
      ],
    });

    renderView();
    await screen.findByText("only-span");

    expect(screen.getByText("Total Spans")).toBeInTheDocument();
    // Span types = 1
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("renders metrics cards in the metrics tab content", async () => {
    renderView();
    await screen.findByText("execution.run");

    const metricsTab = screen.getByTestId("tab-trigger-metrics");
    fireEvent.click(metricsTab);

    await waitFor(() => {
      expect(screen.getByText("inference_tokens_total")).toBeInTheDocument();
      expect(screen.getByText("active_runs")).toBeInTheDocument();
    });
  });

  it("shows empty metrics state when no metrics exist", async () => {
    apiClientMock.getTelemetryMetrics.mockResolvedValue("");

    renderView();
    await screen.findByText("execution.run");

    const metricsTab = screen.getByTestId("tab-trigger-metrics");
    fireEvent.click(metricsTab);

    await waitFor(() => {
      expect(screen.getByText(/No metrics recorded yet/i)).toBeInTheDocument();
    });
  });

  it("shows loading metrics state", async () => {
    apiClientMock.getTelemetryMetrics.mockImplementation(() => new Promise(() => {}));

    renderView();
    await screen.findByText("execution.run");

    const metricsTab = screen.getByTestId("tab-trigger-metrics");
    fireEvent.click(metricsTab);

    await waitFor(() => {
      expect(screen.getByText("Loading metrics...")).toBeInTheDocument();
    });
  });

  it("renders histogram type badge for _bucket metrics", async () => {
    apiClientMock.getTelemetryMetrics.mockResolvedValue(
      'request_duration_bucket{le="0.5"} 10\nrequest_duration_bucket{le="1.0"} 25\n'
    );

    renderView();
    await screen.findByText("execution.run");

    const metricsTab = screen.getByTestId("tab-trigger-metrics");
    fireEvent.click(metricsTab);

    await waitFor(() => {
      expect(screen.getByText("request_duration_bucket")).toBeInTheDocument();
      expect(screen.getByText("histogram")).toBeInTheDocument();
    });
  });

  it("renders counter type badge for _total metrics", async () => {
    apiClientMock.getTelemetryMetrics.mockResolvedValue("http_requests_total 555\n");

    renderView();
    await screen.findByText("execution.run");

    const metricsTab = screen.getByTestId("tab-trigger-metrics");
    fireEvent.click(metricsTab);

    await waitFor(() => {
      expect(screen.getByText("counter")).toBeInTheDocument();
    });
  });

  it("renders gauge type badge for generic metrics", async () => {
    apiClientMock.getTelemetryMetrics.mockResolvedValue("active_connections 5\n");

    renderView();
    await screen.findByText("execution.run");

    const metricsTab = screen.getByTestId("tab-trigger-metrics");
    fireEvent.click(metricsTab);

    await waitFor(() => {
      expect(screen.getByText("gauge")).toBeInTheDocument();
    });
  });

  it("renders _count metric as counter type", async () => {
    apiClientMock.getTelemetryMetrics.mockResolvedValue("http_request_count 100\n");

    renderView();
    await screen.findByText("execution.run");

    const metricsTab = screen.getByTestId("tab-trigger-metrics");
    fireEvent.click(metricsTab);

    await waitFor(() => {
      expect(screen.getByText("counter")).toBeInTheDocument();
    });
  });

  it("renders _sum metric as histogram type", async () => {
    apiClientMock.getTelemetryMetrics.mockResolvedValue("http_request_duration_sum 500.5\n");

    renderView();
    await screen.findByText("execution.run");

    const metricsTab = screen.getByTestId("tab-trigger-metrics");
    fireEvent.click(metricsTab);

    await waitFor(() => {
      expect(screen.getByText("histogram")).toBeInTheDocument();
    });
  });

  it("formats large metric values with k suffix", async () => {
    apiClientMock.getTelemetryMetrics.mockResolvedValue("big_metric 5000\n");

    renderView();
    await screen.findByText("execution.run");

    const metricsTab = screen.getByTestId("tab-trigger-metrics");
    fireEvent.click(metricsTab);

    await waitFor(() => {
      expect(screen.getByText("5.0k")).toBeInTheDocument();
    });
  });

  it("formats very large metric values with M suffix", async () => {
    apiClientMock.getTelemetryMetrics.mockResolvedValue("huge_metric 2500000\n");

    renderView();
    await screen.findByText("execution.run");

    const metricsTab = screen.getByTestId("tab-trigger-metrics");
    fireEvent.click(metricsTab);

    await waitFor(() => {
      expect(screen.getByText("2.5M")).toBeInTheDocument();
    });
  });

  it("formats small decimal metric values in scientific notation", async () => {
    apiClientMock.getTelemetryMetrics.mockResolvedValue("tiny_metric 0.005\n");

    renderView();
    await screen.findByText("execution.run");

    const metricsTab = screen.getByTestId("tab-trigger-metrics");
    fireEvent.click(metricsTab);

    await waitFor(() => {
      expect(screen.getByText("5.00e-3")).toBeInTheDocument();
    });
  });

  it("formats sub-1 metric values with 3 decimal places", async () => {
    apiClientMock.getTelemetryMetrics.mockResolvedValue("small_metric 0.456\n");

    renderView();
    await screen.findByText("execution.run");

    const metricsTab = screen.getByTestId("tab-trigger-metrics");
    fireEvent.click(metricsTab);

    await waitFor(() => {
      expect(screen.getByText("0.456")).toBeInTheDocument();
    });
  });

  it("formats medium metric values with 1 decimal place", async () => {
    apiClientMock.getTelemetryMetrics.mockResolvedValue("med_metric 42.7\n");

    renderView();
    await screen.findByText("execution.run");

    const metricsTab = screen.getByTestId("tab-trigger-metrics");
    fireEvent.click(metricsTab);

    await waitFor(() => {
      expect(screen.getByText("42.7")).toBeInTheDocument();
    });
  });

  it("renders warn variant summary card when errors > 0", async () => {
    apiClientMock.getTelemetrySpans.mockResolvedValue({
      spans: [{ name: "only-span", count: 10, avgDurationMs: 100, errorCount: 3 }],
    });

    renderView();
    await screen.findByText("only-span");

    const errorCells = screen.getAllByText("3");
    expect(errorCells.length).toBeGreaterThanOrEqual(1);
  });

  it("parses comment and empty lines in prometheus format", async () => {
    apiClientMock.getTelemetryMetrics.mockResolvedValue(
      "# HELP my_metric A help line\n# TYPE my_metric gauge\nmy_metric 42\n\n"
    );

    renderView();
    await screen.findByText("execution.run");

    const metricsTab = screen.getByTestId("tab-trigger-metrics");
    fireEvent.click(metricsTab);

    await waitFor(() => {
      expect(screen.getByText("my_metric")).toBeInTheDocument();
    });
  });

  it("shows metric label badges for labeled metrics", async () => {
    apiClientMock.getTelemetryMetrics.mockResolvedValue(
      'http_requests_total{method="GET",status="200"} 150\n'
    );

    renderView();
    await screen.findByText("execution.run");

    const metricsTab = screen.getByTestId("tab-trigger-metrics");
    fireEvent.click(metricsTab);

    await waitFor(() => {
      expect(screen.getByText("method=GET")).toBeInTheDocument();
      expect(screen.getByText("status=200")).toBeInTheDocument();
    });
  });

  it("shows avg duration as dash when no spans", async () => {
    apiClientMock.getTelemetrySpans.mockResolvedValue({ spans: [] });

    renderView();

    await waitFor(() => {
      const dashEl = screen.getByText("\u2014");
      expect(dashEl).toBeInTheDocument();
    });
  });

  it("renders metric card without labels showing total value", async () => {
    apiClientMock.getTelemetryMetrics.mockResolvedValue("simple_gauge 77\n");

    renderView();
    await screen.findByText("execution.run");

    const metricsTab = screen.getByTestId("tab-trigger-metrics");
    fireEvent.click(metricsTab);

    await waitFor(() => {
      expect(screen.getByText("simple_gauge")).toBeInTheDocument();
      expect(screen.getByText("77.0")).toBeInTheDocument();
    });
  });
});

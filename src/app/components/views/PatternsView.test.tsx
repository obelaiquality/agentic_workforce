import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PatternsView } from "./PatternsView";
import * as apiClient from "../../lib/apiClient";

vi.mock("../../lib/apiClient");

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("PatternsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render loading state initially", () => {
    vi.mocked(apiClient.getLatestInferenceBenchmarksV2).mockReturnValue(new Promise(() => {}));
    vi.mocked(apiClient.getChampionVsChallengerV3).mockReturnValue(new Promise(() => {}));
    vi.mocked(apiClient.getInferenceBenchmarkHistoryV2).mockReturnValue(new Promise(() => {}));

    renderWithQueryClient(<PatternsView />);
    expect(screen.getByText("Loading patterns...")).toBeInTheDocument();
  });

  it("should render empty state when no data is available", async () => {
    vi.mocked(apiClient.getLatestInferenceBenchmarksV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getChampionVsChallengerV3).mockResolvedValue({ champions: [], challengers: [] });
    vi.mocked(apiClient.getInferenceBenchmarkHistoryV2).mockResolvedValue({ items: [] });

    renderWithQueryClient(<PatternsView />);

    await waitFor(() => {
      expect(screen.getByText("No pattern data available")).toBeInTheDocument();
    });
  });

  it("should display benchmark cards with performance metrics", async () => {
    const mockBenchmark = {
      backendId: "mlx-lm",
      profile: "interactive",
      ttftMsP95: 150,
      outputTokPerSec: 45.2,
      latencyMsP95: 320,
      errorRate: 0.02,
      memoryHeadroomPct: 65,
      score: 87.5,
      selected: true,
      createdAt: new Date().toISOString(),
      metadata: {},
    };

    vi.mocked(apiClient.getLatestInferenceBenchmarksV2).mockResolvedValue({ items: [mockBenchmark] });
    vi.mocked(apiClient.getChampionVsChallengerV3).mockResolvedValue({ champions: [], challengers: [] });
    vi.mocked(apiClient.getInferenceBenchmarkHistoryV2).mockResolvedValue({ items: [] });

    renderWithQueryClient(<PatternsView />);

    await waitFor(() => {
      expect(screen.getByText("mlx-lm")).toBeInTheDocument();
      expect(screen.getByText("interactive")).toBeInTheDocument();
      expect(screen.getByText("320ms")).toBeInTheDocument();
      expect(screen.getByText("45.2 tok/s")).toBeInTheDocument();
      expect(screen.getByText("active")).toBeInTheDocument();
    });
  });

  it("should display champion models", async () => {
    const mockChampion = {
      pluginId: "qwen-2.5-7b",
      modelId: "qwen2.5-7b-instruct",
      active: true,
      promoted: true,
      paramsB: 7,
      updatedAt: "2024-03-15T10:00:00Z",
    };

    vi.mocked(apiClient.getLatestInferenceBenchmarksV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getChampionVsChallengerV3).mockResolvedValue({
      champions: [mockChampion],
      challengers: [],
    });
    vi.mocked(apiClient.getInferenceBenchmarkHistoryV2).mockResolvedValue({ items: [] });

    renderWithQueryClient(<PatternsView />);

    await waitFor(() => {
      expect(screen.getByText("Champions")).toBeInTheDocument();
      expect(screen.getByText("qwen2.5-7b-instruct")).toBeInTheDocument();
      expect(screen.getByText(/7B params/)).toBeInTheDocument();
    });
  });

  it("should display challenger models", async () => {
    const mockChallenger = {
      id: "challenge-123",
      modelPluginId: "qwen-2.5-14b",
      parentModelPluginId: "qwen-2.5-7b",
      datasetId: "dataset-456",
      evalRunId: "eval-789",
      status: "pending_review",
      metrics: { accuracy: 0.92, latency: 150 },
      createdAt: "2024-03-20T10:00:00Z",
      updatedAt: "2024-03-20T10:00:00Z",
    };

    vi.mocked(apiClient.getLatestInferenceBenchmarksV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getChampionVsChallengerV3).mockResolvedValue({
      champions: [],
      challengers: [mockChallenger],
    });
    vi.mocked(apiClient.getInferenceBenchmarkHistoryV2).mockResolvedValue({ items: [] });

    renderWithQueryClient(<PatternsView />);

    await waitFor(() => {
      expect(screen.getByText("Challengers")).toBeInTheDocument();
      expect(screen.getByText("qwen-2.5-14b")).toBeInTheDocument();
      expect(screen.getByText("pending review")).toBeInTheDocument();
    });
  });

  it("should display benchmark history", async () => {
    const mockHistory = {
      backendId: "sglang",
      profile: "batch",
      ttftMsP95: 200,
      outputTokPerSec: 38.5,
      latencyMsP95: 420,
      errorRate: 0.01,
      memoryHeadroomPct: 50,
      score: 82.3,
      selected: false,
      createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
      metadata: {},
    };

    vi.mocked(apiClient.getLatestInferenceBenchmarksV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getChampionVsChallengerV3).mockResolvedValue({ champions: [], challengers: [] });
    vi.mocked(apiClient.getInferenceBenchmarkHistoryV2).mockResolvedValue({ items: [mockHistory] });

    renderWithQueryClient(<PatternsView />);

    await waitFor(() => {
      expect(screen.getByText("Benchmark History")).toBeInTheDocument();
      expect(screen.getByText("sglang")).toBeInTheDocument();
      expect(screen.getByText("batch")).toBeInTheDocument();
      expect(screen.getByText("recent")).toBeInTheDocument();
    });
  });

  it("should show error rate warning when errors are present", async () => {
    const mockBenchmark = {
      backendId: "vllm-openai",
      profile: "tool_heavy",
      ttftMsP95: 180,
      outputTokPerSec: 42.0,
      latencyMsP95: 380,
      errorRate: 0.15,
      memoryHeadroomPct: 70,
      score: 75.0,
      selected: false,
      createdAt: new Date().toISOString(),
      metadata: {},
    };

    vi.mocked(apiClient.getLatestInferenceBenchmarksV2).mockResolvedValue({ items: [mockBenchmark] });
    vi.mocked(apiClient.getChampionVsChallengerV3).mockResolvedValue({ champions: [], challengers: [] });
    vi.mocked(apiClient.getInferenceBenchmarkHistoryV2).mockResolvedValue({ items: [] });

    renderWithQueryClient(<PatternsView />);

    await waitFor(() => {
      expect(screen.getByText("15.0%")).toBeInTheDocument();
    });
  });

  it("should show low memory headroom warning", async () => {
    const mockBenchmark = {
      backendId: "llama-cpp-openai",
      profile: "interactive",
      ttftMsP95: 160,
      outputTokPerSec: 40.0,
      latencyMsP95: 350,
      errorRate: 0.0,
      memoryHeadroomPct: 15,
      score: 78.0,
      selected: false,
      createdAt: new Date().toISOString(),
      metadata: {},
    };

    vi.mocked(apiClient.getLatestInferenceBenchmarksV2).mockResolvedValue({ items: [mockBenchmark] });
    vi.mocked(apiClient.getChampionVsChallengerV3).mockResolvedValue({ champions: [], challengers: [] });
    vi.mocked(apiClient.getInferenceBenchmarkHistoryV2).mockResolvedValue({ items: [] });

    renderWithQueryClient(<PatternsView />);

    await waitFor(() => {
      expect(screen.getByText(/Low memory headroom/)).toBeInTheDocument();
    });
  });
});

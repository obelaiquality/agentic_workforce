import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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

  it("should toggle register form visibility", async () => {
    const mockChampion = {
      pluginId: "qwen-2.5-7b",
      modelId: "qwen2.5-7b-instruct",
      active: true,
      promoted: false,
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
      expect(screen.getByText("Register Challenge")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Register Challenge"));
    expect(screen.getByText("Register New Challenger")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g., qwen-2.5-coder-7b-instruct")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Dataset ID")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Benchmark Run ID (optional)")).toBeInTheDocument();

    // Toggle off
    fireEvent.click(screen.getByText("Register Challenge"));
    expect(screen.queryByText("Register New Challenger")).not.toBeInTheDocument();
  });

  it("should submit register challenge form", async () => {
    const mockChampion = {
      pluginId: "qwen-2.5-7b",
      modelId: "qwen2.5-7b-instruct",
      active: true,
      promoted: false,
      paramsB: 7,
      updatedAt: "2024-03-15T10:00:00Z",
    };

    vi.mocked(apiClient.getLatestInferenceBenchmarksV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getChampionVsChallengerV3).mockResolvedValue({
      champions: [mockChampion],
      challengers: [],
    });
    vi.mocked(apiClient.getInferenceBenchmarkHistoryV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.registerChallengeV3).mockResolvedValue({ item: {} as any });

    renderWithQueryClient(<PatternsView />);

    await waitFor(() => {
      expect(screen.getByText("Register Challenge")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Register Challenge"));

    fireEvent.change(screen.getByPlaceholderText("e.g., qwen-2.5-coder-7b-instruct"), {
      target: { value: "test-model" },
    });
    fireEvent.change(screen.getByPlaceholderText("Dataset ID"), {
      target: { value: "test-dataset" },
    });
    fireEvent.change(screen.getByPlaceholderText("Benchmark Run ID (optional)"), {
      target: { value: "test-eval" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    await waitFor(() => {
      expect(apiClient.registerChallengeV3).toHaveBeenCalledWith({
        actor: "user",
        model_plugin_id: "test-model",
        dataset_id: "test-dataset",
        eval_run_id: "test-eval",
      });
    });
  });

  it("should not submit register when fields are empty", async () => {
    const mockChampion = {
      pluginId: "qwen-2.5-7b",
      modelId: "qwen2.5-7b-instruct",
      active: true,
      promoted: false,
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
      expect(screen.getByText("Register Challenge")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Register Challenge"));

    // The register button should be disabled when fields are empty
    const registerBtn = screen.getByRole("button", { name: "Register" });
    expect(registerBtn).toBeDisabled();
  });

  it("should cancel the register form", async () => {
    const mockChampion = {
      pluginId: "qwen-2.5-7b",
      modelId: "qwen2.5-7b-instruct",
      active: true,
      promoted: false,
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
      expect(screen.getByText("Register Challenge")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Register Challenge"));
    expect(screen.getByText("Register New Challenger")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Register New Challenger")).not.toBeInTheDocument();
  });

  it("should show register mutation error", async () => {
    const mockChampion = {
      pluginId: "qwen-2.5-7b",
      modelId: "qwen2.5-7b-instruct",
      active: true,
      promoted: false,
      paramsB: 7,
      updatedAt: "2024-03-15T10:00:00Z",
    };

    vi.mocked(apiClient.getLatestInferenceBenchmarksV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getChampionVsChallengerV3).mockResolvedValue({
      champions: [mockChampion],
      challengers: [],
    });
    vi.mocked(apiClient.getInferenceBenchmarkHistoryV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.registerChallengeV3).mockRejectedValue(new Error("Server error"));

    renderWithQueryClient(<PatternsView />);

    await waitFor(() => {
      expect(screen.getByText("Register Challenge")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Register Challenge"));

    fireEvent.change(screen.getByPlaceholderText("e.g., qwen-2.5-coder-7b-instruct"), {
      target: { value: "model-1" },
    });
    fireEvent.change(screen.getByPlaceholderText("Dataset ID"), {
      target: { value: "dataset-1" },
    });
    fireEvent.change(screen.getByPlaceholderText("Benchmark Run ID (optional)"), {
      target: { value: "eval-1" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    await waitFor(() => {
      expect(screen.getByText(/Failed to register challenge/)).toBeInTheDocument();
      expect(screen.getByText(/Server error/)).toBeInTheDocument();
    });
  });

  it("should call review mutation for challenger approve/reject/promote", async () => {
    const mockChallenger = {
      id: "challenge-abc",
      modelPluginId: "qwen-2.5-14b",
      parentModelPluginId: "qwen-2.5-7b",
      datasetId: "dataset-456",
      evalRunId: "eval-789",
      status: "pending_review",
      metrics: {},
      createdAt: "2024-03-20T10:00:00Z",
      updatedAt: "2024-03-20T10:00:00Z",
    };

    vi.mocked(apiClient.getLatestInferenceBenchmarksV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getChampionVsChallengerV3).mockResolvedValue({
      champions: [],
      challengers: [mockChallenger],
    });
    vi.mocked(apiClient.getInferenceBenchmarkHistoryV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.reviewChallengeV3).mockResolvedValue({ item: {} as any });

    renderWithQueryClient(<PatternsView />);

    await waitFor(() => {
      expect(screen.getByText("Approve")).toBeInTheDocument();
      expect(screen.getByText("Reject")).toBeInTheDocument();
      expect(screen.getByText("Promote")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));

    await waitFor(() => {
      expect(apiClient.reviewChallengeV3).toHaveBeenCalledWith({
        actor: "user",
        candidate_id: "challenge-abc",
        status: "approved",
      });
    });
  });

  it("should call review mutation with reject", async () => {
    const mockChallenger = {
      id: "challenge-reject",
      modelPluginId: "qwen-reject",
      parentModelPluginId: null,
      datasetId: "ds-1",
      evalRunId: "ev-1",
      status: "pending_review",
      metrics: {},
      createdAt: "2024-03-20T10:00:00Z",
      updatedAt: "2024-03-20T10:00:00Z",
    };

    vi.mocked(apiClient.getLatestInferenceBenchmarksV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getChampionVsChallengerV3).mockResolvedValue({
      champions: [],
      challengers: [mockChallenger],
    });
    vi.mocked(apiClient.getInferenceBenchmarkHistoryV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.reviewChallengeV3).mockResolvedValue({ item: {} as any });

    renderWithQueryClient(<PatternsView />);

    await waitFor(() => {
      expect(screen.getByText("Reject")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Reject/ }));

    await waitFor(() => {
      expect(apiClient.reviewChallengeV3).toHaveBeenCalledWith({
        actor: "user",
        candidate_id: "challenge-reject",
        status: "rejected",
      });
    });
  });

  it("should call review mutation with promote", async () => {
    const mockChallenger = {
      id: "challenge-promote",
      modelPluginId: "qwen-promote",
      parentModelPluginId: null,
      datasetId: "ds-2",
      evalRunId: "ev-2",
      status: "pending_review",
      metrics: {},
      createdAt: "2024-03-20T10:00:00Z",
      updatedAt: "2024-03-20T10:00:00Z",
    };

    vi.mocked(apiClient.getLatestInferenceBenchmarksV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getChampionVsChallengerV3).mockResolvedValue({
      champions: [],
      challengers: [mockChallenger],
    });
    vi.mocked(apiClient.getInferenceBenchmarkHistoryV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.reviewChallengeV3).mockResolvedValue({ item: {} as any });

    renderWithQueryClient(<PatternsView />);

    await waitFor(() => {
      expect(screen.getByText("Promote")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Promote/ }));

    await waitFor(() => {
      expect(apiClient.reviewChallengeV3).toHaveBeenCalledWith({
        actor: "user",
        candidate_id: "challenge-promote",
        status: "promoted",
      });
    });
  });

  it("should display challenger with metrics", async () => {
    const mockChallenger = {
      id: "challenge-met",
      modelPluginId: "qwen-metrics",
      parentModelPluginId: null,
      datasetId: "ds-met",
      evalRunId: "ev-met",
      status: "approved",
      metrics: { accuracy: 0.95, latency: 120 },
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
      expect(screen.getByText("qwen-metrics")).toBeInTheDocument();
      expect(screen.getByText("approved")).toBeInTheDocument();
      expect(screen.getByText(/accuracy: 0.95/)).toBeInTheDocument();
      expect(screen.getByText(/latency: 120/)).toBeInTheDocument();
    });

    // Approved challenger should not show review buttons
    expect(screen.queryByText("Approve")).not.toBeInTheDocument();
  });

  it("should display champion without active or promoted badges", async () => {
    const mockChampion = {
      pluginId: "qwen-basic",
      modelId: "qwen-basic-model",
      active: false,
      promoted: false,
      paramsB: 4,
      updatedAt: "2024-01-01T10:00:00Z",
    };

    vi.mocked(apiClient.getLatestInferenceBenchmarksV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getChampionVsChallengerV3).mockResolvedValue({
      champions: [mockChampion],
      challengers: [],
    });
    vi.mocked(apiClient.getInferenceBenchmarkHistoryV2).mockResolvedValue({ items: [] });

    renderWithQueryClient(<PatternsView />);

    await waitFor(() => {
      expect(screen.getByText("qwen-basic-model")).toBeInTheDocument();
      expect(screen.getByText(/4B params/)).toBeInTheDocument();
    });

    // Should not show active or promoted badges
    expect(screen.queryByText("active")).not.toBeInTheDocument();
    expect(screen.queryByText("promoted")).not.toBeInTheDocument();
  });

  it("should display history entry with selected badge and non-recent timestamp", async () => {
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 2 days ago
    const mockHistory = {
      backendId: "old-backend",
      profile: "batch",
      ttftMsP95: 250,
      outputTokPerSec: 30.0,
      latencyMsP95: 500,
      errorRate: 0.0,
      memoryHeadroomPct: 60,
      score: 70.0,
      selected: true,
      createdAt: oldDate,
      metadata: {},
    };

    vi.mocked(apiClient.getLatestInferenceBenchmarksV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getChampionVsChallengerV3).mockResolvedValue({ champions: [], challengers: [] });
    vi.mocked(apiClient.getInferenceBenchmarkHistoryV2).mockResolvedValue({ items: [mockHistory] });

    renderWithQueryClient(<PatternsView />);

    await waitFor(() => {
      expect(screen.getByText("old-backend")).toBeInTheDocument();
      expect(screen.getByText("selected")).toBeInTheDocument();
    });

    // Not recent (> 24h ago), so "recent" badge should not appear
    expect(screen.queryByText("recent")).not.toBeInTheDocument();
  });

  it("should display benchmark card without error rate or memory warning", async () => {
    const mockBenchmark = {
      backendId: "clean-backend",
      profile: "standard",
      ttftMsP95: 100,
      outputTokPerSec: 50.0,
      latencyMsP95: 200,
      errorRate: 0,
      memoryHeadroomPct: 80,
      score: 95.0,
      selected: false,
      createdAt: new Date().toISOString(),
      metadata: {},
    };

    vi.mocked(apiClient.getLatestInferenceBenchmarksV2).mockResolvedValue({ items: [mockBenchmark] });
    vi.mocked(apiClient.getChampionVsChallengerV3).mockResolvedValue({ champions: [], challengers: [] });
    vi.mocked(apiClient.getInferenceBenchmarkHistoryV2).mockResolvedValue({ items: [] });

    renderWithQueryClient(<PatternsView />);

    await waitFor(() => {
      expect(screen.getByText("clean-backend")).toBeInTheDocument();
      expect(screen.getByText("standard")).toBeInTheDocument();
      expect(screen.getByText("95.0")).toBeInTheDocument();
    });

    // No error rate or low memory warning
    expect(screen.queryByText("Error Rate")).not.toBeInTheDocument();
    expect(screen.queryByText(/Low memory headroom/)).not.toBeInTheDocument();
    // Not selected, so no active badge
    expect(screen.queryByText("active")).not.toBeInTheDocument();
  });

  it("should display both champions and challengers simultaneously", async () => {
    const mockChampion = {
      pluginId: "champ-1",
      modelId: "champion-model",
      active: true,
      promoted: true,
      paramsB: 7,
      updatedAt: "2024-03-15T10:00:00Z",
    };
    const mockChallenger = {
      id: "chal-1",
      modelPluginId: "challenger-model",
      parentModelPluginId: "champ-1",
      datasetId: "ds",
      evalRunId: "ev",
      status: "draft",
      metrics: {},
      createdAt: "2024-03-20T10:00:00Z",
      updatedAt: "2024-03-20T10:00:00Z",
    };

    vi.mocked(apiClient.getLatestInferenceBenchmarksV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getChampionVsChallengerV3).mockResolvedValue({
      champions: [mockChampion],
      challengers: [mockChallenger],
    });
    vi.mocked(apiClient.getInferenceBenchmarkHistoryV2).mockResolvedValue({ items: [] });

    renderWithQueryClient(<PatternsView />);

    await waitFor(() => {
      expect(screen.getByText("Champions")).toBeInTheDocument();
      expect(screen.getByText("Challengers")).toBeInTheDocument();
      expect(screen.getByText("champion-model")).toBeInTheDocument();
      expect(screen.getByText("challenger-model")).toBeInTheDocument();
      expect(screen.getByText("draft")).toBeInTheDocument();
    });
  });
});

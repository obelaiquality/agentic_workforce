import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BenchmarkView } from "./BenchmarkView";
import * as apiClient from "../../lib/apiClient";

vi.mock("../../lib/apiClient");

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("BenchmarkView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders header and main sections", async () => {
    vi.mocked(apiClient.listBenchmarkProjectsV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkFailuresV4).mockResolvedValue({ items: [] });

    render(<BenchmarkView />, { wrapper: createWrapper() });

    expect(screen.getByText("Benchmarks")).toBeInTheDocument();
    expect(screen.getByText("Start New Run")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Leaderboard")).toBeInTheDocument();
      expect(screen.getByText("Active Runs")).toBeInTheDocument();
      expect(screen.getByText("Benchmark Projects")).toBeInTheDocument();
      expect(screen.getByText("Recent Failures")).toBeInTheDocument();
    });
  });

  it("displays benchmark projects", async () => {
    vi.mocked(apiClient.listBenchmarkProjectsV4).mockResolvedValue({
      items: [
        {
          id: "proj-1",
          repoId: "repo-1",
          projectKey: "test-project",
          displayName: "Test Project",
          sourceKind: "local_path",
          sourceUri: "/path/to/project",
          manifestPath: null,
          languages: ["typescript", "javascript"],
          setupCommand: "npm install",
          verifyCommand: "npm test",
          resetCommand: null,
          installCommand: null,
          guidelineSources: [],
          timeBudgetSec: 300,
          networkPolicy: "allowed",
          defaultProviderRole: "coder_default",
          createdAt: "2026-04-01T10:00:00Z",
          updatedAt: "2026-04-01T10:00:00Z",
        },
        {
          id: "proj-2",
          repoId: "repo-2",
          projectKey: "demo-project",
          displayName: "Demo Project",
          sourceKind: "git_url",
          sourceUri: "https://github.com/example/demo",
          manifestPath: null,
          languages: ["python"],
          setupCommand: "pip install",
          verifyCommand: "pytest",
          resetCommand: null,
          installCommand: null,
          guidelineSources: [],
          timeBudgetSec: 600,
          networkPolicy: "offline",
          defaultProviderRole: "review_deep",
          createdAt: "2026-04-01T11:00:00Z",
          updatedAt: "2026-04-01T11:00:00Z",
        },
      ],
    });
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkFailuresV4).mockResolvedValue({ items: [] });

    render(<BenchmarkView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Test Project")).toBeInTheDocument();
      expect(screen.getByText("Demo Project")).toBeInTheDocument();
      expect(screen.getByText("typescript, javascript")).toBeInTheDocument();
      expect(screen.getByText("python")).toBeInTheDocument();
    });
  });

  it("displays leaderboard entries", async () => {
    vi.mocked(apiClient.listBenchmarkProjectsV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockResolvedValue({
      items: [
        {
          runId: "run-abc123",
          pass: true,
          totalScore: 95.5,
          functionalCorrectness: 100,
          guidelineAdherence: 90,
          verificationDiscipline: 95,
          patchQuality: 92,
          retrievalDiscipline: 88,
          policyCompliance: 100,
          latencyRecovery: 98,
          hardFailures: [],
          evidenceRefs: [],
          summary: "Excellent performance on feature task",
          createdAt: "2026-04-02T08:00:00Z",
          updatedAt: "2026-04-02T08:00:00Z",
        },
        {
          runId: "run-def456",
          pass: false,
          totalScore: 62.3,
          functionalCorrectness: 70,
          guidelineAdherence: 60,
          verificationDiscipline: 55,
          patchQuality: 65,
          retrievalDiscipline: 70,
          policyCompliance: 50,
          latencyRecovery: 60,
          hardFailures: ["missing_test_coverage"],
          evidenceRefs: [],
          summary: "Failed on guideline adherence",
          createdAt: "2026-04-02T07:00:00Z",
          updatedAt: "2026-04-02T07:00:00Z",
        },
      ],
    });
    vi.mocked(apiClient.getBenchmarkFailuresV4).mockResolvedValue({ items: [] });

    render(<BenchmarkView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("95.5")).toBeInTheDocument();
      expect(screen.getByText("62.3")).toBeInTheDocument();
      expect(screen.getByText("Excellent performance on feature task")).toBeInTheDocument();
      expect(screen.getByText("Failed on guideline adherence")).toBeInTheDocument();
    });
  });

  it("shows empty states correctly", async () => {
    vi.mocked(apiClient.listBenchmarkProjectsV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkFailuresV4).mockResolvedValue({ items: [] });

    render(<BenchmarkView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("No benchmark runs yet")).toBeInTheDocument();
      expect(screen.getByText("No active run")).toBeInTheDocument();
      expect(screen.getByText("No benchmark projects configured")).toBeInTheDocument();
    });
  });

  it("handles loading states", async () => {
    vi.mocked(apiClient.listBenchmarkProjectsV4).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockImplementation(
      () => new Promise(() => {})
    );
    vi.mocked(apiClient.getBenchmarkFailuresV4).mockResolvedValue({ items: [] });

    render(<BenchmarkView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Loading leaderboard...")).toBeInTheDocument();
      expect(screen.getByText("Loading projects...")).toBeInTheDocument();
    });
  });

  it("displays failures when expanded", async () => {
    vi.mocked(apiClient.listBenchmarkProjectsV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkFailuresV4).mockResolvedValue({
      items: [
        {
          runId: "run-fail-001",
          pass: false,
          totalScore: 45.2,
          functionalCorrectness: 50,
          guidelineAdherence: 40,
          verificationDiscipline: 45,
          patchQuality: 42,
          retrievalDiscipline: 48,
          policyCompliance: 40,
          latencyRecovery: 50,
          hardFailures: ["build_failure", "test_timeout"],
          evidenceRefs: [],
          summary: "Critical build and test failures",
          createdAt: "2026-04-02T06:00:00Z",
          updatedAt: "2026-04-02T06:00:00Z",
        },
      ],
    });

    render(<BenchmarkView />, { wrapper: createWrapper() });

    const expandButton = await screen.findByText("Expand");
    expandButton.click();

    await waitFor(() => {
      expect(screen.getByText("Critical build and test failures")).toBeInTheDocument();
      expect(screen.getByText("45.2")).toBeInTheDocument();
      expect(screen.getByText("Hard failures:")).toBeInTheDocument();
      expect(screen.getByText("• build_failure")).toBeInTheDocument();
      expect(screen.getByText("• test_timeout")).toBeInTheDocument();
    });
  });
});

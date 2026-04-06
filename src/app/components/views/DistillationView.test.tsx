import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DistillationView } from "./DistillationView";
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

describe("DistillationView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders pipeline steps", async () => {
    vi.mocked(apiClient.getDistillReadinessV2).mockResolvedValue({
      checkedAt: new Date().toISOString(),
      ready: true,
      blockers: 0,
      warnings: 0,
      checks: [],
    });

    vi.mocked(apiClient.getDistillQuotaV2).mockResolvedValue({
      quota: {
        day: "2026-04-02",
        tokensUsed: 10000,
        requests: 50,
        remainingTokens: 110000,
        dailyTokenBudget: 120000,
        cooldownUntil: null,
        etaSeconds: null,
      },
      rateLimit: {
        maxRequestsPerMinute: 6,
        maxConcurrentTeacherJobs: 2,
        dailyTokenBudget: 120000,
        retryBackoffMs: 1000,
        maxRetries: 3,
      },
    });

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({
      items: [],
    });

    render(<DistillationView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Environment Check")).toBeInTheDocument();
      expect(screen.getByText("Dataset Generation")).toBeInTheDocument();
      expect(screen.getByText("Training Run")).toBeInTheDocument();
      expect(screen.getByText("Evaluation")).toBeInTheDocument();
      expect(screen.getByText("Promotion")).toBeInTheDocument();
    });
  });

  it("shows readiness check results", async () => {
    vi.mocked(apiClient.getDistillReadinessV2).mockResolvedValue({
      checkedAt: new Date().toISOString(),
      ready: true,
      blockers: 0,
      warnings: 0,
      checks: [
        {
          key: "teacher_cli",
          ok: true,
          severity: "error",
          message: "Teacher CLI is available",
        },
        {
          key: "python_version",
          ok: true,
          severity: "error",
          message: "Python 3.10+ detected",
        },
      ],
    });

    vi.mocked(apiClient.getDistillQuotaV2).mockResolvedValue({
      quota: {
        day: "2026-04-02",
        tokensUsed: 0,
        requests: 0,
        remainingTokens: 120000,
        dailyTokenBudget: 120000,
        cooldownUntil: null,
        etaSeconds: null,
      },
      rateLimit: {
        maxRequestsPerMinute: 6,
        maxConcurrentTeacherJobs: 2,
        dailyTokenBudget: 120000,
        retryBackoffMs: 1000,
        maxRetries: 3,
      },
    });

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({
      items: [],
    });

    render(<DistillationView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Ready")).toBeInTheDocument();
      expect(screen.getByText("teacher_cli")).toBeInTheDocument();
      expect(screen.getByText("Teacher CLI is available")).toBeInTheDocument();
      expect(screen.getByText("python_version")).toBeInTheDocument();
      expect(screen.getByText("Python 3.10+ detected")).toBeInTheDocument();
    });
  });

  it("handles empty/loading states", async () => {
    vi.mocked(apiClient.getDistillReadinessV2).mockImplementation(
      () => new Promise(() => {}) // Never resolves to test loading state
    );

    vi.mocked(apiClient.getDistillQuotaV2).mockResolvedValue({
      quota: {
        day: "2026-04-02",
        tokensUsed: 0,
        requests: 0,
        remainingTokens: 120000,
        dailyTokenBudget: 120000,
        cooldownUntil: null,
        etaSeconds: null,
      },
      rateLimit: {
        maxRequestsPerMinute: 6,
        maxConcurrentTeacherJobs: 2,
        dailyTokenBudget: 120000,
        retryBackoffMs: 1000,
        maxRetries: 3,
      },
    });

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({
      items: [],
    });

    render(<DistillationView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Checking environment...")).toBeInTheDocument();
    });
  });

  it("displays quota and budget information", async () => {
    vi.mocked(apiClient.getDistillReadinessV2).mockResolvedValue({
      checkedAt: new Date().toISOString(),
      ready: true,
      blockers: 0,
      warnings: 0,
      checks: [],
    });

    vi.mocked(apiClient.getDistillQuotaV2).mockResolvedValue({
      quota: {
        day: "2026-04-02",
        tokensUsed: 50000,
        requests: 100,
        remainingTokens: 70000,
        dailyTokenBudget: 120000,
        cooldownUntil: null,
        etaSeconds: null,
      },
      rateLimit: {
        maxRequestsPerMinute: 6,
        maxConcurrentTeacherJobs: 2,
        dailyTokenBudget: 120000,
        retryBackoffMs: 1000,
        maxRetries: 3,
      },
    });

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({
      items: [],
    });

    render(<DistillationView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Quota Status")).toBeInTheDocument();
      expect(screen.getByText("50,000")).toBeInTheDocument(); // Tokens used
      expect(screen.getByText("70,000")).toBeInTheDocument(); // Remaining
      expect(screen.getByText("120,000")).toBeInTheDocument(); // Daily budget
    });
  });

  it("shows promoted models in sidebar", async () => {
    vi.mocked(apiClient.getDistillReadinessV2).mockResolvedValue({
      checkedAt: new Date().toISOString(),
      ready: true,
      blockers: 0,
      warnings: 0,
      checks: [],
    });

    vi.mocked(apiClient.getDistillQuotaV2).mockResolvedValue({
      quota: {
        day: "2026-04-02",
        tokensUsed: 0,
        requests: 0,
        remainingTokens: 120000,
        dailyTokenBudget: 120000,
        cooldownUntil: null,
        etaSeconds: null,
      },
      rateLimit: {
        maxRequestsPerMinute: 6,
        maxConcurrentTeacherJobs: 2,
        dailyTokenBudget: 120000,
        retryBackoffMs: 1000,
        maxRetries: 3,
      },
    });

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({
      items: [
        {
          modelId: "qwen2.5-coder-0.5b-distilled",
          promoted: true,
          artifacts: ["adapter.safetensors", "config.json"],
          updatedAt: "2026-04-02T10:00:00Z",
        },
        {
          modelId: "qwen2.5-coder-1.5b-distilled",
          promoted: false,
          artifacts: ["adapter.safetensors"],
          updatedAt: "2026-04-01T12:00:00Z",
        },
      ],
    });

    render(<DistillationView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Distilled Models")).toBeInTheDocument();
      expect(screen.getByText("qwen2.5-coder-0.5b-distilled")).toBeInTheDocument();
      expect(screen.getByText("qwen2.5-coder-1.5b-distilled")).toBeInTheDocument();
      expect(screen.getByText("Promoted")).toBeInTheDocument();
      expect(screen.getByText("2 artifacts")).toBeInTheDocument();
      expect(screen.getByText("1 artifacts")).toBeInTheDocument();
    });
  });
});

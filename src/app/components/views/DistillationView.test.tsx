import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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

  it("shows not-ready state with blockers and warnings", async () => {
    vi.mocked(apiClient.getDistillReadinessV2).mockResolvedValue({
      checkedAt: new Date().toISOString(),
      ready: false,
      blockers: 2,
      warnings: 1,
      checks: [
        {
          key: "teacher_cli",
          ok: false,
          severity: "error",
          message: "Teacher CLI not found",
        },
        {
          key: "disk_space",
          ok: false,
          severity: "error",
          message: "Insufficient disk space",
        },
        {
          key: "python_version",
          ok: false,
          severity: "warning",
          message: "Python 3.9 detected, 3.10+ recommended",
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

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    render(<DistillationView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Not Ready")).toBeInTheDocument();
      expect(screen.getByText("2 blockers, 1 warnings")).toBeInTheDocument();
      expect(screen.getByText("Teacher CLI not found")).toBeInTheDocument();
      expect(screen.getByText("Insufficient disk space")).toBeInTheDocument();
      expect(screen.getByText("Python 3.9 detected, 3.10+ recommended")).toBeInTheDocument();
    });
  });

  it("shows readiness check details when present", async () => {
    vi.mocked(apiClient.getDistillReadinessV2).mockResolvedValue({
      checkedAt: new Date().toISOString(),
      ready: true,
      blockers: 0,
      warnings: 0,
      checks: [
        {
          key: "vram_check",
          ok: true,
          severity: "error",
          message: "VRAM sufficient",
          details: { vram_gb: 16, required_gb: 8 },
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

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    render(<DistillationView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("vram_check")).toBeInTheDocument();
      // Details should be rendered as JSON
      expect(screen.getByText(/vram_gb/)).toBeInTheDocument();
    });
  });

  it("shows no readiness data state", async () => {
    // Return undefined to simulate no data without being loading
    vi.mocked(apiClient.getDistillReadinessV2).mockResolvedValue(undefined as any);

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

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    render(<DistillationView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("No readiness data available")).toBeInTheDocument();
    });
  });

  it("navigates to dataset step and shows generate button", async () => {
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

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    render(<DistillationView />, { wrapper: createWrapper() });

    // Click Dataset Generation step
    fireEvent.click(screen.getByText("Dataset Generation"));

    await waitFor(() => {
      expect(screen.getByText("Dataset Generation & Review")).toBeInTheDocument();
      expect(screen.getByText("Generate Dataset")).toBeInTheDocument();
    });
  });

  it("generates dataset and shows examples for review", async () => {
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

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    vi.mocked(apiClient.generateDistillDatasetV2).mockResolvedValue({
      dataset: {
        id: "ds-1",
        title: "test_dataset",
        objectiveSplit: "train",
        privacyPolicyVersion: "v1",
        status: "draft",
        sampleCount: 10,
        approvedCount: 0,
        rejectedCount: 0,
        createdBy: "user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getDistillDatasetV2).mockResolvedValue({
      dataset: {
        id: "ds-1",
        title: "test_dataset",
        objectiveSplit: "train",
        privacyPolicyVersion: "v1",
        status: "draft",
        sampleCount: 10,
        approvedCount: 3,
        rejectedCount: 1,
        createdBy: "user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      examples: [
        {
          id: "ex-1",
          spec: {
            specId: "spec-1",
            intent: "Generate unit test",
            inputs: ["source.ts"],
            constraints: [],
            requiredTools: ["file_write"],
            requiredChecks: [],
          },
          teacherOutput: "Here is the test output with a lot of text that might be truncated when it exceeds two hundred characters for display purposes in the UI component rendering",
          reviewerDecision: "pending",
          privacySafe: true,
          citations: [],
          createdAt: new Date().toISOString(),
          reviewedAt: null,
        },
        {
          id: "ex-2",
          spec: {
            specId: "spec-2",
            intent: "Fix bug in parser",
            inputs: ["parser.ts", "types.ts"],
            constraints: [],
            requiredTools: ["file_edit", "shell"],
            requiredChecks: [],
          },
          teacherOutput: "Fixed the parser bug",
          reviewerDecision: "pending",
          privacySafe: false,
          citations: [],
          createdAt: new Date().toISOString(),
          reviewedAt: null,
        },
      ],
    });

    render(<DistillationView />, { wrapper: createWrapper() });

    // Navigate to dataset step
    fireEvent.click(screen.getByText("Dataset Generation"));

    // Click Generate Dataset (with prompt mock)
    const originalPrompt = window.prompt;
    window.prompt = vi.fn()
      .mockReturnValueOnce("test_dataset")
      .mockReturnValueOnce("10");

    fireEvent.click(screen.getByText("Generate Dataset"));

    await waitFor(() => {
      expect(apiClient.generateDistillDatasetV2).toHaveBeenCalled();
    });

    // After generation, the dataset details should show
    await waitFor(() => {
      expect(screen.getByText("test_dataset")).toBeInTheDocument();
      expect(screen.getByText(/10 samples, 3 approved, 1 rejected/)).toBeInTheDocument();
    });

    // Examples should show
    expect(screen.getByText("Generate unit test")).toBeInTheDocument();
    expect(screen.getByText("Fix bug in parser")).toBeInTheDocument();

    // Privacy badge
    expect(screen.getByText("Safe")).toBeInTheDocument();
    // The unsafe example should have Review badge
    const reviewBadges = screen.getAllByText("Review");
    expect(reviewBadges.length).toBeGreaterThanOrEqual(1);

    // Tool info
    expect(screen.getByText("Tools: file_write")).toBeInTheDocument();
    expect(screen.getByText("Tools: file_edit, shell")).toBeInTheDocument();

    window.prompt = originalPrompt;
  });

  it("approves and rejects dataset examples", async () => {
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

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    vi.mocked(apiClient.generateDistillDatasetV2).mockResolvedValue({
      dataset: {
        id: "ds-1",
        title: "review_dataset",
        objectiveSplit: "train",
        privacyPolicyVersion: "v1",
        status: "draft",
        sampleCount: 2,
        approvedCount: 0,
        rejectedCount: 0,
        createdBy: "user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getDistillDatasetV2).mockResolvedValue({
      dataset: {
        id: "ds-1",
        title: "review_dataset",
        objectiveSplit: "train",
        privacyPolicyVersion: "v1",
        status: "draft",
        sampleCount: 2,
        approvedCount: 0,
        rejectedCount: 0,
        createdBy: "user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      examples: [
        {
          id: "ex-1",
          spec: { specId: "s1", intent: "Test intent", inputs: ["a.ts"], constraints: [], requiredTools: ["shell"], requiredChecks: [] },
          teacherOutput: "output",
          reviewerDecision: "pending",
          privacySafe: true,
          citations: [],
          createdAt: new Date().toISOString(),
          reviewedAt: null,
        },
      ],
    });

    vi.mocked(apiClient.reviewDistillDatasetV2).mockResolvedValue({ success: true });

    render(<DistillationView />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText("Dataset Generation"));

    const originalPrompt = window.prompt;
    window.prompt = vi.fn().mockReturnValueOnce("review_dataset").mockReturnValueOnce("2");

    fireEvent.click(screen.getByText("Generate Dataset"));

    // Wait for dataset mutation to resolve and examples to load
    await waitFor(() => {
      expect(screen.getByText("Test intent")).toBeInTheDocument();
    }, { timeout: 3000 });

    // The approve/reject buttons have specific class patterns
    // Approve: className="text-emerald-400 hover:text-emerald-300"
    // Reject: className="text-red-400 hover:text-red-300"
    // We need to match the exact approve/reject buttons, not step navigation buttons
    const allButtons = screen.getAllByRole("button");
    const approveBtn = allButtons.find(b =>
      b.className.includes("hover:text-emerald-300")
    );
    const rejectBtn = allButtons.find(b =>
      b.className.includes("hover:text-red-300")
    );

    expect(approveBtn).toBeDefined();
    expect(rejectBtn).toBeDefined();

    fireEvent.click(approveBtn!);

    await waitFor(() => {
      expect(apiClient.reviewDistillDatasetV2).toHaveBeenCalledWith({
        actor: "user",
        dataset_id: "ds-1",
        decisions: [{ example_id: "ex-1", decision: "approved" }],
      });
    });

    fireEvent.click(rejectBtn!);

    await waitFor(() => {
      expect(apiClient.reviewDistillDatasetV2).toHaveBeenCalledWith({
        actor: "user",
        dataset_id: "ds-1",
        decisions: [{ example_id: "ex-1", decision: "rejected" }],
      });
    });

    window.prompt = originalPrompt;
  });

  it("shows approved dataset with continue to training button", async () => {
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

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    vi.mocked(apiClient.generateDistillDatasetV2).mockResolvedValue({
      dataset: {
        id: "ds-approved",
        title: "approved_ds",
        objectiveSplit: "train",
        privacyPolicyVersion: "v1",
        status: "approved",
        sampleCount: 50,
        approvedCount: 45,
        rejectedCount: 5,
        createdBy: "user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getDistillDatasetV2).mockResolvedValue({
      dataset: {
        id: "ds-approved",
        title: "approved_ds",
        objectiveSplit: "train",
        privacyPolicyVersion: "v1",
        status: "approved",
        sampleCount: 50,
        approvedCount: 45,
        rejectedCount: 5,
        createdBy: "user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      examples: [],
    });

    render(<DistillationView />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText("Dataset Generation"));

    const originalPrompt = window.prompt;
    window.prompt = vi.fn().mockReturnValueOnce("approved_ds").mockReturnValueOnce("50");

    fireEvent.click(screen.getByText("Generate Dataset"));

    await waitFor(() => {
      expect(screen.getByText("approved_ds")).toBeInTheDocument();
      expect(screen.getByText("approved")).toBeInTheDocument();
    });

    // Continue to Training button should be visible for approved datasets
    expect(screen.getByText("Continue to Training")).toBeInTheDocument();

    // Click it to navigate to training step
    fireEvent.click(screen.getByText("Continue to Training"));

    await waitFor(() => {
      // "Training Run" appears in both the step nav and the panel header
      const trainingElements = screen.getAllByText("Training Run");
      expect(trainingElements.length).toBeGreaterThanOrEqual(1);
      // The training step description should appear
      expect(screen.getByText("Fine-tune student model on approved dataset")).toBeInTheDocument();
    });

    window.prompt = originalPrompt;
  });

  it("shows dataset loading state", async () => {
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

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    vi.mocked(apiClient.generateDistillDatasetV2).mockResolvedValue({
      dataset: {
        id: "ds-loading",
        title: "loading_ds",
        objectiveSplit: "train",
        privacyPolicyVersion: "v1",
        status: "draft",
        sampleCount: 10,
        approvedCount: 0,
        rejectedCount: 0,
        createdBy: "user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    // Never resolve the dataset query
    vi.mocked(apiClient.getDistillDatasetV2).mockImplementation(() => new Promise(() => {}));

    render(<DistillationView />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText("Dataset Generation"));

    const originalPrompt = window.prompt;
    window.prompt = vi.fn().mockReturnValueOnce("loading_ds").mockReturnValueOnce("10");

    fireEvent.click(screen.getByText("Generate Dataset"));

    await waitFor(() => {
      expect(screen.getByText("Loading dataset...")).toBeInTheDocument();
    });

    window.prompt = originalPrompt;
  });

  it("shows training step with no dataset guard", async () => {
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

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    render(<DistillationView />, { wrapper: createWrapper() });

    // Navigate to training step without selecting dataset first
    fireEvent.click(screen.getByText("Training Run"));

    await waitFor(() => {
      expect(screen.getByText("Complete dataset generation and approval first")).toBeInTheDocument();
    });
  });

  it("shows training run with metrics, logs, and completed state", async () => {
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

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    // Set up dataset and training run
    vi.mocked(apiClient.generateDistillDatasetV2).mockResolvedValue({
      dataset: {
        id: "ds-train",
        title: "train_ds",
        objectiveSplit: "train",
        privacyPolicyVersion: "v1",
        status: "approved",
        sampleCount: 50,
        approvedCount: 50,
        rejectedCount: 0,
        createdBy: "user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getDistillDatasetV2).mockResolvedValue({
      dataset: {
        id: "ds-train",
        title: "train_ds",
        objectiveSplit: "train",
        privacyPolicyVersion: "v1",
        status: "approved",
        sampleCount: 50,
        approvedCount: 50,
        rejectedCount: 0,
        createdBy: "user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      examples: [],
    });

    vi.mocked(apiClient.startDistillTrainingV2).mockResolvedValue({
      run: {
        id: "run-1",
        stage: "sft",
        studentModelId: "qwen2.5-coder-0.5b",
        datasetId: "ds-train",
        status: "completed",
        metrics: { loss: 0.05, accuracy: 0.95 },
        artifactPath: "/models/run-1",
        backend: "mlx",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      jobId: "job-1",
      stage: "sft",
      backend: "mlx",
      startedAt: new Date().toISOString(),
      expectedArtifacts: ["adapter.safetensors"],
      reasonCode: null,
    });

    vi.mocked(apiClient.getDistillRunV2).mockResolvedValue({
      run: {
        id: "run-1",
        stage: "sft",
        studentModelId: "qwen2.5-coder-0.5b",
        datasetId: "ds-train",
        status: "completed",
        metrics: { loss: 0.05, accuracy: 0.95 },
        artifactPath: "/models/run-1",
        backend: "mlx",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getDistillRunLogsV2).mockResolvedValue({
      items: [
        {
          id: "log-1",
          runId: "run-1",
          level: "info",
          message: "Training started",
          payload: {},
          createdAt: new Date().toISOString(),
        },
        {
          id: "log-2",
          runId: "run-1",
          level: "warn",
          message: "Gradient spike detected",
          payload: {},
          createdAt: new Date().toISOString(),
        },
        {
          id: "log-3",
          runId: "run-1",
          level: "error",
          message: "Checkpoint save failed",
          payload: {},
          createdAt: new Date().toISOString(),
        },
      ],
    });

    render(<DistillationView />, { wrapper: createWrapper() });

    // Generate dataset first
    fireEvent.click(screen.getByText("Dataset Generation"));

    const originalPrompt = window.prompt;
    window.prompt = vi.fn().mockReturnValueOnce("train_ds").mockReturnValueOnce("50");

    fireEvent.click(screen.getByText("Generate Dataset"));

    await waitFor(() => {
      expect(screen.getByText("Continue to Training")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Continue to Training"));

    // Now on training step with dataset and approved status
    await waitFor(() => {
      expect(screen.getByText("Start Training")).toBeInTheDocument();
    });

    // Start training
    window.prompt = vi.fn().mockReturnValueOnce("qwen2.5-coder-0.5b");

    fireEvent.click(screen.getByText("Start Training"));

    await waitFor(() => {
      expect(apiClient.startDistillTrainingV2).toHaveBeenCalled();
    });

    // Should show run details
    await waitFor(() => {
      expect(screen.getByText("qwen2.5-coder-0.5b")).toBeInTheDocument();
      expect(screen.getByText(/Stage: sft/)).toBeInTheDocument();
      expect(screen.getByText("completed")).toBeInTheDocument();
    });

    // Metrics
    expect(screen.getByText("loss")).toBeInTheDocument();
    expect(screen.getByText("0.05")).toBeInTheDocument();
    expect(screen.getByText("accuracy")).toBeInTheDocument();
    expect(screen.getByText("0.95")).toBeInTheDocument();

    // Logs
    expect(screen.getByText("Training Logs")).toBeInTheDocument();
    expect(screen.getByText("Training started")).toBeInTheDocument();
    expect(screen.getByText("Gradient spike detected")).toBeInTheDocument();
    expect(screen.getByText("Checkpoint save failed")).toBeInTheDocument();

    // Continue to evaluation
    expect(screen.getByText("Continue to Evaluation")).toBeInTheDocument();

    window.prompt = originalPrompt;
  });

  it("shows training run loading state", async () => {
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

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    vi.mocked(apiClient.generateDistillDatasetV2).mockResolvedValue({
      dataset: {
        id: "ds-trainload",
        title: "load_ds",
        objectiveSplit: "train",
        privacyPolicyVersion: "v1",
        status: "approved",
        sampleCount: 10,
        approvedCount: 10,
        rejectedCount: 0,
        createdBy: "user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getDistillDatasetV2).mockResolvedValue({
      dataset: {
        id: "ds-trainload",
        title: "load_ds",
        objectiveSplit: "train",
        privacyPolicyVersion: "v1",
        status: "approved",
        sampleCount: 10,
        approvedCount: 10,
        rejectedCount: 0,
        createdBy: "user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      examples: [],
    });

    vi.mocked(apiClient.startDistillTrainingV2).mockResolvedValue({
      run: { id: "run-load", stage: "sft", studentModelId: "q", datasetId: "ds-trainload", status: "running", metrics: {}, artifactPath: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      jobId: "j1", stage: "sft", backend: "mlx", startedAt: new Date().toISOString(), expectedArtifacts: [], reasonCode: null,
    });

    // Never resolve the run query
    vi.mocked(apiClient.getDistillRunV2).mockImplementation(() => new Promise(() => {}));
    vi.mocked(apiClient.getDistillRunLogsV2).mockResolvedValue({ items: [] });

    render(<DistillationView />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText("Dataset Generation"));

    const originalPrompt = window.prompt;
    window.prompt = vi.fn().mockReturnValueOnce("load_ds").mockReturnValueOnce("10");
    fireEvent.click(screen.getByText("Generate Dataset"));

    await waitFor(() => { expect(screen.getByText("Continue to Training")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("Continue to Training"));

    window.prompt = vi.fn().mockReturnValueOnce("q");
    await waitFor(() => { expect(screen.getByText("Start Training")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("Start Training"));

    await waitFor(() => {
      expect(screen.getByText("Loading run...")).toBeInTheDocument();
    });

    window.prompt = originalPrompt;
  });

  it("shows evaluation step with no run guard", async () => {
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

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    render(<DistillationView />, { wrapper: createWrapper() });

    // Navigate directly to evaluation step
    fireEvent.click(screen.getByText("Evaluation"));

    await waitFor(() => {
      expect(screen.getByText("Complete training run first")).toBeInTheDocument();
    });
  });

  it("shows promotion step with guard when requirements not met", async () => {
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

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    render(<DistillationView />, { wrapper: createWrapper() });

    // Navigate directly to promotion step
    fireEvent.click(screen.getByText("Promotion"));

    await waitFor(() => {
      expect(screen.getByText("Complete training and pass evaluation first")).toBeInTheDocument();
    });
  });

  it("shows quota with cooldown warning", async () => {
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
        tokensUsed: 115000,
        requests: 200,
        remainingTokens: 5000,
        dailyTokenBudget: 120000,
        cooldownUntil: "2026-04-02T15:30:00Z",
        etaSeconds: 300,
      },
      rateLimit: {
        maxRequestsPerMinute: 6,
        maxConcurrentTeacherJobs: 2,
        dailyTokenBudget: 120000,
        retryBackoffMs: 1000,
        maxRetries: 3,
      },
    });

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    render(<DistillationView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/Cooldown until/)).toBeInTheDocument();
    });
  });

  it("shows no quota data state", async () => {
    vi.mocked(apiClient.getDistillReadinessV2).mockResolvedValue({
      checkedAt: new Date().toISOString(),
      ready: true,
      blockers: 0,
      warnings: 0,
      checks: [],
    });

    vi.mocked(apiClient.getDistillQuotaV2).mockResolvedValue({
      quota: undefined as any,
      rateLimit: {
        maxRequestsPerMinute: 6,
        maxConcurrentTeacherJobs: 2,
        dailyTokenBudget: 120000,
        retryBackoffMs: 1000,
        maxRetries: 3,
      },
    });

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    render(<DistillationView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("No quota data")).toBeInTheDocument();
    });
  });

  it("shows quota loading state", async () => {
    vi.mocked(apiClient.getDistillReadinessV2).mockResolvedValue({
      checkedAt: new Date().toISOString(),
      ready: true,
      blockers: 0,
      warnings: 0,
      checks: [],
    });

    vi.mocked(apiClient.getDistillQuotaV2).mockImplementation(() => new Promise(() => {}));

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    render(<DistillationView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Loading quota...")).toBeInTheDocument();
    });
  });

  it("shows models loading state", async () => {
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

    vi.mocked(apiClient.listDistillModelsV2).mockImplementation(() => new Promise(() => {}));

    render(<DistillationView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Loading models...")).toBeInTheDocument();
    });
  });

  it("shows no models state", async () => {
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

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    render(<DistillationView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("No models yet")).toBeInTheDocument();
    });
  });

  it("handles generate dataset prompt cancellation", async () => {
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

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    render(<DistillationView />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText("Dataset Generation"));

    const originalPrompt = window.prompt;
    // User cancels the first prompt
    window.prompt = vi.fn().mockReturnValueOnce(null);

    fireEvent.click(screen.getByText("Generate Dataset"));

    // Should NOT call generateDistillDatasetV2 when prompt is cancelled
    expect(apiClient.generateDistillDatasetV2).not.toHaveBeenCalled();

    window.prompt = originalPrompt;
  });

  it("handles start training prompt cancellation", async () => {
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

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    vi.mocked(apiClient.generateDistillDatasetV2).mockResolvedValue({
      dataset: {
        id: "ds-nostart",
        title: "no_start",
        objectiveSplit: "train",
        privacyPolicyVersion: "v1",
        status: "approved",
        sampleCount: 10,
        approvedCount: 10,
        rejectedCount: 0,
        createdBy: "user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getDistillDatasetV2).mockResolvedValue({
      dataset: {
        id: "ds-nostart",
        title: "no_start",
        objectiveSplit: "train",
        privacyPolicyVersion: "v1",
        status: "approved",
        sampleCount: 10,
        approvedCount: 10,
        rejectedCount: 0,
        createdBy: "user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      examples: [],
    });

    render(<DistillationView />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText("Dataset Generation"));

    const originalPrompt = window.prompt;
    window.prompt = vi.fn().mockReturnValueOnce("no_start").mockReturnValueOnce("10");
    fireEvent.click(screen.getByText("Generate Dataset"));

    await waitFor(() => { expect(screen.getByText("Continue to Training")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("Continue to Training"));

    // Cancel the prompt for student model
    window.prompt = vi.fn().mockReturnValueOnce(null);
    await waitFor(() => { expect(screen.getByText("Start Training")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("Start Training"));

    // Should NOT call startDistillTrainingV2
    expect(apiClient.startDistillTrainingV2).not.toHaveBeenCalled();

    window.prompt = originalPrompt;
  });

  it("shows no run selected state on training step", async () => {
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

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    render(<DistillationView />, { wrapper: createWrapper() });

    // Navigate directly to training step without a dataset
    fireEvent.click(screen.getByText("Training Run"));

    await waitFor(() => {
      expect(screen.getByText("Complete dataset generation and approval first")).toBeInTheDocument();
    });
  });

  it("shows no evaluation selected state", async () => {
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

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    render(<DistillationView />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText("Evaluation"));

    await waitFor(() => {
      expect(screen.getByText("Complete training run first")).toBeInTheDocument();
    });
  });

  it("shows training run with empty logs", async () => {
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

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    vi.mocked(apiClient.generateDistillDatasetV2).mockResolvedValue({
      dataset: {
        id: "ds-nolog",
        title: "nolog_ds",
        objectiveSplit: "train",
        privacyPolicyVersion: "v1",
        status: "approved",
        sampleCount: 10,
        approvedCount: 10,
        rejectedCount: 0,
        createdBy: "user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getDistillDatasetV2).mockResolvedValue({
      dataset: {
        id: "ds-nolog",
        title: "nolog_ds",
        objectiveSplit: "train",
        privacyPolicyVersion: "v1",
        status: "approved",
        sampleCount: 10,
        approvedCount: 10,
        rejectedCount: 0,
        createdBy: "user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      examples: [],
    });

    vi.mocked(apiClient.startDistillTrainingV2).mockResolvedValue({
      run: { id: "run-nolog", stage: "sft", studentModelId: "q", datasetId: "ds-nolog", status: "running", metrics: {}, artifactPath: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      jobId: "j1", stage: "sft", backend: "mlx", startedAt: new Date().toISOString(), expectedArtifacts: [], reasonCode: null,
    });

    vi.mocked(apiClient.getDistillRunV2).mockResolvedValue({
      run: { id: "run-nolog", stage: "sft", studentModelId: "q", datasetId: "ds-nolog", status: "running", metrics: {}, artifactPath: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    });

    vi.mocked(apiClient.getDistillRunLogsV2).mockResolvedValue({ items: [] });

    render(<DistillationView />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText("Dataset Generation"));

    const originalPrompt = window.prompt;
    window.prompt = vi.fn().mockReturnValueOnce("nolog_ds").mockReturnValueOnce("10");
    fireEvent.click(screen.getByText("Generate Dataset"));

    await waitFor(() => { expect(screen.getByText("Continue to Training")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("Continue to Training"));

    window.prompt = vi.fn().mockReturnValueOnce("q");
    await waitFor(() => { expect(screen.getByText("Start Training")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("Start Training"));

    await waitFor(() => {
      expect(screen.getByText("No logs available")).toBeInTheDocument();
    });

    window.prompt = originalPrompt;
  });

  it("shows training run with failed status badge", async () => {
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

    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    vi.mocked(apiClient.generateDistillDatasetV2).mockResolvedValue({
      dataset: {
        id: "ds-fail",
        title: "fail_ds",
        objectiveSplit: "train",
        privacyPolicyVersion: "v1",
        status: "approved",
        sampleCount: 10,
        approvedCount: 10,
        rejectedCount: 0,
        createdBy: "user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.mocked(apiClient.getDistillDatasetV2).mockResolvedValue({
      dataset: {
        id: "ds-fail",
        title: "fail_ds",
        objectiveSplit: "train",
        privacyPolicyVersion: "v1",
        status: "approved",
        sampleCount: 10,
        approvedCount: 10,
        rejectedCount: 0,
        createdBy: "user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      examples: [],
    });

    vi.mocked(apiClient.startDistillTrainingV2).mockResolvedValue({
      run: { id: "run-fail", stage: "sft", studentModelId: "q", datasetId: "ds-fail", status: "failed", metrics: {}, artifactPath: "", backend: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      jobId: "j1", stage: "sft", backend: "mlx", startedAt: new Date().toISOString(), expectedArtifacts: [], reasonCode: null,
    });

    vi.mocked(apiClient.getDistillRunV2).mockResolvedValue({
      run: { id: "run-fail", stage: "sft", studentModelId: "q", datasetId: "ds-fail", status: "failed", metrics: {}, artifactPath: "", backend: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    });

    vi.mocked(apiClient.getDistillRunLogsV2).mockResolvedValue({ items: [] });

    render(<DistillationView />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText("Dataset Generation"));

    const originalPrompt = window.prompt;
    window.prompt = vi.fn().mockReturnValueOnce("fail_ds").mockReturnValueOnce("10");
    fireEvent.click(screen.getByText("Generate Dataset"));

    await waitFor(() => { expect(screen.getByText("Continue to Training")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("Continue to Training"));

    window.prompt = vi.fn().mockReturnValueOnce("q");
    await waitFor(() => { expect(screen.getByText("Start Training")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("Start Training"));

    await waitFor(() => {
      expect(screen.getByText("failed")).toBeInTheDocument();
      // Backend shows N/A when null
      expect(screen.getByText(/Backend: N\/A/)).toBeInTheDocument();
    });

    // No continue button for failed runs
    expect(screen.queryByText("Continue to Evaluation")).not.toBeInTheDocument();

    window.prompt = originalPrompt;
  });

  it("runs evaluation and shows passing results with continue to promotion", async () => {
    vi.mocked(apiClient.getDistillReadinessV2).mockResolvedValue({
      checkedAt: new Date().toISOString(),
      ready: true, blockers: 0, warnings: 0, checks: [],
    });
    vi.mocked(apiClient.getDistillQuotaV2).mockResolvedValue({
      quota: { day: "2026-04-02", tokensUsed: 0, requests: 0, remainingTokens: 120000, dailyTokenBudget: 120000, cooldownUntil: null, etaSeconds: null },
      rateLimit: { maxRequestsPerMinute: 6, maxConcurrentTeacherJobs: 2, dailyTokenBudget: 120000, retryBackoffMs: 1000, maxRetries: 3 },
    });
    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.generateDistillDatasetV2).mockResolvedValue({
      dataset: { id: "ds-eval", title: "eval_ds", objectiveSplit: "train", privacyPolicyVersion: "v1", status: "approved", sampleCount: 10, approvedCount: 10, rejectedCount: 0, createdBy: "user", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    });
    vi.mocked(apiClient.getDistillDatasetV2).mockResolvedValue({
      dataset: { id: "ds-eval", title: "eval_ds", objectiveSplit: "train", privacyPolicyVersion: "v1", status: "approved", sampleCount: 10, approvedCount: 10, rejectedCount: 0, createdBy: "user", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      examples: [],
    });
    vi.mocked(apiClient.startDistillTrainingV2).mockResolvedValue({
      run: { id: "run-eval", stage: "sft", studentModelId: "q", datasetId: "ds-eval", status: "completed", metrics: {}, artifactPath: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      jobId: "j1", stage: "sft", backend: "mlx", startedAt: new Date().toISOString(), expectedArtifacts: [], reasonCode: null,
    });
    vi.mocked(apiClient.getDistillRunV2).mockResolvedValue({
      run: { id: "run-eval", stage: "sft", studentModelId: "q", datasetId: "ds-eval", status: "completed", metrics: {}, artifactPath: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    });
    vi.mocked(apiClient.getDistillRunLogsV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.runDistillEvalV2).mockResolvedValue({
      eval: { id: "eval-1", runId: "run-eval", baselineModelId: null, pass: true, metrics: { accuracy: 0.95, loss: 0.032 }, createdAt: new Date().toISOString() },
    });
    vi.mocked(apiClient.getDistillEvalV2).mockResolvedValue({
      eval: { id: "eval-1", runId: "run-eval", baselineModelId: null, pass: true, metrics: { accuracy: 0.95, loss: 0.032 }, createdAt: new Date().toISOString() },
    });

    render(<DistillationView />, { wrapper: createWrapper() });

    // Go through dataset -> training -> evaluation flow
    fireEvent.click(screen.getByText("Dataset Generation"));
    const originalPrompt = window.prompt;
    window.prompt = vi.fn().mockReturnValueOnce("eval_ds").mockReturnValueOnce("10");
    fireEvent.click(screen.getByText("Generate Dataset"));
    await waitFor(() => { expect(screen.getByText("Continue to Training")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("Continue to Training"));

    window.prompt = vi.fn().mockReturnValueOnce("q");
    await waitFor(() => { expect(screen.getByText("Start Training")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("Start Training"));
    await waitFor(() => { expect(screen.getByText("Continue to Evaluation")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("Continue to Evaluation"));

    // Now on evaluation step with completed run
    await waitFor(() => { expect(screen.getByText("Run Evaluation")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("Run Evaluation"));

    await waitFor(() => {
      expect(screen.getByText("Evaluation Results")).toBeInTheDocument();
      expect(screen.getByText("PASS")).toBeInTheDocument();
      expect(screen.getByText("accuracy")).toBeInTheDocument();
      expect(screen.getByText("0.950")).toBeInTheDocument();
      expect(screen.getByText("loss")).toBeInTheDocument();
      expect(screen.getByText("0.032")).toBeInTheDocument();
      expect(screen.getByText("Continue to Promotion")).toBeInTheDocument();
    });

    window.prompt = originalPrompt;
  });

  it("shows failing evaluation results without continue button", async () => {
    vi.mocked(apiClient.getDistillReadinessV2).mockResolvedValue({
      checkedAt: new Date().toISOString(),
      ready: true, blockers: 0, warnings: 0, checks: [],
    });
    vi.mocked(apiClient.getDistillQuotaV2).mockResolvedValue({
      quota: { day: "2026-04-02", tokensUsed: 0, requests: 0, remainingTokens: 120000, dailyTokenBudget: 120000, cooldownUntil: null, etaSeconds: null },
      rateLimit: { maxRequestsPerMinute: 6, maxConcurrentTeacherJobs: 2, dailyTokenBudget: 120000, retryBackoffMs: 1000, maxRetries: 3 },
    });
    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.generateDistillDatasetV2).mockResolvedValue({
      dataset: { id: "ds-fail-eval", title: "fail_eval_ds", objectiveSplit: "train", privacyPolicyVersion: "v1", status: "approved", sampleCount: 10, approvedCount: 10, rejectedCount: 0, createdBy: "user", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    });
    vi.mocked(apiClient.getDistillDatasetV2).mockResolvedValue({
      dataset: { id: "ds-fail-eval", title: "fail_eval_ds", objectiveSplit: "train", privacyPolicyVersion: "v1", status: "approved", sampleCount: 10, approvedCount: 10, rejectedCount: 0, createdBy: "user", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      examples: [],
    });
    vi.mocked(apiClient.startDistillTrainingV2).mockResolvedValue({
      run: { id: "run-fail-eval", stage: "sft", studentModelId: "q", datasetId: "ds-fail-eval", status: "completed", metrics: {}, artifactPath: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      jobId: "j1", stage: "sft", backend: "mlx", startedAt: new Date().toISOString(), expectedArtifacts: [], reasonCode: null,
    });
    vi.mocked(apiClient.getDistillRunV2).mockResolvedValue({
      run: { id: "run-fail-eval", stage: "sft", studentModelId: "q", datasetId: "ds-fail-eval", status: "completed", metrics: {}, artifactPath: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    });
    vi.mocked(apiClient.getDistillRunLogsV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.runDistillEvalV2).mockResolvedValue({
      eval: { id: "eval-fail", runId: "run-fail-eval", baselineModelId: null, pass: false, metrics: { accuracy: 0.4 }, createdAt: new Date().toISOString() },
    });
    vi.mocked(apiClient.getDistillEvalV2).mockResolvedValue({
      eval: { id: "eval-fail", runId: "run-fail-eval", baselineModelId: null, pass: false, metrics: { accuracy: 0.4 }, createdAt: new Date().toISOString() },
    });

    render(<DistillationView />, { wrapper: createWrapper() });

    // Navigate through the full pipeline
    fireEvent.click(screen.getByText("Dataset Generation"));
    const originalPrompt = window.prompt;
    window.prompt = vi.fn().mockReturnValueOnce("fail_eval_ds").mockReturnValueOnce("10");
    fireEvent.click(screen.getByText("Generate Dataset"));
    await waitFor(() => { expect(screen.getByText("Continue to Training")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("Continue to Training"));

    window.prompt = vi.fn().mockReturnValueOnce("q");
    await waitFor(() => { expect(screen.getByText("Start Training")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("Start Training"));
    await waitFor(() => { expect(screen.getByText("Continue to Evaluation")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("Continue to Evaluation"));

    await waitFor(() => { expect(screen.getByText("Run Evaluation")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("Run Evaluation"));

    await waitFor(() => {
      expect(screen.getByText("FAIL")).toBeInTheDocument();
      expect(screen.queryByText("Continue to Promotion")).not.toBeInTheDocument();
    });

    window.prompt = originalPrompt;
  });

  it("promotes model successfully", async () => {
    vi.mocked(apiClient.getDistillReadinessV2).mockResolvedValue({
      checkedAt: new Date().toISOString(),
      ready: true, blockers: 0, warnings: 0, checks: [],
    });
    vi.mocked(apiClient.getDistillQuotaV2).mockResolvedValue({
      quota: { day: "2026-04-02", tokensUsed: 0, requests: 0, remainingTokens: 120000, dailyTokenBudget: 120000, cooldownUntil: null, etaSeconds: null },
      rateLimit: { maxRequestsPerMinute: 6, maxConcurrentTeacherJobs: 2, dailyTokenBudget: 120000, retryBackoffMs: 1000, maxRetries: 3 },
    });
    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.generateDistillDatasetV2).mockResolvedValue({
      dataset: { id: "ds-promo", title: "promo_ds", objectiveSplit: "train", privacyPolicyVersion: "v1", status: "approved", sampleCount: 10, approvedCount: 10, rejectedCount: 0, createdBy: "user", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    });
    vi.mocked(apiClient.getDistillDatasetV2).mockResolvedValue({
      dataset: { id: "ds-promo", title: "promo_ds", objectiveSplit: "train", privacyPolicyVersion: "v1", status: "approved", sampleCount: 10, approvedCount: 10, rejectedCount: 0, createdBy: "user", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      examples: [],
    });
    vi.mocked(apiClient.startDistillTrainingV2).mockResolvedValue({
      run: { id: "run-promo", stage: "sft", studentModelId: "q", datasetId: "ds-promo", status: "completed", metrics: {}, artifactPath: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      jobId: "j1", stage: "sft", backend: "mlx", startedAt: new Date().toISOString(), expectedArtifacts: [], reasonCode: null,
    });
    vi.mocked(apiClient.getDistillRunV2).mockResolvedValue({
      run: { id: "run-promo", stage: "sft", studentModelId: "q", datasetId: "ds-promo", status: "completed", metrics: {}, artifactPath: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    });
    vi.mocked(apiClient.getDistillRunLogsV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.runDistillEvalV2).mockResolvedValue({
      eval: { id: "eval-promo", runId: "run-promo", baselineModelId: null, pass: true, metrics: { accuracy: 0.95 }, createdAt: new Date().toISOString() },
    });
    vi.mocked(apiClient.getDistillEvalV2).mockResolvedValue({
      eval: { id: "eval-promo", runId: "run-promo", baselineModelId: null, pass: true, metrics: { accuracy: 0.95 }, createdAt: new Date().toISOString() },
    });
    vi.mocked(apiClient.promoteDistillModelV2).mockResolvedValue({ success: true });

    render(<DistillationView />, { wrapper: createWrapper() });

    // Navigate through the full pipeline
    fireEvent.click(screen.getByText("Dataset Generation"));
    const originalPrompt = window.prompt;
    window.prompt = vi.fn().mockReturnValueOnce("promo_ds").mockReturnValueOnce("10");
    fireEvent.click(screen.getByText("Generate Dataset"));
    await waitFor(() => { expect(screen.getByText("Continue to Training")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("Continue to Training"));

    window.prompt = vi.fn().mockReturnValueOnce("q");
    await waitFor(() => { expect(screen.getByText("Start Training")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("Start Training"));
    await waitFor(() => { expect(screen.getByText("Continue to Evaluation")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("Continue to Evaluation"));

    await waitFor(() => { expect(screen.getByText("Run Evaluation")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("Run Evaluation"));
    await waitFor(() => { expect(screen.getByText("Continue to Promotion")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("Continue to Promotion"));

    // Now on promotion step with passing eval
    await waitFor(() => { expect(screen.getByText("Promote Model")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("Promote Model"));

    await waitFor(() => {
      expect(apiClient.promoteDistillModelV2).toHaveBeenCalledWith({
        actor: "user",
        run_id: "run-promo",
      });
      expect(screen.getByText("Model successfully promoted!")).toBeInTheDocument();
    });

    window.prompt = originalPrompt;
  });

  it("shows no dataset selected state", async () => {
    vi.mocked(apiClient.getDistillReadinessV2).mockResolvedValue({
      checkedAt: new Date().toISOString(),
      ready: true, blockers: 0, warnings: 0, checks: [],
    });
    vi.mocked(apiClient.getDistillQuotaV2).mockResolvedValue({
      quota: { day: "2026-04-02", tokensUsed: 0, requests: 0, remainingTokens: 120000, dailyTokenBudget: 120000, cooldownUntil: null, etaSeconds: null },
      rateLimit: { maxRequestsPerMinute: 6, maxConcurrentTeacherJobs: 2, dailyTokenBudget: 120000, retryBackoffMs: 1000, maxRetries: 3 },
    });
    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });

    // Set up a dataset generation that returns data but getDistillDatasetV2 returns null/empty
    vi.mocked(apiClient.generateDistillDatasetV2).mockResolvedValue({
      dataset: { id: "ds-empty", title: "empty_ds", objectiveSplit: "train", privacyPolicyVersion: "v1", status: "draft", sampleCount: 0, approvedCount: 0, rejectedCount: 0, createdBy: "user", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    });
    // Return data without dataset property to trigger "No dataset selected" state
    vi.mocked(apiClient.getDistillDatasetV2).mockResolvedValue({
      dataset: undefined as any,
      examples: [],
    });

    render(<DistillationView />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText("Dataset Generation"));

    const originalPrompt = window.prompt;
    window.prompt = vi.fn().mockReturnValueOnce("empty_ds").mockReturnValueOnce("1");
    fireEvent.click(screen.getByText("Generate Dataset"));

    await waitFor(() => {
      expect(screen.getByText("No dataset selected")).toBeInTheDocument();
    });

    window.prompt = originalPrompt;
  });

  it("shows dataset with warning status badge", async () => {
    vi.mocked(apiClient.getDistillReadinessV2).mockResolvedValue({
      checkedAt: new Date().toISOString(),
      ready: true, blockers: 0, warnings: 0, checks: [],
    });
    vi.mocked(apiClient.getDistillQuotaV2).mockResolvedValue({
      quota: { day: "2026-04-02", tokensUsed: 0, requests: 0, remainingTokens: 120000, dailyTokenBudget: 120000, cooldownUntil: null, etaSeconds: null },
      rateLimit: { maxRequestsPerMinute: 6, maxConcurrentTeacherJobs: 2, dailyTokenBudget: 120000, retryBackoffMs: 1000, maxRetries: 3 },
    });
    vi.mocked(apiClient.listDistillModelsV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.generateDistillDatasetV2).mockResolvedValue({
      dataset: { id: "ds-reviewed", title: "reviewed_ds", objectiveSplit: "train", privacyPolicyVersion: "v1", status: "reviewed", sampleCount: 10, approvedCount: 8, rejectedCount: 2, createdBy: "user", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    });
    vi.mocked(apiClient.getDistillDatasetV2).mockResolvedValue({
      dataset: { id: "ds-reviewed", title: "reviewed_ds", objectiveSplit: "train", privacyPolicyVersion: "v1", status: "reviewed", sampleCount: 10, approvedCount: 8, rejectedCount: 2, createdBy: "user", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      examples: [],
    });

    render(<DistillationView />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText("Dataset Generation"));
    const originalPrompt = window.prompt;
    window.prompt = vi.fn().mockReturnValueOnce("reviewed_ds").mockReturnValueOnce("10");
    fireEvent.click(screen.getByText("Generate Dataset"));

    await waitFor(() => {
      expect(screen.getByText("reviewed")).toBeInTheDocument();
    });

    // No continue button for non-approved datasets
    expect(screen.queryByText("Continue to Training")).not.toBeInTheDocument();

    window.prompt = originalPrompt;
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

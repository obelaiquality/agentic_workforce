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

  it("collapses failures when Collapse is clicked", async () => {
    vi.mocked(apiClient.listBenchmarkProjectsV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkFailuresV4).mockResolvedValue({
      items: [
        {
          runId: "run-fail-002",
          pass: false,
          totalScore: 30.0,
          functionalCorrectness: 30,
          guidelineAdherence: 30,
          verificationDiscipline: 30,
          patchQuality: 30,
          retrievalDiscipline: 30,
          policyCompliance: 30,
          latencyRecovery: 30,
          hardFailures: [],
          evidenceRefs: [],
          summary: "Low score run",
          createdAt: "2026-04-02T06:00:00Z",
          updatedAt: "2026-04-02T06:00:00Z",
        },
      ],
    });

    render(<BenchmarkView />, { wrapper: createWrapper() });

    const expandButton = await screen.findByText("Expand");
    expandButton.click();

    await waitFor(() => {
      expect(screen.getByText("Low score run")).toBeInTheDocument();
    });

    const collapseButton = screen.getByText("Collapse");
    collapseButton.click();

    await waitFor(() => {
      expect(screen.queryByText("Low score run")).not.toBeInTheDocument();
    });
  });

  it("shows no recent failures when failures list is empty and expanded", async () => {
    vi.mocked(apiClient.listBenchmarkProjectsV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkFailuresV4).mockResolvedValue({ items: [] });

    render(<BenchmarkView />, { wrapper: createWrapper() });

    const expandButton = await screen.findByText("Expand");
    expandButton.click();

    await waitFor(() => {
      expect(screen.getByText("No recent failures")).toBeInTheDocument();
    });
  });

  it("shows loading failures when expanded and query is pending", async () => {
    vi.mocked(apiClient.listBenchmarkProjectsV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkFailuresV4).mockImplementation(() => new Promise(() => {}));

    render(<BenchmarkView />, { wrapper: createWrapper() });

    const expandButton = await screen.findByText("Expand");
    expandButton.click();

    await waitFor(() => {
      expect(screen.getByText("Loading failures...")).toBeInTheDocument();
    });
  });

  it("Start New Run button selects first project and shows tasks panel", async () => {
    const proj = {
      id: "proj-start",
      repoId: "repo-1",
      projectKey: "start-test",
      displayName: "Start Test",
      sourceKind: "local_path",
      sourceUri: "/path",
      manifestPath: null,
      languages: ["typescript"],
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
    };
    vi.mocked(apiClient.listBenchmarkProjectsV4).mockResolvedValue({ items: [proj] });
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkFailuresV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkProjectV4).mockResolvedValue({
      project: proj,
      tasks: [],
    });

    render(<BenchmarkView />, { wrapper: createWrapper() });

    // Wait for projects to load first, which enables the Start New Run button
    await waitFor(() => {
      expect(screen.getByText("Start Test")).toBeInTheDocument();
    });

    const startBtn = screen.getByText("Start New Run");
    startBtn.click();

    // After clicking Start New Run, the tasks panel for the first project should appear
    await waitFor(() => {
      expect(screen.getByText(/Tasks - Start Test/)).toBeInTheDocument();
    });
  });

  it("displays project tasks with difficulty badges and run button", async () => {
    const proj = {
      id: "proj-tasks",
      repoId: "repo-1",
      projectKey: "task-test",
      displayName: "Task Test Project",
      sourceKind: "local_path",
      sourceUri: "/path",
      manifestPath: null,
      languages: ["python"],
      setupCommand: "",
      verifyCommand: "",
      resetCommand: null,
      installCommand: null,
      guidelineSources: [],
      timeBudgetSec: 300,
      networkPolicy: "allowed",
      defaultProviderRole: "coder_default",
      createdAt: "2026-04-01T10:00:00Z",
      updatedAt: "2026-04-01T10:00:00Z",
    };
    const task = {
      id: "task-1",
      projectId: "proj-tasks",
      title: "Fix login bug",
      prompt: "Fix the login bug that causes users to be logged out after 5 minutes of inactivity. The issue is in the session handler module...",
      category: "medium",
      expectedArtifacts: ["src/auth.ts"],
      requiredChecks: ["unit_tests", "lint"],
      createdAt: "2026-04-01T10:00:00Z",
      updatedAt: "2026-04-01T10:00:00Z",
    };

    vi.mocked(apiClient.listBenchmarkProjectsV4).mockResolvedValue({ items: [proj] });
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkFailuresV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkProjectV4).mockResolvedValue({ project: proj, tasks: [task] });

    render(<BenchmarkView />, { wrapper: createWrapper() });

    // Click on the project to select it
    const projCard = await screen.findByText("Task Test Project");
    projCard.click();

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
      expect(screen.getByText("medium")).toBeInTheDocument();
      expect(screen.getByText("Artifacts: src/auth.ts")).toBeInTheDocument();
      expect(screen.getByText("Checks: unit_tests, lint")).toBeInTheDocument();
    });
  });

  it("renders tasks panel close button", async () => {
    const proj = {
      id: "proj-close",
      repoId: "repo-1",
      projectKey: "close-test",
      displayName: "Close Test",
      sourceKind: "local_path",
      sourceUri: "/path",
      manifestPath: null,
      languages: ["go"],
      setupCommand: "",
      verifyCommand: "",
      resetCommand: null,
      installCommand: null,
      guidelineSources: [],
      timeBudgetSec: 120,
      networkPolicy: "allowed",
      defaultProviderRole: "coder_default",
      createdAt: "2026-04-01T10:00:00Z",
      updatedAt: "2026-04-01T10:00:00Z",
    };

    vi.mocked(apiClient.listBenchmarkProjectsV4).mockResolvedValue({ items: [proj] });
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkFailuresV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkProjectV4).mockResolvedValue({ project: proj, tasks: [] });

    render(<BenchmarkView />, { wrapper: createWrapper() });

    const projCard = await screen.findByText("Close Test");
    projCard.click();

    await waitFor(() => {
      expect(screen.getByText("No tasks found")).toBeInTheDocument();
    });

    // Click the Close button on the tasks panel
    const closeBtn = screen.getByText("Close");
    closeBtn.click();

    await waitFor(() => {
      expect(screen.queryByText("No tasks found")).not.toBeInTheDocument();
    });
  });

  it("shows active run with running status and execute button", async () => {
    vi.mocked(apiClient.listBenchmarkProjectsV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkFailuresV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.startBenchmarkRunV4).mockResolvedValue({
      run: {
        id: "run-active",
        projectId: "proj-1",
        taskId: "task-1",
        status: "running",
        mode: "operator_e2e",
        providerRole: "coder_default",
        createdAt: "2026-04-03T10:00:00Z",
        updatedAt: "2026-04-03T10:00:00Z",
      },
    });
    vi.mocked(apiClient.getBenchmarkRunV4).mockResolvedValue({
      run: {
        id: "run-active",
        projectId: "proj-1",
        taskId: "task-1",
        status: "running",
        mode: "operator_e2e",
        providerRole: "coder_default",
        createdAt: "2026-04-03T10:00:00Z",
        updatedAt: "2026-04-03T10:00:00Z",
      },
    });
    vi.mocked(apiClient.getBenchmarkScorecardV4).mockResolvedValue({ item: null });
    vi.mocked(apiClient.executeBenchmarkTaskV4).mockResolvedValue({ ok: true });

    // We need to manually trigger setting selectedRunId.
    // Since startRunMutation sets it, let's render a project with a task and start a run.
    const proj = {
      id: "proj-run",
      repoId: "repo-1",
      projectKey: "run-test",
      displayName: "Run Test",
      sourceKind: "local_path",
      sourceUri: "/path",
      manifestPath: null,
      languages: ["typescript"],
      setupCommand: "",
      verifyCommand: "",
      resetCommand: null,
      installCommand: null,
      guidelineSources: [],
      timeBudgetSec: 300,
      networkPolicy: "allowed",
      defaultProviderRole: "coder_default",
      createdAt: "2026-04-01T10:00:00Z",
      updatedAt: "2026-04-01T10:00:00Z",
    };
    const task = {
      id: "task-run",
      projectId: "proj-run",
      title: "Test Task",
      prompt: "Do something useful with the codebase. This is a test task that verifies the benchmark pipeline works correctly...",
      category: "easy",
      expectedArtifacts: ["out.ts"],
      requiredChecks: ["build"],
      createdAt: "2026-04-01T10:00:00Z",
      updatedAt: "2026-04-01T10:00:00Z",
    };

    vi.mocked(apiClient.listBenchmarkProjectsV4).mockResolvedValue({ items: [proj] });
    vi.mocked(apiClient.getBenchmarkProjectV4).mockResolvedValue({ project: proj, tasks: [task] });

    render(<BenchmarkView />, { wrapper: createWrapper() });

    // Select project
    const projCard = await screen.findByText("Run Test");
    projCard.click();

    // Find and click Run button on task
    const runBtns = await screen.findAllByText("Run");
    const taskRunBtn = runBtns.find((btn) => btn.closest("button"));
    taskRunBtn!.click();

    await waitFor(() => {
      expect(screen.getByText("Current Run")).toBeInTheDocument();
      expect(screen.getByText("running")).toBeInTheDocument();
      expect(screen.getByText("Execute Task")).toBeInTheDocument();
    });
  });

  it("shows completed run with scorecard and recompute button", async () => {
    vi.mocked(apiClient.listBenchmarkProjectsV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkFailuresV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkRunV4).mockResolvedValue({
      run: {
        id: "run-done",
        projectId: "proj-1",
        taskId: "task-1",
        status: "completed",
        mode: "operator_e2e",
        providerRole: "coder_default",
        createdAt: "2026-04-03T10:00:00Z",
        updatedAt: "2026-04-03T10:00:00Z",
      },
    });
    vi.mocked(apiClient.getBenchmarkScorecardV4).mockResolvedValue({
      item: {
        runId: "run-done",
        pass: true,
        totalScore: 88.5,
        functionalCorrectness: 90,
        guidelineAdherence: 85,
        verificationDiscipline: 88,
        patchQuality: 90,
        retrievalDiscipline: 87,
        policyCompliance: 92,
        latencyRecovery: 85,
        hardFailures: [],
        evidenceRefs: [],
        summary: "Good run",
        createdAt: "2026-04-03T10:00:00Z",
        updatedAt: "2026-04-03T10:00:00Z",
      },
    });

    // To get a run selected, click a leaderboard entry
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockResolvedValue({
      items: [
        {
          runId: "run-done",
          pass: true,
          totalScore: 88.5,
          functionalCorrectness: 90,
          guidelineAdherence: 85,
          verificationDiscipline: 88,
          patchQuality: 90,
          retrievalDiscipline: 87,
          policyCompliance: 92,
          latencyRecovery: 85,
          hardFailures: [],
          evidenceRefs: [],
          summary: "Good run",
          createdAt: "2026-04-03T10:00:00Z",
          updatedAt: "2026-04-03T10:00:00Z",
        },
      ],
    });

    render(<BenchmarkView />, { wrapper: createWrapper() });

    // Click on leaderboard entry to select the run
    const leaderboardEntry = await screen.findByText("Good run");
    leaderboardEntry.closest("[class*='cursor-pointer']")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );

    await waitFor(() => {
      expect(screen.getByText("Current Run")).toBeInTheDocument();
      expect(screen.getByText("completed")).toBeInTheDocument();
      expect(screen.getByText("Recompute Score")).toBeInTheDocument();
      expect(screen.getByText("Score: 88.5")).toBeInTheDocument();
    });
  });

  it("renders leaderboard rank badges with correct styling", async () => {
    vi.mocked(apiClient.listBenchmarkProjectsV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkFailuresV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockResolvedValue({
      items: [
        { runId: "run-1st", pass: true, totalScore: 99, functionalCorrectness: 100, guidelineAdherence: 98, verificationDiscipline: 99, patchQuality: 99, retrievalDiscipline: 98, policyCompliance: 100, latencyRecovery: 99, hardFailures: [], evidenceRefs: [], summary: "First place", createdAt: "2026-04-02T08:00:00Z", updatedAt: "2026-04-02T08:00:00Z" },
        { runId: "run-2nd", pass: true, totalScore: 90, functionalCorrectness: 90, guidelineAdherence: 90, verificationDiscipline: 90, patchQuality: 90, retrievalDiscipline: 90, policyCompliance: 90, latencyRecovery: 90, hardFailures: [], evidenceRefs: [], summary: "Second place", createdAt: "2026-04-02T07:00:00Z", updatedAt: "2026-04-02T07:00:00Z" },
        { runId: "run-3rd", pass: true, totalScore: 85, functionalCorrectness: 85, guidelineAdherence: 85, verificationDiscipline: 85, patchQuality: 85, retrievalDiscipline: 85, policyCompliance: 85, latencyRecovery: 85, hardFailures: [], evidenceRefs: [], summary: "Third place", createdAt: "2026-04-02T06:00:00Z", updatedAt: "2026-04-02T06:00:00Z" },
        { runId: "run-4th", pass: false, totalScore: 70, functionalCorrectness: 70, guidelineAdherence: 70, verificationDiscipline: 70, patchQuality: 70, retrievalDiscipline: 70, policyCompliance: 70, latencyRecovery: 70, hardFailures: [], evidenceRefs: [], summary: "Fourth place", createdAt: "2026-04-02T05:00:00Z", updatedAt: "2026-04-02T05:00:00Z" },
      ],
    });

    render(<BenchmarkView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("First place")).toBeInTheDocument();
      expect(screen.getByText("Second place")).toBeInTheDocument();
      expect(screen.getByText("Third place")).toBeInTheDocument();
      expect(screen.getByText("Fourth place")).toBeInTheDocument();
      // Check rank numbers
      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
      expect(screen.getByText("4")).toBeInTheDocument();
    });
  });

  it("displays No summary for leaderboard entries without summary", async () => {
    vi.mocked(apiClient.listBenchmarkProjectsV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkFailuresV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockResolvedValue({
      items: [
        { runId: "run-no-summary", pass: true, totalScore: 80, functionalCorrectness: 80, guidelineAdherence: 80, verificationDiscipline: 80, patchQuality: 80, retrievalDiscipline: 80, policyCompliance: 80, latencyRecovery: 80, hardFailures: [], evidenceRefs: [], summary: "", createdAt: "2026-04-02T08:00:00Z", updatedAt: "2026-04-02T08:00:00Z" },
      ],
    });

    render(<BenchmarkView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("No summary")).toBeInTheDocument();
    });
  });

  it("shows difficulty badge colors for easy and hard tasks", async () => {
    const proj = {
      id: "proj-diff",
      repoId: "repo-1",
      projectKey: "diff-test",
      displayName: "Difficulty Test",
      sourceKind: "local_path",
      sourceUri: "/path",
      manifestPath: null,
      languages: ["rust"],
      setupCommand: "",
      verifyCommand: "",
      resetCommand: null,
      installCommand: null,
      guidelineSources: [],
      timeBudgetSec: 600,
      networkPolicy: "allowed",
      defaultProviderRole: "coder_default",
      createdAt: "2026-04-01T10:00:00Z",
      updatedAt: "2026-04-01T10:00:00Z",
    };
    const tasks = [
      {
        id: "task-easy", projectId: "proj-diff", title: "Easy Task", prompt: "Simple fix to update a constant value in the configuration file that controls the timeout setting...",
        category: "easy", expectedArtifacts: ["config.rs"], requiredChecks: ["build"],
        createdAt: "2026-04-01T10:00:00Z", updatedAt: "2026-04-01T10:00:00Z",
      },
      {
        id: "task-hard", projectId: "proj-diff", title: "Hard Task", prompt: "Implement a distributed consensus algorithm with fault tolerance and leader election capabilities...",
        category: "hard", expectedArtifacts: ["consensus.rs"], requiredChecks: ["build", "test"],
        createdAt: "2026-04-01T10:00:00Z", updatedAt: "2026-04-01T10:00:00Z",
      },
      {
        id: "task-unknown", projectId: "proj-diff", title: "Unknown Category Task", prompt: "A task with an unknown difficulty category that should fall through to default badge styling...",
        category: "expert", expectedArtifacts: ["expert.rs"], requiredChecks: ["test"],
        createdAt: "2026-04-01T10:00:00Z", updatedAt: "2026-04-01T10:00:00Z",
      },
    ];

    vi.mocked(apiClient.listBenchmarkProjectsV4).mockResolvedValue({ items: [proj] });
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkFailuresV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkProjectV4).mockResolvedValue({ project: proj, tasks });

    render(<BenchmarkView />, { wrapper: createWrapper() });

    const projCard = await screen.findByText("Difficulty Test");
    projCard.click();

    await waitFor(() => {
      expect(screen.getByText("Easy Task")).toBeInTheDocument();
      expect(screen.getByText("easy")).toBeInTheDocument();
      expect(screen.getByText("Hard Task")).toBeInTheDocument();
      expect(screen.getByText("hard")).toBeInTheDocument();
      expect(screen.getByText("expert")).toBeInTheDocument();
    });
  });

  it("displays project details in card format", async () => {
    vi.mocked(apiClient.listBenchmarkProjectsV4).mockResolvedValue({
      items: [
        {
          id: "proj-detail",
          repoId: "repo-1",
          projectKey: "detail-test",
          displayName: "Detail Project",
          sourceKind: "git_url",
          sourceUri: "https://github.com/example/test",
          manifestPath: null,
          languages: ["java", "kotlin"],
          setupCommand: "gradle build",
          verifyCommand: "gradle test",
          resetCommand: null,
          installCommand: null,
          guidelineSources: [],
          timeBudgetSec: 450,
          networkPolicy: "offline",
          defaultProviderRole: "review_deep",
          createdAt: "2026-04-01T10:00:00Z",
          updatedAt: "2026-04-01T10:00:00Z",
        },
      ],
    });
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkFailuresV4).mockResolvedValue({ items: [] });

    render(<BenchmarkView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Detail Project")).toBeInTheDocument();
      expect(screen.getByText("java, kotlin")).toBeInTheDocument();
      expect(screen.getByText("Source: git_url")).toBeInTheDocument();
      expect(screen.getByText("Provider: review_deep")).toBeInTheDocument();
      expect(screen.getByText("Budget: 450s")).toBeInTheDocument();
    });
  });

  it("clicking Execute Task button calls executeBenchmarkTaskV4", async () => {
    vi.mocked(apiClient.listBenchmarkProjectsV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkFailuresV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkRunV4).mockResolvedValue({
      run: {
        id: "run-exec",
        projectId: "proj-1",
        taskId: "task-1",
        status: "running",
        mode: "operator_e2e",
        providerRole: "coder_default",
        createdAt: "2026-04-03T10:00:00Z",
        updatedAt: "2026-04-03T10:00:00Z",
      },
    });
    vi.mocked(apiClient.getBenchmarkScorecardV4).mockResolvedValue({ item: null });
    vi.mocked(apiClient.executeBenchmarkTaskV4).mockResolvedValue({ ok: true });
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockResolvedValue({
      items: [
        { runId: "run-exec", pass: false, totalScore: 50, functionalCorrectness: 50, guidelineAdherence: 50, verificationDiscipline: 50, patchQuality: 50, retrievalDiscipline: 50, policyCompliance: 50, latencyRecovery: 50, hardFailures: [], evidenceRefs: [], summary: "Running run", createdAt: "2026-04-03T10:00:00Z", updatedAt: "2026-04-03T10:00:00Z" },
      ],
    });

    render(<BenchmarkView />, { wrapper: createWrapper() });

    // Click on leaderboard entry to select the run
    const entry = await screen.findByText("Running run");
    entry.closest("[class*='cursor-pointer']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitFor(() => {
      expect(screen.getByText("Execute Task")).toBeInTheDocument();
    });

    screen.getByText("Execute Task").click();

    await waitFor(() => {
      expect(apiClient.executeBenchmarkTaskV4).toHaveBeenCalledWith({ actor: "user", run_id: "run-exec" });
    });
  });

  it("clicking Recompute Score button calls recomputeBenchmarkScoreV4", async () => {
    vi.mocked(apiClient.listBenchmarkProjectsV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkFailuresV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkRunV4).mockResolvedValue({
      run: {
        id: "run-recomp",
        projectId: "proj-1",
        taskId: "task-1",
        status: "completed",
        mode: "operator_e2e",
        providerRole: "coder_default",
        createdAt: "2026-04-03T10:00:00Z",
        updatedAt: "2026-04-03T10:00:00Z",
      },
    });
    vi.mocked(apiClient.getBenchmarkScorecardV4).mockResolvedValue({ item: null });
    vi.mocked(apiClient.recomputeBenchmarkScoreV4).mockResolvedValue({ ok: true });
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockResolvedValue({
      items: [
        { runId: "run-recomp", pass: true, totalScore: 90, functionalCorrectness: 90, guidelineAdherence: 90, verificationDiscipline: 90, patchQuality: 90, retrievalDiscipline: 90, policyCompliance: 90, latencyRecovery: 90, hardFailures: [], evidenceRefs: [], summary: "Completed run", createdAt: "2026-04-03T10:00:00Z", updatedAt: "2026-04-03T10:00:00Z" },
      ],
    });

    render(<BenchmarkView />, { wrapper: createWrapper() });

    const entry = await screen.findByText("Completed run");
    entry.closest("[class*='cursor-pointer']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitFor(() => {
      expect(screen.getByText("Recompute Score")).toBeInTheDocument();
    });

    screen.getByText("Recompute Score").click();

    await waitFor(() => {
      expect(apiClient.recomputeBenchmarkScoreV4).toHaveBeenCalledWith({ actor: "user", run_id: "run-recomp" });
    });
  });

  it("shows failures without hardFailures section when empty", async () => {
    vi.mocked(apiClient.listBenchmarkProjectsV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkLeaderboardV4).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getBenchmarkFailuresV4).mockResolvedValue({
      items: [
        {
          runId: "run-soft-fail",
          pass: false,
          totalScore: 55.0,
          functionalCorrectness: 55,
          guidelineAdherence: 55,
          verificationDiscipline: 55,
          patchQuality: 55,
          retrievalDiscipline: 55,
          policyCompliance: 55,
          latencyRecovery: 55,
          hardFailures: [],
          evidenceRefs: [],
          summary: "Soft failure only",
          createdAt: "2026-04-02T06:00:00Z",
          updatedAt: "2026-04-02T06:00:00Z",
        },
      ],
    });

    render(<BenchmarkView />, { wrapper: createWrapper() });

    const expandButton = await screen.findByText("Expand");
    expandButton.click();

    await waitFor(() => {
      expect(screen.getByText("Soft failure only")).toBeInTheDocument();
      expect(screen.queryByText("Hard failures:")).not.toBeInTheDocument();
    });
  });
});

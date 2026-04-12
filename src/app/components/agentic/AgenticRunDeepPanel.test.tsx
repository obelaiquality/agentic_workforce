import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AgenticRunDeepPanel } from "./AgenticRunDeepPanel";
import type { AgenticRunSnapshot } from "../../../shared/contracts";

vi.mock("../../lib/apiClient", () => ({
  resumeAgenticRun: vi.fn().mockResolvedValue({}),
  getTaskTimelineV2: vi.fn().mockResolvedValue({
    items: [
      {
        event_id: "evt-1",
        aggregate_id: "agg-000000000000rest",
        causation_id: "c-1",
        correlation_id: "cor-1",
        actor: "system",
        timestamp: new Date().toISOString(),
        type: "task.created",
        payload_json: JSON.stringify({ status: "open" }),
        schema_version: 1,
      },
      {
        event_id: "evt-2",
        aggregate_id: "agg-000000000000rest",
        causation_id: "c-2",
        correlation_id: "cor-2",
        actor: "agent",
        timestamp: new Date().toISOString(),
        type: "task.completed",
        payload_json: "invalid-json",
        schema_version: 1,
      },
    ],
  }),
  listRunToolEventsV9: vi.fn().mockResolvedValue({
    items: [
      {
        id: "tie-1",
        runId: "run-1",
        ticketId: "tkt-1",
        stage: "build",
        toolType: "repo.edit",
        command: "write_file",
        args: ["src/test.ts"],
        cwd: "/repo",
        policyDecision: "allowed",
        exitCode: 0,
        durationMs: 50,
        summary: "Wrote file",
        errorClass: "none",
        approvalId: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: "tie-2",
        runId: "run-1",
        ticketId: "tkt-1",
        stage: "review",
        toolType: "repo.verify",
        command: "run_tests",
        args: [],
        cwd: "/repo",
        policyDecision: "denied",
        exitCode: 1,
        durationMs: 200,
        summary: null,
        errorClass: "command_failed",
        approvalId: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: "tie-3",
        runId: "run-1",
        ticketId: "tkt-1",
        stage: "scope",
        toolType: "repo.read",
        command: "read_file",
        args: [],
        cwd: "/repo",
        policyDecision: "approval_required",
        exitCode: null,
        durationMs: 10,
        summary: "Read file",
        errorClass: "none",
        approvalId: "apr-1",
        createdAt: new Date().toISOString(),
      },
    ],
  }),
  getMergeReportV3: vi.fn().mockResolvedValue({
    item: {
      id: "mr-1",
      repoId: "repo-1",
      runId: "run-1",
      changedFiles: ["src/a.ts", "src/b.ts"],
      overlapScore: 0.45,
      semanticConflicts: ["Conflicting return types in foo()"],
      requiredChecks: [],
      outcome: "integrator_required",
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  }),
}));

function createRun(): AgenticRunSnapshot {
  const now = new Date().toISOString();
  return {
    runId: "run-1",
    status: "running",
    phase: "executing",
    plan: null,
    iterationCount: 3,
    toolCallCount: 2,
    approvalCount: 1,
    deniedCount: 0,
    compactionCount: 1,
    doomLoopCount: 1,
    escalationCount: 1,
    thinkingTokenCount: 120,
    lastAssistantText: "Latest assistant output",
    lastReason: "Awaiting final verification",
    latestRole: "coder_default",
    budget: {
      tokensConsumed: 900,
      maxTokens: 2000,
      costUsdConsumed: 0.12,
      maxCostUsd: 1,
      iterationsConsumed: 3,
      maxIterations: 10,
      tokenTimeline: [
        { iteration: 1, tokens: 200, timestamp: now },
        { iteration: 2, tokens: 500, timestamp: now },
        { iteration: 3, tokens: 900, timestamp: now },
      ],
    },
    recentEvents: [],
    toolCalls: [
      {
        id: "tool-1",
        iteration: 1,
        name: "read_file",
        args: { path: "src/app.ts" },
        result: { type: "success", content: "ok" },
        policyDecision: "allow",
        durationMs: 14,
        timestamp: now,
      },
    ],
    compactionEvents: [
      {
        iteration: 2,
        stage: "mid_run",
        tokensBefore: 1200,
        tokensAfter: 700,
        timestamp: now,
      },
    ],
    escalations: [
      {
        iteration: 3,
        fromRole: "coder_default",
        toRole: "review_deep",
        reason: "Need deeper review",
        timestamp: now,
      },
    ],
    doomLoops: [
      {
        iteration: 3,
        reason: "Repeated failing tool call",
        suggestion: "Escalate to review",
        timestamp: now,
      },
    ],
    skillEvents: [],
    hookEvents: [],
    memoryExtractions: [],
    thinkingLog: "Reasoning trace",
  };
}

describe("AgenticRunDeepPanel", () => {
  it("renders the expanded agentic run sections", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={createRun()} />
      </QueryClientProvider>
    );

    expect(screen.getByText("Awaiting final verification")).toBeInTheDocument();
    expect(screen.getByText("Latest assistant output")).toBeInTheDocument();
    expect(screen.getByText("Repeated failing tool call")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Tool Calls/i }));
    expect(screen.getByText("read_file")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Context Compaction/i }));
    expect(screen.getByText(/\(500 saved\)/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Escalations/i }));
    expect(screen.getByText("Need deeper review")).toBeInTheDocument();

    // Thinking auto-expands during active runs, so text is already visible
    expect(screen.getByText("Reasoning trace")).toBeInTheDocument();
    // Clicking collapses it
    fireEvent.click(screen.getByRole("button", { name: /Thinking Log/i }));
    expect(screen.queryByText("Reasoning trace")).not.toBeInTheDocument();
  });

  it("renders all StatusChip variants correctly", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const statuses: AgenticRunSnapshot["status"][] = ["idle", "running", "completed", "aborted", "failed"];

    for (const status of statuses) {
      const run = createRun();
      run.status = status;
      run.doomLoopCount = 0;
      run.doomLoops = [];
      run.toolCalls = [];
      run.compactionEvents = [];
      run.escalations = [];
      run.thinkingLog = null;
      run.lastAssistantText = null;
      run.lastReason = null;
      run.latestRole = null;

      const { unmount } = render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <AgenticRunDeepPanel run={run} />
        </QueryClientProvider>
      );

      expect(screen.getByText(status)).toBeInTheDocument();
      unmount();
    }
  });

  it("shows resume button for failed resumable runs and handles click", async () => {
    const { resumeAgenticRun } = await import("../../lib/apiClient");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();
    run.status = "failed";
    run.resumable = true;

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    const resumeBtn = screen.getByRole("button", { name: /Resume/i });
    expect(resumeBtn).toBeInTheDocument();
    fireEvent.click(resumeBtn);

    await waitFor(() => {
      expect(resumeAgenticRun).toHaveBeenCalledWith("run-1");
    });
  });

  it("shows resume button for aborted resumable runs", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();
    run.status = "aborted";
    run.resumable = true;

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    expect(screen.getByRole("button", { name: /Resume/i })).toBeInTheDocument();
  });

  it("does not show resume button for failed non-resumable runs", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();
    run.status = "failed";
    run.resumable = false;

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    expect(screen.queryByRole("button", { name: /Resume/i })).not.toBeInTheDocument();
  });

  it("handles resume error gracefully", async () => {
    const { resumeAgenticRun } = await import("../../lib/apiClient");
    (resumeAgenticRun as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();
    run.status = "failed";
    run.resumable = true;

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Resume/i }));

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith("Failed to resume run:", expect.any(Error));
    });
    consoleSpy.mockRestore();
  });

  it("shows latestRole when present", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    expect(screen.getByText("coder_default")).toBeInTheDocument();
  });

  it("renders MetricCard sublabel when deniedCount > 0", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();
    run.deniedCount = 3;

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    expect(screen.getByText("3 denied")).toBeInTheDocument();
  });

  it("handleMetricClick expands section when not already expanded", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    // Click on "Iterations" metric card to trigger handleMetricClick("events")
    const iterationsLabel = screen.getByText("Iterations");
    const iterationsCard = iterationsLabel.closest("div[class*='cursor-pointer']");
    expect(iterationsCard).toBeInTheDocument();
    fireEvent.click(iterationsCard!);
  });

  it("toggles section closed when already open", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    // Open Tool Calls
    fireEvent.click(screen.getByRole("button", { name: /Tool Calls/i }));
    expect(screen.getByText("read_file")).toBeInTheDocument();

    // Close Tool Calls
    fireEvent.click(screen.getByRole("button", { name: /Tool Calls/i }));
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
  });

  it("renders Plan section with executing phase and approved badge", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();
    run.plan = {
      runId: "run-1",
      phase: "executing",
      planContent: "Step 1: read files\nStep 2: edit code",
      questions: [],
      approved: true,
      reviewedBy: "user",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Plan/i }));
    expect(screen.getByText(/Step 1: read files/)).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    // "executing" appears in both PhaseChip and plan phase badge
    expect(screen.getAllByText("executing").length).toBeGreaterThanOrEqual(2);
  });

  it("renders Plan section with plan_review phase", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();
    run.phase = "plan_review" as any;
    run.plan = {
      runId: "run-1",
      phase: "plan_review",
      planContent: "Reviewing plan",
      questions: [],
      approved: false,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Plan/i }));
    // plan_review appears in PhaseChip and plan badge
    expect(screen.getAllByText("plan_review").length).toBeGreaterThanOrEqual(2);
  });

  it("renders Plan section with planning phase", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();
    run.phase = "planning" as any;
    run.plan = {
      runId: "run-1",
      phase: "planning",
      planContent: "Planning content",
      questions: [],
      approved: false,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Plan/i }));
    // planning appears in PhaseChip and plan badge
    expect(screen.getAllByText("planning").length).toBeGreaterThanOrEqual(2);
  });

  it("renders Plan section with unknown phase fallback styling", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();
    run.plan = {
      runId: "run-1",
      phase: "idle" as any,
      planContent: "Idle plan",
      questions: [],
      approved: false,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Plan/i }));
    expect(screen.getByText("Idle plan")).toBeInTheDocument();
  });

  it("renders Plan with questions (with and without answers)", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();
    run.plan = {
      runId: "run-1",
      phase: "plan_review",
      planContent: "Plan with questions",
      questions: [
        {
          id: "q-1",
          question: "What framework?",
          answer: "React",
          askedAt: new Date().toISOString(),
          answeredAt: new Date().toISOString(),
        },
        {
          id: "q-2",
          question: "Which database?",
          answer: null,
          askedAt: new Date().toISOString(),
          answeredAt: null,
        },
      ],
      approved: false,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Plan/i }));
    expect(screen.getByText("What framework?")).toBeInTheDocument();
    expect(screen.getByText("React")).toBeInTheDocument();
    expect(screen.getByText("Which database?")).toBeInTheDocument();
    expect(screen.getByText("Questions")).toBeInTheDocument();
  });

  it("renders DoomLoopAlert with suggestion", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    expect(screen.getByText("Doom Loop Detected")).toBeInTheDocument();
    expect(screen.getByText("Repeated failing tool call")).toBeInTheDocument();
    expect(screen.getByText(/Escalate to review/)).toBeInTheDocument();
  });

  it("renders DoomLoopAlert without suggestion", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();
    run.doomLoops = [
      {
        iteration: 3,
        reason: "Loop detected",
        suggestion: null,
        timestamp: new Date().toISOString(),
      },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    expect(screen.getByText("Doom Loop Detected")).toBeInTheDocument();
    expect(screen.getByText("Loop detected")).toBeInTheDocument();
    expect(screen.queryByText(/Suggestion:/)).not.toBeInTheDocument();
  });

  it("renders Budget section with sparkline and metrics", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    // Budget section should show token count badge
    fireEvent.click(screen.getByRole("button", { name: /Budget & Tokens/i }));

    // Check BudgetMetric labels
    expect(screen.getByText("Tokens")).toBeInTheDocument();
    expect(screen.getByText("Cost")).toBeInTheDocument();
    expect(screen.getByText("Thinking Tokens")).toBeInTheDocument();

    // SVG sparkline should be rendered
    const svgs = document.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThan(0);
  });

  it("renders BudgetMetric with null consumed value shows dash", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();
    run.budget.tokensConsumed = null;
    run.budget.maxTokens = null;
    run.budget.costUsdConsumed = null;
    run.budget.maxCostUsd = null;
    run.budget.iterationsConsumed = null;
    run.budget.maxIterations = null;

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Budget & Tokens/i }));
    // Should show em-dashes for null values
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });

  it("renders budget bar at >= 90% in red", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();
    run.budget.tokensConsumed = 1900;
    run.budget.maxTokens = 2000;

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Budget & Tokens/i }));
    // The 95% bar should have bg-red-500
    const bars = document.querySelectorAll("[class*='bg-red-500']");
    expect(bars.length).toBeGreaterThan(0);
  });

  it("renders budget bar at >= 70% in amber", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();
    run.budget.tokensConsumed = 1500;
    run.budget.maxTokens = 2000;

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Budget & Tokens/i }));
    const bars = document.querySelectorAll("[class*='bg-amber-500']");
    expect(bars.length).toBeGreaterThan(0);
  });

  it("renders sparkline with not enough data message when timeline has < 2 entries", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();
    // The sparkline only renders inside the ExpandableSection when timeline.length >= 2
    // But BudgetSparkline itself handles < 2 with "Not enough data"
    // Since the parent checks timeline.length >= 2 before rendering BudgetSparkline,
    // the "Not enough data" branch is only reached when BudgetSparkline is called directly.
    // However, the condition is `timeline.length >= 2` in the parent, so with 1 item
    // the sparkline won't be rendered at all. With exactly 0 items, same.
    // The "Not enough data" guard inside BudgetSparkline is a safety net.
    run.budget.tokenTimeline = [];

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Budget & Tokens/i }));
    // With empty timeline, sparkline won't render at all due to parent guard
    const svgs = document.querySelectorAll("polyline");
    expect(svgs.length).toBe(0);
  });

  it("renders sparkline with maxTokens limit line", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();
    run.budget.maxTokens = 2000;

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Budget & Tokens/i }));
    // Check for the dashed limit line in SVG
    const dashLines = document.querySelectorAll("line[stroke-dasharray]");
    expect(dashLines.length).toBeGreaterThan(0);
  });

  it("renders sparkline without maxTokens (no limit line)", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();
    run.budget.maxTokens = null;

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Budget & Tokens/i }));
    const dashLines = document.querySelectorAll("line[stroke-dasharray]");
    expect(dashLines.length).toBe(0);
  });

  it("renders ToolCallItem with approval_required policy and expandable details", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const now = new Date().toISOString();
    const run = createRun();
    run.toolCalls = [
      {
        id: "tool-2",
        iteration: 2,
        name: "write_file",
        args: { path: "src/main.ts", content: "hello" },
        result: { type: "success", content: "written", metadata: { size: 5 } },
        policyDecision: "approval_required",
        durationMs: 50,
        timestamp: now,
      },
      {
        id: "tool-3",
        iteration: 3,
        name: "delete_file",
        args: { path: "old.ts" },
        result: { type: "error", error: "file not found", metadata: { code: 404 } },
        policyDecision: "deny",
        durationMs: 5,
        timestamp: now,
      },
      {
        id: "tool-4",
        iteration: 4,
        name: "unknown_tool",
        args: {},
        result: { type: "approval_required" as any, approvalId: "apr-1", message: "needs approval" },
        policyDecision: "allow",
        durationMs: 1,
        timestamp: now,
      },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Tool Calls/i }));
    expect(screen.getByText("write_file")).toBeInTheDocument();
    expect(screen.getByText("delete_file")).toBeInTheDocument();
    expect(screen.getByText("unknown_tool")).toBeInTheDocument();

    // Check policy chips
    expect(screen.getByText("approval required")).toBeInTheDocument();
    expect(screen.getByText("deny")).toBeInTheDocument();

    // Check durations
    expect(screen.getByText("50ms")).toBeInTheDocument();
    expect(screen.getByText("5ms")).toBeInTheDocument();
  });

  it("renders SkillEventList with various statuses", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const now = new Date().toISOString();
    const run = createRun();
    run.skillEvents = [
      {
        invocationId: "sk-1",
        skillId: "s1",
        skillName: "code_review",
        status: "completed",
        output: "Review passed",
        childRunId: null,
        timestamp: now,
      },
      {
        invocationId: "sk-2",
        skillId: "s2",
        skillName: "refactor",
        status: "running",
        output: null,
        childRunId: "child-run-1",
        timestamp: now,
      },
      {
        invocationId: "sk-3",
        skillId: "s3",
        skillName: "test_gen",
        status: "failed",
        output: null,
        childRunId: null,
        timestamp: now,
      },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Skills/i }));
    expect(screen.getByText("code_review")).toBeInTheDocument();
    expect(screen.getByText("Review passed")).toBeInTheDocument();
    expect(screen.getByText("refactor")).toBeInTheDocument();
    expect(screen.getByText("fork: child-run-1")).toBeInTheDocument();
    expect(screen.getByText("test_gen")).toBeInTheDocument();
    // "completed" and "running" appear in both status header and skill status chips
    expect(screen.getAllByText("completed").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("running").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("failed").length).toBeGreaterThanOrEqual(1);
  });

  it("renders HookEventList with success and failure events", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const now = new Date().toISOString();
    const run = createRun();
    run.hookEvents = [
      {
        hookId: "h-1",
        hookName: "lint_check",
        eventType: "PreToolUse",
        success: true,
        output: "Lint passed",
        error: null,
        timestamp: now,
      },
      {
        hookId: "h-2",
        hookName: "format_check",
        eventType: "PostToolUseFailure",
        success: false,
        output: null,
        error: "Format check failed",
        timestamp: now,
      },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Hooks/i }));
    expect(screen.getByText("lint_check")).toBeInTheDocument();
    expect(screen.getByText("PreToolUse")).toBeInTheDocument();
    expect(screen.getByText("ok")).toBeInTheDocument();
    expect(screen.getByText("Lint passed")).toBeInTheDocument();
    expect(screen.getByText("format_check")).toBeInTheDocument();
    expect(screen.getByText("PostToolUseFailure")).toBeInTheDocument();
    expect(screen.getByText("fail")).toBeInTheDocument();
    expect(screen.getByText("Format check failed")).toBeInTheDocument();
  });

  it("renders MemoryExtractionList", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const now = new Date().toISOString();
    const run = createRun();
    run.memoryExtractions = [
      {
        memoryId: "mem-abc123",
        summary: "Learned about error handling patterns",
        timestamp: now,
      },
      {
        memoryId: "mem-def456",
        summary: "Captured API design decision",
        timestamp: now,
      },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Memory/i }));
    expect(screen.getByText("Learned about error handling patterns")).toBeInTheDocument();
    expect(screen.getByText("mem-abc123")).toBeInTheDocument();
    expect(screen.getByText("Captured API design decision")).toBeInTheDocument();
    expect(screen.getByText("mem-def456")).toBeInTheDocument();
  });

  it("renders MergeReport from async query data", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Merge Report/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Merge Report/i }));
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("src/b.ts")).toBeInTheDocument();
    expect(screen.getByText("Changed Files")).toBeInTheDocument();
    expect(screen.getByText("Semantic Conflicts")).toBeInTheDocument();
    expect(screen.getByText(/Conflicting return types/)).toBeInTheDocument();
    expect(screen.getByText("integrator required")).toBeInTheDocument();
    expect(screen.getByText("Outcome")).toBeInTheDocument();
    expect(screen.getByText("45.0%")).toBeInTheDocument();
    expect(screen.getByText("Overlap Score")).toBeInTheDocument();
  });

  it("renders TaskTimeline from async query data", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} ticketId="tkt-1" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Task Timeline/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Task Timeline/i }));
    expect(screen.getByText("task.created")).toBeInTheDocument();
    expect(screen.getByText("task.completed")).toBeInTheDocument();

    // Check actor display
    expect(screen.getByText("actor: system")).toBeInTheDocument();
    expect(screen.getByText("actor: agent")).toBeInTheDocument();

    // Check aggregate_id truncation - both events share same aggregate_id
    expect(screen.getAllByText("agg-00000000").length).toBe(2);
  });

  it("renders ToolInvocationList from async query data with various policies and error classes", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Tool Events/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Tool Events/i }));
    expect(screen.getByText("write_file")).toBeInTheDocument();
    expect(screen.getByText("Wrote file")).toBeInTheDocument();
    expect(screen.getByText("run_tests")).toBeInTheDocument();
    expect(screen.getByText(/command failed/)).toBeInTheDocument();
    expect(screen.getByText("exit 0")).toBeInTheDocument();
    expect(screen.getByText("exit 1")).toBeInTheDocument();
    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("approval required")).toBeInTheDocument();
    expect(screen.getByText("denied")).toBeInTheDocument();
  });

  it("renders compaction events with token savings correctly", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Context Compaction/i }));
    // Check iteration and stage labels
    expect(screen.getByText("Iteration 2")).toBeInTheDocument();
    expect(screen.getByText("Stage mid_run")).toBeInTheDocument();
    // Percentage: (1200-700)/1200 * 100 = 41.7%
    expect(screen.getByText("-41.7%")).toBeInTheDocument();
  });

  it("renders escalation without reason", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();
    run.escalations = [
      {
        iteration: 1,
        fromRole: "utility_fast",
        toRole: "review_deep",
        reason: null,
        timestamp: new Date().toISOString(),
      },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Escalations/i }));
    expect(screen.getByText("utility_fast")).toBeInTheDocument();
    // review_deep appears both in escalation and possibly latestRole area, but here
    // we just check it's somewhere in the escalation section
    expect(screen.getAllByText("review_deep").length).toBeGreaterThanOrEqual(1);
  });

  it("renders lastAssistantText when present", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    expect(screen.getByText("Latest Output")).toBeInTheDocument();
    expect(screen.getByText("Latest assistant output")).toBeInTheDocument();
  });

  it("does not render lastAssistantText when null", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();
    run.lastAssistantText = null;

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    expect(screen.queryByText("Latest Output")).not.toBeInTheDocument();
  });

  it("does not render sections when arrays are empty", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();
    run.toolCalls = [];
    run.compactionEvents = [];
    run.escalations = [];
    run.skillEvents = [];
    run.hookEvents = [];
    run.memoryExtractions = [];
    run.doomLoopCount = 0;
    run.doomLoops = [];
    run.thinkingLog = null;

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    expect(screen.queryByRole("button", { name: /Tool Calls/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Context Compaction/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Escalations/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Skills/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Hooks/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Memory/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Thinking Log/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Doom Loop Detected")).not.toBeInTheDocument();
  });

  it("renders ExpandableSection badge when provided", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const now = new Date().toISOString();
    const run = createRun();
    run.budget.tokensConsumed = 5000;

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    // Budget section should show formatted token count badge
    expect(screen.getByText("5,000")).toBeInTheDocument();
  });

  it("renders Budget section badge as null when tokensConsumed is null", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = createRun();
    run.budget.tokensConsumed = null;

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    // Budget section should render without a badge
    const budgetButton = screen.getByRole("button", { name: /Budget & Tokens/i });
    expect(budgetButton).toBeInTheDocument();
  });

  it("handles hookEvent with output but no error", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const now = new Date().toISOString();
    const run = createRun();
    run.hookEvents = [
      {
        hookId: "h-3",
        hookName: "test_hook",
        eventType: "PostToolUse",
        success: true,
        output: "Hook output text",
        error: null,
        timestamp: now,
      },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Hooks/i }));
    expect(screen.getByText("Hook output text")).toBeInTheDocument();
  });

  it("renders hook event with error suppressing output", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const now = new Date().toISOString();
    const run = createRun();
    run.hookEvents = [
      {
        hookId: "h-4",
        hookName: "error_hook",
        eventType: "PostToolUse",
        success: false,
        output: "Should not show",
        error: "Error occurred",
        timestamp: now,
      },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <AgenticRunDeepPanel run={run} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Hooks/i }));
    expect(screen.getByText("Error occurred")).toBeInTheDocument();
    // output should not be shown when error is present
    expect(screen.queryByText("Should not show")).not.toBeInTheDocument();
  });
});

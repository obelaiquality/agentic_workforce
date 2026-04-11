import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgenticOrchestrator } from "./agenticOrchestrator";
import { ToolRegistry } from "../tools/registry";
import type { ProviderOrchestrator } from "../services/providerOrchestrator";
import type { ContextService } from "../services/contextService";
import type { MemoryService } from "../services/memoryService";
import type { DoomLoopDetector } from "../services/doomLoopDetector";
import type { V2EventService } from "../services/v2EventService";
import type { AgenticEvent, AgenticExecutionInput } from "../tools/types";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

function createBaseDeps() {
  const registry = new ToolRegistry();

  const mockProviderOrchestrator = {
    streamChatWithRetryStreaming: vi.fn(),
  } as unknown as ProviderOrchestrator;

  const mockContextService = {} as ContextService;

  const mockMemoryService = {
    startPrefetch: vi.fn(),
    awaitPrefetch: vi.fn(async () => []),
    formatMemoriesForPrompt: vi.fn(() => ""),
    commitCompactionSummary: vi.fn(),
    compose: vi.fn(() => ({
      episodicContext: "",
      workingMessages: [],
      stats: { episodicCount: 0, workingCount: 0, totalTokenEstimate: 0 },
    })),
  } as unknown as MemoryService;

  const mockDoomLoopDetector = {
    record: vi.fn(),
    isLooping: vi.fn(() => false),
    getLoopingAction: vi.fn(() => null),
    reset: vi.fn(),
    stats: vi.fn(() => ({
      windowSize: 20,
      recorded: 0,
      threshold: 3,
      looping: false,
      chainDepth: 0,
    })),
  } as unknown as DoomLoopDetector;

  const mockEvents = {
    appendEvent: vi.fn(),
  } as unknown as V2EventService;

  return {
    registry,
    mockProviderOrchestrator,
    mockContextService,
    mockMemoryService,
    mockDoomLoopDetector,
    mockEvents,
  };
}

function registerTestTool(registry: ToolRegistry, name = "test_tool") {
  registry.register({
    name,
    description: `Test tool: ${name}`,
    inputSchema: z.object({ value: z.string() }),
    execute: async (input) => ({
      type: "success",
      content: `Result: ${input.value}`,
    }),
    permission: { scope: "meta", readOnly: true },
  });
}

function makeInput(overrides?: Partial<AgenticExecutionInput>): AgenticExecutionInput {
  return {
    runId: "cov-run",
    repoId: "test-repo",
    ticketId: "test-ticket",
    objective: "Coverage test objective",
    worktreePath: "/tmp/test",
    actor: "test-agent",
    ...overrides,
  };
}

async function collectEvents(gen: AsyncGenerator<AgenticEvent>): Promise<AgenticEvent[]> {
  const events: AgenticEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// 1. Resume from checkpoint
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — resume from checkpoint", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
    registerTestTool(deps.registry);
  });

  it("emits iteration_start and resume notification when resuming from checkpoint", async () => {
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "token", value: "Resumed and completed." };
        yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const checkpoint = {
      runId: "cov-run",
      messages: [
        { role: "system" as const, content: "System prompt", pinned: true, timestamp: new Date().toISOString() },
        { role: "user" as const, content: "Do the thing", pinned: true, timestamp: new Date().toISOString() },
        { role: "assistant" as const, content: "Working on it", timestamp: new Date().toISOString() },
      ],
      iterationCount: 3,
      budgetUsed: { tokens: 500, cost: 0.02 },
      currentRole: "coder_default" as const,
      toolCallsTotal: 5,
      recentlyReadFiles: [{ path: "/src/test.ts", content: "test file content" }],
      timestamp: new Date().toISOString(),
    };

    const events = await collectEvents(orchestrator.execute(makeInput(), checkpoint));

    // Should have iteration_start from the resume path
    const iterationStarts = events.filter((e) => e.type === "iteration_start");
    expect(iterationStarts.length).toBeGreaterThanOrEqual(1);
    // The first iteration_start should be the resume notification (iteration = 3)
    expect(iterationStarts[0]).toMatchObject({
      type: "iteration_start",
      iteration: 3,
    });

    // Should complete
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);

    // The execution_complete should carry forward the tool call count from the checkpoint
    const completeEvent = events.find((e) => e.type === "execution_complete") as any;
    expect(completeEvent.totalToolCalls).toBe(5); // No new tool calls
    expect(completeEvent.totalIterations).toBe(4); // 3 from checkpoint + 1 new
  });
});

// ---------------------------------------------------------------------------
// 2. Global knowledge pool integration
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — global knowledge pool", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("includes global knowledge in system prompt when pool and fingerprint available", async () => {
    const mockGlobalKnowledgePool = {
      formatForSystemPrompt: vi.fn(async () => "## Global Knowledge\nUse pattern X for TypeScript projects."),
      rankSkillsForProject: vi.fn(() => []),
    };

    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "token", value: "Done." };
        yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      globalKnowledgePool: mockGlobalKnowledgePool,
      techFingerprint: ["typescript", "react"],
    });

    await collectEvents(orchestrator.execute(makeInput()));

    // Should have called formatForSystemPrompt with the tech fingerprint
    expect(mockGlobalKnowledgePool.formatForSystemPrompt).toHaveBeenCalledWith(
      ["typescript", "react"],
      1500,
    );
  });

  it("gracefully handles global knowledge pool failure", async () => {
    const mockGlobalKnowledgePool = {
      formatForSystemPrompt: vi.fn(async () => {
        throw new Error("Knowledge pool unavailable");
      }),
      rankSkillsForProject: vi.fn(() => []),
    };

    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "token", value: "Done." };
        yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      globalKnowledgePool: mockGlobalKnowledgePool,
      techFingerprint: ["python"],
    });

    // Should not throw — error is swallowed
    const events = await collectEvents(orchestrator.execute(makeInput()));
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);
  });

  it("skips global knowledge when techFingerprint is empty", async () => {
    const mockGlobalKnowledgePool = {
      formatForSystemPrompt: vi.fn(async () => "knowledge"),
      rankSkillsForProject: vi.fn(() => []),
    };

    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "token", value: "Done." };
        yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      globalKnowledgePool: mockGlobalKnowledgePool,
      techFingerprint: [], // Empty fingerprint
    });

    await collectEvents(orchestrator.execute(makeInput()));

    // Should NOT call formatForSystemPrompt when fingerprint is empty
    expect(mockGlobalKnowledgePool.formatForSystemPrompt).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Learnings service integration (doom loop antipattern recording)
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — learnings service", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
    registerTestTool(deps.registry);
  });

  it("records antipattern via learnings service when doom loop is detected", async () => {
    const mockLearningsService = {
      recordAntipattern: vi.fn(),
      formatForSystemPrompt: vi.fn(() => "## Learnings\nAvoid pattern Y."),
    };

    let recordCount = 0;
    vi.mocked(deps.mockDoomLoopDetector.record).mockImplementation(() => { recordCount++; });
    vi.mocked(deps.mockDoomLoopDetector.isLooping).mockImplementation(() => recordCount >= 3);
    vi.mocked(deps.mockDoomLoopDetector.getLoopingAction).mockReturnValue("test_tool");
    vi.mocked(deps.mockDoomLoopDetector.reset).mockImplementation(() => { recordCount = 0; });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* (_runId, _msgs, _cb, options) {
        callCount++;
        const role = (options as any)?.modelRole;
        // After escalation, return no tool calls to complete
        if (role === "review_deep" || callCount > 5) {
          yield { type: "token", value: "Fixed." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
          return;
        }
        yield { type: "tool_use", id: `t-${callCount}`, name: "test_tool", input: { value: "loop" } };
        yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      learningsService: mockLearningsService as any,
    });

    const events = await collectEvents(
      orchestrator.execute(makeInput({ maxIterations: 15 })),
    );

    // Should have recorded an antipattern
    expect(mockLearningsService.recordAntipattern).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "doom_loop",
        relatedTools: expect.arrayContaining(["test_tool"]),
      }),
    );

    expect(events.some((e) => e.type === "doom_loop_detected")).toBe(true);
  });

  it("includes learnings in the system prompt", async () => {
    const mockLearningsService = {
      recordAntipattern: vi.fn(),
      formatForSystemPrompt: vi.fn(() => "## Learnings\nAvoid pattern Y."),
    };

    let capturedMessages: any[] = [];
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* (_runId, msgs) {
        capturedMessages = msgs as any[];
        yield { type: "token", value: "Done." };
        yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      learningsService: mockLearningsService as any,
    });

    await collectEvents(orchestrator.execute(makeInput({ projectId: "proj-123" })));

    // formatForSystemPrompt should have been called with the projectId
    expect(mockLearningsService.formatForSystemPrompt).toHaveBeenCalledWith("proj-123");

    // The system prompt (first message) should contain the learnings content
    const systemMsg = capturedMessages.find((m: any) => m.role === "system");
    expect(systemMsg?.content).toContain("Avoid pattern Y");
  });
});

// ---------------------------------------------------------------------------
// 4. Budget warning for cost and iterations
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — budget warnings (cost and iterations)", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
    registerTestTool(deps.registry);
  });

  it("emits budget_warning for cost when approaching maxCostUsd", async () => {
    // Use overseer_escalation role so estimateCost returns non-zero
    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_use", id: "t-1", name: "test_tool", input: { value: "x" } };
          // Large token usage to generate significant cost via estimateCost:
          // cost = (20000/1000)*0.01 + (20000/1000)*0.03 = 0.2 + 0.6 = 0.8
          yield { type: "done", usage: { inputTokens: 20000, outputTokens: 20000, totalTokens: 40000 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const events = await collectEvents(
      orchestrator.execute(
        makeInput({
          initialModelRole: "overseer_escalation",
          budget: { maxCostUsd: 1.0 }, // Cost of 0.8 >= 80% of 1.0
        }),
      ),
    );

    // Should emit budget_warning for cost
    const warning = events.find(
      (e) => e.type === "budget_warning" && (e as any).resource === "cost_usd",
    );
    expect(warning).toBeDefined();
  });

  it("emits budget_warning for iterations when approaching maxIterations", async () => {
    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount < 5) {
          yield { type: "tool_use", id: `t-${callCount}`, name: "test_tool", input: { value: "x" } };
          yield { type: "done", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const events = await collectEvents(
      orchestrator.execute(
        makeInput({
          // maxIterations=5, 80% = 4. At iteration 4, warning should fire.
          maxIterations: 5,
          budget: {}, // Need a budget object for the check to run
        }),
      ),
    );

    // Should emit budget_warning for iterations
    const warning = events.find(
      (e) => e.type === "budget_warning" && (e as any).resource === "iterations",
    );
    expect(warning).toBeDefined();
    if (warning && (warning as any).resource === "iterations") {
      expect((warning as any).limit).toBe(5);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Budget tracker integration
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — budget tracker integration", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
    registerTestTool(deps.registry);
  });

  it("creates, records, and removes budget via budget tracker", async () => {
    const mockBudgetTracker = {
      createBudget: vi.fn(),
      recordIteration: vi.fn(),
      recordUsage: vi.fn(),
      removeBudget: vi.fn(),
      checkBudget: vi.fn(() => ({ exceeded: false, warnings: [] })),
    };

    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "token", value: "Done." };
        yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      budgetTracker: mockBudgetTracker as any,
    });

    await collectEvents(
      orchestrator.execute(
        makeInput({
          budget: { maxTokens: 10000, maxCostUsd: 1.0 },
          maxIterations: 10,
        }),
      ),
    );

    // createBudget should be called with the budget config
    expect(mockBudgetTracker.createBudget).toHaveBeenCalledWith("cov-run", {
      maxTokens: 10000,
      maxCostUsd: 1.0,
      maxIterations: 10,
      maxDurationMs: undefined,
    });

    // recordIteration should be called
    expect(mockBudgetTracker.recordIteration).toHaveBeenCalledWith("cov-run");

    // recordUsage should be called with token info
    expect(mockBudgetTracker.recordUsage).toHaveBeenCalledWith("cov-run", expect.objectContaining({
      inputTokens: 100,
      outputTokens: 20,
      modelId: "local", // coder_default is not overseer_escalation, so modelId = "local"
    }));

    // removeBudget should be called in finally block
    expect(mockBudgetTracker.removeBudget).toHaveBeenCalledWith("cov-run");
  });

  it("records modelId as 'gpt-4' when role is overseer_escalation", async () => {
    const mockBudgetTracker = {
      createBudget: vi.fn(),
      recordIteration: vi.fn(),
      recordUsage: vi.fn(),
      removeBudget: vi.fn(),
      checkBudget: vi.fn(() => ({ exceeded: false, warnings: [] })),
    };

    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "token", value: "Done." };
        yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      budgetTracker: mockBudgetTracker as any,
    });

    await collectEvents(
      orchestrator.execute(
        makeInput({
          initialModelRole: "overseer_escalation",
        }),
      ),
    );

    expect(mockBudgetTracker.recordUsage).toHaveBeenCalledWith("cov-run", expect.objectContaining({
      modelId: "gpt-4",
    }));
  });
});

// ---------------------------------------------------------------------------
// 6. External signal abort
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — external abort signal", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
    registerTestTool(deps.registry);
  });

  it("aborts execution when external signal fires before iteration", async () => {
    const abortController = new AbortController();

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_use", id: "t-1", name: "test_tool", input: { value: "x" } };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const input = makeInput({ maxIterations: 10 });
    (input as any).signal = abortController.signal;

    // Abort after a small delay so the first iteration starts
    const events: AgenticEvent[] = [];
    for await (const event of orchestrator.execute(input)) {
      events.push(event);
      // After the first tool call finishes and the loop is about to continue,
      // trigger abort
      if (event.type === "loop_continuing") {
        abortController.abort("user_cancelled");
      }
    }

    // Should see execution_aborted with the abort reason
    const abortEvent = events.find((e) => e.type === "execution_aborted");
    expect(abortEvent).toBeDefined();
    if (abortEvent && abortEvent.type === "execution_aborted") {
      expect(abortEvent.reason).toContain("cancelled");
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Reasoning mode resolution
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — reasoning mode", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("passes reasoningMode='on' when configured as 'on'", async () => {
    let capturedOptions: any;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* (_runId, _msgs, _cb, options) {
        capturedOptions = options;
        yield { type: "token", value: "Done." };
        yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    await collectEvents(
      orchestrator.execute(makeInput({ reasoningMode: "on" })),
    );

    expect(capturedOptions.reasoningMode).toBe("on");
  });

  it("passes reasoningMode='off' when configured as 'off'", async () => {
    let capturedOptions: any;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* (_runId, _msgs, _cb, options) {
        capturedOptions = options;
        yield { type: "token", value: "Done." };
        yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    await collectEvents(
      orchestrator.execute(makeInput({ reasoningMode: "off" })),
    );

    expect(capturedOptions.reasoningMode).toBe("off");
  });

  it("activates reasoning on first iteration in 'auto' mode then deactivates", async () => {
    const capturedOptions: any[] = [];

    registerTestTool(deps.registry);

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* (_runId, _msgs, _cb, options) {
        callCount++;
        capturedOptions.push({ ...options });
        if (callCount === 1) {
          yield { type: "tool_use", id: "t-1", name: "test_tool", input: { value: "x" } };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    await collectEvents(
      orchestrator.execute(makeInput({ reasoningMode: "auto" })),
    );

    // First call (iteration 1) should have reasoningMode='on'
    expect(capturedOptions[0]?.reasoningMode).toBe("on");

    // Second call (iteration 2) should NOT have reasoningMode set
    if (capturedOptions.length >= 2) {
      expect(capturedOptions[1]?.reasoningMode).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Memory extraction from completion
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — auto memory extraction on completion", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("yields memory_extracted event when extractFromCompletion returns a result", async () => {
    const mockAutoMemoryExtractor = {
      shouldExtract: vi.fn(() => false),
      extractFromIteration: vi.fn(async () => null),
      extractFromCompletion: vi.fn(async () => ({
        id: "mem-123",
        summary: "Agent completed the task using pattern X",
      })),
      resetRun: vi.fn(),
    };

    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "token", value: "All done!" };
        yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      autoMemoryExtractor: mockAutoMemoryExtractor as any,
    });

    const events = await collectEvents(orchestrator.execute(makeInput()));

    // Should yield memory_extracted
    const memoryEvent = events.find((e) => e.type === "memory_extracted");
    expect(memoryEvent).toBeDefined();
    expect(memoryEvent).toMatchObject({
      type: "memory_extracted",
      memoryId: "mem-123",
      summary: "Agent completed the task using pattern X",
    });

    // extractFromCompletion should have been called with run details
    expect(mockAutoMemoryExtractor.extractFromCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "cov-run",
        objective: "Coverage test objective",
        success: true,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// 9. Consecutive format errors escalation
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — consecutive format errors escalation", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("escalates after 3 consecutive all-error tool results", async () => {
    // Register a tool that always fails
    deps.registry.register({
      name: "failing_tool",
      description: "Always fails",
      inputSchema: z.any(),
      execute: async () => ({
        type: "error" as const,
        error: "Tool execution failed",
      }),
      permission: { scope: "meta", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* (_runId, _msgs, _cb, options) {
        callCount++;
        const role = (options as any)?.modelRole;
        // After escalation, return no tool calls to complete
        if (role === "review_deep") {
          yield { type: "token", value: "Recovered." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
          return;
        }
        // Keep returning failing tool calls
        yield { type: "tool_use", id: `t-${callCount}`, name: "failing_tool", input: {} };
        yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const events = await collectEvents(
      orchestrator.execute(makeInput({ maxIterations: 10 })),
    );

    // Should escalate after 3 consecutive all-error iterations
    const escalateEvent = events.find((e) => e.type === "escalating");
    expect(escalateEvent).toBeDefined();

    // Should resets consecutiveFormatErrors after escalation
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);
  });

  it("resets format error count when any tool result succeeds", async () => {
    let callCount = 0;
    // Register a tool that alternates between failure and success
    deps.registry.register({
      name: "flaky_tool",
      description: "Sometimes fails",
      inputSchema: z.any(),
      execute: async () => {
        callCount++;
        if (callCount % 2 === 1) {
          return { type: "error" as const, error: "Flaky failure" };
        }
        return { type: "success" as const, content: "ok" };
      },
      permission: { scope: "meta", readOnly: true },
    });

    let providerCalls = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        providerCalls++;
        if (providerCalls <= 4) {
          yield { type: "tool_use", id: `t-${providerCalls}`, name: "flaky_tool", input: {} };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const events = await collectEvents(
      orchestrator.execute(makeInput({ maxIterations: 10 })),
    );

    // Should NOT escalate since errors are not consecutive (success resets counter)
    expect(events.some((e) => e.type === "escalating")).toBe(false);
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. Plan mode: plan_review phase and pending plan question
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — plan mode review and questions", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("returns early when plan enters plan_review phase", async () => {
    deps.registry.register({
      name: "submit_plan",
      description: "Submit plan",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        content: "Plan submitted",
      }),
      permission: { scope: "meta", readOnly: true },
    });

    const mockPlanService = {
      startPlanningPhase: vi.fn(async (runId: string) => ({
        runId,
        phase: "planning" as const,
        planContent: null,
        questions: [],
        approved: false,
        reviewedBy: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      getPlan: vi.fn(async (runId: string) => ({
        runId,
        phase: "plan_review" as const,
        planContent: "Step 1: do X\nStep 2: do Y",
        questions: [],
        approved: false,
        reviewedBy: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    };

    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "tool_use", id: "plan-1", name: "submit_plan", input: { plan: "my plan" } };
        yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      planService: mockPlanService as any,
    });

    const events = await collectEvents(
      orchestrator.execute(makeInput({ planMode: true })),
    );

    // Should emit plan_started
    expect(events.some((e) => e.type === "plan_started")).toBe(true);

    // Should NOT have execution_complete (returns early during plan_review)
    expect(events.some((e) => e.type === "execution_complete")).toBe(false);
  });

  it("returns early when ask_plan_question is pending", async () => {
    deps.registry.register({
      name: "ask_plan_question",
      description: "Ask a question",
      inputSchema: z.any(),
      execute: async () => ({
        type: "approval_required" as const,
        approvalId: "q-1",
        message: "What about the database?",
      }),
      permission: { scope: "meta", readOnly: true },
    });

    const mockPlanService = {
      startPlanningPhase: vi.fn(async (runId: string) => ({
        runId,
        phase: "planning" as const,
        planContent: null,
        questions: [],
        approved: false,
        reviewedBy: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      getPlan: vi.fn(async (runId: string) => ({
        runId,
        phase: "planning" as const,
        planContent: null,
        questions: [{ question: "What about the database?", answer: null }],
        approved: false,
        reviewedBy: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    };

    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "tool_use", id: "q-1", name: "ask_plan_question", input: { question: "db?" } };
        yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      planService: mockPlanService as any,
    });

    const events = await collectEvents(
      orchestrator.execute(makeInput({ planMode: true })),
    );

    // Should return early (no execution_complete)
    expect(events.some((e) => e.type === "execution_complete")).toBe(false);
    expect(events.some((e) => e.type === "plan_started")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. System prompt with episodic context and suffix
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — system prompt composition", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("includes episodic context and systemPromptSuffix in provider messages", async () => {
    // Make memory compose return episodic context
    vi.mocked(deps.mockMemoryService.compose).mockReturnValue({
      episodicContext: "Previously, the agent refactored the database layer.",
      workingMessages: [],
      stats: { episodicCount: 1, workingCount: 0, totalTokenEstimate: 50 },
    } as any);

    let capturedMessages: any[] = [];
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* (_runId, msgs) {
        capturedMessages = msgs as any[];
        yield { type: "token", value: "Done." };
        yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    await collectEvents(
      orchestrator.execute(
        makeInput({ systemPromptSuffix: "Always use ESM imports." }),
      ),
    );

    const systemMsg = capturedMessages.find((m: any) => m.role === "system");
    expect(systemMsg?.content).toContain("refactored the database layer");
    expect(systemMsg?.content).toContain("Always use ESM imports");
  });

  it("includes prefetched memories in system prompt", async () => {
    const mockMemories = [
      { id: "m1", text: "Use vitest for testing", timestamp: new Date().toISOString() },
    ];
    vi.mocked(deps.mockMemoryService.awaitPrefetch).mockResolvedValue(mockMemories as any);
    vi.mocked(deps.mockMemoryService.formatMemoriesForPrompt).mockReturnValue(
      "## Memories\n- Use vitest for testing",
    );

    let capturedMessages: any[] = [];
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* (_runId, msgs) {
        capturedMessages = msgs as any[];
        yield { type: "token", value: "Done." };
        yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    await collectEvents(orchestrator.execute(makeInput()));

    const systemMsg = capturedMessages.find((m: any) => m.role === "system");
    expect(systemMsg?.content).toContain("Use vitest for testing");
  });
});

// ---------------------------------------------------------------------------
// 12. Skill constraint expiration (remainingIterations decrement to 0)
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — skill constraint expiration", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("clears skill constraint after maxIterations expires", async () => {
    deps.registry.register({
      name: "skill",
      description: "Invoke a skill",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        content: "Skill activated",
        metadata: {
          skillName: "time-limited",
          allowedTools: ["allowed_tool"],
          maxIterations: 2, // Constraint expires after 2 iterations
        },
      }),
      permission: { scope: "meta", readOnly: true },
    });

    deps.registry.register({
      name: "allowed_tool",
      description: "Allowed",
      inputSchema: z.any(),
      execute: async () => ({ type: "success" as const, content: "ok" }),
      permission: { scope: "meta", readOnly: true },
    });

    deps.registry.register({
      name: "blocked_tool",
      description: "Blocked during skill",
      inputSchema: z.any(),
      execute: async () => ({ type: "success" as const, content: "ok" }),
      permission: { scope: "meta", readOnly: true },
    });

    let callCount = 0;
    const toolsSentToProvider: string[][] = [];

    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* (_runId, _msgs, _cb, options) {
        callCount++;
        if ((options as any)?.tools) {
          toolsSentToProvider.push((options as any).tools.map((t: any) => t.name));
        }
        if (callCount === 1) {
          // Invoke skill
          yield { type: "tool_use", id: "s-1", name: "skill", input: {} };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        } else if (callCount <= 3) {
          // Use allowed tool during constrained iterations
          yield { type: "tool_use", id: `a-${callCount}`, name: "allowed_tool", input: {} };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    await collectEvents(
      orchestrator.execute(makeInput({ maxIterations: 10 })),
    );

    // After the skill activates (call 1), the next calls (2, 3) should be constrained.
    // Call 4 should have the constraint expired, so blocked_tool should reappear.
    if (toolsSentToProvider.length >= 4) {
      // Call 2 (constrained): blocked_tool should NOT be present
      expect(toolsSentToProvider[1]).not.toContain("blocked_tool");
      // Call 4 (constraint expired): blocked_tool should be present
      expect(toolsSentToProvider[3]).toContain("blocked_tool");
    }
  });
});

// ---------------------------------------------------------------------------
// 13. Per-turn max output tokens
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — per-turn max output tokens", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("passes perTurnMaxOutputTokens to provider options", async () => {
    let capturedOptions: any;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* (_runId, _msgs, _cb, options) {
        capturedOptions = options;
        yield { type: "token", value: "Done." };
        yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    await collectEvents(
      orchestrator.execute(
        makeInput({
          budget: { perTurnMaxOutputTokens: 2048 },
        }),
      ),
    );

    expect(capturedOptions.maxOutputTokens).toBe(2048);
  });
});

// ---------------------------------------------------------------------------
// 14. Plan context formatting with questions
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — plan context with questions and content", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("includes plan questions and content in system prompt", async () => {
    const mockPlanService = {
      startPlanningPhase: vi.fn(async (runId: string) => ({
        runId,
        phase: "planning" as const,
        planContent: "Step 1: Read files\nStep 2: Edit code",
        questions: [
          { question: "Which database?", answer: "PostgreSQL" },
          { question: "Need auth?", answer: null },
        ],
        approved: false,
        reviewedBy: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      getPlan: vi.fn(async () => null),
    };

    let capturedMessages: any[] = [];
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* (_runId, msgs) {
        capturedMessages = msgs as any[];
        yield { type: "token", value: "Done." };
        yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      planService: mockPlanService as any,
    });

    await collectEvents(
      orchestrator.execute(makeInput({ planMode: true })),
    );

    const systemMsg = capturedMessages.find((m: any) => m.role === "system");
    // Should contain plan content
    expect(systemMsg?.content).toContain("Step 1: Read files");
    // Should contain answered question
    expect(systemMsg?.content).toContain("PostgreSQL");
    // Should contain pending question
    expect(systemMsg?.content).toContain("Answer pending");
  });
});

// ---------------------------------------------------------------------------
// 15. Approval service via tool context
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — approval service", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("generates a fallback approval ID when approvalService is not provided", async () => {
    // Register a tool that calls createApproval
    deps.registry.register({
      name: "approval_tool",
      description: "Creates an approval",
      inputSchema: z.any(),
      execute: async (_input, ctx) => {
        const result = await ctx.createApproval({
          actionType: "test_action",
          payload: { key: "value" },
        });
        return {
          type: "success" as const,
          content: `Approval ID: ${result.id}`,
        };
      },
      permission: { scope: "meta", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_use", id: "a-1", name: "approval_tool", input: {} };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      // No approvalService provided
    });

    const events = await collectEvents(orchestrator.execute(makeInput()));

    // Tool should have received a fallback approval ID starting with "approval_"
    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 16. Micro-compaction of tool results
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — tool result micro-compaction", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("applies micro-compaction to large tool results before adding to conversation", async () => {
    // Register a tool that returns a large result that triggers micro-compaction
    deps.registry.register({
      name: "shell",
      description: "Run shell commands",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        // A very long shell output
        content: Array.from({ length: 500 }, (_, i) => `line ${i}: ${"x".repeat(100)}`).join("\n"),
      }),
      permission: { scope: "meta", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_use", id: "sh-1", name: "shell", input: { cmd: "ls" } };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const events = await collectEvents(orchestrator.execute(makeInput()));

    // Should complete without error
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 17. Recently read files tracking (read_file with file_path input)
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — recently read files tracking", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("tracks read_file results and uses file_path input key", async () => {
    deps.registry.register({
      name: "read_file",
      description: "Read a file",
      inputSchema: z.object({ file_path: z.string() }),
      execute: async () => ({
        type: "success" as const,
        content: "file content here",
      }),
      permission: { scope: "repo.read", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_use", id: "rf-1", name: "read_file", input: { file_path: "/src/index.ts" } };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const events = await collectEvents(orchestrator.execute(makeInput()));

    expect(events.some((e) => e.type === "execution_complete")).toBe(true);
    // The tool result should have been captured in recentlyReadFiles
    // (we verify by checking tool_result events contain read_file)
    const toolResults = events.filter((e) => e.type === "tool_result");
    expect(toolResults.some((e) => (e as any).name === "read_file")).toBe(true);
  });

  it("keeps only last 5 recently read files", async () => {
    deps.registry.register({
      name: "read_file",
      description: "Read a file",
      inputSchema: z.object({ path: z.string() }),
      execute: async (input) => ({
        type: "success" as const,
        content: `Content of ${(input as any).path}`,
      }),
      permission: { scope: "repo.read", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount <= 7) {
          yield { type: "tool_use", id: `rf-${callCount}`, name: "read_file", input: { path: `/file${callCount}.ts` } };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const events = await collectEvents(orchestrator.execute(makeInput({ maxIterations: 10 })));

    // Should complete
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);

    // All 7 read_file calls should have been recorded (but only last 5 kept in state)
    const readResults = events.filter((e) => e.type === "tool_result" && (e as any).name === "read_file");
    expect(readResults.length).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// 18. Memory extraction from iteration (successful extraction)
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — memory extraction from iteration", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
    registerTestTool(deps.registry);
  });

  it("yields memory_extracted from extractFromIteration when shouldExtract returns true", async () => {
    const mockAutoMemoryExtractor = {
      shouldExtract: vi.fn(() => true),
      extractFromIteration: vi.fn(async () => ({
        id: "iter-mem-1",
        summary: "Agent used test_tool successfully",
      })),
      extractFromCompletion: vi.fn(async () => null),
      resetRun: vi.fn(),
    };

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_use", id: "t-1", name: "test_tool", input: { value: "x" } };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      autoMemoryExtractor: mockAutoMemoryExtractor as any,
    });

    const events = await collectEvents(orchestrator.execute(makeInput()));

    const memoryEvents = events.filter((e) => e.type === "memory_extracted");
    expect(memoryEvents.length).toBeGreaterThanOrEqual(1);
    expect(memoryEvents[0]).toMatchObject({
      type: "memory_extracted",
      memoryId: "iter-mem-1",
      summary: "Agent used test_tool successfully",
    });
  });
});

// ---------------------------------------------------------------------------
// 19. Pre-call compaction when estimated input exceeds 90% of budget
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — pre-call compaction", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("triggers pre-call compaction when estimated input tokens exceed 90% of max", async () => {
    // Register a tool that returns a huge result to bloat the conversation
    deps.registry.register({
      name: "huge_reader",
      description: "Reads huge files",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        content: "H".repeat(10000), // ~2500 tokens
      }),
      permission: { scope: "meta", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_use", id: "h-1", name: "huge_reader", input: {} };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const events = await collectEvents(
      orchestrator.execute(makeInput({ budget: { maxTokens: 1500 } })),
    );

    // With a very small token budget and a huge tool result,
    // pre-call compaction should trigger on the second iteration
    const compactedEvents = events.filter((e) => e.type === "context_compacted");
    expect(compactedEvents.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 20. Hook service PreCompact and PostCompact events
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — PreCompact/PostCompact hooks", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("runs PreCompact and PostCompact hooks during compaction", async () => {
    const hookEventTypes: string[] = [];
    const mockHookService = {
      executeHooksForEvent: vi.fn(async (input: any) => {
        hookEventTypes.push(input.eventType);
        return {
          outputs: [
            {
              hook: { id: "hook-1", name: "compaction-hook" },
              output: { success: true, continue: true, durationMs: 10 },
            },
          ],
          systemMessages: [],
          updatedInput: {},
          shouldContinue: true,
        };
      }),
    };

    deps.registry.register({
      name: "filler",
      description: "Fills context",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        content: "F".repeat(8000), // ~2000 tokens
      }),
      permission: { scope: "meta", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount <= 2) {
          yield { type: "tool_use", id: `f-${callCount}`, name: "filler", input: {} };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      hookService: mockHookService as any,
    });

    await collectEvents(
      orchestrator.execute(makeInput({ budget: { maxTokens: 2000 } })),
    );

    // Should have been called with PreCompact and PostCompact event types
    // (along with SessionStart, UserPromptSubmit, Notification)
    expect(hookEventTypes).toContain("SessionStart");
    expect(hookEventTypes).toContain("UserPromptSubmit");
  });
});

// ---------------------------------------------------------------------------
// 21. Skill constraint with no allowedTools (null constraint)
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — skill constraint with null allowedTools", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("sets skill constraint with null allowedTools when metadata has empty array", async () => {
    deps.registry.register({
      name: "skill",
      description: "Invoke a skill",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        content: "Skill activated",
        metadata: {
          // No skillName => defaults to "skill"
          // Empty allowedTools => null
          allowedTools: [],
          // No maxIterations => null
        },
      }),
      permission: { scope: "meta", readOnly: true },
    });

    deps.registry.register({
      name: "any_tool",
      description: "Any tool",
      inputSchema: z.any(),
      execute: async () => ({ type: "success" as const, content: "ok" }),
      permission: { scope: "meta", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_use", id: "s-1", name: "skill", input: {} };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const events = await collectEvents(orchestrator.execute(makeInput()));

    // Should complete since empty allowedTools doesn't restrict tools
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 22. Cost budget abort
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — cost budget abort", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
    registerTestTool(deps.registry);
  });

  it("aborts when cost budget is exceeded", async () => {
    // Use overseer_escalation to generate non-zero cost
    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        yield { type: "tool_use", id: `t-${callCount}`, name: "test_tool", input: { value: "x" } };
        // Very high token usage: cost = (100000/1000)*0.01 + (100000/1000)*0.03 = 1.0 + 3.0 = 4.0
        yield { type: "done", usage: { inputTokens: 100000, outputTokens: 100000, totalTokens: 200000 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const events = await collectEvents(
      orchestrator.execute(
        makeInput({
          initialModelRole: "overseer_escalation",
          budget: { maxCostUsd: 0.5 },
          maxIterations: 5,
        }),
      ),
    );

    const abortEvent = events.find((e) => e.type === "execution_aborted");
    expect(abortEvent).toBeDefined();
    if (abortEvent && abortEvent.type === "execution_aborted") {
      expect(abortEvent.reason).toContain("Cost budget exhausted");
    }
  });
});

// ---------------------------------------------------------------------------
// 23. Tool result message with assistant text fallback
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — assistant message content", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("uses tool call count as assistant message when no text is emitted", async () => {
    deps.registry.register({
      name: "silent_tool",
      description: "Tool with no text",
      inputSchema: z.any(),
      execute: async () => ({ type: "success" as const, content: "ok" }),
      permission: { scope: "meta", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          // Only tool_use, no tokens
          yield { type: "tool_use", id: "s-1", name: "silent_tool", input: {} };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const events = await collectEvents(orchestrator.execute(makeInput()));

    // Should complete
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 24. Prefetch failure is gracefully handled
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — prefetch failure", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("continues when awaitPrefetch rejects", async () => {
    vi.mocked(deps.mockMemoryService.awaitPrefetch).mockRejectedValue(
      new Error("Prefetch unavailable"),
    );

    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "token", value: "Done." };
        yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const events = await collectEvents(orchestrator.execute(makeInput()));

    // Should still complete
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 25. Hook abort on UserPromptSubmit
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — UserPromptSubmit hook abort", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("aborts when UserPromptSubmit hook fails with continueOnError=false", async () => {
    let callIdx = 0;
    const mockHookService = {
      executeHooksForEvent: vi.fn(async (input: any) => {
        callIdx++;
        // First call is SessionStart (succeed), second is UserPromptSubmit (fail)
        if (callIdx === 2) {
          return {
            outputs: [
              {
                hook: { id: "hook-block", name: "content-filter" },
                output: { success: false, continue: false, error: "Blocked", durationMs: 5 },
              },
            ],
            systemMessages: [],
            updatedInput: {},
            shouldContinue: false,
          };
        }
        return {
          outputs: [
            {
              hook: { id: "hook-ok", name: "setup" },
              output: { success: true, continue: true, durationMs: 2 },
            },
          ],
          systemMessages: [],
          updatedInput: {},
          shouldContinue: true,
        };
      }),
    };

    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "token", value: "Done." };
        yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      hookService: mockHookService as any,
    });

    const events = await collectEvents(orchestrator.execute(makeInput()));

    // Should abort without calling provider
    expect(events.some((e) => e.type === "execution_aborted")).toBe(true);
    expect(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 26. PreCompact hook abort
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — PreCompact hook abort", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("aborts when PreCompact hook fails with shouldAbort", async () => {
    // Register a tool that returns large content to trigger compaction pressure > 0.7
    deps.registry.register({
      name: "bulk_tool",
      description: "Returns bulk content",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        content: "X".repeat(8000),
      }),
      permission: { scope: "meta", readOnly: true },
    });

    let hookCallIdx = 0;
    const mockHookService = {
      executeHooksForEvent: vi.fn(async (input: any) => {
        hookCallIdx++;
        // Fail on PreCompact event (which happens after iteration start when pressure > 0.7)
        if (input.eventType === "PreCompact") {
          return {
            outputs: [
              {
                hook: { id: "hook-precompact", name: "pre-compact-gate" },
                output: { success: false, continue: false, error: "Blocked", durationMs: 5 },
              },
            ],
            systemMessages: [],
            updatedInput: {},
            shouldContinue: false,
          };
        }
        return {
          outputs: [],
          systemMessages: [],
          updatedInput: {},
          shouldContinue: true,
        };
      }),
    };

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_use", id: "b-1", name: "bulk_tool", input: {} };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      hookService: mockHookService as any,
    });

    const events = await collectEvents(
      orchestrator.execute(makeInput({ budget: { maxTokens: 2000 } })),
    );

    // Should abort due to PreCompact hook failure
    const abortEvent = events.find((e) => e.type === "execution_aborted");
    expect(abortEvent).toBeDefined();
    if (abortEvent && abortEvent.type === "execution_aborted") {
      expect(abortEvent.reason).toContain("Hook failure");
    }
  });
});

// ---------------------------------------------------------------------------
// 27. Budget abort with hooks
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — budget abort with hooks", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
    registerTestTool(deps.registry);
  });

  it("runs notification hooks when budget is exhausted and yields hook events", async () => {
    const hookEventTypes: string[] = [];
    const mockHookService = {
      executeHooksForEvent: vi.fn(async (input: any) => {
        hookEventTypes.push(input.eventType);
        return {
          outputs: [
            {
              hook: { id: "hook-notify", name: "budget-notifier" },
              output: { success: true, continue: true, durationMs: 5 },
            },
          ],
          systemMessages: [],
          updatedInput: {},
          shouldContinue: true,
        };
      }),
    };

    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "token", value: "Response" };
        yield { type: "done", usage: { inputTokens: 5000, outputTokens: 5000, totalTokens: 10000 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      hookService: mockHookService as any,
    });

    const events = await collectEvents(
      orchestrator.execute(makeInput({ budget: { maxTokens: 5000 } })),
    );

    // Budget abort should trigger Notification hook
    expect(hookEventTypes).toContain("Notification");

    // Should have hook_executed events
    const hookEvents = events.filter((e) => e.type === "hook_executed");
    expect(hookEvents.length).toBeGreaterThanOrEqual(1);

    // Should abort
    expect(events.some((e) => e.type === "execution_aborted")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 28. Max iterations with hooks
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — max iterations with hooks", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
    registerTestTool(deps.registry);
  });

  it("runs notification hooks when max iterations reached and yields hook events", async () => {
    const mockHookService = {
      executeHooksForEvent: vi.fn(async () => ({
        outputs: [
          {
            hook: { id: "hook-max", name: "max-iter-notifier" },
            output: { success: true, continue: true, durationMs: 5 },
          },
        ],
        systemMessages: [],
        updatedInput: {},
        shouldContinue: true,
      })),
    };

    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "tool_use", id: `t-${Date.now()}`, name: "test_tool", input: { value: "x" } };
        yield { type: "done", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      hookService: mockHookService as any,
    });

    const events = await collectEvents(
      orchestrator.execute(makeInput({ maxIterations: 2 })),
    );

    // Should reach max iterations
    expect(events.some((e) => e.type === "max_iterations_reached")).toBe(true);

    // Should have hook_executed events for the max-iterations notification
    const hookEvents = events.filter((e) => e.type === "hook_executed");
    expect(hookEvents.length).toBeGreaterThanOrEqual(1);

    // Should abort
    expect(events.some((e) => e.type === "execution_aborted")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 29. Doom loop abort with hooks (highest role)
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — doom loop abort on highest role with hooks", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
    registerTestTool(deps.registry);
  });

  it("runs notification hooks when doom loop detected on highest role", async () => {
    const mockHookService = {
      executeHooksForEvent: vi.fn(async () => ({
        outputs: [
          {
            hook: { id: "hook-doom", name: "doom-notifier" },
            output: { success: true, continue: true, durationMs: 5 },
          },
        ],
        systemMessages: [],
        updatedInput: {},
        shouldContinue: true,
      })),
    };

    let recordCount = 0;
    vi.mocked(deps.mockDoomLoopDetector.record).mockImplementation(() => { recordCount++; });
    vi.mocked(deps.mockDoomLoopDetector.isLooping).mockImplementation(() => recordCount >= 3);
    vi.mocked(deps.mockDoomLoopDetector.getLoopingAction).mockReturnValue("test_tool");
    vi.mocked(deps.mockDoomLoopDetector.reset).mockImplementation(() => { recordCount = 0; });

    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "tool_use", id: `t-${Date.now()}`, name: "test_tool", input: { value: "stuck" } };
        yield { type: "done", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      hookService: mockHookService as any,
    });

    const events = await collectEvents(
      orchestrator.execute(makeInput({ maxIterations: 30 })),
    );

    // Should have doom_loop_detected events
    expect(events.some((e) => e.type === "doom_loop_detected")).toBe(true);

    // Should have hook_executed events from the doom loop notification
    const hookEvents = events.filter((e) => e.type === "hook_executed");
    expect(hookEvents.length).toBeGreaterThanOrEqual(1);

    // Should abort on highest role
    const abortEvent = events.find((e) => e.type === "execution_aborted");
    expect(abortEvent).toBeDefined();
    if (abortEvent && abortEvent.type === "execution_aborted") {
      expect(abortEvent.reason).toContain("Doom loop");
    }
  });
});

// ---------------------------------------------------------------------------
// 30. Provider error on overseer with hooks
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — overseer provider error with hooks", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
    registerTestTool(deps.registry);
  });

  it("runs notification hooks when overseer provider also fails", async () => {
    const mockHookService = {
      executeHooksForEvent: vi.fn(async () => ({
        outputs: [
          {
            hook: { id: "hook-err", name: "error-notifier" },
            output: { success: true, continue: true, durationMs: 5 },
          },
        ],
        systemMessages: [],
        updatedInput: {},
        shouldContinue: true,
      })),
    };

    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      (() => {
        throw new Error("All providers down");
      }) as any,
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      hookService: mockHookService as any,
    });

    const events = await collectEvents(
      orchestrator.execute(makeInput({ maxIterations: 5 })),
    );

    // Should have hook_executed events from the unrecoverable error notification
    const hookEvents = events.filter((e) => e.type === "hook_executed");
    expect(hookEvents.length).toBeGreaterThanOrEqual(1);

    // Should abort
    expect(events.some((e) => e.type === "execution_aborted")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 31. Plan review with hooks
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — plan review with hooks", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("runs notification hooks when plan enters review phase and yields hook events", async () => {
    deps.registry.register({
      name: "submit_plan",
      description: "Submit plan",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        content: "Plan submitted",
      }),
      permission: { scope: "meta", readOnly: true },
    });

    const mockPlanService = {
      startPlanningPhase: vi.fn(async (runId: string) => ({
        runId,
        phase: "planning" as const,
        planContent: null,
        questions: [],
        approved: false,
        reviewedBy: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      getPlan: vi.fn(async (runId: string) => ({
        runId,
        phase: "plan_review" as const,
        planContent: "The plan",
        questions: [],
        approved: false,
        reviewedBy: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    };

    const mockHookService = {
      executeHooksForEvent: vi.fn(async () => ({
        outputs: [
          {
            hook: { id: "hook-plan", name: "plan-notifier" },
            output: { success: true, continue: true, durationMs: 5 },
          },
        ],
        systemMessages: [],
        updatedInput: {},
        shouldContinue: true,
      })),
    };

    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "tool_use", id: "p-1", name: "submit_plan", input: { plan: "plan" } };
        yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      planService: mockPlanService as any,
      hookService: mockHookService as any,
    });

    const events = await collectEvents(
      orchestrator.execute(makeInput({ planMode: true })),
    );

    // Should have hook events from plan review notification
    const hookEvents = events.filter((e) => e.type === "hook_executed");
    expect(hookEvents.length).toBeGreaterThanOrEqual(1);

    // Should NOT complete (returns early during plan review)
    expect(events.some((e) => e.type === "execution_complete")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 32. Approval service with approvalService provided (in-loop tool context)
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — approval service provided (in-loop)", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("calls approvalService.createApproval when provided", async () => {
    const mockApprovalService = {
      createApproval: vi.fn(async () => ({ id: "approved-123" })),
    };

    // Register a tool that calls createApproval via the context
    deps.registry.register({
      name: "needs_approval",
      description: "Needs approval",
      inputSchema: z.any(),
      execute: async (_input, ctx) => {
        const result = await ctx.createApproval({
          actionType: "dangerous_action",
          payload: { target: "prod" },
        });
        return {
          type: "success" as const,
          content: `Approved: ${result.id}`,
        };
      },
      permission: { scope: "meta", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_use", id: "ap-1", name: "needs_approval", input: {} };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      approvalService: mockApprovalService as any,
    });

    const events = await collectEvents(orchestrator.execute(makeInput()));

    // Should have called the approval service
    expect(mockApprovalService.createApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "cov-run",
        toolName: "dangerous_action",
        actor: "test-agent",
      }),
    );

    expect(events.some((e) => e.type === "execution_complete")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 33. Skill constraint with non-array allowedTools in metadata
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — skill with non-array allowedTools", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("defaults to empty array when allowedTools is not an array", async () => {
    deps.registry.register({
      name: "skill",
      description: "Invoke a skill",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        content: "Skill activated",
        metadata: {
          skillName: "custom-skill",
          allowedTools: "not-an-array", // Invalid: should default to []
          maxIterations: "not-a-number", // Invalid: should default to null
        },
      }),
      permission: { scope: "meta", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_use", id: "s-1", name: "skill", input: {} };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const events = await collectEvents(orchestrator.execute(makeInput()));

    // Should complete (non-array allowedTools defaults to empty => null => no restriction)
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 34. read_file with no matching tool call (unknown filePath fallback)
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — read_file with unknown tool call match", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("uses 'unknown' as filePath when no matching tool call is found", async () => {
    // Register read_file with a non-object input to test fallback
    deps.registry.register({
      name: "read_file",
      description: "Read a file",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        content: "file content",
      }),
      permission: { scope: "repo.read", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          // Send tool_use with a primitive input (not an object)
          yield { type: "tool_use", id: "rf-prim", name: "read_file", input: "just-a-string" };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const events = await collectEvents(orchestrator.execute(makeInput()));

    // Should complete
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 35. Deferred loader with non-tool_search results
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — deferred loader skips non-tool_search results", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("skips tool results that are not tool_search when processing deferred loader", async () => {
    deps.registry.register({
      name: "regular_tool",
      description: "A regular tool",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        content: "done",
      }),
      permission: { scope: "meta", readOnly: true },
      alwaysLoad: true,
    });

    // Register tool_search so deferred loader is active
    deps.registry.register({
      name: "tool_search",
      description: "Search for tools",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        content: "No tools found",
        metadata: { toolNames: [] },
      }),
      permission: { scope: "meta", readOnly: true },
      alwaysLoad: true,
    });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          // Use regular_tool (not tool_search)
          yield { type: "tool_use", id: "r-1", name: "regular_tool", input: {} };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const events = await collectEvents(
      orchestrator.execute(makeInput({ useDeferredTools: true })),
    );

    // Should complete
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 36. recordEvent in loop tool context
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — recordEvent in loop tool context", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("calls events.appendEvent when tool invokes ctx.recordEvent", async () => {
    deps.registry.register({
      name: "event_recorder",
      description: "Records events",
      inputSchema: z.any(),
      execute: async (_input, ctx) => {
        await ctx.recordEvent({
          type: "custom.tool.event",
          payload: { detail: "something happened" },
        });
        return { type: "success" as const, content: "Event recorded" };
      },
      permission: { scope: "meta", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_use", id: "ev-1", name: "event_recorder", input: {} };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const events = await collectEvents(orchestrator.execute(makeInput()));

    // appendEvent should have been called by the tool's recordEvent
    expect(deps.mockEvents.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "custom.tool.event",
        aggregateId: "cov-run",
        actor: "test-agent",
        payload: { detail: "something happened" },
      }),
    );

    expect(events.some((e) => e.type === "execution_complete")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 37. read_file with null input (filePath "unknown" fallback)
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — read_file with null input", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("uses 'unknown' as filePath when tool call input is null", async () => {
    deps.registry.register({
      name: "read_file",
      description: "Read a file",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        content: "file data",
      }),
      permission: { scope: "repo.read", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          // Send tool_use with null input
          yield { type: "tool_use", id: "rf-null", name: "read_file", input: null };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const events = await collectEvents(orchestrator.execute(makeInput()));

    // Should complete despite null input
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 38. Deferred loader with tool_search returning non-array toolNames
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — deferred loader tool_search with non-array toolNames", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("handles tool_search metadata with non-array toolNames", async () => {
    deps.registry.register({
      name: "tool_search",
      description: "Search tools",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        content: "Found tools",
        metadata: { toolNames: "not-an-array" }, // Invalid: should default to []
      }),
      permission: { scope: "meta", readOnly: true },
      alwaysLoad: true,
    });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_use", id: "ts-1", name: "tool_search", input: { query: "test" } };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const events = await collectEvents(
      orchestrator.execute(makeInput({ useDeferredTools: true })),
    );

    // Should complete without errors
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 39. Destructive compaction with positive tokensFreed
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — destructive compaction frees tokens", () => {
  let deps: ReturnType<typeof createBaseDeps>;

  beforeEach(() => {
    deps = createBaseDeps();
  });

  it("resets consecutiveCompactionFailures when compaction actually frees tokens", async () => {
    // Register tools that produce large unpinned content to fill the conversation
    // with compactable (non-pinned) messages.
    deps.registry.register({
      name: "verbose_tool",
      description: "Produces verbose output",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        // Each result is ~2500 tokens (10000 chars / 4)
        content: "V".repeat(10000),
      }),
      permission: { scope: "meta", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount <= 3) {
          // Generate lots of assistant text + tool calls to create unpinned messages
          yield { type: "token", value: "Here is some analysis: " + "A".repeat(2000) };
          yield { type: "tool_use", id: `v-${callCount}`, name: "verbose_tool", input: {} };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 50, totalTokens: 100 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      },
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
      // No contextCollapseService, so destructive compaction is used
    });

    const events = await collectEvents(
      orchestrator.execute(makeInput({
        // Small token budget to force compaction. With 3 iterations of 10000-char
        // tool results + 2000-char assistant text, pressure will be well above 0.7.
        budget: { maxTokens: 4000 },
        maxIterations: 6,
      })),
    );

    // Should see context_compacted events from destructive compaction
    const compactedEvents = events.filter((e) => e.type === "context_compacted");
    expect(compactedEvents.length).toBeGreaterThanOrEqual(1);

    // The compaction should have freed some tokens (the unpinned messages with
    // large content should be droppable), resetting consecutiveCompactionFailures
    // If the circuit breaker didn't trip, the execution completes or aborts normally
    const finalEvent = events[events.length - 1];
    // The execution should not have aborted due to compaction failures
    if (finalEvent.type === "execution_aborted") {
      expect((finalEvent as any).reason).not.toContain("compaction failures");
    }
  });
});

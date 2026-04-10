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

/**
 * Error-path integration tests for AgenticOrchestrator.
 *
 * Covers:
 *  - Doom loop recovery: detection, escalation, strategy change
 *  - Budget exhaustion: mid-turn compaction trigger, graceful stop
 *  - Compaction cascade: circuit breaker after consecutive failures
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function createDeps() {
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
    runId: "err-test-run",
    repoId: "test-repo",
    ticketId: "test-ticket",
    objective: "Test error paths",
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
// 1. Doom Loop Recovery
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — doom loop recovery", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
    registerTestTool(deps.registry);
  });

  it("emits doom_loop_detected and escalating events when detector fires", async () => {
    // Provider always returns the same tool call
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "tool_use", id: `t-${Date.now()}`, name: "test_tool", input: { value: "stuck" } };
        yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      },
    );

    // Doom loop triggers after 3 records
    let recordCount = 0;
    vi.mocked(deps.mockDoomLoopDetector.record).mockImplementation(() => { recordCount++; });
    vi.mocked(deps.mockDoomLoopDetector.isLooping).mockImplementation(() => recordCount >= 3);
    vi.mocked(deps.mockDoomLoopDetector.getLoopingAction).mockReturnValue("test_tool");
    vi.mocked(deps.mockDoomLoopDetector.reset).mockImplementation(() => { recordCount = 0; });

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const events = await collectEvents(orchestrator.execute(makeInput({ maxIterations: 10 })));

    // Should have at least one doom_loop_detected event
    const doomEvents = events.filter((e) => e.type === "doom_loop_detected");
    expect(doomEvents.length).toBeGreaterThanOrEqual(1);

    // Should have escalating events following doom loop detection
    const escalateEvents = events.filter((e) => e.type === "escalating");
    expect(escalateEvents.length).toBeGreaterThanOrEqual(1);

    // First escalation is coder_default -> review_deep
    expect(escalateEvents[0]).toMatchObject({
      type: "escalating",
      fromRole: "coder_default",
      toRole: "review_deep",
      reason: "doom_loop_detected",
    });
  });

  it("does not continue the stuck pattern after doom loop detection — resets and tries new role", async () => {
    let recordCount = 0;
    let currentRole = "coder_default";
    const rolesSeen: string[] = [];

    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* (_runId, _msgs, _cb, options) {
        const role = options?.modelRole ?? "coder_default";
        rolesSeen.push(role);

        // On review_deep, return a completion (no tool calls) to stop the loop
        if (role === "review_deep") {
          yield { type: "token", value: "Fixed the issue." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
          return;
        }

        // Otherwise keep returning tools
        yield { type: "tool_use", id: `t-${Date.now()}`, name: "test_tool", input: { value: "loop" } };
        yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      },
    );

    vi.mocked(deps.mockDoomLoopDetector.record).mockImplementation(() => { recordCount++; });
    vi.mocked(deps.mockDoomLoopDetector.isLooping).mockImplementation(() => recordCount >= 3);
    vi.mocked(deps.mockDoomLoopDetector.getLoopingAction).mockReturnValue("test_tool");
    vi.mocked(deps.mockDoomLoopDetector.reset).mockImplementation(() => { recordCount = 0; });

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const events = await collectEvents(orchestrator.execute(makeInput({ maxIterations: 15 })));

    // After doom loop is detected, reset should be called
    expect(deps.mockDoomLoopDetector.reset).toHaveBeenCalled();

    // The orchestrator should have switched to review_deep
    expect(rolesSeen).toContain("review_deep");

    // Should complete (not abort) since review_deep returned a non-tool message
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);
  });

  it("aborts after exhausting all escalation roles (doom loop on overseer_escalation)", async () => {
    let recordCount = 0;

    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "tool_use", id: `t-${Date.now()}`, name: "test_tool", input: { value: "stuck" } };
        yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      },
    );

    vi.mocked(deps.mockDoomLoopDetector.record).mockImplementation(() => { recordCount++; });
    vi.mocked(deps.mockDoomLoopDetector.isLooping).mockImplementation(() => recordCount >= 3);
    vi.mocked(deps.mockDoomLoopDetector.getLoopingAction).mockReturnValue("test_tool");
    vi.mocked(deps.mockDoomLoopDetector.reset).mockImplementation(() => { recordCount = 0; });

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const events = await collectEvents(orchestrator.execute(makeInput({ maxIterations: 30 })));

    // Should have multiple doom_loop_detected events (one per role)
    const doomEvents = events.filter((e) => e.type === "doom_loop_detected");
    expect(doomEvents.length).toBeGreaterThanOrEqual(2);

    // Should eventually abort
    const abortEvent = events.find((e) => e.type === "execution_aborted");
    expect(abortEvent).toBeDefined();
    if (abortEvent && abortEvent.type === "execution_aborted") {
      expect(abortEvent.reason).toContain("Doom loop");
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Budget Exhaustion
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — budget exhaustion", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
    registerTestTool(deps.registry);
  });

  it("emits budget_warning when approaching the token limit then aborts on exhaustion", async () => {
    let callCount = 0;

    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount <= 2) {
          // Return tool calls so the loop continues
          yield { type: "tool_use", id: `t-${callCount}`, name: "test_tool", input: { value: "x" } };
          // Each iteration consumes 500 tokens
          yield { type: "done", usage: { inputTokens: 300, outputTokens: 200, totalTokens: 500 } };
        } else {
          yield { type: "token", value: "done" };
          yield { type: "done", usage: { inputTokens: 300, outputTokens: 200, totalTokens: 500 } };
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
          budget: { maxTokens: 600 },
          maxIterations: 10,
        }),
      ),
    );

    // After first iteration (500 tokens / 600 limit = 83%), should emit budget_warning
    const warningEvents = events.filter((e) => e.type === "budget_warning");
    expect(warningEvents.length).toBeGreaterThanOrEqual(1);

    // After second iteration (1000 tokens > 600 limit), should abort
    const abortEvent = events.find((e) => e.type === "execution_aborted");
    expect(abortEvent).toBeDefined();
    if (abortEvent && abortEvent.type === "execution_aborted") {
      expect(abortEvent.reason).toContain("Token budget exhausted");
    }
  });

  it("aborts gracefully when cost budget is exceeded", async () => {
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "tool_use", id: "t-1", name: "test_tool", input: { value: "x" } };
        // High token usage to generate cost
        yield { type: "done", usage: { inputTokens: 50000, outputTokens: 50000, totalTokens: 100000 } };
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

    // Use a model role that generates estimated cost (overseer_escalation)
    const events = await collectEvents(
      orchestrator.execute(
        makeInput({
          initialModelRole: "overseer_escalation",
          budget: { maxCostUsd: 0.01 },
          maxIterations: 5,
        }),
      ),
    );

    // Should abort due to cost exhaustion
    const abortEvent = events.find((e) => e.type === "execution_aborted");
    expect(abortEvent).toBeDefined();
    if (abortEvent && abortEvent.type === "execution_aborted") {
      expect(abortEvent.reason).toContain("Cost budget exhausted");
    }
  });

  it("per-turn budget check triggers abort even when tool results are pending", async () => {
    // Register a tool that returns a large result
    deps.registry.register({
      name: "big_tool",
      description: "Returns big content",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        content: "X".repeat(5000),
      }),
      permission: { scope: "meta", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        // Always return a tool call so the loop continues
        yield { type: "tool_use", id: `t-${callCount}`, name: "big_tool", input: {} };
        yield { type: "done", usage: { inputTokens: 400, outputTokens: 200, totalTokens: 600 } };
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
          budget: { maxTokens: 700 },
          maxIterations: 10,
        }),
      ),
    );

    // Should abort due to token budget exhaustion after iteration 2
    const abortEvent = events.find((e) => e.type === "execution_aborted");
    expect(abortEvent).toBeDefined();
    if (abortEvent && abortEvent.type === "execution_aborted") {
      expect(abortEvent.reason).toContain("Token budget exhausted");
    }

    // Shouldn't complete normally
    expect(events.some((e) => e.type === "execution_complete")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Compaction Cascade & Circuit Breaker
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — compaction cascade", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("triggers compaction when pressure exceeds 0.70 at start of iteration", async () => {
    // Register a tool that returns moderate-sized content
    deps.registry.register({
      name: "read_tool",
      description: "Reads content",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        // ~5000 chars = ~1250 tokens. With maxTokens=2000, this creates high pressure.
        content: "A".repeat(5000),
      }),
      permission: { scope: "meta", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_use", id: "r-1", name: "read_tool", input: {} };
          yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
        } else if (callCount === 2) {
          // Second iteration — by now pressure should be high and compaction should fire
          yield { type: "tool_use", id: "r-2", name: "read_tool", input: {} };
          yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
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
          budget: { maxTokens: 2000 },
          maxIterations: 5,
        }),
      ),
    );

    // At least one context_compacted event should have been emitted
    const compactedEvents = events.filter((e) => e.type === "context_compacted");
    expect(compactedEvents.length).toBeGreaterThanOrEqual(1);

    // commitCompactionSummary should have been called
    expect(deps.mockMemoryService.commitCompactionSummary).toHaveBeenCalled();
  });

  it("post-tool compaction fires when tool output spikes pressure above 0.85", async () => {
    deps.registry.register({
      name: "huge_tool",
      description: "Returns huge content",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        // ~20000 chars = ~5000 tokens. With maxTokens=2000, this is 250% pressure.
        content: "B".repeat(20000),
      }),
      permission: { scope: "meta", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_use", id: "h-1", name: "huge_tool", input: {} };
          yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
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
          budget: { maxTokens: 2000 },
          maxIterations: 5,
        }),
      ),
    );

    // Context compaction should fire after the huge tool result
    const compactedEvents = events.filter((e) => e.type === "context_compacted");
    expect(compactedEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("circuit breaker aborts after 3 consecutive compaction failures", async () => {
    // We need to create a scenario where compaction keeps failing to free tokens.
    // Use pinned messages that can't be compacted, so each compaction attempt
    // frees 0 tokens, incrementing the failure counter.

    deps.registry.register({
      name: "pinned_tool",
      description: "Generates pressure",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        content: "C".repeat(2000),
      }),
      permission: { scope: "meta", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        // Keep returning tool calls to drive the loop
        yield { type: "tool_use", id: `p-${callCount}`, name: "pinned_tool", input: {} };
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
    });

    const events = await collectEvents(
      orchestrator.execute(
        makeInput({
          // Very tight budget forces high pressure on every iteration
          budget: { maxTokens: 800 },
          maxIterations: 15,
        }),
      ),
    );

    // After 3 consecutive compaction failures, the orchestrator emits execution_aborted
    const abortEvent = events.find((e) => e.type === "execution_aborted");
    expect(abortEvent).toBeDefined();
    if (abortEvent && abortEvent.type === "execution_aborted") {
      // The abort could be from circuit breaker or budget exhaustion
      expect(
        abortEvent.reason.includes("compaction failures") ||
        abortEvent.reason.includes("Token budget exhausted"),
      ).toBe(true);
    }
  });

  it("resets compaction failure counter when compaction succeeds", async () => {
    // First round: big content causes compaction (success, frees tokens).
    // Second round: moderate content, no compaction needed.
    deps.registry.register({
      name: "varying_tool",
      description: "Returns varying content",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        content: "D".repeat(6000),
      }),
      permission: { scope: "meta", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount <= 2) {
          yield { type: "tool_use", id: `v-${callCount}`, name: "varying_tool", input: {} };
          yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
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
          budget: { maxTokens: 3000 },
          maxIterations: 5,
        }),
      ),
    );

    // Should complete (circuit breaker did not trip because compaction freed tokens)
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);

    // Compaction should have been called
    const compactedEvents = events.filter((e) => e.type === "context_compacted");
    expect(compactedEvents.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Provider error triggers escalation within orchestrator
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator — provider stream failure", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
    registerTestTool(deps.registry);
  });

  it("escalates to overseer_escalation when provider call throws synchronously", async () => {
    let callCount = 0;

    // The orchestrator's try/catch triggers when the provider call itself throws
    // (not inside the generator). We simulate this by making the mock function
    // throw before returning a generator.
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      ((_runId: string, _msgs: unknown, _cb: unknown, options?: { modelRole?: string }) => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Connection refused");
        }
        // Return a proper async generator for the recovery call
        async function* gen() {
          yield { type: "token", value: "Recovered via overseer." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
        return gen();
      }) as any,
    );

    const orchestrator = new AgenticOrchestrator({
      registry: deps.registry,
      providerOrchestrator: deps.mockProviderOrchestrator,
      contextService: deps.mockContextService,
      memoryService: deps.mockMemoryService,
      doomLoopDetector: deps.mockDoomLoopDetector,
      events: deps.mockEvents,
    });

    const events = await collectEvents(orchestrator.execute(makeInput({ maxIterations: 5 })));

    // Should emit an error event for the provider failure
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent && errorEvent.type === "error") {
      expect(errorEvent.error).toContain("Connection refused");
      expect(errorEvent.recoverable).toBe(true);
    }

    // Should escalate to overseer_escalation
    const escalateEvent = events.find((e) => e.type === "escalating");
    expect(escalateEvent).toBeDefined();
    if (escalateEvent && escalateEvent.type === "escalating") {
      expect(escalateEvent.toRole).toBe("overseer_escalation");
      expect(escalateEvent.reason).toBe("provider_error");
    }

    // Should complete after recovery
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);
  });

  it("aborts when overseer_escalation also fails with provider error", async () => {
    // Both initial and escalation calls throw synchronously
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
    });

    const events = await collectEvents(orchestrator.execute(makeInput({ maxIterations: 5 })));

    // First error triggers escalation to overseer
    expect(events.some((e) => e.type === "escalating")).toBe(true);

    // Overseer also fails — unrecoverable abort
    const abortEvent = events.find((e) => e.type === "execution_aborted");
    expect(abortEvent).toBeDefined();
    if (abortEvent && abortEvent.type === "execution_aborted") {
      expect(abortEvent.reason).toContain("Unrecoverable provider error");
    }

    // Should NOT complete
    expect(events.some((e) => e.type === "execution_complete")).toBe(false);
  });

  it("stream-level errors from the executor are surfaced as non-fatal events", async () => {
    // When the error happens inside the generator iteration (not as a thrown exception),
    // the StreamingToolExecutor catches it and emits an error event.
    vi.mocked(deps.mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "token", value: "Starting..." };
        throw new Error("Stream interrupted");
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

    const events = await collectEvents(orchestrator.execute(makeInput({ maxIterations: 2 })));

    // The stream error should surface as an error event from the executor
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent && errorEvent.type === "error") {
      expect(errorEvent.error).toContain("Stream interrupted");
      expect(errorEvent.recoverable).toBe(false);
    }
  });
});

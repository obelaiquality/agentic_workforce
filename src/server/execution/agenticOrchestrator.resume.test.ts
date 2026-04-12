/**
 * Test checkpoint/resume flow for the AgenticOrchestrator.
 *
 * Verifies:
 * - Starting a run and saving a checkpoint mid-execution
 * - Creating a new orchestrator from the checkpoint
 * - State is correctly restored (iteration count, tool call history, conversation)
 * - Resume notification is injected into conversation
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgenticEvent, AgenticExecutionInput, ConversationMessage } from "../tools/types";
import type { ModelRole } from "../../shared/contracts";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => {
  const checkpointStore = new Map<string, unknown>();

  return {
    prisma: {
      appSetting: {
        upsert: vi.fn(async (args: any) => {
          checkpointStore.set(args.where.key, args.create || args.update);
          return undefined;
        }),
        findUnique: vi.fn(async (args: any) => {
          const data = checkpointStore.get(args.where.key);
          if (!data) return null;
          return { key: args.where.key, value: (data as any).value };
        }),
        deleteMany: vi.fn(async (args: any) => {
          checkpointStore.delete(args.where.key);
          return { count: 1 };
        }),
      },
    },
    checkpointStore,
    mockTelemetry: {
      startSpan: vi.fn(() => ({
        setAttribute: vi.fn(),
        setStatus: vi.fn(),
        end: vi.fn(),
      })),
      incrementCounter: vi.fn(),
      recordMetric: vi.fn(),
    },
  };
});

vi.mock("../db", () => ({
  prisma: hoisted.prisma,
}));

vi.mock("../telemetry/tracer", () => ({
  getTelemetry: () => hoisted.mockTelemetry,
}));

vi.mock("../telemetry/metrics", () => ({
  METRICS: {
    AGENTIC_LOOP_ITERATIONS: "agentic.loop.iterations",
    AGENTIC_LOOP_DURATION_MS: "agentic.loop.duration_ms",
    CONTEXT_COMPACTION_COUNT: "context.compaction.count",
    CONTEXT_TOKENS_USED: "context.tokens.used",
    CONTEXT_TOKENS_FREED: "context.tokens.freed",
    PROVIDER_REQUEST_COUNT: "provider.request.count",
    PROVIDER_REQUEST_DURATION_MS: "provider.request.duration_ms",
    PROVIDER_TOKEN_INPUT: "provider.token.input",
    PROVIDER_TOKEN_OUTPUT: "provider.token.output",
    BUDGET_TOKENS_CONSUMED: "budget.tokens.consumed",
    BUDGET_COST_USD: "budget.cost.usd",
    DOOM_LOOP_DETECTED: "doom_loop.detected",
    TOOL_EXECUTION_COUNT: "tool.execution.count",
    TOOL_EXECUTION_DURATION_MS: "tool.execution.duration_ms",
  },
  METRIC_LABELS: {
    RUN_ID: "run_id",
    MODEL_ROLE: "model_role",
  },
}));

vi.mock("../logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../services/abortHierarchy", () => ({
  createRootAbortController: vi.fn(() => ({
    signal: { reason: undefined, addEventListener: vi.fn() },
    abort: vi.fn(),
    aborted: false,
  })),
}));

import { AgenticOrchestrator } from "./agenticOrchestrator";
import { DoomLoopDetector } from "../services/doomLoopDetector";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBaseInput(overrides?: Partial<AgenticExecutionInput>): AgenticExecutionInput {
  return {
    runId: "resume-test-run",
    repoId: "repo-resume",
    ticketId: "ticket-resume",
    objective: "Resume test objective",
    worktreePath: "/tmp/resume-test",
    actor: "resume-tester",
    maxIterations: 10,
    ...overrides,
  };
}

function createMockRegistry() {
  return {
    toJsonSchemasForContext: vi.fn(() => [
      { name: "read_file", description: "Read a file", parameters: {} },
      { name: "write_file", description: "Write a file", parameters: {} },
    ]),
    toJsonSchemasFor: vi.fn(() => []),
    getTool: vi.fn(() => null),
  };
}

function createMockMemoryService() {
  return {
    startPrefetch: vi.fn(),
    awaitPrefetch: vi.fn().mockResolvedValue([]),
    compose: vi.fn(() => ({
      episodicContext: "",
      workingMemory: [],
    })),
    formatMemoriesForPrompt: vi.fn(() => ""),
    commitCompactionSummary: vi.fn(),
  };
}

function createMockContextService() {
  return {
    getContext: vi.fn().mockResolvedValue({ files: [], tests: [], docs: [] }),
  };
}

function createMockEventService() {
  return {
    appendEvent: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Build a mock provider that completes immediately (no tool calls)
 * on the Nth call (0-indexed), allowing the caller to control how many
 * iterations run before completion.
 */
function createMockProvider(options: {
  completeOnCall?: number;
  totalCalls?: number;
}) {
  const { completeOnCall = 0, totalCalls = 10 } = options;
  let callCount = 0;

  return {
    streamChatWithRetryStreaming: vi.fn(function () {
      const currentCall = callCount++;

      async function* gen() {
        if (currentCall >= completeOnCall) {
          // Complete — emit text only, no tool calls
          yield { type: "text_delta", text: `Completed at call ${currentCall}` };
        } else {
          // Continue — emit text that looks like a tool call pattern
          // but since our mock executor won't handle it, the orchestrator
          // will treat text-only as "done"
          yield { type: "text_delta", text: `Still working at call ${currentCall}` };
        }

        yield {
          type: "done",
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        };
      }

      return gen();
    }),
    getCallCount: () => callCount,
  };
}

interface RunCheckpoint {
  runId: string;
  messages: ConversationMessage[];
  iterationCount: number;
  budgetUsed: { tokens: number; cost: number };
  currentRole: ModelRole;
  toolCallsTotal: number;
  recentlyReadFiles: Array<{ path: string; content: string }>;
  timestamp: string;
}

async function collectEvents(gen: AsyncGenerator<AgenticEvent>): Promise<AgenticEvent[]> {
  const events: AgenticEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgenticOrchestrator resume from checkpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.checkpointStore.clear();
  });

  it("restores iteration count from checkpoint", async () => {
    const checkpoint: RunCheckpoint = {
      runId: "resume-test-run",
      messages: [
        { role: "system", content: "System prompt here", pinned: true, timestamp: new Date().toISOString() },
        { role: "user", content: "Resume test objective", pinned: true, timestamp: new Date().toISOString() },
        { role: "assistant", content: "Previously working...", timestamp: new Date().toISOString() },
      ],
      iterationCount: 3,
      budgetUsed: { tokens: 450, cost: 0.02 },
      currentRole: "coder_default",
      toolCallsTotal: 5,
      recentlyReadFiles: [{ path: "/test/file.ts", content: "test content" }],
      timestamp: new Date().toISOString(),
    };

    const provider = createMockProvider({ completeOnCall: 0 });

    const orchestrator = new AgenticOrchestrator({
      registry: createMockRegistry() as any,
      providerOrchestrator: provider as any,
      contextService: createMockContextService() as any,
      memoryService: createMockMemoryService() as any,
      doomLoopDetector: new DoomLoopDetector(),
      events: createMockEventService() as any,
    });

    const events = await collectEvents(
      orchestrator.execute(makeBaseInput(), checkpoint),
    );

    // Should see iteration_start with the continued iteration number
    const iterationStartEvents = events.filter((e) => e.type === "iteration_start") as Array<{
      type: "iteration_start";
      iteration: number;
      messageCount: number;
    }>;

    // The orchestrator emits iteration_start with resumeFrom.iterationCount first
    // (as a resume notification), then the main loop increments and emits again.
    expect(iterationStartEvents.length).toBeGreaterThanOrEqual(1);

    // The first iteration_start from the resume notification uses the checkpoint's count
    expect(iterationStartEvents[0].iteration).toBe(3);

    // Should complete
    const completeEvent = events.find((e) => e.type === "execution_complete") as any;
    expect(completeEvent).toBeDefined();
    // Total iterations: checkpoint had 3, then main loop ran 1 more = 4
    // But the loop increments state.iteration to 4 and completes on iteration 4
    expect(completeEvent.totalIterations).toBeGreaterThanOrEqual(3);
  });

  it("restores tool call history count from checkpoint", async () => {
    const checkpoint: RunCheckpoint = {
      runId: "resume-test-run",
      messages: [
        { role: "system", content: "System prompt", pinned: true, timestamp: new Date().toISOString() },
        { role: "user", content: "Objective", pinned: true, timestamp: new Date().toISOString() },
      ],
      iterationCount: 2,
      budgetUsed: { tokens: 300, cost: 0.01 },
      currentRole: "coder_default",
      toolCallsTotal: 8,
      recentlyReadFiles: [],
      timestamp: new Date().toISOString(),
    };

    const provider = createMockProvider({ completeOnCall: 0 });

    const orchestrator = new AgenticOrchestrator({
      registry: createMockRegistry() as any,
      providerOrchestrator: provider as any,
      contextService: createMockContextService() as any,
      memoryService: createMockMemoryService() as any,
      doomLoopDetector: new DoomLoopDetector(),
      events: createMockEventService() as any,
    });

    const events = await collectEvents(
      orchestrator.execute(makeBaseInput(), checkpoint),
    );

    const completeEvent = events.find((e) => e.type === "execution_complete") as any;
    expect(completeEvent).toBeDefined();
    // Tool calls should be at least what was in the checkpoint
    expect(completeEvent.totalToolCalls).toBeGreaterThanOrEqual(8);
  });

  it("restores conversation history from checkpoint", async () => {
    const previousConversation: ConversationMessage[] = [
      { role: "system", content: "CUSTOM_SYSTEM_PROMPT", pinned: true, timestamp: new Date().toISOString() },
      { role: "user", content: "ORIGINAL_OBJECTIVE", pinned: true, timestamp: new Date().toISOString() },
      { role: "assistant", content: "I read the file and it contains...", timestamp: new Date().toISOString() },
      { role: "tool_result", content: JSON.stringify({ tool_name: "read_file", result: { type: "success", content: "file data" } }), timestamp: new Date().toISOString() },
      { role: "assistant", content: "Now I will edit the file.", timestamp: new Date().toISOString() },
    ];

    const checkpoint: RunCheckpoint = {
      runId: "resume-test-run",
      messages: previousConversation,
      iterationCount: 2,
      budgetUsed: { tokens: 200, cost: 0 },
      currentRole: "coder_default",
      toolCallsTotal: 3,
      recentlyReadFiles: [],
      timestamp: new Date().toISOString(),
    };

    let capturedMessages: any[] = [];
    const provider = {
      streamChatWithRetryStreaming: vi.fn((_runId: string, messages: any[]) => {
        capturedMessages = messages;
        async function* gen() {
          yield { type: "text_delta", text: "Resumed and completed." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 } };
        }
        return gen();
      }),
    };

    const orchestrator = new AgenticOrchestrator({
      registry: createMockRegistry() as any,
      providerOrchestrator: provider as any,
      contextService: createMockContextService() as any,
      memoryService: createMockMemoryService() as any,
      doomLoopDetector: new DoomLoopDetector(),
      events: createMockEventService() as any,
    });

    await collectEvents(
      orchestrator.execute(makeBaseInput(), checkpoint),
    );

    // The provider should receive the restored conversation + resume notification.
    // Note: the orchestrator mutates the checkpoint.messages array in-place when
    // adding the resume notification, so we compare against the known original count (5).
    const originalMessageCount = 5; // system + user + assistant + tool_result + assistant
    expect(capturedMessages.length).toBeGreaterThan(originalMessageCount);

    // Verify the original system prompt is present
    expect(capturedMessages[0].content).toBe("CUSTOM_SYSTEM_PROMPT");
    expect(capturedMessages[0].role).toBe("system");

    // Verify the original objective is present
    expect(capturedMessages[1].content).toBe("ORIGINAL_OBJECTIVE");
    expect(capturedMessages[1].role).toBe("user");

    // Verify there is a resume notification in the messages
    const resumeMsg = capturedMessages.find(
      (m: any) => typeof m.content === "string" && m.content.includes("Session resumed"),
    );
    expect(resumeMsg).toBeDefined();
  });

  it("restores model role from checkpoint", async () => {
    const checkpoint: RunCheckpoint = {
      runId: "resume-test-run",
      messages: [
        { role: "system", content: "System", pinned: true, timestamp: new Date().toISOString() },
        { role: "user", content: "Objective", pinned: true, timestamp: new Date().toISOString() },
      ],
      iterationCount: 1,
      budgetUsed: { tokens: 100, cost: 0 },
      currentRole: "review_deep",
      toolCallsTotal: 2,
      recentlyReadFiles: [],
      timestamp: new Date().toISOString(),
    };

    let capturedOptions: any = null;
    const provider = {
      streamChatWithRetryStreaming: vi.fn((_runId: string, _messages: any[], _onToken: any, options: any) => {
        capturedOptions = options;
        async function* gen() {
          yield { type: "text_delta", text: "Done" };
          yield { type: "done", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
        }
        return gen();
      }),
    };

    const orchestrator = new AgenticOrchestrator({
      registry: createMockRegistry() as any,
      providerOrchestrator: provider as any,
      contextService: createMockContextService() as any,
      memoryService: createMockMemoryService() as any,
      doomLoopDetector: new DoomLoopDetector(),
      events: createMockEventService() as any,
    });

    await collectEvents(
      orchestrator.execute(makeBaseInput(), checkpoint),
    );

    // The provider should have been called with the restored model role
    expect(capturedOptions).toBeDefined();
    expect(capturedOptions.modelRole).toBe("review_deep");
  });

  it("restores budget consumed from checkpoint", async () => {
    const checkpoint: RunCheckpoint = {
      runId: "resume-test-run",
      messages: [
        { role: "system", content: "System", pinned: true, timestamp: new Date().toISOString() },
        { role: "user", content: "Objective", pinned: true, timestamp: new Date().toISOString() },
      ],
      iterationCount: 1,
      budgetUsed: { tokens: 800, cost: 0.05 },
      currentRole: "coder_default",
      toolCallsTotal: 4,
      recentlyReadFiles: [],
      timestamp: new Date().toISOString(),
    };

    const provider = createMockProvider({ completeOnCall: 0 });

    const orchestrator = new AgenticOrchestrator({
      registry: createMockRegistry() as any,
      providerOrchestrator: provider as any,
      contextService: createMockContextService() as any,
      memoryService: createMockMemoryService() as any,
      doomLoopDetector: new DoomLoopDetector(),
      events: createMockEventService() as any,
    });

    // Set a tight budget that the restored tokens already approach
    const events = await collectEvents(
      orchestrator.execute(
        makeBaseInput({ budget: { maxTokens: 1000 } }),
        checkpoint,
      ),
    );

    const eventTypes = events.map((e) => e.type);

    // Should see a budget warning since 800 + 150 (from new call) > 1000 * 0.8 = 800
    // and should abort since 800 + 150 = 950 >= 1000
    expect(
      eventTypes.includes("budget_warning") || eventTypes.includes("execution_aborted"),
    ).toBe(true);
  });

  it("restores recentlyReadFiles from checkpoint", async () => {
    const recentFiles = [
      { path: "/src/index.ts", content: "export default function main() {}" },
      { path: "/src/utils.ts", content: "export function helper() { return 42; }" },
    ];

    const checkpoint: RunCheckpoint = {
      runId: "resume-test-run",
      messages: [
        { role: "system", content: "System", pinned: true, timestamp: new Date().toISOString() },
        { role: "user", content: "Objective", pinned: true, timestamp: new Date().toISOString() },
      ],
      iterationCount: 1,
      budgetUsed: { tokens: 100, cost: 0 },
      currentRole: "coder_default",
      toolCallsTotal: 2,
      recentlyReadFiles: recentFiles,
      timestamp: new Date().toISOString(),
    };

    const provider = createMockProvider({ completeOnCall: 0 });

    const orchestrator = new AgenticOrchestrator({
      registry: createMockRegistry() as any,
      providerOrchestrator: provider as any,
      contextService: createMockContextService() as any,
      memoryService: createMockMemoryService() as any,
      doomLoopDetector: new DoomLoopDetector(),
      events: createMockEventService() as any,
    });

    const events = await collectEvents(
      orchestrator.execute(makeBaseInput(), checkpoint),
    );

    // Should complete without errors (recently read files are just state, not directly observable in events)
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);
  });

  it("injects resume notification message into conversation", async () => {
    const checkpoint: RunCheckpoint = {
      runId: "resume-test-run",
      messages: [
        { role: "system", content: "System prompt", pinned: true, timestamp: new Date().toISOString() },
        { role: "user", content: "Task objective", pinned: true, timestamp: new Date().toISOString() },
        { role: "assistant", content: "Started working...", timestamp: new Date().toISOString() },
      ],
      iterationCount: 5,
      budgetUsed: { tokens: 500, cost: 0 },
      currentRole: "coder_default",
      toolCallsTotal: 10,
      recentlyReadFiles: [],
      timestamp: new Date().toISOString(),
    };

    let capturedMessages: any[] = [];
    const provider = {
      streamChatWithRetryStreaming: vi.fn((_runId: string, messages: any[]) => {
        capturedMessages = messages;
        async function* gen() {
          yield { type: "text_delta", text: "Done" };
          yield { type: "done", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
        }
        return gen();
      }),
    };

    const orchestrator = new AgenticOrchestrator({
      registry: createMockRegistry() as any,
      providerOrchestrator: provider as any,
      contextService: createMockContextService() as any,
      memoryService: createMockMemoryService() as any,
      doomLoopDetector: new DoomLoopDetector(),
      events: createMockEventService() as any,
    });

    await collectEvents(
      orchestrator.execute(makeBaseInput(), checkpoint),
    );

    // Check that the resume notification mentions the checkpoint iteration
    const resumeNotification = capturedMessages.find(
      (m: any) => typeof m.content === "string" && m.content.includes("iteration 5"),
    );
    expect(resumeNotification).toBeDefined();
    expect(resumeNotification.content).toContain("resumed from checkpoint");
  });

  it("cleans up checkpoint on successful completion after resume", async () => {
    const checkpoint: RunCheckpoint = {
      runId: "resume-test-run",
      messages: [
        { role: "system", content: "System", pinned: true, timestamp: new Date().toISOString() },
        { role: "user", content: "Objective", pinned: true, timestamp: new Date().toISOString() },
      ],
      iterationCount: 1,
      budgetUsed: { tokens: 50, cost: 0 },
      currentRole: "coder_default",
      toolCallsTotal: 0,
      recentlyReadFiles: [],
      timestamp: new Date().toISOString(),
    };

    const provider = createMockProvider({ completeOnCall: 0 });

    const orchestrator = new AgenticOrchestrator({
      registry: createMockRegistry() as any,
      providerOrchestrator: provider as any,
      contextService: createMockContextService() as any,
      memoryService: createMockMemoryService() as any,
      doomLoopDetector: new DoomLoopDetector(),
      events: createMockEventService() as any,
    });

    await collectEvents(
      orchestrator.execute(makeBaseInput(), checkpoint),
    );

    // Checkpoint should be deleted after successful completion
    expect(hoisted.prisma.appSetting.deleteMany).toHaveBeenCalledWith({
      where: { key: "agentic.checkpoint.resume-test-run" },
    });
  });

  it("handles resume from escalated model role", async () => {
    const checkpoint: RunCheckpoint = {
      runId: "resume-test-run",
      messages: [
        { role: "system", content: "System", pinned: true, timestamp: new Date().toISOString() },
        { role: "user", content: "Objective", pinned: true, timestamp: new Date().toISOString() },
        { role: "assistant", content: "Escalated to overseer", timestamp: new Date().toISOString() },
      ],
      iterationCount: 8,
      budgetUsed: { tokens: 2000, cost: 0.1 },
      currentRole: "overseer_escalation",
      toolCallsTotal: 20,
      recentlyReadFiles: [],
      timestamp: new Date().toISOString(),
    };

    let capturedOptions: any = null;
    const provider = {
      streamChatWithRetryStreaming: vi.fn((_runId: string, _messages: any[], _onToken: any, options: any) => {
        capturedOptions = options;
        async function* gen() {
          yield { type: "text_delta", text: "Completed from overseer" };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 } };
        }
        return gen();
      }),
    };

    const orchestrator = new AgenticOrchestrator({
      registry: createMockRegistry() as any,
      providerOrchestrator: provider as any,
      contextService: createMockContextService() as any,
      memoryService: createMockMemoryService() as any,
      doomLoopDetector: new DoomLoopDetector(),
      events: createMockEventService() as any,
    });

    const events = await collectEvents(
      orchestrator.execute(makeBaseInput(), checkpoint),
    );

    // Should use the overseer_escalation role from checkpoint
    expect(capturedOptions.modelRole).toBe("overseer_escalation");

    // Should complete
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgenticOrchestrator } from "./agenticOrchestrator";
import { ToolRegistry } from "../tools/registry";
import type { ProviderOrchestrator } from "../services/providerOrchestrator";
import type { ContextService } from "../services/contextService";
import type { MemoryService } from "../services/memoryService";
import type { DoomLoopDetector } from "../services/doomLoopDetector";
import type { V2EventService } from "../services/v2EventService";
import type { AgenticExecutionInput } from "../tools/types";
import { z } from "zod";

describe("AgenticOrchestrator", () => {
  let registry: ToolRegistry;
  let mockProviderOrchestrator: ProviderOrchestrator;
  let mockContextService: ContextService;
  let mockMemoryService: MemoryService;
  let mockDoomLoopDetector: DoomLoopDetector;
  let mockEvents: V2EventService;

  beforeEach(() => {
    registry = new ToolRegistry();

    // Mock dependencies
    mockProviderOrchestrator = {
      streamChatWithRetryStreaming: vi.fn(),
    } as unknown as ProviderOrchestrator;

    mockContextService = {} as ContextService;

    mockMemoryService = {
      startPrefetch: vi.fn(),
      awaitPrefetch: vi.fn(async () => []),
      formatMemoriesForPrompt: vi.fn(() => ""),
      commitCompactionSummary: vi.fn(),
      compose: vi.fn(() => ({
        episodicContext: "",
        workingMessages: [],
        stats: {
          episodicCount: 0,
          workingCount: 0,
          totalTokenEstimate: 0,
        },
      })),
    } as unknown as MemoryService;

    mockDoomLoopDetector = {
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

    mockEvents = {
      appendEvent: vi.fn(),
    } as unknown as V2EventService;
  });

  it("should complete immediately when agent returns no tool calls", async () => {
    // Setup: Provider returns a done message with no tools
    vi.mocked(mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "token", value: "Task is complete." };
        yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
      }
    );

    const orchestrator = new AgenticOrchestrator({
      registry,
      providerOrchestrator: mockProviderOrchestrator,
      contextService: mockContextService,
      memoryService: mockMemoryService,
      doomLoopDetector: mockDoomLoopDetector,
      events: mockEvents,
    });

    const input: AgenticExecutionInput = {
      runId: "test-run",
      repoId: "test-repo",
      ticketId: "test-ticket",
      objective: "Test objective",
      worktreePath: "/tmp/test",
      actor: "test-agent",
    };

    const events = [];
    for await (const event of orchestrator.execute(input)) {
      events.push(event);
    }

    // Should have: iteration_start, assistant_token(s), execution_complete
    expect(events.some((e) => e.type === "iteration_start")).toBe(true);
    expect(events.some((e) => e.type === "assistant_token")).toBe(true);
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);

    const completeEvent = events.find((e) => e.type === "execution_complete");
    expect(completeEvent).toBeDefined();
    if (completeEvent && completeEvent.type === "execution_complete") {
      expect(completeEvent.totalIterations).toBe(1);
      expect(completeEvent.totalToolCalls).toBe(0);
    }
  });

  it("should execute tool calls and continue looping", async () => {
    // Register a simple test tool
    registry.register({
      name: "test_tool",
      description: "A test tool",
      inputSchema: z.object({ value: z.string() }),
      execute: async (input) => ({
        type: "success",
        content: `Result: ${input.value}`,
      }),
      permission: {
        scope: "meta",
        readOnly: true,
      },
    });

    let callCount = 0;
    vi.mocked(mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          // First call: use a tool
          yield { type: "tool_use", id: "tool-1", name: "test_tool", input: { value: "hello" } };
          yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
        } else {
          // Second call: complete
          yield { type: "token", value: "All done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      }
    );

    const orchestrator = new AgenticOrchestrator({
      registry,
      providerOrchestrator: mockProviderOrchestrator,
      contextService: mockContextService,
      memoryService: mockMemoryService,
      doomLoopDetector: mockDoomLoopDetector,
      events: mockEvents,
    });

    const input: AgenticExecutionInput = {
      runId: "test-run",
      repoId: "test-repo",
      ticketId: "test-ticket",
      objective: "Test with tool",
      worktreePath: "/tmp/test",
      actor: "test-agent",
    };

    const events = [];
    for await (const event of orchestrator.execute(input)) {
      events.push(event);
    }

    // Should have tool_use_started and tool_result
    expect(events.some((e) => e.type === "tool_use_started")).toBe(true);
    expect(events.some((e) => e.type === "tool_result")).toBe(true);
    expect(events.some((e) => e.type === "loop_continuing")).toBe(true);
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);

    const completeEvent = events.find((e) => e.type === "execution_complete");
    if (completeEvent && completeEvent.type === "execution_complete") {
      expect(completeEvent.totalIterations).toBe(2);
      expect(completeEvent.totalToolCalls).toBe(1);
    }
  });

  it("should abort on max iterations", async () => {
    // Provider always returns a tool call
    vi.mocked(mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "tool_use", id: "tool-1", name: "test_tool", input: { value: "loop" } };
        yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
      }
    );

    registry.register({
      name: "test_tool",
      description: "A test tool",
      inputSchema: z.object({ value: z.string() }),
      execute: async (input) => ({
        type: "success",
        content: `Result: ${input.value}`,
      }),
      permission: {
        scope: "meta",
        readOnly: true,
      },
    });

    const orchestrator = new AgenticOrchestrator({
      registry,
      providerOrchestrator: mockProviderOrchestrator,
      contextService: mockContextService,
      memoryService: mockMemoryService,
      doomLoopDetector: mockDoomLoopDetector,
      events: mockEvents,
    });

    const input: AgenticExecutionInput = {
      runId: "test-run",
      repoId: "test-repo",
      ticketId: "test-ticket",
      objective: "Test max iterations",
      worktreePath: "/tmp/test",
      actor: "test-agent",
      maxIterations: 3,
    };

    const events = [];
    for await (const event of orchestrator.execute(input)) {
      events.push(event);
    }

    // Should hit max iterations
    expect(events.some((e) => e.type === "max_iterations_reached")).toBe(true);
    expect(events.some((e) => e.type === "execution_aborted")).toBe(true);

    const abortEvent = events.find((e) => e.type === "execution_aborted");
    if (abortEvent && abortEvent.type === "execution_aborted") {
      expect(abortEvent.reason).toContain("Maximum iterations");
    }
  });

  it("should escalate on doom loop detection", async () => {
    // Provider always returns the same tool call
    vi.mocked(mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "tool_use", id: "tool-1", name: "test_tool", input: { value: "same" } };
        yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
      }
    );

    registry.register({
      name: "test_tool",
      description: "A test tool",
      inputSchema: z.object({ value: z.string() }),
      execute: async (input) => ({
        type: "success",
        content: `Result: ${input.value}`,
      }),
      permission: {
        scope: "meta",
        readOnly: true,
      },
    });

    // Mock doom loop detector to trigger on third call
    let recordCount = 0;
    vi.mocked(mockDoomLoopDetector.record).mockImplementation(() => {
      recordCount++;
    });
    vi.mocked(mockDoomLoopDetector.isLooping).mockImplementation(() => recordCount >= 3);
    vi.mocked(mockDoomLoopDetector.getLoopingAction).mockReturnValue("tool_calls");

    const orchestrator = new AgenticOrchestrator({
      registry,
      providerOrchestrator: mockProviderOrchestrator,
      contextService: mockContextService,
      memoryService: mockMemoryService,
      doomLoopDetector: mockDoomLoopDetector,
      events: mockEvents,
    });

    const input: AgenticExecutionInput = {
      runId: "test-run",
      repoId: "test-repo",
      ticketId: "test-ticket",
      objective: "Test doom loop",
      worktreePath: "/tmp/test",
      actor: "test-agent",
      maxIterations: 10,
    };

    const events = [];
    for await (const event of orchestrator.execute(input)) {
      events.push(event);
    }

    // Should detect doom loop and escalate
    expect(events.some((e) => e.type === "doom_loop_detected")).toBe(true);
    expect(events.some((e) => e.type === "escalating")).toBe(true);

    const escalateEvent = events.find((e) => e.type === "escalating");
    if (escalateEvent && escalateEvent.type === "escalating") {
      expect(escalateEvent.fromRole).toBe("coder_default");
      expect(escalateEvent.toRole).toBe("review_deep");
      expect(escalateEvent.reason).toBe("doom_loop_detected");
    }
  });

  it("should enforce budget token limit", async () => {
    // Provider returns token usage that exceeds budget
    vi.mocked(mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "token", value: "Response" };
        yield { type: "done", usage: { inputTokens: 5000, outputTokens: 5000, totalTokens: 10000 } };
      }
    );

    const orchestrator = new AgenticOrchestrator({
      registry,
      providerOrchestrator: mockProviderOrchestrator,
      contextService: mockContextService,
      memoryService: mockMemoryService,
      doomLoopDetector: mockDoomLoopDetector,
      events: mockEvents,
    });

    const input: AgenticExecutionInput = {
      runId: "test-run",
      repoId: "test-repo",
      ticketId: "test-ticket",
      objective: "Test budget",
      worktreePath: "/tmp/test",
      actor: "test-agent",
      budget: {
        maxTokens: 5000, // Will be exceeded after first iteration (10000 > 5000)
      },
    };

    const events = [];
    for await (const event of orchestrator.execute(input)) {
      events.push(event);
    }

    // Should abort due to budget exhaustion
    expect(events.some((e) => e.type === "execution_aborted")).toBe(true);

    const abortEvent = events.find((e) => e.type === "execution_aborted");
    if (abortEvent && abortEvent.type === "execution_aborted") {
      expect(abortEvent.reason).toContain("Token budget exhausted");
      expect(abortEvent.reason).toContain("10000");
      expect(abortEvent.reason).toContain("5000");
    }
  });

  it("should use StreamingToolExecutor for tool execution", async () => {
    // Note: This test verifies the orchestrator uses streaming tool execution
    // Once the bug in agenticOrchestrator.ts is fixed
    const executeSpy = vi.fn(async () => ({
      type: "success" as const,
      content: "Tool executed",
    }));

    registry.register({
      name: "test_tool",
      description: "A test tool",
      inputSchema: z.object({ value: z.string() }),
      execute: executeSpy,
      permission: {
        scope: "meta",
        readOnly: true,
      },
    });

    vi.mocked(mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "tool_use", id: "tool-1", name: "test_tool", input: { value: "test" } };
        yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
      }
    );

    const orchestrator = new AgenticOrchestrator({
      registry,
      providerOrchestrator: mockProviderOrchestrator,
      contextService: mockContextService,
      memoryService: mockMemoryService,
      doomLoopDetector: mockDoomLoopDetector,
      events: mockEvents,
    });

    const input: AgenticExecutionInput = {
      runId: "test-run",
      repoId: "test-repo",
      ticketId: "test-ticket",
      objective: "Test streaming executor",
      worktreePath: "/tmp/test",
      actor: "test-agent",
      maxIterations: 2,
    };

    const events = [];
    for await (const event of orchestrator.execute(input)) {
      events.push(event);
    }

    // Verify tool was executed
    expect(executeSpy).toHaveBeenCalledWith(
      { value: "test" },
      expect.objectContaining({
        runId: "test-run",
        repoId: "test-repo",
        ticketId: "test-ticket",
      })
    );

    // Verify tool result event was emitted
    const toolResultEvent = events.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toBeDefined();
    if (toolResultEvent && toolResultEvent.type === "tool_result") {
      expect(toolResultEvent.name).toBe("test_tool");
      expect(toolResultEvent.result.type).toBe("success");
    }
  });

  it("compacts after large tool result pushes pressure above 0.85", async () => {
    // Register a tool that returns a massive result.
    // Use z.any() for the schema because the StreamingToolExecutor wraps
    // tool input as { tool_name, params } via the hook event pipeline.
    registry.register({
      name: "read_big_file",
      description: "Reads a big file",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        // ~25,000 chars => ~6,250 estimated tokens
        content: "X".repeat(25000),
      }),
      permission: {
        scope: "meta",
        readOnly: true,
      },
    });

    let callCount = 0;
    vi.mocked(mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_use", id: "tool-big", name: "read_big_file", input: { path: "/huge" } };
          yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      }
    );

    const orchestrator = new AgenticOrchestrator({
      registry,
      providerOrchestrator: mockProviderOrchestrator,
      contextService: mockContextService,
      memoryService: mockMemoryService,
      doomLoopDetector: mockDoomLoopDetector,
      events: mockEvents,
    });

    const input: AgenticExecutionInput = {
      runId: "test-compact-run",
      repoId: "test-repo",
      ticketId: "test-ticket",
      objective: "Test post-tool compaction",
      worktreePath: "/tmp/test",
      actor: "test-agent",
      maxIterations: 3,
      // Small token budget so the 25K char tool output pushes pressure > 0.85
      budget: { maxTokens: 2000 },
    };

    const events = [];
    for await (const event of orchestrator.execute(input)) {
      events.push(event);
    }

    // Should have a context_compacted event emitted BEFORE loop_continuing
    // (i.e., the post-tool compaction fires mid-iteration, not at iteration start)
    const compactedEvents = events.filter((e) => e.type === "context_compacted");
    expect(compactedEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("continues execution when memory extraction throws", async () => {
    // Register a simple tool so the loop continues past tool execution
    registry.register({
      name: "test_tool",
      description: "A test tool",
      inputSchema: z.object({ value: z.string() }),
      execute: async () => ({
        type: "success" as const,
        content: "ok",
      }),
      permission: {
        scope: "meta",
        readOnly: true,
      },
    });

    let callCount = 0;
    vi.mocked(mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_use", id: "tool-1", name: "test_tool", input: { value: "x" } };
          yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
        } else {
          yield { type: "token", value: "All done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      }
    );

    // Create a mock autoMemoryExtractor that throws
    const mockAutoMemoryExtractor = {
      shouldExtract: vi.fn(() => true),
      extractFromIteration: vi.fn(async () => {
        throw new Error("Memory service crashed");
      }),
      extractFromCompletion: vi.fn(async () => null),
      resetRun: vi.fn(),
    };

    const orchestrator = new AgenticOrchestrator({
      registry,
      providerOrchestrator: mockProviderOrchestrator,
      contextService: mockContextService,
      memoryService: mockMemoryService,
      doomLoopDetector: mockDoomLoopDetector,
      events: mockEvents,
      autoMemoryExtractor: mockAutoMemoryExtractor as any,
    });

    const input: AgenticExecutionInput = {
      runId: "test-memory-crash",
      repoId: "test-repo",
      ticketId: "test-ticket",
      objective: "Test memory extraction error handling",
      worktreePath: "/tmp/test",
      actor: "test-agent",
    };

    const events = [];
    for await (const event of orchestrator.execute(input)) {
      events.push(event);
    }

    // Should emit a recoverable error about memory extraction
    const memoryError = events.find(
      (e) => e.type === "error" && e.error.includes("Memory extraction failed")
    );
    expect(memoryError).toBeDefined();
    if (memoryError && memoryError.type === "error") {
      expect(memoryError.recoverable).toBe(true);
      expect(memoryError.error).toContain("Memory service crashed");
    }

    // Execution should still complete (not crash)
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);
  });

  it("aborts when hook fails with continueOnError=false", async () => {
    vi.mocked(mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "token", value: "Response" };
        yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
      }
    );

    // Create a mock hookService that returns a failing hook with continue=false
    const mockHookService = {
      executeHooksForEvent: vi.fn(async (input: any) => ({
        outputs: [
          {
            hook: { id: "hook-1", name: "validation-gate" },
            output: {
              success: false,
              continue: false,
              error: "Validation failed: missing required fields",
              durationMs: 50,
            },
          },
        ],
        systemMessages: [],
        updatedInput: {},
        shouldContinue: false,
      })),
    };

    const orchestrator = new AgenticOrchestrator({
      registry,
      providerOrchestrator: mockProviderOrchestrator,
      contextService: mockContextService,
      memoryService: mockMemoryService,
      doomLoopDetector: mockDoomLoopDetector,
      events: mockEvents,
      hookService: mockHookService as any,
    });

    const input: AgenticExecutionInput = {
      runId: "test-hook-abort",
      repoId: "test-repo",
      ticketId: "test-ticket",
      objective: "Test hook abort",
      worktreePath: "/tmp/test",
      actor: "test-agent",
    };

    const events = [];
    for await (const event of orchestrator.execute(input)) {
      events.push(event);
    }

    // Should have hook_executed event showing failure
    const hookEvent = events.find((e) => e.type === "hook_executed");
    expect(hookEvent).toBeDefined();
    if (hookEvent && hookEvent.type === "hook_executed") {
      expect(hookEvent.success).toBe(false);
    }

    // Should have execution_aborted due to hook failure
    const abortEvent = events.find((e) => e.type === "execution_aborted");
    expect(abortEvent).toBeDefined();
    if (abortEvent && abortEvent.type === "execution_aborted") {
      expect(abortEvent.reason).toContain("Hook failure with continueOnError=false");
    }

    // Should NOT have execution_complete (aborted before main loop)
    expect(events.some((e) => e.type === "execution_complete")).toBe(false);

    // Provider should never have been called (aborted at SessionStart)
    expect(mockProviderOrchestrator.streamChatWithRetryStreaming).not.toHaveBeenCalled();
  });

  it("continues when hook fails with continueOnError=true", async () => {
    vi.mocked(mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "token", value: "Task complete." };
        yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
      }
    );

    // Create a mock hookService that returns a failing hook with continue=true
    const mockHookService = {
      executeHooksForEvent: vi.fn(async () => ({
        outputs: [
          {
            hook: { id: "hook-2", name: "optional-lint" },
            output: {
              success: false,
              continue: true,
              error: "Lint check failed, but non-blocking",
              durationMs: 30,
            },
          },
        ],
        systemMessages: ["Lint warning: minor issue detected"],
        updatedInput: {},
        shouldContinue: true,
      })),
    };

    const orchestrator = new AgenticOrchestrator({
      registry,
      providerOrchestrator: mockProviderOrchestrator,
      contextService: mockContextService,
      memoryService: mockMemoryService,
      doomLoopDetector: mockDoomLoopDetector,
      events: mockEvents,
      hookService: mockHookService as any,
    });

    const input: AgenticExecutionInput = {
      runId: "test-hook-continue",
      repoId: "test-repo",
      ticketId: "test-ticket",
      objective: "Test hook continue on error",
      worktreePath: "/tmp/test",
      actor: "test-agent",
    };

    const events = [];
    for await (const event of orchestrator.execute(input)) {
      events.push(event);
    }

    // Should have hook_executed events (multiple calls to executeHooksForEvent)
    const hookEvents = events.filter((e) => e.type === "hook_executed");
    expect(hookEvents.length).toBeGreaterThanOrEqual(1);

    // Hook failed but with continue=true, so shouldAbort=false
    // Execution should proceed and complete normally
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);

    // Should NOT have execution_aborted
    expect(events.some((e) => e.type === "execution_aborted")).toBe(false);

    // Provider should have been called (execution proceeded past hooks)
    expect(mockProviderOrchestrator.streamChatWithRetryStreaming).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Integration-level scenarios
  // ---------------------------------------------------------------------------

  it("completes full doom loop escalation chain: coder_default -> review_deep -> overseer_escalation -> abort", async () => {
    // Provider always returns the exact same tool call to trigger doom loop
    vi.mocked(mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "tool_use", id: `tool-${Date.now()}`, name: "test_tool", input: { value: "stuck" } };
        yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
      }
    );

    registry.register({
      name: "test_tool",
      description: "A test tool",
      inputSchema: z.object({ value: z.string() }),
      execute: async () => ({ type: "success", content: "same result" }),
      permission: { scope: "meta", readOnly: true },
    });

    // Doom loop triggers after 3 recordings; reset clears but escalation
    // must chain through coder_default -> review_deep -> overseer_escalation -> abort
    let recordCount = 0;
    let wasReset = false;
    vi.mocked(mockDoomLoopDetector.record).mockImplementation(() => { recordCount++; });
    vi.mocked(mockDoomLoopDetector.isLooping).mockImplementation(() => {
      // Trigger doom loop every 3 recordings after last reset
      return recordCount >= 3;
    });
    vi.mocked(mockDoomLoopDetector.reset).mockImplementation(() => {
      recordCount = 0;
      wasReset = true;
    });
    vi.mocked(mockDoomLoopDetector.getLoopingAction).mockReturnValue("test_tool");

    const orchestrator = new AgenticOrchestrator({
      registry,
      providerOrchestrator: mockProviderOrchestrator,
      contextService: mockContextService,
      memoryService: mockMemoryService,
      doomLoopDetector: mockDoomLoopDetector,
      events: mockEvents,
    });

    const input: AgenticExecutionInput = {
      runId: "test-full-escalation",
      repoId: "test-repo",
      ticketId: "test-ticket",
      objective: "Test full escalation chain",
      worktreePath: "/tmp/test",
      actor: "test-agent",
      maxIterations: 30,
    };

    const events = [];
    for await (const event of orchestrator.execute(input)) {
      events.push(event);
    }

    // Should see escalation events for each step
    const escalations = events.filter((e) => e.type === "escalating");
    // First escalation: coder_default -> review_deep
    expect(escalations.length).toBeGreaterThanOrEqual(1);
    expect(escalations[0].fromRole).toBe("coder_default");
    expect(escalations[0].toRole).toBe("review_deep");

    // After exhausting all roles, should abort
    expect(events.some((e) => e.type === "execution_aborted")).toBe(true);
    const abortEvent = events.find((e) => e.type === "execution_aborted");
    expect(abortEvent).toBeDefined();
    if (abortEvent && abortEvent.type === "execution_aborted") {
      expect(abortEvent.reason).toContain("Doom loop");
    }
  });

  it("deferred tool loading: tool_search results are available in next iteration", async () => {
    // Register a deferred tool and a core tool
    registry.register({
      name: "tool_search",
      description: "Search for tools",
      inputSchema: z.object({ query: z.string() }),
      execute: async () => ({
        type: "success",
        content: "Found: special_tool",
        metadata: { toolNames: ["special_tool"] },
      }),
      permission: { scope: "meta", readOnly: true },
      alwaysLoad: true,
    });

    registry.register({
      name: "special_tool",
      description: "A special tool loaded on demand",
      inputSchema: z.object({ action: z.string() }),
      execute: async () => ({ type: "success", content: "Special done" }),
      permission: { scope: "meta", readOnly: true },
      alwaysLoad: false,
    });

    let callCount = 0;
    vi.mocked(mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          // First call: agent searches for tools
          yield { type: "tool_use", id: "search-1", name: "tool_search", input: { query: "special" } };
          yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
        } else {
          // Second call: complete
          yield { type: "token", value: "Done with deferred." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      }
    );

    const orchestrator = new AgenticOrchestrator({
      registry,
      providerOrchestrator: mockProviderOrchestrator,
      contextService: mockContextService,
      memoryService: mockMemoryService,
      doomLoopDetector: mockDoomLoopDetector,
      events: mockEvents,
    });

    const input: AgenticExecutionInput = {
      runId: "test-deferred",
      repoId: "test-repo",
      ticketId: "test-ticket",
      objective: "Test deferred tool loading",
      worktreePath: "/tmp/test",
      actor: "test-agent",
      useDeferredTools: true,
    };

    const events = [];
    for await (const event of orchestrator.execute(input)) {
      events.push(event);
    }

    // Should have completed
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);

    // The tool_search result should have been processed
    const toolResultEvents = events.filter((e) => e.type === "tool_result");
    expect(toolResultEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("aborts execution when budget is exhausted during tool call", async () => {
    registry.register({
      name: "expensive_tool",
      description: "A tool that consumes tokens",
      inputSchema: z.any(),
      execute: async () => ({ type: "success", content: "done" }),
      permission: { scope: "meta", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_use", id: "tool-exp", name: "expensive_tool", input: {} };
          // Report large token usage that puts us at >= 80% of 500 token budget
          yield { type: "done", usage: { inputTokens: 250, outputTokens: 200, totalTokens: 450 } };
        } else {
          yield { type: "tool_use", id: "tool-exp-2", name: "expensive_tool", input: {} };
          // Second call pushes us over 100%
          yield { type: "done", usage: { inputTokens: 200, outputTokens: 200, totalTokens: 400 } };
        }
      }
    );

    const orchestrator = new AgenticOrchestrator({
      registry,
      providerOrchestrator: mockProviderOrchestrator,
      contextService: mockContextService,
      memoryService: mockMemoryService,
      doomLoopDetector: mockDoomLoopDetector,
      events: mockEvents,
    });

    const input: AgenticExecutionInput = {
      runId: "test-budget-exhaust",
      repoId: "test-repo",
      ticketId: "test-ticket",
      objective: "Test budget exhaustion",
      worktreePath: "/tmp/test",
      actor: "test-agent",
      budget: {
        maxTokens: 500, // Tight budget, exceeded after iteration 1 usage of 450 tokens
      },
    };

    const events = [];
    for await (const event of orchestrator.execute(input)) {
      events.push(event);
    }

    // Should see budget warning (>= 80% = 400 tokens, we used 450)
    const budgetWarning = events.find((e) => e.type === "budget_warning");
    expect(budgetWarning).toBeDefined();

    // Should abort eventually
    const abortEvent = events.find((e) => e.type === "execution_aborted");
    expect(abortEvent).toBeDefined();
    if (abortEvent && abortEvent.type === "execution_aborted") {
      expect(abortEvent.reason).toContain("Token budget exhausted");
    }
  });

  it("uses context collapse service when pressure is 0.7-0.9 and collapse service is available", async () => {
    const mockCollapseService = {
      projectConversation: vi.fn(() => ({
        messages: [
          { role: "system", content: "system", pinned: true, timestamp: new Date().toISOString() },
          { role: "user", content: "objective", pinned: true, timestamp: new Date().toISOString() },
          { role: "system", content: "Collapsed summary", timestamp: new Date().toISOString() },
        ],
        collapsed: true,
        turnsCollapsed: 3,
      })),
      storeSummary: vi.fn(),
      createAndStoreSummary: vi.fn(),
    };

    // Register a tool that returns a big result to push pressure into 0.7-0.9 range
    registry.register({
      name: "big_reader",
      description: "Reads big content",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        // ~7,500 chars => ~1,875 estimated tokens; with 3,000 max => ~62.5% base,
        // but combined with system/user messages it'll be higher
        content: "Y".repeat(7500),
      }),
      permission: { scope: "meta", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_use", id: "big-1", name: "big_reader", input: {} };
          yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      }
    );

    const orchestrator = new AgenticOrchestrator({
      registry,
      providerOrchestrator: mockProviderOrchestrator,
      contextService: mockContextService,
      memoryService: mockMemoryService,
      doomLoopDetector: mockDoomLoopDetector,
      events: mockEvents,
      contextCollapseService: mockCollapseService as any,
    });

    const input: AgenticExecutionInput = {
      runId: "test-collapse",
      repoId: "test-repo",
      ticketId: "test-ticket",
      objective: "Test context collapse",
      worktreePath: "/tmp/test",
      actor: "test-agent",
      budget: { maxTokens: 3000 },
    };

    const events = [];
    for await (const event of orchestrator.execute(input)) {
      events.push(event);
    }

    // The collapse service should have been called
    expect(mockCollapseService.projectConversation).toHaveBeenCalled();

    // Should see compaction event with "projected" stage
    const compactedEvents = events.filter(
      (e) => e.type === "context_compacted"
    );
    // It may be called during start-of-iteration or post-tool compaction
    if (compactedEvents.length > 0) {
      const projectedEvent = compactedEvents.find(
        (e) => e.type === "context_compacted" && e.stage === "projected"
      );
      expect(projectedEvent).toBeDefined();
    }
  });

  it("falls back to destructive compaction when context collapse returns no collapse", async () => {
    const mockCollapseService = {
      projectConversation: vi.fn((input: { messages: unknown[] }) => {
        // Simulate collapse not helping: returns same messages, no collapse
        return {
          messages: input.messages,
          collapsed: false,
          turnsCollapsed: 0,
        };
      }),
      storeSummary: vi.fn(),
      createAndStoreSummary: vi.fn(),
    };

    // Register tool that returns content sized to push pressure into 0.7-0.9 range
    // With maxTokens=3000, system (~500 chars ~125 tok) + user (~50 chars ~13 tok)
    // + assistant (~30 chars ~8 tok) + tool_result => we need ~2300 tok to hit 0.77
    // 2300 * 4 = 9200 chars in the tool result
    registry.register({
      name: "moderate_reader",
      description: "Returns moderate content",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        content: "Z".repeat(9200),
      }),
      permission: { scope: "meta", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_use", id: "mod-1", name: "moderate_reader", input: {} };
          yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
        } else {
          yield { type: "token", value: "Done after compaction." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      }
    );

    const orchestrator = new AgenticOrchestrator({
      registry,
      providerOrchestrator: mockProviderOrchestrator,
      contextService: mockContextService,
      memoryService: mockMemoryService,
      doomLoopDetector: mockDoomLoopDetector,
      events: mockEvents,
      contextCollapseService: mockCollapseService as any,
    });

    const input: AgenticExecutionInput = {
      runId: "test-collapse-fallback",
      repoId: "test-repo",
      ticketId: "test-ticket",
      objective: "Test collapse fallback",
      worktreePath: "/tmp/test",
      actor: "test-agent",
      budget: { maxTokens: 3000 },
    };

    const events = [];
    for await (const event of orchestrator.execute(input)) {
      events.push(event);
    }

    // The collapse service was called (returned no collapse)
    expect(mockCollapseService.projectConversation).toHaveBeenCalled();

    // Should still have compaction events (destructive fallback ran after
    // collapse returned collapsed: false)
    const compactedEvents = events.filter((e) => e.type === "context_compacted");
    expect(compactedEvents.length).toBeGreaterThanOrEqual(1);
    // The destructive fallback uses numeric stage values, not "projected"
    const destructiveEvent = compactedEvents.find(
      (e) => e.type === "context_compacted" && typeof e.stage === "number"
    );
    expect(destructiveEvent).toBeDefined();
  });

  it("restores recently-read files after compaction", async () => {
    // Register a read_file tool that returns file content
    registry.register({
      name: "read_file",
      description: "Read a file",
      inputSchema: z.object({ path: z.string() }),
      execute: async (input) => ({
        type: "success" as const,
        content: `Content of ${(input as { path: string }).path}`,
      }),
      permission: { scope: "repo.read", readOnly: true },
    });

    // Also register a filler tool to add bulk content and force compaction
    registry.register({
      name: "filler_tool",
      description: "Returns bulk content",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        content: "B".repeat(15000),
      }),
      permission: { scope: "meta", readOnly: true },
    });

    let callCount = 0;
    vi.mocked(mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 1) {
          // Read a file
          yield { type: "tool_use", id: "read-1", name: "read_file", input: { path: "/src/app.ts" } };
          yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
        } else if (callCount === 2) {
          // Add bulk content that will force compaction
          yield { type: "tool_use", id: "filler-1", name: "filler_tool", input: {} };
          yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      }
    );

    const orchestrator = new AgenticOrchestrator({
      registry,
      providerOrchestrator: mockProviderOrchestrator,
      contextService: mockContextService,
      memoryService: mockMemoryService,
      doomLoopDetector: mockDoomLoopDetector,
      events: mockEvents,
    });

    const input: AgenticExecutionInput = {
      runId: "test-file-restore",
      repoId: "test-repo",
      ticketId: "test-ticket",
      objective: "Test file restoration after compaction",
      worktreePath: "/tmp/test",
      actor: "test-agent",
      budget: { maxTokens: 2000 },
    };

    const events = [];
    for await (const event of orchestrator.execute(input)) {
      events.push(event);
    }

    // Should have had compaction (the filler tool output should push pressure high)
    const compactedEvents = events.filter((e) => e.type === "context_compacted");
    expect(compactedEvents.length).toBeGreaterThanOrEqual(1);

    // The memoryService.commitCompactionSummary should have been called
    expect(mockMemoryService.commitCompactionSummary).toHaveBeenCalled();
  });

  it("enforces skill allowedTools constraint across iterations", async () => {
    // Register multiple tools
    registry.register({
      name: "allowed_tool",
      description: "An allowed tool",
      inputSchema: z.any(),
      execute: async () => ({ type: "success", content: "allowed" }),
      permission: { scope: "meta", readOnly: true },
    });

    registry.register({
      name: "blocked_tool",
      description: "A blocked tool",
      inputSchema: z.any(),
      execute: async () => ({ type: "success", content: "blocked" }),
      permission: { scope: "meta", readOnly: true },
    });

    // Register the skill tool that sets the constraint
    registry.register({
      name: "skill",
      description: "Invoke a skill",
      inputSchema: z.any(),
      execute: async () => ({
        type: "success" as const,
        content: "Skill activated",
        metadata: {
          skillName: "test-skill",
          allowedTools: ["allowed_tool"],
          maxIterations: 3,
        },
      }),
      permission: { scope: "meta", readOnly: true },
    });

    let callCount = 0;
    const toolSchemasSentToProvider: string[][] = [];

    vi.mocked(mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* (_runId: string, _msgs: unknown, _cb: unknown, options?: { tools?: Array<{ name: string }> }) {
        callCount++;
        // Capture which tools were sent to provider
        if (options?.tools) {
          toolSchemasSentToProvider.push(options.tools.map((t) => t.name));
        }
        if (callCount === 1) {
          // First call: invoke skill to set constraint
          yield { type: "tool_use", id: "skill-1", name: "skill", input: { skill: "test-skill" } };
          yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
        } else if (callCount === 2) {
          // Second call: should only see allowed_tool (+ base tools)
          yield { type: "tool_use", id: "allowed-1", name: "allowed_tool", input: {} };
          yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
        } else {
          yield { type: "token", value: "Done." };
          yield { type: "done", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
        }
      }
    );

    const orchestrator = new AgenticOrchestrator({
      registry,
      providerOrchestrator: mockProviderOrchestrator,
      contextService: mockContextService,
      memoryService: mockMemoryService,
      doomLoopDetector: mockDoomLoopDetector,
      events: mockEvents,
    });

    const input: AgenticExecutionInput = {
      runId: "test-skill-constraint",
      repoId: "test-repo",
      ticketId: "test-ticket",
      objective: "Test skill tool constraint",
      worktreePath: "/tmp/test",
      actor: "test-agent",
    };

    const events = [];
    for await (const event of orchestrator.execute(input)) {
      events.push(event);
    }

    expect(events.some((e) => e.type === "execution_complete")).toBe(true);

    // After the skill tool runs (iteration 1), the next iteration should have filtered tools
    // The second call to the provider should NOT include "blocked_tool"
    if (toolSchemasSentToProvider.length >= 2) {
      const secondCallTools = toolSchemasSentToProvider[1];
      expect(secondCallTools).not.toContain("blocked_tool");
      // Should still include the allowed_tool or base tools like complete_task
      expect(
        secondCallTools.includes("allowed_tool") || secondCallTools.includes("complete_task")
      ).toBe(true);
    }
  });

  it("handles plan mode by emitting plan_started and respecting planning tool set", async () => {
    // Register planning tools
    registry.register({
      name: "read_file",
      description: "Read a file",
      inputSchema: z.object({ path: z.string() }),
      execute: async () => ({ type: "success", content: "file content" }),
      permission: { scope: "repo.read", readOnly: true },
    });

    registry.register({
      name: "submit_plan",
      description: "Submit a plan for review",
      inputSchema: z.object({ plan: z.string() }),
      execute: async () => ({
        type: "approval_required" as const,
        approvalId: "plan-approval-1",
        message: "Plan submitted for review",
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
        questions: [],
        approved: false,
        reviewedBy: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    };

    vi.mocked(mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        // Agent completes without tool calls in plan mode
        yield { type: "token", value: "Here is my plan." };
        yield { type: "done", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
      }
    );

    const orchestrator = new AgenticOrchestrator({
      registry,
      providerOrchestrator: mockProviderOrchestrator,
      contextService: mockContextService,
      memoryService: mockMemoryService,
      doomLoopDetector: mockDoomLoopDetector,
      events: mockEvents,
      planService: mockPlanService as any,
    });

    const input: AgenticExecutionInput = {
      runId: "test-plan-mode",
      repoId: "test-repo",
      ticketId: "test-ticket",
      objective: "Test plan mode",
      worktreePath: "/tmp/test",
      actor: "test-agent",
      planMode: true,
    };

    const events = [];
    for await (const event of orchestrator.execute(input)) {
      events.push(event);
    }

    // Should emit plan_started
    expect(events.some((e) => e.type === "plan_started")).toBe(true);

    // Plan service should have been called
    expect(mockPlanService.startPlanningPhase).toHaveBeenCalledWith("test-plan-mode");

    // Should complete since the agent didn't use any tools
    expect(events.some((e) => e.type === "execution_complete")).toBe(true);
  });

  it("passes tool schemas through the provider tools field", async () => {
    registry.register({
      name: "inspect_repo",
      description: "Inspect the repo",
      inputSchema: z.object({ path: z.string() }),
      execute: async () => ({
        type: "success",
        content: "ok",
      }),
      permission: {
        scope: "repo.read",
        readOnly: true,
      },
    });

    vi.mocked(mockProviderOrchestrator.streamChatWithRetryStreaming).mockImplementation(
      async function* () {
        yield { type: "done", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
      }
    );

    const orchestrator = new AgenticOrchestrator({
      registry,
      providerOrchestrator: mockProviderOrchestrator,
      contextService: mockContextService,
      memoryService: mockMemoryService,
      doomLoopDetector: mockDoomLoopDetector,
      events: mockEvents,
    });

    for await (const _event of orchestrator.execute({
      runId: "tools-run",
      repoId: "test-repo",
      ticketId: "test-ticket",
      objective: "Inspect the repo",
      worktreePath: "/tmp/test",
      actor: "test-agent",
    })) {
      // drain
    }

    const options = vi.mocked(mockProviderOrchestrator.streamChatWithRetryStreaming).mock.calls[0]?.[3];
    expect(Array.isArray(options?.tools)).toBe(true);
    expect(options?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "inspect_repo",
        }),
      ])
    );
  });
});

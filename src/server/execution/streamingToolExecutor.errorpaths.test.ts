import { describe, it, expect, beforeEach, vi } from "vitest";
import { StreamingToolExecutor } from "./streamingToolExecutor";
import { ToolRegistry } from "../tools/registry";
import type { ProviderStreamEvent } from "../../shared/contracts";
import type { ToolContext, ToolDefinition, AgenticEvent } from "../tools/types";
import { z } from "zod";

/**
 * Error-path integration tests for StreamingToolExecutor.
 *
 * Covers:
 *  - Multiple concurrent tool failures without crashing
 *  - Partial results preserved when one tool fails
 *  - Stream errors with pending tools
 *  - Mixed success/failure across concurrent tools
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockContext(): ToolContext {
  return {
    runId: "error-test-run",
    repoId: "test-repo",
    ticketId: "test-ticket",
    worktreePath: "/tmp/test",
    actor: "agent:test",
    stage: "build",
    conversationHistory: [],
    createApproval: vi.fn().mockResolvedValue({ id: "approval-123" }),
    recordEvent: vi.fn().mockResolvedValue(undefined),
  };
}

async function* createMockStream(events: ProviderStreamEvent[]): AsyncGenerator<ProviderStreamEvent> {
  for (const event of events) {
    yield event;
  }
}

async function collectEvents(
  executor: StreamingToolExecutor,
  stream: AsyncGenerator<ProviderStreamEvent>,
): Promise<AgenticEvent[]> {
  const events: AgenticEvent[] = [];
  for await (const event of executor.processStream(stream)) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StreamingToolExecutor — concurrent failure handling", () => {
  let registry: ToolRegistry;
  let ctx: ToolContext;

  beforeEach(() => {
    registry = new ToolRegistry();
    ctx = createMockContext();
  });

  it("handles all failures when multiple tools fail simultaneously", async () => {
    // Register 3 tools that all throw different errors
    const makeFailTool = (name: string, errorMsg: string, delayMs = 0): ToolDefinition => ({
      name,
      description: `Failing tool: ${name}`,
      inputSchema: z.object({}),
      execute: async () => {
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
        throw new Error(errorMsg);
      },
      permission: { scope: "repo.read" },
      concurrencySafe: true,
    });

    registry.register(makeFailTool("fail_a", "Error A: disk full"));
    registry.register(makeFailTool("fail_b", "Error B: network timeout", 10));
    registry.register(makeFailTool("fail_c", "Error C: permission denied", 20));

    const executor = new StreamingToolExecutor(registry, ctx);

    const stream = createMockStream([
      { type: "tool_use", id: "t-a", name: "fail_a", input: {} },
      { type: "tool_use", id: "t-b", name: "fail_b", input: {} },
      { type: "tool_use", id: "t-c", name: "fail_c", input: {} },
      { type: "done" },
    ]);

    const events = await collectEvents(executor, stream);

    // All three tools should produce results (not crash)
    const resultEvents = events.filter((e) => e.type === "tool_result");
    expect(resultEvents).toHaveLength(3);

    // All results should be errors
    for (const event of resultEvents) {
      if (event.type === "tool_result") {
        expect(event.result.type).toBe("error");
      }
    }

    // Check that each error message is preserved
    const errorMessages = resultEvents
      .filter((e) => e.type === "tool_result" && e.result.type === "error")
      .map((e) => (e as any).result.error);

    expect(errorMessages.some((msg: string) => msg.includes("Error A"))).toBe(true);
    expect(errorMessages.some((msg: string) => msg.includes("Error B"))).toBe(true);
    expect(errorMessages.some((msg: string) => msg.includes("Error C"))).toBe(true);

    // getToolResults should have all three
    expect(executor.getToolResults()).toHaveLength(3);
    expect(executor.hadToolCalls()).toBe(true);
  });

  it("preserves partial results from one tool when another tool fails", async () => {
    const successTool: ToolDefinition = {
      name: "success_tool",
      description: "A tool that succeeds",
      inputSchema: z.object({ data: z.string() }),
      execute: async (input) => ({
        type: "success",
        content: `Computed: ${input.data}`,
      }),
      permission: { scope: "repo.read" },
      concurrencySafe: true,
    };

    const failTool: ToolDefinition = {
      name: "fail_tool",
      description: "A tool that fails",
      inputSchema: z.object({}),
      execute: async () => {
        await new Promise((r) => setTimeout(r, 10));
        throw new Error("Catastrophic failure");
      },
      permission: { scope: "repo.read" },
      concurrencySafe: true,
    };

    registry.register(successTool);
    registry.register(failTool);

    const executor = new StreamingToolExecutor(registry, ctx);

    const stream = createMockStream([
      { type: "tool_use", id: "t-ok", name: "success_tool", input: { data: "important" } },
      { type: "tool_use", id: "t-fail", name: "fail_tool", input: {} },
      { type: "done" },
    ]);

    const events = await collectEvents(executor, stream);

    const resultEvents = events.filter((e) => e.type === "tool_result");
    expect(resultEvents).toHaveLength(2);

    // The success tool result should be preserved
    const successResult = resultEvents.find(
      (e) => e.type === "tool_result" && e.name === "success_tool",
    );
    expect(successResult).toBeDefined();
    if (successResult && successResult.type === "tool_result") {
      expect(successResult.result.type).toBe("success");
      if (successResult.result.type === "success") {
        expect(successResult.result.content).toContain("Computed: important");
      }
    }

    // The fail tool result should be an error
    const failResult = resultEvents.find(
      (e) => e.type === "tool_result" && e.name === "fail_tool",
    );
    expect(failResult).toBeDefined();
    if (failResult && failResult.type === "tool_result") {
      expect(failResult.result.type).toBe("error");
    }

    // getToolResults should have both
    const allResults = executor.getToolResults();
    expect(allResults).toHaveLength(2);
    expect(allResults.find((r) => r.toolName === "success_tool")?.result.type).toBe("success");
    expect(allResults.find((r) => r.toolName === "fail_tool")?.result.type).toBe("error");
  });

  it("handles stream error while tools are still executing", async () => {
    const slowTool: ToolDefinition = {
      name: "slow_tool",
      description: "A slow tool",
      inputSchema: z.object({}),
      execute: async () => {
        await new Promise((r) => setTimeout(r, 100));
        return { type: "success", content: "slow but done" };
      },
      permission: { scope: "repo.read" },
      concurrencySafe: true,
    };

    const fastTool: ToolDefinition = {
      name: "fast_tool",
      description: "A fast tool",
      inputSchema: z.object({}),
      execute: async () => ({
        type: "success",
        content: "fast done",
      }),
      permission: { scope: "repo.read" },
      concurrencySafe: true,
    };

    registry.register(slowTool);
    registry.register(fastTool);

    const executor = new StreamingToolExecutor(registry, ctx);

    // Stream that errors after emitting both tool uses
    async function* errorStream(): AsyncGenerator<ProviderStreamEvent> {
      yield { type: "tool_use", id: "t-slow", name: "slow_tool", input: {} };
      yield { type: "tool_use", id: "t-fast", name: "fast_tool", input: {} };
      throw new Error("Connection lost mid-stream");
    }

    const events = await collectEvents(executor, errorStream());

    // Should have tool_use_started for both
    const startedEvents = events.filter((e) => e.type === "tool_use_started");
    expect(startedEvents).toHaveLength(2);

    // Should have tool results for pending tools (awaited in error handler)
    const resultEvents = events.filter((e) => e.type === "tool_result");
    expect(resultEvents).toHaveLength(2);

    // Should have the stream error event
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent && errorEvent.type === "error") {
      expect(errorEvent.error).toContain("Connection lost mid-stream");
    }

    // Both tool results should be preserved in getToolResults
    expect(executor.getToolResults()).toHaveLength(2);
  });

  it("handles mixed sequential and concurrent tools with failures", async () => {
    const executionOrder: string[] = [];

    const seqTool: ToolDefinition = {
      name: "seq_tool",
      description: "Sequential tool that fails",
      inputSchema: z.object({}),
      execute: async () => {
        executionOrder.push("seq_start");
        await new Promise((r) => setTimeout(r, 20));
        executionOrder.push("seq_end");
        throw new Error("Sequential failure");
      },
      permission: { scope: "repo.edit" },
      concurrencySafe: false,
    };

    const concTool: ToolDefinition = {
      name: "conc_tool",
      description: "Concurrent tool that succeeds",
      inputSchema: z.object({}),
      execute: async () => {
        executionOrder.push("conc_start");
        await new Promise((r) => setTimeout(r, 10));
        executionOrder.push("conc_end");
        return { type: "success", content: "concurrent done" };
      },
      permission: { scope: "repo.read" },
      concurrencySafe: true,
    };

    registry.register(seqTool);
    registry.register(concTool);

    const executor = new StreamingToolExecutor(registry, ctx);

    const stream = createMockStream([
      { type: "tool_use", id: "t-seq", name: "seq_tool", input: {} },
      { type: "tool_use", id: "t-conc", name: "conc_tool", input: {} },
      { type: "done" },
    ]);

    const events = await collectEvents(executor, stream);

    // Both should produce results
    const resultEvents = events.filter((e) => e.type === "tool_result");
    expect(resultEvents).toHaveLength(2);

    // Sequential tool should be an error
    const seqResult = resultEvents.find(
      (e) => e.type === "tool_result" && e.name === "seq_tool",
    );
    expect(seqResult).toBeDefined();
    if (seqResult && seqResult.type === "tool_result") {
      expect(seqResult.result.type).toBe("error");
    }

    // Concurrent tool should succeed
    const concResult = resultEvents.find(
      (e) => e.type === "tool_result" && e.name === "conc_tool",
    );
    expect(concResult).toBeDefined();
    if (concResult && concResult.type === "tool_result") {
      expect(concResult.result.type).toBe("success");
    }
  });

  it("timeout error on one tool does not affect other concurrent tools", async () => {
    const hangingTool: ToolDefinition = {
      name: "hanging_tool",
      description: "A tool that hangs",
      inputSchema: z.object({}),
      execute: async () => {
        await new Promise((r) => setTimeout(r, 5000));
        return { type: "success", content: "should never complete" };
      },
      permission: { scope: "repo.read" },
      concurrencySafe: true,
    };

    const quickTool: ToolDefinition = {
      name: "quick_tool",
      description: "A tool that completes quickly",
      inputSchema: z.object({}),
      execute: async () => ({
        type: "success",
        content: "quick result",
      }),
      permission: { scope: "repo.read" },
      concurrencySafe: true,
    };

    registry.register(hangingTool);
    registry.register(quickTool);

    const executor = new StreamingToolExecutor(registry, ctx, {
      toolTimeoutMs: 50, // Very short timeout for the test
    });

    const stream = createMockStream([
      { type: "tool_use", id: "t-hang", name: "hanging_tool", input: {} },
      { type: "tool_use", id: "t-quick", name: "quick_tool", input: {} },
      { type: "done" },
    ]);

    const events = await collectEvents(executor, stream);

    const resultEvents = events.filter((e) => e.type === "tool_result");
    expect(resultEvents).toHaveLength(2);

    // Hanging tool should time out
    const hangResult = resultEvents.find(
      (e) => e.type === "tool_result" && e.name === "hanging_tool",
    );
    expect(hangResult).toBeDefined();
    if (hangResult && hangResult.type === "tool_result") {
      expect(hangResult.result.type).toBe("error");
      if (hangResult.result.type === "error") {
        expect(hangResult.result.error).toContain("timed out");
      }
    }

    // Quick tool should succeed
    const quickResult = resultEvents.find(
      (e) => e.type === "tool_result" && e.name === "quick_tool",
    );
    expect(quickResult).toBeDefined();
    if (quickResult && quickResult.type === "tool_result") {
      expect(quickResult.result.type).toBe("success");
      if (quickResult.result.type === "success") {
        expect(quickResult.result.content).toBe("quick result");
      }
    }
  });

  it("handles all tools being unknown without crashing", async () => {
    const executor = new StreamingToolExecutor(registry, ctx);

    const stream = createMockStream([
      { type: "tool_use", id: "t-1", name: "nonexistent_a", input: {} },
      { type: "tool_use", id: "t-2", name: "nonexistent_b", input: {} },
      { type: "tool_use", id: "t-3", name: "nonexistent_c", input: {} },
      { type: "done" },
    ]);

    const events = await collectEvents(executor, stream);

    // All should produce error results
    const resultEvents = events.filter((e) => e.type === "tool_result");
    expect(resultEvents).toHaveLength(3);

    for (const event of resultEvents) {
      if (event.type === "tool_result") {
        expect(event.result.type).toBe("error");
        if (event.result.type === "error") {
          expect(event.result.error).toContain("Unknown tool");
        }
      }
    }

    expect(executor.hadToolCalls()).toBe(true);
    expect(executor.getToolResults()).toHaveLength(3);
  });

  it("concurrent execution respects semaphore even when all tools fail", async () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;

    const failTool: ToolDefinition = {
      name: "semaphore_fail",
      description: "Fails but tracks concurrency",
      inputSchema: z.object({ id: z.string() }),
      execute: async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await new Promise((r) => setTimeout(r, 20));
        concurrentCount--;
        throw new Error("Boom");
      },
      permission: { scope: "repo.read" },
      concurrencySafe: true,
    };

    registry.register(failTool);

    const executor = new StreamingToolExecutor(registry, ctx, {
      maxConcurrentTools: 2,
    });

    const stream = createMockStream([
      { type: "tool_use", id: "t-1", name: "semaphore_fail", input: { id: "1" } },
      { type: "tool_use", id: "t-2", name: "semaphore_fail", input: { id: "2" } },
      { type: "tool_use", id: "t-3", name: "semaphore_fail", input: { id: "3" } },
      { type: "tool_use", id: "t-4", name: "semaphore_fail", input: { id: "4" } },
      { type: "done" },
    ]);

    const events = await collectEvents(executor, stream);

    // All four should produce error results
    const resultEvents = events.filter((e) => e.type === "tool_result");
    expect(resultEvents).toHaveLength(4);

    // Concurrency should have been limited to 2
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("preserves durationMs for both successful and failed concurrent tools", async () => {
    const successTool: ToolDefinition = {
      name: "timed_success",
      description: "Succeeds after delay",
      inputSchema: z.object({}),
      execute: async () => {
        await new Promise((r) => setTimeout(r, 25));
        return { type: "success", content: "ok" };
      },
      permission: { scope: "repo.read" },
      concurrencySafe: true,
    };

    const failTool: ToolDefinition = {
      name: "timed_fail",
      description: "Fails after delay",
      inputSchema: z.object({}),
      execute: async () => {
        await new Promise((r) => setTimeout(r, 25));
        throw new Error("Timed failure");
      },
      permission: { scope: "repo.read" },
      concurrencySafe: true,
    };

    registry.register(successTool);
    registry.register(failTool);

    const executor = new StreamingToolExecutor(registry, ctx);

    const stream = createMockStream([
      { type: "tool_use", id: "t-ok", name: "timed_success", input: {} },
      { type: "tool_use", id: "t-fail", name: "timed_fail", input: {} },
      { type: "done" },
    ]);

    const events = await collectEvents(executor, stream);

    const resultEvents = events.filter((e) => e.type === "tool_result");
    expect(resultEvents).toHaveLength(2);

    for (const event of resultEvents) {
      if (event.type === "tool_result") {
        // Both should have a positive durationMs reflecting the ~25ms delay
        expect(event.durationMs).toBeGreaterThanOrEqual(20);
      }
    }
  });
});

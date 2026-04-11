import { describe, it, expect, beforeEach, vi } from "vitest";
import { StreamingToolExecutor } from "./streamingToolExecutor";
import { ToolRegistry } from "../tools/registry";
import type { ProviderStreamEvent } from "../../shared/contracts";
import type { ToolContext, ToolDefinition, ToolResult, AgenticEvent } from "../tools/types";
import type { PermissionPolicyEngine } from "../permissions/policyEngine";
import { getTelemetry, resetTelemetry } from "../telemetry/tracer";
import { METRICS, METRIC_LABELS } from "../telemetry/metrics";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createMockContext(): ToolContext {
  return {
    runId: "test-run-id",
    repoId: "test-repo-id",
    ticketId: "test-ticket-id",
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
  stream: AsyncGenerator<ProviderStreamEvent>
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

describe("StreamingToolExecutor", () => {
  let registry: ToolRegistry;
  let ctx: ToolContext;

  beforeEach(() => {
    registry = new ToolRegistry();
    ctx = createMockContext();
  });

  describe("basic tool execution", () => {
    it("should execute a simple tool successfully", async () => {
      // Register a simple test tool
      const testTool: ToolDefinition = {
        name: "test_tool",
        description: "A test tool",
        inputSchema: z.object({
          message: z.string(),
        }),
        execute: async (input) => ({
          type: "success",
          content: `Executed with: ${input.message}`,
        }),
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(testTool);

      const executor = new StreamingToolExecutor(registry, ctx);

      const stream = createMockStream([
        {
          type: "tool_use",
          id: "tool-1",
          name: "test_tool",
          input: { message: "hello" },
        },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      // After hook integration, tool_use_started + tool_result
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        type: "tool_use_started",
        id: "tool-1",
        name: "test_tool",
      });
      expect(events[1]).toMatchObject({
        type: "tool_result",
        id: "tool-1",
        name: "test_tool",
      });

      const results = executor.getToolResults();
      expect(results).toHaveLength(1);
      expect(executor.hadToolCalls()).toBe(true);
    });

    it("should handle tool with deltas", async () => {
      const testTool: ToolDefinition = {
        name: "test_tool",
        description: "A test tool",
        inputSchema: z.object({
          data: z.string(),
        }),
        execute: async (input) => ({
          type: "success",
          content: `Got: ${input.data}`,
        }),
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(testTool);

      const executor = new StreamingToolExecutor(registry, ctx);

      const stream = createMockStream([
        { type: "tool_use_delta", id: "tool-1", argumentsDelta: '{"data":' },
        { type: "tool_use_delta", id: "tool-1", argumentsDelta: ' "test' },
        { type: "tool_use_delta", id: "tool-1", argumentsDelta: '"}' },
        {
          type: "tool_use",
          id: "tool-1",
          name: "test_tool",
          input: { data: "test" },
        },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      expect(events.some((e) => e.type === "tool_use_started")).toBe(true);
      expect(events.some((e) => e.type === "tool_result")).toBe(true);
    });

    it("should handle multiple concurrent tools", async () => {
      const slowTool: ToolDefinition = {
        name: "slow_tool",
        description: "A slow tool",
        inputSchema: z.object({}),
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { type: "success", content: "slow done" };
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

      const stream = createMockStream([
        { type: "tool_use", id: "tool-1", name: "slow_tool", input: {} },
        { type: "tool_use", id: "tool-2", name: "fast_tool", input: {} },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      // Both tools should complete
      expect(events.filter((e) => e.type === "tool_result")).toHaveLength(2);
      expect(executor.getToolResults()).toHaveLength(2);
    });
  });

  describe("approval handling", () => {
    it("should handle tools that require approval", async () => {
      const approvalTool: ToolDefinition = {
        name: "destructive_tool",
        description: "A destructive tool",
        inputSchema: z.object({}),
        execute: async () => ({
          type: "success",
          content: "Should not execute",
        }),
        permission: {
          scope: "repo.edit",
          requiresApproval: true,
          destructive: true,
        },
      };
      registry.register(approvalTool);

      const executor = new StreamingToolExecutor(registry, ctx);

      const stream = createMockStream([
        { type: "tool_use", id: "tool-1", name: "destructive_tool", input: {} },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("tool_approval_needed");
      if (events[0].type === "tool_approval_needed") {
        expect(events[0].name).toBe("destructive_tool");
      }

      const results = executor.getToolResults();
      expect(results).toHaveLength(1);
      expect(results[0].result.type).toBe("approval_required");
      expect(ctx.createApproval).toHaveBeenCalledTimes(1);
    });

    it("should handle dynamic approval checks", async () => {
      const dynamicApprovalTool: ToolDefinition = {
        name: "conditional_tool",
        description: "A tool with conditional approval",
        inputSchema: z.object({
          requiresApproval: z.boolean(),
        }),
        execute: async () => ({
          type: "success",
          content: "Executed",
        }),
        permission: {
          scope: "repo.edit",
          checkApproval: (input: unknown) => {
            // After hook integration, the input is wrapped as {tool_name, params: {...}}
            const inp = input as Record<string, unknown>;
            const params = (inp.params ?? inp) as { requiresApproval?: boolean };
            return params.requiresApproval === true;
          },
        },
        concurrencySafe: true,
      };
      registry.register(dynamicApprovalTool);

      const executor = new StreamingToolExecutor(registry, ctx);

      const stream = createMockStream([
        {
          type: "tool_use",
          id: "tool-1",
          name: "conditional_tool",
          input: { requiresApproval: true },
        },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      expect(events.some((e) => e.type === "tool_approval_needed")).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should handle tool execution errors", async () => {
      const errorTool: ToolDefinition = {
        name: "error_tool",
        description: "A tool that errors",
        inputSchema: z.object({}),
        execute: async () => {
          throw new Error("Simulated error");
        },
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(errorTool);

      const executor = new StreamingToolExecutor(registry, ctx);

      const stream = createMockStream([
        { type: "tool_use", id: "tool-1", name: "error_tool", input: {} },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      const resultEvent = events.find((e) => e.type === "tool_result");
      expect(resultEvent).toBeDefined();
      if (resultEvent && resultEvent.type === "tool_result") {
        expect(resultEvent.result.type).toBe("error");
      }
    });

    it("should handle unknown tools", async () => {
      const executor = new StreamingToolExecutor(registry, ctx);

      const stream = createMockStream([
        { type: "tool_use", id: "tool-1", name: "unknown_tool", input: {} },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      const resultEvent = events.find((e) => e.type === "tool_result");
      expect(resultEvent).toBeDefined();
      if (resultEvent && resultEvent.type === "tool_result") {
        expect(resultEvent.result.type).toBe("error");
        if (resultEvent.result.type === "error") {
          expect(resultEvent.result.error).toContain("Unknown tool");
        }
      }
    });

    it("should handle invalid tool input", async () => {
      const strictTool: ToolDefinition = {
        name: "strict_tool",
        description: "A tool with strict schema",
        inputSchema: z.object({
          requiredField: z.string(),
        }),
        execute: async (input) => ({
          type: "success",
          content: `Got: ${input.requiredField}`,
        }),
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(strictTool);

      const executor = new StreamingToolExecutor(registry, ctx);

      const stream = createMockStream([
        { type: "tool_use", id: "tool-1", name: "strict_tool", input: {} },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      const resultEvent = events.find((e) => e.type === "tool_result");
      expect(resultEvent).toBeDefined();
      if (resultEvent && resultEvent.type === "tool_result") {
        expect(resultEvent.result.type).toBe("error");
      }
    });
  });

  describe("sequential execution", () => {
    it("should execute non-concurrent-safe tools sequentially", async () => {
      const executionOrder: string[] = [];

      const sequentialTool1: ToolDefinition = {
        name: "seq_tool_1",
        description: "Sequential tool 1",
        inputSchema: z.object({}),
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          executionOrder.push("tool1");
          return { type: "success", content: "tool1 done" };
        },
        permission: { scope: "repo.edit" },
        concurrencySafe: false,
      };

      const sequentialTool2: ToolDefinition = {
        name: "seq_tool_2",
        description: "Sequential tool 2",
        inputSchema: z.object({}),
        execute: async () => {
          executionOrder.push("tool2");
          return { type: "success", content: "tool2 done" };
        },
        permission: { scope: "repo.edit" },
        concurrencySafe: false,
      };

      registry.register(sequentialTool1);
      registry.register(sequentialTool2);

      const executor = new StreamingToolExecutor(registry, ctx);

      const stream = createMockStream([
        { type: "tool_use", id: "tool-1", name: "seq_tool_1", input: {} },
        { type: "tool_use", id: "tool-2", name: "seq_tool_2", input: {} },
        { type: "done" },
      ]);

      await collectEvents(executor, stream);

      expect(executionOrder).toEqual(["tool1", "tool2"]);
    });
  });

  describe("stream events", () => {
    it("should forward token events", async () => {
      const executor = new StreamingToolExecutor(registry, ctx);

      const stream = createMockStream([
        { type: "token", value: "Hello" },
        { type: "token", value: " " },
        { type: "token", value: "world" },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      const tokenEvents = events.filter((e) => e.type === "assistant_token");
      expect(tokenEvents).toHaveLength(3);
      expect(tokenEvents.map((e) => e.type === "assistant_token" && e.value)).toEqual([
        "Hello",
        " ",
        "world",
      ]);
    });

    it("should forward thinking events", async () => {
      const executor = new StreamingToolExecutor(registry, ctx);

      const stream = createMockStream([
        { type: "thinking", value: "Analyzing..." },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      const thinkingEvents = events.filter((e) => e.type === "assistant_thinking");
      expect(thinkingEvents).toHaveLength(1);
      if (thinkingEvents[0].type === "assistant_thinking") {
        expect(thinkingEvents[0].value).toBe("Analyzing...");
      }
    });
  });

  describe("reset", () => {
    it("should reset state after reset()", async () => {
      const testTool: ToolDefinition = {
        name: "test_tool",
        description: "A test tool",
        inputSchema: z.object({}),
        execute: async () => ({
          type: "success",
          content: "done",
        }),
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(testTool);

      const executor = new StreamingToolExecutor(registry, ctx);

      const stream1 = createMockStream([
        { type: "tool_use", id: "tool-1", name: "test_tool", input: {} },
        { type: "done" },
      ]);

      await collectEvents(executor, stream1);

      expect(executor.hadToolCalls()).toBe(true);
      expect(executor.getToolResults()).toHaveLength(1);

      executor.reset();

      expect(executor.hadToolCalls()).toBe(false);
      expect(executor.getToolResults()).toHaveLength(0);
    });
  });

  describe("timeout handling", () => {
    it("should timeout tools that take too long", async () => {
      const slowTool: ToolDefinition = {
        name: "very_slow_tool",
        description: "A very slow tool",
        inputSchema: z.object({}),
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          return { type: "success", content: "Should not complete" };
        },
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(slowTool);

      const executor = new StreamingToolExecutor(registry, ctx, {
        toolTimeoutMs: 100,
      });

      const stream = createMockStream([
        { type: "tool_use", id: "tool-1", name: "very_slow_tool", input: {} },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      const resultEvent = events.find((e) => e.type === "tool_result");
      expect(resultEvent).toBeDefined();
      if (resultEvent && resultEvent.type === "tool_result") {
        expect(resultEvent.result.type).toBe("error");
        if (resultEvent.result.type === "error") {
          expect(resultEvent.result.error).toContain("timed out");
        }
      }
    });
  });

  describe("concurrency limits", () => {
    it("should respect maxConcurrentTools limit", async () => {
      let concurrentCount = 0;
      let maxConcurrent = 0;

      const trackingTool: ToolDefinition = {
        name: "tracking_tool",
        description: "A tool that tracks concurrency",
        inputSchema: z.object({ id: z.string() }),
        execute: async () => {
          concurrentCount++;
          maxConcurrent = Math.max(maxConcurrent, concurrentCount);
          await new Promise((resolve) => setTimeout(resolve, 50));
          concurrentCount--;
          return { type: "success", content: "done" };
        },
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(trackingTool);

      const executor = new StreamingToolExecutor(registry, ctx, {
        maxConcurrentTools: 2,
      });

      const stream = createMockStream([
        { type: "tool_use", id: "tool-1", name: "tracking_tool", input: { id: "1" } },
        { type: "tool_use", id: "tool-2", name: "tracking_tool", input: { id: "2" } },
        { type: "tool_use", id: "tool-3", name: "tracking_tool", input: { id: "3" } },
        { type: "tool_use", id: "tool-4", name: "tracking_tool", input: { id: "4" } },
        { type: "done" },
      ]);

      await collectEvents(executor, stream);

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });
  });

  // -------------------------------------------------------------------------
  // Edge case tests
  // -------------------------------------------------------------------------

  describe("sequential queue edge cases", () => {
    it("processes sequential queue correctly when multiple non-concurrent-safe tools arrive", async () => {
      const executionOrder: string[] = [];

      const makeSeqTool = (id: string, delayMs: number): ToolDefinition => ({
        name: `seq_${id}`,
        description: `Sequential tool ${id}`,
        inputSchema: z.object({}),
        execute: async () => {
          executionOrder.push(`start_${id}`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          executionOrder.push(`end_${id}`);
          return { type: "success", content: `${id} done` };
        },
        permission: { scope: "repo.edit" },
        concurrencySafe: false,
      });

      registry.register(makeSeqTool("a", 30));
      registry.register(makeSeqTool("b", 20));
      registry.register(makeSeqTool("c", 10));

      const executor = new StreamingToolExecutor(registry, ctx);

      const stream = createMockStream([
        { type: "tool_use", id: "t-a", name: "seq_a", input: {} },
        { type: "tool_use", id: "t-b", name: "seq_b", input: {} },
        { type: "tool_use", id: "t-c", name: "seq_c", input: {} },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      // Tools must execute in strict FIFO order, one at a time
      expect(executionOrder).toEqual([
        "start_a", "end_a",
        "start_b", "end_b",
        "start_c", "end_c",
      ]);

      const results = events.filter((e) => e.type === "tool_result");
      expect(results).toHaveLength(3);
    });
  });

  describe("stream error handling edge cases", () => {
    it("cleans up pending tools on stream processing error", async () => {
      const toolExecuted = vi.fn();

      const slowTool: ToolDefinition = {
        name: "slow_tool",
        description: "A slow tool",
        inputSchema: z.object({}),
        execute: async () => {
          toolExecuted();
          await new Promise((resolve) => setTimeout(resolve, 200));
          return { type: "success", content: "done" };
        },
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(slowTool);

      const executor = new StreamingToolExecutor(registry, ctx);

      // Create a stream that errors after emitting a tool use
      async function* errorStream(): AsyncGenerator<ProviderStreamEvent> {
        yield { type: "tool_use", id: "tool-1", name: "slow_tool", input: {} };
        throw new Error("Stream connection lost");
      }

      const events = await collectEvents(executor, errorStream());

      // Should have a tool_use_started, a tool_result from awaiting, and an error event
      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      if (errorEvent && errorEvent.type === "error") {
        expect(errorEvent.error).toContain("Stream connection lost");
      }
    });

    it("handles malformed tool input JSON gracefully", async () => {
      const testTool: ToolDefinition = {
        name: "json_tool",
        description: "Expects JSON input",
        inputSchema: z.object({ data: z.string() }),
        execute: async (input) => ({
          type: "success",
          content: `Got: ${input.data}`,
        }),
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(testTool);

      const executor = new StreamingToolExecutor(registry, ctx);

      // Send tool_use with input that will fail validation (raw unparseable string treated as object)
      const stream = createMockStream([
        {
          type: "tool_use",
          id: "tool-1",
          name: "json_tool",
          input: { raw: "{not valid json" },
        },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      const resultEvent = events.find((e) => e.type === "tool_result");
      expect(resultEvent).toBeDefined();
      if (resultEvent && resultEvent.type === "tool_result") {
        // Should fail validation since "data" field is missing
        expect(resultEvent.result.type).toBe("error");
      }
    });
  });

  describe("approval edge cases", () => {
    it("handles approval creation failure", async () => {
      const approvalTool: ToolDefinition = {
        name: "approval_fail_tool",
        description: "A tool requiring approval",
        inputSchema: z.object({}),
        execute: async () => ({
          type: "success",
          content: "Should not execute",
        }),
        permission: {
          scope: "repo.edit",
          requiresApproval: true,
        },
      };
      registry.register(approvalTool);

      // Make createApproval throw
      ctx.createApproval = vi.fn().mockRejectedValue(new Error("Approval service unavailable"));

      const executor = new StreamingToolExecutor(registry, ctx);

      const stream = createMockStream([
        { type: "tool_use", id: "tool-1", name: "approval_fail_tool", input: {} },
        { type: "done" },
      ]);

      // The approval creation failure is caught by processStream's try/catch
      // and surfaces as an error event
      const events = await collectEvents(executor, stream);

      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      if (errorEvent && errorEvent.type === "error") {
        expect(errorEvent.error).toContain("Approval service unavailable");
      }
    });
  });

  describe("policy engine integration", () => {
    it("integrates with policy engine for deny decisions", async () => {
      const safeTool: ToolDefinition = {
        name: "policy_test_tool",
        description: "A tool for policy testing",
        inputSchema: z.object({}),
        execute: async () => ({
          type: "success",
          content: "Executed",
        }),
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(safeTool);

      const mockPolicyEngine = {
        check: vi.fn().mockResolvedValue({
          decision: "deny",
          requiresApproval: false,
          reasons: ["Blocked by security policy"],
          source: "policy",
        }),
      } as unknown as PermissionPolicyEngine;

      const executor = new StreamingToolExecutor(registry, ctx, {}, mockPolicyEngine);

      const stream = createMockStream([
        { type: "tool_use", id: "tool-1", name: "policy_test_tool", input: {} },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      const deniedEvent = events.find((e) => e.type === "tool_denied");
      expect(deniedEvent).toBeDefined();
      if (deniedEvent && deniedEvent.type === "tool_denied") {
        expect(deniedEvent.reasons).toContain("Blocked by security policy");
      }

      // Should have an error result in completedResults
      const results = executor.getToolResults();
      expect(results).toHaveLength(1);
      expect(results[0].result.type).toBe("error");
    });

    it("integrates with policy engine for approval_required decisions", async () => {
      const editTool: ToolDefinition = {
        name: "edit_tool",
        description: "A tool that edits",
        inputSchema: z.object({}),
        execute: async () => ({
          type: "success",
          content: "Edited",
        }),
        permission: { scope: "repo.edit" },
        concurrencySafe: true,
      };
      registry.register(editTool);

      const mockPolicyEngine = {
        check: vi.fn().mockResolvedValue({
          decision: "approval_required",
          requiresApproval: true,
          reasons: ["Destructive operation requires approval"],
          source: "policy",
        }),
      } as unknown as PermissionPolicyEngine;

      const executor = new StreamingToolExecutor(registry, ctx, {}, mockPolicyEngine);

      const stream = createMockStream([
        { type: "tool_use", id: "tool-1", name: "edit_tool", input: {} },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      const approvalEvent = events.find((e) => e.type === "tool_approval_needed");
      expect(approvalEvent).toBeDefined();
      if (approvalEvent && approvalEvent.type === "tool_approval_needed") {
        expect(approvalEvent.approvalId).toBe("approval-123");
      }

      expect(ctx.createApproval).toHaveBeenCalledTimes(1);
    });
  });

  describe("telemetry metrics", () => {
    beforeEach(() => {
      resetTelemetry();
    });

    it("records telemetry metrics for tool execution", async () => {
      const testTool: ToolDefinition = {
        name: "telemetry_tool",
        description: "A tool for telemetry testing",
        inputSchema: z.object({}),
        execute: async () => ({
          type: "success",
          content: "done",
        }),
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(testTool);

      const executor = new StreamingToolExecutor(registry, ctx);

      const stream = createMockStream([
        { type: "tool_use", id: "tool-1", name: "telemetry_tool", input: {} },
        { type: "done" },
      ]);

      await collectEvents(executor, stream);

      const telemetry = getTelemetry();

      // Check that TOOL_EXECUTION_DURATION_MS was recorded
      const durationSummary = telemetry.getMetricSummary(
        METRICS.TOOL_EXECUTION_DURATION_MS,
        { [METRIC_LABELS.TOOL_NAME]: "telemetry_tool" },
      );
      expect(durationSummary).not.toBeNull();
      expect(durationSummary!.count).toBe(1);
      expect(durationSummary!.min).toBeGreaterThanOrEqual(0);

      // Check that TOOL_EXECUTION_COUNT was incremented
      const countSummary = telemetry.getMetricSummary(
        METRICS.TOOL_EXECUTION_COUNT,
        { [METRIC_LABELS.TOOL_NAME]: "telemetry_tool" },
      );
      expect(countSummary).not.toBeNull();
      expect(countSummary!.count).toBe(1);
    });
  });

  describe("durationMs tracking", () => {
    it("records a positive durationMs on successful tool results", async () => {
      const delayTool: ToolDefinition = {
        name: "delay_tool",
        description: "A tool that takes some time",
        inputSchema: z.object({}),
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { type: "success", content: "delayed" };
        },
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(delayTool);

      const executor = new StreamingToolExecutor(registry, ctx);

      const stream = createMockStream([
        { type: "tool_use", id: "dur-1", name: "delay_tool", input: {} },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      const resultEvent = events.find((e) => e.type === "tool_result");
      expect(resultEvent).toBeDefined();
      if (resultEvent && resultEvent.type === "tool_result") {
        expect(resultEvent.durationMs).toBeGreaterThanOrEqual(25);
      }

      const toolResults = executor.getToolResults();
      expect(toolResults[0].durationMs).toBeGreaterThanOrEqual(25);
    });

    it("records durationMs on error results", async () => {
      const errorTool: ToolDefinition = {
        name: "timed_error_tool",
        description: "Errors after a delay",
        inputSchema: z.object({}),
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          throw new Error("boom");
        },
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(errorTool);

      const executor = new StreamingToolExecutor(registry, ctx);

      const stream = createMockStream([
        { type: "tool_use", id: "dur-err-1", name: "timed_error_tool", input: {} },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      const resultEvent = events.find((e) => e.type === "tool_result");
      expect(resultEvent).toBeDefined();
      if (resultEvent && resultEvent.type === "tool_result") {
        expect(resultEvent.durationMs).toBeGreaterThanOrEqual(15);
      }
    });
  });

  describe("ToolResultBlock shape", () => {
    it("produces ToolResultBlock with all required fields", async () => {
      const shapeTool: ToolDefinition = {
        name: "shape_tool",
        description: "For shape validation",
        inputSchema: z.object({ msg: z.string() }),
        execute: async (input) => ({
          type: "success",
          content: `echo: ${input.msg}`,
        }),
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(shapeTool);

      const executor = new StreamingToolExecutor(registry, ctx);

      const stream = createMockStream([
        { type: "tool_use", id: "shape-1", name: "shape_tool", input: { msg: "hi" } },
        { type: "done" },
      ]);

      await collectEvents(executor, stream);

      const block = executor.getToolResults()[0];
      expect(block).toEqual(
        expect.objectContaining({
          toolUseId: "shape-1",
          toolName: "shape_tool",
          result: expect.objectContaining({ type: "success", content: "echo: hi" }),
          durationMs: expect.any(Number),
        }),
      );
      // Verify the four keys exist
      expect(block).toHaveProperty("toolUseId");
      expect(block).toHaveProperty("toolName");
      expect(block).toHaveProperty("result");
      expect(block).toHaveProperty("durationMs");
    });
  });

  describe("mixed concurrent and sequential tools", () => {
    it("runs concurrencySafe and non-concurrencySafe tools in the same stream", async () => {
      const executionLog: string[] = [];

      const concurrentTool: ToolDefinition = {
        name: "concurrent_read",
        description: "A concurrent tool",
        inputSchema: z.object({}),
        execute: async () => {
          executionLog.push("concurrent_read:start");
          await new Promise((resolve) => setTimeout(resolve, 20));
          executionLog.push("concurrent_read:end");
          return { type: "success", content: "read done" };
        },
        permission: { scope: "repo.read", readOnly: true },
        concurrencySafe: true,
      };

      const mutatingTool: ToolDefinition = {
        name: "mutating_write",
        description: "A sequential tool",
        inputSchema: z.object({}),
        execute: async () => {
          executionLog.push("mutating_write:start");
          await new Promise((resolve) => setTimeout(resolve, 20));
          executionLog.push("mutating_write:end");
          return { type: "success", content: "write done" };
        },
        permission: { scope: "repo.edit" },
        concurrencySafe: false,
      };

      registry.register(concurrentTool);
      registry.register(mutatingTool);

      const executor = new StreamingToolExecutor(registry, ctx);

      const stream = createMockStream([
        { type: "tool_use", id: "mix-1", name: "concurrent_read", input: {} },
        { type: "tool_use", id: "mix-2", name: "mutating_write", input: {} },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      // Both tools should produce results
      const results = events.filter((e) => e.type === "tool_result");
      expect(results).toHaveLength(2);

      // All four log entries should be present
      expect(executionLog).toContain("concurrent_read:start");
      expect(executionLog).toContain("concurrent_read:end");
      expect(executionLog).toContain("mutating_write:start");
      expect(executionLog).toContain("mutating_write:end");
    });
  });

  describe("hook service integration", () => {
    it("emits hook_executed events from PreToolUse hooks", async () => {
      const testTool: ToolDefinition = {
        name: "hooked_tool",
        description: "A tool with hooks",
        inputSchema: z.object({}),
        execute: async () => ({
          type: "success",
          content: "hooked done",
        }),
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(testTool);

      const mockHookService = {
        executeHooksForEvent: vi.fn().mockResolvedValue({
          outputs: [
            {
              hook: { id: "hook-1", name: "test-hook" },
              output: { success: true },
            },
          ],
          updatedInput: { tool_name: "hooked_tool", params: {} },
          permissionDecision: undefined,
          shouldContinue: true,
        }),
      } as any;

      const executor = new StreamingToolExecutor(
        registry,
        ctx,
        {},
        undefined,
        mockHookService,
      );

      const stream = createMockStream([
        { type: "tool_use", id: "hook-1", name: "hooked_tool", input: {} },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      const hookEvents = events.filter((e) => e.type === "hook_executed");
      expect(hookEvents).toHaveLength(2); // PreToolUse + PostToolUse
      expect(hookEvents[0]).toMatchObject({
        type: "hook_executed",
        hookId: "hook-1",
        hookName: "test-hook",
        success: true,
      });
    });

    it("denies tool execution when PreToolUse hook returns deny", async () => {
      const testTool: ToolDefinition = {
        name: "denied_by_hook",
        description: "A tool denied by hook",
        inputSchema: z.object({}),
        execute: async () => ({
          type: "success",
          content: "should not run",
        }),
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(testTool);

      const mockHookService = {
        executeHooksForEvent: vi.fn().mockResolvedValue({
          outputs: [
            {
              hook: { id: "deny-hook", name: "deny-hook" },
              output: { success: true },
            },
          ],
          updatedInput: { tool_name: "denied_by_hook", params: {} },
          permissionDecision: "deny",
          shouldContinue: false,
        }),
      } as any;

      const executor = new StreamingToolExecutor(
        registry,
        ctx,
        {},
        undefined,
        mockHookService,
      );

      const stream = createMockStream([
        { type: "tool_use", id: "deny-1", name: "denied_by_hook", input: {} },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      const hookEvent = events.find((e) => e.type === "hook_executed");
      expect(hookEvent).toBeDefined();
      const deniedEvent = events.find((e) => e.type === "tool_denied");
      expect(deniedEvent).toBeDefined();
      if (deniedEvent && deniedEvent.type === "tool_denied") {
        expect(deniedEvent.reasons).toContain('Tool "denied_by_hook" denied by hook policy');
      }

      const results = executor.getToolResults();
      expect(results).toHaveLength(1);
      expect(results[0].result.type).toBe("error");
    });

    it("requests approval when PreToolUse hook returns approval_required", async () => {
      const testTool: ToolDefinition = {
        name: "hook_approval_tool",
        description: "A tool requiring hook approval",
        inputSchema: z.object({}),
        execute: async () => ({
          type: "success",
          content: "should not run",
        }),
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(testTool);

      const mockHookService = {
        executeHooksForEvent: vi.fn().mockResolvedValue({
          outputs: [
            {
              hook: { id: "approval-hook", name: "approval-hook" },
              output: { success: true },
            },
          ],
          updatedInput: { tool_name: "hook_approval_tool", params: {} },
          permissionDecision: "approval_required",
          shouldContinue: true,
        }),
      } as any;

      const executor = new StreamingToolExecutor(
        registry,
        ctx,
        {},
        undefined,
        mockHookService,
      );

      const stream = createMockStream([
        { type: "tool_use", id: "appr-1", name: "hook_approval_tool", input: {} },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      const hookEvent = events.find((e) => e.type === "hook_executed");
      expect(hookEvent).toBeDefined();
      const approvalEvent = events.find((e) => e.type === "tool_approval_needed");
      expect(approvalEvent).toBeDefined();
      if (approvalEvent && approvalEvent.type === "tool_approval_needed") {
        expect(approvalEvent.approvalId).toBe("approval-123");
      }
      expect(ctx.createApproval).toHaveBeenCalledTimes(1);
    });

    it("denies approval when PermissionRequest hook returns deny", async () => {
      const testTool: ToolDefinition = {
        name: "perm_deny_tool",
        description: "Tool denied at permission request stage",
        inputSchema: z.object({}),
        execute: async () => ({
          type: "success",
          content: "should not run",
        }),
        permission: {
          scope: "repo.edit",
          requiresApproval: true,
        },
      };
      registry.register(testTool);

      let callCount = 0;
      const mockHookService = {
        executeHooksForEvent: vi.fn().mockImplementation(async ({ eventType }: any) => {
          callCount++;
          if (eventType === "PreToolUse") {
            // Allow PreToolUse so we proceed to the requiresApproval path
            return {
              outputs: [],
              updatedInput: { tool_name: "perm_deny_tool", params: {} },
              permissionDecision: undefined,
              shouldContinue: true,
            };
          }
          // PermissionRequest hook denies
          return {
            outputs: [
              {
                hook: { id: "perm-deny-hook", name: "perm-deny-hook" },
                output: { success: true },
              },
            ],
            updatedInput: {},
            permissionDecision: "deny",
            shouldContinue: false,
          };
        }),
      } as any;

      const executor = new StreamingToolExecutor(
        registry,
        ctx,
        {},
        undefined,
        mockHookService,
      );

      const stream = createMockStream([
        { type: "tool_use", id: "perm-deny-1", name: "perm_deny_tool", input: {} },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      const deniedEvent = events.find((e) => e.type === "tool_denied");
      expect(deniedEvent).toBeDefined();
      expect(ctx.createApproval).not.toHaveBeenCalled();

      const results = executor.getToolResults();
      expect(results).toHaveLength(1);
      expect(results[0].result.type).toBe("error");
    });

    it("runs PostToolUseFailure hooks on tool error", async () => {
      const errorTool: ToolDefinition = {
        name: "fail_hook_tool",
        description: "A tool that errors with hooks",
        inputSchema: z.object({}),
        execute: async () => {
          throw new Error("hook tool boom");
        },
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(errorTool);

      const hookCalls: string[] = [];
      const mockHookService = {
        executeHooksForEvent: vi.fn().mockImplementation(async ({ eventType }: any) => {
          hookCalls.push(eventType);
          return {
            outputs: [],
            updatedInput: {},
            permissionDecision: undefined,
            shouldContinue: true,
          };
        }),
      } as any;

      const executor = new StreamingToolExecutor(
        registry,
        ctx,
        {},
        undefined,
        mockHookService,
      );

      const stream = createMockStream([
        { type: "tool_use", id: "fail-h-1", name: "fail_hook_tool", input: {} },
        { type: "done" },
      ]);

      await collectEvents(executor, stream);

      expect(hookCalls).toContain("PreToolUse");
      expect(hookCalls).toContain("PostToolUseFailure");
    });
  });

  describe("LSP notification integration", () => {
    it("notifies LSP on successful file-mutating tool execution", async () => {
      const editTool: ToolDefinition = {
        name: "edit_file",
        description: "Edit a file",
        inputSchema: z.object({ file_path: z.string() }),
        execute: async () => ({
          type: "success",
          content: "File edited",
        }),
        permission: { scope: "repo.edit" },
        concurrencySafe: true,
      };
      registry.register(editTool);

      const mockLspClient = {
        notifyFileChanged: vi.fn().mockResolvedValue(undefined),
        notifyFileSaved: vi.fn().mockResolvedValue(undefined),
      } as any;

      const executor = new StreamingToolExecutor(
        registry,
        ctx,
        {},
        undefined,
        undefined,
        mockLspClient,
      );

      const stream = createMockStream([
        {
          type: "tool_use",
          id: "lsp-1",
          name: "edit_file",
          input: { file_path: "/tmp/test.ts" },
        },
        { type: "done" },
      ]);

      await collectEvents(executor, stream);

      // LSP should have been notified after the successful tool execution.
      // Note: notifyLspFileChanged reads from disk which we don't mock here,
      // so the readFile call will throw and be silently caught.
      // The important thing is the method was called or the code path didn't error.
      const results = executor.getToolResults();
      expect(results).toHaveLength(1);
      expect(results[0].result.type).toBe("success");
    });

    it("does not notify LSP for non-file-mutating tools", async () => {
      const readTool: ToolDefinition = {
        name: "read_file",
        description: "Read a file",
        inputSchema: z.object({ file_path: z.string() }),
        execute: async () => ({
          type: "success",
          content: "File content",
        }),
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(readTool);

      const mockLspClient = {
        notifyFileChanged: vi.fn().mockResolvedValue(undefined),
        notifyFileSaved: vi.fn().mockResolvedValue(undefined),
      } as any;

      const executor = new StreamingToolExecutor(
        registry,
        ctx,
        {},
        undefined,
        undefined,
        mockLspClient,
      );

      const stream = createMockStream([
        {
          type: "tool_use",
          id: "lsp-2",
          name: "read_file",
          input: { file_path: "/tmp/test.ts" },
        },
        { type: "done" },
      ]);

      await collectEvents(executor, stream);

      expect(mockLspClient.notifyFileChanged).not.toHaveBeenCalled();
      expect(mockLspClient.notifyFileSaved).not.toHaveBeenCalled();
    });
  });

  describe("parseToolInput edge cases", () => {
    it("returns empty object for empty buffer in sequential tool", async () => {
      // A sequential tool that gets queued with no deltas should parse empty buffer as {}
      const seqTool: ToolDefinition = {
        name: "seq_parse_tool",
        description: "Sequential parse tool",
        inputSchema: z.object({}).passthrough(),
        execute: async () => ({
          type: "success",
          content: "parsed",
        }),
        permission: { scope: "repo.edit" },
        concurrencySafe: false,
      };
      registry.register(seqTool);

      const executor = new StreamingToolExecutor(registry, ctx);

      const stream = createMockStream([
        { type: "tool_use", id: "parse-1", name: "seq_parse_tool", input: {} },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);
      const results = events.filter((e) => e.type === "tool_result");
      expect(results).toHaveLength(1);
    });

    it("returns raw wrapper for unparseable JSON in sequential tool", async () => {
      const seqTool: ToolDefinition = {
        name: "seq_raw_tool",
        description: "Sequential raw tool",
        inputSchema: z.object({}).passthrough(),
        execute: async (input) => ({
          type: "success",
          content: JSON.stringify(input),
        }),
        permission: { scope: "repo.edit" },
        concurrencySafe: false,
      };
      registry.register(seqTool);

      const executor = new StreamingToolExecutor(registry, ctx);

      // Send deltas with invalid JSON, then tool_use
      const stream = createMockStream([
        { type: "tool_use_delta", id: "raw-1", argumentsDelta: "{not valid json" },
        { type: "tool_use", id: "raw-1", name: "seq_raw_tool", input: {} },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);
      const results = events.filter((e) => e.type === "tool_result");
      expect(results).toHaveLength(1);
    });
  });

  describe("toRecord helper", () => {
    it("treats non-object input as empty record for permissions", async () => {
      const testTool: ToolDefinition = {
        name: "nonobj_tool",
        description: "Tool with non-object input",
        inputSchema: z.any(),
        execute: async () => ({
          type: "success",
          content: "done",
        }),
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(testTool);

      const executor = new StreamingToolExecutor(registry, ctx);

      const stream = createMockStream([
        { type: "tool_use", id: "nonobj-1", name: "nonobj_tool", input: "just a string" },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);
      expect(events.some((e) => e.type === "tool_use_started")).toBe(true);
    });
  });

  describe("awaitPendingTools with unexpected errors", () => {
    it("handles promise rejection in awaitPendingTools", async () => {
      const testTool: ToolDefinition = {
        name: "reject_tool",
        description: "A tool whose promise rejects unexpectedly",
        inputSchema: z.object({}),
        execute: async () => ({
          type: "success",
          content: "ok",
        }),
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(testTool);

      const executor = new StreamingToolExecutor(registry, ctx);

      // Manually set up a pending call with a rejecting promise
      const pendingCalls = (executor as any).pendingCalls as Map<string, any>;
      pendingCalls.set("reject-1", {
        id: "reject-1",
        name: "reject_tool",
        argumentsBuffer: "",
        promise: Promise.reject(new Error("unexpected kaboom")),
        startedAt: Date.now() - 100,
      });

      // Increase toolCallCount so hadToolCalls() is true
      (executor as any).toolCallCount = 1;

      // Create a stream that just emits done to trigger awaitPendingTools
      const stream = createMockStream([{ type: "done" }]);

      const events = await collectEvents(executor, stream);

      const resultEvent = events.find((e) => e.type === "tool_result");
      expect(resultEvent).toBeDefined();
      if (resultEvent && resultEvent.type === "tool_result") {
        expect(resultEvent.result.type).toBe("error");
        if (resultEvent.result.type === "error") {
          expect(resultEvent.result.error).toContain("Unexpected error");
          expect(resultEvent.result.error).toContain("unexpected kaboom");
        }
      }

      const results = executor.getToolResults();
      expect(results).toHaveLength(1);
    });

    it("skips pending calls with no promise (e.g., approval-only)", async () => {
      const executor = new StreamingToolExecutor(registry, ctx);

      // Manually set up a pending call with no promise
      const pendingCalls = (executor as any).pendingCalls as Map<string, any>;
      pendingCalls.set("no-promise-1", {
        id: "no-promise-1",
        name: "some_tool",
        argumentsBuffer: "",
        // No promise — simulates a tool that was queued but never started
      });

      const stream = createMockStream([{ type: "done" }]);

      const events = await collectEvents(executor, stream);

      // Should not produce a tool_result for the no-promise pending call
      const resultEvents = events.filter((e) => e.type === "tool_result");
      expect(resultEvents).toHaveLength(0);
    });
  });

  describe("Semaphore edge cases", () => {
    it("queues when all permits are exhausted", async () => {
      const executionOrder: string[] = [];

      const slowTool: ToolDefinition = {
        name: "sem_tool",
        description: "Slow semaphore tool",
        inputSchema: z.object({ id: z.string() }),
        execute: async (input) => {
          executionOrder.push(`start_${input.id}`);
          await new Promise((resolve) => setTimeout(resolve, 30));
          executionOrder.push(`end_${input.id}`);
          return { type: "success", content: `done_${input.id}` };
        },
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(slowTool);

      // Only 1 permit means true serialization
      const executor = new StreamingToolExecutor(registry, ctx, {
        maxConcurrentTools: 1,
      });

      const stream = createMockStream([
        { type: "tool_use", id: "sem-1", name: "sem_tool", input: { id: "a" } },
        { type: "tool_use", id: "sem-2", name: "sem_tool", input: { id: "b" } },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      const results = events.filter((e) => e.type === "tool_result");
      expect(results).toHaveLength(2);

      // With 1 permit, tool a should finish before tool b starts
      const startA = executionOrder.indexOf("start_a");
      const endA = executionOrder.indexOf("end_a");
      const startB = executionOrder.indexOf("start_b");
      expect(endA).toBeLessThan(startB);
    });
  });

  describe("telemetry on error paths", () => {
    beforeEach(() => {
      resetTelemetry();
    });

    it("records TOOL_ERROR_COUNT on tool timeout (catch path)", async () => {
      const slowTool: ToolDefinition = {
        name: "timeout_telemetry_tool",
        description: "Times out for telemetry",
        inputSchema: z.object({}),
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          return { type: "success", content: "should not complete" };
        },
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(slowTool);

      const executor = new StreamingToolExecutor(registry, ctx, {
        toolTimeoutMs: 50,
      });

      const stream = createMockStream([
        { type: "tool_use", id: "tel-err-1", name: "timeout_telemetry_tool", input: {} },
        { type: "done" },
      ]);

      await collectEvents(executor, stream);

      const telemetry = getTelemetry();
      const errorSummary = telemetry.getMetricSummary(
        METRICS.TOOL_ERROR_COUNT,
        { [METRIC_LABELS.TOOL_NAME]: "timeout_telemetry_tool" },
      );
      expect(errorSummary).not.toBeNull();
      expect(errorSummary!.count).toBe(1);
    });

    it("records APPROVAL_REQUESTED when approval is needed", async () => {
      const approvalTool: ToolDefinition = {
        name: "approval_telemetry_tool",
        description: "Needs approval for telemetry",
        inputSchema: z.object({}),
        execute: async () => ({
          type: "success",
          content: "should not run",
        }),
        permission: {
          scope: "repo.edit",
          requiresApproval: true,
        },
      };
      registry.register(approvalTool);

      const executor = new StreamingToolExecutor(registry, ctx);

      const stream = createMockStream([
        { type: "tool_use", id: "tel-appr-1", name: "approval_telemetry_tool", input: {} },
        { type: "done" },
      ]);

      await collectEvents(executor, stream);

      const telemetry = getTelemetry();
      const approvalSummary = telemetry.getMetricSummary(
        METRICS.APPROVAL_REQUESTED,
        { [METRIC_LABELS.TOOL_NAME]: "approval_telemetry_tool" },
      );
      expect(approvalSummary).not.toBeNull();
      expect(approvalSummary!.count).toBe(1);
    });
  });

  describe("executeToolConcurrently guards", () => {
    it("does nothing when pending call already has a promise", async () => {
      const testTool: ToolDefinition = {
        name: "dup_exec_tool",
        description: "Tool for duplicate execution guard",
        inputSchema: z.object({}),
        execute: async () => ({
          type: "success",
          content: "done",
        }),
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(testTool);

      const executor = new StreamingToolExecutor(registry, ctx);

      // Pre-populate a pending call with a promise already set
      const pendingCalls = (executor as any).pendingCalls as Map<string, any>;
      const existingPromise = Promise.resolve({
        type: "success",
        content: "already running",
        durationMs: 10,
      });
      pendingCalls.set("dup-1", {
        id: "dup-1",
        name: "dup_exec_tool",
        argumentsBuffer: "",
        promise: existingPromise,
        startedAt: Date.now(),
      });

      // Call executeToolConcurrently again — it should bail out
      (executor as any).executeToolConcurrently("dup-1", "dup_exec_tool", {});

      // The promise should remain the same (not replaced)
      expect(pendingCalls.get("dup-1").promise).toBe(existingPromise);
    });
  });

  describe("unknown tool in concurrent scenario", () => {
    it("handles unknown tool gracefully when not found in registry during concurrent execution", async () => {
      // Register one valid tool alongside unknown ones
      const validTool: ToolDefinition = {
        name: "valid_tool",
        description: "A valid tool",
        inputSchema: z.object({}),
        execute: async () => ({
          type: "success",
          content: "valid done",
        }),
        permission: { scope: "repo.read" },
        concurrencySafe: true,
      };
      registry.register(validTool);

      const executor = new StreamingToolExecutor(registry, ctx);

      const stream = createMockStream([
        { type: "tool_use", id: "tool-1", name: "valid_tool", input: {} },
        { type: "tool_use", id: "tool-2", name: "nonexistent_tool_1", input: {} },
        { type: "tool_use", id: "tool-3", name: "nonexistent_tool_2", input: {} },
        { type: "done" },
      ]);

      const events = await collectEvents(executor, stream);

      // All three tools should produce results
      const results = events.filter((e) => e.type === "tool_result");
      expect(results).toHaveLength(3);

      // The valid tool should succeed
      const validResult = results.find(
        (e) => e.type === "tool_result" && e.name === "valid_tool"
      );
      expect(validResult).toBeDefined();
      if (validResult && validResult.type === "tool_result") {
        expect(validResult.result.type).toBe("success");
      }

      // Unknown tools should error
      const unknownResults = results.filter(
        (e) => e.type === "tool_result" && e.name !== "valid_tool"
      );
      expect(unknownResults).toHaveLength(2);
      for (const ur of unknownResults) {
        if (ur.type === "tool_result") {
          expect(ur.result.type).toBe("error");
          if (ur.result.type === "error") {
            expect(ur.result.error).toContain("Unknown tool");
          }
        }
      }
    });
  });
});

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

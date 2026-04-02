import { readFile } from "node:fs/promises";
import type { ProviderStreamEvent } from "../../shared/contracts";
import type {
  ToolContext,
  ToolResult,
  ToolResultBlock,
  AgenticEvent,
} from "../tools/types";
import type { ToolRegistry } from "../tools/registry";
import type { PermissionPolicyEngine } from "../permissions/policyEngine";
import { getTelemetry } from "../telemetry/tracer";
import { METRICS, METRIC_LABELS } from "../telemetry/metrics";
import type { HookService } from "../hooks/hookService";
import type { LSPClient } from "../lsp/lspClient";

// ---------------------------------------------------------------------------
// Pending Tool Call State
// ---------------------------------------------------------------------------

interface PendingToolCall {
  id: string;
  name: string;
  argumentsBuffer: string;
  promise?: Promise<ToolResult & { durationMs: number }>;
  startedAt?: number;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

// ---------------------------------------------------------------------------
// Semaphore for Concurrency Control
// ---------------------------------------------------------------------------

class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    const next = this.waiting.shift();
    if (next) {
      this.permits--;
      next();
    }
  }

  get available(): number {
    return this.permits;
  }
}

// ---------------------------------------------------------------------------
// Streaming Tool Executor
// ---------------------------------------------------------------------------

export interface StreamingToolExecutorOptions {
  /** Maximum number of concurrent tool executions (default: 5) */
  maxConcurrentTools?: number;
  /** Timeout for individual tool executions in milliseconds (default: 120000) */
  toolTimeoutMs?: number;
}

export class StreamingToolExecutor {
  private pendingCalls = new Map<string, PendingToolCall>();
  private completedResults: ToolResultBlock[] = [];
  private toolCallCount = 0;

  private readonly semaphore: Semaphore;
  private readonly toolTimeoutMs: number;

  // Queue for tools that can't run concurrently
  private sequentialQueue: Array<{ id: string; name: string }> = [];
  private isProcessingSequential = false;

  private readonly policyEngine?: PermissionPolicyEngine;
  private readonly hookService?: HookService;
  private readonly lspClient?: LSPClient;

  /** Tools that modify files on disk and should trigger LSP notifications */
  private static readonly FILE_MUTATING_TOOLS = new Set(["edit_file", "write_file"]);

  constructor(
    private readonly registry: ToolRegistry,
    private readonly ctx: ToolContext,
    options?: StreamingToolExecutorOptions,
    policyEngine?: PermissionPolicyEngine,
    hookService?: HookService,
    lspClient?: LSPClient,
  ) {
    const maxConcurrent = options?.maxConcurrentTools ?? 5;
    this.semaphore = new Semaphore(maxConcurrent);
    this.toolTimeoutMs = options?.toolTimeoutMs ?? 120000;
    this.policyEngine = policyEngine;
    this.hookService = hookService;
    this.lspClient = lspClient;
  }

  /**
   * Process a provider stream and yield AgenticEvents as tools are discovered and executed.
   * Tools are executed immediately when they arrive, respecting concurrency limits.
   */
  async *processStream(
    stream: AsyncGenerator<ProviderStreamEvent>
  ): AsyncGenerator<AgenticEvent> {
    try {
      for await (const event of stream) {
        if (event.type === "token") {
          yield { type: "assistant_token", value: event.value };
        } else if (event.type === "thinking") {
          yield { type: "assistant_thinking", value: event.value };
        } else if (event.type === "tool_use_delta") {
          // Accumulate argument deltas
          this.accumulateToolArguments(event.id, event.argumentsDelta);
        } else if (event.type === "tool_use") {
          // Tool use block arrived with complete input — start execution immediately
          const toolUseEvents = await this.startToolExecution(event.id, event.name, event.input);
          for (const toolUseEvent of toolUseEvents) {
            yield toolUseEvent;
          }
        } else if (event.type === "done") {
          // Stream finished — wait for all pending tools to complete
          yield* this.awaitPendingTools();
        }
      }
    } catch (error) {
      // If stream fails, still try to await any tools that already started
      yield* this.awaitPendingTools();

      const message = error instanceof Error ? error.message : String(error);
      yield {
        type: "error",
        error: `Stream processing failed: ${message}`,
        recoverable: false,
      };
    }
  }

  /**
   * Get all tool results from the last processed stream.
   */
  getToolResults(): ToolResultBlock[] {
    return this.completedResults;
  }

  /**
   * Check if any tools were called during the last stream.
   */
  hadToolCalls(): boolean {
    return this.toolCallCount > 0;
  }

  /**
   * Reset state for the next iteration.
   */
  reset(): void {
    this.pendingCalls.clear();
    this.completedResults = [];
    this.toolCallCount = 0;
    this.sequentialQueue = [];
    this.isProcessingSequential = false;
  }

  // ---------------------------------------------------------------------------
  // Private Implementation
  // ---------------------------------------------------------------------------

  private accumulateToolArguments(id: string, delta: string): void {
    let pending = this.pendingCalls.get(id);
    if (!pending) {
      // First delta for this tool — create a pending entry
      pending = {
        id,
        name: "", // We don't know the name yet
        argumentsBuffer: delta,
      };
      this.pendingCalls.set(id, pending);
    } else {
      pending.argumentsBuffer += delta;
    }
  }

  private async requestApproval(input: {
    id: string;
    name: string;
    toolInput: unknown;
    message: string;
  }): Promise<AgenticEvent[]> {
    const permissionHooks = await this.runHookEvent("PermissionRequest", {
      tool_name: input.name,
      params: toRecord(input.toolInput),
      reason: input.message,
    });

    if (permissionHooks.permissionDecision === "deny" || !permissionHooks.shouldContinue) {
      const errorResult: ToolResult = {
        type: "error",
        error: `Tool "${input.name}" denied by hook policy`,
      };
      this.completedResults.push({
        toolUseId: input.id,
        toolName: input.name,
        result: errorResult,
        durationMs: 0,
      });
      return [
        ...permissionHooks.events,
        {
          type: "tool_denied",
          id: input.id,
          name: input.name,
          reasons: [input.message],
        },
      ];
    }

    const telemetry = getTelemetry();
    telemetry.incrementCounter(METRICS.APPROVAL_REQUESTED, { [METRIC_LABELS.TOOL_NAME]: input.name });

    const approval = await this.ctx.createApproval({
      actionType: input.name,
      payload: {
        tool_name: input.name,
        tool_input: input.toolInput,
        run_id: this.ctx.runId,
        repo_id: this.ctx.repoId,
        ticket_id: this.ctx.ticketId,
        stage: this.ctx.stage,
      },
    });

    const result: ToolResult = {
      type: "approval_required",
      approvalId: approval.id,
      message: input.message,
    };
    this.completedResults.push({
      toolUseId: input.id,
      toolName: input.name,
      result,
      durationMs: 0,
    });

    return [
      ...permissionHooks.events,
      {
        type: "tool_approval_needed",
        id: input.id,
        name: input.name,
        approvalId: approval.id,
        message: input.message,
      },
    ];
  }

  private async runHookEvent(
    eventType: "PreToolUse" | "PostToolUse" | "PostToolUseFailure" | "PermissionRequest",
    eventPayload: Record<string, unknown>,
  ): Promise<{
    events: AgenticEvent[];
    updatedInput: Record<string, unknown>;
    permissionDecision?: "allow" | "deny" | "approval_required";
    shouldContinue: boolean;
  }> {
    if (!this.hookService) {
      return {
        events: [],
        updatedInput: eventPayload,
        shouldContinue: true,
      };
    }

    const aggregate = await this.hookService.executeHooksForEvent({
      eventType,
      eventPayload,
      context: {
        runId: this.ctx.runId,
        projectId: this.ctx.repoId,
        ticketId: this.ctx.ticketId,
        stage: this.ctx.stage,
      },
    });

    return {
      events: aggregate.outputs.map(({ hook, output }) => ({
        type: "hook_executed",
        hookId: hook.id,
        hookName: hook.name,
        eventType,
        success: output.success,
      })),
      updatedInput: aggregate.updatedInput,
      permissionDecision: aggregate.permissionDecision,
      shouldContinue: aggregate.shouldContinue,
    };
  }

  private async startToolExecution(
    id: string,
    name: string,
    input: unknown
  ): Promise<AgenticEvent[]> {
    this.toolCallCount++;

    // Update pending call with the name (if we got deltas first)
    let pending = this.pendingCalls.get(id);
    if (pending) {
      pending.name = name;
    } else {
      // No deltas arrived — create new pending call
      pending = {
        id,
        name,
        argumentsBuffer: "", // No deltas
      };
      this.pendingCalls.set(id, pending);
    }

    const tool = this.registry.get(name);
    const preHooks = await this.runHookEvent("PreToolUse", {
      tool_name: name,
      params: toRecord(input),
    });
    // Extract the params from the hook event wrapper — hooks modify the
    // { tool_name, params } envelope, so we unwrap to get the actual tool input.
    let effectiveInput: unknown = (preHooks.updatedInput as Record<string, unknown>).params ?? input;

    if (preHooks.permissionDecision === "deny" || !preHooks.shouldContinue) {
      const errorResult: ToolResult = {
        type: "error",
        error: `Tool "${name}" denied by hook policy`,
      };
      this.completedResults.push({
        toolUseId: id,
        toolName: name,
        result: errorResult,
        durationMs: 0,
      });
      return [
        ...preHooks.events,
        {
          type: "tool_denied",
          id,
          name,
          reasons: [`Tool "${name}" denied by hook policy`],
        },
      ];
    }

    if (preHooks.permissionDecision === "approval_required") {
      const message = `Hook policy requires approval for "${name}"`;
      const approvalEvents = await this.requestApproval({
        id,
        name,
        toolInput: effectiveInput,
        message,
      });
      return [...preHooks.events, ...approvalEvents];
    }

    // Check permissions via policy engine if available
    if (this.policyEngine && tool) {
      const decision = await this.policyEngine.check(tool, effectiveInput, this.ctx);

      if (decision.decision === "deny") {
        const errorResult: ToolResult = {
          type: "error",
          error: `Tool "${name}" denied by policy: ${decision.reasons.join("; ")}`,
        };
        this.completedResults.push({
          toolUseId: id,
          toolName: name,
          result: errorResult,
          durationMs: 0,
        });
        return [{
          type: "tool_denied",
          id,
          name,
          reasons: decision.reasons,
        }];
      }

      if (decision.decision === "approval_required") {
        const message = decision.reasons.join("; ") || `Tool "${name}" requires approval`;
        return this.requestApproval({
          id,
          name,
          toolInput: effectiveInput,
          message,
        });
      }
    } else {
      // Fallback: check tool-level permissions directly (backward compat)
      if (tool?.permission.requiresApproval) {
        const message = `Tool "${name}" requires user approval`;
        return this.requestApproval({
          id,
          name,
          toolInput: effectiveInput,
          message,
        });
      }

      // Check dynamic approval
      if (tool?.permission.checkApproval && tool.permission.checkApproval(effectiveInput, this.ctx)) {
        const message = `Tool "${name}" requires approval for this operation`;
        return this.requestApproval({
          id,
          name,
          toolInput: effectiveInput,
          message,
        });
      }
    }

    // Start execution
    if (tool?.concurrencySafe === false) {
      // Queue for sequential execution
      this.sequentialQueue.push({ id, name });
      this.processSequentialQueue();
    } else {
      // Execute concurrently (with semaphore)
      this.executeToolConcurrently(id, name, effectiveInput);
    }

    return [
      ...preHooks.events,
      {
        type: "tool_use_started",
        id,
        name,
        input: effectiveInput,
      },
    ];
  }

  private executeToolConcurrently(id: string, name: string, input: unknown): void {
    const pending = this.pendingCalls.get(id);
    if (!pending || pending.promise) return;

    pending.startedAt = Date.now();

    // Wrap execution with semaphore and timeout
    pending.promise = this.executeWithSemaphoreAndTimeout(id, name, input);
  }

  private async processSequentialQueue(): Promise<void> {
    // Set flag immediately before any async operations to prevent race condition
    if (this.isProcessingSequential || this.sequentialQueue.length === 0) {
      return;
    }

    this.isProcessingSequential = true;

    try {
      while (this.sequentialQueue.length > 0) {
        const next = this.sequentialQueue.shift()!;
        const pending = this.pendingCalls.get(next.id);
        if (!pending) continue;

        pending.startedAt = Date.now();

        // Wait for this tool to complete before starting the next
        try {
          const input = this.parseToolInput(pending.argumentsBuffer);
          pending.promise = this.executeWithSemaphoreAndTimeout(next.id, next.name, input);
          await pending.promise;
        } catch (error) {
          // Error already handled in executeWithSemaphoreAndTimeout
          // Continue processing the queue
        }
      }
    } finally {
      this.isProcessingSequential = false;
    }
  }

  private async executeWithSemaphoreAndTimeout(
    id: string,
    name: string,
    input: unknown
  ): Promise<ToolResult & { durationMs: number }> {
    await this.semaphore.acquire();

    const telemetry = getTelemetry();
    const startTime = Date.now();

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<ToolResult & { durationMs: number }>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Tool "${name}" timed out after ${this.toolTimeoutMs}ms`));
        }, this.toolTimeoutMs);
      });

      // Race between execution and timeout
      const executionPromise = this.registry.executeValidated(name, input, this.ctx);

      const result = await Promise.race([executionPromise, timeoutPromise]);

      telemetry.recordMetric(METRICS.TOOL_EXECUTION_DURATION_MS, Date.now() - startTime, { [METRIC_LABELS.TOOL_NAME]: name });
      telemetry.incrementCounter(METRICS.TOOL_EXECUTION_COUNT, { [METRIC_LABELS.TOOL_NAME]: name });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const pending = this.pendingCalls.get(id);
      const durationMs = pending?.startedAt ? Date.now() - pending.startedAt : 0;

      telemetry.recordMetric(METRICS.TOOL_EXECUTION_DURATION_MS, Date.now() - startTime, { [METRIC_LABELS.TOOL_NAME]: name });
      telemetry.incrementCounter(METRICS.TOOL_ERROR_COUNT, { [METRIC_LABELS.TOOL_NAME]: name });

      return {
        type: "error",
        error: message,
        durationMs,
      };
    } finally {
      this.semaphore.release();
    }
  }

  /**
   * Notify LSP server of file changes after successful edit_file/write_file.
   * Reads the file from disk and sends didChange + didSave notifications.
   */
  private async notifyLspFileChanged(toolName: string, toolInput: unknown): Promise<void> {
    if (!this.lspClient || !StreamingToolExecutor.FILE_MUTATING_TOOLS.has(toolName)) return;

    const input = toRecord(toolInput);
    const filePath = typeof input.file_path === "string" ? input.file_path : null;
    if (!filePath) return;

    try {
      const content = await readFile(filePath, "utf-8");
      await this.lspClient.notifyFileChanged(filePath, content);
      await this.lspClient.notifyFileSaved(filePath);
    } catch {
      // Non-critical: LSP notification failure should never block execution
    }
  }

  private parseToolInput(buffer: string): unknown {
    if (!buffer.trim()) {
      return {};
    }

    try {
      return JSON.parse(buffer);
    } catch {
      // If parsing fails, return the raw string
      return { raw: buffer };
    }
  }

  private async *awaitPendingTools(): AsyncGenerator<AgenticEvent> {
    const pending = Array.from(this.pendingCalls.values());

    for (const call of pending) {
      if (!call.promise) {
        // Tool was queued but never started (e.g., approval required)
        continue;
      }

      try {
        const result = await call.promise;
        const postHooks = await this.runHookEvent(
          result.type === "error" ? "PostToolUseFailure" : "PostToolUse",
          {
            tool_name: call.name,
            result_type: result.type,
            result: result.type === "success" ? result.content : result.type === "error" ? result.error : result.message,
          },
        );

        // Notify LSP of file changes after successful file-mutating tools
        if (result.type === "success") {
          const toolInput = this.parseToolInput(call.argumentsBuffer);
          await this.notifyLspFileChanged(call.name, toolInput);
        }

        this.completedResults.push({
          toolUseId: call.id,
          toolName: call.name,
          result,
          durationMs: result.durationMs,
        });

        for (const event of postHooks.events) {
          yield event;
        }

        yield {
          type: "tool_result",
          id: call.id,
          name: call.name,
          result,
          durationMs: result.durationMs,
        };
      } catch (error) {
        // This should be rare since executeWithSemaphoreAndTimeout catches errors
        const message = error instanceof Error ? error.message : String(error);
        const durationMs = call.startedAt ? Date.now() - call.startedAt : 0;

        const errorResult: ToolResult & { durationMs: number } = {
          type: "error",
          error: `Unexpected error awaiting tool "${call.name}": ${message}`,
          durationMs,
        };

        this.completedResults.push({
          toolUseId: call.id,
          toolName: call.name,
          result: errorResult,
          durationMs,
        });

        const postHooks = await this.runHookEvent("PostToolUseFailure", {
          tool_name: call.name,
          result_type: "error",
          result: errorResult.error,
        });
        for (const event of postHooks.events) {
          yield event;
        }

        yield {
          type: "tool_result",
          id: call.id,
          name: call.name,
          result: errorResult,
          durationMs,
        };
      }
    }

    // Clear pending calls after processing
    this.pendingCalls.clear();
  }
}

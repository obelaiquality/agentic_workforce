import type { ModelRole } from "../../shared/contracts";
import type {
  AgenticEvent,
  AgenticExecutionInput,
  ConversationMessage,
  ToolContext,
  ToolUseBlock,
  ToolResultBlock,
} from "../tools/types";
import type { ToolRegistry } from "../tools/registry";
import type { ProviderOrchestrator } from "../services/providerOrchestrator";
import type { ContextService } from "../services/contextService";
import type { MemoryService } from "../services/memoryService";
import type { DoomLoopDetector } from "../services/doomLoopDetector";
import type { V2EventService } from "../services/v2EventService";
import { compactMessages, computePressure, type CompactionMessage } from "../services/contextCompactionService";
import { StreamingToolExecutor } from "./streamingToolExecutor";
import type { ContextCollapseService } from "./contextCollapse";
import type { TaskBudgetTracker } from "./budgetTracker";
import type { PermissionPolicyEngine } from "../permissions/policyEngine";
import { DeferredToolLoader } from "../tools/deferredLoader";
import { getTelemetry } from "../telemetry/tracer";
import { METRICS, METRIC_LABELS } from "../telemetry/metrics";
import type { HookService } from "../hooks/hookService";
import type { PlanService } from "../plans/planService";
import type { AutoMemoryExtractor } from "../memory/autoExtractor";
import type { LSPClient } from "../lsp/lspClient";
import { createRootAbortController, type HierarchicalAbortController } from "../services/abortHierarchy";

// ---------------------------------------------------------------------------
// Agent Behavior Guidelines
// ---------------------------------------------------------------------------

const AGENT_BEHAVIOR_GUIDELINES = `You are a precise coding agent. Your objective is to complete the given task using available tools.

Core principles:
1. **Use tools** to read files, execute commands, and verify your work — never assume or hallucinate code content
2. **Verify thoroughly** — after making changes, run tests/lints to confirm correctness
3. **Be concise** — focus on the task, avoid unnecessary explanations
4. **Iterate until done** — if verification fails, diagnose and fix; if you lack information, gather it
5. **Signal completion** — when the task is complete and verified, explicitly state that you are done

Available tools are listed below. Use them strategically to accomplish your objective.`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrchestratorDependencies {
  registry: ToolRegistry;
  providerOrchestrator: ProviderOrchestrator;
  contextService: ContextService;
  memoryService: MemoryService;
  doomLoopDetector: DoomLoopDetector;
  events: V2EventService;
  budgetTracker?: TaskBudgetTracker;
  policyEngine?: PermissionPolicyEngine;
  contextCollapseService?: ContextCollapseService;
  approvalService?: {
    createApproval(req: {
      runId: string;
      toolName: string;
      toolInput: unknown;
      actor: string;
    }): Promise<{ id: string }>;
  };
  hookService?: HookService;
  planService?: PlanService;
  autoMemoryExtractor?: AutoMemoryExtractor;
  lspClient?: LSPClient;
}

interface BudgetState {
  tokensConsumed: number;
  iterationsConsumed: number;
  costUsd: number;
}

interface RecentlyReadFile {
  path: string;
  content: string;
}

interface IterationState {
  iteration: number;
  currentRole: ModelRole;
  conversation: ConversationMessage[];
  budget: BudgetState;
  toolCallsTotal: number;
  recentlyReadFiles: RecentlyReadFile[];
  consecutiveCompactionFailures: number;
  activeSkillConstraint: {
    skillName: string;
    allowedTools: string[] | null;
    remainingIterations: number | null;
  } | null;
}

const MAX_CONSECUTIVE_COMPACTION_FAILURES = 3;

const PLANNING_TOOL_NAMES = new Set([
  "read_file",
  "list_files",
  "grep_search",
  "glob_search",
  "git_status",
  "git_diff",
  "ask_plan_question",
  "submit_plan",
  "list_subtasks",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  objective: string,
  availableToolSchemas: Array<{ name: string; description: string }>,
  episodicContext: string,
  extraSuffix?: string,
): string {
  const toolList = availableToolSchemas.map((t) => `- **${t.name}**: ${t.description}`).join("\n");

  let prompt = AGENT_BEHAVIOR_GUIDELINES;

  if (episodicContext) {
    prompt += `\n\n${episodicContext}`;
  }

  prompt += `\n\n## Available Tools\n\n${toolList}`;

  if (extraSuffix) {
    prompt += `\n\n${extraSuffix}`;
  }

  return prompt;
}

/**
 * Map from execution state to the appropriate stage label.
 * - First iteration with no prior tool calls is "scope" (gathering info)
 * - overseer_escalation role is "escalate"
 * - review_deep role is "review"
 * - Everything else is "build"
 */
function mapExecutionStage(
  iteration: number,
  currentRole: ModelRole,
  hadToolCalls: boolean,
): "scope" | "build" | "review" | "escalate" {
  if (iteration <= 1 && !hadToolCalls) return "scope";
  if (currentRole === "overseer_escalation") return "escalate";
  if (currentRole === "review_deep") return "review";
  return "build";
}

function estimateCost(inputTokens: number, outputTokens: number, role: ModelRole): number {
  // Rough cost estimation (adjust per provider)
  // Local models: free
  // OpenAI overseer: ~$0.01 per 1k input, ~$0.03 per 1k output
  if (role === "overseer_escalation") {
    return (inputTokens / 1000) * 0.01 + (outputTokens / 1000) * 0.03;
  }
  return 0;
}

function dedupeToolSchemas<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.name)) {
      return false;
    }
    seen.add(item.name);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Main Orchestrator
// ---------------------------------------------------------------------------

export class AgenticOrchestrator {
  private readonly registry: ToolRegistry;
  private readonly providerOrchestrator: ProviderOrchestrator;
  private readonly contextService: ContextService;
  private readonly memoryService: MemoryService;
  private readonly doomLoopDetector: DoomLoopDetector;
  private readonly events: V2EventService;
  private readonly budgetTracker?: TaskBudgetTracker;
  private readonly policyEngine?: PermissionPolicyEngine;
  private readonly contextCollapseService?: ContextCollapseService;
  private readonly approvalService?: OrchestratorDependencies["approvalService"];
  private readonly hookService?: HookService;
  private readonly planService?: PlanService;
  private readonly autoMemoryExtractor?: AutoMemoryExtractor;

  constructor(deps: OrchestratorDependencies) {
    this.registry = deps.registry;
    this.providerOrchestrator = deps.providerOrchestrator;
    this.contextService = deps.contextService;
    this.memoryService = deps.memoryService;
    this.doomLoopDetector = deps.doomLoopDetector;
    this.events = deps.events;
    this.budgetTracker = deps.budgetTracker;
    this.policyEngine = deps.policyEngine;
    this.contextCollapseService = deps.contextCollapseService;
    this.approvalService = deps.approvalService;
    this.hookService = deps.hookService;
    this.planService = deps.planService;
    this.autoMemoryExtractor = deps.autoMemoryExtractor;
  }

  async *execute(input: AgenticExecutionInput): AsyncGenerator<AgenticEvent> {
    const telemetry = getTelemetry();
    const executionStartTime = Date.now();
    const executionSpan = telemetry.startSpan({ name: "agentic.execute", attributes: { "run.id": input.runId } });

    // Create hierarchical abort controller for this run
    const rootAbort = createRootAbortController(`run:${input.runId}`);
    // Allow external cancellation via an optional signal on the input
    if ((input as { signal?: AbortSignal }).signal) {
      const externalSignal = (input as { signal?: AbortSignal }).signal!;
      externalSignal.addEventListener("abort", () => rootAbort.abort(externalSignal.reason as string), { once: true });
    }

    const maxIterations = input.maxIterations ?? 50;
    const initialRole = input.initialModelRole ?? "coder_default";
    const maxContextTokens = input.budget?.maxTokens ?? 30000;
    let plan = input.planMode && this.planService
      ? await this.planService.startPlanningPhase(input.runId)
      : null;

    this.memoryService.startPrefetch({
      runId: input.runId,
      objective: input.objective,
    });

    const initialToolContext: ToolContext = {
      runId: input.runId,
      repoId: input.repoId,
      ticketId: input.ticketId,
      worktreePath: input.worktreePath,
      actor: input.actor,
      stage: mapExecutionStage(0, initialRole, false),
      conversationHistory: [],
      createApproval: async (req) => {
        if (this.approvalService) {
          return this.approvalService.createApproval({
            runId: input.runId,
            toolName: req.actionType || "unknown",
            toolInput: req.payload || {},
            actor: input.actor,
          });
        }
        return { id: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` };
      },
      recordEvent: async (event) => {
        await this.events.appendEvent({
          type: event.type,
          aggregateId: input.runId,
          actor: input.actor,
          payload: event.payload,
        });
      },
    };

    const deferredLoader = input.useDeferredTools
      ? new DeferredToolLoader(this.registry, initialToolContext)
      : null;

    const prefetchedMemories = await this.memoryService.awaitPrefetch(input.runId).catch(() => []);

    // Build initial conversation
    const memory = this.memoryService.compose(input.objective, input.runId);
    const toolSchemas = this.selectToolSchemas({
      ctx: initialToolContext,
      deferredLoader,
      planMode: Boolean(input.planMode),
      skillConstraint: null,
    });
    const toolSummaries = toolSchemas.map((t) => ({ name: t.name, description: t.description }));
    const extraPromptSections = [
      this.memoryService.formatMemoriesForPrompt(prefetchedMemories),
      deferredLoader?.getDeferredToolsList() || "",
      this.formatPlanContext(plan),
      input.systemPromptSuffix || "",
    ].filter((section) => section.trim().length > 0);

    const systemPrompt = buildSystemPrompt(
      input.objective,
      toolSummaries,
      memory.episodicContext,
      extraPromptSections.join("\n\n") || undefined,
    );

    const state: IterationState = {
      iteration: 0,
      currentRole: initialRole,
      conversation: [
        { role: "system", content: systemPrompt, pinned: true, timestamp: new Date().toISOString() },
        { role: "user", content: input.objective, pinned: true, timestamp: new Date().toISOString() },
      ],
      budget: {
        tokensConsumed: 0,
        iterationsConsumed: 0,
        costUsd: 0,
      },
      toolCallsTotal: 0,
      recentlyReadFiles: [],
      consecutiveCompactionFailures: 0,
      activeSkillConstraint: null,
    };

    if (plan) {
      yield { type: "plan_started" };
    }

    const startupHooks = await this.runLifecycleHooks({
      eventType: "SessionStart",
      runId: input.runId,
      projectId: input.projectId ?? input.repoId,
      ticketId: input.ticketId,
      stage: "scope",
      eventPayload: {
        objective: input.objective,
        planMode: Boolean(input.planMode),
      },
    });
    for (const event of startupHooks.events) {
      yield event;
    }
    this.appendSystemMessages(state, startupHooks.systemMessages);
    if (startupHooks.shouldAbort) {
      yield {
        type: "execution_aborted" as const,
        reason: "Hook failure with continueOnError=false",
      };
      executionSpan.setStatus("error", "Hook abort");
      executionSpan.end();
      return;
    }

    const promptHooks = await this.runLifecycleHooks({
      eventType: "UserPromptSubmit",
      runId: input.runId,
      projectId: input.projectId ?? input.repoId,
      ticketId: input.ticketId,
      stage: "scope",
      eventPayload: {
        objective: input.objective,
      },
    });
    for (const event of promptHooks.events) {
      yield event;
    }
    this.appendSystemMessages(state, promptHooks.systemMessages);
    if (promptHooks.shouldAbort) {
      yield {
        type: "execution_aborted" as const,
        reason: "Hook failure with continueOnError=false",
      };
      executionSpan.setStatus("error", "Hook abort");
      executionSpan.end();
      return;
    }

    // Initialize budget tracker if available
    if (this.budgetTracker) {
      this.budgetTracker.createBudget(input.runId, {
        maxTokens: input.budget?.maxTokens,
        maxCostUsd: input.budget?.maxCostUsd,
        maxIterations: input.maxIterations ?? 50,
        maxDurationMs: input.budget?.maxDurationMs,
      });
    }

    try {

    // Main agentic loop
    while (state.iteration < maxIterations) {
      // Check for abort before each iteration
      if (rootAbort.aborted) {
        yield {
          type: "execution_aborted" as const,
          reason: `Run aborted: ${rootAbort.signal.reason ?? "cancelled"}`,
        };
        executionSpan.setStatus("error", "Aborted");
        executionSpan.end();
        return;
      }

      state.iteration++;
      state.budget.iterationsConsumed = state.iteration;

      telemetry.incrementCounter(METRICS.AGENTIC_LOOP_ITERATIONS, { [METRIC_LABELS.RUN_ID]: input.runId });

      if (this.budgetTracker) {
        this.budgetTracker.recordIteration(input.runId);
      }

      yield {
        type: "iteration_start",
        iteration: state.iteration,
        messageCount: state.conversation.length,
      };

      // 1. Check context pressure and compact if needed
      const currentPressure = this.measurePressure(state, maxContextTokens);
      if (currentPressure > 0.7) {
        const preCompactHooks = await this.runLifecycleHooks({
          eventType: "PreCompact",
          runId: input.runId,
          projectId: input.projectId ?? input.repoId,
          ticketId: input.ticketId,
          stage: mapExecutionStage(state.iteration, state.currentRole, state.toolCallsTotal > 0),
          eventPayload: {
            pressure: currentPressure,
            messageCount: state.conversation.length,
          },
        });
        for (const event of preCompactHooks.events) {
          yield event;
        }
        this.appendSystemMessages(state, preCompactHooks.systemMessages);
        if (preCompactHooks.shouldAbort) {
          yield {
            type: "execution_aborted" as const,
            reason: "Hook failure with continueOnError=false",
          };
          executionSpan.setStatus("error", "Hook abort");
          executionSpan.end();
          return;
        }
      }

      const compactionEvent = this.checkAndCompact(state, maxContextTokens, input.runId);
      if (compactionEvent !== null) {
        yield compactionEvent;
        const postCompactHooks = await this.runLifecycleHooks({
          eventType: "PostCompact",
          runId: input.runId,
          projectId: input.projectId ?? input.repoId,
          ticketId: input.ticketId,
          stage: mapExecutionStage(state.iteration, state.currentRole, state.toolCallsTotal > 0),
          eventPayload: {
            stage: compactionEvent.stage,
            tokensBefore: compactionEvent.tokensBefore,
            tokensAfter: compactionEvent.tokensAfter,
          },
        });
        for (const event of postCompactHooks.events) {
          yield event;
        }
        this.appendSystemMessages(state, postCompactHooks.systemMessages);
        telemetry.incrementCounter(METRICS.CONTEXT_COMPACTION_COUNT, { [METRIC_LABELS.RUN_ID]: input.runId });
      }

      // 2. Stream from provider with tools
      let assistantText = "";
      const toolCalls: ToolUseBlock[] = [];
      let executor: StreamingToolExecutor | null = null;

      try {
        // Map conversation to provider format
        // Provider API only supports system/user/assistant, so tool_result messages
        // are encoded as user messages with a JSON wrapper
        const providerMessages = state.conversation.map((m) => {
          if (m.role === "tool_result") {
            // Encode tool result as user message with JSON wrapper for provider compatibility
            // The content already contains the serialized result from step 6
            return {
              role: "user" as const,
              content: m.content,
            };
          }
          return {
            role: m.role as "system" | "user" | "assistant",
            content: m.content,
          };
        });

        // Create ToolContext for the executor
        const toolContext: ToolContext = {
          runId: input.runId,
          repoId: input.repoId,
          ticketId: input.ticketId,
          worktreePath: input.worktreePath,
          actor: input.actor,
          stage: mapExecutionStage(state.iteration, state.currentRole, state.toolCallsTotal > 0),
          conversationHistory: state.conversation,
          createApproval: async (req) => {
            if (this.approvalService) {
              return this.approvalService.createApproval({
                runId: input.runId,
                toolName: req.actionType || "unknown",
                toolInput: req.payload || {},
                actor: input.actor,
                ticketId: input.ticketId,
                repoId: input.repoId,
                stage: mapExecutionStage(state.iteration, state.currentRole, state.toolCallsTotal > 0),
                reason: req.actionType || null,
              });
            }
            return { id: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` };
          },
          recordEvent: async (event) => {
            await this.events.appendEvent({
              type: event.type,
              aggregateId: input.runId,
              actor: input.actor,
              payload: event.payload,
            });
          },
        };

        // Create streaming tool executor
        executor = new StreamingToolExecutor(this.registry, toolContext, {
          maxConcurrentTools: 5,
          toolTimeoutMs: 120000,
        }, this.policyEngine, this.hookService, this.lspClient);

        const activeToolSchemas = this.selectToolSchemas({
          ctx: toolContext,
          deferredLoader,
          planMode: Boolean(input.planMode && plan && plan.phase !== "executing"),
          skillConstraint: state.activeSkillConstraint,
        });

        const streamEvents = this.providerOrchestrator.streamChatWithRetryStreaming(
          input.runId,
          providerMessages,
          (token) => {
            // Token callback is handled inline below
          },
          {
            providerId: input.providerId,
            modelRole: state.currentRole,
            tools: activeToolSchemas,
            querySource: "execution",
            maxContextTokens,
          },
        );

        // Process provider stream - we need to intercept it to capture usage before passing to executor
        const budgetTrackerRef = this.budgetTracker;
        const runIdRef = input.runId;
        const providerRequestStart = Date.now();
        async function* interceptStreamForUsage(stream: AsyncGenerator<any>) {
          for await (const event of stream) {
            if (event.type === "done" && event.usage) {
              const inputTokens = event.usage.inputTokens ?? 0;
              const outputTokens = event.usage.outputTokens ?? 0;

              // Update inline budget state
              state.budget.tokensConsumed += event.usage.totalTokens ?? 0;
              state.budget.costUsd += estimateCost(inputTokens, outputTokens, state.currentRole);

              // Record provider telemetry metrics
              const providerLabels = { [METRIC_LABELS.MODEL_ROLE]: state.currentRole, [METRIC_LABELS.RUN_ID]: runIdRef };
              telemetry.incrementCounter(METRICS.PROVIDER_REQUEST_COUNT, providerLabels);
              telemetry.recordMetric(METRICS.PROVIDER_REQUEST_DURATION_MS, Date.now() - providerRequestStart, providerLabels);
              telemetry.recordMetric(METRICS.PROVIDER_TOKEN_INPUT, inputTokens, providerLabels);
              telemetry.recordMetric(METRICS.PROVIDER_TOKEN_OUTPUT, outputTokens, providerLabels);
              telemetry.recordMetric(METRICS.BUDGET_TOKENS_CONSUMED, state.budget.tokensConsumed, { [METRIC_LABELS.RUN_ID]: runIdRef });
              telemetry.recordMetric(METRICS.BUDGET_COST_USD, state.budget.costUsd, { [METRIC_LABELS.RUN_ID]: runIdRef });

              // Record usage in budget tracker
              if (budgetTrackerRef) {
                const modelId = state.currentRole === "overseer_escalation" ? "gpt-4" : "local";
                budgetTrackerRef.recordUsage(runIdRef, {
                  inputTokens,
                  outputTokens,
                  modelId,
                });
              }
            }
            yield event;
          }
        }

        // Process provider stream through the executor
        for await (const event of executor.processStream(interceptStreamForUsage(streamEvents))) {
          // Track assistant text and tool calls for later use
          if (event.type === "assistant_token") {
            assistantText += event.value;
          } else if (event.type === "tool_use_started") {
            toolCalls.push({
              id: event.id,
              name: event.name,
              input: event.input,
            });
            state.toolCallsTotal++;
          }

          // Yield all events from executor
          yield event;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        yield {
          type: "error",
          error: `Provider stream failed: ${errorMsg}`,
          recoverable: state.currentRole !== "overseer_escalation",
        };

        // If not already on overseer, try escalating
        if (state.currentRole !== "overseer_escalation") {
          yield {
            type: "escalating",
            fromRole: state.currentRole,
            toRole: "overseer_escalation",
            reason: "provider_error",
          };
          state.currentRole = "overseer_escalation";
          continue;
        } else {
          // Overseer failed too — abort
          executionSpan.setAttribute("iterations", state.iteration);
          executionSpan.setAttribute("tool_calls", state.toolCallsTotal);
          executionSpan.setStatus("error", `Unrecoverable provider error: ${errorMsg}`);
          const abortHooks = await this.runLifecycleHooks({
            eventType: "Notification",
            runId: input.runId,
            projectId: input.projectId ?? input.repoId,
            ticketId: input.ticketId,
            stage: mapExecutionStage(state.iteration, state.currentRole, state.toolCallsTotal > 0),
            eventPayload: {
              status: "aborted",
              reason: `Unrecoverable provider error: ${errorMsg}`,
            },
          });
          for (const event of abortHooks.events) {
            yield event;
          }
          yield {
            type: "execution_aborted",
            reason: `Unrecoverable provider error: ${errorMsg}`,
          };
          return;
        }
      }

      // 3. Add assistant message to conversation
      if (assistantText || toolCalls.length > 0) {
        state.conversation.push({
          role: "assistant",
          content: assistantText || `[Called ${toolCalls.length} tool(s)]`,
          timestamp: new Date().toISOString(),
        });
      }

      // 4. Check budget BEFORE checking completion
      // Check for warnings first, then check for abort
      const budgetWarning = this.checkBudgetWarning(state, input);
      if (budgetWarning) {
        yield budgetWarning;
      }

      const budgetAbort = this.checkBudgetAbort(state, input);
      if (budgetAbort) {
        executionSpan.setAttribute("iterations", state.iteration);
        executionSpan.setAttribute("tool_calls", state.toolCallsTotal);
        executionSpan.setStatus("error", "Budget exhausted");
        const abortHooks = await this.runLifecycleHooks({
          eventType: "Notification",
          runId: input.runId,
          projectId: input.projectId ?? input.repoId,
          ticketId: input.ticketId,
          stage: mapExecutionStage(state.iteration, state.currentRole, state.toolCallsTotal > 0),
          eventPayload: {
            status: "aborted",
            reason: budgetAbort.reason,
          },
        });
        for (const event of abortHooks.events) {
          yield event;
        }
        yield budgetAbort;
        return;
      }

      // 5. If no tool calls, agent is done
      if (!executor || !executor.hadToolCalls()) {
        executionSpan.setAttribute("iterations", state.iteration);
        executionSpan.setAttribute("tool_calls", state.toolCallsTotal);
        executionSpan.setStatus("ok");

        const extracted = await this.autoMemoryExtractor?.extractFromCompletion({
          runId: input.runId,
          projectId: input.projectId ?? input.repoId,
          ticketId: input.ticketId,
          objective: input.objective,
          totalIterations: state.iteration,
          totalToolCalls: state.toolCallsTotal,
          finalMessage: assistantText,
          success: true,
        });
        if (extracted) {
          yield {
            type: "memory_extracted",
            memoryId: extracted.id,
            summary: extracted.summary,
          };
        }

        const completionHooks = await this.runLifecycleHooks({
          eventType: "Notification",
          runId: input.runId,
          projectId: input.projectId ?? input.repoId,
          ticketId: input.ticketId,
          stage: mapExecutionStage(state.iteration, state.currentRole, state.toolCallsTotal > 0),
          eventPayload: {
            status: "completed",
            finalMessage: assistantText,
          },
        });
        for (const event of completionHooks.events) {
          yield event;
        }

        yield {
          type: "execution_complete",
          finalMessage: assistantText,
          totalIterations: state.iteration,
          totalToolCalls: state.toolCallsTotal,
        };

        // Record event
        await this.events.appendEvent({
          type: "agentic.execution.completed",
          aggregateId: input.runId,
          actor: input.actor,
          payload: {
            objective: input.objective,
            iterations: state.iteration,
            toolCalls: state.toolCallsTotal,
            budget: state.budget,
          },
        });

        return;
      }

      // 6. Get tool results from executor
      const toolResults = executor.getToolResults();

      // 7. Add tool results to conversation with role: "tool_result"
      for (const toolResult of toolResults) {
        state.conversation.push({
          role: "tool_result",
          content: JSON.stringify({
            tool_use_id: toolResult.toolUseId,
            tool_name: toolResult.toolName,
            result: toolResult.result,
            duration_ms: toolResult.durationMs,
          }),
          toolUseId: toolResult.toolUseId,
          toolName: toolResult.toolName,
          timestamp: new Date().toISOString(),
        });

        // 7b. Capture recently-read files for post-compaction restoration
        if (
          toolResult.toolName === "read_file" &&
          toolResult.result.type === "success" &&
          toolResult.result.content
        ) {
          // Extract the file path from the tool input (via the matching tool call)
          const matchingCall = toolCalls.find((tc) => tc.id === toolResult.toolUseId);
          const filePath =
            matchingCall && typeof matchingCall.input === "object" && matchingCall.input !== null
              ? (matchingCall.input as Record<string, unknown>).path ?? (matchingCall.input as Record<string, unknown>).file_path ?? "unknown"
              : "unknown";

          const truncatedContent = toolResult.result.content.slice(0, 5000);

          state.recentlyReadFiles.push({
            path: String(filePath),
            content: truncatedContent,
          });

          // Keep only the last 5 recently read files
          if (state.recentlyReadFiles.length > 5) {
            state.recentlyReadFiles = state.recentlyReadFiles.slice(-5);
          }
        }
      }

      // Post-tool compaction: large tool results may spike pressure
      const postToolPressure = this.measurePressure(state, maxContextTokens);
      if (postToolPressure > 0.85) {
        const emergencyCompaction = this.checkAndCompact(state, maxContextTokens, input.runId);
        if (emergencyCompaction !== null) {
          yield emergencyCompaction;
        }
      }

      if (deferredLoader) {
        const newlyLoaded = new Set<string>();
        for (const toolResult of toolResults) {
          if (toolResult.toolName !== "tool_search" || toolResult.result.type !== "success") {
            continue;
          }
          const toolNames = Array.isArray(toolResult.result.metadata?.toolNames)
            ? toolResult.result.metadata?.toolNames.filter((item): item is string => typeof item === "string")
            : [];
          deferredLoader.markLoadedBatch(toolNames);
          for (const name of toolNames) {
            if (!newlyLoaded.has(name)) {
              newlyLoaded.add(name);
            }
          }
        }

        if (newlyLoaded.size > 0) {
          state.conversation.push({
            role: "system",
            content: `[Tool catalog updated] Newly loaded tools are now available: ${Array.from(newlyLoaded).join(", ")}`,
            timestamp: new Date().toISOString(),
          });
        }
      }

      this.updateSkillConstraintFromToolResults(state, toolResults);

      try {
        if (this.autoMemoryExtractor?.shouldExtract(input.runId, state.iteration)) {
          const extracted = await this.autoMemoryExtractor.extractFromIteration({
            runId: input.runId,
            projectId: input.projectId ?? input.repoId,
            ticketId: input.ticketId,
            iteration: state.iteration,
            conversationHistory: state.conversation
              .filter((message) => message.role !== "tool_result")
              .map((message) => ({
                role: message.role as "system" | "user" | "assistant",
                content: message.content,
              })),
            toolCalls: toolResults.map((result) => {
              const matchingCall = toolCalls.find((call) => call.id === result.toolUseId);
              return {
                name: result.toolName,
                args: matchingCall?.input ?? {},
                resultType: result.result.type,
                durationMs: result.durationMs,
              };
            }),
            objective: input.objective,
          });

          if (extracted) {
            yield {
              type: "memory_extracted",
              memoryId: extracted.id,
              summary: extracted.summary,
            };
          }
        }
      } catch (memoryError) {
        yield {
          type: "error" as const,
          error: `Memory extraction failed: ${memoryError instanceof Error ? memoryError.message : String(memoryError)}`,
          recoverable: true,
        };
      }

      plan = this.planService ? await this.planService.getPlan(input.runId) : plan;
      if (input.planMode && plan && (plan.phase === "plan_review" || this.hasPendingPlanQuestion(toolResults))) {
        const notificationHooks = await this.runLifecycleHooks({
          eventType: "Notification",
          runId: input.runId,
          projectId: input.projectId ?? input.repoId,
          ticketId: input.ticketId,
          stage: mapExecutionStage(state.iteration, state.currentRole, state.toolCallsTotal > 0),
          eventPayload: {
            status: plan.phase,
            planMode: true,
          },
        });
        for (const event of notificationHooks.events) {
          yield event;
        }
        return;
      }

      // Reset executor for next iteration
      executor.reset();

      if (state.activeSkillConstraint?.remainingIterations != null) {
        const remaining = state.activeSkillConstraint.remainingIterations - 1;
        state.activeSkillConstraint = {
          ...state.activeSkillConstraint,
          remainingIterations: remaining,
        };
        if (remaining <= 0) {
          state.activeSkillConstraint = null;
        }
      }

      // 8. Check doom loop detector
      if (toolCalls.length > 0) {
        const fingerprint = toolCalls.map((tc) => tc.name).join(",");
        this.doomLoopDetector.record("tool_calls", { pattern: fingerprint });

        if (this.doomLoopDetector.isLooping()) {
          const loopingAction = this.doomLoopDetector.getLoopingAction();
          telemetry.incrementCounter(METRICS.DOOM_LOOP_DETECTED, { [METRIC_LABELS.RUN_ID]: input.runId });
          yield {
            type: "doom_loop_detected",
            reason: `Repeated pattern detected: ${loopingAction}`,
            suggestion: "Escalating to higher model role",
          };

          // Try escalation
          const escalated = this.tryEscalate(state);
          if (escalated) {
            yield escalated;
            this.doomLoopDetector.reset();
          } else {
            // Already on highest role — abort
            executionSpan.setAttribute("iterations", state.iteration);
            executionSpan.setAttribute("tool_calls", state.toolCallsTotal);
            executionSpan.setStatus("error", "Doom loop on highest role");
            const abortHooks = await this.runLifecycleHooks({
              eventType: "Notification",
              runId: input.runId,
              projectId: input.projectId ?? input.repoId,
              ticketId: input.ticketId,
              stage: mapExecutionStage(state.iteration, state.currentRole, state.toolCallsTotal > 0),
              eventPayload: {
                status: "aborted",
                reason: "Doom loop detected on highest model role",
              },
            });
            for (const event of abortHooks.events) {
              yield event;
            }
            yield {
              type: "execution_aborted",
              reason: "Doom loop detected on highest model role",
            };
            return;
          }
        }
      }

      // 8. Continue loop
      yield {
        type: "loop_continuing",
        reason: `Iteration ${state.iteration} completed with ${toolCalls.length} tool call(s)`,
      };
    }

    // Max iterations reached
    executionSpan.setAttribute("iterations", state.iteration);
    executionSpan.setAttribute("tool_calls", state.toolCallsTotal);
    executionSpan.setStatus("error", "Max iterations reached");

    yield {
      type: "max_iterations_reached",
      iterations: state.iteration,
    };

    const abortHooks = await this.runLifecycleHooks({
      eventType: "Notification",
      runId: input.runId,
      projectId: input.projectId ?? input.repoId,
      ticketId: input.ticketId,
      stage: mapExecutionStage(state.iteration, state.currentRole, state.toolCallsTotal > 0),
      eventPayload: {
        status: "aborted",
        reason: `Maximum iterations (${maxIterations}) reached without completion`,
      },
    });
    for (const event of abortHooks.events) {
      yield event;
    }

    yield {
      type: "execution_aborted",
      reason: `Maximum iterations (${maxIterations}) reached without completion`,
    };

    } finally {
      // Clean up abort controller
      if (!rootAbort.aborted) {
        rootAbort.abort("execution_complete");
      }
      // Clean up budget tracker
      if (this.budgetTracker) {
        this.budgetTracker.removeBudget(input.runId);
      }
      // Record total loop duration
      telemetry.recordMetric(METRICS.AGENTIC_LOOP_DURATION_MS, Date.now() - executionStartTime, { [METRIC_LABELS.RUN_ID]: input.runId });
      executionSpan.end();
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private selectToolSchemas(input: {
    ctx: ToolContext;
    deferredLoader: DeferredToolLoader | null;
    planMode: boolean;
    skillConstraint: IterationState["activeSkillConstraint"];
  }) {
    let schemas = input.deferredLoader
      ? input.deferredLoader.getActiveToolSchemas()
      : this.registry.toJsonSchemasForContext(input.ctx);

    if (input.planMode) {
      const planningSchemas = this.registry
        .toJsonSchemasFor(Array.from(PLANNING_TOOL_NAMES))
        .concat(this.registry.toJsonSchemasForContext(input.ctx).filter((schema) => PLANNING_TOOL_NAMES.has(schema.name)));
      schemas = dedupeToolSchemas(planningSchemas);
    }

    if (input.skillConstraint?.allowedTools?.length) {
      const allowed = new Set([
        ...input.skillConstraint.allowedTools,
        "complete_task",
        "ask_user",
        "run_tests",
        "run_lint",
        "skill",
      ]);
      schemas = schemas.filter((schema) => allowed.has(schema.name));
    }

    return dedupeToolSchemas(schemas);
  }

  private formatPlanContext(plan: Awaited<ReturnType<PlanService["getPlan"]>>): string {
    if (!plan) {
      return "";
    }

    const lines = [
      "## Plan Mode",
      `Current plan phase: ${plan.phase}`,
      plan.planContent ? `Current draft plan:\n${plan.planContent}` : "No draft plan has been submitted yet.",
    ];

    if (plan.questions.length > 0) {
      lines.push("Plan questions:");
      for (const question of plan.questions) {
        lines.push(`- ${question.question}${question.answer ? `\n  Answer: ${question.answer}` : "\n  Answer pending"}`);
      }
    }

    lines.push("During plan mode, explore safely and use submit_plan when ready.");
    return lines.join("\n");
  }

  private async runLifecycleHooks(input: {
    eventType: "PreCompact" | "PostCompact" | "UserPromptSubmit" | "SessionStart" | "Notification";
    runId: string;
    projectId: string;
    ticketId: string;
    stage: string;
    eventPayload: Record<string, unknown>;
  }): Promise<{ events: AgenticEvent[]; systemMessages: string[]; shouldAbort: boolean }> {
    if (!this.hookService) {
      return { events: [], systemMessages: [], shouldAbort: false };
    }

    const aggregate = await this.hookService.executeHooksForEvent({
      eventType: input.eventType,
      eventPayload: input.eventPayload,
      context: {
        runId: input.runId,
        projectId: input.projectId,
        ticketId: input.ticketId,
        stage: input.stage,
      },
    });

    const shouldAbort = aggregate.outputs.some(
      ({ output }) => !output.success && !output.continue
    );

    return {
      events: aggregate.outputs.map(({ hook, output }) => ({
        type: "hook_executed" as const,
        hookId: hook.id,
        hookName: hook.name,
        eventType: input.eventType,
        success: output.success,
      })),
      systemMessages: aggregate.systemMessages,
      shouldAbort,
    };
  }

  private appendSystemMessages(state: IterationState, messages: string[]) {
    for (const message of messages) {
      state.conversation.push({
        role: "system",
        content: message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private measurePressure(state: IterationState, maxContextTokens: number): number {
    const messages: CompactionMessage[] = state.conversation.map((message) => ({
      role: message.role as "system" | "user" | "assistant",
      content: message.content,
      pinned: message.pinned,
    }));
    return computePressure(messages, maxContextTokens);
  }

  private updateSkillConstraintFromToolResults(
    state: IterationState,
    toolResults: ToolResultBlock[],
  ): void {
    const skillResult = toolResults.find(
      (item) => item.toolName === "skill" && item.result.type === "success",
    );
    if (!skillResult || skillResult.result.type !== "success") {
      return;
    }

    const allowedTools = Array.isArray(skillResult.result.metadata?.allowedTools)
      ? skillResult.result.metadata.allowedTools.filter((item): item is string => typeof item === "string")
      : [];
    const maxIterations =
      typeof skillResult.result.metadata?.maxIterations === "number"
        ? skillResult.result.metadata.maxIterations
        : null;
    const skillName =
      typeof skillResult.result.metadata?.skillName === "string"
        ? skillResult.result.metadata.skillName
        : "skill";

    state.activeSkillConstraint = {
      skillName,
      allowedTools: allowedTools.length > 0 ? allowedTools : null,
      remainingIterations: maxIterations,
    };
  }

  private hasPendingPlanQuestion(toolResults: ToolResultBlock[]): boolean {
    return toolResults.some(
      (item) => item.toolName === "ask_plan_question" && item.result.type === "approval_required",
    );
  }

  private checkAndCompact(
    state: IterationState,
    maxContextTokens: number,
    runId?: string,
  ): AgenticEvent | null {
    // Circuit breaker: if compaction has failed too many times in a row, abort
    if (state.consecutiveCompactionFailures >= MAX_CONSECUTIVE_COMPACTION_FAILURES) {
      return {
        type: "execution_aborted" as AgenticEvent["type"],
        reason: `Context management failed after ${MAX_CONSECUTIVE_COMPACTION_FAILURES} consecutive compaction failures`,
      } as AgenticEvent;
    }

    const telemetry = getTelemetry();
    const compactionMessages: CompactionMessage[] = state.conversation.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
      pinned: m.pinned,
    }));

    const pressure = computePressure(compactionMessages, maxContextTokens);
    const tokensBefore = compactionMessages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
    telemetry.recordMetric(METRICS.CONTEXT_TOKENS_USED, tokensBefore, { [METRIC_LABELS.RUN_ID]: runId ?? "" });

    if (pressure > 0.7) {
      // If contextCollapseService is available and pressure is moderate (0.7-0.9),
      // try non-destructive projection first
      if (this.contextCollapseService && pressure < 0.9 && runId) {
        const projected = this.contextCollapseService.projectConversation({
          runId,
          messages: state.conversation,
          maxTokens: maxContextTokens,
          pressureThreshold: 0.7,
        });

        if (projected.collapsed && projected.turnsCollapsed > 0) {
          this.memoryService.commitCompactionSummary({
            droppedMessageCount: projected.turnsCollapsed,
            stage: 1,
            pressure,
            sessionContext: state.conversation.slice(-4).map((message) => message.content).join("\n"),
          });
          state.conversation = projected.messages;
          state.consecutiveCompactionFailures = 0; // Reset on success
          return {
            type: "context_compacted",
            stage: "projected",
            tokensBefore: compactionMessages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0),
            tokensAfter: projected.messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0),
          };
        }
      }

      // Fall back to destructive compaction if pressure >= 0.9 or no contextCollapseService
      const result = compactMessages(compactionMessages, maxContextTokens);
      this.memoryService.commitCompactionSummary({
        droppedMessageCount: Math.max(0, state.conversation.length - result.messages.length),
        stage: result.stage,
        pressure,
        sessionContext: state.conversation.slice(-4).map((message) => message.content).join("\n"),
      });

      // Update conversation with compacted messages
      state.conversation = result.messages.map((m, i) => ({
        role: m.role,
        content: m.content,
        pinned: m.pinned,
        timestamp: state.conversation[i]?.timestamp || new Date().toISOString(),
      }));

      // Post-compaction file restoration: re-inject recently-read files
      // so the agent retains awareness of files it was just working with.
      const TOKEN_BUDGET = 50000;
      const PER_FILE_BUDGET = 5000;
      let tokensUsed = 0;

      for (const file of state.recentlyReadFiles) {
        const estTokens = Math.ceil(file.content.length / 4);
        if (tokensUsed + estTokens > TOKEN_BUDGET || estTokens > PER_FILE_BUDGET) continue;

        state.conversation.push({
          role: "system",
          content: `[Restored after compaction] ${file.path}:\n${file.content}`,
          timestamp: new Date().toISOString(),
          // NOT pinned — can be compacted again
        });
        tokensUsed += estTokens;
      }

      const tokensFreed = result.tokensBefore - result.tokensAfter;
      telemetry.recordMetric(METRICS.CONTEXT_TOKENS_FREED, tokensFreed, { [METRIC_LABELS.RUN_ID]: runId ?? "" });

      // Track compaction effectiveness for circuit breaker
      if (tokensFreed > 0) {
        state.consecutiveCompactionFailures = 0; // Reset on success
      } else {
        state.consecutiveCompactionFailures++; // Compaction didn't free any tokens
      }

      return {
        type: "context_compacted",
        stage: result.stage,
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter,
      };
    }

    return null;
  }

  private tryEscalate(state: IterationState): AgenticEvent | null {
    const escalationPath: ModelRole[] = [
      "coder_default",
      "review_deep",
      "overseer_escalation",
    ];

    const currentIndex = escalationPath.indexOf(state.currentRole);
    if (currentIndex < 0 || currentIndex >= escalationPath.length - 1) {
      return null; // Already at highest role
    }

    const nextRole = escalationPath[currentIndex + 1];
    const fromRole = state.currentRole;
    state.currentRole = nextRole;

    return {
      type: "escalating",
      fromRole,
      toRole: nextRole,
      reason: "doom_loop_detected",
    };
  }

  private checkBudgetWarning(
    state: IterationState,
    input: AgenticExecutionInput,
  ): AgenticEvent | null {
    const budget = input.budget;
    if (!budget) return null;

    // Check token budget warning (>= 80%)
    if (
      budget.maxTokens &&
      state.budget.tokensConsumed >= budget.maxTokens * 0.8
    ) {
      return {
        type: "budget_warning",
        consumed: state.budget.tokensConsumed,
        limit: budget.maxTokens,
        resource: "tokens",
      };
    }

    // Check cost budget warning (>= 80%)
    if (
      budget.maxCostUsd &&
      state.budget.costUsd >= budget.maxCostUsd * 0.8
    ) {
      return {
        type: "budget_warning",
        consumed: state.budget.costUsd,
        limit: budget.maxCostUsd,
        resource: "cost_usd",
      };
    }

    // Check iteration budget warning (>= 80%)
    const maxIterations = input.maxIterations ?? 50;
    if (state.iteration >= maxIterations * 0.8) {
      return {
        type: "budget_warning",
        consumed: state.iteration,
        limit: maxIterations,
        resource: "iterations",
      };
    }

    return null;
  }

  private checkBudgetAbort(
    state: IterationState,
    input: AgenticExecutionInput,
  ): AgenticEvent | null {
    const budget = input.budget;
    if (!budget) return null;

    // Check token budget abort (>= 100%)
    if (budget.maxTokens && state.budget.tokensConsumed >= budget.maxTokens) {
      return {
        type: "execution_aborted",
        reason: `Token budget exhausted: ${state.budget.tokensConsumed} / ${budget.maxTokens}`,
      };
    }

    // Check cost budget abort (>= 100%)
    if (budget.maxCostUsd && state.budget.costUsd >= budget.maxCostUsd) {
      return {
        type: "execution_aborted",
        reason: `Cost budget exhausted: $${state.budget.costUsd.toFixed(4)} / $${budget.maxCostUsd}`,
      };
    }

    return null;
  }
}

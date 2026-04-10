import { z } from "zod";
import type { ModelRole, ProviderId, ReasoningMode } from "../../shared/contracts";

// ---------------------------------------------------------------------------
// Tool Result Types
// ---------------------------------------------------------------------------

export interface ToolResultSuccess {
  type: "success";
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ToolResultError {
  type: "error";
  error: string;
  metadata?: Record<string, unknown>;
}

export interface ToolResultApprovalRequired {
  type: "approval_required";
  approvalId: string;
  message: string;
}

export type ToolResult = ToolResultSuccess | ToolResultError | ToolResultApprovalRequired;

// ---------------------------------------------------------------------------
// Tool Context — injected into every tool execution
// ---------------------------------------------------------------------------

export interface ToolContext {
  /** Current run identifier */
  runId: string;
  /** Repository identifier */
  repoId: string;
  /** Ticket/task identifier */
  ticketId: string;
  /** Absolute path to the active worktree */
  worktreePath: string;
  /** Actor performing the action (e.g. "agent:coder_default") */
  actor: string;
  /** Current execution stage */
  stage: "scope" | "build" | "review" | "escalate";
  /** Conversation messages so far (read-only) */
  conversationHistory: readonly ConversationMessage[];

  // ---- Service references (injected by orchestrator) ----
  /** Create an approval request and return its id */
  createApproval: (req: { actionType: string; payload: Record<string, unknown> }) => Promise<{ id: string }>;
  /** Record a domain event */
  recordEvent: (event: { type: string; payload: Record<string, unknown> }) => Promise<void>;

  // ---- Optional: team context for multi-agent ----
  teamContext?: TeamContext;
}

export interface TeamContext {
  teamId: string;
  agentId: string;
  sendMessage: (toAgent: string, message: string) => void;
  receiveMessages: () => ConversationMessage[];
  getAllAgents: () => Array<{
    id: string;
    role: "planner" | "implementer" | "tester" | "reviewer" | "researcher";
    objective: string;
    fileScope?: string[];
  }>;
  getActiveAgents: () => string[];
  addAgent: (spec: {
    id: string;
    role: "planner" | "implementer" | "tester" | "reviewer" | "researcher";
    objective: string;
    fileScope?: string[];
  }) => void;
}

// ---------------------------------------------------------------------------
// Conversation Message Types
// ---------------------------------------------------------------------------

export type ConversationRole = "system" | "user" | "assistant" | "tool_result";

export interface ConversationMessage {
  role: ConversationRole;
  content: string;
  /** Present only for tool_result messages */
  toolUseId?: string;
  /** Present only for tool_result messages */
  toolName?: string;
  /** Timestamp for ordering / compaction */
  timestamp?: string;
  /** If true, message survives compaction */
  pinned?: boolean;
}

// ---------------------------------------------------------------------------
// Permission Requirements
// ---------------------------------------------------------------------------

export type ToolPermissionScope =
  | "repo.read"
  | "repo.edit"
  | "repo.verify"
  | "repo.install"
  | "git.meta"
  | "git.write"
  | "network"
  | "meta";

export interface ToolPermission {
  scope: ToolPermissionScope;
  /** Static flag — if true, always requires user approval */
  requiresApproval?: boolean;
  /** Dynamic check — receives the parsed input */
  checkApproval?: (input: unknown, ctx: ToolContext) => boolean;
  /** If true, this tool only reads and never modifies state */
  readOnly?: boolean;
  /** If true, this tool can destroy data (rm, git reset, etc.) */
  destructive?: boolean;
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export interface ToolDefinition<TInput = unknown> {
  /** Unique tool name (e.g. "read_file", "bash") */
  name: string;
  /** Human-readable description for the LLM prompt */
  description: string;
  /** Zod schema for input validation */
  inputSchema: z.ZodType<TInput>;
  /** Execute the tool with validated input */
  execute: (input: TInput, ctx: ToolContext) => Promise<ToolResult>;
  /** Permission metadata */
  permission: ToolPermission;

  // ---- Optional metadata ----

  /** Aliases for backwards compatibility */
  aliases?: string[];
  /** Keywords for tool search / deferred loading */
  searchHints?: string[];
  /** If true, this tool is included in the initial prompt (not deferred) */
  alwaysLoad?: boolean;
  /** If true, multiple instances can run concurrently */
  concurrencySafe?: boolean;
  /** Max result size in chars before persisting to disk */
  maxResultSizeChars?: number;
  /** If true, this tool is only available in certain contexts */
  isEnabled?: (ctx: ToolContext) => boolean;
}

// ---------------------------------------------------------------------------
// Tool Use Events (from provider stream)
// ---------------------------------------------------------------------------

export interface ToolUseBlock {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  toolUseId: string;
  toolName: string;
  result: ToolResult;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Execution Events (emitted by streaming executor / orchestrator)
// Re-exported from the canonical definition in shared/contracts.ts
// ---------------------------------------------------------------------------

export type { AgenticEvent } from "../../shared/contracts";

// ---------------------------------------------------------------------------
// Orchestrator Configuration
// ---------------------------------------------------------------------------

export interface AgenticExecutionInput {
  runId: string;
  repoId: string;
  ticketId: string;
  projectId?: string;
  objective: string;
  worktreePath: string;
  actor: string;
  /** Override for max loop iterations (default 50) */
  maxIterations?: number;
  /** Model role to start with (default "coder_default") */
  initialModelRole?: ModelRole;
  /** Provider to use (default from role binding) */
  providerId?: ProviderId;
  /** Budget limits */
  budget?: {
    maxTokens?: number;
    maxCostUsd?: number;
    maxDurationMs?: number;
    /** Max output tokens per individual turn (default: no limit) */
    perTurnMaxOutputTokens?: number;
  };
  /** If true, use deferred tool loading */
  useDeferredTools?: boolean;
  /** Extra system prompt content */
  systemPromptSuffix?: string;
  /** If true, begin in planning mode and require plan approval before execution */
  planMode?: boolean;
  /**
   * Reasoning/extended-thinking mode.
   * - "off": no extended thinking
   * - "on": always use extended thinking
   * - "auto": activate on first iteration and after model escalation
   */
  reasoningMode?: ReasoningMode;
}

// ---------------------------------------------------------------------------
// Tool JSON Schema (for sending to LLM API)
// ---------------------------------------------------------------------------

export interface ToolJsonSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

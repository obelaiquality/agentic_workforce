/**
 * Predefined metric names for agent telemetry
 *
 * These constants ensure consistent naming across the application
 * and make it easier to query and analyze metrics.
 */
export const METRICS = {
  /** Tool execution duration in milliseconds */
  TOOL_EXECUTION_DURATION_MS: "tool.execution.duration_ms",

  /** Total number of tool executions */
  TOOL_EXECUTION_COUNT: "tool.execution.count",

  /** Number of tool execution errors */
  TOOL_ERROR_COUNT: "tool.error.count",

  /** Number of iterations in the agentic loop */
  AGENTIC_LOOP_ITERATIONS: "agentic.loop.iterations",

  /** Total duration of the agentic loop in milliseconds */
  AGENTIC_LOOP_DURATION_MS: "agentic.loop.duration_ms",

  /** Number of context tokens currently in use */
  CONTEXT_TOKENS_USED: "context.tokens.used",

  /** Number of tokens freed by compaction */
  CONTEXT_TOKENS_FREED: "context.tokens.freed",

  /** Number of context compaction operations performed */
  CONTEXT_COMPACTION_COUNT: "context.compaction.count",

  /** Number of provider requests made */
  PROVIDER_REQUEST_COUNT: "provider.request.count",

  /** Provider request duration in milliseconds */
  PROVIDER_REQUEST_DURATION_MS: "provider.request.duration_ms",

  /** Number of input tokens sent to provider */
  PROVIDER_TOKEN_INPUT: "provider.token.input",

  /** Number of output tokens received from provider */
  PROVIDER_TOKEN_OUTPUT: "provider.token.output",

  /** Provider cache hit rate (0.0 - 1.0) */
  PROVIDER_CACHE_HIT_RATE: "provider.cache.hit_rate",

  /** Number of tokens consumed against budget */
  BUDGET_TOKENS_CONSUMED: "budget.tokens.consumed",

  /** Cost in USD charged against budget */
  BUDGET_COST_USD: "budget.cost.usd",

  /** Number of doom loops detected */
  DOOM_LOOP_DETECTED: "doom_loop.detected",

  /** Number of approval requests made */
  APPROVAL_REQUESTED: "approval.requested",

  /** Number of MCP tool calls made */
  MCP_TOOL_CALL_COUNT: "mcp.tool_call.count",
} as const;

/**
 * Common label keys for metrics
 */
export const METRIC_LABELS = {
  /** Tool name (e.g., "bash", "read_file") */
  TOOL_NAME: "tool_name",

  /** Tool permission scope (e.g., "repo.read", "repo.edit") */
  TOOL_SCOPE: "tool_scope",

  /** Provider ID (e.g., "qwen-cli", "openai") */
  PROVIDER_ID: "provider_id",

  /** Model role (e.g., "coder_default", "review_deep") */
  MODEL_ROLE: "model_role",

  /** Execution stage (e.g., "scope", "build", "review") */
  STAGE: "stage",

  /** Run ID */
  RUN_ID: "run_id",

  /** Ticket ID */
  TICKET_ID: "ticket_id",

  /** Success/failure status */
  STATUS: "status",

  /** Error type (if applicable) */
  ERROR_TYPE: "error_type",

  /** MCP server name */
  MCP_SERVER: "mcp_server",
} as const;

export type ProviderId = "qwen-cli" | "openai-compatible" | "onprem-qwen" | "openai-responses";

export type ModelRole = "utility_fast" | "coder_default" | "review_deep" | "overseer_escalation";
export type LocalRuntimeRole = "utility_fast" | "coder_default" | "review_deep";

export type ReasoningMode = "off" | "on" | "auto";
export type ExecutionProfileStage = "scope" | "build" | "review" | "escalate";

export type ExecutionMode = "single_agent" | "centralized_parallel" | "research_swarm" | "interview" | "ralph" | "team";

export type ProjectSourceKind = "local_attached" | "github_app_bound" | "managed_demo_pack";

// ---------------------------------------------------------------------------
// Agentic Execution Types (from src/server/tools/types.ts)
// ---------------------------------------------------------------------------

export type AgenticEvent =
  | { type: "iteration_start"; iteration: number; messageCount: number }
  | { type: "assistant_token"; value: string }
  | { type: "assistant_thinking"; value: string }
  | { type: "tool_use_started"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; result: ToolResultDto; durationMs: number }
  | { type: "tool_approval_needed"; id: string; name: string; approvalId: string; message: string }
  | { type: "tool_denied"; id: string; name: string; reasons: string[] }
  | { type: "context_compacted"; stage: number; tokensBefore: number; tokensAfter: number }
  | { type: "doom_loop_detected"; reason: string; suggestion: string }
  | { type: "escalating"; fromRole: ModelRole; toRole: ModelRole; reason: string }
  | { type: "budget_warning"; consumed: number; limit: number; resource: "tokens" | "cost_usd" | "iterations" }
  | { type: "loop_continuing"; reason: string }
  | { type: "execution_complete"; finalMessage: string; totalIterations: number; totalToolCalls: number }
  | { type: "execution_aborted"; reason: string }
  | { type: "max_iterations_reached"; iterations: number }
  | { type: "error"; error: string; recoverable: boolean }
  | { type: "plan_started" }
  | { type: "plan_submitted"; planContent: string }
  | { type: "plan_approved"; reviewedBy: string }
  | { type: "plan_rejected"; reason: string; reviewedBy: string }
  | { type: "plan_refine_requested"; feedback: string }
  | { type: "plan_question_asked"; questionId: string; question: string }
  | { type: "plan_question_answered"; questionId: string; answer: string }
  | { type: "skill_invoked"; skillId: string; skillName: string; invocationId: string }
  | { type: "skill_completed"; invocationId: string; output: string }
  | { type: "skill_failed"; invocationId: string; error: string }
  | { type: "subtask_created"; subtaskId: string; title: string }
  | { type: "subtask_updated"; subtaskId: string; status: string }
  | { type: "hook_executed"; hookId: string; hookName: string; eventType: string; success: boolean }
  | { type: "memory_extracted"; memoryId: string; summary: string }
  // Interview Mode events
  | { type: "interview_started"; sessionId: string; maxRounds: number }
  | { type: "interview_question"; questionId: string; question: string; round: number; challengeMode?: string; targetDimension: string }
  | { type: "interview_answered"; questionId: string; answer: string }
  | { type: "interview_scored"; round: number; overall: number; dimensions: Record<string, number> }
  | { type: "interview_spec_crystallized"; specContent: string; finalAmbiguity: number }
  | { type: "interview_handoff"; targetMode: "ralph" | "team" | "autopilot" }
  // Ralph Mode events
  | { type: "ralph_started"; sessionId: string; specSummary: string; maxIterations: number }
  | { type: "ralph_phase_entered"; phase: string; iteration: number }
  | { type: "ralph_phase_exited"; phase: string; iteration: number; result: string }
  | { type: "ralph_verification"; tier: string; passed: boolean; details: Record<string, boolean> }
  | { type: "ralph_checkpoint"; iteration: number; phase: string }
  | { type: "ralph_resumed"; fromIteration: number; fromPhase: string }
  // Enhanced Team Mode events
  | { type: "team_session_started"; sessionId: string; workerCount: number; phase: string }
  | { type: "team_phase_changed"; from: string; to: string }
  | { type: "team_worker_status"; workerId: string; role: string; status: string; taskId?: string }
  | { type: "team_task_dispatched"; taskId: string; workerId: string; description: string }
  | { type: "team_task_result"; taskId: string; workerId: string; status: string }
  | { type: "team_message"; from: string; to: string; content: string }
  | { type: "team_heartbeat_timeout"; workerId: string; lastSeen: string };

export interface AgenticRunEventRecord {
  id: string;
  runId: string;
  ticketId: string | null;
  projectId: string | null;
  type: AgenticEvent["type"];
  createdAt: string;
  payload: Record<string, unknown>;
}

export type AgenticRunPhase = "planning" | "plan_review" | "executing" | "completed" | "failed" | "aborted";

export interface AgenticRunPlan {
  runId: string;
  phase: AgenticRunPhase;
  planContent: string | null;
  questions: Array<{
    id: string;
    question: string;
    answer: string | null;
    askedAt: string;
    answeredAt: string | null;
  }>;
  approved: boolean;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgenticToolCallRecord {
  id: string;
  iteration: number;
  name: string;
  args: Record<string, unknown>;
  result: ToolResultDto;
  policyDecision: "allow" | "approval_required" | "deny";
  durationMs: number;
  timestamp: string;
}

export interface AgenticCompactionRecord {
  iteration: number;
  stage: number | string;
  tokensBefore: number;
  tokensAfter: number;
  timestamp: string;
}

export interface AgenticEscalationRecord {
  iteration: number;
  fromRole: ModelRole;
  toRole: ModelRole;
  reason: string;
  timestamp: string;
}

export interface AgenticDoomLoopRecord {
  iteration: number;
  reason: string;
  suggestion: string;
  timestamp: string;
}

export interface AgenticSkillEventRecord {
  invocationId: string;
  skillId: string;
  skillName: string;
  status: "running" | "completed" | "failed";
  output: string | null;
  childRunId: string | null;
  timestamp: string;
}

export interface AgenticHookEventRecord {
  hookId: string;
  hookName: string;
  eventType: HookEventType;
  success: boolean;
  output: string | null;
  error: string | null;
  timestamp: string;
}

export interface AgenticMemoryExtractionRecord {
  memoryId: string;
  summary: string;
  timestamp: string;
}

export interface AgenticRunSnapshot {
  runId: string;
  status: "idle" | "running" | "completed" | "aborted" | "failed";
  phase: AgenticRunPhase;
  plan: AgenticRunPlan | null;
  iterationCount: number;
  toolCallCount: number;
  approvalCount: number;
  deniedCount: number;
  compactionCount: number;
  doomLoopCount: number;
  escalationCount: number;
  thinkingTokenCount: number;
  lastAssistantText: string | null;
  lastReason: string | null;
  latestRole: ModelRole | null;
  resumable?: boolean;
  budget: {
    tokensConsumed: number | null;
    maxTokens: number | null;
    costUsdConsumed: number | null;
    maxCostUsd: number | null;
    iterationsConsumed: number | null;
    maxIterations: number | null;
    tokenTimeline: Array<{ iteration: number; tokens: number; timestamp: string }>;
  };
  recentEvents: AgenticRunEventRecord[];
  toolCalls: AgenticToolCallRecord[];
  compactionEvents: AgenticCompactionRecord[];
  escalations: AgenticEscalationRecord[];
  doomLoops: AgenticDoomLoopRecord[];
  skillEvents: AgenticSkillEventRecord[];
  hookEvents: AgenticHookEventRecord[];
  memoryExtractions: AgenticMemoryExtractionRecord[];
  thinkingLog: string | null;
}

export type ToolResultDto =
  | { type: "success"; content: string; metadata?: Record<string, unknown> }
  | { type: "error"; error: string; metadata?: Record<string, unknown> }
  | { type: "approval_required"; approvalId: string; message: string };

export interface AgenticExecutionInput {
  runId: string;
  repoId: string;
  ticketId: string;
  projectId?: string;
  objective: string;
  worktreePath: string;
  actor: string;
  maxIterations?: number;
  initialModelRole?: ModelRole;
  providerId?: ProviderId;
  budget?: {
    maxTokens?: number;
    maxCostUsd?: number;
    maxDurationMs?: number;
  };
  useDeferredTools?: boolean;
  systemPromptSuffix?: string;
  planMode?: boolean;
  coordinator?: boolean;
  coordinatorOptions?: {
    maxAgents?: number;
    maxConcurrent?: number;
    allowRespawn?: boolean;
    conflictResolution?: "first_wins" | "merge" | "integrator";
  };
}

// ---------------------------------------------------------------------------
// Interview Mode Types
// ---------------------------------------------------------------------------

export type InterviewChallengeMode = "contrarian" | "simplifier" | "ontologist";

export interface InterviewDimensions {
  intent: number;
  outcome: number;
  scope: number;
  constraints: number;
  success: number;
  context?: number;
}

export interface InterviewModeInput {
  runId: string;
  repoId: string;
  ticketId?: string;
  objective: string;
  actor: string;
  worktreePath: string;
  isGreenfield?: boolean;
  maxRounds?: number;
  ambiguityThreshold?: number;
  handoffMode?: "ralph" | "team" | "autopilot";
}

// ---------------------------------------------------------------------------
// Ralph Mode Types
// ---------------------------------------------------------------------------

export type RalphPhase =
  | "intake"
  | "execute"
  | "verify"
  | "architect_review"
  | "deslop"
  | "regression"
  | "complete";

export type RalphVerificationTier = "STANDARD" | "THOROUGH";

export interface RalphProgressLedger {
  completedPhases: RalphPhase[];
  currentObjective: string;
  filesModified: string[];
  testResults: Record<string, boolean>;
  verificationsPassed: number;
  deslopIssuesFound: number;
  deslopIssuesFixed: number;
}

export interface RalphModeInput {
  runId: string;
  repoId: string;
  ticketId?: string;
  specContent: string;
  actor: string;
  worktreePath: string;
  maxIterations?: number;
  verificationTier?: RalphVerificationTier;
  resumeFromCheckpoint?: boolean;
}

// ---------------------------------------------------------------------------
// Enhanced Team Mode Types
// ---------------------------------------------------------------------------

export type TeamPhase = "team_plan" | "team_exec" | "team_verify" | "team_fix" | "team_complete";

export type TeamWorkerStatus = "idle" | "claimed" | "executing" | "completed" | "failed";

export type TeamTaskStatus = "pending" | "claimed" | "executing" | "completed" | "failed" | "blocked";

export interface EnhancedTeamInput extends AgenticExecutionInput {
  teamPhase?: TeamPhase;
  maxWorkers?: number;
  maxConcurrentWorkers?: number;
  enableHeartbeat?: boolean;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
}

export interface ProviderCapabilities {
  streaming: boolean;
  tools: boolean;
  nativeConversationState: boolean;
  structuredOutputs: boolean;
  mcpTools: boolean;
  maxContextTokens?: number;
}

export type ProviderErrorClass =
  | "quota_exhausted"
  | "rate_limited"
  | "auth_required"
  | "timeout"
  | "provider_unavailable"
  | "unknown";

export interface CreateSessionInput {
  sessionId: string;
  workspacePath?: string;
  modelRole?: ModelRole;
  metadata?: Record<string, unknown>;
}

export interface ProviderSession {
  id: string;
  provider: ProviderId;
  accountId: string;
  model: string;
  previousResponseId?: string | null;
  capabilities: ProviderCapabilities;
  metadata?: Record<string, unknown>;
}

export interface ProviderSendInput {
  sessionId: string;
  accountId: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  modelRole?: ModelRole;
  metadata?: Record<string, unknown>;
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
}

export interface ProviderSendOutput {
  text: string;
  providerResponseId?: string | null;
  session?: Partial<ProviderSession>;
  metadata?: Record<string, unknown>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export type ProviderStreamEvent =
  | { type: "token"; value: string }
  | { type: "thinking"; value: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_use_delta"; id: string; argumentsDelta: string }
  | { type: "session"; session: Partial<ProviderSession> }
  | { type: "done"; usage?: ProviderSendOutput["usage"] };

export interface ProviderAvailability {
  accountId: string;
  state: QwenAccountState;
  nextUsableAt: string | null;
  confidence: number;
}

export interface LlmProviderAdapter {
  id: ProviderId;
  label: string;
  capabilities: ProviderCapabilities;
  supportsStreaming: boolean;
  supportsTools: boolean;
  createSession(input: CreateSessionInput): Promise<ProviderSession>;
  send(input: ProviderSendInput): Promise<ProviderSendOutput>;
  stream(input: ProviderSendInput): AsyncGenerator<ProviderStreamEvent>;
  classifyError(err: unknown): ProviderErrorClass;
  estimateAvailability(accountId: string): Promise<ProviderAvailability>;
}

export type TicketStatus = "backlog" | "ready" | "in_progress" | "review" | "blocked" | "done";

export type TicketPriority = "p0" | "p1" | "p2" | "p3";

export type TicketRisk = "low" | "medium" | "high";

export interface Ticket {
  id: string;
  repoId?: string | null;
  title: string;
  description: string;
  status: TicketStatus;
  laneOrder?: number;
  priority: TicketPriority;
  acceptanceCriteria: string[];
  dependencies: string[];
  risk: TicketRisk;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type QwenAccountState = "ready" | "cooldown" | "auth_required" | "disabled";

export interface QwenAccountProfile {
  id: string;
  label: string;
  profilePath: string;
  enabled: boolean;
  state: QwenAccountState;
  cooldownUntil: string | null;
  quotaNextUsableAt: string | null;
  quotaEtaConfidence: number;
  lastQuotaErrorAt: string | null;
  lastUsedAt: string | null;
}

export interface QwenAccountAuthSession {
  accountId: string;
  profilePath: string;
  status: "idle" | "running" | "succeeded" | "failed";
  message: string | null;
  startedAt: string;
  finishedAt: string | null;
  log: string[];
  pid: number | null;
}

export interface ChatSessionDto {
  id: string;
  repoId?: string | null;
  title: string;
  providerId: ProviderId;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessageDto {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ApprovalRequestDto {
  id: string;
  actionType: string;
  payload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  decidedAt: string | null;
}

export interface RunEventDto {
  id: string;
  runId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AuditEventDto {
  id: string;
  actor: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  supportsStreaming: boolean;
  supportsTools: boolean;
  enabled: boolean;
  kind?: "local" | "cloud";
  capabilities?: ProviderCapabilities;
}

export interface OnPremRoleRuntimeStatus {
  role: LocalRuntimeRole;
  enabled: boolean;
  configured: boolean;
  baseUrl: string;
  model: string;
  backendId: OnPremInferenceBackendId;
  running: boolean;
  pid: number | null;
  healthy: boolean | null;
  message: string | null;
}

export interface OnPremRoleRuntimeTestResult extends OnPremRoleRuntimeStatus {
  modelCount: number;
}

export type TaskLifecycleStatus =
  | "inactive"
  | "reserved"
  | "active"
  | "in_progress"
  | "blocked"
  | "completed";

export interface DomainEvent {
  event_id: string;
  aggregate_id: string;
  causation_id: string;
  correlation_id: string;
  actor: string;
  timestamp: string;
  type: string;
  payload_json: string;
  schema_version: number;
}

export interface PolicyDecision {
  decision: "allow" | "deny";
  requires_approval: boolean;
  reasons: string[];
  required_scopes: string[];
  policy_version: string;
}

export interface TaskAllocation {
  found: boolean;
  ticket_id: string;
  strategy: string;
  score: number;
  reservation_expires_at: string;
  message: string;
}

export interface KnowledgeHit {
  id: string;
  source: string;
  path: string;
  snippet: string;
  score: number;
  embedding_id: string | null;
}

export interface RoutingDecision {
  id: string;
  repoId?: string | null;
  ticketId: string | null;
  runId: string | null;
  executionMode: ExecutionMode;
  modelRole: ModelRole;
  providerId: ProviderId;
  maxLanes: number;
  risk: "low" | "medium" | "high";
  verificationDepth: "light" | "standard" | "deep";
  decompositionScore: number;
  estimatedFileOverlap: number;
  rationale: string[];
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ContextManifest {
  id: string;
  repoId?: string | null;
  aggregateId: string;
  aggregateType: "ticket" | "run" | "lane";
  goal: string;
  constraints: string[];
  activeFiles: string[];
  retrievalIds: string[];
  memoryRefs: string[];
  openQuestions: string[];
  verificationPlan: string[];
  rollbackPlan: string[];
  policyScopes: string[];
  version: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStateRecord {
  id: string;
  repoId?: string | null;
  aggregateId: string;
  phase: string;
  status: string;
  summary: string;
  nextSteps: string[];
  blockers: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryRecord {
  id: string;
  kind: "scratchpad" | "episodic" | "fact" | "procedural" | "user" | "reflection";
  repoId?: string | null;
  aggregateId: string;
  content: string;
  citations: string[];
  confidence: number;
  staleAfter: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RetrievalTrace {
  id: string;
  repoId?: string | null;
  aggregateId: string;
  query: string;
  retrievalIds: string[];
  results: KnowledgeHit[];
  createdAt: string;
}

export interface ExecutionRunSummary {
  runId: string;
  ticketId: string | null;
  status: string;
  providerId: ProviderId | null;
  modelRole: ModelRole | null;
  routingDecisionId: string | null;
  repoId: string | null;
  executionMode: ExecutionMode | null;
  verificationDepth: "light" | "standard" | "deep" | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface AgentLane {
  id: string;
  repoId?: string | null;
  ticketId: string;
  runId: string | null;
  role: "planner" | "implementer" | "verifier" | "integrator" | "researcher";
  worktreePath: string;
  leaseExpiresAt: string;
  lastHeartbeatAt: string | null;
  state: "queued" | "running" | "blocked" | "stale" | "completed" | "failed";
  contextManifestId: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MergeReport {
  id: string;
  repoId?: string | null;
  runId: string;
  changedFiles: string[];
  overlapScore: number;
  semanticConflicts: string[];
  requiredChecks: string[];
  outcome: "fast_path" | "integrator_required" | "rejected";
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ChallengeCandidate {
  id: string;
  modelPluginId: string;
  parentModelPluginId: string | null;
  datasetId: string;
  evalRunId: string;
  status: "draft" | "pending_review" | "approved" | "rejected" | "promoted";
  metrics?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RepoRegistration {
  id: string;
  displayName: string;
  sourceKind: "local_path" | "git_url" | "managed_pack" | "github_app_bound";
  sourceUri: string;
  repoRoot: string;
  managedWorktreeRoot: string;
  defaultBranch: string;
  active: boolean;
  benchmarkEligible: boolean;
  developerOnly?: boolean;
  hiddenFromPrimaryList?: boolean;
  branch?: string | null;
  lastUsedAt?: string | null;
  toolchainProfile?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  attachedAt: string;
  updatedAt: string;
}

export type ProjectStarterId = "neutral_baseline" | "typescript_vite_react";

export interface ProjectStarterDefinition {
  id: ProjectStarterId;
  label: string;
  description: string;
  kind: "generic" | "stack";
  recommended: boolean;
  verificationMode: "none" | "commands";
}

export interface ProjectBinding {
  id: string;
  displayName: string;
  sourceKind: ProjectSourceKind;
  canonicalRoot: string | null;
  mirrorPath: string | null;
  activeWorktreePath: string;
  githubRepoId: string | null;
  githubInstallationId: string | null;
  defaultBranch: string;
  active: boolean;
  codeGraphStatus: "not_indexed" | "indexing" | "ready" | "stale" | "failed";
  guidelineProfileVersion: number;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface GitHubRepoBinding {
  projectId: string;
  owner: string;
  repo: string;
  installationId: string | null;
  defaultBranch: string;
  permissions: {
    pullRequests: boolean;
    contents: boolean;
    checks: boolean;
    issues: boolean;
  };
  connectedAt: string;
  metadata?: Record<string, unknown>;
}

export interface CodeGraphNode {
  id: string;
  repoId: string;
  kind: "file" | "symbol" | "test" | "doc" | "command";
  path: string;
  name: string;
  language: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CodeGraphEdge {
  id: string;
  repoId: string;
  fromNodeId: string;
  toNodeId: string;
  kind: "imports" | "calls" | "defines" | "covers_test" | "documents" | "depends_on" | "owns";
  weight: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ContextPack {
  id: string;
  repoId: string;
  objective: string;
  queryMode: "basic" | "impact" | "review" | "architecture" | "cross_project";
  files: string[];
  symbols: string[];
  tests: string[];
  docs: string[];
  rules: string[];
  priorRuns: string[];
  confidence: number;
  why: string[];
  tokenBudget: number;
  retrievalTraceId: string | null;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface ExecutionAttempt {
  id: string;
  runId: string;
  repoId: string;
  projectId: string | null;
  modelRole: ModelRole;
  providerId: ProviderId;
  status: "planned" | "running" | "applied" | "verified" | "failed" | "cancelled";
  objective: string;
  patchSummary: string;
  changedFiles: string[];
  approvalRequired: boolean;
  contextPackId: string | null;
  routingDecisionId: string | null;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface VerificationBundle {
  id: string;
  runId: string;
  repoId: string;
  executionAttemptId: string | null;
  changedFileChecks: string[];
  impactedTests: string[];
  fullSuiteRun: boolean;
  docsChecked: string[];
  pass: boolean;
  failures: string[];
  artifacts: string[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface ShareableRunReport {
  id: string;
  runId: string;
  repoId: string;
  summary: string;
  scorecardId: string | null;
  pullRequestUrl: string | null;
  evidenceUrls: string[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface RepoGuidelineProfile {
  id: string;
  repoId: string;
  languages: string[];
  testCommands: string[];
  buildCommands: string[];
  lintCommands: string[];
  docRules: string[];
  patchRules: string[];
  filePlacementRules: string[];
  reviewStyle: "findings_first" | "summary_first";
  requiredArtifacts: string[];
  sourceRefs: string[];
  confidence: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectBlueprint {
  id: string;
  projectId: string;
  version: number;
  sourceMode: "repo_extracted" | "repo_plus_override";
  confidence?: "high" | "medium" | "low";
  charter: {
    productIntent: string;
    successCriteria: string[];
    constraints: string[];
    riskPosture: "low" | "medium" | "high";
  };
  codingStandards: {
    principles: string[];
    filePlacementRules: string[];
    architectureRules: string[];
    dependencyRules: string[];
    reviewStyle: "findings_first" | "summary_first";
  };
  testingPolicy: {
    requiredForBehaviorChange: boolean;
    defaultCommands: string[];
    impactedTestStrategy: "required" | "preferred";
    fullSuitePolicy: "on_major_change" | "manual" | "always";
  };
  documentationPolicy: {
    updateUserFacingDocs: boolean;
    updateRunbooksWhenOpsChange: boolean;
    requiredDocPaths: string[];
    changelogPolicy: "none" | "recommended" | "required";
  };
  executionPolicy: {
    approvalRequiredFor: string[];
    protectedPaths: string[];
    maxChangedFilesBeforeReview: number;
    allowParallelExecution: boolean;
  };
  providerPolicy: {
    preferredCoderRole: "coder_default";
    reviewRole: "review_deep";
    escalationPolicy: "manual" | "high_risk_only" | "auto";
    executionProfileId?: string | null;
  };
  extractedFrom: string[];
  metadata?: Record<string, unknown>;
  updatedAt: string;
  createdAt: string;
}

export interface MissionUiRouteSummary {
  executionMode: ExecutionMode;
  providerId: ProviderId;
  modelRole: ModelRole;
  verificationDepth: "light" | "standard" | "deep";
  confidence: number;
}

export interface MissionUiApprovalCard {
  approvalId: string;
  actionType: string;
  requestedAt: string;
  relevantToCurrentTask: boolean;
  reason: string | null;
}

export type ChannelSource = "webhook" | "telegram" | "ci_monitoring";

export type ChannelTrustLevel = "trusted" | "restricted";

export type SubagentRole = "repo_scout" | "planner" | "implementer" | "verifier" | "doc_updater";

export interface ExperimentalChannelsConfig {
  enabled: boolean;
  senderAllowlist: string[];
  defaultProjectId?: string | null;
  defaultSessionId?: string | null;
  allowRemoteApprovals: boolean;
  allowUnattendedReadOnly: boolean;
  webhook: {
    enabled: boolean;
    signingSecret: string;
    hasSigningSecret?: boolean;
  };
  telegram: {
    enabled: boolean;
    signingSecret: string;
    hasSigningSecret?: boolean;
  };
  ciMonitoring: {
    enabled: boolean;
    signingSecret: string;
    hasSigningSecret?: boolean;
  };
}

export interface ChannelEventRecord {
  id: string;
  source: ChannelSource;
  senderId: string;
  content: string;
  trustLevel: ChannelTrustLevel;
  projectId?: string | null;
  ticketId?: string | null;
  runId?: string | null;
  sessionId?: string | null;
  replySupported: boolean;
  deliveredToSession: boolean;
  createdAt: string;
}

export interface SubagentActivityRecord {
  id: string;
  role: SubagentRole;
  status: "planned" | "queued" | "completed" | "blocked";
  summary: string;
  sourceEventId?: string | null;
  projectId?: string | null;
  ticketId?: string | null;
  runId?: string | null;
  createdAt: string;
}

export interface MissionActionCapabilities {
  canRefresh: boolean;
  canStop: boolean;
  canRequeue: boolean;
  canMarkActive: boolean;
  canComplete: boolean;
  canRetry: boolean;
}

export interface CodebaseTreeNode {
  path: string;
  kind: "file" | "directory";
  language?: string | null;
  status?: "added" | "modified" | "deleted" | "unchanged";
  children?: CodebaseTreeNode[];
}

export interface CodeFilePayload {
  path: string;
  language: string | null;
  content: string;
  truncated: boolean;
  source: "managed_worktree";
}

export interface CodeFileDiffPayload {
  path: string;
  status: "added" | "modified" | "deleted" | "unchanged";
  patch: string | null;
  additions: number;
  deletions: number;
  truncated: boolean;
  available: boolean;
}

export interface ConsoleEvent {
  id: string;
  projectId: string;
  category: "execution" | "verification" | "provider" | "approval" | "indexing" | "automation";
  level: "info" | "warn" | "error" | "success" | "debug";
  message: string;
  createdAt: string;
  taskId?: string;
}

export interface ProjectBootstrapRequest {
  folderPath: string;
  displayName?: string;
  starterId?: ProjectStarterId | null;
  initializeGit: boolean;
}

export interface ScaffoldPlan {
  projectId: string;
  blueprintVersion: number;
  targetFiles: string[];
  requiredTests: string[];
  requiredDocs: string[];
  verificationCommands: string[];
}

export interface ScaffoldExecutionResult {
  projectId: string;
  runId: string | null;
  appliedFiles: string[];
  verificationBundleId: string | null;
  reportId: string | null;
  status: "completed" | "failed" | "needs_review";
}

export interface WorkflowStatusPillar {
  key: "backlog" | "in_progress" | "needs_review" | "completed";
  label: string;
  count: number;
  blockedCount?: number;
  workflowIds: string[];
}

export interface WorkflowCardSummary {
  workflowId: string;
  title: string;
  subtitle: string;
  status: "backlog" | "in_progress" | "needs_review" | "completed";
  laneOrder?: number;
  rawStatus: string;
  priority: string;
  risk: string;
  taskCount: number;
  isBlocked: boolean;
  blockedReason?: string | null;
  impactedFiles: string[];
  impactedTests: string[];
  impactedDocs: string[];
  lastUpdatedAt: string;
  verificationState?: string | null;
  verificationFailure?: string | null;
  verificationCommand?: string | null;
  confidence?: number | null;
  progress?: number | null;
  ownerLabel?: string | null;
  executionProfileOverrideId?: string | null;
  executionProfileOverrideName?: string | null;
  laneCount: number;
}

export interface WorkflowMoveRequest {
  workflowId: string;
  fromStatus: "backlog" | "in_progress" | "needs_review" | "completed";
  toStatus: "backlog" | "in_progress" | "needs_review" | "completed";
  beforeWorkflowId?: string | null;
}

export interface TicketCommentThread {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  parentCommentId: string | null;
  replies: TicketCommentThread[];
}

export interface WorkflowTaskDetail {
  taskId: string;
  title: string;
  status: string;
  comments: TicketCommentThread[];
  activityNotes: Array<{ id: string; author: string; body: string; createdAt: string }>;
  metadata: Record<string, unknown>;
  logs: ConsoleEvent[];
  approvals: MissionUiApprovalCard[];
  verification: string[];
  impactedFiles: string[];
  impactedTests: string[];
  impactedDocs: string[];
  workflowSummary: string | null;
  blockers: string[];
  nextSteps: string[];
  verificationFailures: string[];
  verificationCommand: string | null;
  route: MissionUiRouteSummary | null;
  subtasks: WorkflowSubtask[];
  executionProfileOverrideId?: string | null;
  executionProfileSnapshot?: {
    profileId: string;
    profileName: string;
    stages: Array<{
      stage: ExecutionProfileStage;
      role: ModelRole;
      providerId: ProviderId;
      model: string;
      reasoningMode?: ReasoningMode;
    }>;
  } | null;
  ticketExecutionPolicy?: TicketExecutionPolicy | null;
}

export interface MissionControlSnapshot {
  project: RepoRegistration | null;
  recentProjects: RepoRegistration[];
  blueprint: ProjectBlueprint | null;
  route: RoutingDecision | null;
  routeSummary: MissionUiRouteSummary | null;
  actionCapabilities: MissionActionCapabilities;
  contextPack: ContextPack | null;
  runPhase: "starting" | "single_task_validation" | "parallel_running" | "draining" | "completed" | "error" | "stopped" | "idle";
  runSummary: ExecutionRunSummary | null;
  verification: VerificationBundle | null;
  selectedTicket: Ticket | null;
  tickets: Ticket[];
  workflowPillars: WorkflowStatusPillar[];
  workflowCards: WorkflowCardSummary[];
  changeBriefs: Array<{
    task_id: string;
    title: string;
    status: "success" | "active" | "failed";
    summary: string;
    patches_applied: number;
    token_total: number;
    worker_id: number | null;
    generated_at: string;
    files: string[];
  }>;
  streams: Array<{
    workstream: string;
    risk: "critical" | "warn" | "ok";
    queued: number;
    in_progress: number;
    blocked: number;
    failed: number;
    completed: number;
    top_task_id: string | null;
  }>;
  timeline: Array<{
    id: string;
    phase: "starting" | "single_task_validation" | "parallel_running" | "draining" | "completed" | "error" | "stopped" | "idle";
    severity: "INFO" | "WARNING" | "ERROR";
    kind?: string;
    timestamp: string;
    message: string;
    task_id?: string;
  }>;
  tasks: Array<{
    task_id: string;
    title: string;
    phase: string;
  }>;
  spotlight: {
    task_id: string;
    title: string;
    lifecycle: {
      current_phase: string;
      events: Array<{ timestamp: string; severity: string; message: string }>;
    };
    latest_transition_reason?: string;
    phase_durations?: Record<string, number>;
    latest_artifact?: {
      payload: Record<string, unknown>;
      markdown_summary: string;
      llm_output_count: number;
    };
    failure: { code?: string; error?: string };
  } | null;
  codebaseFiles: Array<{
    path: string;
    status: "modified" | "added" | "deleted" | "unchanged";
    lines: number;
    agent: string | null;
    taskId: string | null;
  }>;
  consoleLogs: Array<{
    id: string;
    level: "info" | "warn" | "error" | "debug" | "success";
    timestamp: string;
    message: string;
    source: string;
    taskId?: string;
  }>;
  experimentalAutonomy?: {
    channels: ChannelEventRecord[];
    subagents: SubagentActivityRecord[];
  };
  agenticRun: AgenticRunSnapshot | null;
  approvals: MissionUiApprovalCard[];
  guidelines: RepoGuidelineProfile | null;
  projectState: RepoStateCapsule | null;
  codeGraphStatus: {
    repoId: string;
    status: string;
    nodeCount: number;
    edgeCount: number;
    updatedAt: string;
  } | null;
  shareReport: ShareableRunReport | null;
  overseer: {
    sessions: ChatSessionDto[];
    selectedSessionId: string | null;
    messages: ChatMessageDto[];
  };
  memoryStats: {
    episodicCount: number;
    successCount: number;
    failureCount: number;
    partialCount: number;
    newestCreatedAt: string | null;
    dreamStatus?: {
      running: boolean;
      lastDreamAt: string | null;
      dreamCount: number;
    } | null;
  } | null;
  lastUpdatedAt: string | null;
}

export interface WorkflowSubtask {
  id: string;
  parentTicketId: string;
  title: string;
  description: string;
  status: "backlog" | "in_progress" | "review" | "blocked" | "done";
  priority: TicketPriority;
  risk: TicketRisk;
  dependencies: string[];
  notes: string[];
  blockedBy: string[];
  blocked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RepoStateCapsule {
  id: string;
  repoId: string;
  activeBranch: string;
  activeWorktreePath: string;
  selectedTicketId: string | null;
  selectedRunId: string | null;
  recentChatSessionIds: string[];
  lastContextManifestId: string | null;
  retrievalCacheKeys: string[];
  providerSessions: Array<Partial<ProviderSession>>;
  warmAt: string;
  suspendedAt: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RepoIndexSnapshot {
  id: string;
  repoId: string;
  commitSha: string;
  fileCount: number;
  indexedDocRefs: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface BenchmarkProjectManifest {
  projectId: string;
  displayName: string;
  source: {
    kind: "local_path" | "git_url" | "managed_pack";
    uri: string;
    ref?: string;
  };
  languages: string[];
  setupCommand: string;
  verifyCommand: string;
  resetCommand?: string;
  installCommand?: string;
  guidelineSources: string[];
  taskSpecs: BenchmarkTaskSpec[];
  timeBudgetSec: number;
  networkPolicy: "offline" | "setup_only" | "allowed";
  defaultProviderRole: "coder_default" | "utility_fast" | "review_deep";
}

export interface BenchmarkTaskSpec {
  taskId: string;
  title: string;
  category: "fix" | "feature" | "decompose" | "review";
  prompt: string;
  expectedArtifacts: string[];
  requiredChecks: string[];
  requiredDocs: string[];
  hardFailIfMissing: string[];
  benchmarkRubricOverrides?: Record<string, number>;
  acceptanceCommands?: string[];
}

export interface BenchmarkProject {
  id: string;
  repoId: string | null;
  projectKey: string;
  displayName: string;
  sourceKind: "local_path" | "git_url" | "managed_pack";
  sourceUri: string;
  manifestPath: string | null;
  languages: string[];
  setupCommand: string;
  verifyCommand: string;
  resetCommand: string | null;
  installCommand: string | null;
  guidelineSources: string[];
  timeBudgetSec: number;
  networkPolicy: "offline" | "setup_only" | "allowed";
  defaultProviderRole: "coder_default" | "utility_fast" | "review_deep";
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface BenchmarkTask {
  id: string;
  projectId: string;
  taskKey: string;
  title: string;
  category: "fix" | "feature" | "decompose" | "review";
  prompt: string;
  expectedArtifacts: string[];
  requiredChecks: string[];
  requiredDocs: string[];
  hardFailIfMissing: string[];
  scoringWeights?: Record<string, number>;
  acceptanceCommands: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface BenchmarkRun {
  id: string;
  projectId: string;
  repoId: string;
  taskId: string;
  mode: "operator_e2e" | "api_regression" | "repo_headless";
  providerRole: "utility_fast" | "coder_default" | "review_deep" | "overseer_escalation";
  status: "queued" | "running" | "failed" | "completed" | "cancelled";
  actor: string;
  worktreePath: string;
  chatSessionId: string | null;
  routingDecisionId: string | null;
  metadata?: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
}

export interface BenchmarkScorecard {
  runId: string;
  pass: boolean;
  totalScore: number;
  functionalCorrectness: number;
  guidelineAdherence: number;
  verificationDiscipline: number;
  patchQuality: number;
  retrievalDiscipline: number;
  policyCompliance: number;
  latencyRecovery: number;
  hardFailures: string[];
  evidenceRefs: string[];
  summary: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface OutcomeEvidence {
  id: string;
  runId: string;
  kind:
    | "test_result"
    | "lint_result"
    | "build_result"
    | "diff_meta"
    | "policy_event"
    | "retrieval_trace"
    | "playwright_artifact"
    | "execution_attempt"
    | "tool_invocation"
    | "verification_bundle"
    | "share_report";
  path: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ProviderBudgetState {
  providerId: ProviderId;
  dailyBudgetUsd: number;
  usedUsd: number;
  remainingUsd: number;
  requestCount: number;
  cooldownUntil: string | null;
  updatedAt: string;
}

export interface McpIntegrationServer {
  id: string;
  name: string;
  transport: "stdio" | "sse";
  command?: string;
  args: string[];
  url?: string;
  envKeys: string[];
  enabled: boolean;
  connected: boolean;
  toolCount: number;
  resourceCount: number;
  error?: string;
  lastConnected?: string;
  healthStatus?: "healthy" | "degraded" | "restarting" | "failed" | null;
}

export interface McpIntegrationResource {
  serverId: string;
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface LspIntegrationServer {
  language: string;
  command: string[];
  extensions: string[];
  capabilities: {
    diagnostics?: boolean;
    definition?: boolean;
    references?: boolean;
    documentSymbol?: boolean;
  };
  binaryAvailable: boolean;
  running: boolean;
  initialized: boolean;
  worktreePath: string | null;
  processId: number | null;
}

export interface ModelRoleBinding {
  role: ModelRole;
  providerId: ProviderId;
  pluginId: string | null;
  model: string;
  temperature: number;
  maxTokens: number;
  reasoningMode?: ReasoningMode;
}

export interface ExecutionProfile {
  id: string;
  name: string;
  description: string;
  preset: "balanced" | "deep_scope" | "build_heavy" | "custom";
  stages: Record<ExecutionProfileStage, ModelRole>;
  updatedAt: string;
}

export interface ExecutionProfileSettings {
  activeProfileId: string;
  profiles: ExecutionProfile[];
}

export type TicketPermissionMode = "balanced" | "strict" | "full_access";

export interface TicketExecutionPolicy {
  ticketId: string;
  mode: TicketPermissionMode;
  allowInstallCommands: boolean;
  allowNetworkCommands: boolean;
  requireApprovalFor: string[];
  updatedAt: string;
  updatedBy: string;
}

export interface ToolInvocationEvent {
  id: string;
  runId: string;
  ticketId: string;
  stage: "scope" | "build" | "review" | "escalate";
  toolType: "repo.read" | "repo.edit" | "repo.verify" | "repo.install" | "git.meta";
  command: string;
  args: string[];
  cwd: string;
  policyDecision: "allowed" | "approval_required" | "denied";
  exitCode: number | null;
  durationMs: number;
  summary: string;
  errorClass: "infra_missing_tool" | "infra_missing_dependency" | "timeout" | "command_failed" | "none";
  approvalId?: string | null;
  createdAt: string;
}

export interface V2TaskCard {
  ticket_id: string;
  title: string;
  description: string;
  status: TaskLifecycleStatus;
  priority: TicketPriority;
  risk: TicketRisk;
  assignee_agent_id: string | null;
  last_transition_at: string | null;
  reservation: {
    reserved_by: string;
    reserved_at: string;
    expires_at: string;
    stale: boolean;
  } | null;
}

export interface V2TaskBoard {
  columns: Record<TaskLifecycleStatus, V2TaskCard[]>;
  ordered_statuses: TaskLifecycleStatus[];
  stale_reservations: number;
  total_tasks: number;
}

export interface V2PolicyPendingItem {
  approval_id: string;
  action_type: string;
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  payload: Record<string, unknown>;
  requested_at: string;
  decided_at: string | null;
}

export interface V2CommandLogItem {
  id: string;
  command_type: string;
  aggregate_id: string | null;
  status: "queued" | "approved" | "rejected" | "executed" | "failed";
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  actor: string;
  created_at: string;
  updated_at: string;
}

export interface OnPremQwenModelPlugin {
  id: string;
  label: string;
  hfRepo: string;
  runtimeModel: string;
  paramsB: number;
  maxContext: number;
  minVramGb: number;
  recommendedBackend: OnPremInferenceBackendId;
  notes: string;
}

export type OnPremInferenceBackendId =
  | "mlx-lm"
  | "sglang"
  | "vllm-openai"
  | "trtllm-openai"
  | "llama-cpp-openai"
  | "transformers-openai"
  | "ollama-openai";

export interface PrefixCachingSupport {
  supported: boolean;
  automatic?: boolean;
  flag?: string;
  method?: string;
}

export interface OnPremInferenceBackendDescriptor {
  id: OnPremInferenceBackendId;
  label: string;
  baseUrlDefault: string;
  startupCommandTemplate: string;
  optimizedFor: "apple-silicon" | "nvidia-cuda" | "portable" | "cpu";
  notes: string;
  supportsJsonMode?: boolean;
  supportsPrefixCaching?: PrefixCachingSupport;
  supportsConstrainedDecoding?: boolean;
  constrainedDecodingMethod?: "json_schema" | "gbnf_grammar";
  supportsFim?: boolean;
  fimTokenFormat?: {
    prefix: string;
    suffix: string;
    middle: string;
  };
  speculativeDecoding?: SpeculativeDecodingConfig;
}

export interface HardwareProfile {
  platform: "apple-silicon" | "nvidia-cuda" | "generic-cpu";
  vramMb?: number;
  computeCapability?: string;
  unifiedMemoryMb?: number;
}

export interface BackendHealthStatus {
  status: "healthy" | "degraded" | "down";
  lastCheck: string;
  restartCount: number;
  consecutiveFailures: number;
}

export interface SpeculativeDecodingConfig {
  supported: boolean;
  draftModelId?: string;
  numSpeculativeTokens?: number;
  flag?: string;
}

export interface PromptCacheMetrics {
  hitRate: number;
  totalRequests: number;
  cacheHits: number;
  lastUpdated: string;
}

export type InferenceBenchmarkProfile = "interactive" | "batch" | "tool_heavy";

export interface BackendBenchmarkResult {
  backendId: OnPremInferenceBackendId;
  profile: InferenceBenchmarkProfile;
  ttftMsP95: number;
  outputTokPerSec: number;
  latencyMsP95: number;
  errorRate: number;
  memoryHeadroomPct: number;
  score: number;
  createdAt: string;
  selected: boolean;
  metadata?: Record<string, unknown>;
}

export interface InferenceAutotuneResult {
  profile: InferenceBenchmarkProfile;
  strategy: "hardware-aware";
  hardware: "apple-silicon" | "nvidia-cuda" | "generic-cpu";
  selectedBackendId: OnPremInferenceBackendId | null;
  benchmarkResults: BackendBenchmarkResult[];
}

export type DistillStage = "sft" | "orpo" | "tool_rl";
export type DistillRunStatus = "queued" | "running" | "failed" | "completed" | "promoted";
export type DistillReviewDecision = "pending" | "approved" | "rejected" | "needs_edit";
export type DistillRunReasonCode =
  | "rate_limited"
  | "budget_exhausted"
  | "trainer_unavailable"
  | "dataset_insufficient"
  | "not_implemented"
  | "unknown";

export interface BehaviorSpecV1 {
  specId: string;
  intent: string;
  inputs: string[];
  constraints: string[];
  requiredTools: string[];
  requiredChecks: string[];
  expectedArtifacts: string[];
  riskClass: "low" | "medium" | "high";
}

export interface DistillExample {
  id: string;
  spec: BehaviorSpecV1;
  teacherOutput: string;
  reviewerDecision: DistillReviewDecision;
  privacySafe: boolean;
  citations: string[];
  createdAt: string;
  reviewedAt: string | null;
}

export interface DistillDatasetDto {
  id: string;
  title: string;
  objectiveSplit: string;
  privacyPolicyVersion: string;
  status: "draft" | "reviewed" | "approved" | "archived";
  sampleCount: number;
  approvedCount: number;
  rejectedCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface DistillRun {
  id: string;
  stage: DistillStage;
  studentModelId: string;
  datasetId: string;
  status: DistillRunStatus;
  metrics: Record<string, number | string | boolean | null>;
  artifactPath: string;
  jobId?: string | null;
  backend?: string | null;
  reasonCode?: DistillRunReasonCode | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DistillEvalRun {
  id: string;
  runId: string;
  baselineModelId: string | null;
  pass: boolean;
  metrics: Record<string, number>;
  createdAt: string;
}

export interface ModelArtifact {
  id: string;
  modelId: string;
  artifactType: "hf_adapter" | "merged_checkpoint" | "gguf" | "eval_report";
  artifactPath: string;
  checksum: string;
  promoted: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DistillTeacherRateLimitConfig {
  maxRequestsPerMinute: number;
  maxConcurrentTeacherJobs: number;
  dailyTokenBudget: number;
  retryBackoffMs: number;
  maxRetries: number;
}

export interface DistillQuotaState {
  day: string;
  tokensUsed: number;
  requests: number;
  remainingTokens: number;
  dailyTokenBudget: number;
  cooldownUntil: string | null;
  etaSeconds: number | null;
}

export interface DistillTrainingStartResult {
  run: DistillRun;
  jobId: string;
  stage: DistillStage;
  backend: string;
  startedAt: string;
  expectedArtifacts: string[];
  reasonCode: DistillRunReasonCode | null;
}

export interface DistillRunLogEntry {
  id: string;
  runId: string;
  level: "info" | "warn" | "error";
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface DistillReadinessCheck {
  key: string;
  ok: boolean;
  severity: "error" | "warning";
  message: string;
  details?: Record<string, unknown>;
}

export interface DistillReadinessStatus {
  checkedAt: string;
  ready: boolean;
  blockers: number;
  warnings: number;
  checks: DistillReadinessCheck[];
}

// ---------------------------------------------------------------------------
// Skills System
// ---------------------------------------------------------------------------

export type SkillContextMode = "inline" | "fork";

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  version: string;
  contextMode: SkillContextMode;
  allowedTools: string[];
  maxIterations: number | null;
  systemPrompt: string;
  referenceFiles: Array<{ path: string; purpose: string }>;
  author: string;
  tags: string[];
  builtIn: boolean;
  techFingerprint?: string[];
  sourceProjectIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SkillInvocationRecord {
  id: string;
  skillId: string;
  skillName: string;
  runId: string;
  projectId: string;
  ticketId: string | null;
  args: string | null;
  status: "running" | "completed" | "failed";
  output: string | null;
  childRunId: string | null;
  startedAt: string;
  completedAt: string | null;
}

// ---------------------------------------------------------------------------
// Hook System
// ---------------------------------------------------------------------------

export type HookEventType =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "PermissionRequest"
  | "PreCompact"
  | "PostCompact"
  | "UserPromptSubmit"
  | "SessionStart"
  | "SessionEnd"
  | "Notification"
  | "Stop"
  | "OnError"
  | "PreExecution"
  | "PostExecution"
  | "PreApproval"
  | "command_before"
  | "command_after"
  | "prompt_transform"
  | "tool_before"
  | "tool_after"
  | "run_start"
  | "run_end";

export type HookType = "Command" | "Prompt" | "Agent";

export interface HookRecord {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  eventType: HookEventType;
  hookType: HookType;
  command: string | null;
  promptTemplate: string | null;
  agentObjective: string | null;
  allowedTools: string[];
  canOverride: boolean;
  continueOnError: boolean;
  timeoutMs: number;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HookExecutionLogRecord {
  id: string;
  hookId: string;
  hookName: string;
  runId: string;
  eventType: HookEventType;
  success: boolean;
  output: string | null;
  error: string | null;
  durationMs: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Auto Memory
// ---------------------------------------------------------------------------

export interface AutoMemoryConfig {
  enabled: boolean;
  extractAfterIterations: number;
  maxTokensPerExtraction: number;
  timeoutMs: number;
  dreamIntervalHours: number;
}

// ---------------------------------------------------------------------------
// Learnings & Self-Learning Loop
// ---------------------------------------------------------------------------

export type LearningCategory = "pattern" | "antipattern" | "preference";
export type LearningSource = "auto_extraction" | "doom_loop" | "user_feedback" | "benchmark" | "tool_failure";

export interface LearningEntry {
  id: string;
  projectId: string;
  category: LearningCategory;
  summary: string;
  detail: string;
  source: LearningSource;
  confidence: number;
  occurrences: number;
  relatedFiles: string[];
  relatedTools: string[];
  createdAt: string;
  lastSeenAt: string;
}

export interface ConsolidatedPrinciple {
  id: string;
  projectId: string;
  principle: string;
  reasoning: string;
  derivedFrom: string[];
  confidence: number;
  createdAt: string;
}

export interface SuggestedSkill {
  id: string;
  projectId: string;
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  tags: string[];
  techFingerprint?: string[];
  sourceProjectIds?: string[];
  derivedFromLearnings: string[];
  confidence: number;
  status: "pending" | "approved" | "dismissed";
  createdAt: string;
}

export interface DreamCycleStats {
  lastDreamAt: string | null;
  dreamCount: number;
  learningsCount: number;
  principlesCount: number;
  suggestedSkillsCount: number;
  globalLearningsPromoted?: number;
  globalPrinciplesConsolidated?: number;
}

// ---------------------------------------------------------------------------
// Cross-Project Knowledge Pool
// ---------------------------------------------------------------------------

export interface GlobalLearningRecord {
  id: string;
  category: LearningCategory;
  summary: string;
  detail: string;
  techFingerprint: string[];
  sourceProjectIds: string[];
  occurrences: number;
  confidence: number;
  universality: number;
  relatedTools: string[];
  relatedFilePatterns: string[];
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface GlobalPrincipleRecord {
  id: string;
  principle: string;
  reasoning: string;
  techFingerprint: string[];
  sourceProjectCount: number;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

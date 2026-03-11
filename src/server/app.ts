import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { initDatabase, prisma } from "./db";
import { eventBus, publishEvent } from "./eventBus";
import { ProviderFactory } from "./providers/factory";
import { QwenCliAdapter } from "./providers/qwenCliAdapter";
import { DEFAULT_QWEN_CLI_ARGS } from "./providers/qwenCliConfig";
import { OnPremQwenAdapter, OpenAiCompatibleAdapter } from "./providers/stubAdapters";
import { OpenAiResponsesAdapter } from "./providers/openaiResponsesAdapter";
import { listOnPremQwenModelPlugins } from "./providers/modelPlugins";
import { listOnPremInferenceBackends } from "./providers/inferenceBackends";
import { ProviderOrchestrator, applyEscalationPolicy } from "./services/providerOrchestrator";
import { TicketService } from "./services/ticketService";
import { ChatService } from "./services/chatService";
import { ApprovalService } from "./services/approvalService";
import { AuditService } from "./services/auditService";
import { V2EventService } from "./services/v2EventService";
import { V2QueryService } from "./services/v2QueryService";
import { V2CommandService } from "./services/v2CommandService";
import { InferenceTuningService } from "./services/inferenceTuningService";
import { DistillService } from "./services/distillService";
import { RouterService } from "./services/routerService";
import { ContextService } from "./services/contextService";
import { LaneService } from "./services/laneService";
import { MergeService } from "./services/mergeService";
import { ChallengeService } from "./services/challengeService";
import { QwenAccountSetupService } from "./services/qwenAccountSetupService";
import { RepoService } from "./services/repoService";
import { BenchmarkService } from "./services/benchmarkService";
import { CodeGraphService } from "./services/codeGraphService";
import { ExecutionService } from "./services/executionService";
import { GitHubService } from "./services/githubService";
import { ProjectBlueprintService } from "./services/projectBlueprintService";
import { MissionControlService } from "./services/missionControlService";
import { ProjectScaffoldService } from "./services/projectScaffoldService";
import { buildVerificationPlan } from "./services/verificationPolicy";
import { getSidecarClient } from "./sidecar/manager";
import type {
  ConsoleEvent,
  DistillReviewDecision,
  DistillStage,
  OnPremInferenceBackendId,
  TicketStatus,
} from "../shared/contracts";

const createTicketSchema = z.object({
  repoId: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["backlog", "ready", "in_progress", "review", "blocked", "done"]).optional(),
  priority: z.enum(["p0", "p1", "p2", "p3"]).optional(),
  risk: z.enum(["low", "medium", "high"]).optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
});

const updateTicketSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  priority: z.enum(["p0", "p1", "p2", "p3"]).optional(),
  risk: z.enum(["low", "medium", "high"]).optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
});

const moveTicketSchema = z.object({
  status: z.enum(["backlog", "ready", "in_progress", "review", "blocked", "done"]),
});

const createTicketCommentSchema = z.object({
  author: z.string().trim().min(1).max(80).optional(),
  body: z.string().trim().min(1),
  parentCommentId: z.string().trim().min(1).optional(),
});

const createChatSessionSchema = z.object({
  title: z.string().min(1).optional(),
  repoId: z.string().optional(),
});

const createMessageSchema = z.object({
  content: z.string().min(1),
  modelRole: z.enum(["utility_fast", "coder_default", "review_deep", "overseer_escalation"]).optional(),
});

const setActiveProviderSchema = z.object({
  providerId: z.enum(["qwen-cli", "openai-compatible", "onprem-qwen", "openai-responses"]),
});

const createAccountSchema = z.object({
  label: z.string().min(1),
  profilePath: z.string().min(1),
  keychainRef: z.string().optional(),
});

function isTrustedLocalDevRequest(request: {
  headers: Record<string, unknown>;
  hostname?: string;
}) {
  if (process.env.APP_PACKAGED === "true") {
    return false;
  }

  const rawOrigin =
    typeof request.headers.origin === "string"
      ? request.headers.origin
      : typeof request.headers.referer === "string"
        ? request.headers.referer
        : "";

  if (!rawOrigin) {
    return false;
  }

  try {
    const parsed = new URL(rawOrigin);
    const isLocalHost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    const isDevPort = parsed.port === "5173" || parsed.port === "4173";
    return isLocalHost && isDevPort;
  } catch {
    return false;
  }
}

const updateAccountSchema = z.object({
  label: z.string().optional(),
  profilePath: z.string().optional(),
  enabled: z.boolean().optional(),
  state: z.enum(["ready", "cooldown", "auth_required", "disabled"]).optional(),
});

const bootstrapQwenAccountSchema = z.object({
  label: z.string().min(1),
  importCurrentAuth: z.boolean().optional(),
});

const decideApprovalSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().optional(),
  decidedBy: z.string().optional(),
});

const taskIntakeCommandSchema = z.object({
  strategy: z.enum(["weighted-random-next", "deterministic-next"]),
  actor: z.string().min(1),
  seed: z.string().optional(),
  reservation_ttl_seconds: z.number().int().positive().optional(),
});

const taskReserveCommandSchema = z.object({
  ticket_id: z.string().min(1),
  actor: z.string().min(1),
  reservation_ttl_seconds: z.number().int().positive().optional(),
});

const taskTransitionCommandSchema = z.object({
  ticket_id: z.string().min(1),
  actor: z.string().min(1),
  status: z.enum(["inactive", "reserved", "active", "in_progress", "blocked", "completed"]),
  risk_level: z.enum(["low", "medium", "high"]).optional(),
});

const executionRequestCommandSchema = z.object({
  ticket_id: z.string().min(1),
  repo_id: z.string().optional(),
  actor: z.string().min(1),
  prompt: z.string().min(1),
  retrieval_context_ids: z.array(z.string()).min(1),
  workspace_path: z.string().optional(),
  risk_level: z.enum(["low", "medium", "high"]).optional(),
  routing_decision_id: z.string().optional(),
  model_role: z.enum(["utility_fast", "coder_default", "review_deep", "overseer_escalation"]).optional(),
  provider_id: z.enum(["qwen-cli", "openai-compatible", "onprem-qwen", "openai-responses"]).optional(),
});

const policyDecideCommandSchema = z.object({
  action_type: z.string().min(1),
  actor: z.string().min(1),
  risk_level: z.enum(["low", "medium", "high"]).default("medium"),
  workspace_path: z.string().default(""),
  payload: z.record(z.unknown()).default({}),
  dry_run: z.boolean().default(false),
  aggregate_id: z.string().optional(),
});

const providerActivateCommandSchema = z.object({
  provider_id: z.enum(["qwen-cli", "openai-compatible", "onprem-qwen", "openai-responses"]),
  actor: z.string().min(1),
});

const inferenceAutotuneCommandSchema = z.object({
  actor: z.string().min(1),
  profile: z.enum(["interactive", "batch", "tool_heavy"]).default("interactive"),
  dry_run: z.boolean().optional(),
});

const inferenceBackendSwitchSchema = z.object({
  actor: z.string().min(1),
  backend_id: z.enum([
    "mlx-lm",
    "sglang",
    "vllm-openai",
    "trtllm-openai",
    "llama-cpp-openai",
    "transformers-openai",
    "ollama-openai",
  ]),
});

const inferenceBackendStartStopSchema = z.object({
  actor: z.string().min(1),
  backend_id: z.enum([
    "mlx-lm",
    "sglang",
    "vllm-openai",
    "trtllm-openai",
    "llama-cpp-openai",
    "transformers-openai",
    "ollama-openai",
  ]),
});

const modelPluginActivateSchema = z.object({
  actor: z.string().min(1),
  plugin_id: z.string().min(1),
});

const distillDatasetGenerateSchema = z.object({
  actor: z.string().min(1),
  title: z.string().min(1),
  sample_count: z.number().int().min(1).max(500).default(40),
  retrieval_context_ids: z.array(z.string()).min(1),
  model: z.string().optional(),
});

const distillDatasetReviewSchema = z.object({
  actor: z.string().min(1),
  dataset_id: z.string().min(1),
  decisions: z.array(
    z.object({
      example_id: z.string().min(1),
      decision: z.enum(["pending", "approved", "rejected", "needs_edit"]),
      note: z.string().optional(),
    })
  ),
});

const distillTrainStartSchema = z.object({
  actor: z.string().min(1),
  dataset_id: z.string().min(1),
  stage: z.enum(["sft", "orpo", "tool_rl"]),
  student_model_id: z.string().min(1),
});

const distillEvalRunSchema = z.object({
  actor: z.string().min(1),
  run_id: z.string().min(1),
  baseline_model_id: z.string().optional(),
});

const distillModelPromoteSchema = z.object({
  actor: z.string().min(1),
  run_id: z.string().min(1),
});

const routerPlanSchema = z.object({
  actor: z.string().min(1),
  repo_id: z.string().optional(),
  ticket_id: z.string().optional(),
  run_id: z.string().optional(),
  prompt: z.string().min(1),
  risk_level: z.enum(["low", "medium", "high"]).optional(),
  workspace_path: z.string().optional(),
  retrieval_context_ids: z.array(z.string()).default([]),
  active_files: z.array(z.string()).default([]),
});

const contextMaterializeSchema = z.object({
  actor: z.string().min(1),
  repo_id: z.string().optional(),
  aggregate_id: z.string().min(1),
  aggregate_type: z.enum(["ticket", "run", "lane"]),
  goal: z.string().min(1),
  query: z.string().optional(),
  constraints: z.array(z.string()).optional(),
  active_files: z.array(z.string()).optional(),
  retrieval_ids: z.array(z.string()).optional(),
  memory_refs: z.array(z.string()).optional(),
  open_questions: z.array(z.string()).optional(),
  verification_plan: z.array(z.string()).optional(),
  rollback_plan: z.array(z.string()).optional(),
  policy_scopes: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const memoryCommitSchema = z.object({
  actor: z.string().min(1),
  repo_id: z.string().optional(),
  aggregate_id: z.string().min(1),
  kind: z.enum(["scratchpad", "episodic", "fact", "procedural", "user", "reflection"]),
  content: z.string().min(1),
  citations: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  stale_after: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const agentSpawnSchema = z.object({
  actor: z.string().min(1),
  repo_id: z.string().optional(),
  ticket_id: z.string().min(1),
  run_id: z.string().optional(),
  role: z.enum(["planner", "implementer", "verifier", "integrator", "researcher"]),
  context_manifest_id: z.string().optional(),
  lease_minutes: z.number().int().positive().optional(),
  summary: z.string().optional(),
});

const agentReclaimSchema = z.object({
  actor: z.string().min(1),
  lane_id: z.string().optional(),
  reason: z.string().optional(),
});

const mergePrepareSchema = z.object({
  actor: z.string().min(1),
  repo_id: z.string().optional(),
  run_id: z.string().min(1),
  changed_files: z.array(z.string()).min(1),
  semantic_conflicts: z.array(z.string()).optional(),
  required_checks: z.array(z.string()).optional(),
  overlap_score: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const challengeRegisterSchema = z.object({
  actor: z.string().min(1),
  model_plugin_id: z.string().min(1),
  parent_model_plugin_id: z.string().nullable().optional(),
  dataset_id: z.string().min(1),
  eval_run_id: z.string().min(1),
});

const challengeReviewSchema = z.object({
  actor: z.string().min(1),
  candidate_id: z.string().min(1),
  status: z.enum(["approved", "rejected", "promoted"]),
});

const attachLocalRepoSchema = z.object({
  actor: z.string().min(1),
  source_path: z.string().min(1),
  display_name: z.string().optional(),
});

const cloneRepoSchema = z.object({
  actor: z.string().min(1),
  url: z.string().min(1),
  display_name: z.string().optional(),
  branch: z.string().optional(),
});

const importManagedPackSchema = z.object({
  actor: z.string().min(1),
  project_key: z.string().min(1),
  display_name: z.string().optional(),
});

const repoActivateSchema = z.object({
  actor: z.string().min(1),
  repo_id: z.string().min(1),
  state: z
    .object({
      activeBranch: z.string().optional(),
      activeWorktreePath: z.string().optional(),
      selectedTicketId: z.string().nullable().optional(),
      selectedRunId: z.string().nullable().optional(),
      recentChatSessionIds: z.array(z.string()).optional(),
      lastContextManifestId: z.string().nullable().optional(),
      retrievalCacheKeys: z.array(z.string()).optional(),
      providerSessions: z.array(z.record(z.unknown())).optional(),
      metadata: z.record(z.unknown()).optional(),
    })
    .optional(),
});

const repoSuspendSchema = z.object({
  actor: z.string().min(1),
  repo_id: z.string().min(1),
  state: repoActivateSchema.shape.state.optional(),
});

const repoSwitchPrepareSchema = z.object({
  actor: z.string().min(1),
  to_repo_id: z.string().min(1),
  state: repoActivateSchema.shape.state.optional(),
});

const benchmarkRunStartSchema = z.object({
  actor: z.string().min(1),
  project_id: z.string().min(1),
  task_id: z.string().min(1),
  mode: z.enum(["operator_e2e", "api_regression", "repo_headless"]).optional(),
  provider_role: z.enum(["utility_fast", "coder_default", "review_deep", "overseer_escalation"]).optional(),
  repo_id: z.string().optional(),
});

const benchmarkTaskExecuteSchema = z.object({
  actor: z.string().min(1),
  run_id: z.string().min(1),
});

const githubConnectSchema = z.object({
  actor: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  clone_url: z.string().url().optional(),
  display_name: z.string().optional(),
  default_branch: z.string().optional(),
  installation_id: z.string().optional(),
  github_repo_id: z.string().optional(),
});

const executionPlanSchema = z.object({
  actor: z.string().min(1),
  run_id: z.string().min(1),
  repo_id: z.string().min(1),
  objective: z.string().min(1),
  worktree_path: z.string().min(1),
  project_id: z.string().optional(),
  ticket_id: z.string().optional(),
  query_mode: z.enum(["basic", "impact", "review", "architecture", "cross_project"]).optional(),
  model_role: z.enum(["utility_fast", "coder_default", "review_deep", "overseer_escalation"]).optional(),
  provider_id: z.enum(["qwen-cli", "openai-compatible", "onprem-qwen", "openai-responses"]).optional(),
  routing_decision_id: z.string().optional(),
  verification_plan: z.array(z.string()).optional(),
  docs_required: z.array(z.string()).optional(),
});

const executionStartSchema = z.object({
  actor: z.string().min(1),
  run_id: z.string().min(1),
  repo_id: z.string().min(1),
  worktree_path: z.string().min(1),
  objective: z.string().min(1),
  project_id: z.string().optional(),
  project_key: z.string().optional(),
  model_role: z.enum(["utility_fast", "coder_default", "review_deep", "overseer_escalation"]),
  provider_id: z.enum(["qwen-cli", "openai-compatible", "onprem-qwen", "openai-responses"]),
  routing_decision_id: z.string().optional(),
  context_pack_id: z.string().optional(),
});

const executionVerifySchema = z.object({
  actor: z.string().min(1),
  run_id: z.string().min(1),
  repo_id: z.string().min(1),
  worktree_path: z.string().min(1),
  execution_attempt_id: z.string().optional(),
  commands: z.array(z.string()).min(1),
  docs_required: z.array(z.string()).optional(),
  full_suite_run: z.boolean().optional(),
});

const missionSnapshotQuerySchema = z.object({
  projectId: z.string().optional(),
  ticketId: z.string().optional(),
  runId: z.string().optional(),
  sessionId: z.string().optional(),
});

const missionCodebaseFileQuerySchema = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1),
});

const missionTaskDetailQuerySchema = z.object({
  projectId: z.string().optional(),
  taskId: z.string().min(1),
});

const scaffoldBootstrapSchema = z.object({
  actor: z.string().min(1),
  folderPath: z.string().min(1),
  displayName: z.string().optional(),
  template: z.literal("typescript_vite_react").default("typescript_vite_react"),
  initializeGit: z.boolean().default(true),
});

const scaffoldExecuteSchema = z.object({
  actor: z.string().min(1),
  objective: z.string().min(1).optional(),
  template: z.literal("typescript_vite_react").default("typescript_vite_react"),
});

const blueprintUpdateSchema = z.object({
  charter: z
    .object({
      productIntent: z.string().optional(),
      successCriteria: z.array(z.string()).optional(),
      constraints: z.array(z.string()).optional(),
      riskPosture: z.enum(["low", "medium", "high"]).optional(),
    })
    .optional(),
  codingStandards: z
    .object({
      principles: z.array(z.string()).optional(),
      filePlacementRules: z.array(z.string()).optional(),
      architectureRules: z.array(z.string()).optional(),
      dependencyRules: z.array(z.string()).optional(),
      reviewStyle: z.enum(["findings_first", "summary_first"]).optional(),
    })
    .optional(),
  testingPolicy: z
    .object({
      requiredForBehaviorChange: z.boolean().optional(),
      defaultCommands: z.array(z.string()).optional(),
      impactedTestStrategy: z.enum(["required", "preferred"]).optional(),
      fullSuitePolicy: z.enum(["on_major_change", "manual", "always"]).optional(),
    })
    .optional(),
  documentationPolicy: z
    .object({
      updateUserFacingDocs: z.boolean().optional(),
      updateRunbooksWhenOpsChange: z.boolean().optional(),
      requiredDocPaths: z.array(z.string()).optional(),
      changelogPolicy: z.enum(["none", "recommended", "required"]).optional(),
    })
    .optional(),
  executionPolicy: z
    .object({
      approvalRequiredFor: z.array(z.string()).optional(),
      protectedPaths: z.array(z.string()).optional(),
      maxChangedFilesBeforeReview: z.number().int().positive().optional(),
      allowParallelExecution: z.boolean().optional(),
    })
    .optional(),
  providerPolicy: z
    .object({
      preferredCoderRole: z.literal("coder_default").optional(),
      reviewRole: z.literal("review_deep").optional(),
      escalationPolicy: z.enum(["manual", "high_risk_only", "auto"]).optional(),
    })
    .optional(),
});

const v8OverseerChatSchema = z.object({
  actor: z.string().min(1),
  project_id: z.string().optional(),
  session_id: z.string().optional(),
  content: z.string().min(1),
  model_role: z.enum(["utility_fast", "coder_default", "review_deep", "overseer_escalation"]).optional(),
});

const v8OverseerRouteReviewSchema = z.object({
  actor: z.string().min(1),
  project_id: z.string().min(1),
  ticket_id: z.string().optional(),
  prompt: z.string().min(1),
  risk_level: z.enum(["low", "medium", "high"]).optional(),
});

const v8OverseerExecuteSchema = z.object({
  actor: z.string().min(1),
  project_id: z.string().min(1),
  ticket_id: z.string().optional(),
  prompt: z.string().min(1),
  model_role: z.enum(["utility_fast", "coder_default", "review_deep", "overseer_escalation"]).optional(),
  provider_id: z.enum(["qwen-cli", "openai-compatible", "onprem-qwen", "openai-responses"]).optional(),
});

function asRecord(value: unknown) {
  return (value ?? {}) as Record<string, unknown>;
}

function mapRepoToProjectBinding(
  repo: {
    id: string;
    displayName: string;
    sourceKind: string;
    sourceUri: string;
    repoRoot: string;
    managedWorktreeRoot: string;
    defaultBranch: string;
    active: boolean;
    attachedAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
  },
  guidelineProfileVersion = 1
) {
  const metadata = asRecord(repo.metadata);
  return {
    id: repo.id,
    displayName: repo.displayName,
    sourceKind:
      repo.sourceKind === "managed_pack"
        ? "managed_demo_pack"
        : repo.sourceKind === "github_app_bound"
        ? "github_app_bound"
        : "local_attached",
    canonicalRoot: repo.repoRoot || null,
    mirrorPath: typeof metadata.mirror_path === "string" ? metadata.mirror_path : null,
    activeWorktreePath:
      typeof metadata.active_worktree_path === "string" ? metadata.active_worktree_path : path.join(repo.managedWorktreeRoot, "active"),
    githubRepoId: typeof metadata.github_repo_id === "string" ? metadata.github_repo_id : null,
    githubInstallationId: typeof metadata.github_installation_id === "string" ? metadata.github_installation_id : null,
    defaultBranch: repo.defaultBranch,
    active: repo.active,
    codeGraphStatus: typeof metadata.code_graph_status === "string" ? metadata.code_graph_status : "not_indexed",
    guidelineProfileVersion,
    createdAt: repo.attachedAt,
    updatedAt: repo.updatedAt,
    metadata,
  };
}

async function seedIfEmpty() {
  const ticketCount = await prisma.ticket.count();
  if (ticketCount === 0) {
    await prisma.ticket.createMany({
      data: [
        {
          title: "Design overseer chat command protocol",
          description: "Define structured action envelope for chat-to-ticket operations.",
          status: "ready",
          priority: "p1",
          risk: "medium",
          acceptanceCriteria: ["Envelope schema documented", "Backward-compatible parser in place"],
          dependencies: [],
        },
        {
          title: "Implement Kanban optimistic updates",
          description: "Drag ticket between lanes with optimistic UI and rollback.",
          status: "in_progress",
          priority: "p1",
          risk: "low",
          acceptanceCriteria: ["No flicker on move", "Rollback on API conflict"],
          dependencies: [],
        },
        {
          title: "Ship quota ETA monitor",
          description: "Track account cooldowns and reset confidence.",
          status: "backlog",
          priority: "p0",
          risk: "high",
          acceptanceCriteria: ["Per-account next usable ETA", "Confidence scoring"],
          dependencies: [],
        },
      ],
    });
  }

  const sessionCount = await prisma.chatSession.count();
  if (sessionCount === 0) {
    await prisma.chatSession.create({
      data: {
        title: "Overseer Session",
        providerId: "onprem-qwen",
      },
    });
  }
}

function mapLegacyToLifecycle(status: TicketStatus) {
  if (status === "backlog") return "inactive";
  if (status === "ready") return "active";
  if (status === "in_progress") return "in_progress";
  if (status === "blocked") return "blocked";
  if (status === "done") return "completed";
  return "active";
}

async function syncTaskProjectionFromTicket(ticket: {
  id: string;
  repoId?: string | null;
  title: string;
  description: string;
  status: TicketStatus;
  priority: "p0" | "p1" | "p2" | "p3";
  risk: "low" | "medium" | "high";
  acceptanceCriteria: string[];
  dependencies: string[];
}) {
  await prisma.taskProjection.upsert({
    where: { ticketId: ticket.id },
    update: {
      repoId: ticket.repoId || null,
      title: ticket.title,
      description: ticket.description,
      status: mapLegacyToLifecycle(ticket.status),
      priority: ticket.priority,
      risk: ticket.risk,
      acceptanceCriteria: ticket.acceptanceCriteria,
      dependencies: ticket.dependencies,
    },
    create: {
      ticketId: ticket.id,
      repoId: ticket.repoId || null,
      title: ticket.title,
      description: ticket.description,
      status: mapLegacyToLifecycle(ticket.status),
      priority: ticket.priority,
      risk: ticket.risk,
      acceptanceCriteria: ticket.acceptanceCriteria,
      dependencies: ticket.dependencies,
    },
  });
}

async function seedV2ReadModels() {
  const projectionCount = await prisma.taskProjection.count();
  if (projectionCount === 0) {
    const legacyTickets = await prisma.ticket.findMany({
      orderBy: { createdAt: "asc" },
    });

    for (const ticket of legacyTickets) {
      await prisma.taskProjection.upsert({
        where: { ticketId: ticket.id },
        update: {
          title: ticket.title,
          description: ticket.description,
          status: mapLegacyToLifecycle(ticket.status),
          priority: ticket.priority,
          risk: ticket.risk,
          acceptanceCriteria: ticket.acceptanceCriteria,
          dependencies: ticket.dependencies,
        },
        create: {
          ticketId: ticket.id,
          title: ticket.title,
          description: ticket.description,
          status: mapLegacyToLifecycle(ticket.status),
          priority: ticket.priority,
          risk: ticket.risk,
          acceptanceCriteria: ticket.acceptanceCriteria,
          dependencies: ticket.dependencies,
        },
      });
    }
  }

  const pendingApprovalRows = await prisma.approvalRequest.findMany({
    where: { status: "pending" },
    orderBy: { requestedAt: "desc" },
    take: 100,
  });

  for (const row of pendingApprovalRows) {
    await prisma.approvalProjection.upsert({
      where: { approvalId: row.id },
      update: {
        actionType: row.actionType,
        status: row.status,
        reason: row.reason,
        payload: row.payload,
        requestedAt: row.requestedAt,
        decidedAt: row.decidedAt,
      },
      create: {
        approvalId: row.id,
        actionType: row.actionType,
        status: row.status,
        reason: row.reason,
        payload: row.payload,
        requestedAt: row.requestedAt,
        decidedAt: row.decidedAt,
      },
    });
  }

  const knowledgeCount = await prisma.knowledgeIndexMetadata.count();
  if (knowledgeCount === 0) {
    const candidates = ["README.md", "guidelines/Guidelines.md", "src/shared/contracts.ts"];
    for (const candidate of candidates) {
      const full = path.resolve(process.cwd(), candidate);
      if (!fs.existsSync(full)) {
        continue;
      }
      const content = fs.readFileSync(full, "utf-8");
      await prisma.knowledgeIndexMetadata.create({
        data: {
          source: "bootstrap",
          path: candidate,
          snippet: content.slice(0, 4000),
          score: 0.8,
        },
      });
    }
  }
}

async function seedModelPluginRegistry() {
  const onPrem = await prisma.appSetting.findUnique({ where: { key: "onprem_qwen_config" } });
  const onPremValue = (onPrem?.value as Record<string, unknown>) || {};
  const activePluginId =
    typeof onPremValue.pluginId === "string" && onPremValue.pluginId.trim().length > 0
      ? onPremValue.pluginId
      : "qwen3.5-4b";

  const plugins = listOnPremQwenModelPlugins();
  for (const plugin of plugins) {
    await prisma.modelPluginRegistry.upsert({
      where: { pluginId: plugin.id },
      update: {
        providerId: "onprem-qwen",
        modelId: plugin.runtimeModel,
        paramsB: plugin.paramsB,
        active: plugin.id === activePluginId,
        capabilities: {
          maxContext: plugin.maxContext,
          recommendedBackend: plugin.recommendedBackend,
          notes: plugin.notes,
        },
      },
      create: {
        pluginId: plugin.id,
        providerId: "onprem-qwen",
        modelId: plugin.runtimeModel,
        paramsB: plugin.paramsB,
        active: plugin.id === activePluginId,
        capabilities: {
          maxContext: plugin.maxContext,
          recommendedBackend: plugin.recommendedBackend,
          notes: plugin.notes,
        },
      },
    });
  }
}

export async function createServer(apiToken = ""): Promise<FastifyInstance> {
  await initDatabase();
  await seedIfEmpty();

  const sidecar = await getSidecarClient();
  await seedV2ReadModels();
  await seedModelPluginRegistry();

  const providerFactory = new ProviderFactory();
  providerFactory.register(new QwenCliAdapter());
  providerFactory.register(new OpenAiCompatibleAdapter());
  providerFactory.register(new OnPremQwenAdapter());
  providerFactory.register(new OpenAiResponsesAdapter());

  const providerOrchestrator = new ProviderOrchestrator(providerFactory);
  const qwenAccountSetupService = new QwenAccountSetupService(providerOrchestrator);
  const ticketService = new TicketService();
  const chatService = new ChatService(providerOrchestrator);
  const approvalService = new ApprovalService();
  const auditService = new AuditService();
  const v2EventService = new V2EventService(sidecar);
  const v2QueryService = new V2QueryService(sidecar);
  const routerService = new RouterService(sidecar, v2EventService);
  const v2CommandService = new V2CommandService(sidecar, providerOrchestrator, v2EventService, routerService);
  const inferenceTuningService = new InferenceTuningService(v2EventService);
  const distillService = new DistillService(sidecar, v2EventService);
  const contextService = new ContextService(v2EventService);
  const laneService = new LaneService(sidecar, v2EventService);
  const mergeService = new MergeService(v2EventService);
  const challengeService = new ChallengeService(v2EventService);
  const codeGraphService = new CodeGraphService();

  // Phase 4.3: Fast model owns context shaping — filters and re-ranks context pack candidates
  codeGraphService.setContextShaper(async (input) => {
    const prompt = [
      "You are a context selector. Given an objective and candidate file lists, return a JSON object with the most relevant subset.",
      `Objective: ${input.objective}`,
      `Candidate files: ${JSON.stringify(input.candidateFiles)}`,
      `Candidate tests: ${JSON.stringify(input.candidateTests)}`,
      `Candidate docs: ${JSON.stringify(input.candidateDocs)}`,
      `Candidate symbols: ${JSON.stringify(input.candidateSymbols)}`,
      "Return ONLY a JSON object: { files: [...], tests: [...], docs: [...], symbols: [...] }",
      "Keep only items directly relevant to the objective. Remove noise.",
    ].join("\n");

    const result = await providerOrchestrator.streamChat(
      `context-shaper-${Date.now()}`,
      [{ role: "user", content: prompt }],
      () => {},
      { modelRole: "utility_fast" },
    );

    const match = result.text.match(/\{[\s\S]*\}/);
    if (!match) return input;
    const parsed = JSON.parse(match[0]);
    return {
      files: Array.isArray(parsed.files) ? parsed.files.filter((f: unknown) => typeof f === "string") : input.candidateFiles,
      tests: Array.isArray(parsed.tests) ? parsed.tests.filter((t: unknown) => typeof t === "string") : input.candidateTests,
      docs: Array.isArray(parsed.docs) ? parsed.docs.filter((d: unknown) => typeof d === "string") : input.candidateDocs,
      symbols: Array.isArray(parsed.symbols) ? parsed.symbols.filter((s: unknown) => typeof s === "string") : input.candidateSymbols,
    };
  });

  const projectBlueprintService = new ProjectBlueprintService();
  const repoService = new RepoService(v2EventService, codeGraphService, projectBlueprintService);
  const executionService = new ExecutionService(
    v2EventService,
    routerService,
    contextService,
    providerOrchestrator,
    repoService,
    codeGraphService
  );
  const githubService = new GitHubService(repoService);
  const projectScaffoldService = new ProjectScaffoldService(repoService, projectBlueprintService, executionService);
  const missionControlService = new MissionControlService(
    repoService,
    projectBlueprintService,
    chatService,
    ticketService,
    v2QueryService,
    routerService,
    contextService,
    codeGraphService,
    githubService
  );
  const benchmarkService = new BenchmarkService(v2EventService, repoService, executionService);
  await benchmarkService.syncProjectManifests().catch(() => []);

  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    credentials: false,
  });

  app.addHook("preHandler", async (request, reply) => {
    if (request.url.startsWith("/health")) {
      return;
    }

    if (!apiToken) {
      return;
    }

    if (isTrustedLocalDevRequest(request)) {
      return;
    }

    const headerToken = request.headers["x-local-api-token"];
    const queryToken =
      typeof (request.query as Record<string, unknown> | undefined)?.token === "string"
        ? String((request.query as Record<string, unknown>).token)
        : "";

    if (headerToken !== apiToken && queryToken !== apiToken) {
      return reply.code(401).send({ error: "Unauthorized local API request" });
    }
  });

  app.get("/health", async () => ({ ok: true }));

  app.get("/api/v2/stream", async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    const send = (eventName: string, payload: unknown) => {
      reply.raw.write(`event: ${eventName}\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    send("connected", { stream: "v2", now: new Date().toISOString() });

    const stopGlobal = eventBus.subscribe("global", (event) => {
      send(event.type, event);
    });

    const heartbeat = setInterval(() => {
      send("heartbeat", { now: new Date().toISOString() });
    }, 15000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      stopGlobal();
      reply.raw.end();
    });

    return reply;
  });

  app.post("/api/v2/commands/task.intake", async (request) => {
    const input = taskIntakeCommandSchema.parse(request.body);
    return v2CommandService.intakeTask(input);
  });

  app.post("/api/v2/commands/task.reserve", async (request) => {
    const input = taskReserveCommandSchema.parse(request.body);
    return v2CommandService.reserveTask(input);
  });

  app.post("/api/v2/commands/task.transition", async (request) => {
    const input = taskTransitionCommandSchema.parse(request.body);
    return v2CommandService.transitionTask(input);
  });

  app.post("/api/v2/commands/execution.request", async (request) => {
    const input = executionRequestCommandSchema.parse(request.body);
    return v2CommandService.requestExecution(input);
  });

  app.post("/api/v2/commands/policy.decide", async (request) => {
    const input = policyDecideCommandSchema.parse(request.body);
    return v2CommandService.evaluatePolicy({
      ...input,
      payload: input.payload,
      aggregate_id: input.aggregate_id,
    });
  });

  app.post("/api/v2/commands/provider.activate", async (request) => {
    const input = providerActivateCommandSchema.parse(request.body);
    return v2CommandService.activateProvider(input);
  });

  app.post("/api/v2/commands/inference.autotune", async (request) => {
    const input = inferenceAutotuneCommandSchema.parse(request.body);
    return inferenceTuningService.runAutotune({
      actor: input.actor,
      profile: input.profile,
      dryRun: input.dry_run,
    });
  });

  app.post("/api/v2/commands/inference.backend.start", async (request) => {
    const input = inferenceBackendStartStopSchema.parse(request.body);
    return inferenceTuningService.startBackend({
      actor: input.actor,
      backendId: input.backend_id as OnPremInferenceBackendId,
    });
  });

  app.post("/api/v2/commands/inference.backend.stop", async (request) => {
    const input = inferenceBackendStartStopSchema.parse(request.body);
    return inferenceTuningService.stopBackend({
      actor: input.actor,
      backendId: input.backend_id as OnPremInferenceBackendId,
    });
  });

  app.post("/api/v2/commands/inference.backend.switch", async (request) => {
    const input = inferenceBackendSwitchSchema.parse(request.body);
    return inferenceTuningService.switchBackend({
      actor: input.actor,
      backendId: input.backend_id as OnPremInferenceBackendId,
    });
  });

  app.post("/api/v2/commands/model.plugin.activate", async (request) => {
    const input = modelPluginActivateSchema.parse(request.body);
    const current = await prisma.appSetting.findUnique({ where: { key: "onprem_qwen_config" } });
    const previous = (current?.value as Record<string, unknown>) || {};
    const plugin = listOnPremQwenModelPlugins().find((item) => item.id === input.plugin_id);
    if (!plugin) {
      throw new Error(`Unknown plugin id '${input.plugin_id}'`);
    }

    await prisma.appSetting.upsert({
      where: { key: "onprem_qwen_config" },
      update: {
        value: {
          ...previous,
          pluginId: plugin.id,
          model: plugin.runtimeModel,
        },
      },
      create: {
        key: "onprem_qwen_config",
        value: {
          ...previous,
          pluginId: plugin.id,
          model: plugin.runtimeModel,
        },
      },
    });

    const currentRoleBindings = ((await prisma.appSetting.findUnique({ where: { key: "model_role_bindings" } }))?.value ||
      {}) as Record<string, Record<string, unknown>>;

    await prisma.appSetting.upsert({
      where: { key: "model_role_bindings" },
      update: {
        value: {
          ...currentRoleBindings,
          coder_default: {
            ...(currentRoleBindings.coder_default || {}),
            role: "coder_default",
            providerId: "onprem-qwen",
            pluginId: plugin.id,
            model: plugin.runtimeModel,
          },
          review_deep: {
            ...(currentRoleBindings.review_deep || {}),
            role: "review_deep",
            providerId: "onprem-qwen",
            pluginId: plugin.id,
            model: plugin.runtimeModel,
          },
        },
      },
      create: {
        key: "model_role_bindings",
        value: {
          ...currentRoleBindings,
          coder_default: {
            role: "coder_default",
            providerId: "onprem-qwen",
            pluginId: plugin.id,
            model: plugin.runtimeModel,
          },
          review_deep: {
            role: "review_deep",
            providerId: "onprem-qwen",
            pluginId: plugin.id,
            model: plugin.runtimeModel,
          },
        },
      },
    });

    await prisma.modelPluginRegistry.updateMany({
      where: { providerId: "onprem-qwen" },
      data: { active: false },
    });

    await prisma.modelPluginRegistry.upsert({
      where: { pluginId: plugin.id },
      update: {
        providerId: "onprem-qwen",
        modelId: plugin.runtimeModel,
        paramsB: plugin.paramsB,
        active: true,
        capabilities: {
          maxContext: plugin.maxContext,
          recommendedBackend: plugin.recommendedBackend,
        },
      },
      create: {
        pluginId: plugin.id,
        providerId: "onprem-qwen",
        modelId: plugin.runtimeModel,
        paramsB: plugin.paramsB,
        active: true,
        capabilities: {
          maxContext: plugin.maxContext,
          recommendedBackend: plugin.recommendedBackend,
        },
      },
    });

    await v2EventService.appendEvent({
      type: "model.plugin.activated",
      aggregateId: plugin.id,
      actor: input.actor,
      payload: {
        plugin_id: plugin.id,
        model_id: plugin.runtimeModel,
      },
    });

    publishEvent("global", "model.plugin.activated", {
      pluginId: plugin.id,
      modelId: plugin.runtimeModel,
    });

    return {
      ok: true,
      plugin: plugin,
    };
  });

  app.post("/api/v2/commands/distill.dataset.generate", async (request) => {
    const input = distillDatasetGenerateSchema.parse(request.body);
    return distillService.generateDataset(input);
  });

  app.post("/api/v2/commands/distill.dataset.review", async (request) => {
    const input = distillDatasetReviewSchema.parse(request.body);
    return distillService.reviewDataset({
      actor: input.actor,
      dataset_id: input.dataset_id,
      decisions: input.decisions.map((item) => ({
        example_id: item.example_id,
        decision: item.decision as DistillReviewDecision,
        note: item.note,
      })),
    });
  });

  app.post("/api/v2/commands/distill.train.start", async (request) => {
    const input = distillTrainStartSchema.parse(request.body);
    return distillService.startTraining({
      actor: input.actor,
      dataset_id: input.dataset_id,
      stage: input.stage as DistillStage,
      student_model_id: input.student_model_id,
    });
  });

  app.post("/api/v2/commands/distill.eval.run", async (request) => {
    const input = distillEvalRunSchema.parse(request.body);
    return distillService.runEval({
      actor: input.actor,
      run_id: input.run_id,
      baseline_model_id: input.baseline_model_id,
    });
  });

  app.post("/api/v2/commands/distill.model.promote", async (request) => {
    const input = distillModelPromoteSchema.parse(request.body);
    return distillService.promoteModel({
      actor: input.actor,
      run_id: input.run_id,
    });
  });

  app.get("/api/v2/tasks/board", async (request) => {
    const query = request.query as { repoId?: string };
    return v2QueryService.getTaskBoard(query.repoId);
  });

  app.get("/api/v2/tasks/:id/timeline", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      items: await v2QueryService.getTaskTimeline(id),
    };
  });

  app.get("/api/v2/runs/:id/replay", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      items: await v2QueryService.getRunReplay(id),
    };
  });

  app.get("/api/v2/policy/pending", async () => {
    return {
      items: await v2QueryService.getPendingPolicy(),
    };
  });

  app.get("/api/v2/knowledge/search", async (request) => {
    const query = request.query as { q?: string };
    const q = query.q?.trim() || "";
    return {
      items: await v2QueryService.searchKnowledge(q),
    };
  });

  app.get("/api/v2/commands/recent", async (request) => {
    const query = request.query as { limit?: string };
    const parsedLimit = Number(query.limit || "100");
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 500) : 100;
    return {
      items: await v2QueryService.getRecentCommands(limit),
    };
  });

  app.get("/api/v2/inference/backends", async () => {
    return {
      items: await inferenceTuningService.listBackends(),
    };
  });

  app.get("/api/v2/inference/benchmarks/latest", async (request) => {
    const query = request.query as { profile?: "interactive" | "batch" | "tool_heavy" };
    return {
      items: await inferenceTuningService.getLatestBenchmarks(query.profile),
    };
  });

  app.get("/api/v2/inference/benchmarks/history", async (request) => {
    const query = request.query as { profile?: "interactive" | "batch" | "tool_heavy"; limit?: string };
    const parsedLimit = Number(query.limit || "200");
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 200;
    return {
      items: await inferenceTuningService.getBenchmarkHistory(query.profile, limit),
    };
  });

  app.get("/api/v2/model/plugins", async () => {
    const plugins = listOnPremQwenModelPlugins();
    const registry = await prisma.modelPluginRegistry.findMany({
      where: { providerId: "onprem-qwen" },
      orderBy: { updatedAt: "desc" },
    });
    const activeSet = new Set(registry.filter((row) => row.active).map((row) => row.pluginId));
    const promotedSet = new Set(registry.filter((row) => row.promoted).map((row) => row.pluginId));

    return {
      items: plugins.map((plugin) => ({
        ...plugin,
        active: activeSet.has(plugin.id),
        promoted: promotedSet.has(plugin.id),
      })),
    };
  });

  app.get("/api/v2/distill/datasets/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    return distillService.getDataset(id);
  });

  app.get("/api/v2/distill/runs/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    return distillService.getRun(id);
  });

  app.get("/api/v2/distill/runs/:id/logs", async (request) => {
    const id = (request.params as { id: string }).id;
    return distillService.getRunLogs(id);
  });

  app.get("/api/v2/distill/evals/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    return distillService.getEval(id);
  });

  app.get("/api/v2/distill/quota", async () => {
    return distillService.getQuotaState();
  });

  app.get("/api/v2/distill/readiness", async () => {
    return distillService.getReadiness();
  });

  app.get("/api/v2/distill/models", async () => {
    return {
      items: await distillService.listModels(),
    };
  });

  app.post("/api/v3/commands/router.plan", async (request) => {
    const input = routerPlanSchema.parse(request.body);
    return {
      item: await routerService.planRoute(input),
    };
  });

  app.post("/api/v3/commands/context.materialize", async (request) => {
    const input = contextMaterializeSchema.parse(request.body);
    return contextService.materializeContext(input);
  });

  app.post("/api/v3/commands/context.refresh", async (request) => {
    const input = contextMaterializeSchema.parse(request.body);
    return contextService.materializeContext(input);
  });

  app.post("/api/v3/commands/memory.commit", async (request) => {
    const input = memoryCommitSchema.parse(request.body);
    return {
      item: await contextService.commitMemory(input),
    };
  });

  app.post("/api/v3/commands/agent.spawn", async (request) => {
    const input = agentSpawnSchema.parse(request.body);
    return {
      item: await laneService.spawnLane(input),
    };
  });

  app.post("/api/v3/commands/agent.reclaim", async (request) => {
    const input = agentReclaimSchema.parse(request.body);
    return {
      items: await laneService.reclaimLane(input),
    };
  });

  app.post("/api/v3/commands/run.merge.prepare", async (request) => {
    const input = mergePrepareSchema.parse(request.body);
    return {
      item: await mergeService.prepareMerge(input),
    };
  });

  app.post("/api/v3/commands/model.challenge.register", async (request) => {
    const input = challengeRegisterSchema.parse(request.body);
    return {
      item: await challengeService.registerCandidate(input),
    };
  });

  app.post("/api/v3/commands/model.challenge.review", async (request) => {
    const input = challengeReviewSchema.parse(request.body);
    return {
      item: await challengeService.reviewCandidate(input),
    };
  });

  app.get("/api/v3/router/decisions/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await routerService.getDecision(id),
    };
  });

  app.get("/api/v3/agents/lanes", async (request) => {
    const query = request.query as { ticketId?: string; runId?: string };
    return {
      items: await laneService.listLanes({
        ticketId: query.ticketId,
        runId: query.runId,
      }),
    };
  });

  app.get("/api/v3/tasks/:id/context", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await contextService.getLatestContext(id),
      routing: await routerService.listRecentForAggregate(id),
    };
  });

  app.get("/api/v3/tasks/:id/workflow-state", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await contextService.getWorkflowState(id),
    };
  });

  app.get("/api/v3/memory/search", async (request) => {
    const query = request.query as { q?: string };
    return {
      items: await contextService.searchMemory(query.q || ""),
    };
  });

  app.get("/api/v3/providers/openai/budget", async () => {
    const configRow = await prisma.appSetting.findUnique({ where: { key: "openai_responses_config" } });
    const config = (configRow?.value as Record<string, unknown> | null) || {};
    const row = await prisma.providerBudgetProjection.findFirst({
      where: { providerId: "openai-responses" },
    });

    const dailyBudgetUsd = typeof config.dailyBudgetUsd === "number" ? config.dailyBudgetUsd : 25;
    const usedUsd = row?.usedUsd ?? 0;
    return {
      item: {
        providerId: "openai-responses",
        dailyBudgetUsd,
        usedUsd,
        remainingUsd: Math.max(0, dailyBudgetUsd - usedUsd),
        requestCount: row?.requestCount ?? 0,
        cooldownUntil: row?.cooldownUntil?.toISOString() ?? null,
        updatedAt: row?.updatedAt?.toISOString() ?? new Date().toISOString(),
      },
    };
  });

  app.get("/api/v3/evals/champion-vs-challenger", async () => {
    return challengeService.getChampionVsChallenger();
  });

  app.get("/api/v3/runs/:id/merge-report", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await mergeService.getMergeReport(id),
    };
  });

  app.get("/api/v3/runs/:id/summary", async (request) => {
    const id = (request.params as { id: string }).id;
    const row = await prisma.runProjection.findUnique({ where: { runId: id } });
    if (!row) {
      return {
        item: null,
      };
    }

    const metadata = (row.metadata as Record<string, unknown> | null) || {};
    const routingDecisionId = typeof metadata.routing_decision_id === "string" ? metadata.routing_decision_id : null;
    const routingDecision = routingDecisionId
      ? await prisma.routingDecisionProjection.findUnique({ where: { id: routingDecisionId } })
      : null;

    return {
      item: {
        runId: row.runId,
        ticketId: row.ticketId,
        status: row.status,
        providerId:
          (row.providerId as "qwen-cli" | "openai-compatible" | "onprem-qwen" | "openai-responses" | null) ||
          (routingDecision?.providerId as "qwen-cli" | "openai-compatible" | "onprem-qwen" | "openai-responses" | null),
        modelRole:
          (typeof metadata.model_role === "string" ? metadata.model_role : null) || routingDecision?.modelRole || null,
        routingDecisionId,
        repoId: (typeof metadata.repo_id === "string" ? metadata.repo_id : null) || routingDecision?.repoId || null,
        executionMode:
          (typeof metadata.execution_mode === "string" ? metadata.execution_mode : null) || routingDecision?.executionMode || null,
        verificationDepth:
          (typeof metadata.verification_depth === "string" ? metadata.verification_depth : null) ||
          routingDecision?.verificationDepth ||
          null,
        startedAt: row.startedAt?.toISOString() ?? null,
        endedAt: row.endedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        metadata,
      },
    };
  });

  app.get("/api/v3/runs/:id/retrieval-trace", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      items: await contextService.getRetrievalTrace(id),
    };
  });

  app.post("/api/v4/commands/repo.attach-local", async (request) => {
    const input = attachLocalRepoSchema.parse(request.body);
    return repoService.attachLocalRepo(input);
  });

  app.post("/api/v4/commands/repo.clone", async (request) => {
    const input = cloneRepoSchema.parse(request.body);
    return repoService.cloneRepo(input);
  });

  app.post("/api/v4/commands/repo.register", async (request) => {
    const input = importManagedPackSchema.parse(request.body);
    return repoService.importManagedPack(input);
  });

  app.post("/api/v4/commands/repo.activate", async (request) => {
    const input = repoActivateSchema.parse(request.body);
    return repoService.activateRepo(input);
  });

  app.post("/api/v4/commands/repo.suspend", async (request) => {
    const input = repoSuspendSchema.parse(request.body);
    return repoService.suspendRepo(input.actor, input.repo_id, input.state);
  });

  app.post("/api/v4/commands/repo.refresh-guidelines", async (request) => {
    const input = z.object({ repo_id: z.string().min(1) }).parse(request.body);
    return {
      item: await repoService.refreshGuidelines(input.repo_id),
    };
  });

  app.post("/api/v4/commands/repo.refresh-index", async (request) => {
    const input = z.object({ repo_id: z.string().min(1) }).parse(request.body);
    return {
      item: await repoService.refreshIndex(input.repo_id),
    };
  });

  app.post("/api/v4/commands/repo.resume", async (request) => {
    const input = repoActivateSchema.parse(request.body);
    return repoService.activateRepo(input);
  });

  app.post("/api/v4/commands/repo.switch-prepare", async (request) => {
    const input = repoSwitchPrepareSchema.parse(request.body);
    return {
      item: await repoService.prepareSwitch(input),
    };
  });

  app.post("/api/v4/commands/repo.switch-commit", async (request) => {
    const input = z.object({ actor: z.string().min(1), checkpoint_id: z.string().min(1) }).parse(request.body);
    return repoService.commitSwitch(input.actor, input.checkpoint_id);
  });

  app.post("/api/v4/commands/benchmark.run.start", async (request) => {
    const input = benchmarkRunStartSchema.parse(request.body);
    return benchmarkService.startRun(input);
  });

  app.post("/api/v4/commands/benchmark.task.execute", async (request) => {
    const input = benchmarkTaskExecuteSchema.parse(request.body);
    return benchmarkService.executeTask(input.run_id, input.actor);
  });

  app.post("/api/v4/commands/benchmark.score.recompute", async (request) => {
    const input = benchmarkTaskExecuteSchema.parse(request.body);
    return benchmarkService.scoreRun(input.run_id, input.actor);
  });

  app.get("/api/v4/repos", async () => {
    return {
      items: await repoService.listRepos(),
    };
  });

  app.get("/api/v4/repos/active", async () => {
    return {
      item: await repoService.getActiveRepo(),
    };
  });

  app.get("/api/v4/repos/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await repoService.getRepo(id),
    };
  });

  app.get("/api/v4/repos/:id/state", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await repoService.getState(id),
    };
  });

  app.get("/api/v4/repos/:id/guidelines", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await repoService.getGuidelines(id),
    };
  });

  app.get("/api/v4/repos/:id/context", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await repoService.getLatestIndexSnapshot(id),
    };
  });

  app.get("/api/v4/repos/:id/benchmarks", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      items: await prisma.benchmarkProject.findMany({
        where: { repoId: id },
        orderBy: { displayName: "asc" },
      }),
    };
  });

  app.get("/api/v4/benchmarks/projects", async () => {
    return {
      items: await benchmarkService.listProjects(),
    };
  });

  app.get("/api/v4/benchmarks/projects/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    return await benchmarkService.getProject(id);
  });

  app.get("/api/v4/benchmarks/runs/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    return await benchmarkService.getRun(id);
  });

  app.get("/api/v4/benchmarks/runs/:id/scorecard", async (request) => {
    const id = (request.params as { id: string }).id;
    const result = await benchmarkService.getRun(id);
    return {
      item: result?.scorecard || null,
    };
  });

  app.get("/api/v4/benchmarks/runs/:id/artifacts", async (request) => {
    const id = (request.params as { id: string }).id;
    const result = await benchmarkService.getRun(id);
    return {
      items: result?.evidence || [],
    };
  });

  app.get("/api/v4/benchmarks/leaderboard", async () => {
    return {
      items: await benchmarkService.getLeaderboard(),
    };
  });

  app.get("/api/v4/benchmarks/failures", async () => {
    return {
      items: await benchmarkService.listFailures(),
    };
  });

  app.post("/api/v5/commands/project.connect.local", async (request) => {
    const input = attachLocalRepoSchema.parse(request.body);
    const result = await repoService.attachLocalRepo(input);
    const guidelines = await repoService.getGuidelines(result.repo.id);
    return {
      project: mapRepoToProjectBinding(result.repo, guidelines ? 1 : 0),
      ...result,
    };
  });

  app.post("/api/v5/commands/project.connect.github", async (request) => {
    const input = githubConnectSchema.parse(request.body);
    return githubService.connectRepo(input);
  });

  app.post("/api/v5/commands/project.sync", async (request) => {
    const input = z.object({ actor: z.string().min(1), repo_id: z.string().min(1) }).parse(request.body);
    return githubService.syncRepo(input.actor, input.repo_id);
  });

  app.post("/api/v5/commands/project.activate", async (request) => {
    const input = repoActivateSchema.parse(request.body);
    const result = await repoService.activateRepo(input);
    const guidelines = await repoService.getGuidelines(result.repo.id);
    return {
      project: mapRepoToProjectBinding(result.repo, guidelines ? 1 : 0),
      ...result,
    };
  });

  app.post("/api/v5/commands/project.pause", async (request) => {
    const input = repoSuspendSchema.parse(request.body);
    const result = await repoService.suspendRepo(input.actor, input.repo_id, input.state);
    const guidelines = await repoService.getGuidelines(result.repo.id);
    return {
      project: mapRepoToProjectBinding(result.repo, guidelines ? 1 : 0),
      ...result,
    };
  });

  app.post("/api/v5/commands/codegraph.index.start", async (request) => {
    const input = z.object({ actor: z.string().min(1), repo_id: z.string().min(1) }).parse(request.body);
    const repo = await repoService.getRepo(input.repo_id);
    if (!repo) {
      throw new Error(`Repo not found: ${input.repo_id}`);
    }
    return {
      item: await codeGraphService.indexRepo(input.repo_id, path.join(repo.managedWorktreeRoot, "active"), input.actor),
    };
  });

  app.post("/api/v5/commands/codegraph.index.refresh", async (request) => {
    const input = z.object({ actor: z.string().min(1), repo_id: z.string().min(1) }).parse(request.body);
    const repo = await repoService.getRepo(input.repo_id);
    if (!repo) {
      throw new Error(`Repo not found: ${input.repo_id}`);
    }
    return {
      item: await codeGraphService.indexRepo(input.repo_id, path.join(repo.managedWorktreeRoot, "active"), input.actor),
    };
  });

  app.post("/api/v5/commands/context.pack.build", async (request) => {
    const input = z
      .object({
        actor: z.string().min(1),
        repo_id: z.string().min(1),
        objective: z.string().min(1),
        query_mode: z.enum(["basic", "impact", "review", "architecture", "cross_project"]).optional(),
        token_budget: z.number().int().positive().optional(),
        aggregate_id: z.string().optional(),
      })
      .parse(request.body);
    return codeGraphService.buildContextPack({
      actor: input.actor,
      repoId: input.repo_id,
      objective: input.objective,
      queryMode: input.query_mode,
      tokenBudget: input.token_budget,
      aggregateId: input.aggregate_id,
    });
  });

  app.post("/api/v5/commands/execution.plan", async (request) => {
    const input = executionPlanSchema.parse(request.body);
    return executionService.planExecution({
      actor: input.actor,
      runId: input.run_id,
      repoId: input.repo_id,
      projectId: input.project_id,
      ticketId: input.ticket_id,
      objective: input.objective,
      worktreePath: input.worktree_path,
      queryMode: input.query_mode,
      modelRole: input.model_role,
      providerId: input.provider_id,
      routingDecisionId: input.routing_decision_id,
      verificationPlan: input.verification_plan,
      docsRequired: input.docs_required,
    });
  });

  app.post("/api/v5/commands/execution.start", async (request) => {
    const input = executionStartSchema.parse(request.body);
    return {
      item: await executionService.startExecution({
        actor: input.actor,
        runId: input.run_id,
        repoId: input.repo_id,
        projectId: input.project_id,
        projectKey: input.project_key,
        worktreePath: input.worktree_path,
        objective: input.objective,
        modelRole: input.model_role,
        providerId: input.provider_id,
        routingDecisionId: input.routing_decision_id,
        contextPackId: input.context_pack_id,
      }),
    };
  });

  app.post("/api/v5/commands/execution.verify", async (request) => {
    const input = executionVerifySchema.parse(request.body);
    return {
      item: await executionService.verifyExecution({
        actor: input.actor,
        runId: input.run_id,
        repoId: input.repo_id,
        worktreePath: input.worktree_path,
        executionAttemptId: input.execution_attempt_id,
        commands: input.commands,
        docsRequired: input.docs_required,
        fullSuiteRun: input.full_suite_run,
      }),
    };
  });

  app.post("/api/v5/commands/benchmark.run.execute", async (request) => {
    const input = benchmarkTaskExecuteSchema.parse(request.body);
    const executed = await benchmarkService.executeTask(input.run_id, input.actor);
    const scored = await benchmarkService.scoreRun(input.run_id, input.actor);
    return {
      ...executed,
      scorecard: scored.scorecard,
      evidence: scored.evidence,
    };
  });

  app.post("/api/v5/commands/github.pr.open", async (request) => {
    const input = z
      .object({
        actor: z.string().min(1),
        repo_id: z.string().min(1),
        run_id: z.string().min(1),
        title: z.string().min(1),
        summary: z.string().min(1),
        branch: z.string().min(1),
        base_branch: z.string().min(1),
        evidence_urls: z.array(z.string()).optional(),
      })
      .parse(request.body);
    return githubService.createLocalDraftPr({
      actor: input.actor,
      repoId: input.repo_id,
      runId: input.run_id,
      title: input.title,
      summary: input.summary,
      branch: input.branch,
      baseBranch: input.base_branch,
      evidenceUrls: input.evidence_urls,
    });
  });

  app.get("/api/v5/projects", async () => {
    const repos = await repoService.listRepos();
    const guidelineRows = await prisma.repoGuidelineProfile.findMany();
    const versionByRepoId = new Map(guidelineRows.map((row) => [row.repoId, 1]));
    return {
      items: repos.map((repo) => mapRepoToProjectBinding(repo, versionByRepoId.get(repo.id) || 0)),
    };
  });

  app.get("/api/v5/projects/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    const repo = await repoService.getRepo(id);
    const guidelines = await repoService.getGuidelines(id);
    return {
      item: repo ? mapRepoToProjectBinding(repo, guidelines ? 1 : 0) : null,
      repo,
      github: await prisma.gitHubRepoBinding.findUnique({ where: { repoId: id } }),
    };
  });

  app.get("/api/v5/projects/:id/state", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await repoService.getState(id),
    };
  });

  app.get("/api/v5/projects/:id/guidelines", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await repoService.getGuidelines(id),
    };
  });

  app.get("/api/v5/projects/:id/codegraph/status", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await codeGraphService.getStatus(id),
    };
  });

  app.get("/api/v5/projects/:id/context-pack", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await codeGraphService.getLatestContextPack(id),
    };
  });

  app.get("/api/v5/projects/:id/pull-requests", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      items: await githubService.listPullRequests(id),
    };
  });

  app.get("/api/v5/runs/:id/attempts", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      items: await codeGraphService.getExecutionAttempts(id),
    };
  });

  app.get("/api/v5/runs/:id/verification", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await codeGraphService.getVerificationBundle(id),
    };
  });

  app.get("/api/v5/runs/:id/share", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await githubService.getShareReport(id),
    };
  });

  app.get("/api/v5/benchmarks/leaderboard", async () => {
    return {
      items: await benchmarkService.getLeaderboard(),
    };
  });

  app.get("/api/v5/codegraph/query", async (request) => {
    const query = request.query as { repoId?: string; q?: string; mode?: "basic" | "impact" | "review" | "architecture" | "cross_project" };
    if (!query.repoId || !query.q) {
      return {
        item: null,
        items: [],
      };
    }
    return codeGraphService.query(query.repoId, query.q, query.mode || "basic");
  });

  async function ensureMissionTicket(repoId: string, prompt: string, ticketId?: string) {
    if (ticketId) {
      const tickets = await ticketService.listTickets(repoId);
      const existing = tickets.find((ticket) => ticket.id === ticketId);
      if (existing) {
        return existing;
      }
    }

    const title = prompt.split("\n")[0].trim().slice(0, 96) || "New objective";
    return ticketService.createTicket({
      repoId,
      title,
      description: prompt,
      status: "ready",
      priority: "p2",
      risk: "medium",
      acceptanceCriteria: [
        "Implement the requested change.",
        "Verify impacted behavior.",
        "Update docs if user-facing or operational behavior changes.",
      ],
    });
  }

  function buildVerificationPlanForRun(input: {
    blueprint: Awaited<ReturnType<ProjectBlueprintService["get"]>>;
    guidelines: Awaited<ReturnType<RepoService["getGuidelines"]>>;
  }) {
    return buildVerificationPlan({
      blueprint: input.blueprint,
      guidelines: input.guidelines,
      includeInstall: false,
    });
  }

  function mapConsoleCategory(type: string): ConsoleEvent["category"] {
    if (type.startsWith("execution.") || type.startsWith("task.")) return "execution";
    if (type.startsWith("verification.") || type.includes("verify")) return "verification";
    if (type.startsWith("approval.") || type.includes("approval")) return "approval";
    if (type.startsWith("repo.index") || type.startsWith("codegraph") || type.includes("context.pack")) return "indexing";
    return "provider";
  }

  function mapConsoleLevel(type: string): ConsoleEvent["level"] {
    if (type.includes("failed") || type.includes("error") || type.includes("rejected")) return "error";
    if (type.includes("pending") || type.includes("cooldown") || type.includes("warn")) return "warn";
    return "info";
  }

  function extractConsoleProjectId(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") return null;
    const record = payload as Record<string, unknown>;
    const candidate =
      (typeof record.repoId === "string" && record.repoId) ||
      (typeof record.repo_id === "string" && record.repo_id) ||
      (typeof record.projectId === "string" && record.projectId) ||
      (typeof record.project_id === "string" && record.project_id);
    return candidate || null;
  }

  function extractConsoleTaskId(payload: unknown, aggregateId: string | null | undefined, projectId: string | null): string | null {
    if (payload && typeof payload === "object") {
      const record = payload as Record<string, unknown>;
      const explicit =
        (typeof record.ticketId === "string" && record.ticketId) ||
        (typeof record.ticket_id === "string" && record.ticket_id) ||
        (typeof record.aggregate_id === "string" && record.aggregate_id);
      if (explicit && explicit !== projectId) {
        return explicit;
      }
    }

    if (aggregateId && aggregateId !== projectId && !aggregateId.startsWith("repo:") && !aggregateId.startsWith("run:")) {
      return aggregateId;
    }

    return null;
  }

  async function buildConsoleEvents(projectId?: string | null): Promise<ConsoleEvent[]> {
    if (!projectId) {
      return [];
    }

    const [eventRows, approvalRows, repoLogRows, verificationRows] = await Promise.all([
      prisma.eventLog.findMany({
        where: {
          OR: [
            { aggregateId: projectId },
            { payload: { path: ["repo_id"], equals: projectId } },
            { payload: { path: ["project_id"], equals: projectId } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 120,
      }),
      prisma.approvalProjection.findMany({
        where: {
          OR: [
            { payload: { path: ["repo_id"], equals: projectId } },
            { payload: { path: ["project_id"], equals: projectId } },
          ],
        },
        orderBy: { requestedAt: "desc" },
        take: 40,
      }),
      prisma.repoActivationLog.findMany({
        where: { repoId: projectId },
        orderBy: { createdAt: "desc" },
        take: 40,
      }),
      prisma.verificationBundle.findMany({
        where: { repoId: projectId },
        orderBy: { createdAt: "desc" },
        take: 40,
      }),
    ]);

    const eventItems: ConsoleEvent[] = eventRows.map((row) => ({
      id: row.eventId,
      projectId,
      category: mapConsoleCategory(row.eventType),
      level: mapConsoleLevel(row.eventType),
      message: `${row.eventType.replace(/\./g, " ")} ${JSON.stringify(row.payload).slice(0, 180)}`,
      createdAt: row.createdAt.toISOString(),
      taskId: extractConsoleTaskId(row.payload, row.aggregateId, projectId) || undefined,
    }));

    const approvalItems: ConsoleEvent[] = approvalRows.map((row) => ({
      id: row.approvalId,
      projectId,
      category: "approval",
      level: row.status === "rejected" ? "error" : row.status === "pending" ? "warn" : "info",
      message: `${row.actionType.replace(/_/g, " ")} ${row.status}${row.reason ? ` · ${row.reason}` : ""}`,
      createdAt: row.requestedAt.toISOString(),
      taskId:
        (typeof (row.payload as Record<string, unknown> | null)?.aggregate_id === "string" &&
        (row.payload as Record<string, unknown>).aggregate_id !== projectId
          ? (row.payload as Record<string, unknown>).aggregate_id
          : null) || undefined,
    }));

    const repoItems: ConsoleEvent[] = repoLogRows.map((row) => ({
      id: row.id,
      projectId,
      category: row.eventType.includes("index") ? "indexing" : "execution",
      level: "info",
      message: `${row.eventType.replace(/\./g, " ")} ${JSON.stringify(row.payload).slice(0, 180)}`,
      createdAt: row.createdAt.toISOString(),
    }));

    const verificationItems: ConsoleEvent[] = verificationRows.map((row) => ({
      id: row.id,
      projectId,
      category: "verification",
      level: row.pass ? "info" : "error",
      message: row.pass
        ? `verification passed · ${(row.impactedTests as string[] | unknown[]).length || 0} commands`
        : `verification failed · ${((row.failures as string[] | unknown[]).slice(0, 2) as string[]).join(" | ")}`,
      createdAt: row.createdAt.toISOString(),
    }));

    return [...eventItems, ...approvalItems, ...repoItems, ...verificationItems]
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
      .slice(-200);
  }

  async function attachOrBootstrapLocal(input: z.infer<typeof attachLocalRepoSchema>) {
    const inspection = await repoService.inspectLocalPath(input.source_path);
    if (!inspection.isGitRepo) {
      if (inspection.isEmpty || !inspection.hasFiles) {
        return {
          bootstrapRequired: true as const,
          folderPath: inspection.absolutePath,
          suggestedTemplate: "typescript_vite_react" as const,
        };
      }
      throw new Error("Selected folder is not a Git repo. Choose an existing repo or an empty folder to initialize.");
    }

    const result = await repoService.attachLocalRepo(input);
    const guidelines = await repoService.getGuidelines(result.repo.id);
    return {
      bootstrapRequired: false as const,
      project: mapRepoToProjectBinding(result.repo, guidelines ? 1 : 0),
      ...result,
    };
  }

  app.get("/api/v8/mission/snapshot", async (request) => {
    const query = missionSnapshotQuerySchema.parse(request.query);
    const [snapshot, consoleEvents] = await Promise.all([
      missionControlService.getSnapshot({
        projectId: query.projectId || null,
        ticketId: query.ticketId || null,
        runId: query.runId || null,
        sessionId: query.sessionId || null,
      }),
      buildConsoleEvents(query.projectId || null),
    ]);
    return {
      item: {
        ...snapshot,
        consoleEvents,
      },
    };
  });

  app.get("/api/v8/mission/timeline", async (request) => {
    const query = missionSnapshotQuerySchema.parse(request.query);
    const snapshot = await missionControlService.getSnapshot({
      projectId: query.projectId || null,
      ticketId: query.ticketId || null,
      runId: query.runId || null,
      sessionId: query.sessionId || null,
    });
    return { items: snapshot.timeline };
  });

  app.get("/api/v8/mission/backlog", async (request) => {
    const query = missionSnapshotQuerySchema.parse(request.query);
    const snapshot = await missionControlService.getSnapshot({
      projectId: query.projectId || null,
      ticketId: query.ticketId || null,
      runId: query.runId || null,
      sessionId: query.sessionId || null,
    });
    return {
      pillars: snapshot.workflowPillars,
      items: snapshot.workflowCards,
    };
  });

  app.get("/api/v8/mission/task-detail", async (request) => {
    const query = missionTaskDetailQuerySchema.parse(request.query);
    return {
      item: await missionControlService.getTaskDetail({
        projectId: query.projectId || null,
        taskId: query.taskId,
      }),
    };
  });

  app.post("/api/v8/mission/workflow.move", async (request) => {
    const body = z
      .object({
        workflowId: z.string().min(1),
        fromStatus: z.enum(["backlog", "in_progress", "needs_review", "completed"]),
        toStatus: z.enum(["backlog", "in_progress", "needs_review", "completed"]),
        beforeWorkflowId: z.string().min(1).nullable().optional(),
      })
      .parse(request.body);

    const allowedTransitions: Record<string, string[]> = {
      backlog: ["in_progress"],
      in_progress: ["backlog", "needs_review"],
      needs_review: ["in_progress", "completed"],
      completed: ["needs_review"],
    };

    const isReorderOnly = body.fromStatus === body.toStatus;

    if (!isReorderOnly && !allowedTransitions[body.fromStatus]?.includes(body.toStatus)) {
      throw new Error(`Invalid workflow transition: ${body.fromStatus} -> ${body.toStatus}`);
    }

    const ticket = await ticketService.moveWorkflow(body.workflowId, body.toStatus, body.beforeWorkflowId ?? null);

    await prisma.auditEvent.create({
      data: {
        actor: "user",
        eventType: "workflow.moved",
        payload: {
          workflowId: body.workflowId,
          fromStatus: body.fromStatus,
          toStatus: body.toStatus,
          beforeWorkflowId: body.beforeWorkflowId ?? null,
        },
      },
    });

    return {
      item: {
        moved: true,
        ticket,
      },
    };
  });

  app.get("/api/v8/mission/codebase", async (request) => {
    const query = missionSnapshotQuerySchema.parse(request.query);
    const snapshot = await missionControlService.getSnapshot({
      projectId: query.projectId || null,
      ticketId: query.ticketId || null,
      runId: query.runId || null,
      sessionId: query.sessionId || null,
    });
    return { items: snapshot.codebaseFiles };
  });

  app.get("/api/v8/mission/codebase/tree", async (request) => {
    const query = missionSnapshotQuerySchema.parse(request.query);
    if (!query.projectId) {
      return { items: [] };
    }
    return {
      items: await repoService.listCodebaseTree(query.projectId),
    };
  });

  app.get("/api/v8/mission/codebase/file", async (request) => {
    const query = missionCodebaseFileQuerySchema.parse(request.query);
    return {
      item: await repoService.readCodebaseFile(query.projectId, query.path),
    };
  });

  app.get("/api/v8/mission/console", async (request) => {
    const query = missionSnapshotQuerySchema.parse(request.query);
    return { items: await buildConsoleEvents(query.projectId || null) };
  });

  app.get("/api/v8/mission/console/stream", async (request, reply) => {
    const query = missionSnapshotQuerySchema.parse(request.query);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    const send = (eventName: string, payload: unknown) => {
      reply.raw.write(`event: ${eventName}\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    send("connected", { stream: "mission-console", now: new Date().toISOString() });

    const stopGlobal = eventBus.subscribe("global", (event) => {
      const projectId = extractConsoleProjectId(event.payload);
      if (query.projectId && projectId && projectId !== query.projectId) {
        return;
      }
      if (query.projectId && !projectId) {
        return;
      }
      send("console.event", {
        id: randomUUID(),
        projectId: projectId || query.projectId || null,
        category: mapConsoleCategory(event.type),
        level: mapConsoleLevel(event.type),
        message: `${event.type.replace(/\./g, " ")} ${JSON.stringify(event.payload).slice(0, 180)}`,
        createdAt: event.createdAt,
        taskId: extractConsoleTaskId(event.payload, null, query.projectId || null) || undefined,
      });
    });

    const heartbeat = setInterval(() => {
      send("heartbeat", { now: new Date().toISOString() });
    }, 15000);

    reply.raw.on("close", () => {
      clearInterval(heartbeat);
      stopGlobal();
      reply.raw.end();
    });

    return reply;
  });

  app.get("/api/v8/mission/overseer", async (request) => {
    const query = missionSnapshotQuerySchema.parse(request.query);
    const snapshot = await missionControlService.getSnapshot({
      projectId: query.projectId || null,
      ticketId: query.ticketId || null,
      runId: query.runId || null,
      sessionId: query.sessionId || null,
    });
    return { item: snapshot.overseer };
  });

  app.get("/api/v8/projects/:id/blueprint", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await projectBlueprintService.get(id),
    };
  });

  app.get("/api/v8/projects/:id/blueprint/sources", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      items: await projectBlueprintService.getSources(id),
    };
  });

  app.post("/api/v8/projects/connect/local", async (request) => {
    const input = attachLocalRepoSchema.parse(request.body);
    return attachOrBootstrapLocal(input);
  });

  app.post("/api/v8/projects/connect/github", async (request) => {
    const input = githubConnectSchema.parse(request.body);
    return githubService.connectRepo(input);
  });

  app.post("/api/v8/projects/open-recent", async (request) => {
    const input = attachLocalRepoSchema.parse(request.body);
    return attachOrBootstrapLocal(input);
  });

  app.post("/api/v8/projects/bootstrap/empty", async (request) => {
    const input = scaffoldBootstrapSchema.parse(request.body);
    const result = await projectScaffoldService.bootstrapEmptyProject(input);
    const guidelines = await repoService.getGuidelines(result.repo.id);
    return {
      project: mapRepoToProjectBinding(result.repo, guidelines ? 1 : 0),
      ...result,
    };
  });

  app.post("/api/v8/projects/:id/blueprint/generate", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await projectBlueprintService.generate(id),
    };
  });

  app.post("/api/v8/projects/:id/blueprint/update", async (request) => {
    const id = (request.params as { id: string }).id;
    const patch = blueprintUpdateSchema.parse(request.body);
    return {
      item: await projectBlueprintService.update(id, patch),
    };
  });

  app.post("/api/v8/projects/:id/scaffold/plan", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await projectScaffoldService.plan(id),
    };
  });

  app.post("/api/v8/projects/:id/scaffold/execute", async (request) => {
    const id = (request.params as { id: string }).id;
    const input = scaffoldExecuteSchema.parse(request.body);
    const result = await projectScaffoldService.execute({
      actor: input.actor,
      projectId: id,
      template: input.template,
      objective: input.objective,
    });
    return result;
  });

  app.get("/api/v8/projects/:id/scaffold/status", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await projectScaffoldService.getStatus(id),
    };
  });

  app.get("/api/v8/projects/:id/report/latest", async (request) => {
    const id = (request.params as { id: string }).id;
    const row = await prisma.shareableRunReport.findFirst({
      where: { repoId: id },
      orderBy: { createdAt: "desc" },
    });
    const metadata = (row?.metadata as Record<string, unknown> | undefined) ?? {};
    const changedFiles =
      Array.isArray(metadata?.changed_files)
        ? (metadata.changed_files as string[])
        : Array.isArray(metadata?.changedFiles)
        ? (metadata.changedFiles as string[])
        : [];
    const explicitDocsUpdated =
      Array.isArray(metadata?.docs_updated)
        ? (metadata.docs_updated as string[])
        : Array.isArray(metadata?.docsUpdated)
        ? (metadata.docsUpdated as string[])
        : [];
    const inferredDocsUpdated = changedFiles.filter(
      (file) => file === "AGENTS.md" || file === "README.md" || file.startsWith("docs/") || file.endsWith(".md")
    );
    const docsUpdated = explicitDocsUpdated.length > 0 ? explicitDocsUpdated : inferredDocsUpdated;
    return {
      item: row
        ? {
            id: row.id,
            runId: row.runId,
            projectId: row.repoId,
            summary: row.summary,
            changedFiles,
            testsPassed: Array.isArray(metadata?.tests_passed)
              ? (metadata.tests_passed as string[])
              : Array.isArray(metadata?.testsPassed)
              ? (metadata.testsPassed as string[])
              : [],
            docsUpdated,
            remainingRisks: Array.isArray(metadata?.remaining_risks)
              ? (metadata.remaining_risks as string[])
              : Array.isArray(metadata?.remainingRisks)
              ? (metadata.remainingRisks as string[])
              : [],
            pullRequestUrl: row.pullRequestUrl,
            createdAt: row.createdAt.toISOString(),
          }
        : null,
    };
  });

  app.post("/api/v8/mission/overseer/chat", async (request) => {
    const input = v8OverseerChatSchema.parse(request.body);
    const createdSession = input.session_id ? null : await chatService.createSession("Overseer Session", input.project_id || null);
    const sessionId = input.session_id || createdSession?.id;
    if (!sessionId) {
      throw new Error("Unable to resolve chat session");
    }
    const item = await chatService.createUserMessage(sessionId, input.content, {
      modelRole: input.model_role,
    });

    return {
      sessionId,
      item,
    };
  });

  app.post("/api/v8/mission/overseer/route.review", async (request) => {
    const input = v8OverseerRouteReviewSchema.parse(request.body);
    const repo = await repoService.getRepo(input.project_id);
    if (!repo) {
      throw new Error(`Project not found: ${input.project_id}`);
    }

    const worktreePath = path.join(repo.managedWorktreeRoot, "active");

    // Non-mutating parallel helpers: ticket, blueprint, and knowledge search are independent
    const [ticket, blueprint, knowledgeHits] = await Promise.all([
      ensureMissionTicket(repo.id, input.prompt, input.ticket_id),
      projectBlueprintService.get(repo.id),
      v2QueryService.searchKnowledge(input.prompt),
    ]);
    const retrievalIds = knowledgeHits.slice(0, 8).map((item) => item.id);

    // Route planning and context pack building can run in parallel when
    // the route doesn't depend on context pack results
    const [route, contextPack] = await Promise.all([
      routerService.planRoute({
        actor: input.actor,
        repo_id: repo.id,
        ticket_id: ticket.id,
        prompt: input.prompt,
        risk_level: input.risk_level || ticket.risk || "medium",
        workspace_path: worktreePath,
        retrieval_context_ids: retrievalIds,
        active_files: [],
      }),
      codeGraphService.buildContextPack({
        actor: input.actor,
        repoId: repo.id,
        objective: input.prompt,
        queryMode: "impact",
        aggregateId: ticket.id,
      }),
    ]);

    const context = await contextService.materializeContext({
      actor: input.actor,
      repo_id: repo.id,
      aggregate_id: ticket.id,
      aggregate_type: "ticket",
      goal: input.prompt,
      query: input.prompt,
      constraints: blueprint?.charter.constraints || [],
      active_files: contextPack.pack.files,
      retrieval_ids: Array.from(new Set([...retrievalIds, ...contextPack.retrievalTrace.retrievalIds])),
      verification_plan: blueprint?.charter.successCriteria || [],
      rollback_plan: ["Restore the managed worktree before promotion."],
      policy_scopes: blueprint?.executionPolicy.approvalRequiredFor || ["file_apply", "run_command"],
      metadata: {
        blueprint_id: blueprint?.id || null,
        blueprint_version: blueprint?.version || null,
      },
    });

    return {
      ticket,
      blueprint,
      route,
      contextPack: contextPack.pack,
      contextManifest: context.context,
      retrievalTrace: contextPack.retrievalTrace,
    };
  });

  app.post("/api/v8/mission/overseer/execute", async (request) => {
    const input = v8OverseerExecuteSchema.parse(request.body);
    const repo = await repoService.getRepo(input.project_id);
    if (!repo) {
      throw new Error(`Project not found: ${input.project_id}`);
    }

    const worktreePath = path.join(repo.managedWorktreeRoot, "active");

    // Non-mutating parallel helpers: ticket, blueprint, and guidelines are independent
    const [ticket, blueprint, guidelines] = await Promise.all([
      ensureMissionTicket(repo.id, input.prompt, input.ticket_id),
      projectBlueprintService.get(repo.id),
      repoService.getGuidelines(repo.id),
    ]);
    const existingRoute = (await routerService.listRecentForAggregate(ticket.id))[0] || null;
    const route =
      existingRoute ||
      (
        await routerService.planRoute({
          actor: input.actor,
          repo_id: repo.id,
          ticket_id: ticket.id,
          prompt: input.prompt,
          risk_level: ticket.risk,
          workspace_path: worktreePath,
          retrieval_context_ids: [],
          active_files: [],
        })
      );

    const runId = randomUUID();
    const resolvedRole = applyEscalationPolicy(
      (input.model_role || blueprint?.providerPolicy.preferredCoderRole || route.modelRole) as import("../shared/contracts").ModelRole,
      blueprint?.providerPolicy.escalationPolicy,
      route.risk as "low" | "medium" | "high" | undefined,
    );
    const planned = await executionService.planExecution({
      actor: input.actor,
      runId,
      repoId: repo.id,
      projectId: repo.id,
      ticketId: ticket.id,
      objective: input.prompt,
      worktreePath,
      queryMode: route.risk === "high" ? "architecture" : "impact",
      modelRole: resolvedRole,
      providerId: input.provider_id || route.providerId,
      routingDecisionId: route.id,
      verificationPlan: blueprint?.charter.successCriteria || [],
      docsRequired: [],
      metadata: {
        blueprint_id: blueprint?.id || null,
        blueprint_version: blueprint?.version || null,
      },
    });

    const attempt = await executionService.startExecution({
      actor: input.actor,
      runId,
      repoId: repo.id,
      projectId: repo.id,
      worktreePath,
      objective: input.prompt,
      modelRole: resolvedRole,
      providerId: input.provider_id || route.providerId,
      routingDecisionId: route.id,
      contextPackId: planned.contextPack.id,
    });

    const verificationPlan = buildVerificationPlanForRun({ blueprint, guidelines });
    const verification = verificationPlan.commands.length
      ? await executionService.verifyExecution({
          actor: input.actor,
          runId,
          repoId: repo.id,
          worktreePath,
          executionAttemptId: attempt.id,
          commands: verificationPlan.commands,
          docsRequired: verificationPlan.docsRequired,
          fullSuiteRun: verificationPlan.fullSuiteRun,
          metadata: {
            verification_commands: verificationPlan.commands,
            verification_reasons: verificationPlan.reasons,
            enforced_rules: verificationPlan.enforcedRules,
            blueprint_version: blueprint?.version || null,
          },
        })
      : null;

    return {
      runId,
      ticket,
      blueprint,
      route,
      attempt,
      verification,
      shareReport: await githubService.getShareReport(runId),
    };
  });

  app.post("/api/v8/mission/approval/decide", async (request) => {
    const body = z
      .object({
        approval_id: z.string().min(1),
        decision: z.enum(["approved", "rejected"]),
        reason: z.string().optional(),
        decided_by: z.string().optional(),
      })
      .parse(request.body);
    return {
      item: await approvalService.decideApproval(body.approval_id, {
        decision: body.decision,
        reason: body.reason,
        decidedBy: body.decided_by || "user",
      }),
    };
  });

  app.post("/api/v8/mission/actions/stop", async (request) => {
    const body = z
      .object({
        run_id: z.string().min(1),
        repo_id: z.string().min(1),
        actor: z.string().optional(),
        reason: z.string().optional(),
      })
      .parse(request.body);
    return {
      item: await v2CommandService.stopExecution({
        run_id: body.run_id,
        repo_id: body.repo_id,
        actor: body.actor || "user",
        reason: body.reason,
      }),
    };
  });

  app.post("/api/v8/mission/actions/task.requeue", async (request) => {
    const body = z
      .object({
        ticket_id: z.string().min(1),
        actor: z.string().optional(),
        reason: z.string().optional(),
      })
      .parse(request.body);
    return {
      item: await v2CommandService.requeueTask({
        ticket_id: body.ticket_id,
        actor: body.actor || "user",
        reason: body.reason,
      }),
    };
  });

  app.post("/api/v8/mission/actions/task.transition", async (request) => {
    const body = z
      .object({
        ticket_id: z.string().min(1),
        actor: z.string().optional(),
        status: z.enum(["inactive", "reserved", "active", "in_progress", "blocked", "completed"]),
        risk_level: z.enum(["low", "medium", "high"]).optional(),
      })
      .parse(request.body);
    return {
      item: await v2CommandService.transitionTask({
        ticket_id: body.ticket_id,
        actor: body.actor || "user",
        status: body.status,
        risk_level: body.risk_level,
      }),
    };
  });

  app.get("/api/v1/providers", async () => providerOrchestrator.listProviders());

  app.post("/api/v1/providers/active", async (request, reply) => {
    const input = setActiveProviderSchema.parse(request.body);
    const safety = await prisma.appSetting.findUnique({ where: { key: "safety_policy" } });
    const policy = (safety?.value as Record<string, unknown>) || {};

    if (policy.requireApprovalForProviderChanges === true) {
      const approval = await prisma.approvalRequest.create({
        data: {
          actionType: "provider_change",
          payload: {
            providerId: input.providerId,
          },
        },
      });

      publishEvent("global", "approval.requested", {
        approvalId: approval.id,
        actionType: approval.actionType,
      });

      return reply.send({ ok: true, requiresApproval: true, approvalId: approval.id });
    }

    await providerOrchestrator.setActiveProvider(input.providerId);
    await v2EventService.appendEvent({
      type: "provider.activated",
      aggregateId: input.providerId,
      actor: "user",
      payload: {
        provider_id: input.providerId,
      },
    });

    publishEvent("global", "provider.switched", {
      providerId: input.providerId,
    });

    return reply.send({ ok: true });
  });

  app.get("/api/v1/providers/qwen/accounts", async () => {
    const accounts = await providerOrchestrator.listQwenAccounts();
    return {
      items: accounts.map((account) => ({
        id: account.id,
        label: account.label,
        profilePath: account.profilePath,
        enabled: account.enabled,
        state: account.enabled ? account.state : "disabled",
        cooldownUntil: account.cooldownUntil?.toISOString() ?? null,
        quotaNextUsableAt: account.quotaNextUsableAt?.toISOString() ?? null,
        quotaEtaConfidence: account.quotaEtaConfidence,
        lastQuotaErrorAt: account.lastQuotaErrorAt?.toISOString() ?? null,
        lastUsedAt: account.lastUsedAt?.toISOString() ?? null,
      })),
    };
  });

  app.post("/api/v1/providers/qwen/accounts", async (request) => {
    const input = createAccountSchema.parse(request.body);
    const account = await providerOrchestrator.createQwenAccount(input);
    return { ok: true, item: account };
  });

  app.post("/api/v1/providers/qwen/accounts/bootstrap", async (request) => {
    const input = bootstrapQwenAccountSchema.parse(request.body);
    const account = await qwenAccountSetupService.bootstrapAccount(input);
    return { ok: true, item: account };
  });

  app.patch("/api/v1/providers/qwen/accounts/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    const patch = updateAccountSchema.parse(request.body);
    const account = await providerOrchestrator.updateQwenAccount(id, patch);
    return { ok: true, item: account };
  });

  app.post("/api/v1/providers/qwen/accounts/:id/reauth", async (request) => {
    const id = (request.params as { id: string }).id;
    const account = await providerOrchestrator.markQwenAccountReauthed(id);
    return { ok: true, item: account };
  });

  app.post("/api/v1/providers/qwen/accounts/:id/auth/start", async (request) => {
    const id = (request.params as { id: string }).id;
    const item = await qwenAccountSetupService.startAuth(id);
    return { ok: true, item };
  });

  app.get("/api/v1/providers/qwen/accounts/auth-sessions", async () => {
    return {
      items: await qwenAccountSetupService.listAuthSessions(),
    };
  });

  app.get("/api/v1/providers/qwen/quota", async () => {
    return {
      items: await providerOrchestrator.getQwenQuotaOverview(),
    };
  });

  app.get("/api/v1/providers/onprem/plugins", async () => {
    return {
      items: listOnPremQwenModelPlugins(),
    };
  });

  app.get("/api/v1/providers/onprem/backends", async () => {
    return {
      items: listOnPremInferenceBackends(),
    };
  });

  app.get("/api/v1/chat/sessions", async (request) => {
    const query = request.query as { repoId?: string };
    return {
      items: await chatService.listSessions(query?.repoId),
    };
  });

  app.post("/api/v1/chat/sessions", async (request) => {
    const input = createChatSessionSchema.parse(request.body);
    const activeRepoSetting = await prisma.appSetting.findUnique({ where: { key: "active_repo" } });
    const session = await chatService.createSession(
      input.title || "Untitled Session",
      input.repoId || (typeof activeRepoSetting?.value === "string" ? activeRepoSetting.value : null)
    );
    return { ok: true, item: session };
  });

  app.get("/api/v1/chat/sessions/:id/messages", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      items: await chatService.listMessages(id),
    };
  });

  app.post("/api/v1/chat/sessions/:id/messages", async (request) => {
    const id = (request.params as { id: string }).id;
    const input = createMessageSchema.parse(request.body);
    const message = await chatService.createUserMessage(id, input.content, {
      modelRole: input.modelRole,
    });
    return {
      ok: true,
      item: message,
    };
  });

  app.get("/api/v1/chat/sessions/:id/stream", async (request, reply) => {
    const id = (request.params as { id: string }).id;

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    const send = (eventName: string, payload: unknown) => {
      reply.raw.write(`event: ${eventName}\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    send("connected", { sessionId: id });

    const stopSession = eventBus.subscribe(`session:${id}`, (event) => {
      send(event.type, event);
    });

    const stopGlobal = eventBus.subscribe("global", (event) => {
      send(event.type, event);
    });

    const heartbeat = setInterval(() => {
      send("heartbeat", { now: new Date().toISOString() });
    }, 15000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      stopSession();
      stopGlobal();
      reply.raw.end();
    });

    return reply;
  });

  app.get("/api/v1/tickets", async (request) => {
    const query = request.query as { repoId?: string };
    return {
      items: await ticketService.listTickets(query.repoId),
    };
  });

  app.post("/api/v1/tickets", async (request) => {
    const input = createTicketSchema.parse(request.body);
    const activeRepoSetting = await prisma.appSetting.findUnique({ where: { key: "active_repo" } });
    const ticket = await ticketService.createTicket({
      ...input,
      repoId: input.repoId || (typeof activeRepoSetting?.value === "string" ? activeRepoSetting.value : null),
    });
    await syncTaskProjectionFromTicket(ticket);
    await v2EventService.appendEvent({
      type: "task.created",
      aggregateId: ticket.id,
      actor: "user",
      payload: {
        ticket_id: ticket.id,
        title: ticket.title,
        description: ticket.description,
        priority: ticket.priority,
        risk: ticket.risk,
        acceptance_criteria: ticket.acceptanceCriteria,
        dependencies: ticket.dependencies,
      },
    });

    publishEvent("global", "ticket.created", { ticketId: ticket.id, status: ticket.status });

    return {
      ok: true,
      item: ticket,
    };
  });

  app.patch("/api/v1/tickets/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    const patch = updateTicketSchema.parse(request.body);
    const ticket = await ticketService.updateTicket(id, patch);
    await syncTaskProjectionFromTicket(ticket);

    publishEvent("global", "ticket.updated", { ticketId: id });

    return {
      ok: true,
      item: ticket,
    };
  });

  app.post("/api/v1/tickets/:id/move", async (request) => {
    const id = (request.params as { id: string }).id;
    const input = moveTicketSchema.parse(request.body);

    const ticket = await ticketService.moveTicket(id, input.status as TicketStatus);
    await syncTaskProjectionFromTicket(ticket);
    await v2EventService.appendEvent({
      type: "task.transition",
      aggregateId: id,
      actor: "user",
      payload: {
        ticket_id: id,
        status: mapLegacyToLifecycle(ticket.status),
      },
    });

    publishEvent("global", "ticket.moved", {
      ticketId: id,
      status: input.status,
    });

    return {
      ok: true,
      item: ticket,
    };
  });

  app.get("/api/v1/tickets/:id/comments", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      items: await ticketService.listTicketComments(id),
    };
  });

  app.post("/api/v1/tickets/:id/comments", async (request) => {
    const id = (request.params as { id: string }).id;
    const input = createTicketCommentSchema.parse(request.body);
    const comment = await ticketService.addTicketComment({
      ticketId: id,
      author: input.author,
      body: input.body,
      parentCommentId: input.parentCommentId,
    });

    publishEvent("global", "ticket.comment_added", {
      ticketId: id,
      commentId: comment.id,
    });

    return {
      ok: true,
      item: comment,
    };
  });

  app.get("/api/v1/board", async (request) => {
    const query = request.query as { repoId?: string };
    return {
      items: await ticketService.getBoard(query.repoId),
    };
  });

  app.get("/api/v1/approvals", async () => ({
    items: await approvalService.listApprovals(),
  }));

  app.post("/api/v1/approvals/:id/decide", async (request) => {
    const id = (request.params as { id: string }).id;
    const input = decideApprovalSchema.parse(request.body);
    const approval = await approvalService.decideApproval(id, input);

    if (input.decision === "approved" && approval.actionType === "provider_change") {
      const payload = approval.payload as Record<string, unknown>;
      if (typeof payload.providerId === "string") {
        await providerOrchestrator.setActiveProvider(payload.providerId as "qwen-cli" | "openai-compatible" | "onprem-qwen" | "openai-responses");
        await v2EventService.appendEvent({
          type: "provider.activated",
          aggregateId: payload.providerId,
          actor: input.decidedBy ?? "user",
          payload: {
            provider_id: payload.providerId,
            approval_id: approval.id,
          },
          correlationId: approval.id,
        });
      }
    }

    if (input.decision === "approved" && approval.actionType === "execution_request") {
      const payload = approval.payload as Record<string, unknown>;
      const runId = typeof payload.run_id === "string" ? payload.run_id : approval.id;
      await v2EventService.appendEvent({
        type: "execution.requested",
        aggregateId: runId,
        actor: input.decidedBy ?? "user",
        payload: {
          ...payload,
          status: "queued",
          approved_via: approval.id,
        },
        correlationId: approval.id,
      });
    }

    await prisma.approvalProjection.upsert({
      where: { approvalId: approval.id },
      update: {
        actionType: approval.actionType,
        status: approval.status,
        reason: approval.reason,
        payload: approval.payload,
        requestedAt: approval.requestedAt,
        decidedAt: approval.decidedAt,
      },
      create: {
        approvalId: approval.id,
        actionType: approval.actionType,
        status: approval.status,
        reason: approval.reason,
        payload: approval.payload,
        requestedAt: approval.requestedAt,
        decidedAt: approval.decidedAt,
      },
    });

    await v2EventService.appendEvent({
      type: "policy.decision",
      aggregateId: approval.id,
      actor: input.decidedBy ?? "user",
      payload: {
        approval_id: approval.id,
        action_type: approval.actionType,
        status: input.decision,
        reason: input.reason ?? null,
      },
      correlationId: approval.id,
    });

    publishEvent("global", "approval.decided", {
      approvalId: id,
      decision: input.decision,
    });

    return { ok: true, item: approval };
  });

  app.get("/api/v1/audit/events", async () => {
    const events = await auditService.listEvents();
    return {
      items: events.map((event) => ({
        id: event.id,
        actor: event.actor,
        eventType: event.eventType,
        payload: event.payload,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  });

  app.get("/api/v1/runs/events", async () => {
    const events = await prisma.runEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return {
      items: events.map((event) => ({
        id: event.id,
        runId: event.runId,
        kind: event.kind,
        payload: event.payload,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  });

  app.get("/api/v1/settings", async () => {
    const safety = await prisma.appSetting.findUnique({ where: { key: "safety_policy" } });
    const qwen = await prisma.appSetting.findUnique({ where: { key: "qwen_cli_config" } });
    const onPrem = await prisma.appSetting.findUnique({ where: { key: "onprem_qwen_config" } });
    const openAiCompat = await prisma.appSetting.findUnique({ where: { key: "openai_compatible_config" } });
    const openAiResponses = await prisma.appSetting.findUnique({ where: { key: "openai_responses_config" } });
    const modelRoles = await prisma.appSetting.findUnique({ where: { key: "model_role_bindings" } });
    const parallelRuntime = await prisma.appSetting.findUnique({ where: { key: "parallel_runtime_config" } });
    const distill = await prisma.appSetting.findUnique({ where: { key: "distill_config" } });
    const qwenValue = (qwen?.value as Record<string, unknown>) || {};
    const onPremValue = (onPrem?.value as Record<string, unknown>) || {};
    const openAiCompatValue = (openAiCompat?.value as Record<string, unknown>) || {};
    const openAiResponsesValue = (openAiResponses?.value as Record<string, unknown>) || {};
    const modelRolesValue = (modelRoles?.value as Record<string, unknown>) || {};
    const parallelRuntimeValue = (parallelRuntime?.value as Record<string, unknown>) || {};
    const distillValue = (distill?.value as Record<string, unknown>) || {};
    const qwenArgs = Array.isArray(qwenValue.args)
      ? qwenValue.args.filter((item): item is string => typeof item === "string")
      : (process.env.QWEN_ARGS || DEFAULT_QWEN_CLI_ARGS.join(" ")).split(" ");
    const normalizedQwenArgs =
      qwenArgs.join(" ").trim() === "chat --prompt" || !qwenArgs.length ? DEFAULT_QWEN_CLI_ARGS : qwenArgs;

    return {
      items: {
        safety: safety?.value ?? {
          requireApprovalForDestructiveOps: true,
          requireApprovalForProviderChanges: true,
          requireApprovalForCodeApply: true,
        },
        qwenCli: {
          command:
            typeof qwenValue.command === "string" && qwenValue.command.trim()
              ? qwenValue.command
              : process.env.QWEN_COMMAND || "qwen",
          args: normalizedQwenArgs,
          timeoutMs:
            typeof qwenValue.timeoutMs === "number"
              ? qwenValue.timeoutMs
              : 120000,
        },
        onPremQwen: {
          baseUrl:
            typeof onPremValue.baseUrl === "string" && onPremValue.baseUrl.trim()
              ? onPremValue.baseUrl
              : process.env.ONPREM_QWEN_BASE_URL || "http://127.0.0.1:8000/v1",
          apiKey:
            typeof onPremValue.apiKey === "string"
              ? onPremValue.apiKey
              : process.env.ONPREM_QWEN_API_KEY || "",
          inferenceBackendId:
            typeof onPremValue.inferenceBackendId === "string" && onPremValue.inferenceBackendId.trim()
              ? onPremValue.inferenceBackendId
              : process.env.ONPREM_QWEN_INFERENCE_BACKEND || "mlx-lm",
          pluginId:
            typeof onPremValue.pluginId === "string" && onPremValue.pluginId.trim()
              ? onPremValue.pluginId
              : process.env.ONPREM_QWEN_PLUGIN || "qwen3.5-4b",
          model:
            typeof onPremValue.model === "string" && onPremValue.model.trim()
              ? onPremValue.model
              : process.env.ONPREM_QWEN_MODEL || "mlx-community/Qwen3.5-4B-4bit",
          reasoningMode:
            typeof onPremValue.reasoningMode === "string" && onPremValue.reasoningMode.trim()
              ? onPremValue.reasoningMode
              : process.env.ONPREM_QWEN_REASONING_MODE || "off",
          timeoutMs:
            typeof onPremValue.timeoutMs === "number"
              ? onPremValue.timeoutMs
              : 120000,
          temperature:
            typeof onPremValue.temperature === "number"
              ? onPremValue.temperature
              : 0.15,
          maxTokens:
            typeof onPremValue.maxTokens === "number"
              ? onPremValue.maxTokens
              : 1600,
        },
        openAiCompatible: {
          baseUrl:
            typeof openAiCompatValue.baseUrl === "string" && openAiCompatValue.baseUrl.trim()
              ? openAiCompatValue.baseUrl
              : process.env.OPENAI_COMPAT_BASE_URL || "http://127.0.0.1:11434/v1",
          apiKey:
            typeof openAiCompatValue.apiKey === "string"
              ? openAiCompatValue.apiKey
              : process.env.OPENAI_COMPAT_API_KEY || "",
          model:
            typeof openAiCompatValue.model === "string" && openAiCompatValue.model.trim()
              ? openAiCompatValue.model
              : process.env.OPENAI_COMPAT_MODEL || "gpt-4o-mini",
          timeoutMs:
            typeof openAiCompatValue.timeoutMs === "number"
              ? openAiCompatValue.timeoutMs
              : 120000,
          temperature:
            typeof openAiCompatValue.temperature === "number"
              ? openAiCompatValue.temperature
              : 0.2,
          maxTokens:
            typeof openAiCompatValue.maxTokens === "number"
              ? openAiCompatValue.maxTokens
              : 1800,
        },
        openAiResponses: {
          baseUrl:
            typeof openAiResponsesValue.baseUrl === "string" && openAiResponsesValue.baseUrl.trim()
              ? openAiResponsesValue.baseUrl
              : process.env.OPENAI_RESPONSES_BASE_URL || "https://api.openai.com/v1",
          apiKey:
            typeof openAiResponsesValue.apiKey === "string"
              ? openAiResponsesValue.apiKey
              : process.env.OPENAI_API_KEY || "",
          model:
            typeof openAiResponsesValue.model === "string" && openAiResponsesValue.model.trim()
              ? openAiResponsesValue.model
              : process.env.OPENAI_RESPONSES_MODEL || "gpt-5-mini",
          timeoutMs:
            typeof openAiResponsesValue.timeoutMs === "number"
              ? openAiResponsesValue.timeoutMs
              : 120000,
          reasoningEffort:
            typeof openAiResponsesValue.reasoningEffort === "string" && openAiResponsesValue.reasoningEffort.trim()
              ? openAiResponsesValue.reasoningEffort
              : "medium",
          dailyBudgetUsd:
            typeof openAiResponsesValue.dailyBudgetUsd === "number"
              ? openAiResponsesValue.dailyBudgetUsd
              : 25,
          perRunBudgetUsd:
            typeof openAiResponsesValue.perRunBudgetUsd === "number"
              ? openAiResponsesValue.perRunBudgetUsd
              : 5,
          toolPolicy:
            typeof openAiResponsesValue.toolPolicy === "object" && openAiResponsesValue.toolPolicy
              ? openAiResponsesValue.toolPolicy
              : { enableFileSearch: false, enableRemoteMcp: false },
        },
        modelRoles: modelRolesValue,
        parallelRuntime: {
          maxLocalLanes:
            typeof parallelRuntimeValue.maxLocalLanes === "number" ? parallelRuntimeValue.maxLocalLanes : 4,
          maxExpandedLanes:
            typeof parallelRuntimeValue.maxExpandedLanes === "number" ? parallelRuntimeValue.maxExpandedLanes : 6,
          defaultLaneLeaseMinutes:
            typeof parallelRuntimeValue.defaultLaneLeaseMinutes === "number"
              ? parallelRuntimeValue.defaultLaneLeaseMinutes
              : 20,
          heartbeatIntervalSeconds:
            typeof parallelRuntimeValue.heartbeatIntervalSeconds === "number"
              ? parallelRuntimeValue.heartbeatIntervalSeconds
              : 10,
          staleAfterSeconds:
            typeof parallelRuntimeValue.staleAfterSeconds === "number"
              ? parallelRuntimeValue.staleAfterSeconds
              : 60,
          reservationTtlSeconds:
            typeof parallelRuntimeValue.reservationTtlSeconds === "number"
              ? parallelRuntimeValue.reservationTtlSeconds
              : 14400,
        },
        distill: {
          teacherCommand:
            typeof distillValue.teacherCommand === "string" && distillValue.teacherCommand.trim()
              ? distillValue.teacherCommand
              : process.env.DISTILL_TEACHER_COMMAND || "claude",
          teacherModel:
            typeof distillValue.teacherModel === "string" && distillValue.teacherModel.trim()
              ? distillValue.teacherModel
              : process.env.DISTILL_TEACHER_MODEL || "opus",
          teacherTimeoutMs:
            typeof distillValue.teacherTimeoutMs === "number"
              ? distillValue.teacherTimeoutMs
              : 120000,
          privacyPolicyVersion:
            typeof distillValue.privacyPolicyVersion === "string" && distillValue.privacyPolicyVersion.trim()
              ? distillValue.privacyPolicyVersion
              : "private-safe-v1",
          objectiveSplit:
            typeof distillValue.objectiveSplit === "string" && distillValue.objectiveSplit.trim()
              ? distillValue.objectiveSplit
              : "70-30-coding-general",
          teacherRateLimit:
            typeof distillValue.teacherRateLimit === "object" && distillValue.teacherRateLimit
              ? distillValue.teacherRateLimit
              : {
                  maxRequestsPerMinute: 6,
                  maxConcurrentTeacherJobs: 1,
                  dailyTokenBudget: 120000,
                  retryBackoffMs: 2500,
                  maxRetries: 3,
                },
          trainer:
            typeof distillValue.trainer === "object" && distillValue.trainer
              ? {
                  backend:
                    typeof (distillValue.trainer as { backend?: unknown }).backend === "string"
                      ? (distillValue.trainer as { backend: string }).backend
                      : "hf-lora-local",
                  pythonCommand:
                    typeof (distillValue.trainer as { pythonCommand?: unknown }).pythonCommand === "string"
                      ? (distillValue.trainer as { pythonCommand: string }).pythonCommand
                      : "python3",
                  maxSteps:
                    typeof (distillValue.trainer as { maxSteps?: unknown }).maxSteps === "number"
                      ? (distillValue.trainer as { maxSteps: number }).maxSteps
                      : 40,
                  perDeviceBatchSize:
                    typeof (distillValue.trainer as { perDeviceBatchSize?: unknown }).perDeviceBatchSize === "number"
                      ? (distillValue.trainer as { perDeviceBatchSize: number }).perDeviceBatchSize
                      : 1,
                  gradientAccumulationSteps:
                    typeof (distillValue.trainer as { gradientAccumulationSteps?: unknown }).gradientAccumulationSteps === "number"
                      ? (distillValue.trainer as { gradientAccumulationSteps: number }).gradientAccumulationSteps
                      : 8,
                  learningRate:
                    typeof (distillValue.trainer as { learningRate?: unknown }).learningRate === "number"
                      ? (distillValue.trainer as { learningRate: number }).learningRate
                      : 0.0002,
                  loraRank:
                    typeof (distillValue.trainer as { loraRank?: unknown }).loraRank === "number"
                      ? (distillValue.trainer as { loraRank: number }).loraRank
                      : 8,
                  loraAlpha:
                    typeof (distillValue.trainer as { loraAlpha?: unknown }).loraAlpha === "number"
                      ? (distillValue.trainer as { loraAlpha: number }).loraAlpha
                      : 16,
                  maxSeqLength:
                    typeof (distillValue.trainer as { maxSeqLength?: unknown }).maxSeqLength === "number"
                      ? (distillValue.trainer as { maxSeqLength: number }).maxSeqLength
                      : 1024,
                  orpoBeta:
                    typeof (distillValue.trainer as { orpoBeta?: unknown }).orpoBeta === "number"
                      ? (distillValue.trainer as { orpoBeta: number }).orpoBeta
                      : 0.1,
                  toolRewardScale:
                    typeof (distillValue.trainer as { toolRewardScale?: unknown }).toolRewardScale === "number"
                      ? (distillValue.trainer as { toolRewardScale: number }).toolRewardScale
                      : 0.6,
                }
              : {
                  backend: "hf-lora-local",
                  pythonCommand: "python3",
                  maxSteps: 40,
                  perDeviceBatchSize: 1,
                  gradientAccumulationSteps: 8,
                  learningRate: 0.0002,
                  loraRank: 8,
                  loraAlpha: 16,
                  maxSeqLength: 1024,
                  orpoBeta: 0.1,
                  toolRewardScale: 0.6,
                },
        },
      },
    };
  });

  app.patch("/api/v1/settings", async (request) => {
    const input = request.body as {
      safety?: Record<string, unknown>;
      qwenCli?: {
        command?: string;
        args?: string[];
        timeoutMs?: number;
      };
      onPremQwen?: {
        baseUrl?: string;
        apiKey?: string;
        inferenceBackendId?: string;
        pluginId?: string;
        model?: string;
        reasoningMode?: "off" | "on" | "auto";
        timeoutMs?: number;
        temperature?: number;
        maxTokens?: number;
      };
      openAiCompatible?: {
        baseUrl?: string;
        apiKey?: string;
        model?: string;
        timeoutMs?: number;
        temperature?: number;
        maxTokens?: number;
      };
      openAiResponses?: {
        baseUrl?: string;
        apiKey?: string;
        model?: string;
        timeoutMs?: number;
        reasoningEffort?: "low" | "medium" | "high";
        dailyBudgetUsd?: number;
        perRunBudgetUsd?: number;
        toolPolicy?: {
          enableFileSearch?: boolean;
          enableRemoteMcp?: boolean;
        };
      };
      modelRoles?: Record<string, unknown>;
      parallelRuntime?: {
        maxLocalLanes?: number;
        maxExpandedLanes?: number;
        defaultLaneLeaseMinutes?: number;
        heartbeatIntervalSeconds?: number;
        staleAfterSeconds?: number;
        reservationTtlSeconds?: number;
      };
      distill?: {
        teacherCommand?: string;
        teacherModel?: string;
        teacherTimeoutMs?: number;
        privacyPolicyVersion?: string;
        objectiveSplit?: string;
        teacherRateLimit?: {
          maxRequestsPerMinute?: number;
          maxConcurrentTeacherJobs?: number;
          dailyTokenBudget?: number;
          retryBackoffMs?: number;
          maxRetries?: number;
        };
        trainer?: {
          backend?: string;
          pythonCommand?: string;
          maxSteps?: number;
          perDeviceBatchSize?: number;
          gradientAccumulationSteps?: number;
          learningRate?: number;
          loraRank?: number;
          loraAlpha?: number;
          maxSeqLength?: number;
          orpoBeta?: number;
          toolRewardScale?: number;
        };
      };
    };

    if (input.safety) {
      await prisma.appSetting.upsert({
        where: { key: "safety_policy" },
        update: { value: input.safety },
        create: { key: "safety_policy", value: input.safety },
      });
    }

    if (input.qwenCli) {
      const current = await prisma.appSetting.findUnique({ where: { key: "qwen_cli_config" } });
      const previous = (current?.value as Record<string, unknown>) || {};
      const previousArgs = Array.isArray(previous.args) ? previous.args.filter((item): item is string => typeof item === "string") : [];
      const normalizedPreviousArgs =
        previousArgs.join(" ").trim() === "chat --prompt" || !previousArgs.length
          ? DEFAULT_QWEN_CLI_ARGS
          : previousArgs;
      const next = {
        command: input.qwenCli.command ?? previous.command ?? process.env.QWEN_COMMAND ?? "qwen",
        args: input.qwenCli.args ?? normalizedPreviousArgs ?? (process.env.QWEN_ARGS || DEFAULT_QWEN_CLI_ARGS.join(" ")).split(" "),
        timeoutMs: input.qwenCli.timeoutMs ?? previous.timeoutMs ?? 120000,
      };

      await prisma.appSetting.upsert({
        where: { key: "qwen_cli_config" },
        update: { value: next },
        create: { key: "qwen_cli_config", value: next },
      });
    }

    if (input.onPremQwen) {
      const current = await prisma.appSetting.findUnique({ where: { key: "onprem_qwen_config" } });
      const previous = (current?.value as Record<string, unknown>) || {};
      const next = {
        baseUrl:
          input.onPremQwen.baseUrl ??
          (typeof previous.baseUrl === "string" ? previous.baseUrl : process.env.ONPREM_QWEN_BASE_URL ?? "http://127.0.0.1:8000/v1"),
        apiKey: input.onPremQwen.apiKey ?? (typeof previous.apiKey === "string" ? previous.apiKey : process.env.ONPREM_QWEN_API_KEY ?? ""),
        inferenceBackendId:
          input.onPremQwen.inferenceBackendId ??
          (typeof previous.inferenceBackendId === "string"
            ? previous.inferenceBackendId
            : process.env.ONPREM_QWEN_INFERENCE_BACKEND ?? "mlx-lm"),
        pluginId:
          input.onPremQwen.pluginId ??
          (typeof previous.pluginId === "string" ? previous.pluginId : process.env.ONPREM_QWEN_PLUGIN ?? "qwen3.5-4b"),
        model:
          input.onPremQwen.model ??
          (typeof previous.model === "string" ? previous.model : process.env.ONPREM_QWEN_MODEL ?? "mlx-community/Qwen3.5-4B-4bit"),
        reasoningMode:
          input.onPremQwen.reasoningMode ??
          (typeof previous.reasoningMode === "string" ? previous.reasoningMode : process.env.ONPREM_QWEN_REASONING_MODE ?? "off"),
        timeoutMs: input.onPremQwen.timeoutMs ?? (typeof previous.timeoutMs === "number" ? previous.timeoutMs : 120000),
        temperature: input.onPremQwen.temperature ?? (typeof previous.temperature === "number" ? previous.temperature : 0.15),
        maxTokens: input.onPremQwen.maxTokens ?? (typeof previous.maxTokens === "number" ? previous.maxTokens : 1600),
      };

      await prisma.appSetting.upsert({
        where: { key: "onprem_qwen_config" },
        update: { value: next },
        create: { key: "onprem_qwen_config", value: next },
      });
    }

    if (input.openAiCompatible) {
      const current = await prisma.appSetting.findUnique({ where: { key: "openai_compatible_config" } });
      const previous = (current?.value as Record<string, unknown>) || {};
      const next = {
        baseUrl:
          input.openAiCompatible.baseUrl ??
          (typeof previous.baseUrl === "string" ? previous.baseUrl : process.env.OPENAI_COMPAT_BASE_URL ?? "http://127.0.0.1:11434/v1"),
        apiKey:
          input.openAiCompatible.apiKey ??
          (typeof previous.apiKey === "string" ? previous.apiKey : process.env.OPENAI_COMPAT_API_KEY ?? ""),
        model:
          input.openAiCompatible.model ??
          (typeof previous.model === "string" ? previous.model : process.env.OPENAI_COMPAT_MODEL ?? "gpt-4o-mini"),
        timeoutMs: input.openAiCompatible.timeoutMs ?? (typeof previous.timeoutMs === "number" ? previous.timeoutMs : 120000),
        temperature: input.openAiCompatible.temperature ?? (typeof previous.temperature === "number" ? previous.temperature : 0.2),
        maxTokens: input.openAiCompatible.maxTokens ?? (typeof previous.maxTokens === "number" ? previous.maxTokens : 1800),
      };

      await prisma.appSetting.upsert({
        where: { key: "openai_compatible_config" },
        update: { value: next },
        create: { key: "openai_compatible_config", value: next },
      });
    }

    if (input.openAiResponses) {
      const current = await prisma.appSetting.findUnique({ where: { key: "openai_responses_config" } });
      const previous = (current?.value as Record<string, unknown>) || {};
      const next = {
        baseUrl:
          input.openAiResponses.baseUrl ??
          (typeof previous.baseUrl === "string" ? previous.baseUrl : process.env.OPENAI_RESPONSES_BASE_URL ?? "https://api.openai.com/v1"),
        apiKey:
          input.openAiResponses.apiKey ??
          (typeof previous.apiKey === "string" ? previous.apiKey : process.env.OPENAI_API_KEY ?? ""),
        model:
          input.openAiResponses.model ??
          (typeof previous.model === "string" ? previous.model : process.env.OPENAI_RESPONSES_MODEL ?? "gpt-5-mini"),
        timeoutMs:
          input.openAiResponses.timeoutMs ??
          (typeof previous.timeoutMs === "number" ? previous.timeoutMs : 120000),
        reasoningEffort:
          input.openAiResponses.reasoningEffort ??
          (typeof previous.reasoningEffort === "string" ? previous.reasoningEffort : "medium"),
        dailyBudgetUsd:
          input.openAiResponses.dailyBudgetUsd ??
          (typeof previous.dailyBudgetUsd === "number" ? previous.dailyBudgetUsd : 25),
        perRunBudgetUsd:
          input.openAiResponses.perRunBudgetUsd ??
          (typeof previous.perRunBudgetUsd === "number" ? previous.perRunBudgetUsd : 5),
        toolPolicy: {
          enableFileSearch:
            input.openAiResponses.toolPolicy?.enableFileSearch ??
            (typeof previous.toolPolicy === "object" && previous.toolPolicy
              ? Boolean((previous.toolPolicy as { enableFileSearch?: boolean }).enableFileSearch)
              : false),
          enableRemoteMcp:
            input.openAiResponses.toolPolicy?.enableRemoteMcp ??
            (typeof previous.toolPolicy === "object" && previous.toolPolicy
              ? Boolean((previous.toolPolicy as { enableRemoteMcp?: boolean }).enableRemoteMcp)
              : false),
        },
      };

      await prisma.appSetting.upsert({
        where: { key: "openai_responses_config" },
        update: { value: next },
        create: { key: "openai_responses_config", value: next },
      });
    }

    if (input.modelRoles) {
      await prisma.appSetting.upsert({
        where: { key: "model_role_bindings" },
        update: { value: input.modelRoles },
        create: { key: "model_role_bindings", value: input.modelRoles },
      });
    }

    if (input.parallelRuntime) {
      const current = await prisma.appSetting.findUnique({ where: { key: "parallel_runtime_config" } });
      const previous = (current?.value as Record<string, unknown>) || {};
      const next = {
        maxLocalLanes: input.parallelRuntime.maxLocalLanes ?? (typeof previous.maxLocalLanes === "number" ? previous.maxLocalLanes : 4),
        maxExpandedLanes:
          input.parallelRuntime.maxExpandedLanes ?? (typeof previous.maxExpandedLanes === "number" ? previous.maxExpandedLanes : 6),
        defaultLaneLeaseMinutes:
          input.parallelRuntime.defaultLaneLeaseMinutes ??
          (typeof previous.defaultLaneLeaseMinutes === "number" ? previous.defaultLaneLeaseMinutes : 20),
        heartbeatIntervalSeconds:
          input.parallelRuntime.heartbeatIntervalSeconds ??
          (typeof previous.heartbeatIntervalSeconds === "number" ? previous.heartbeatIntervalSeconds : 10),
        staleAfterSeconds:
          input.parallelRuntime.staleAfterSeconds ??
          (typeof previous.staleAfterSeconds === "number" ? previous.staleAfterSeconds : 60),
        reservationTtlSeconds:
          input.parallelRuntime.reservationTtlSeconds ??
          (typeof previous.reservationTtlSeconds === "number" ? previous.reservationTtlSeconds : 14400),
      };

      await prisma.appSetting.upsert({
        where: { key: "parallel_runtime_config" },
        update: { value: next },
        create: { key: "parallel_runtime_config", value: next },
      });
    }

    if (input.distill) {
      const current = await prisma.appSetting.findUnique({ where: { key: "distill_config" } });
      const previous = (current?.value as Record<string, unknown>) || {};
      const next = {
        teacherCommand:
          input.distill.teacherCommand ??
          (typeof previous.teacherCommand === "string" ? previous.teacherCommand : process.env.DISTILL_TEACHER_COMMAND ?? "claude"),
        teacherModel:
          input.distill.teacherModel ??
          (typeof previous.teacherModel === "string" ? previous.teacherModel : process.env.DISTILL_TEACHER_MODEL ?? "opus"),
        teacherTimeoutMs:
          input.distill.teacherTimeoutMs ??
          (typeof previous.teacherTimeoutMs === "number" ? previous.teacherTimeoutMs : 120000),
        privacyPolicyVersion:
          input.distill.privacyPolicyVersion ??
          (typeof previous.privacyPolicyVersion === "string" ? previous.privacyPolicyVersion : "private-safe-v1"),
        objectiveSplit:
          input.distill.objectiveSplit ??
          (typeof previous.objectiveSplit === "string" ? previous.objectiveSplit : "70-30-coding-general"),
        teacherRateLimit: {
          maxRequestsPerMinute:
            input.distill.teacherRateLimit?.maxRequestsPerMinute ??
            (typeof previous.teacherRateLimit === "object" && previous.teacherRateLimit
              ? (previous.teacherRateLimit as { maxRequestsPerMinute?: number }).maxRequestsPerMinute
              : 6) ??
            6,
          maxConcurrentTeacherJobs:
            input.distill.teacherRateLimit?.maxConcurrentTeacherJobs ??
            (typeof previous.teacherRateLimit === "object" && previous.teacherRateLimit
              ? (previous.teacherRateLimit as { maxConcurrentTeacherJobs?: number }).maxConcurrentTeacherJobs
              : 1) ??
            1,
          dailyTokenBudget:
            input.distill.teacherRateLimit?.dailyTokenBudget ??
            (typeof previous.teacherRateLimit === "object" && previous.teacherRateLimit
              ? (previous.teacherRateLimit as { dailyTokenBudget?: number }).dailyTokenBudget
              : 120000) ??
            120000,
          retryBackoffMs:
            input.distill.teacherRateLimit?.retryBackoffMs ??
            (typeof previous.teacherRateLimit === "object" && previous.teacherRateLimit
              ? (previous.teacherRateLimit as { retryBackoffMs?: number }).retryBackoffMs
              : 2500) ??
            2500,
          maxRetries:
            input.distill.teacherRateLimit?.maxRetries ??
            (typeof previous.teacherRateLimit === "object" && previous.teacherRateLimit
              ? (previous.teacherRateLimit as { maxRetries?: number }).maxRetries
              : 3) ??
            3,
        },
        trainer: {
          backend:
            input.distill.trainer?.backend ??
            (typeof previous.trainer === "object" && previous.trainer
              ? (previous.trainer as { backend?: string }).backend
              : "hf-lora-local") ??
            "hf-lora-local",
          pythonCommand:
            input.distill.trainer?.pythonCommand ??
            (typeof previous.trainer === "object" && previous.trainer
              ? (previous.trainer as { pythonCommand?: string }).pythonCommand
              : "python3") ??
            "python3",
          maxSteps:
            input.distill.trainer?.maxSteps ??
            (typeof previous.trainer === "object" && previous.trainer
              ? (previous.trainer as { maxSteps?: number }).maxSteps
              : 40) ??
            40,
          perDeviceBatchSize:
            input.distill.trainer?.perDeviceBatchSize ??
            (typeof previous.trainer === "object" && previous.trainer
              ? (previous.trainer as { perDeviceBatchSize?: number }).perDeviceBatchSize
              : 1) ??
            1,
          gradientAccumulationSteps:
            input.distill.trainer?.gradientAccumulationSteps ??
            (typeof previous.trainer === "object" && previous.trainer
              ? (previous.trainer as { gradientAccumulationSteps?: number }).gradientAccumulationSteps
              : 8) ??
            8,
          learningRate:
            input.distill.trainer?.learningRate ??
            (typeof previous.trainer === "object" && previous.trainer
              ? (previous.trainer as { learningRate?: number }).learningRate
              : 0.0002) ??
            0.0002,
          loraRank:
            input.distill.trainer?.loraRank ??
            (typeof previous.trainer === "object" && previous.trainer
              ? (previous.trainer as { loraRank?: number }).loraRank
              : 8) ??
            8,
          loraAlpha:
            input.distill.trainer?.loraAlpha ??
            (typeof previous.trainer === "object" && previous.trainer
              ? (previous.trainer as { loraAlpha?: number }).loraAlpha
              : 16) ??
            16,
          maxSeqLength:
            input.distill.trainer?.maxSeqLength ??
            (typeof previous.trainer === "object" && previous.trainer
              ? (previous.trainer as { maxSeqLength?: number }).maxSeqLength
              : 1024) ??
            1024,
          orpoBeta:
            input.distill.trainer?.orpoBeta ??
            (typeof previous.trainer === "object" && previous.trainer
              ? (previous.trainer as { orpoBeta?: number }).orpoBeta
              : 0.1) ??
            0.1,
          toolRewardScale:
            input.distill.trainer?.toolRewardScale ??
            (typeof previous.trainer === "object" && previous.trainer
              ? (previous.trainer as { toolRewardScale?: number }).toolRewardScale
              : 0.6) ??
            0.6,
        },
      };

      await prisma.appSetting.upsert({
        where: { key: "distill_config" },
        update: { value: next },
        create: { key: "distill_config", value: next },
      });
    }

    await prisma.auditEvent.create({
      data: {
        actor: "user",
        eventType: "settings.updated",
        payload: input,
      },
    });

    return { ok: true };
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    reply.code(500).send({
      error: error.message,
    });
  });

  return app;
}

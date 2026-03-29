-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('backlog', 'ready', 'in_progress', 'review', 'blocked', 'done');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('p0', 'p1', 'p2', 'p3');

-- CreateEnum
CREATE TYPE "TicketRisk" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "ChatMessageRole" AS ENUM ('system', 'user', 'assistant');

-- CreateEnum
CREATE TYPE "ProviderAccountState" AS ENUM ('ready', 'cooldown', 'auth_required', 'disabled');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "TaskLifecycleStatus" AS ENUM ('inactive', 'reserved', 'active', 'in_progress', 'blocked', 'completed');

-- CreateEnum
CREATE TYPE "CommandStatus" AS ENUM ('queued', 'approved', 'rejected', 'executed', 'failed');

-- CreateEnum
CREATE TYPE "DistillDatasetStatus" AS ENUM ('draft', 'reviewed', 'approved', 'archived');

-- CreateEnum
CREATE TYPE "DistillReviewDecision" AS ENUM ('pending', 'approved', 'rejected', 'needs_edit');

-- CreateEnum
CREATE TYPE "DistillRunStage" AS ENUM ('sft', 'orpo', 'tool_rl');

-- CreateEnum
CREATE TYPE "DistillRunStatus" AS ENUM ('queued', 'running', 'failed', 'completed', 'promoted');

-- CreateEnum
CREATE TYPE "DistillRunFailureReason" AS ENUM ('rate_limited', 'budget_exhausted', 'trainer_unavailable', 'dataset_insufficient', 'not_implemented', 'unknown');

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "TicketStatus" NOT NULL DEFAULT 'backlog',
    "lane_order" INTEGER NOT NULL DEFAULT 0,
    "priority" "TicketPriority" NOT NULL DEFAULT 'p2',
    "acceptanceCriteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dependencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "risk" "TicketRisk" NOT NULL DEFAULT 'medium',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketEvent" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketComment" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "parent_comment_id" TEXT,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT,
    "title" TEXT NOT NULL,
    "providerId" TEXT NOT NULL DEFAULT 'onprem-qwen',
    "activeAccount" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "ChatMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderAccount" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "profilePath" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "state" "ProviderAccountState" NOT NULL DEFAULT 'ready',
    "cooldownUntil" TIMESTAMP(3),
    "quotaNextUsableAt" TIMESTAMP(3),
    "quotaEtaConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastQuotaErrorAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "keychainRef" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderAccountEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderAccountEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderUsageSample" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "errorClass" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderUsageSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "reason" TEXT,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SecretRecord" (
    "name" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecretRecord_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "event_log" (
    "event_id" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "causation_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_log_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "event_outbox" (
    "id" BIGSERIAL NOT NULL,
    "event_id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_projection" (
    "ticket_id" TEXT NOT NULL,
    "repo_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "TaskLifecycleStatus" NOT NULL DEFAULT 'inactive',
    "priority" "TicketPriority" NOT NULL DEFAULT 'p2',
    "risk" "TicketRisk" NOT NULL DEFAULT 'medium',
    "acceptance_criteria" JSONB NOT NULL DEFAULT '[]',
    "dependencies" JSONB NOT NULL DEFAULT '[]',
    "assignee_agent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_transition_at" TIMESTAMP(3),

    CONSTRAINT "task_projection_pkey" PRIMARY KEY ("ticket_id")
);

-- CreateTable
CREATE TABLE "task_reservations" (
    "ticket_id" TEXT NOT NULL,
    "reserved_by" TEXT NOT NULL,
    "reserved_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "reclaimed_at" TIMESTAMP(3),

    CONSTRAINT "task_reservations_pkey" PRIMARY KEY ("ticket_id")
);

-- CreateTable
CREATE TABLE "agent_heartbeats" (
    "agent_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_heartbeats_pkey" PRIMARY KEY ("agent_id")
);

-- CreateTable
CREATE TABLE "run_projection" (
    "run_id" TEXT NOT NULL,
    "ticket_id" TEXT,
    "status" TEXT NOT NULL,
    "provider_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "run_projection_pkey" PRIMARY KEY ("run_id")
);

-- CreateTable
CREATE TABLE "provider_account_projection" (
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "quota_next_usable_at" TIMESTAMP(3),
    "quota_eta_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "last_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_account_projection_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "routing_decision_projection" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT,
    "ticket_id" TEXT,
    "run_id" TEXT,
    "execution_mode" TEXT NOT NULL,
    "model_role" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "max_lanes" INTEGER NOT NULL DEFAULT 1,
    "risk" TEXT NOT NULL DEFAULT 'medium',
    "verification_depth" TEXT NOT NULL DEFAULT 'standard',
    "decomposition_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimated_file_overlap" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rationale" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routing_decision_projection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_manifest" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT,
    "aggregate_id" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "constraints" JSONB NOT NULL DEFAULT '[]',
    "active_files" JSONB NOT NULL DEFAULT '[]',
    "retrieval_ids" JSONB NOT NULL DEFAULT '[]',
    "memory_refs" JSONB NOT NULL DEFAULT '[]',
    "open_questions" JSONB NOT NULL DEFAULT '[]',
    "verification_plan" JSONB NOT NULL DEFAULT '[]',
    "rollback_plan" JSONB NOT NULL DEFAULT '[]',
    "policy_scopes" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "context_manifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_state_projection" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT,
    "aggregate_id" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "next_steps" JSONB NOT NULL DEFAULT '[]',
    "blockers" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_state_projection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_record" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "repo_id" TEXT,
    "aggregate_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "stale_after" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retrieval_trace" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT,
    "aggregate_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "retrieval_ids" JSONB NOT NULL DEFAULT '[]',
    "results" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retrieval_trace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_projection" (
    "approval_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "payload" JSONB NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "approval_projection_pkey" PRIMARY KEY ("approval_id")
);

-- CreateTable
CREATE TABLE "agent_lane" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT,
    "ticket_id" TEXT NOT NULL,
    "run_id" TEXT,
    "role" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "worktree_path" TEXT NOT NULL,
    "context_manifest_id" TEXT,
    "lease_expires_at" TIMESTAMP(3) NOT NULL,
    "last_heartbeat_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_lane_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worktree_lease" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT,
    "lane_id" TEXT NOT NULL,
    "worktree_path" TEXT NOT NULL,
    "lease_owner" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worktree_lease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merge_report" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT,
    "run_id" TEXT NOT NULL,
    "changed_files" JSONB NOT NULL DEFAULT '[]',
    "overlap_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "semantic_conflicts" JSONB NOT NULL DEFAULT '[]',
    "required_checks" JSONB NOT NULL DEFAULT '[]',
    "outcome" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merge_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repo_registry" (
    "id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "source_kind" TEXT NOT NULL,
    "source_uri" TEXT NOT NULL,
    "canonical_root" TEXT NOT NULL,
    "managed_worktree_root" TEXT NOT NULL,
    "default_branch" TEXT NOT NULL,
    "toolchain_profile" JSONB NOT NULL DEFAULT '{}',
    "benchmark_eligible" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repo_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repo_state_capsule" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "active_branch" TEXT NOT NULL,
    "active_worktree_path" TEXT NOT NULL,
    "selected_ticket_id" TEXT,
    "selected_run_id" TEXT,
    "recent_chat_session_ids" JSONB NOT NULL DEFAULT '[]',
    "last_context_manifest_id" TEXT,
    "retrieval_cache_keys" JSONB NOT NULL DEFAULT '[]',
    "provider_sessions" JSONB NOT NULL DEFAULT '[]',
    "warm_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspended_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repo_state_capsule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repo_guideline_profile" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "languages" JSONB NOT NULL DEFAULT '[]',
    "test_commands" JSONB NOT NULL DEFAULT '[]',
    "build_commands" JSONB NOT NULL DEFAULT '[]',
    "lint_commands" JSONB NOT NULL DEFAULT '[]',
    "doc_rules" JSONB NOT NULL DEFAULT '[]',
    "patch_rules" JSONB NOT NULL DEFAULT '[]',
    "file_placement_rules" JSONB NOT NULL DEFAULT '[]',
    "review_style" TEXT NOT NULL DEFAULT 'findings_first',
    "required_artifacts" JSONB NOT NULL DEFAULT '[]',
    "source_refs" JSONB NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repo_guideline_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_blueprint" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "source_mode" TEXT NOT NULL DEFAULT 'repo_extracted',
    "charter" JSONB NOT NULL DEFAULT '{}',
    "coding_standards" JSONB NOT NULL DEFAULT '{}',
    "testing_policy" JSONB NOT NULL DEFAULT '{}',
    "documentation_policy" JSONB NOT NULL DEFAULT '{}',
    "execution_policy" JSONB NOT NULL DEFAULT '{}',
    "provider_policy" JSONB NOT NULL DEFAULT '{}',
    "extracted_from" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_blueprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repo_index_snapshot" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "file_count" INTEGER NOT NULL DEFAULT 0,
    "indexed_doc_refs" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repo_index_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repo_activation_log" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repo_activation_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repo_session_handle" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "model_role" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "previous_response_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repo_session_handle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repo_switch_checkpoint" (
    "id" TEXT NOT NULL,
    "from_repo_id" TEXT,
    "to_repo_id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "state_capsule_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'prepared',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repo_switch_checkpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_installation" (
    "id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "account_login" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "app_slug" TEXT NOT NULL DEFAULT 'agentic-workforce',
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_repo_binding" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "installation_id" TEXT,
    "github_repo_id" TEXT,
    "default_branch" TEXT NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "mode" TEXT NOT NULL DEFAULT 'draft_pr',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_repo_binding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_pull_request_projection" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "run_id" TEXT,
    "pull_number" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "base_branch" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_pull_request_projection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_graph_node" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT,
    "content" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "code_graph_node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_graph_edge" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "from_node_id" TEXT NOT NULL,
    "to_node_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "code_graph_edge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_pack" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "query_mode" TEXT NOT NULL DEFAULT 'basic',
    "files" JSONB NOT NULL DEFAULT '[]',
    "symbols" JSONB NOT NULL DEFAULT '[]',
    "tests" JSONB NOT NULL DEFAULT '[]',
    "docs" JSONB NOT NULL DEFAULT '[]',
    "rules" JSONB NOT NULL DEFAULT '[]',
    "prior_runs" JSONB NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "why" JSONB NOT NULL DEFAULT '[]',
    "token_budget" INTEGER NOT NULL DEFAULT 1800,
    "retrieval_trace_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "context_pack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_attempt" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "project_id" TEXT,
    "model_role" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "objective" TEXT NOT NULL,
    "patch_summary" TEXT NOT NULL DEFAULT '',
    "changed_files" JSONB NOT NULL DEFAULT '[]',
    "approval_required" BOOLEAN NOT NULL DEFAULT false,
    "context_pack_id" TEXT,
    "routing_decision_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "execution_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_bundle" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "execution_attempt_id" TEXT,
    "changed_file_checks" JSONB NOT NULL DEFAULT '[]',
    "impacted_tests" JSONB NOT NULL DEFAULT '[]',
    "full_suite_run" BOOLEAN NOT NULL DEFAULT false,
    "docs_checked" JSONB NOT NULL DEFAULT '[]',
    "pass" BOOLEAN NOT NULL DEFAULT false,
    "failures" JSONB NOT NULL DEFAULT '[]',
    "artifacts" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_bundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_example_candidate" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "scorecard_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "benchmark_example_candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shareable_run_report" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "scorecard_id" TEXT,
    "pull_request_url" TEXT,
    "evidence_urls" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shareable_run_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_project" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT,
    "project_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "source_kind" TEXT NOT NULL,
    "source_uri" TEXT NOT NULL,
    "manifest_path" TEXT,
    "languages" JSONB NOT NULL DEFAULT '[]',
    "setup_command" TEXT NOT NULL,
    "verify_command" TEXT NOT NULL,
    "reset_command" TEXT,
    "install_command" TEXT,
    "guideline_sources" JSONB NOT NULL DEFAULT '[]',
    "time_budget_sec" INTEGER NOT NULL DEFAULT 900,
    "network_policy" TEXT NOT NULL DEFAULT 'offline',
    "default_provider_role" TEXT NOT NULL DEFAULT 'coder_default',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "benchmark_project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_task" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "task_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "expected_artifacts" JSONB NOT NULL DEFAULT '[]',
    "required_checks" JSONB NOT NULL DEFAULT '[]',
    "required_docs" JSONB NOT NULL DEFAULT '[]',
    "hard_fail_if_missing" JSONB NOT NULL DEFAULT '[]',
    "scoring_weights" JSONB NOT NULL DEFAULT '{}',
    "acceptance_commands" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "benchmark_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_run" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "provider_role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "actor" TEXT NOT NULL,
    "worktree_path" TEXT NOT NULL,
    "chat_session_id" TEXT,
    "routing_decision_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "benchmark_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_scorecard" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "pass" BOOLEAN NOT NULL DEFAULT false,
    "total_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "functional_correctness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "guideline_adherence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "verification_discipline" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "patch_quality" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retrieval_discipline" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "policy_compliance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latency_recovery" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hard_failures" JSONB NOT NULL DEFAULT '[]',
    "evidence_refs" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "benchmark_scorecard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_outcome_evidence" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "path" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "benchmark_outcome_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_candidate" (
    "id" TEXT NOT NULL,
    "model_plugin_id" TEXT NOT NULL,
    "parent_model_plugin_id" TEXT,
    "dataset_id" TEXT NOT NULL,
    "eval_run_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "challenge_candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_budget_projection" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "daily_budget_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "used_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "cooldown_until" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_budget_projection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_source_projection" (
    "id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teacher_source_projection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_rationale_projection" (
    "id" TEXT NOT NULL,
    "aggregate_id" TEXT,
    "action_type" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "rule_ids" JSONB NOT NULL DEFAULT '[]',
    "rationale" JSONB NOT NULL DEFAULT '[]',
    "required_scopes" JSONB NOT NULL DEFAULT '[]',
    "policy_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_rationale_projection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_index_metadata" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "snippet" TEXT NOT NULL,
    "embedding_id" TEXT,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_index_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "provider_scope" TEXT,
    "template" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_experiments" (
    "id" TEXT NOT NULL,
    "template_id" TEXT,
    "variant_a" TEXT NOT NULL,
    "variant_b" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "result" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_experiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command_log" (
    "id" TEXT NOT NULL,
    "command_type" TEXT NOT NULL,
    "aggregate_id" TEXT,
    "status" "CommandStatus" NOT NULL DEFAULT 'queued',
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "actor" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "command_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inference_backend_profile" (
    "id" TEXT NOT NULL,
    "backend_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "optimized_for" TEXT NOT NULL,
    "capability" JSONB NOT NULL DEFAULT '{}',
    "hardware_affinity" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inference_backend_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inference_benchmark_run" (
    "id" TEXT NOT NULL,
    "backend_id" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "ttft_ms_p95" DOUBLE PRECISION NOT NULL,
    "output_tok_per_sec" DOUBLE PRECISION NOT NULL,
    "latency_ms_p95" DOUBLE PRECISION NOT NULL,
    "error_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "memory_headroom_pct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inference_benchmark_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_plugin_registry" (
    "id" TEXT NOT NULL,
    "plugin_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "params_b" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "promoted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_plugin_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distill_dataset" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective_split" TEXT NOT NULL,
    "privacy_policy_version" TEXT NOT NULL,
    "status" "DistillDatasetStatus" NOT NULL DEFAULT 'draft',
    "created_by" TEXT NOT NULL,
    "sample_count" INTEGER NOT NULL DEFAULT 0,
    "approved_count" INTEGER NOT NULL DEFAULT 0,
    "rejected_count" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distill_dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distill_example" (
    "id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "teacher_output" TEXT NOT NULL,
    "reviewer_decision" "DistillReviewDecision" NOT NULL DEFAULT 'pending',
    "review_notes" TEXT,
    "privacy_safe" BOOLEAN NOT NULL DEFAULT true,
    "citations" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "distill_example_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distill_run" (
    "id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "stage" "DistillRunStage" NOT NULL,
    "student_model_id" TEXT NOT NULL,
    "status" "DistillRunStatus" NOT NULL DEFAULT 'queued',
    "reason_code" "DistillRunFailureReason",
    "job_id" TEXT,
    "backend" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "artifact_path" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distill_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distill_run_log" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distill_run_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distill_eval_run" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "baseline_model_id" TEXT,
    "pass" BOOLEAN NOT NULL DEFAULT false,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distill_eval_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_artifact_registry" (
    "id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "artifact_type" TEXT NOT NULL,
    "artifact_path" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "promoted" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_artifact_registry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Ticket_repo_id_status_lane_order_updatedAt_idx" ON "Ticket"("repo_id", "status", "lane_order", "updatedAt");

-- CreateIndex
CREATE INDEX "TicketEvent_ticketId_createdAt_idx" ON "TicketEvent"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketComment_ticket_id_parent_comment_id_created_at_idx" ON "TicketComment"("ticket_id", "parent_comment_id", "created_at");

-- CreateIndex
CREATE INDEX "ChatSession_repo_id_updatedAt_idx" ON "ChatSession"("repo_id", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ProviderAccount_providerId_state_cooldownUntil_idx" ON "ProviderAccount"("providerId", "state", "cooldownUntil");

-- CreateIndex
CREATE INDEX "ProviderAccountEvent_accountId_createdAt_idx" ON "ProviderAccountEvent"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "ProviderUsageSample_accountId_createdAt_idx" ON "ProviderUsageSample"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "RunEvent_createdAt_idx" ON "RunEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_requestedAt_idx" ON "ApprovalRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "event_log_aggregate_id_created_at_idx" ON "event_log"("aggregate_id", "created_at");

-- CreateIndex
CREATE INDEX "event_outbox_published_created_at_idx" ON "event_outbox"("published", "created_at");

-- CreateIndex
CREATE INDEX "task_projection_repo_id_status_priority_updated_at_idx" ON "task_projection"("repo_id", "status", "priority", "updated_at");

-- CreateIndex
CREATE INDEX "task_reservations_expires_at_reclaimed_at_idx" ON "task_reservations"("expires_at", "reclaimed_at");

-- CreateIndex
CREATE INDEX "agent_heartbeats_last_seen_at_idx" ON "agent_heartbeats"("last_seen_at");

-- CreateIndex
CREATE INDEX "run_projection_status_updated_at_idx" ON "run_projection"("status", "updated_at");

-- CreateIndex
CREATE INDEX "provider_account_projection_provider_id_state_last_seen_at_idx" ON "provider_account_projection"("provider_id", "state", "last_seen_at");

-- CreateIndex
CREATE INDEX "routing_decision_projection_repo_id_created_at_idx" ON "routing_decision_projection"("repo_id", "created_at");

-- CreateIndex
CREATE INDEX "routing_decision_projection_ticket_id_created_at_idx" ON "routing_decision_projection"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "routing_decision_projection_run_id_created_at_idx" ON "routing_decision_projection"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "context_manifest_repo_id_aggregate_id_aggregate_type_update_idx" ON "context_manifest"("repo_id", "aggregate_id", "aggregate_type", "updated_at");

-- CreateIndex
CREATE INDEX "workflow_state_projection_repo_id_aggregate_id_updated_at_idx" ON "workflow_state_projection"("repo_id", "aggregate_id", "updated_at");

-- CreateIndex
CREATE INDEX "memory_record_kind_repo_id_aggregate_id_stale_after_idx" ON "memory_record"("kind", "repo_id", "aggregate_id", "stale_after");

-- CreateIndex
CREATE INDEX "retrieval_trace_repo_id_aggregate_id_created_at_idx" ON "retrieval_trace"("repo_id", "aggregate_id", "created_at");

-- CreateIndex
CREATE INDEX "approval_projection_status_requested_at_idx" ON "approval_projection"("status", "requested_at");

-- CreateIndex
CREATE INDEX "agent_lane_repo_id_ticket_id_state_lease_expires_at_idx" ON "agent_lane"("repo_id", "ticket_id", "state", "lease_expires_at");

-- CreateIndex
CREATE INDEX "agent_lane_run_id_updated_at_idx" ON "agent_lane"("run_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "worktree_lease_lane_id_key" ON "worktree_lease"("lane_id");

-- CreateIndex
CREATE INDEX "worktree_lease_repo_id_expires_at_updated_at_idx" ON "worktree_lease"("repo_id", "expires_at", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "merge_report_run_id_key" ON "merge_report"("run_id");

-- CreateIndex
CREATE INDEX "merge_report_repo_id_outcome_updated_at_idx" ON "merge_report"("repo_id", "outcome", "updated_at");

-- CreateIndex
CREATE INDEX "repo_registry_active_display_name_idx" ON "repo_registry"("active", "display_name");

-- CreateIndex
CREATE INDEX "repo_state_capsule_repo_id_suspended_at_idx" ON "repo_state_capsule"("repo_id", "suspended_at");

-- CreateIndex
CREATE INDEX "repo_guideline_profile_repo_id_updated_at_idx" ON "repo_guideline_profile"("repo_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "repo_guideline_profile_repo_id_key" ON "repo_guideline_profile"("repo_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_blueprint_repo_id_key" ON "project_blueprint"("repo_id");

-- CreateIndex
CREATE INDEX "project_blueprint_repo_id_updated_at_idx" ON "project_blueprint"("repo_id", "updated_at");

-- CreateIndex
CREATE INDEX "repo_index_snapshot_repo_id_created_at_idx" ON "repo_index_snapshot"("repo_id", "created_at");

-- CreateIndex
CREATE INDEX "repo_activation_log_repo_id_created_at_idx" ON "repo_activation_log"("repo_id", "created_at");

-- CreateIndex
CREATE INDEX "repo_session_handle_repo_id_provider_id_model_role_idx" ON "repo_session_handle"("repo_id", "provider_id", "model_role");

-- CreateIndex
CREATE INDEX "repo_switch_checkpoint_to_repo_id_created_at_idx" ON "repo_switch_checkpoint"("to_repo_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "github_installation_installation_id_key" ON "github_installation"("installation_id");

-- CreateIndex
CREATE INDEX "github_installation_account_login_updated_at_idx" ON "github_installation"("account_login", "updated_at");

-- CreateIndex
CREATE INDEX "github_repo_binding_owner_repo_updated_at_idx" ON "github_repo_binding"("owner", "repo", "updated_at");

-- CreateIndex
CREATE INDEX "github_repo_binding_installation_id_updated_at_idx" ON "github_repo_binding"("installation_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "github_repo_binding_repo_id_key" ON "github_repo_binding"("repo_id");

-- CreateIndex
CREATE INDEX "github_pull_request_projection_repo_id_run_id_updated_at_idx" ON "github_pull_request_projection"("repo_id", "run_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "github_pull_request_projection_repo_id_pull_number_key" ON "github_pull_request_projection"("repo_id", "pull_number");

-- CreateIndex
CREATE INDEX "code_graph_node_repo_id_kind_path_name_idx" ON "code_graph_node"("repo_id", "kind", "path", "name");

-- CreateIndex
CREATE INDEX "code_graph_edge_repo_id_from_node_id_kind_idx" ON "code_graph_edge"("repo_id", "from_node_id", "kind");

-- CreateIndex
CREATE INDEX "code_graph_edge_repo_id_to_node_id_kind_idx" ON "code_graph_edge"("repo_id", "to_node_id", "kind");

-- CreateIndex
CREATE INDEX "context_pack_repo_id_created_at_idx" ON "context_pack"("repo_id", "created_at");

-- CreateIndex
CREATE INDEX "execution_attempt_run_id_status_started_at_idx" ON "execution_attempt"("run_id", "status", "started_at");

-- CreateIndex
CREATE INDEX "execution_attempt_repo_id_updated_at_idx" ON "execution_attempt"("repo_id", "updated_at");

-- CreateIndex
CREATE INDEX "verification_bundle_run_id_created_at_idx" ON "verification_bundle"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "verification_bundle_repo_id_updated_at_idx" ON "verification_bundle"("repo_id", "updated_at");

-- CreateIndex
CREATE INDEX "benchmark_example_candidate_status_created_at_idx" ON "benchmark_example_candidate"("status", "created_at");

-- CreateIndex
CREATE INDEX "benchmark_example_candidate_run_id_updated_at_idx" ON "benchmark_example_candidate"("run_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "benchmark_example_candidate_run_id_key" ON "benchmark_example_candidate"("run_id");

-- CreateIndex
CREATE INDEX "shareable_run_report_repo_id_created_at_idx" ON "shareable_run_report"("repo_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "shareable_run_report_run_id_key" ON "shareable_run_report"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "benchmark_project_project_key_key" ON "benchmark_project"("project_key");

-- CreateIndex
CREATE INDEX "benchmark_project_repo_id_display_name_idx" ON "benchmark_project"("repo_id", "display_name");

-- CreateIndex
CREATE INDEX "benchmark_task_project_id_category_updated_at_idx" ON "benchmark_task"("project_id", "category", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "benchmark_task_project_id_task_key_key" ON "benchmark_task"("project_id", "task_key");

-- CreateIndex
CREATE INDEX "benchmark_run_repo_id_status_started_at_idx" ON "benchmark_run"("repo_id", "status", "started_at");

-- CreateIndex
CREATE INDEX "benchmark_run_project_id_started_at_idx" ON "benchmark_run"("project_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "benchmark_scorecard_run_id_key" ON "benchmark_scorecard"("run_id");

-- CreateIndex
CREATE INDEX "benchmark_scorecard_pass_total_score_run_id_idx" ON "benchmark_scorecard"("pass", "total_score", "run_id");

-- CreateIndex
CREATE INDEX "benchmark_outcome_evidence_run_id_created_at_idx" ON "benchmark_outcome_evidence"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "challenge_candidate_status_model_plugin_id_created_at_idx" ON "challenge_candidate"("status", "model_plugin_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "provider_budget_projection_provider_id_key" ON "provider_budget_projection"("provider_id");

-- CreateIndex
CREATE INDEX "teacher_source_projection_source_type_active_idx" ON "teacher_source_projection"("source_type", "active");

-- CreateIndex
CREATE INDEX "policy_rationale_projection_aggregate_id_created_at_idx" ON "policy_rationale_projection"("aggregate_id", "created_at");

-- CreateIndex
CREATE INDEX "policy_rationale_projection_action_type_created_at_idx" ON "policy_rationale_projection"("action_type", "created_at");

-- CreateIndex
CREATE INDEX "knowledge_index_metadata_source_path_idx" ON "knowledge_index_metadata"("source", "path");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_templates_name_version_key" ON "prompt_templates"("name", "version");

-- CreateIndex
CREATE INDEX "prompt_experiments_template_id_metric_idx" ON "prompt_experiments"("template_id", "metric");

-- CreateIndex
CREATE INDEX "command_log_command_type_created_at_idx" ON "command_log"("command_type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "inference_backend_profile_backend_id_key" ON "inference_backend_profile"("backend_id");

-- CreateIndex
CREATE INDEX "inference_benchmark_run_profile_created_at_idx" ON "inference_benchmark_run"("profile", "created_at");

-- CreateIndex
CREATE INDEX "inference_benchmark_run_selected_created_at_idx" ON "inference_benchmark_run"("selected", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "model_plugin_registry_plugin_id_key" ON "model_plugin_registry"("plugin_id");

-- CreateIndex
CREATE INDEX "model_plugin_registry_provider_id_active_idx" ON "model_plugin_registry"("provider_id", "active");

-- CreateIndex
CREATE INDEX "distill_dataset_status_updated_at_idx" ON "distill_dataset"("status", "updated_at");

-- CreateIndex
CREATE INDEX "distill_example_dataset_id_reviewer_decision_idx" ON "distill_example"("dataset_id", "reviewer_decision");

-- CreateIndex
CREATE INDEX "distill_run_dataset_id_stage_status_idx" ON "distill_run"("dataset_id", "stage", "status");

-- CreateIndex
CREATE INDEX "distill_run_log_run_id_created_at_idx" ON "distill_run_log"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "distill_eval_run_run_id_created_at_idx" ON "distill_eval_run"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "model_artifact_registry_model_id_promoted_updated_at_idx" ON "model_artifact_registry"("model_id", "promoted", "updated_at");

-- AddForeignKey
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_parent_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "TicketComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAccountEvent" ADD CONSTRAINT "ProviderAccountEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ProviderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderUsageSample" ADD CONSTRAINT "ProviderUsageSample_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ProviderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_reservations" ADD CONSTRAINT "task_reservations_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "task_projection"("ticket_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distill_example" ADD CONSTRAINT "distill_example_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "distill_dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distill_run" ADD CONSTRAINT "distill_run_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "distill_dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distill_run_log" ADD CONSTRAINT "distill_run_log_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "distill_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distill_eval_run" ADD CONSTRAINT "distill_eval_run_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "distill_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;


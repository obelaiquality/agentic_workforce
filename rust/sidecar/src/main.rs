use std::pin::Pin;
use std::sync::Arc;
use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
};

use anyhow::{Context, Result};
use chrono::{DateTime, Duration, Utc};
use rand::distributions::WeightedIndex;
use rand::prelude::*;
use serde_json::{json, Value};
use tokio_postgres::{Client, NoTls};
use tonic::{transport::Server, Request, Response, Status};
use uuid::Uuid;

pub mod proto {
    tonic::include_proto!("agentic.v1");
}

use proto::control_plane_server::{ControlPlane, ControlPlaneServer};
use proto::{
    Ack, AgentHeartbeat, CommandEnvelope, DomainEvent, EventAck, IntakeRequest, PolicyDecision, PolicyInput,
    ReplayRequest, RoutingDecision, RoutingRequest, TaskAllocation,
};

#[derive(Clone)]
struct SidecarService {
    db: Arc<Client>,
    workspace_root: String,
}

impl SidecarService {
    async fn append_event_internal(&self, event: &CommandEnvelope) -> Result<String> {
        let event_id = if event.event_id.is_empty() {
            Uuid::new_v4().to_string()
        } else {
            event.event_id.clone()
        };

        let aggregate_id = if event.aggregate_id.is_empty() {
            String::new()
        } else {
            event.aggregate_id.clone()
        };
        let causation_id = if event.causation_id.is_empty() {
            String::new()
        } else {
            event.causation_id.clone()
        };
        let correlation_id = if event.correlation_id.is_empty() {
            String::new()
        } else {
            event.correlation_id.clone()
        };

        let payload_json: Value = if event.payload_json.trim().is_empty() {
            json!({})
        } else {
            serde_json::from_str(&event.payload_json).unwrap_or_else(|_| json!({ "raw": event.payload_json }))
        };

        let timestamp = if event.timestamp.is_empty() {
            Utc::now()
        } else {
            DateTime::parse_from_rfc3339(&event.timestamp)
                .map(|x| x.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now())
        };
        let timestamp_epoch_seconds = (timestamp.timestamp_micros() as f64) / 1_000_000.0;

        let schema_version = if event.schema_version <= 0 { 1 } else { event.schema_version };

        self.db
            .execute(
                "INSERT INTO event_log (event_id, aggregate_id, causation_id, correlation_id, actor, event_type, payload, schema_version, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, TO_TIMESTAMP($9))",
                &[
                    &event_id,
                    &aggregate_id,
                    &causation_id,
                    &correlation_id,
                    &event.actor,
                    &event.r#type,
                    &payload_json,
                    &schema_version,
                    &timestamp_epoch_seconds,
                ],
            )
            .await?;

        self.db
            .execute(
                "INSERT INTO event_outbox (event_id, topic, payload, published, created_at)
                 VALUES ($1, $2, $3::jsonb, false, NOW())",
                &[&event_id, &event.r#type, &payload_json],
            )
            .await?;

        if let Err(err) = self.apply_projection(&event.r#type, &aggregate_id, &payload_json).await {
            eprintln!(
                "projection update failed: event_type={} aggregate_id={} payload={} error={:?}",
                event.r#type,
                aggregate_id,
                payload_json,
                err
            );
            return Err(err).context("projection update failed");
        }

        Ok(event_id)
    }

    async fn apply_projection(&self, event_type: &str, aggregate_id: &str, payload: &Value) -> Result<()> {
        match event_type {
            "task.created" => {
                let ticket_id = payload
                    .get("ticket_id")
                    .and_then(Value::as_str)
                    .unwrap_or(aggregate_id)
                    .to_string();
                if ticket_id.is_empty() {
                    return Ok(());
                }

                let title = payload
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("Untitled Ticket")
                    .to_string();
                let description = payload
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let priority = payload
                    .get("priority")
                    .and_then(Value::as_str)
                    .unwrap_or("p2")
                    .to_string();
                let risk = payload.get("risk").and_then(Value::as_str).unwrap_or("medium").to_string();
                let acceptance = payload
                    .get("acceptance_criteria")
                    .cloned()
                    .unwrap_or_else(|| json!([]));
                let dependencies = payload
                    .get("dependencies")
                    .cloned()
                    .unwrap_or_else(|| json!([]));

                self.db
                    .execute(
                        "INSERT INTO task_projection (ticket_id, title, description, status, priority, risk, acceptance_criteria, dependencies, created_at, updated_at, last_transition_at)
                         VALUES ($1, $2, $3, 'inactive', $4, $5, $6::jsonb, $7::jsonb, NOW(), NOW(), NOW())
                         ON CONFLICT (ticket_id) DO UPDATE SET
                           title = EXCLUDED.title,
                           description = EXCLUDED.description,
                           priority = EXCLUDED.priority,
                           risk = EXCLUDED.risk,
                           acceptance_criteria = EXCLUDED.acceptance_criteria,
                           dependencies = EXCLUDED.dependencies,
                           updated_at = NOW()",
                        &[&ticket_id, &title, &description, &priority, &risk, &acceptance, &dependencies],
                    )
                    .await?;
            }
            "task.transition" => {
                let ticket_id = payload
                    .get("ticket_id")
                    .and_then(Value::as_str)
                    .unwrap_or(aggregate_id)
                    .to_string();
                if ticket_id.is_empty() {
                    return Ok(());
                }
                let status = payload
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("in_progress")
                    .to_string();
                let assignee = payload.get("agent_id").and_then(Value::as_str);
                self.db
                    .execute(
                        "UPDATE task_projection
                         SET status = ($2::text)::\"TaskLifecycleStatus\",
                             assignee_agent_id = COALESCE($3, assignee_agent_id),
                             updated_at = NOW(),
                             last_transition_at = NOW()
                         WHERE ticket_id = $1",
                        &[&ticket_id, &status, &assignee],
                    )
                    .await?;
            }
            "task.reserve" => {
                let ticket_id = payload
                    .get("ticket_id")
                    .and_then(Value::as_str)
                    .unwrap_or(aggregate_id)
                    .to_string();
                if ticket_id.is_empty() {
                    return Ok(());
                }
                let reserved_by = payload.get("agent_id").and_then(Value::as_str).unwrap_or("agent").to_string();
                let expires_at = payload
                    .get("reservation_expires_at")
                    .and_then(Value::as_str)
                    .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
                    .map(|v| v.with_timezone(&Utc))
                    .unwrap_or_else(|| Utc::now() + Duration::hours(4));

                self.db
                    .execute(
                        "INSERT INTO task_reservations (ticket_id, reserved_by, reserved_at, expires_at, reclaimed_at)
                         VALUES ($1, $2, NOW(), $3, NULL)
                         ON CONFLICT (ticket_id) DO UPDATE SET
                           reserved_by = EXCLUDED.reserved_by,
                           reserved_at = NOW(),
                           expires_at = EXCLUDED.expires_at,
                           reclaimed_at = NULL",
                        &[&ticket_id, &reserved_by, &expires_at],
                    )
                    .await?;

                self.db
                    .execute(
                        "UPDATE task_projection
                         SET status = 'reserved', assignee_agent_id = $2, updated_at = NOW(), last_transition_at = NOW()
                         WHERE ticket_id = $1",
                        &[&ticket_id, &reserved_by],
                    )
                    .await?;
            }
            "policy.decision" => {
                let approval_id = payload
                    .get("approval_id")
                    .and_then(Value::as_str)
                    .unwrap_or(aggregate_id)
                    .to_string();
                if approval_id.is_empty() {
                    return Ok(());
                }

                let action_type = payload
                    .get("action_type")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_string();
                let status = payload.get("status").and_then(Value::as_str).unwrap_or("pending").to_string();
                let reason = payload.get("reason").and_then(Value::as_str).map(ToString::to_string);

                self.db
                    .execute(
                        "INSERT INTO approval_projection (approval_id, action_type, status, reason, payload, requested_at, decided_at)
                         VALUES ($1, $2, ($3::text)::\"ApprovalStatus\", $4, $5::jsonb, NOW(), CASE WHEN ($3::text) IN ('approved','rejected') THEN NOW() ELSE NULL END)
                         ON CONFLICT (approval_id) DO UPDATE SET
                           status = EXCLUDED.status,
                           reason = EXCLUDED.reason,
                           payload = EXCLUDED.payload,
                           decided_at = EXCLUDED.decided_at",
                        &[&approval_id, &action_type, &status, &reason, &payload],
                    )
                    .await?;
            }
            "provider.activated" => {
                let provider_id = payload
                    .get("provider_id")
                    .and_then(Value::as_str)
                    .unwrap_or("qwen-cli")
                    .to_string();
                self.db
                    .execute(
                        "INSERT INTO provider_account_projection (account_id, provider_id, state, quota_eta_confidence, metadata, last_seen_at)
                         VALUES ('active-provider', $1, 'ready', 0, $2::jsonb, NOW())
                         ON CONFLICT (account_id) DO UPDATE SET
                           provider_id = EXCLUDED.provider_id,
                           metadata = EXCLUDED.metadata,
                           last_seen_at = NOW()",
                        &[&provider_id, &payload],
                    )
                    .await?;
            }
            "execution.requested" => {
                let run_id = payload
                    .get("run_id")
                    .and_then(Value::as_str)
                    .unwrap_or(aggregate_id)
                    .to_string();
                if run_id.is_empty() {
                    return Ok(());
                }

                let ticket_id = payload.get("ticket_id").and_then(Value::as_str).map(ToString::to_string);
                let status = payload.get("status").and_then(Value::as_str).unwrap_or("queued").to_string();
                let provider_id = payload.get("provider_id").and_then(Value::as_str).map(ToString::to_string);

                self.db
                    .execute(
                        "INSERT INTO run_projection (run_id, ticket_id, status, provider_id, metadata, started_at, created_at, updated_at)
                         VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW(), NOW())
                         ON CONFLICT (run_id) DO UPDATE SET
                           status = EXCLUDED.status,
                           provider_id = COALESCE(EXCLUDED.provider_id, run_projection.provider_id),
                           metadata = EXCLUDED.metadata,
                           updated_at = NOW()",
                        &[&run_id, &ticket_id, &status, &provider_id, &payload],
                    )
                    .await?;
            }
            _ => {}
        }

        Ok(())
    }

    fn evaluate_policy_internal(&self, input: &PolicyInput) -> PolicyDecision {
        let mut reasons: Vec<String> = Vec::new();
        let mut required_scopes: Vec<String> = Vec::new();
        let action = input.action_type.to_lowercase();
        let risk = input.risk_level.to_lowercase();

        let dangerous_actions = ["provider_change", "file_apply", "run_command", "delete"];

        if !input.workspace_path.is_empty()
            && input.workspace_path.starts_with('/')
            && !input.workspace_path.starts_with(&self.workspace_root)
        {
            reasons.push("workspace path is outside allowed workspace root".to_string());
            return PolicyDecision {
                decision: "deny".to_string(),
                requires_approval: false,
                reasons,
                required_scopes,
                policy_version: "v2-hard-1".to_string(),
            };
        }

        if input.workspace_path.contains("..") {
            reasons.push("workspace path traversal is blocked".to_string());
            return PolicyDecision {
                decision: "deny".to_string(),
                requires_approval: false,
                reasons,
                required_scopes,
                policy_version: "v2-hard-1".to_string(),
            };
        }

        if input.dry_run {
            reasons.push("dry-run policy mode".to_string());
            return PolicyDecision {
                decision: "allow".to_string(),
                requires_approval: false,
                reasons,
                required_scopes,
                policy_version: "v2-hard-1".to_string(),
            };
        }

        if action == "delete" && risk == "high" {
            reasons.push("high-risk delete operation is denied by hard policy".to_string());
            return PolicyDecision {
                decision: "deny".to_string(),
                requires_approval: false,
                reasons,
                required_scopes,
                policy_version: "v2-hard-1".to_string(),
            };
        }

        if dangerous_actions.contains(&action.as_str()) {
            reasons.push("action class requires explicit approval".to_string());
            required_scopes.push(format!("approve:{}", action));
            return PolicyDecision {
                decision: "allow".to_string(),
                requires_approval: true,
                reasons,
                required_scopes,
                policy_version: "v2-hard-1".to_string(),
            };
        }

        reasons.push("policy checks passed".to_string());
        PolicyDecision {
            decision: "allow".to_string(),
            requires_approval: false,
            reasons,
            required_scopes,
            policy_version: "v2-hard-1".to_string(),
        }
    }

    async fn allocate_task_internal(&self, input: &IntakeRequest) -> Result<TaskAllocation> {
        self.db
            .execute(
                "UPDATE task_reservations
                 SET reclaimed_at = NOW()
                 WHERE reclaimed_at IS NULL
                   AND expires_at <= NOW()",
                &[],
            )
            .await?;

        let rows = self
            .db
            .query(
                "SELECT t.ticket_id, t.priority, t.updated_at
                 FROM task_projection t
                 WHERE t.status IN ('inactive', 'active')
                   AND NOT EXISTS (
                     SELECT 1 FROM task_reservations r
                     WHERE r.ticket_id = t.ticket_id
                       AND r.reclaimed_at IS NULL
                       AND r.expires_at > NOW()
                   )
                 ORDER BY t.updated_at ASC",
                &[],
            )
            .await?;

        if rows.is_empty() {
            return Ok(TaskAllocation {
                found: false,
                ticket_id: String::new(),
                strategy: input.strategy.clone(),
                score: 0.0,
                reservation_expires_at: String::new(),
                message: "no allocatable task".to_string(),
            });
        }

        let mut selected_index = 0usize;
        if input.strategy == "weighted-random-next" {
            let weights: Vec<u32> = rows
                .iter()
                .map(|row| {
                    let priority: String = row.get("priority");
                    match priority.as_str() {
                        "p0" => 8,
                        "p1" => 5,
                        "p2" => 3,
                        _ => 1,
                    }
                })
                .collect();

            let distribution = WeightedIndex::new(&weights)?;
            let mut rng = if input.seed.is_empty() {
                StdRng::from_entropy()
            } else {
                let mut hasher = DefaultHasher::new();
                input.seed.hash(&mut hasher);
                let seed = hasher.finish();
                StdRng::seed_from_u64(seed)
            };
            selected_index = distribution.sample(&mut rng);
        }

        let row = &rows[selected_index];
        let ticket_id: String = row.get("ticket_id");
        let priority: String = row.get("priority");

        let ttl = if input.reservation_ttl_seconds <= 0 {
            4 * 60 * 60
        } else {
            input.reservation_ttl_seconds
        };

        let expires_at = Utc::now() + Duration::seconds(ttl as i64);

        self.db
            .execute(
                "INSERT INTO task_reservations (ticket_id, reserved_by, reserved_at, expires_at, reclaimed_at)
                 VALUES ($1, $2, NOW(), $3, NULL)
                 ON CONFLICT (ticket_id) DO UPDATE SET
                   reserved_by = EXCLUDED.reserved_by,
                   reserved_at = NOW(),
                   expires_at = EXCLUDED.expires_at,
                   reclaimed_at = NULL",
                &[&ticket_id, &input.actor, &expires_at],
            )
            .await?;

        self.db
            .execute(
                "UPDATE task_projection
                 SET status = 'reserved', assignee_agent_id = $2, updated_at = NOW(), last_transition_at = NOW()
                 WHERE ticket_id = $1",
                &[&ticket_id, &input.actor],
            )
            .await?;

        let reserve_event = CommandEnvelope {
            event_id: Uuid::new_v4().to_string(),
            aggregate_id: ticket_id.clone(),
            causation_id: String::new(),
            correlation_id: String::new(),
            actor: input.actor.clone(),
            timestamp: Utc::now().to_rfc3339(),
            r#type: "task.reserve".to_string(),
            payload_json: json!({
                "ticket_id": ticket_id,
                "agent_id": input.actor,
                "reservation_expires_at": expires_at.to_rfc3339(),
                "strategy": input.strategy,
            })
            .to_string(),
            schema_version: 1,
        };
        let _ = self.append_event_internal(&reserve_event).await;

        let score = match priority.as_str() {
            "p0" => 1.0,
            "p1" => 0.75,
            "p2" => 0.5,
            _ => 0.25,
        };

        Ok(TaskAllocation {
            found: true,
            ticket_id,
            strategy: input.strategy.clone(),
            score,
            reservation_expires_at: expires_at.to_rfc3339(),
            message: "task allocated".to_string(),
        })
    }

    fn plan_route_internal(&self, input: &RoutingRequest) -> RoutingDecision {
        let prompt = input.prompt.to_lowercase();
        let risk = if input.risk_level.eq_ignore_ascii_case("high")
            || ["security", "delete", "production", "migrate", "approval", "architecture", "incident"]
                .iter()
                .any(|needle| prompt.contains(needle))
        {
            "high"
        } else if input.risk_level.eq_ignore_ascii_case("medium")
            || ["review", "refactor", "database", "policy", "provider", "merge", "parallel"]
                .iter()
                .any(|needle| prompt.contains(needle))
        {
            "medium"
        } else {
            "low"
        };

        let research_like = ["research", "benchmark", "compare", "evaluate", "synthesize", "survey"]
            .iter()
            .any(|needle| prompt.contains(needle));
        let utility_like = ["summarize", "classify", "tag", "extract", "triage"]
            .iter()
            .any(|needle| prompt.contains(needle));
        let review_like = ["review", "verify", "audit", "check", "regression"]
            .iter()
            .any(|needle| prompt.contains(needle));

        let mut decomposition_score = 0.12_f64;
        if ["parallel", "simultaneous", "multiple", "across", "split", "several"]
            .iter()
            .any(|needle| prompt.contains(needle))
        {
            decomposition_score += 0.28;
        }
        if research_like {
            decomposition_score += 0.18;
        }
        if input.retrieval_context_count >= 3 {
            decomposition_score += 0.12;
        }
        if input.active_files_count >= 4 {
            decomposition_score += 0.12;
        }

        let mut estimated_file_overlap: f64 = if input.active_files_count <= 1 { 0.45 } else { 0.22 };
        if ["same file", "core module", "shared", "common path", "single component"]
            .iter()
            .any(|needle| prompt.contains(needle))
        {
            estimated_file_overlap += 0.18;
        }
        if research_like {
            estimated_file_overlap -= 0.08;
        }
        estimated_file_overlap = estimated_file_overlap.clamp(0.05, 0.95);

        let execution_mode = if research_like {
            "research_swarm"
        } else if decomposition_score >= 0.58 && estimated_file_overlap < 0.30 {
            "centralized_parallel"
        } else {
            "single_agent"
        };

        let max_lanes = match execution_mode {
            "research_swarm" => 4,
            "centralized_parallel" => 3,
            _ => 1,
        };

        let (provider_id, model_role) = if risk == "high" || prompt.contains("escalate") {
            ("openai-responses", "overseer_escalation")
        } else if utility_like {
            ("onprem-qwen", "utility_fast")
        } else if review_like {
            ("onprem-qwen", "review_deep")
        } else {
            ("onprem-qwen", "coder_default")
        };

        let verification_depth = if risk == "high" || execution_mode != "single_agent" {
            "deep"
        } else if risk == "medium" {
            "standard"
        } else {
            "light"
        };

        let mut rationale: Vec<String> = Vec::new();
        rationale.push(format!("risk classified as {}", risk));
        rationale.push(format!("decomposition score {:.2}", decomposition_score));
        rationale.push(format!("estimated file overlap {:.2}", estimated_file_overlap));
        rationale.push(format!("execution mode {}", execution_mode));
        rationale.push(format!("provider {} model role {}", provider_id, model_role));

        RoutingDecision {
            execution_mode: execution_mode.to_string(),
            model_role: model_role.to_string(),
            provider_id: provider_id.to_string(),
            max_lanes,
            risk: risk.to_string(),
            verification_depth: verification_depth.to_string(),
            decomposition_score,
            estimated_file_overlap,
            rationale,
        }
    }
}

type ReplayStream = Pin<Box<dyn futures_core::Stream<Item = Result<DomainEvent, Status>> + Send + 'static>>;

#[tonic::async_trait]
impl ControlPlane for SidecarService {
    async fn append_event(&self, request: Request<CommandEnvelope>) -> Result<Response<EventAck>, Status> {
        let command = request.into_inner();
        match self.append_event_internal(&command).await {
            Ok(event_id) => Ok(Response::new(EventAck {
                ok: true,
                event_id,
                message: "event appended".to_string(),
            })),
            Err(err) => Err(Status::internal(err.to_string())),
        }
    }

    type ReplayStream = ReplayStream;

    async fn replay(&self, request: Request<ReplayRequest>) -> Result<Response<Self::ReplayStream>, Status> {
        let req = request.into_inner();
        let limit = if req.limit <= 0 { 500 } else { req.limit };
        let from_ts = if req.from_timestamp.trim().is_empty() {
            None
        } else {
            DateTime::parse_from_rfc3339(&req.from_timestamp)
                .ok()
                .map(|ts| ts.with_timezone(&Utc))
        };
        let to_ts = if req.to_timestamp.trim().is_empty() {
            None
        } else {
            DateTime::parse_from_rfc3339(&req.to_timestamp)
                .ok()
                .map(|ts| ts.with_timezone(&Utc))
        };

        let rows = match (req.aggregate_id.is_empty(), from_ts, to_ts) {
            (true, Some(from), Some(to)) => {
                self.db
                    .query(
                        "SELECT event_id, aggregate_id, causation_id, correlation_id, actor, event_type, payload::text, schema_version, created_at
                         FROM event_log
                         WHERE created_at >= $1 AND created_at <= $2
                         ORDER BY created_at ASC
                         LIMIT $3",
                        &[&from, &to, &limit],
                    )
                    .await
                    .map_err(|err| Status::internal(err.to_string()))?
            }
            (true, Some(from), None) => {
                self.db
                    .query(
                        "SELECT event_id, aggregate_id, causation_id, correlation_id, actor, event_type, payload::text, schema_version, created_at
                         FROM event_log
                         WHERE created_at >= $1
                         ORDER BY created_at ASC
                         LIMIT $2",
                        &[&from, &limit],
                    )
                    .await
                    .map_err(|err| Status::internal(err.to_string()))?
            }
            (true, None, Some(to)) => {
                self.db
                    .query(
                        "SELECT event_id, aggregate_id, causation_id, correlation_id, actor, event_type, payload::text, schema_version, created_at
                         FROM event_log
                         WHERE created_at <= $1
                         ORDER BY created_at ASC
                         LIMIT $2",
                        &[&to, &limit],
                    )
                    .await
                    .map_err(|err| Status::internal(err.to_string()))?
            }
            (true, None, None) => {
                self.db
                    .query(
                        "SELECT event_id, aggregate_id, causation_id, correlation_id, actor, event_type, payload::text, schema_version, created_at
                         FROM event_log
                         ORDER BY created_at ASC
                         LIMIT $1",
                        &[&limit],
                    )
                    .await
                    .map_err(|err| Status::internal(err.to_string()))?
            }
            (false, Some(from), Some(to)) => {
                self.db
                    .query(
                        "SELECT event_id, aggregate_id, causation_id, correlation_id, actor, event_type, payload::text, schema_version, created_at
                         FROM event_log
                         WHERE aggregate_id = $1
                           AND created_at >= $2
                           AND created_at <= $3
                         ORDER BY created_at ASC
                         LIMIT $4",
                        &[&req.aggregate_id, &from, &to, &limit],
                    )
                    .await
                    .map_err(|err| Status::internal(err.to_string()))?
            }
            (false, Some(from), None) => {
                self.db
                    .query(
                        "SELECT event_id, aggregate_id, causation_id, correlation_id, actor, event_type, payload::text, schema_version, created_at
                         FROM event_log
                         WHERE aggregate_id = $1
                           AND created_at >= $2
                         ORDER BY created_at ASC
                         LIMIT $3",
                        &[&req.aggregate_id, &from, &limit],
                    )
                    .await
                    .map_err(|err| Status::internal(err.to_string()))?
            }
            (false, None, Some(to)) => {
                self.db
                    .query(
                        "SELECT event_id, aggregate_id, causation_id, correlation_id, actor, event_type, payload::text, schema_version, created_at
                         FROM event_log
                         WHERE aggregate_id = $1
                           AND created_at <= $2
                         ORDER BY created_at ASC
                         LIMIT $3",
                        &[&req.aggregate_id, &to, &limit],
                    )
                    .await
                    .map_err(|err| Status::internal(err.to_string()))?
            }
            (false, None, None) => {
                self.db
                    .query(
                        "SELECT event_id, aggregate_id, causation_id, correlation_id, actor, event_type, payload::text, schema_version, created_at
                         FROM event_log
                         WHERE aggregate_id = $1
                         ORDER BY created_at ASC
                         LIMIT $2",
                        &[&req.aggregate_id, &limit],
                    )
                    .await
                    .map_err(|err| Status::internal(err.to_string()))?
            }
        };

        let events: Vec<Result<DomainEvent, Status>> = rows
            .into_iter()
            .map(|row| {
                Ok(DomainEvent {
                    event_id: row.get("event_id"),
                    aggregate_id: row.get("aggregate_id"),
                    causation_id: row.get("causation_id"),
                    correlation_id: row.get("correlation_id"),
                    actor: row.get("actor"),
                    timestamp: {
                        let ts: DateTime<Utc> = row.get("created_at");
                        ts.to_rfc3339()
                    },
                    r#type: row.get("event_type"),
                    payload_json: row.get("payload"),
                    schema_version: row.get::<_, i32>("schema_version"),
                })
            })
            .collect();

        let output = tokio_stream::iter(events);
        Ok(Response::new(Box::pin(output) as Self::ReplayStream))
    }

    async fn evaluate_policy(&self, request: Request<PolicyInput>) -> Result<Response<PolicyDecision>, Status> {
        let input = request.into_inner();
        Ok(Response::new(self.evaluate_policy_internal(&input)))
    }

    async fn allocate_task(&self, request: Request<IntakeRequest>) -> Result<Response<TaskAllocation>, Status> {
        let input = request.into_inner();
        match self.allocate_task_internal(&input).await {
            Ok(result) => Ok(Response::new(result)),
            Err(err) => Err(Status::internal(err.to_string())),
        }
    }

    async fn plan_route(&self, request: Request<RoutingRequest>) -> Result<Response<RoutingDecision>, Status> {
        let input = request.into_inner();
        Ok(Response::new(self.plan_route_internal(&input)))
    }

    async fn heartbeat(&self, request: Request<AgentHeartbeat>) -> Result<Response<Ack>, Status> {
        let hb = request.into_inner();

        let metadata: Value = if hb.metadata_json.trim().is_empty() {
            json!({})
        } else {
            serde_json::from_str(&hb.metadata_json).unwrap_or_else(|_| json!({ "raw": hb.metadata_json }))
        };

        self.db
            .execute(
                "INSERT INTO agent_heartbeats (agent_id, status, summary, metadata, last_seen_at, created_at)
                 VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())
                 ON CONFLICT (agent_id) DO UPDATE SET
                   status = EXCLUDED.status,
                   summary = EXCLUDED.summary,
                   metadata = EXCLUDED.metadata,
                   last_seen_at = NOW()",
                &[&hb.agent_id, &hb.status, &hb.summary, &metadata],
            )
            .await
            .map_err(|err| Status::internal(err.to_string()))?;

        Ok(Response::new(Ack {
            ok: true,
            message: "heartbeat accepted".to_string(),
        }))
    }
}

async fn initialize_schema(client: &Client) -> Result<()> {
    client
        .batch_execute(
            "
            CREATE TABLE IF NOT EXISTS event_log (
              event_id TEXT PRIMARY KEY,
              aggregate_id TEXT NOT NULL,
              causation_id TEXT NOT NULL,
              correlation_id TEXT NOT NULL,
              actor TEXT NOT NULL,
              event_type TEXT NOT NULL,
              payload JSONB NOT NULL,
              schema_version INTEGER NOT NULL DEFAULT 1,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS event_log_aggregate_created_idx ON event_log (aggregate_id, created_at);

            CREATE TABLE IF NOT EXISTS event_outbox (
              id BIGSERIAL PRIMARY KEY,
              event_id TEXT NOT NULL,
              topic TEXT NOT NULL,
              payload JSONB NOT NULL,
              published BOOLEAN NOT NULL DEFAULT FALSE,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS task_projection (
              ticket_id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              description TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL,
              priority TEXT NOT NULL DEFAULT 'p2',
              risk TEXT NOT NULL DEFAULT 'medium',
              acceptance_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
              dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
              assignee_agent_id TEXT,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              last_transition_at TIMESTAMPTZ
            );

            CREATE TABLE IF NOT EXISTS task_reservations (
              ticket_id TEXT PRIMARY KEY,
              reserved_by TEXT NOT NULL,
              reserved_at TIMESTAMPTZ NOT NULL,
              expires_at TIMESTAMPTZ NOT NULL,
              reclaimed_at TIMESTAMPTZ
            );

            CREATE TABLE IF NOT EXISTS run_projection (
              run_id TEXT PRIMARY KEY,
              ticket_id TEXT,
              status TEXT NOT NULL,
              provider_id TEXT,
              metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
              started_at TIMESTAMPTZ,
              ended_at TIMESTAMPTZ,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS provider_account_projection (
              account_id TEXT PRIMARY KEY,
              provider_id TEXT NOT NULL,
              state TEXT NOT NULL,
              quota_next_usable_at TIMESTAMPTZ,
              quota_eta_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
              metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
              last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS approval_projection (
              approval_id TEXT PRIMARY KEY,
              action_type TEXT NOT NULL,
              status TEXT NOT NULL,
              reason TEXT,
              payload JSONB NOT NULL,
              requested_at TIMESTAMPTZ NOT NULL,
              decided_at TIMESTAMPTZ
            );

            CREATE TABLE IF NOT EXISTS agent_heartbeats (
              agent_id TEXT PRIMARY KEY,
              status TEXT NOT NULL,
              summary TEXT,
              metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
              last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            ",
        )
        .await
        .context("failed to initialize sidecar schema")?;

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let address = std::env::var("RUST_SIDECAR_ADDR").unwrap_or_else(|_| "127.0.0.1:50051".to_string());
    let database_url_raw = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://agentic:agentic@localhost:5433/agentic_workforce".to_string());
    let database_url = match database_url_raw.split_once('?') {
        Some((base, _)) => base.to_string(),
        None => database_url_raw,
    };
    let workspace_root = std::env::var("WORKSPACE_ROOT").unwrap_or_else(|_| {
        std::env::current_dir()
            .ok()
            .map(|v| v.to_string_lossy().to_string())
            .unwrap_or_else(|| "/".to_string())
    });

    let (client, connection) = tokio_postgres::connect(&database_url, NoTls)
        .await
        .context("failed to connect postgres from sidecar")?;

    tokio::spawn(async move {
        if let Err(err) = connection.await {
            eprintln!("postgres connection error: {err}");
        }
    });

    initialize_schema(&client).await?;

    let service = SidecarService {
        db: Arc::new(client),
        workspace_root,
    };

    println!("agentic-sidecar listening on {}", &address);

    Server::builder()
        .add_service(ControlPlaneServer::new(service))
        .serve(address.parse()?)
        .await
        .context("sidecar server failed")?;

    Ok(())
}

#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  log: ["warn", "error"],
});

const EXAMPLES = [
  {
    spec: {
      specId: "gpt5-agentic-001",
      intent: "Fix duplicate or stale token streaming in the Overseer chat renderer without changing the server protocol.",
      inputs: ["chat session state", "SSE event stream", "selected session id", "recent regression report"],
      constraints: ["retrieval-first", "smallest-diff-first", "no protocol drift", "preserve current UI language"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["stream-order-check", "session-switch-regression", "type-check"],
      expectedArtifacts: ["patch", "verification notes", "citations"],
      riskClass: "medium",
    },
    citations: [
      "retrieval://overseer-stream-architecture",
      "retrieval://renderer-state-patterns",
      "policy://safe-ui-patch",
    ],
    teacherOutput: `Summary:
- Read the stream consumer and session-selection flow before editing. The likely failure mode is stale subscription state or token buffering attached to the wrong session.

Steps:
1. Inspect the chat stream subscriber, the selected-session store, and the cleanup path when switching sessions.
2. Confirm whether the handler closes the old EventSource and whether token state is reset only for the active session.
3. Keep the patch inside the renderer first. Do not touch the server protocol unless logs prove the server emits duplicate events.
4. Prefer a stable live handler pattern so the listener sees current session state without re-binding on every token.
5. Add a regression test or lightweight harness that simulates: start stream, switch session, old stream emits again, UI ignores it.

Checks:
- Tokens append in order for one active session.
- Switching sessions unsubscribes the old stream.
- No duplicate assistant message appears after reconnect.
- Type-check passes.

Artifacts:
- Minimal renderer patch.
- Regression test summary.
- Short note describing why server changes were not needed.

Rollback:
- Revert only the stream-consumer patch if token rendering stalls or cross-session updates disappear.

Citations:
- retrieval://overseer-stream-architecture
- retrieval://renderer-state-patterns`,
  },
  {
    spec: {
      specId: "gpt5-agentic-002",
      intent: "Close a workspace path escape in file-apply operations and force approval for risky write scopes.",
      inputs: ["policy engine", "workspace root", "file apply request", "audit requirements"],
      constraints: ["hard-policy", "no silent bypass", "workspace-only writes", "append audit event"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["path-normalization-test", "deny-escape-test", "approval-required-test"],
      expectedArtifacts: ["patch", "tests", "audit note"],
      riskClass: "high",
    },
    citations: [
      "retrieval://policy-engine-rules",
      "retrieval://workspace-path-constraints",
      "policy://file-apply",
    ],
    teacherOutput: `Summary:
- Treat every file-apply request as untrusted input. Normalize the target path against the active workspace root and deny any request that escapes it.

Steps:
1. Read the file-apply command path and identify where raw user or model paths are accepted.
2. Resolve candidate paths with realpath or normalized absolute-path logic anchored to the workspace root.
3. Deny if the resolved path is outside the workspace or if symlink resolution escapes the root.
4. For high-risk write scopes, return requires_approval instead of auto-executing.
5. Persist the denial or approval-needed decision as an immutable audit event with rule id and rationale.

Checks:
- Path like ../secret.txt is denied.
- Symlink escape is denied.
- In-workspace patch still succeeds.
- High-risk write request produces approval-required result.

Artifacts:
- Guard patch.
- Focused policy tests.
- Audit event sample in verification notes.

Rollback:
- If valid in-workspace writes start failing, keep the deny logic and narrow only the normalization edge case with a follow-up fix.

Citations:
- retrieval://policy-engine-rules
- retrieval://workspace-path-constraints`,
  },
  {
    spec: {
      specId: "gpt5-agentic-003",
      intent: "Make backlog board moves optimistic but safe under server conflict and stale reservation state.",
      inputs: ["kanban board state", "task reservation projection", "task move endpoint", "UI interaction traces"],
      constraints: ["optimistic-ui", "rollback-on-conflict", "preserve reservation badges", "no visual flicker"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["optimistic-move-test", "conflict-rollback-test", "reservation-visibility-check"],
      expectedArtifacts: ["patch", "test notes", "citations"],
      riskClass: "medium",
    },
    citations: [
      "retrieval://kanban-interaction-flow",
      "retrieval://task-reservation-projection",
    ],
    teacherOutput: `Summary:
- Update the board immediately on drag-drop, but keep enough previous state to roll back cleanly when the command endpoint rejects or a reservation changed underneath the UI.

Steps:
1. Read the mutation path for task transitions and identify where the optimistic patch is currently applied.
2. Snapshot the previous board column state before mutating local cache.
3. Move the card visually at once, including reservation and assignee metadata, so the board feels instant.
4. On server conflict or policy rejection, restore the previous cache snapshot and surface a small conflict message.
5. Do not drop stale-reservation badges during the optimistic move. The card metadata should move with the card.

Checks:
- Drag from backlog to ready updates instantly.
- Simulated conflict restores the original column and order.
- Reservation badge remains visible before and after move.
- No extra fetch loop or flicker appears.

Artifacts:
- Board mutation patch.
- Conflict rollback test.
- Short UX verification note.

Citations:
- retrieval://kanban-interaction-flow
- retrieval://task-reservation-projection`,
  },
  {
    spec: {
      specId: "gpt5-agentic-004",
      intent: "Handle provider quota exhaustion by switching accounts cleanly and preserving session continuity.",
      inputs: ["provider adapter", "account health projection", "canonical chat state", "stderr classifier"],
      constraints: ["no user-visible context loss", "emit switch events", "cooldown tracked", "stream resumes"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["quota-classifier-test", "failover-sequence-test", "session-continuity-check"],
      expectedArtifacts: ["patch", "event trace", "citations"],
      riskClass: "high",
    },
    citations: [
      "retrieval://provider-failover-flow",
      "retrieval://quota-event-schema",
      "policy://provider-change",
    ],
    teacherOutput: `Summary:
- The user should not lose conversation state when an account hits quota. Store the canonical conversation in the app, mark the account unavailable, and resume on the next healthy account.

Steps:
1. Tighten error classification so hard quota and rate-limit failures are separated from generic provider errors.
2. When quota is hit, mark the current account cooldown state and emit account.exhausted.
3. Select the next ready account deterministically and emit account.switched with old/new ids.
4. Rehydrate the same conversation messages from the canonical store before continuing generation.
5. Keep the UI informed with a small non-blocking event rather than dropping the stream silently.

Checks:
- Quota stderr fixture maps to quota_exhausted or rate_limited correctly.
- Failover emits exhausted then switched events in order.
- Same conversation messages are present after switch.
- Stream resumes without the user resending the prompt.

Artifacts:
- Adapter/orchestrator patch.
- Event-trace note.
- Focused tests for classifier and continuity.

Rollback:
- If auto-switch is unstable, keep cooldown tracking but disable automatic continuation until selection logic is fixed.

Citations:
- retrieval://provider-failover-flow
- retrieval://quota-event-schema`,
  },
  {
    spec: {
      specId: "gpt5-agentic-005",
      intent: "Add replay parity verification for task projections derived from the canonical event log.",
      inputs: ["event log", "task projection", "replay API", "seeded scenario"],
      constraints: ["deterministic", "append-only truth", "no direct write shortcuts", "projection parity required"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["replay-parity-test", "seeded-determinism-test", "query-latency-check"],
      expectedArtifacts: ["patch", "parity report", "citations"],
      riskClass: "medium",
    },
    citations: [
      "retrieval://event-envelope-schema",
      "retrieval://projection-replay-contract",
    ],
    teacherOutput: `Summary:
- Build parity verification around the event stream, not around mutable table snapshots. The replay path should reconstruct the same task projection for a seeded scenario.

Steps:
1. Read the event envelope and the current task projection derivation path.
2. Add a replay helper that folds the ordered task events into an in-memory projection.
3. Compare the replayed state against the persisted projection for seeded test scenarios.
4. Expose mismatches as a test failure with the aggregate id and first divergent field.
5. Keep query endpoints reading the projection table for speed; replay is for verification and audit.

Checks:
- Seeded sequence reproduces the same final status, assignee, and reservation timestamps.
- Out-of-order events are rejected or sorted by canonical ordering rules.
- Replay API remains read-only.

Artifacts:
- Replay verifier.
- Determinism test.
- Short parity summary for the run.

Citations:
- retrieval://event-envelope-schema
- retrieval://projection-replay-contract`,
  },
  {
    spec: {
      specId: "gpt5-agentic-006",
      intent: "Strengthen distillation review gates so unsafe or low-signal teacher samples never enter training.",
      inputs: ["distill dataset", "privacy scanner", "review decisions", "teacher quota metadata"],
      constraints: ["privacy-safe-default", "no auto-approval for fallback outputs", "keep provenance", "human-review-ready"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["fallback-needs-edit-test", "privacy-reject-test", "provenance-persist-test"],
      expectedArtifacts: ["patch", "tests", "citations"],
      riskClass: "medium",
    },
    citations: [
      "retrieval://distill-review-policy",
      "retrieval://privacy-scan-contract",
    ],
    teacherOutput: `Summary:
- Distillation quality is mostly won or lost at the review gate. Fallback, rate-limited, or privacy-redacted samples should never slide into approved training data by accident.

Steps:
1. Read dataset generation, privacy scanning, and review decision logic together.
2. Force all fallback teacher outputs to land as needs_edit, even if the text looks plausible.
3. Reject any sample that still contains secret-like or path-sensitive content after redaction.
4. Persist provenance fields needed later: teacher source, error class, retrieval ids, and review timestamp.
5. Keep the approval queue small and obvious in the UI so an operator can batch-approve only safe pending items.

Checks:
- Fallback sample does not count toward approved examples.
- Privacy scanner rejection marks reviewedAt and keeps rationale in metadata.
- Provenance survives export into the run manifest.

Artifacts:
- Distill review patch.
- Tests for fallback and privacy paths.
- Verification note describing approval counts.

Citations:
- retrieval://distill-review-policy
- retrieval://privacy-scan-contract`,
  },
  {
    spec: {
      specId: "gpt5-agentic-007",
      intent: "Stabilize the critical Playwright flow for streaming chat, backlog moves, and distill kickoff.",
      inputs: ["Playwright runner", "desktop shell", "streaming UI", "artifact output directory"],
      constraints: ["reproducible", "real runtime in loop", "artifact capture required", "avoid brittle selectors"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["critical-flow-pass", "artifact-output-check", "selector-stability-check"],
      expectedArtifacts: ["patch", "screenshots", "summary json"],
      riskClass: "medium",
    },
    citations: [
      "retrieval://playwright-runner-contract",
      "retrieval://desktop-e2e-flow",
    ],
    teacherOutput: `Summary:
- Fix the E2E flow by synchronizing on product state, not raw timing. Streaming chat and distill kickoff are stateful; selectors alone are not enough.

Steps:
1. Read the current Playwright runner and identify where fixed sleeps or fragile text selectors are used.
2. Wait on durable UI markers: tab visibility, stream-state chip changes, dataset id presence, run id presence.
3. Capture artifacts after each major phase: shell loaded, settings confirmed, chat reply, ticket moved, distill started.
4. Keep retries narrow. Retry snapshot lookup after DOM transitions, not the entire scenario.
5. Write a final summary json that records pass/fail per phase and the generated ids.

Checks:
- Critical flow completes without manual intervention.
- Artifact folder contains yaml, png, and summary json.
- Stream step waits for actual assistant output rather than an arbitrary timeout.

Artifacts:
- Playwright runner patch.
- Reproducible artifact bundle.
- Concise failure signatures in summary json.

Citations:
- retrieval://playwright-runner-contract
- retrieval://desktop-e2e-flow`,
  },
  {
    spec: {
      specId: "gpt5-agentic-008",
      intent: "Extend the provider or backend factory without leaking provider-specific logic into orchestration.",
      inputs: ["provider factory", "backend descriptors", "orchestration service", "capability map"],
      constraints: ["factory-boundary", "no UI rewrite", "capability-driven routing", "contract-tested"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["factory-resolution-test", "contract-test", "capability-routing-check"],
      expectedArtifacts: ["patch", "test summary", "citations"],
      riskClass: "low",
    },
    citations: [
      "retrieval://provider-factory-contract",
      "retrieval://backend-capability-map",
    ],
    teacherOutput: `Summary:
- Keep provider-specific behavior inside adapters. The orchestration layer should talk in terms of capabilities, not vendor conditions.

Steps:
1. Read the provider factory, backend registry, and orchestrator call sites together.
2. Add the new provider or backend by implementing the shared adapter contract only.
3. Expose capabilities like streaming, tools, json_mode, and max_context through the adapter descriptor.
4. Route behavior off capability checks rather than hard-coded provider ids.
5. Add one contract-style integration test so future adapters must satisfy the same behavior surface.

Checks:
- Factory resolves the new adapter by id.
- Orchestrator can send or stream without provider-specific branching.
- Capability map influences routing decisions as expected.

Artifacts:
- Adapter implementation.
- Contract test.
- Short note explaining why orchestration stayed provider-agnostic.

Citations:
- retrieval://provider-factory-contract
- retrieval://backend-capability-map`,
  },
  {
    spec: {
      specId: "gpt5-agentic-009",
      intent: "Reduce board query latency for 10k-ticket scenarios without abandoning the projection model.",
      inputs: ["task_projection table", "board query path", "expected scale target", "current p95 latency"],
      constraints: ["projection-read-path", "no denormalized chaos", "index-first", "measure before and after"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["query-plan-check", "latency-benchmark", "correctness-regression"],
      expectedArtifacts: ["patch", "benchmark note", "citations"],
      riskClass: "medium",
    },
    citations: [
      "retrieval://board-query-shape",
      "retrieval://projection-index-guidance",
    ],
    teacherOutput: `Summary:
- Treat board latency as a read-model problem. Start with query shape and indexes before inventing a new cache.

Steps:
1. Inspect the board query and confirm which fields are filtered, sorted, and grouped most often.
2. Add or refine indexes around status, priority, updated_at, and any hot assignee or reservation columns actually used.
3. Keep the response lean. Do not fetch unused heavy fields for every card.
4. Benchmark before and after with a seeded large dataset so the change is evidence-based.
5. Only add extra caching if the indexed projection still misses the target.

Checks:
- Query plan uses the intended index.
- Seeded benchmark shows improved p95.
- Returned board data remains identical for the same seed.

Artifacts:
- Query or index patch.
- Benchmark note with before/after.
- Correctness regression result.

Citations:
- retrieval://board-query-shape
- retrieval://projection-index-guidance`,
  },
  {
    spec: {
      specId: "gpt5-agentic-010",
      intent: "Enforce approval-gated risky commands with clear operator feedback and immutable audit records.",
      inputs: ["policy decision", "approval queue", "command log", "audit event stream"],
      constraints: ["hard-gate", "no bypass", "clear operator feedback", "immutable audit trail"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["approval-required-test", "deny-path-test", "audit-persist-test"],
      expectedArtifacts: ["patch", "tests", "citations"],
      riskClass: "high",
    },
    citations: [
      "retrieval://approval-flow-contract",
      "retrieval://audit-event-requirements",
      "policy://high-risk-commands",
    ],
    teacherOutput: `Summary:
- A risky command should end in one of three explicit states: denied, approval_required, or executed. There should be no silent middle ground.

Steps:
1. Read the policy decision path and the UI surface that shows pending approvals.
2. If the policy says deny, stop immediately and record the rationale in the command result and audit trail.
3. If approval is required, create a pending approval row and emit a matching immutable event before any execution starts.
4. Show the operator exactly what action is waiting, why it is gated, and what scope is affected.
5. Only transition to executed after an explicit approval decision is recorded.

Checks:
- High-risk command returns approval_required when appropriate.
- Denied command never performs side effects.
- Audit events exist for deny, pending approval, and final decision.

Artifacts:
- Approval-flow patch.
- Focused tests.
- Example audit trail note.

Rollback:
- If the UI state becomes inconsistent, keep the hard gate and fix only the operator display path next.

Citations:
- retrieval://approval-flow-contract
- retrieval://audit-event-requirements`,
  },
  {
    spec: {
      specId: "gpt5-agentic-011",
      intent: "Enforce a planner-executor-verifier loop for execution requests so code changes are proposed, applied, and checked as separate stages.",
      inputs: ["execution request", "policy context", "retrieval hits", "workspace state"],
      constraints: ["retrieval-first", "explicit stage boundaries", "verification-required", "no hidden side effects"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["plan-stage-check", "verification-stage-check", "artifact-completeness-check"],
      expectedArtifacts: ["plan", "patch", "verification summary"],
      riskClass: "medium",
    },
    citations: [
      "retrieval://execution-loop-contract",
      "retrieval://verification-stage-guidance",
    ],
    teacherOutput: `Summary:
- Do not let execution collapse into one opaque model action. Split it into planning, execution, and verification so the operator can see what is being proposed and what was actually checked.

Steps:
1. Read the execution request path and locate where a single model response currently drives both proposed and applied work.
2. Create a planning stage that emits intended files, actions, checks, and rollback notes without performing writes.
3. Feed the approved plan into the execution stage that produces the concrete patch or command payload.
4. Require a verifier stage that records lint, test, policy, and artifact results before the run is considered complete.
5. Persist each stage transition as a typed event so replay shows what happened in order.

Checks:
- Execution request produces distinct plan, execute, and verify records.
- File writes never happen before plan approval when approval is required.
- Verification failure leaves the run visible as failed or needs_review rather than silently successful.

Artifacts:
- Execution orchestration patch.
- Focused tests for stage transitions.
- Short run trace showing the three-stage flow.

Citations:
- retrieval://execution-loop-contract
- retrieval://verification-stage-guidance`,
  },
  {
    spec: {
      specId: "gpt5-agentic-012",
      intent: "Compact long chat sessions into ticket-centric summaries without losing the facts needed for later code changes.",
      inputs: ["chat session history", "ticket context", "run artifacts", "memory budget"],
      constraints: ["loss-aware", "deterministic summary schema", "preserve decisions and blockers", "bounded context window"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["summary-schema-test", "decision-retention-test", "context-budget-check"],
      expectedArtifacts: ["patch", "summary examples", "citations"],
      riskClass: "medium",
    },
    citations: [
      "retrieval://session-memory-compaction",
      "retrieval://ticket-context-schema",
    ],
    teacherOutput: `Summary:
- Memory compaction should keep operational facts, not prose. Summaries need to preserve accepted decisions, blockers, open approvals, touched files, and next checks.

Steps:
1. Read the session storage and any existing summarization hook.
2. Define a small deterministic summary schema keyed around ticket, run, and approval state instead of freeform paragraphs.
3. Summarize older messages into that schema when a token or message threshold is crossed.
4. Keep the latest raw interaction window intact so recent nuance is not lost.
5. Rehydrate later prompts from summary plus recent raw messages, not from the entire historical transcript.

Checks:
- Accepted decisions remain visible after compaction.
- Open blockers and approval ids survive summary generation.
- Context size shrinks without dropping cited sources or touched files.

Artifacts:
- Memory compaction patch.
- Summary schema test.
- Example before and after context bundle.

Citations:
- retrieval://session-memory-compaction
- retrieval://ticket-context-schema`,
  },
  {
    spec: {
      specId: "gpt5-agentic-013",
      intent: "Add backpressure-safe event batching so high-rate telemetry does not degrade the desktop UI or the write path.",
      inputs: ["event bus", "SSE stream", "event outbox", "telemetry burst traces"],
      constraints: ["bounded buffers", "loss policy explicit", "UI responsiveness", "append-order preserved"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["burst-buffer-test", "ordering-test", "ui-responsiveness-check"],
      expectedArtifacts: ["patch", "benchmark note", "citations"],
      riskClass: "medium",
    },
    citations: [
      "retrieval://event-outbox-contract",
      "retrieval://sse-buffering-guidance",
    ],
    teacherOutput: `Summary:
- If telemetry is noisy, the fix is controlled batching and bounded buffering, not unbounded queues. Preserve event order while making the stream path resilient.

Steps:
1. Inspect where run, quota, and distill events are published and how they fan out to SSE clients.
2. Introduce a bounded in-memory ring buffer or small batch window for UI-facing telemetry.
3. Preserve canonical append order in storage even if UI delivery is batched.
4. Define explicit behavior when the client falls behind: drop only low-priority telemetry or force a resync signal, never block the write path indefinitely.
5. Benchmark a seeded burst to confirm the desktop remains interactive.

Checks:
- Event order in storage remains deterministic.
- UI stream does not freeze under burst load.
- Backpressure handling is visible in logs or metrics instead of silent loss.

Artifacts:
- Stream batching patch.
- Burst benchmark summary.
- Verification note on loss policy.

Citations:
- retrieval://event-outbox-contract
- retrieval://sse-buffering-guidance`,
  },
  {
    spec: {
      specId: "gpt5-agentic-014",
      intent: "Handle partial command-run failures by preserving stdout, stderr, exit status, and rollback guidance in one structured result.",
      inputs: ["run command service", "command log", "policy engine", "operator UI"],
      constraints: ["structured results", "no swallowed stderr", "rollback guidance required", "approval context preserved"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["partial-failure-test", "stderr-persist-test", "ui-surface-check"],
      expectedArtifacts: ["patch", "tests", "citations"],
      riskClass: "high",
    },
    citations: [
      "retrieval://run-command-result-schema",
      "retrieval://operator-failure-surface",
    ],
    teacherOutput: `Summary:
- Command execution should never collapse to pass or fail only. Preserve the evidence needed for diagnosis and the next safe move.

Steps:
1. Read the command execution service and the structure used to persist command results.
2. Capture exit code, stdout tail, stderr tail, duration, working directory, and command classification in the same result object.
3. If a command partially succeeds, mark the run as failed or degraded while preserving the output needed for repair.
4. Add a small rollback or next-step field so the operator sees what to do next instead of a dead-end failure.
5. Surface the structured result in the UI without dumping overly large logs into the main view.

Checks:
- Non-zero exit stores stderr and exit code.
- Partial failure does not masquerade as success.
- Operator can inspect failure details and suggested next step.

Artifacts:
- Result schema patch.
- Focused failure-path tests.
- Concise example failure record.

Citations:
- retrieval://run-command-result-schema
- retrieval://operator-failure-surface`,
  },
  {
    spec: {
      specId: "gpt5-agentic-015",
      intent: "Version domain events safely so schema evolution does not break replay or old artifacts.",
      inputs: ["event envelope", "schema_version", "projection handlers", "legacy event fixtures"],
      constraints: ["append-only", "backward-compatible replay", "explicit migrations", "no silent coercion"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["legacy-replay-test", "schema-version-test", "migration-path-check"],
      expectedArtifacts: ["patch", "fixtures", "citations"],
      riskClass: "medium",
    },
    citations: [
      "retrieval://event-versioning-contract",
      "retrieval://replay-migration-guidance",
    ],
    teacherOutput: `Summary:
- Replay breaks when event schemas drift without discipline. Carry schema version in the envelope and migrate old payloads deliberately before folding them.

Steps:
1. Read the canonical event envelope and current projection handlers.
2. Make sure every event carries a schema_version and type-specific payload shape.
3. Add migration or normalization logic for older event versions before the projection fold step.
4. Reject unknown future versions loudly rather than guessing.
5. Keep fixtures for at least one older version so replay compatibility is tested continuously.

Checks:
- Old event fixture still replays into the expected projection.
- Unknown schema version fails with a clear error.
- New event path writes explicit schema_version values.

Artifacts:
- Event versioning patch.
- Replay fixtures and tests.
- Short note on supported migration boundaries.

Citations:
- retrieval://event-versioning-contract
- retrieval://replay-migration-guidance`,
  },
  {
    spec: {
      specId: "gpt5-agentic-016",
      intent: "Make the onboarding and runbook docs concise but operationally complete for a new operator.",
      inputs: ["README", "docs set", "startup flow", "known failure signatures"],
      constraints: ["concise", "command-first", "mermaid-supported", "non-verbose"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["quickstart-walkthrough-check", "dead-link-check", "runbook-command-check"],
      expectedArtifacts: ["docs patch", "mermaid graph", "citations"],
      riskClass: "low",
    },
    citations: [
      "retrieval://docs-structure-guidance",
      "retrieval://operator-runbook-patterns",
    ],
    teacherOutput: `Summary:
- Good docs are procedural and short. An operator should know what to run, what success looks like, what failure looks like, and what to do next.

Steps:
1. Read the current README and split docs to find duplication and gaps.
2. Keep the README as a quickstart index only. Move deeper operational detail into focused runbooks.
3. Use Mermaid for runtime topology, command flow, and distillation flow where diagrams remove ambiguity.
4. For each runbook, include prerequisites, exact commands, expected outputs, failure signatures, and recovery actions.
5. Remove filler prose that does not help an operator execute or recover.

Checks:
- A new operator can start the app and hit a healthy chat response using the docs alone.
- Runbooks reference actual current commands.
- Docs set stays concise and linked from the README.

Artifacts:
- README and runbook patch.
- Mermaid diagrams.
- Quick walkthrough verification note.

Citations:
- retrieval://docs-structure-guidance
- retrieval://operator-runbook-patterns`,
  },
  {
    spec: {
      specId: "gpt5-agentic-017",
      intent: "Tune backend autotune scoring so the fastest valid local inference backend is selected for the actual workload profile.",
      inputs: ["backend benchmark results", "hardware profile", "interactive profile", "stability metrics"],
      constraints: ["benchmark-driven", "hardware-aware", "stability-weighted", "persist decisions"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["scoring-test", "hardware-ordering-check", "activation-persist-test"],
      expectedArtifacts: ["patch", "benchmark summary", "citations"],
      riskClass: "medium",
    },
    citations: [
      "retrieval://backend-autotune-design",
      "retrieval://benchmark-score-contract",
    ],
    teacherOutput: `Summary:
- The right backend depends on the machine and workload. Make the selector evidence-based and persistent instead of hard-coded.

Steps:
1. Read the backend registry, benchmark result model, and active-backend selection logic.
2. Score backends using TTFT, throughput, latency, stability, and memory headroom with documented weights.
3. Seed candidate ordering by hardware profile, but let measured results win.
4. Persist the winning backend with the benchmark snapshot and only re-evaluate when drift or failure thresholds are crossed.
5. Add a clear fallback ladder if the active backend stops serving.

Checks:
- Seeded metrics choose the expected backend.
- Active backend selection persists and reloads correctly.
- Failure path promotes the next valid backend without manual repair.

Artifacts:
- Autotune scoring patch.
- Selection tests.
- Concise benchmark note.

Citations:
- retrieval://backend-autotune-design
- retrieval://benchmark-score-contract`,
  },
  {
    spec: {
      specId: "gpt5-agentic-018",
      intent: "Route low-risk work to the 0.8B rung and escalate deeper or riskier coding tasks only when required.",
      inputs: ["task metadata", "risk classification", "latency budget", "model router"],
      constraints: ["risk-tiered", "latency-aware", "capability-based", "approval-compatible"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["router-policy-test", "low-risk-default-check", "escalation-check"],
      expectedArtifacts: ["patch", "tests", "citations"],
      riskClass: "medium",
    },
    citations: [
      "retrieval://model-router-guidance",
      "retrieval://risk-tier-contract",
    ],
    teacherOutput: `Summary:
- Default to the smallest model that can do the job well enough. Escalation should be driven by risk and complexity, not by habit.

Steps:
1. Read the current provider and model routing logic.
2. Define routing inputs explicitly: task risk, expected context size, tool intensity, and latency budget.
3. Route low-risk interactive work to the 0.8B model by default.
4. Escalate only when the task is high-risk, fails verification, or exceeds the small model context or capability boundary.
5. Record the routing decision and reason so the operator can audit why a larger path was used.

Checks:
- Low-risk task chooses the 0.8B rung.
- High-risk task requires approval or a stronger route when configured.
- Router logs the reason for the decision.

Artifacts:
- Router patch.
- Focused routing tests.
- Example route decision note.

Citations:
- retrieval://model-router-guidance
- retrieval://risk-tier-contract`,
  },
  {
    spec: {
      specId: "gpt5-agentic-019",
      intent: "Train the model toward a high-signal code review style that prioritizes bugs, regressions, and missing tests over summaries.",
      inputs: ["diff or patch", "review instructions", "test coverage context", "risk indicators"],
      constraints: ["findings-first", "severity-ordered", "file-referenced", "low-fluff"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["review-format-check", "severity-order-check", "false-positive-check"],
      expectedArtifacts: ["behavior patch", "eval examples", "citations"],
      riskClass: "low",
    },
    citations: [
      "retrieval://review-style-contract",
      "retrieval://bug-finding-guidance",
    ],
    teacherOutput: `Summary:
- For code review, optimize for signal density. Findings come first, ordered by severity, with concrete file references and a short explanation of impact.

Steps:
1. Read the review prompt path or reviewer instruction layer.
2. Bias the model toward enumerating only real findings: bugs, regressions, missing tests, unsafe assumptions, or correctness gaps.
3. Suppress long summaries unless there are no findings or the user explicitly asks for a walkthrough.
4. Require file references and concrete impact statements for each finding.
5. Keep a no-findings path that clearly states residual testing or confidence gaps.

Checks:
- Review output starts with findings when issues exist.
- Findings include file references and impact.
- Model avoids padding the response with generic praise.

Artifacts:
- Review behavior adjustment.
- Evaluation prompts and outputs.
- Concise note on false-positive handling.

Citations:
- retrieval://review-style-contract
- retrieval://bug-finding-guidance`,
  },
  {
    spec: {
      specId: "gpt5-agentic-020",
      intent: "Recover stale task reservations automatically using heartbeat TTL without stealing active work too aggressively.",
      inputs: ["task reservations", "agent heartbeats", "task intake", "reservation TTL policy"],
      constraints: ["ttl-based", "no active-work theft", "deterministic reclaim", "visible operator warning"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["stale-reclaim-test", "active-heartbeat-protection-test", "warning-visibility-check"],
      expectedArtifacts: ["patch", "tests", "citations"],
      riskClass: "medium",
    },
    citations: [
      "retrieval://reservation-ttl-contract",
      "retrieval://agent-heartbeat-guidance",
    ],
    teacherOutput: `Summary:
- Reclaim stale reservations by policy, not by guesswork. Heartbeat age should decide when work is considered abandoned.

Steps:
1. Read the reservation model, heartbeat table, and intake allocator.
2. Define a TTL and stale condition based on last heartbeat plus reservation expiry.
3. Protect any reservation with a fresh heartbeat from being reclaimed.
4. Emit a visible warning when work is nearing reclaim so a human or active agent can refresh it.
5. Make reclaim deterministic and auditable through a task event rather than a silent overwrite.

Checks:
- Expired reservation with stale heartbeat is reclaimable.
- Fresh heartbeat blocks reclaim.
- Reclaim emits a clear event and updates the board state consistently.

Artifacts:
- Reservation recovery patch.
- TTL tests.
- Example reclaim event note.

Citations:
- retrieval://reservation-ttl-contract
- retrieval://agent-heartbeat-guidance`,
  },
  {
    spec: {
      specId: "gpt5-agentic-021",
      intent: "Keep secrets out of the database and logs by storing only keychain references and redacting sensitive command payloads.",
      inputs: ["settings storage", "provider credentials", "log pipeline", "security policy"],
      constraints: ["no plaintext secrets", "redaction-by-default", "keychain-reference-only", "audit-safe"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["secret-redaction-test", "db-storage-test", "log-scan-check"],
      expectedArtifacts: ["patch", "tests", "citations"],
      riskClass: "high",
    },
    citations: [
      "retrieval://secret-storage-policy",
      "retrieval://log-redaction-contract",
    ],
    teacherOutput: `Summary:
- Secret handling needs hard boundaries. The database should store references, not raw secrets, and logs should never echo sensitive material back out.

Steps:
1. Read the provider settings path, persistence layer, and logging path together.
2. Ensure secret values are stored in the OS keychain or equivalent secure store and only stable references land in the database.
3. Redact sensitive fields before command payloads, error payloads, or config snapshots are logged.
4. Add scans in tests for obvious leakage patterns across persisted rows and structured logs.
5. Keep auditability by recording that a secret-backed setting changed, not the secret itself.

Checks:
- Database rows contain references or masked values only.
- Logs do not contain API keys, tokens, or auth headers.
- Provider functionality still works with referenced secret lookups.

Artifacts:
- Secret handling patch.
- Leakage tests.
- Short audit example.

Citations:
- retrieval://secret-storage-policy
- retrieval://log-redaction-contract`,
  },
  {
    spec: {
      specId: "gpt5-agentic-022",
      intent: "Require retrieval context before execution so code changes always cite the source material that informed them.",
      inputs: ["execution request", "knowledge search", "retrieval result ids", "policy engine"],
      constraints: ["retrieval-first-hard-gate", "citation-required", "no uncited execution", "source-visible"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["missing-retrieval-deny-test", "citation-persist-test", "ui-source-visibility-check"],
      expectedArtifacts: ["patch", "tests", "citations"],
      riskClass: "medium",
    },
    citations: [
      "retrieval://knowledge-search-contract",
      "retrieval://execution-citation-policy",
    ],
    teacherOutput: `Summary:
- If the system claims to be retrieval-first, enforce it. Execution without retrieval context should be denied or routed back for research.

Steps:
1. Read the knowledge search path and the execution request command path.
2. Require retrieval result ids or an explicit no-relevant-sources decision before execution proceeds.
3. Persist the retrieval ids into the run metadata and surface them in the operator UI.
4. Deny uncited execution requests unless the policy explicitly allows a no-source path for narrow cases.
5. Keep the citations attached to downstream artifacts such as patch summaries and audit records.

Checks:
- Execution request without retrieval ids is denied or redirected.
- Approved run persists retrieval ids.
- Sources used are visible from the run or Overseer panel.

Artifacts:
- Retrieval gate patch.
- Policy and persistence tests.
- Example run metadata note.

Citations:
- retrieval://knowledge-search-contract
- retrieval://execution-citation-policy`,
  },
  {
    spec: {
      specId: "gpt5-agentic-023",
      intent: "Keep patch size minimal by preferring targeted edits over broad refactors when fixing a local bug.",
      inputs: ["failing test report", "git diff context", "bug location hypothesis", "workspace constraints"],
      constraints: ["smallest-diff-first", "preserve public behavior", "avoid opportunistic rewrites", "verify only affected surfaces"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["diff-size-check", "targeted-regression-test", "behavior-preservation-check"],
      expectedArtifacts: ["patch", "verification note", "citations"],
      riskClass: "low",
    },
    citations: [
      "retrieval://minimal-diff-guidance",
      "retrieval://regression-check-patterns",
    ],
    teacherOutput: `Summary:
- Fix the bug with the narrowest edit that closes the defect. A clean small patch is easier to verify and less likely to introduce a second problem.

Steps:
1. Read the failing path and identify the smallest code area that can plausibly explain the bug.
2. Avoid broad refactors unless the current structure makes a targeted fix impossible.
3. Patch only the affected logic and keep unrelated formatting or renaming out of scope.
4. Run the closest targeted test first, then a light regression sweep over adjacent behavior.
5. Document why the narrower fix was preferred over a larger rewrite.

Checks:
- Diff stays focused on the failing path.
- Targeted tests pass.
- Existing adjacent behavior is unchanged.

Artifacts:
- Minimal patch.
- Regression note.
- Short explanation of scope control.

Citations:
- retrieval://minimal-diff-guidance
- retrieval://regression-check-patterns`,
  },
  {
    spec: {
      specId: "gpt5-agentic-024",
      intent: "Estimate test impact before executing changes so the verifier runs the highest-signal checks first.",
      inputs: ["touched files", "dependency graph hints", "test catalog", "risk tier"],
      constraints: ["fast-first", "risk-aware", "no skipped critical checks", "verifier-visible"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["impact-mapping-test", "critical-check-ordering-test", "fallback-full-suite-check"],
      expectedArtifacts: ["patch", "impact summary", "citations"],
      riskClass: "medium",
    },
    citations: [
      "retrieval://test-impact-estimation",
      "retrieval://verifier-priority-order",
    ],
    teacherOutput: `Summary:
- The verifier should not guess at test order. Estimate likely impact from files and subsystems, run high-signal checks first, and escalate to broader coverage when risk is higher.

Steps:
1. Read the files touched by the planned change and map them to the nearest unit, integration, and type-check surfaces.
2. Rank checks by signal and cost, with critical correctness checks first.
3. Keep a fallback path to run the broader suite when the change is high-risk or the targeted checks are inconclusive.
4. Record which checks were chosen and why so the operator can audit the verifier path.
5. Avoid claiming coverage you did not actually run.

Checks:
- Impact mapping includes nearby unit and integration tests.
- Critical checks appear before lower-signal tasks.
- High-risk changes still trigger broader verification.

Artifacts:
- Impact estimator patch.
- Ordered verification summary.
- Audit note with chosen checks.

Citations:
- retrieval://test-impact-estimation
- retrieval://verifier-priority-order`,
  },
  {
    spec: {
      specId: "gpt5-agentic-025",
      intent: "Make retrieval ranking prefer recent, canonical, and code-adjacent sources before looser historical notes.",
      inputs: ["knowledge index", "retrieval scores", "source metadata", "execution request"],
      constraints: ["retrieval-first", "source quality weighted", "stale penalty", "operator-visible ranking"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["ranking-weight-test", "stale-source-penalty-test", "ui-source-order-check"],
      expectedArtifacts: ["patch", "ranking note", "citations"],
      riskClass: "medium",
    },
    citations: [
      "retrieval://source-ranking-guidance",
      "retrieval://knowledge-freshness-policy",
    ],
    teacherOutput: `Summary:
- Retrieval quality is not only semantic similarity. Rank sources using freshness, canonicality, and adjacency to the code path being changed.

Steps:
1. Read the retrieval ranking path and the metadata available on knowledge hits.
2. Increase weight for canonical docs, current architecture notes, and code-adjacent sources.
3. Apply a penalty to stale or deprecated material unless there is no better source.
4. Surface the final source order in the operator UI so the reasoning path is inspectable.
5. Keep the scoring deterministic enough for debugging and replay.

Checks:
- Canonical recent sources outrank stale notes for the same topic.
- Deprecated material is visibly penalized.
- UI shows sources in the same order used for the run.

Artifacts:
- Ranking patch.
- Ranking-weight tests.
- Short source-order verification note.

Citations:
- retrieval://source-ranking-guidance
- retrieval://knowledge-freshness-policy`,
  },
  {
    spec: {
      specId: "gpt5-agentic-026",
      intent: "Preserve deterministic command IDs and correlation IDs across planner, executor, and verifier stages.",
      inputs: ["command log", "stage transitions", "event envelope", "replay requirements"],
      constraints: ["deterministic ids", "cross-stage traceability", "append-only", "replay-friendly"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["correlation-id-test", "replay-trace-test", "stage-linkage-check"],
      expectedArtifacts: ["patch", "trace note", "citations"],
      riskClass: "medium",
    },
    citations: [
      "retrieval://command-id-contract",
      "retrieval://correlation-tracing-guidance",
    ],
    teacherOutput: `Summary:
- Multi-stage execution is only debuggable if every stage stays attached to one trace. Planner, executor, and verifier events must preserve stable correlation IDs.

Steps:
1. Read the command creation path and where stage-specific events are emitted.
2. Generate stable causation and correlation IDs at command creation time.
3. Reuse those IDs across plan, execute, verify, approval, and audit records.
4. Expose the trace in the run timeline so an operator can reconstruct one command end to end.
5. Reject ad-hoc event emission that creates orphan records without trace linkage.

Checks:
- Stage events share the same correlation ID.
- Replay timeline reconstructs the command flow in order.
- Orphan events are not emitted.

Artifacts:
- Traceability patch.
- Correlation tests.
- Example command timeline note.

Citations:
- retrieval://command-id-contract
- retrieval://correlation-tracing-guidance`,
  },
  {
    split: "holdout",
    benchmarkRubric: {
      minSections: ["Summary", "Steps", "Checks"],
      requiredTerms: ["test", "rollback"],
      bannedTerms: ["rm -rf", "disable auth"],
    },
    spec: {
      specId: "gpt5-agentic-holdout-001",
      intent: "Fix a flaky chat stream reconnect after an inference backend switch without duplicating the last assistant turn.",
      inputs: ["stream reconnect logic", "backend switch event", "session message projection", "ui regression report"],
      constraints: ["state-synchronized", "no duplicate turns", "keep stream continuity", "verify reconnect path"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["backend-switch-reconnect-test", "duplicate-turn-test", "stream-continuity-check"],
      expectedArtifacts: ["patch", "verification note", "citations"],
      riskClass: "medium",
    },
    citations: [
      "retrieval://stream-reconnect-contract",
      "retrieval://backend-switch-events",
    ],
    teacherOutput: `Summary:
- Reconnect on backend switch using current session state, but never replay the final assistant turn into the transcript twice.

Steps:
1. Read the reconnect path and the last-message merge logic.
2. Attach reconnect state to the active session and backend switch event, not to a stale stream instance.
3. Deduplicate the last assistant message using message id or stable content boundary before append.
4. Verify that the resumed stream continues from the current turn instead of replaying the completed one.
5. Keep a rollback path limited to the reconnect merge logic if continuity regresses.

Checks:
- Backend switch reconnect completes without duplicate assistant turns.
- Session continuity is preserved.
- Regression test covers reconnect after a partial streamed reply.

Artifacts:
- Reconnect patch.
- Regression note.
- Citations used for the fix.

Citations:
- retrieval://stream-reconnect-contract
- retrieval://backend-switch-events`,
  },
  {
    split: "holdout",
    benchmarkRubric: {
      minSections: ["Summary", "Steps", "Checks", "Artifacts"],
      requiredTerms: ["approval", "test"],
      bannedTerms: ["drop table", "disable auth"],
    },
    spec: {
      specId: "gpt5-agentic-holdout-002",
      intent: "Prevent duplicate task reservations when a drag-drop move and a reserve command race against each other.",
      inputs: ["task reservation writes", "board mutation events", "command race trace", "task timeline"],
      constraints: ["single-reservation-truth", "deterministic conflict handling", "audit visible", "no silent overwrite"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["reservation-race-test", "conflict-resolution-test", "timeline-audit-check"],
      expectedArtifacts: ["patch", "tests", "citations"],
      riskClass: "high",
    },
    citations: [
      "retrieval://reservation-race-contract",
      "retrieval://task-timeline-audit",
    ],
    teacherOutput: `Summary:
- Reservation writes must converge to one outcome even when board movement and explicit reserve commands arrive close together.

Steps:
1. Read the reservation write path and the board move command flow.
2. Enforce a single reservation authority on the command side and reject stale competing writes deterministically.
3. Record the conflict decision in the task timeline so operators can see why one reservation won.
4. Require approval only if the conflict policy would reclaim or overwrite active work.
5. Verify that the board shows one reservation state after the race settles.

Checks:
- Racing reserve and move commands do not leave two reservation records.
- Conflict resolution is deterministic.
- Timeline contains the conflict event and decision.

Artifacts:
- Reservation conflict patch.
- Race-path tests.
- Timeline verification note.

Citations:
- retrieval://reservation-race-contract
- retrieval://task-timeline-audit`,
  },
  {
    split: "holdout",
    benchmarkRubric: {
      minSections: ["Summary", "Steps", "Checks"],
      requiredTerms: ["replay", "projection"],
      bannedTerms: ["rm -rf"],
    },
    spec: {
      specId: "gpt5-agentic-holdout-003",
      intent: "Diagnose a replay mismatch where the live task projection disagrees with the reconstructed event-log state.",
      inputs: ["event log", "projection snapshot", "replay trace", "divergence report"],
      constraints: ["append-only truth", "projection debug only", "no live mutation shortcut", "first-divergence focus"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["divergence-repro-test", "first-divergence-report-check", "projection-fix-check"],
      expectedArtifacts: ["patch", "parity note", "citations"],
      riskClass: "medium",
    },
    citations: [
      "retrieval://replay-divergence-debugging",
      "retrieval://projection-fold-rules",
    ],
    teacherOutput: `Summary:
- Debug the first divergence between replayed state and live projection; do not patch the projection table directly.

Steps:
1. Read the divergence report and identify the first event where replay and projection disagree.
2. Inspect the fold rule for that event type and compare it to the stored projection mutation path.
3. Fix the fold logic or projection update bug at the source rather than mutating snapshot data manually.
4. Re-run replay parity on the seeded scenario after the fix.
5. Keep the repair scoped to the divergent rule and document rollback if parity gets worse.

Checks:
- First divergence is reported clearly.
- Replay and live projection match after the fix.
- No direct snapshot mutation shortcut is introduced.

Artifacts:
- Projection fold patch.
- Parity verification note.
- Citations for the corrected rule.

Citations:
- retrieval://replay-divergence-debugging
- retrieval://projection-fold-rules`,
  },
  {
    split: "holdout",
    benchmarkRubric: {
      minSections: ["Summary", "Steps", "Checks", "Artifacts"],
      requiredTerms: ["approval", "rollback"],
      bannedTerms: ["disable auth", "drop table"],
    },
    spec: {
      specId: "gpt5-agentic-holdout-004",
      intent: "Guard a runtime provider configuration change behind approval and produce a rollback note before applying it.",
      inputs: ["provider settings update", "policy engine", "operator UI", "current runtime config"],
      constraints: ["hard-policy", "approval-first", "rollback-required", "audit persisted"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["approval-gate-test", "rollback-note-check", "audit-persist-test"],
      expectedArtifacts: ["patch", "approval card", "citations"],
      riskClass: "high",
    },
    citations: [
      "retrieval://provider-config-policy",
      "retrieval://rollback-note-pattern",
    ],
    teacherOutput: `Summary:
- Provider config changes should not execute on demand. Gate them behind approval and require an explicit rollback note before the write path proceeds.

Steps:
1. Read the provider settings mutation path and current policy decision flow.
2. Mark provider config changes as approval-required by default.
3. Capture the exact scope of the change and a rollback note in the approval payload before execution.
4. Persist approval, execution, and rollback metadata into the audit trail.
5. Verify the operator sees what will change before they approve it.

Checks:
- Provider config change is blocked pending approval.
- Rollback note is captured before execution.
- Audit trail contains request, decision, and apply events.

Artifacts:
- Policy patch.
- Approval UI note.
- Citations supporting the gate.

Citations:
- retrieval://provider-config-policy
- retrieval://rollback-note-pattern`,
  },
  {
    split: "holdout",
    benchmarkRubric: {
      minSections: ["Summary", "Steps", "Checks"],
      requiredTerms: ["source", "test"],
      bannedTerms: ["rm -rf"],
    },
    spec: {
      specId: "gpt5-agentic-holdout-005",
      intent: "Reject stale or low-confidence knowledge hits before execution and make the operator aware of the fallback research path.",
      inputs: ["knowledge hits", "confidence metadata", "execution request", "source freshness rules"],
      constraints: ["retrieval-first", "confidence-aware", "operator-visible fallback", "no uncited execution"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["stale-hit-reject-test", "fallback-research-check", "source-visibility-check"],
      expectedArtifacts: ["patch", "fallback note", "citations"],
      riskClass: "medium",
    },
    citations: [
      "retrieval://knowledge-confidence-policy",
      "retrieval://fallback-research-flow",
    ],
    teacherOutput: `Summary:
- Low-confidence or stale sources should block or redirect execution rather than quietly feeding weak context into a code change.

Steps:
1. Read the knowledge hit ranking and the execution request gate.
2. Reject or down-rank hits that are stale, deprecated, or below the confidence threshold.
3. If no sufficient source remains, send the operator or agent back to a research step instead of executing uncited work.
4. Surface the fallback reason in the UI so the failure is actionable.
5. Verify that strong current sources still pass through without friction.

Checks:
- Stale low-confidence hits do not allow execution.
- Fallback research path is visible.
- Source visibility remains clear for accepted runs.

Artifacts:
- Retrieval gate patch.
- Fallback verification note.
- Citations for confidence policy.

Citations:
- retrieval://knowledge-confidence-policy
- retrieval://fallback-research-flow`,
  },
  {
    split: "holdout",
    benchmarkRubric: {
      minSections: ["Summary", "Steps", "Checks", "Artifacts"],
      requiredTerms: ["benchmark", "latency"],
      bannedTerms: ["disable auth"],
    },
    spec: {
      specId: "gpt5-agentic-holdout-006",
      intent: "Add a backend autotune benchmark case for tool-heavy local coding workloads and record the chosen backend with evidence.",
      inputs: ["backend benchmark harness", "tool-heavy profile", "latency metrics", "backend registry"],
      constraints: ["benchmark-driven", "evidence-persisted", "tool-heavy-profile", "fallback-aware"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["tool-heavy-benchmark-test", "selection-persist-test", "fallback-chain-check"],
      expectedArtifacts: ["patch", "benchmark note", "citations"],
      riskClass: "medium",
    },
    citations: [
      "retrieval://tool-heavy-benchmark-profile",
      "retrieval://backend-selection-evidence",
    ],
    teacherOutput: `Summary:
- Tool-heavy workloads need their own benchmark case. Persist the evidence behind the selected backend instead of relying on a static default.

Steps:
1. Read the benchmark harness and current backend profile list.
2. Add a tool-heavy case that reflects repeated short generations plus command planning overhead.
3. Record TTFT, throughput, latency, and stability for that profile.
4. Persist the winning backend together with the benchmark evidence used to choose it.
5. Verify the fallback chain still works if the selected backend stops responding.

Checks:
- Tool-heavy benchmark case executes.
- Selected backend and evidence are persisted.
- Fallback chain remains available.

Artifacts:
- Benchmark harness patch.
- Evidence summary.
- Citations for backend selection.

Citations:
- retrieval://tool-heavy-benchmark-profile
- retrieval://backend-selection-evidence`,
  },
  {
    split: "holdout",
    benchmarkRubric: {
      minSections: ["Summary", "Steps", "Checks"],
      requiredTerms: ["finding", "test"],
      bannedTerms: ["looks good", "great job"],
    },
    spec: {
      specId: "gpt5-agentic-holdout-007",
      intent: "Review a risky patch and produce findings-first feedback that calls out missing tests and likely regressions.",
      inputs: ["patch diff", "affected files", "behavioral risk hints", "test coverage context"],
      constraints: ["findings-first", "severity-ordered", "file-referenced", "no fluff"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["findings-order-check", "missing-tests-callout-check", "false-positive-control-check"],
      expectedArtifacts: ["review output", "citations", "risk note"],
      riskClass: "medium",
    },
    citations: [
      "retrieval://review-findings-contract",
      "retrieval://missing-test-detection",
    ],
    teacherOutput: `Summary:
- Review output should prioritize concrete findings over summary. Missing tests and likely regressions need to be called out with file references and impact.

Steps:
1. Read the diff and identify the highest-risk behavioral changes first.
2. Enumerate findings in severity order with concrete file references.
3. Call out missing tests when the change alters branching, state handling, or safety gates without coverage.
4. Avoid generic praise or filler summary when findings exist.
5. Add a concise residual risk note if the patch is otherwise sound.

Checks:
- Findings appear before any summary.
- Missing tests are called out when coverage is absent.
- Output avoids low-signal praise.

Artifacts:
- Findings-first review output.
- Risk note.
- Citations supporting the review standard.

Citations:
- retrieval://review-findings-contract
- retrieval://missing-test-detection`,
  },
  {
    split: "holdout",
    benchmarkRubric: {
      minSections: ["Summary", "Steps", "Checks", "Artifacts"],
      requiredTerms: ["rollback", "artifact"],
      bannedTerms: ["drop table", "rm -rf"],
    },
    spec: {
      specId: "gpt5-agentic-holdout-008",
      intent: "Recover from a failed ORPO distillation attempt without losing the last usable promoted adapter.",
      inputs: ["distill run registry", "artifact registry", "promotion state", "failed ORPO logs"],
      constraints: ["artifact-safe", "rollback-capable", "promotion-state-preserved", "audit visible"],
      requiredTools: ["read", "edit", "test"],
      requiredChecks: ["failed-orpo-recovery-test", "promotion-preservation-check", "artifact-integrity-check"],
      expectedArtifacts: ["patch", "recovery note", "citations"],
      riskClass: "high",
    },
    citations: [
      "retrieval://distill-recovery-playbook",
      "retrieval://artifact-registry-safety",
    ],
    teacherOutput: `Summary:
- A failed ORPO run should not poison the last usable adapter. Preserve the promoted model state and recover with clear artifact and rollback handling.

Steps:
1. Read the failed ORPO logs, current promotion state, and artifact registry.
2. Ensure failed runs cannot overwrite or implicitly demote the last promoted adapter.
3. Mark the failed run clearly and preserve the previous promoted artifact as the runtime default.
4. Record the recovery decision and rollback context in the audit trail.
5. Verify artifact integrity before allowing any later promotion attempt.

Checks:
- Failed ORPO run does not replace the promoted adapter.
- Runtime default remains on the last usable model.
- Artifact integrity is verified before future promotion.

Artifacts:
- Recovery patch.
- Recovery verification note.
- Citations for artifact safety rules.

Citations:
- retrieval://distill-recovery-playbook
- retrieval://artifact-registry-safety`,
  },
];

async function main() {
  const title = process.env.DISTILL_SEED_TITLE || "GPT-5 Agentic Coding Distill Pack v3";
  const createdBy = process.env.DISTILL_SEED_ACTOR || "codex-gpt5-session";
  const now = new Date();

  const dataset = await prisma.distillDataset.create({
    data: {
      title,
      objectiveSplit: "90-10-coding-general",
      privacyPolicyVersion: "private-safe-v1",
      status: "reviewed",
      createdBy,
      sampleCount: EXAMPLES.length,
      approvedCount: EXAMPLES.length,
      rejectedCount: 0,
      metadata: {
        teacher_source: "codex-gpt5-session",
        import_mode: "manual_teacher_seed",
        created_at: now.toISOString(),
        train_examples: EXAMPLES.filter((example) => example.split !== "holdout").length,
        holdout_examples: EXAMPLES.filter((example) => example.split === "holdout").length,
      },
    },
  });

  await prisma.distillExample.createMany({
    data: EXAMPLES.map((example) => ({
      datasetId: dataset.id,
      spec: example.spec,
      teacherOutput: example.teacherOutput,
      reviewerDecision: "approved",
      reviewNotes: "Approved at import from manual GPT-5 teacher dataset.",
      privacySafe: true,
      citations: example.citations,
      metadata: {
        teacher_model: "codex-gpt5-session",
        import_mode: "manual_teacher_seed",
        source: "in-session-distillation",
        split: example.split || "train",
        benchmark_rubric: example.benchmarkRubric || null,
      },
      reviewedAt: now,
    })),
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        datasetId: dataset.id,
        title,
        sampleCount: EXAMPLES.length,
        approvedCount: EXAMPLES.length,
      },
      null,
      2
    )}\n`
  );
}

main()
  .catch((error) => {
    process.stderr.write(`seed dataset failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

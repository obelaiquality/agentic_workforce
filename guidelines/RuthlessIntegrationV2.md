# Ruthless Integration v2 (Implemented Baseline)

## What Is Live

1. Canonical command/event pipeline is active through `/api/v2/commands/*` backed by Rust sidecar append + policy evaluation.
2. Postgres append-only core is introduced with:
   - `event_log`
   - `event_outbox`
3. Projection/read models are active for fast UI queries:
   - `task_projection`
   - `task_reservations`
   - `run_projection`
   - `approval_projection`
   - `provider_account_projection`
4. Replay path is available through:
   - `GET /api/v2/runs/:id/replay`
   - `GET /api/v2/tasks/:id/timeline`
5. Policy gating is active for protected actions (`provider_change`, `file_apply`, `run_command`, `delete`) with explicit approval requirements.
6. Retrieval-first execution guard is enforced by requiring `retrieval_context_ids` in `execution.request`.

## Runtime Contracts

1. Rust gRPC sidecar methods:
   - `AppendEvent`
   - `Replay`
   - `EvaluatePolicy`
   - `AllocateTask`
   - `Heartbeat`
2. Fastify v2 command endpoints:
   - `POST /api/v2/commands/task.intake`
   - `POST /api/v2/commands/task.reserve`
   - `POST /api/v2/commands/task.transition`
   - `POST /api/v2/commands/execution.request`
   - `POST /api/v2/commands/policy.decide`
   - `POST /api/v2/commands/provider.activate`
3. Fastify v2 query endpoints:
   - `GET /api/v2/tasks/board`
   - `GET /api/v2/tasks/:id/timeline`
   - `GET /api/v2/runs/:id/replay`
   - `GET /api/v2/policy/pending`
   - `GET /api/v2/knowledge/search?q=...`
   - `GET /api/v2/commands/recent`
4. Typed stream:
   - `GET /api/v2/stream` (SSE)

## UI Integration

1. Overseer now surfaces structured command actions from `command_log` (replacing regex-only action extraction).
2. Backlog now uses canonical v2 board projection with reservation visibility and intake actions.
3. Runs view includes replay-by-run from canonical event stream plus audit timeline.
4. Settings now activates providers through the v2 command/policy path and includes dry-run policy simulation.

## Compatibility

1. v1 routes remain available.
2. v1 ticket mutations are synchronized into v2 projections and event stream.
3. v1 approval decisions are synchronized into v2 approval projection/events.

## Packaging Notes

1. Desktop packaging now includes `dist-sidecar` in `asarUnpack` so the sidecar binary is executable at runtime.
2. CI release workflow now installs Rust toolchain before building desktop artifacts.

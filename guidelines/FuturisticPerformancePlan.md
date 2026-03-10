# Futuristic Performance & Reliability Plan (Post-v2)

## Objective

Push the desktop agentic coding stack toward near-real-time local orchestration, deterministic safety controls, and provider-agnostic model execution at scale.

## North-Star Targets

1. Command ack p95 under 60ms on local workstation.
2. First token p95 under 700ms for local 0.8B models.
3. Failover decision under 250ms between eligible providers/models.
4. 100k event replay under 10s on NVMe + tuned Postgres.
5. Zero policy-bypass paths for protected actions.

## Runtime Architecture Upgrades

1. Move Node↔Rust from TCP loopback to Unix socket / named pipe gRPC for lower syscall overhead and smaller attack surface.
2. Introduce event outbox dispatcher in Rust sidecar with bounded in-memory ring buffer and replay cursor checkpoints.
3. Add projection worker pools with per-domain lanes (`tasks`, `runs`, `policy`, `provider`) and backpressure thresholds.
4. Add model gateway process abstraction for local inference runtimes:
   - `llama.cpp server`
   - `vLLM`
   - `Ollama`
   all exposed via OpenAI-compatible interface.

## Model Orchestration Strategy

1. Dynamic model routing policy:
   - small model for ticket triage and extraction
   - medium model for coding transforms
   - larger model for architecture/risk reasoning
2. Provider-factory plugin routing by capability and budget:
   - `latency_budget_ms`
   - `context_required`
   - `tool_density`
   - `risk_class`
3. Speculative execution:
   - run lightweight planner model in parallel with retrieval
   - cancel losing branch once policy-safe winner selected.

## Data Plane Optimization

1. Postgres tuning profile for local desktop:
   - `shared_buffers` tuned to device RAM class
   - `wal_compression=on`
   - batched inserts for telemetry and outbox
2. Add materialized read views for hot boards + run summaries.
3. Introduce event snapshotting every N events per aggregate to reduce replay startup time.

## Retrieval & Memory Upgrades

1. Incremental embeddings pipeline with file-change debouncing and lane-priority indexing.
2. Hybrid ranking (BM25 + vector + structural path priors).
3. Citation confidence thresholding before code generation.
4. Continuous retrieval quality telemetry (`precision@k`, stale source ratio, citation reuse quality).

## Safety Engine Hardening

1. Policy DSL compilation to deterministic decision graph with versioned rule hashing.
2. Dual decision path:
   - fast path precompiled checks
   - slow path explanation trace for audits.
3. Signed command envelopes with per-session nonce to prevent replay injection.
4. Mandatory path sandboxing + command allowlists by risk class.

## UX/Operator Experience

1. Real-time execution graph with command lineage (`correlation_id`, `causation_id`).
2. Inline policy simulation diff view before committing rule updates.
3. Live model benchmark panel (tokens/s, latency, error rates, context spill).
4. Adaptive Kanban prioritization using throughput + blocker aging + risk weighting.

## Deployment & Operations

1. Add profile-based runtime bundles:
   - `laptop-lite`
   - `workstation-pro`
   - `gpu-rig`.
2. Preflight validates model runtime availability and GPU memory headroom.
3. Chaos test suite for sidecar restarts, provider failures, and stale reservation storms.
4. Continuous parity checks between replayed projections and live projection tables.

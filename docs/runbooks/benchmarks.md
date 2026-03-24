# Benchmark Runbook

## Purpose

Use the benchmark system as advanced evaluation infrastructure. It is useful for regression scoring and demo fixtures, but it is not part of the launch-facing first-run product path.

## Advanced Pack Flow

1. Open `Projects`.
2. Import a managed benchmark pack.
3. Activate the repo from the header switcher.
4. Open `Settings > Advanced` with Labs enabled.
5. Start a benchmark run, execute it through the app, then recompute the scorecard.

## API Regression

```bash
API_BASE_URL=http://127.0.0.1:8787 npm run benchmarks:api -- react-dashboard-lite
```

## Evidence Collected

1. Verify command result
2. Diff metadata
3. Routing decision and context manifest references
4. Repo-scoped chat session id
5. Hard-fail list and weighted scorecard

## Current Limitation

The benchmark harness is real, but API regression mode still drives the legacy `execution.request` command path. It is strongest at validating repo attachment, routing, context, repo-scoped chat, and scorecard evidence. Use the newer mission execution flow for current implementation behavior, and treat benchmark scorecards as a narrower legacy regression signal until the benchmark runner is moved onto the same path.

## Public Positioning

- Keep benchmark scorecards as proof and eval infrastructure.
- Do not treat benchmarks as the primary onboarding workflow.
- For public demos, prefer the guided example repo flow in [docs/demo-react-dashboard.md](../demo-react-dashboard.md).

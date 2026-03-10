# Benchmark Runbook

## Purpose

Use the V5 benchmark system to attach repos, materialize disposable benchmark worktrees, execute tasks through the app, and score outcomes with machine-verifiable evidence.

## Synthetic Pack

1. Open `Repos`.
2. Import a managed benchmark pack.
3. Activate the repo from the header switcher.
4. Open `Benchmarks`.
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

The benchmark harness is now real, but the app still does not have a true autonomous code-apply engine behind `execution.request`. Today the benchmark runner proves repo attachment, routing, context, repo-scoped chat, and outcome scoring. Once code-apply lands, the same scorecard path will judge actual implementation success instead of baseline failure.

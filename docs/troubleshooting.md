# Troubleshooting

## Docker Hard Blocker

Symptom:
- Doctor reports Docker unavailable.

Fix:
1. Start Docker Desktop.
2. Re-run `npm run doctor`.
3. Verify Postgres: `nc -z 127.0.0.1 5433`.

## Local Runtime Unreachable

Symptom:
- `onprem_runtime_8000` warning.

Fix:
1. Start runtime server (`mlx-lm` or transformers fallback).
2. Verify health endpoint.
3. Confirm `Settings -> On-Prem Qwen` base URL matches.

## Claude Teacher Fails

Symptom:
- Distill examples become `needs_edit` with teacher fallback metadata.

Fix:
1. Check `claude auth status`.
2. Reduce `maxRequestsPerMinute`.
3. Increase `retryBackoffMs`.
4. Check quota/budget values in distill settings.

## Training Run Failed

Symptom:
- Run status `failed`, reason `trainer_unavailable`.

Fix:
1. Install dependencies in your Python env:

```bash
python3 -m pip install --upgrade torch transformers datasets peft accelerate
```

2. Re-run `Start Training`.

## Full Pass Preparation Fails

Symptom:
- `npm run distill:run:full -- --prepare-only` fails on readiness or approved-ratio gate.

Fix:
1. Run `npm run distill:doctor -- --strict`.
2. Resolve blockers (`teacher_cli`, `teacher_auth`, `trainer_python_modules`).
3. If using small sample count for smoke testing, lower the gate temporarily:

```bash
DISTILL_FULL_PASS_MIN_APPROVED_RATIO=0 npm run distill:run:full -- --prepare-only
```

4. Restore stricter ratio for real passes (`0.6` or higher).

## Playwright E2E Flakiness

Symptom:
- Script fails on missing element refs or timing.

Fix:
1. Re-run `npm run test:e2e:playwright`.
2. Inspect latest artifacts in `output/playwright/e2e-critical-*`.
3. Ensure ports 5173, 8787, and 8000 are stable before run.

## Policy Blocks Command

Symptom:
- Command returns denied/rejected.

Fix:
1. Open `Settings -> Policy Simulation`.
2. Run dry-run policy check for the same action class.
3. Approve queued action if policy requires approval.

# Troubleshooting

## Postgres Unavailable

Symptom:
- The app cannot reach PostgreSQL on `127.0.0.1:5433`.

Fix:
1. Start Docker Desktop if you use the built-in local path.
2. Run `npm run db:up`.
3. Run `npx prisma db push`.
4. Re-run `npm run doctor`.

## Desktop App Opens But Backend Is Unavailable

Symptom:
- The UI shows a backend-unavailable or recovery state.

Fix:
1. Confirm Postgres is available.
2. Start the API directly with `npm run dev:api` if the renderer is already running.
3. Or restart the supported desktop path with `npm run start:desktop`.

## Browser Preview Feels Broken

Symptom:
- Repo picking or local execution actions do not behave like the desktop app.

Fix:
1. Use the Electron desktop app for the full operator flow.
2. Treat browser preview as a limited inspection surface only.

## OpenAI Models Or Runtime Settings Look Wrong

Symptom:
- Settings cannot fetch OpenAI models or the selected runtime looks stale.

Fix:
1. Confirm `OPENAI_API_KEY` is set in `.env`.
2. Open `Settings > Essentials` and re-save the key if needed.
3. Use `Refresh models`.
4. Re-run `npm run doctor` if local runtime or provider state looks inconsistent.

## Local Runtime Unreachable

Symptom:
- `onprem_runtime_8000` warning or local runtime requests fail.

Fix:
1. Start your chosen local runtime.
2. Verify the health endpoint.
3. Confirm the base URL in `Settings > Essentials` or `Settings > Advanced`.
4. Use the advanced local runtime guide if you are intentionally running fully local.

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

## Advanced Or Internal Features

Benchmarks and Labs are advanced/internal flows. They are intentionally not required for first-run success. If you are working on those paths, use the dedicated runbooks instead of the launch-facing docs.

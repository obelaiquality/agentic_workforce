# Testing

This repo now uses explicit test tiers instead of one blended “run everything” expectation.

## Baseline Validation

Run this before every normal PR:

```bash
npm run validate
```

Covers:

- lint
- security guardrails
- typecheck
- docs link validation
- unit/integration tests
- frontend build
- server build

## Stable Desktop E2E

Use this for primary operator-path changes:

```bash
npm run test:e2e:desktop-stable
```

Covers:

- launch Electron
- change a stable settings value from the desktop UI and verify the persisted config
- create a blank project from an empty folder
- apply a starter after blank project creation
- attach an existing deterministic repo fixture
- execute one bounded follow-up task
- round-trip mission ticket permissions through `strict` and `balanced`
- inspect `Codebase` and `Console`

Runtime presets:

```bash
OPENAI_API_KEY=... E2E_RUNTIME_PRESET=openai_all npm run test:e2e:desktop-stable
E2E_RUNTIME_PRESET=default npm run test:e2e:desktop-stable
```

## Nightly / Manual Coverage

Use this for broader regression coverage:

```bash
npm run test:e2e:nightly
```

Includes:

- CLI companion smoke
- follow-up feature scenarios
- optional browser-preview failover coverage when `ENABLE_LOCAL_FAILOVER_E2E=1`

## OpenAI-All Settings Kitchen-Sink

Use this when you need the full Settings browser-preview battle test against real OpenAI with hard spend caps:

```bash
OPENAI_API_KEY=... DATABASE_URL=postgresql://... npm run test:e2e:settings:openai-all
```

Prerequisites:

- `OPENAI_API_KEY` must be valid because the suite discovers live `/v1/models` and runs real OpenAI-routed smoke work
- `DATABASE_URL` must point at Postgres because the suite creates and later drops a dedicated disposable schema
- `npx`, `node`, `curl`, `jq`, and `nc` must be available locally

What it does:

- starts API and Vite on disposable ports with a unique `API_TOKEN` / `VITE_API_TOKEN`
- captures baseline `/api/v1/settings`, `/api/v3/providers/openai/budget`, `/api/v1/openai/models`, and raw DB state before mutations
- primes `openai_all` dynamically from the live model list instead of hardcoding model ids
- drives Settings from the Playwright CLI wrapper through Essentials, Advanced, hidden Labs, channels, approvals, local runtime controls, and API-only config
- restores the captured baseline into the disposable schema and then drops the schema on teardown

Artifacts land under:

```text
output/playwright/settings-openai-*/
```

That directory contains snapshots, screenshots, API assertion payloads, setup/restore logs, and the final `summary.json` / `summary.md`.

## Packaged Desktop Smoke

Use this before cutting or validating a packaged release:

```bash
npm run pack:desktop
npm run test:e2e:desktop-packaged-smoke
```

This is a launch/create/connect smoke for packaged app output, not a full release acceptance matrix.

## Demo Media

```bash
npm run demo:capture
npm run demo:render
```

The render step writes:

- README GIF: `docs/media/agentic-workforce-demo.gif`
- larger MP4: `output/playwright/demo-render-*/agentic-workforce-demo.mp4`

## Artifact Locations

All generated E2E and demo artifacts stay under:

```text
output/playwright/
```

That includes screenshots, logs, summaries, and rendered media.

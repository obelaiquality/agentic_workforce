# Testing

This repo uses explicit test tiers instead of one blended “run everything” expectation.

## Quick Reference

| Tier | Command | When to run |
| --- | --- | --- |
| Unit + lint | `npm run validate` | Every PR |
| Desktop stable | `npm run test:e2e:desktop-stable` | UI or operator-path changes |
| Follow-up scenarios | `npm run test:e2e:followup:status-badge` | Follow-up execution changes |
| Comprehensive | `node scripts/playwright/run_comprehensive_e2e.mjs` | Full lifecycle (requires local model) |
| Nightly | `npm run test:e2e:nightly` | Broader regression |
| Packaged smoke | `npm run test:e2e:desktop-packaged-smoke` | Before cutting a release |
| Demo media | `npm run demo:capture && npm run demo:render` | After UI changes |

## Baseline Validation (493 tests)

Run this before every normal PR:

```bash
npm run validate
```

Covers:

- ESLint + Prettier
- Security guardrails (`npm run secrets:check`, `npm run audit:prod`)
- TypeScript strict typecheck
- Docs link validation
- 493 unit/integration tests (Vitest, node environment)
- Frontend build (Vite)
- Server build (tsup)

## Stable Desktop E2E

Use this for primary operator-path changes:

```bash
npm run test:e2e:desktop-stable
```

Covers:

- Launch Electron with custom app icon
- Settings Essentials 3-card layout (Runtime Mode, API Keys, Active Profile)
- Settings Advanced accordion behavior (Execution Profiles & Routing, only-one-open)
- Profile mutation round-trip (Deep Scope, Balanced via API verification)
- Projects tab navigation (My Projects / Connect New tabs)
- Connect New tab action buttons (Choose Local Repo, New Project, Connect GitHub)
- Create a blank project from an empty folder
- Apply a TypeScript App starter after blank project creation
- Blueprint View/Hide toggle on active project
- “Go to Work” button navigation from project card
- Codebase file browsing and source content verification
- Console event stream with dropdown filter popover
- Execute one bounded follow-up task (StatusBadge)
- Round-trip mission ticket permissions through `strict` and `balanced`
- Empty state detection for Codebase/Console when no project is active

Runtime presets:

```bash
# OpenAI-backed (recommended for first run)
OPENAI_API_KEY=... E2E_RUNTIME_PRESET=openai_all npm run test:e2e:desktop-stable

# Local model runtime (requires MLX-LM/Ollama on port 8000)
E2E_RUNTIME_PRESET=default npm run test:e2e:desktop-stable
```

## Follow-up Scenarios

Individual follow-up edit scenarios, each covering scaffold + targeted component creation:

```bash
npm run test:e2e:followup:status-badge
npm run test:e2e:followup:progress-bar
npm run test:e2e:followup:utility-module
npm run test:e2e:followup:api-stop
npm run test:e2e:followup:rename-component
```

## Comprehensive E2E (22 checks)

Full lifecycle test covering project creation through verification recheck. Requires a local model runtime on port 8000:

```bash
# Start local model first
python3 -m mlx_lm.server --model mlx-community/Qwen3.5-4B-4bit --host 127.0.0.1 --port 8000

# Then run
node scripts/playwright/run_comprehensive_e2e.mjs
```

Covers 22 checks:

- Model runtime health
- Project bootstrap + scaffold verification
- Codebase tree + file content APIs
- Console events (existence + verification event)
- Snapshot aggregation with console events
- Blueprint extraction
- UI navigation (Codebase panel file listing, Console panel)
- Follow-up execution via API (ThemeToggle component)
- Post-followup snapshot growth
- Independent verification recheck (lint + test + build)
- Stop action endpoint

ThemeToggle component checks are soft failures when using deterministic templates (expected behavior).

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

Use this before cutting or validating a packaged release on Linux or any environment with the full source prerequisites available:

```bash
npm run pack:desktop
npm run test:e2e:desktop-packaged-smoke
```

This is a launch/create/connect smoke for packaged app output, not a full release acceptance matrix.

## Packaged Desktop Launch Probe

Use this for cross-platform packaged verification when the environment can prove signed artifact startup and desktop preflight state but not the full Linux packaged smoke prerequisites:

```bash
npm run test:e2e:desktop-packaged-launch
```

This probe launches the packaged desktop executable, waits for the desktop shell, captures preflight status, and records whether the packaged app reached a bounded project flow. On macOS and Windows release runners it is expected to prove launch plus preflight and defer the full packaged task flow to manual release-candidate signoff.

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

## Platform Testing Status

| Platform | Unit tests | Desktop E2E | Comprehensive | Packaged smoke | Status |
| --- | --- | --- | --- | --- | --- |
| macOS (Apple Silicon) | 493/493 | Full pass | 18/18 hard checks | Verified | Primary development platform |
| macOS (Intel) | Expected pass | Not yet verified | Not yet verified | Not yet verified | Needs contributor |
| Ubuntu/Debian | CI pass | CI pass (xvfb) | Not yet verified | Verified | CI-validated |
| Other Linux | Expected pass | Not yet verified | Not yet verified | Not yet verified | Needs contributor |
| Windows | Expected pass | Not yet verified | Not yet verified | Not yet verified | Needs contributor |

### What "Not yet verified" means

The codebase uses cross-platform Node.js and Electron APIs, and `scripts/shellDetect.ts` handles platform-specific shell detection. The Playwright E2E scripts use `playwright-core` with `_electron.launch()` which works cross-platform. However, we have not yet run the full E2E suite on these platforms in a real environment.

### How you can help

If you have access to Linux (non-Ubuntu) or Windows, we would love your help verifying the E2E test suite. See [CONTRIBUTING.md](../CONTRIBUTING.md) for details on how to run the tests and report results. Even a simple "I ran `npm run validate` on Windows and it passed" is valuable signal.

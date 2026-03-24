# Contributing

## Ground Rules

- Keep changes scoped and reviewable.
- Do not include secrets, local machine paths, or generated release artifacts in commits.
- Prefer small PRs that keep tests and docs in sync with the behavior change.

## Local Setup

```bash
npm install
cp .env.example .env
npm run doctor
npm run db:up
npx prisma db push
npx prisma generate
npm run dev:desktop
```

Start with the desktop app unless your change is explicitly about the browser preview or CLI companion. The product and docs are optimized around desktop-first first success.

## Before Opening A PR

Run the same baseline checks that CI expects:

```bash
npm run lint
npm run typecheck
npm run check:docs
npm test
npm run build
npm run build:server
```

If your change touches Electron packaging or desktop startup, also run:

```bash
npm run build:desktop
```

If your change touches end-user flows, docs, or onboarding, also run:

```bash
npm run test:e2e:desktop-stable
```

If your change touches advanced flows, follow-up execution, browser preview, or CLI workflows, use the nightly/manual suite as appropriate:

```bash
npm run test:e2e:nightly
```

## Pull Request Expectations

- Describe the user-facing behavior change.
- Call out any config, migration, or runtime impacts.
- Include screenshots for visible UI changes.
- Mention any test gaps if full verification was not practical.

## Coding Notes

- Desktop is the primary supported operator path.
- Browser preview behavior should not be treated as feature parity.
- Experimental autonomy, benchmarks, and distillation must stay opt-in and clearly labeled.
- Security-sensitive changes should preserve local trust boundaries and write-only handling for secrets.

## Architecture And Test Map

- `src/app/`: desktop-first React surfaces. `Work`, `Projects`, `Codebase`, `Console`, and `Settings` should stay readable for first-time users.
- `src/server/routes/`: public local API boundaries. Keep route additions aligned with auth, approval, and secret-handling expectations.
- `src/server/services/`: execution, repo, routing, and mission-control orchestration. Changes here usually need targeted tests plus a docs note if behavior changes.
- `scripts/playwright/`: source of truth for desktop acceptance, nightly suites, demo capture, and media rendering. Prefer extending the existing script harness instead of introducing a second E2E stack.

## Test Tiers

- PR gate: `npm run validate`
- Stable desktop acceptance: `npm run test:e2e:desktop-stable`
- Nightly/manual advanced coverage: `npm run test:e2e:nightly`
- Packaged release smoke: `npm run test:e2e:desktop-packaged-smoke`

## Fixtures And Screenshots

- Keep E2E fixtures deterministic. Reuse the seeded temporary repos in `scripts/playwright/` instead of inventing ad hoc repos inside docs or tests.
- UI screenshots and README media should come from the scripted capture/render flow:

```bash
npm run demo:capture
npm run demo:render
```

- Store the README GIF in `docs/media/`. Keep larger video artifacts out of git history and attach them to releases or external docs.

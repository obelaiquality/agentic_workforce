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

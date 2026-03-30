# Contributing

Welcome! Whether you are fixing a typo, testing on a new platform, or building a new feature, we appreciate your help.

## Where Help Is Most Needed

These are the highest-impact areas for new contributors:

### Cross-Platform Testing

The E2E test suite is verified on macOS (Apple Silicon) and Ubuntu (CI). We need help confirming it works on:

- **Windows 10/11** — Run `npm run validate` and `npm run test:e2e:desktop-stable`, then report results in a GitHub issue.
- **macOS Intel** — Same as above.
- **Linux (Fedora, Arch, etc.)** — Same as above.
- **Local runtime backends** — Test with Ollama (Windows/Linux), vLLM (NVIDIA), SGLang, or llama.cpp and report any issues.

Even a short issue saying "I ran `npm run validate` on Windows 11 and all 493 tests passed" is extremely valuable. Use the `platform-testing` issue label.

### Other Ways to Contribute

- **Bug reports** — Include OS, Node version, install path, and relevant logs or screenshots.
- **Documentation** — Improve guides for platforms and runtimes you use.
- **UI/UX feedback** — File issues with screenshots showing layout problems on your display.
- **Code contributions** — Pick up issues labeled `good first issue` or `help wanted`.

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
npm run validate
npm run test:e2e:cli-smoke
```

If your change touches Electron packaging or desktop startup, also run:

```bash
npm run build:desktop
```

If your change touches end-user flows, docs, onboarding, or release plumbing, also run:

```bash
npm run test:e2e:desktop-stable
```

If your change touches packaged releases, also run:

```bash
npm run pack:desktop
npm run test:e2e:desktop-packaged-smoke
```

If your change touches follow-up execution, browser preview, CLI workflows, or specialized workflows, use the nightly/manual suite as appropriate:

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
- Benchmarks, Labs, distillation, and autonomy flows must stay clearly labeled and documented.
- Security-sensitive changes should preserve local trust boundaries and write-only handling for secrets.
- GitHub Releases are the canonical desktop distribution path. Do not re-enable repo-root npm publication without introducing a dedicated publishable package.

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
- macOS/Windows packaged launch plus preflight proof in release CI: `npm run test:e2e:desktop-packaged-launch`

Mainline CI treats stable desktop E2E as a protected-branch check for pushes and same-repo pull requests. Fork PRs keep the normal secretless skip path because repository secrets are not exposed there.

## Fixtures And Screenshots

- Keep E2E fixtures deterministic. Reuse the seeded temporary repos in `scripts/playwright/` instead of inventing ad hoc repos inside docs or tests.
- UI screenshots and README media should come from the scripted capture/render flow:

```bash
npm run demo:capture
npm run demo:render
```

- Store the README GIF in `docs/media/`. Keep larger video artifacts out of git history and attach them to releases or external docs.

## Platform Testing Report Template

If you are testing on a new platform, please include this information in your issue or PR:

```
**Platform**: (e.g., Windows 11 23H2, Fedora 41, macOS 14 Intel)
**Node version**: (e.g., 20.11.1)
**PostgreSQL**: (e.g., 16.2 via Docker / native install)
**Local runtime**: (e.g., Ollama 0.5.1 / MLX-LM 0.31 / none — OpenAI only)

### Results
- [ ] `npm run validate` — pass/fail (X/493 tests)
- [ ] `npm run test:e2e:desktop-stable` — pass/fail
- [ ] `npm run test:e2e:desktop-packaged-smoke` — pass/fail/skipped
- [ ] App launches and renders correctly — yes/no

### Notes
(Any issues, workarounds, or observations)
```

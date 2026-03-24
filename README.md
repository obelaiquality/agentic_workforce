# Agentic Workforce

Agentic Workforce is a local-first desktop coding agent for real repositories. It connects to a repo, plans a bounded task, executes in a managed worktree, verifies the result, and keeps the evidence visible in one operator UI.

The flagship product surface is the Electron desktop app. A lightweight CLI companion is available for source users who want a faster terminal wedge into the same local API.

## Why People Use It

- Connect a real local repo instead of a toy sandbox.
- Keep execution scoped to managed worktrees rather than mutating your primary checkout directly.
- Review route context, approvals, console output, and verification evidence in one place.
- Switch between local OpenAI-compatible runtimes and OpenAI-assisted execution without changing product surfaces.

## 2-Minute Source Quickstart

This is the fastest supported source path if Node and Docker are already available on your machine.

1. Install dependencies and create a local env file.

```bash
npm install
cp .env.example .env
```

2. Add your OpenAI key to `.env`.

```bash
OPENAI_API_KEY=your_key_here
```

3. Start local infrastructure and launch the desktop app.

```bash
npm run db:up
npx prisma db push
npx prisma generate
npm run dev:desktop
```

4. Open `Projects`, connect a repo, then switch to `Work` and run one bounded task.

Recommended first prompts:

- `Add a status badge component with tests`
- `Rename the hero headline and update the test`
- `Scaffold a TypeScript app with tests and documentation`

## Install Paths

### Binary

Use packaged desktop artifacts from tagged GitHub releases when available.

- macOS: `.dmg`, `.zip`
- Linux: `.AppImage`, `.deb`
- Windows: `nsis`, `.zip`

Details: [docs/install.md](docs/install.md)

### Source + OpenAI

This is the recommended public beta setup path. It avoids requiring a local model runtime for first success.

Details: [docs/install.md](docs/install.md)

### Source + Local Runtime

Use this when you explicitly want a fully local model path.

Details: [docs/runbooks/local-runtime.md](docs/runbooks/local-runtime.md)

## Product Surfaces

The launch-facing product story is intentionally narrow:

- `Projects` for connecting or creating a project
- `Work` for task entry, route review, execution, and evidence summary
- `Codebase` for file inspection and context navigation
- `Console` for live execution and verification events
- `Settings` for essentials, advanced routing, and opt-in Labs

Benchmarks stay in-repo as evaluation infrastructure.

## Screenshots

**Work**

![Work Surface](docs/screenshots/01-shell.png)

**Projects**

![Projects Surface](docs/screenshots/01b-projects.png)

**Codebase**

![Codebase Surface](docs/screenshots/03-codebase.png)

## CLI Companion

The CLI is a beta terminal companion to the same local API. It is useful for source users who want to connect a repo, plan or run an objective, watch console progress, or read the latest report without living in the desktop UI.

Examples:

```bash
npm run cli -- projects
npm run cli -- connect /absolute/path/to/repo
npm run cli -- plan --project <project-id> --prompt "Add a status badge component with tests"
npm run cli -- run --project <project-id> --prompt "Rename the hero headline and update the test"
```

Details: [docs/cli.md](docs/cli.md)

## Guided Demo Repo

If you want a known-small repo for demos, use the React dashboard fixture in [docs/demo-react-dashboard.md](docs/demo-react-dashboard.md).

## Docs

- Install and support matrix: [docs/install.md](docs/install.md)
- First-run onboarding: [docs/onboarding.md](docs/onboarding.md)
- Advanced local runtime setup: [docs/runbooks/local-runtime.md](docs/runbooks/local-runtime.md)
- Troubleshooting: [docs/troubleshooting.md](docs/troubleshooting.md)
- CLI companion: [docs/cli.md](docs/cli.md)
- Guided demo repo: [docs/demo-react-dashboard.md](docs/demo-react-dashboard.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security: [SECURITY.md](SECURITY.md)
- Support: [SUPPORT.md](SUPPORT.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)

## Release And Support Notes

| Area | Status |
| --- | --- |
| Desktop app | Public beta |
| CLI companion | Beta |
| Browser preview | Limited, not a replacement for the desktop app |
| Packaged binaries | Beta release artifacts |
| Fully local runtime path | Advanced |

- Public releases should be tagged and shipped with changelog entries.
- PR CI is expected to stay green before a public beta release is cut.
- Browser preview is for inspection and light settings work, not full local operator parity.

## Security

- Local API auth is header-only with `x-local-api-token`; query-string tokens and renderer token bridges are not used.
- Provider API keys are stored outside normal settings JSON and are treated as write-only values in the UI.
- Experimental remote channels and Labs features are opt-in and off the primary launch path.
- Standalone `npm run dev:api` now requires a non-empty `API_TOKEN`; browser preview is dev-only and requires a matching `VITE_API_TOKEN` when you run the renderer outside Electron.
- Existing plaintext provider keys are migrated into the encrypted desktop secret store on first run when secure local storage is available. Outside Electron, the standalone API auto-provisions a per-user local secret-store key if one does not already exist.

Report vulnerabilities through [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

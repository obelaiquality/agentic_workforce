# Agentic Workforce

[![CI](https://github.com/obelaiquality/agentic_workforce/actions/workflows/ci.yml/badge.svg)](https://github.com/obelaiquality/agentic_workforce/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/obelaiquality/agentic_workforce?display_name=tag&label=latest%20release)](https://github.com/obelaiquality/agentic_workforce/releases)
[![License](https://img.shields.io/github/license/obelaiquality/agentic_workforce)](LICENSE)
[![Desktop 1.0](https://img.shields.io/badge/desktop-1.0-0f766e)](docs/install.md)

Agentic Workforce is a desktop-first coding agent for real local repositories. It connects to a repo, scopes a bounded task, executes in a managed worktree, verifies the result, and keeps the route, evidence, and logs visible in one operator UI. If you want the easiest first success, start with the desktop app and the OpenAI-backed source path.

![Agentic Workforce demo](docs/media/agentic-workforce-demo.gif)

## Choose Your Path

| Path | Best for | What you need |
| --- | --- | --- |
| Binary | Operators who want the shortest install | A signed GitHub Release plus the runtime prerequisites called out in the release notes |
| Source + OpenAI | First-time source users | Node 20+, PostgreSQL, Docker recommended, `OPENAI_API_KEY` |
| Source + local runtime | Fully local operators | Node 20+, PostgreSQL, local OpenAI-compatible runtime, optional Rust for packaging |

More detail: [Install](docs/install.md) · [Support matrix](docs/support-matrix.md) · [Configuration](docs/configuration.md) · [Known limitations](docs/known-limitations.md)

## Fastest First Success

The recommended source path is desktop + OpenAI. GitHub Releases are the canonical artifact source for packaged desktop builds; the repo root is not published as an npm package.

```bash
npm install
cp .env.example .env

# edit .env and set OPENAI_API_KEY=your_key_here

npm run db:up
npx prisma db push
npx prisma generate
npm run dev:desktop
```

Then:

1. Open `Projects` and either create a new project or connect a local repo.
2. Return to `Work`, write one bounded task, and click `Review plan`.
3. Run the task and inspect the result in `Codebase` and `Console`.

Recommended first prompts:

- `Add a status badge component with tests`
- `Rename the hero headline and update the test`
- `Document the local runtime setup in the README`

## What Works Today

- Desktop app flow for `Projects`, `Work`, `Codebase`, `Console`, and `Settings`
- Managed-worktree execution against real local repos
- New project bootstrap from an empty folder
- Route review, execution, approvals, verification, and report generation
- CLI companion for connect, plan, run, and report flows against the same local API
- Stable source validation via `npm run validate`

## Specialized Workflows

- Browser preview: useful for inspection and light settings work, not full operator parity
- Fully local runtime and multi-runtime failover: supported, but it requires extra operator setup
- Benchmarks, Labs, training workflows, and channels: supported as specialized workflows with dedicated runbooks
- Packaged desktop releases ship through GitHub Releases with per-platform notes, signatures, and checksums

Read this before filing a bug about missing functionality: [Known limitations](docs/known-limitations.md)

## Demo And Docs

- Demo guide, transcript, and media pipeline: [docs/demo.md](docs/demo.md)
- Install paths and support matrix: [docs/install.md](docs/install.md)
- Surface-by-surface support commitments: [docs/support-matrix.md](docs/support-matrix.md)
- First-run onboarding: [docs/onboarding.md](docs/onboarding.md)
- Environment and runtime configuration: [docs/configuration.md](docs/configuration.md)
- FAQ: [docs/faq.md](docs/faq.md)
- Testing matrix and E2E tiers: [docs/testing.md](docs/testing.md)
- Troubleshooting: [docs/troubleshooting.md](docs/troubleshooting.md)
- CLI companion: [docs/cli.md](docs/cli.md)
- Architecture overview: [docs/architecture.md](docs/architecture.md)
- Guided demo fixture repo: [docs/demo-react-dashboard.md](docs/demo-react-dashboard.md)
- Release checklist: [docs/release-checklist.md](docs/release-checklist.md)
- Release notes template: [docs/release-notes-template.md](docs/release-notes-template.md)

## Testing

Core validation:

```bash
npm run validate
```

Stable desktop acceptance:

```bash
npm run test:e2e:desktop-stable
```

Nightly/manual coverage:

```bash
npm run test:e2e:nightly
```

Demo media:

```bash
npm run demo:capture
npm run demo:render
```

The E2E tiers and prerequisites are documented in [docs/testing.md](docs/testing.md).

## Support And Open Source Guidance

- Usage questions and setup issues: [SUPPORT.md](SUPPORT.md)
- Vulnerability reporting: [SECURITY.md](SECURITY.md)
- Contributing guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Roadmap: [ROADMAP.md](ROADMAP.md)
- Maintainers: [MAINTAINERS.md](MAINTAINERS.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)

## Security

- Local API auth is header-only with `x-local-api-token`.
- Provider keys are handled as write-only settings and stored outside normal settings JSON.
- Standalone `npm run dev:api` requires a non-empty `API_TOKEN`.
- Browser preview requires a matching `VITE_API_TOKEN` because the local API no longer accepts query-string tokens.
- Experimental channels and autonomy surfaces are opt-in and not part of the default launch path.

Report vulnerabilities through [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

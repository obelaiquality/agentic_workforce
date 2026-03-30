# Agentic Workforce

[![CI](https://github.com/obelaiquality/agentic_workforce/actions/workflows/ci.yml/badge.svg)](https://github.com/obelaiquality/agentic_workforce/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/obelaiquality/agentic_workforce?display_name=tag&label=latest%20release)](https://github.com/obelaiquality/agentic_workforce/releases)
[![License](https://img.shields.io/github/license/obelaiquality/agentic_workforce)](LICENSE)
[![Desktop 1.0](https://img.shields.io/badge/desktop-1.0-0f766e)](docs/install.md)
[![macOS](https://img.shields.io/badge/macOS-verified-success)](docs/testing.md)
[![Linux CI](https://img.shields.io/badge/Linux-CI%20verified-success)](docs/testing.md)
[![Windows](https://img.shields.io/badge/Windows-needs%20testing-yellow)](docs/testing.md)

A desktop-first coding agent for real local repositories. Connect a repo, scope a bounded task, execute in a managed worktree, verify the result, and keep the route, evidence, and logs visible in one operator UI.

Runs locally with [Qwen](https://huggingface.co/mlx-community/Qwen3.5-4B-4bit) via MLX/Ollama/vLLM, or escalates to OpenAI when you need it. Your code never leaves your machine unless you choose to.

![Agentic Workforce demo](docs/media/agentic-workforce-demo.gif)

## Choose Your Path

| Path | Best for | What you need |
| --- | --- | --- |
| **Binary** | Operators who want the shortest install | A signed [GitHub Release](https://github.com/obelaiquality/agentic_workforce/releases) plus runtime prerequisites from the release notes |
| **Source + OpenAI** | First-time source users (recommended) | Node 20+, PostgreSQL, Docker recommended, `OPENAI_API_KEY` |
| **Source + local runtime** | Fully local, no cloud calls | Node 20+, PostgreSQL, MLX-LM/Ollama/vLLM on port 8000, optional Rust for packaging |

More detail: [Install](docs/install.md) · [Support matrix](docs/support-matrix.md) · [Configuration](docs/configuration.md) · [Known limitations](docs/known-limitations.md)

## Fastest First Success

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

1. Open **Projects** > **Connect New** > create a new project or connect a local repo.
2. Switch to **My Projects** and click **Apply Starter** to scaffold a TypeScript app.
3. Go to **Work**, write one bounded task, and click **Run task**.
4. Inspect the result in **Codebase** and **Console**.

Recommended first prompts:

- `Add a status badge component with tests`
- `Rename the hero headline and update the test`
- `Document the local runtime setup in the README`

## What Works Today

- **Desktop app** with tab-based Projects, kanban Work surface, Codebase browser, Console event stream, and Settings with accordion-based Advanced configuration
- **Managed-worktree execution** against real local repos with verification and rollback
- **New project bootstrap** from an empty folder with TypeScript App starter
- **Route review, execution, approvals, verification**, and report generation
- **Local model runtime** with MLX-LM (Apple Silicon), Ollama, vLLM, SGLang, llama.cpp, or TensorRT-LLM
- **OpenAI escalation** for complex tasks with configurable model roles and budget controls
- **CLI companion** for connect, plan, run, and report flows against the same local API
- **493 unit/integration tests** and multi-tier E2E validation (stable desktop, follow-up scenarios, comprehensive lifecycle, packaged smoke)

## Testing

```bash
npm run validate                          # 493 unit tests, lint, typecheck, builds
npm run test:e2e:desktop-stable           # Stable desktop acceptance (UI + execution)
npm run test:e2e:followup:status-badge    # Follow-up scenario
npm run test:e2e:nightly                  # Broader regression coverage
npm run demo:capture && npm run demo:render  # Regenerate README GIF
```

### Platform Status

| Platform | Unit tests | Desktop E2E | Status |
| --- | --- | --- | --- |
| macOS (Apple Silicon) | 493/493 | Full pass (local + OpenAI) | Primary platform |
| Ubuntu/Debian | CI pass | CI pass (xvfb) | CI-validated |
| macOS (Intel) | Expected pass | Not yet verified | **Help wanted** |
| Windows | Expected pass | Not yet verified | **Help wanted** |
| Other Linux | Expected pass | Not yet verified | **Help wanted** |

Full testing documentation: [docs/testing.md](docs/testing.md)

## Contributing

We welcome contributions of all kinds. Some areas where help is especially valuable:

- **Windows and Linux testing** — Run `npm run validate` and `npm run test:e2e:desktop-stable` on your platform and report results. Even a "it passed on Windows 11" is helpful.
- **Local runtime backends** — Test with Ollama, vLLM, SGLang, or llama.cpp on different hardware configurations.
- **Bug reports** — File issues with OS, install path, and logs attached.
- **Documentation** — Improve guides for platforms and runtimes you use.
- **Code contributions** — See [CONTRIBUTING.md](CONTRIBUTING.md) for ground rules.

### Local Setup for Contributors

```bash
git clone https://github.com/obelaiquality/agentic_workforce.git
cd agentic_workforce
npm install
cp .env.example .env
npm run doctor          # Check prerequisites
npm run db:up           # Start PostgreSQL
npx prisma db push && npx prisma generate
npm run dev:desktop     # Launch the app
```

Run `npm run validate` before submitting a PR. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full checklist.

## Specialized Workflows

- **Browser preview**: useful for inspection and light settings work, not full operator parity
- **Fully local runtime**: supported with MLX-LM (macOS), Ollama (cross-platform), vLLM/SGLang (NVIDIA), llama.cpp (portable)
- **Benchmarks, Labs, training workflows, and channels**: supported as specialized workflows with dedicated runbooks
- **Packaged desktop releases**: ship through GitHub Releases with per-platform notes, signatures, and checksums

Read this before filing a bug about missing functionality: [Known limitations](docs/known-limitations.md)

## Documentation

| Guide | Description |
| --- | --- |
| [Install](docs/install.md) | Three install paths (binary, source + OpenAI, source + local) |
| [Onboarding](docs/onboarding.md) | First 30 minutes walkthrough |
| [Configuration](docs/configuration.md) | Environment variables and runtime settings |
| [Testing](docs/testing.md) | Test tiers, E2E coverage, platform matrix |
| [Architecture](docs/architecture.md) | System design and component overview |
| [CLI](docs/cli.md) | CLI companion for headless workflows |
| [Demo](docs/demo.md) | Demo assets and media pipeline |
| [FAQ](docs/faq.md) | Common questions |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |
| [Support matrix](docs/support-matrix.md) | Surface-by-surface support commitments |
| [Release checklist](docs/release-checklist.md) | Release process |
| [SBOM](docs/sbom.production.cdx.json) | Production software bill of materials |

## Community

- Usage questions and setup issues: [SUPPORT.md](SUPPORT.md)
- Vulnerability reporting: [SECURITY.md](SECURITY.md)
- Contributing guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Roadmap: [ROADMAP.md](ROADMAP.md)
- Maintainers: [MAINTAINERS.md](MAINTAINERS.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## Security

- Local API auth is header-only with `x-local-api-token`.
- Provider keys are handled as write-only settings and stored outside normal settings JSON.
- Standalone `npm run dev:api` requires a non-empty `API_TOKEN`.
- Browser preview requires a matching `VITE_API_TOKEN` because the local API no longer accepts query-string tokens.
- Channel integrations and autonomy surfaces are opt-in and not part of the default launch path.

Report vulnerabilities through [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

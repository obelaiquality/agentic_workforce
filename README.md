# Agentic Workforce

<p align="center">
  <img src="docs/media/hero-banner.svg" alt="Agentic Workforce — Desktop-first coding agent for real local repos" width="960"/>
</p>

<p align="center">
  <a href="https://github.com/obelaiquality/agentic_workforce/actions/workflows/ci.yml"><img src="https://github.com/obelaiquality/agentic_workforce/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/obelaiquality/agentic_workforce"><img src="https://codecov.io/gh/obelaiquality/agentic_workforce/branch/main/graph/badge.svg" alt="Coverage"></a>
  <a href="https://github.com/obelaiquality/agentic_workforce/releases"><img src="https://img.shields.io/github/v/release/obelaiquality/agentic_workforce?display_name=tag&label=latest%20release" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/obelaiquality/agentic_workforce" alt="License"></a>
  <a href="docs/install.md"><img src="https://img.shields.io/badge/desktop-1.0-0f766e" alt="Desktop 1.0"></a>
  <a href="docs/testing.md"><img src="https://img.shields.io/badge/macOS-verified-success" alt="macOS"></a>
  <a href="docs/testing.md"><img src="https://img.shields.io/badge/Linux-CI%20verified-success" alt="Linux CI"></a>
  <a href="docs/testing.md"><img src="https://img.shields.io/badge/Windows-needs%20testing-yellow" alt="Windows"></a>
</p>

<p align="center">
  Connect a repo, scope a bounded task, execute in a managed worktree, verify the result.<br>
  Your code never leaves your machine unless you choose to.
</p>

<p align="center">
  <img src="docs/media/agentic-workforce-demo.gif" alt="Agentic Workforce demo" width="720"/>
</p>

---

## Quick Start with OpenAI (Recommended)

The fastest way to get running. You just need Node.js, PostgreSQL, and an OpenAI API key.

```bash
git clone https://github.com/obelaiquality/agentic_workforce.git
cd agentic_workforce
npm install
cp .env.example .env
```

Open `.env` and add your key:

```env
OPENAI_API_KEY=sk-your-key-here
```

Then start everything:

```bash
npm run db:up              # Start PostgreSQL (Docker) — or use your own Postgres
npx prisma db push         # Create database tables
npx prisma generate        # Generate Prisma client
npm run dev:desktop        # Launch the app
```

That's it. The app opens, and you're ready to connect a repo and run your first task.

> **Don't have Docker?** Just point `DATABASE_URL` in `.env` to any running PostgreSQL instance. See [Install guide](docs/install.md) for details.

### Your First Task

1. Open **Projects** > **Connect New** > create a new project or connect a local repo
2. Switch to **My Projects** and click **Apply Starter** to scaffold a TypeScript app
3. Go to **Work**, write a bounded task, and click **Run task**
4. Inspect the result in **Codebase** and **Console**

Try these prompts to start:

- `Add a status badge component with tests`
- `Rename the hero headline and update the test`
- `Add a dark mode toggle with localStorage persistence`

---

## Quick Start with Local Models (No Cloud)

For users who want everything running locally with no API keys and no cloud calls. Your code and prompts stay entirely on your machine.

### macOS (Apple Silicon)

```bash
# Install the model server
pip3 install mlx-lm

# Download and start the model (one-time ~2.5 GB download)
python3 -m mlx_lm.server \
  --model mlx-community/Qwen3.5-4B-4bit \
  --host 127.0.0.1 --port 8000
```

### macOS (Intel) / Linux / Windows

```bash
# Install Ollama from https://ollama.com
ollama pull qwen2.5-coder:3b
ollama serve    # Starts on port 11434 by default
```

Then set up the app (same as OpenAI path, minus the API key):

```bash
git clone https://github.com/obelaiquality/agentic_workforce.git
cd agentic_workforce
npm install
cp .env.example .env
```

Open `.env` and configure for local models:

```env
# For MLX-LM (Apple Silicon):
INFERENCE_PROVIDER=openai-compatible
LOCAL_INFERENCE_URL=http://127.0.0.1:8000/v1

# For Ollama:
INFERENCE_PROVIDER=ollama-openai
LOCAL_INFERENCE_URL=http://127.0.0.1:11434/v1
```

```bash
npm run db:up
npx prisma db push
npx prisma generate
npm run dev:desktop
```

> **GPU users:** vLLM and SGLang are supported for NVIDIA GPUs with better throughput. See [Configuration](docs/configuration.md) for setup.

---

## Choose Your Path

| Path | Best for | What you need |
| --- | --- | --- |
| **OpenAI** | Fastest setup, strongest models | Node 20+, PostgreSQL, `OPENAI_API_KEY` |
| **Local models** | Full privacy, no cloud calls | Node 20+, PostgreSQL, MLX-LM / Ollama / vLLM |
| **Binary** | Shortest install, no source checkout | A signed [GitHub Release](https://github.com/obelaiquality/agentic_workforce/releases) |
| **Hybrid** | Best of both — local for fast tasks, OpenAI for complex ones | All of the above |

More detail: [Install](docs/install.md) · [Support matrix](docs/support-matrix.md) · [Configuration](docs/configuration.md) · [Known limitations](docs/known-limitations.md)

---

## What Works Today

- **Desktop app** with tab-based Projects, kanban Work surface, Codebase browser, Console event stream, and Settings with accordion-based Advanced configuration
- **Managed-worktree execution** against real local repos with verification and rollback
- **New project bootstrap** from an empty folder with TypeScript App starter
- **Route review, execution, approvals, verification**, and report generation
- **Local model runtime** with MLX-LM (Apple Silicon), Ollama (cross-platform), vLLM, SGLang, llama.cpp, or TensorRT-LLM
- **OpenAI escalation** for complex tasks with configurable model roles and budget controls
- **CLI companion** for connect, plan, run, and report flows against the same local API
- **918 unit/integration tests** and multi-tier E2E validation (stable desktop, follow-up scenarios, comprehensive lifecycle, packaged smoke)

## Testing

```bash
npm run validate                          # 918 unit tests, lint, typecheck, builds
npm run test:e2e:desktop-stable           # Stable desktop acceptance (UI + execution)
npm run test:e2e:followup:status-badge    # Follow-up scenario
npm run test:e2e:nightly                  # Broader regression coverage
npm run demo:capture && npm run demo:render  # Regenerate README GIF
```

### Platform Status

| Platform | Unit tests | Desktop E2E | Status |
| --- | --- | --- | --- |
| macOS (Apple Silicon) | 918/918 | Full pass (local + OpenAI) | Primary platform |
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

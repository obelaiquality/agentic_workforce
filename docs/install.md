# Install Agentic Workforce

Agentic Workforce supports three install lanes. Pick the smallest one that matches your goal.

Before you start, read:

- [docs/configuration.md](configuration.md) for env vars and runtime choices
- [docs/known-limitations.md](known-limitations.md) for browser-preview, Labs, and packaging caveats
- [docs/testing.md](testing.md) if you plan to contribute or validate a release branch

## Support Matrix

| Install lane | Best for | Requires |
| --- | --- | --- |
| Binary | Beta testers and non-contributors | Release artifact + local prerequisites for the chosen runtime |
| Source + OpenAI | Fastest public source setup | Node 20+, PostgreSQL, Docker recommended, OpenAI API key |
| Source + local runtime | Fully local operator path | Node 20+, PostgreSQL, Docker recommended, Python/runtime stack, optional Rust for full packaging |

## 1. Binary

Use tagged GitHub releases when available.

Current packaging targets:

- macOS: `.dmg`, `.zip`
- Linux: `.AppImage`, `.deb`
- Windows: `nsis`, `.zip`

Expected outcome:

- You install a packaged desktop app.
- You still need the local services documented in the release notes for the chosen runtime mode.
- The desktop app remains the primary supported operator surface.

## 2. Source + OpenAI

This is the recommended public beta path.

### Prerequisites

- Node.js 20+
- PostgreSQL reachable on `127.0.0.1:5433`
- Docker recommended for the easiest Postgres path
- An `OPENAI_API_KEY`

### Steps

```bash
npm install
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`, then:

```bash
npm run db:up
npx prisma db push
npx prisma generate
npm run dev:desktop
```

Expected outcome:

- Electron launches
- The local API is reachable on `127.0.0.1:8787`
- You can connect a repo from `Projects` and switch to `Work` for planning/execution

## 3. Source + Local Runtime

Use this when you want a fully local model path.

### Additional prerequisites

- Python 3.11+
- One supported local runtime such as MLX, Ollama, vLLM, SGLang, or llama.cpp
- Rust stable only if you need full local packaging or sidecar rebuild work

Follow the advanced runbook: [docs/runbooks/local-runtime.md](runbooks/local-runtime.md)

Expected outcome:

- Same desktop app workflow as the OpenAI path
- Local Qwen or another OpenAI-compatible endpoint handles the model work

## Public Beta Notes

- `npm run start:desktop` remains the full bootstrap path.
- `npm run dev:desktop` is the faster path when your database and runtime are already healthy.
- Browser preview via `npm run dev` and `npm run dev:api` is useful for inspection, not for the full local operator flow. Standalone `npm run dev:api` requires a non-empty `API_TOKEN`, and the renderer must use the same value via `VITE_API_TOKEN` because local API auth is header-only.
- Advanced/internal settings live in `.env.advanced.example` and are not required for first success.
- On desktop, existing plaintext provider API keys are migrated into the encrypted local secret store on first run when secure OS-backed storage is available. Outside Electron, the standalone API auto-provisions a per-user local secret-store key for the same write-only settings flow.

Next steps:

- [Onboarding](onboarding.md)
- [Demo guide](demo.md)
- [Troubleshooting](troubleshooting.md)

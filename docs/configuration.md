# Configuration

This page is the single source of truth for environment setup. If you only want first success, start with the `required` section and stop there.

## Required

| Variable | Why it exists | Typical value |
| --- | --- | --- |
| `API_PORT` | Local API port for desktop or standalone preview | `8787` |
| `API_TOKEN` | Required for standalone `npm run dev:api` and browser preview auth | `agentic-local-dev-token` |
| `DATABASE_URL` | Prisma/Postgres connection string | `postgresql://agentic:agentic@127.0.0.1:5433/agentic_workforce?schema=public` |

Notes:

- `API_TOKEN` must be non-empty for standalone API startup.
- If you run the renderer outside Electron, set the same value in `VITE_API_TOKEN`.
- Desktop users normally do not need to think about `VITE_API_TOKEN` unless they are explicitly using browser preview mode.

## Common Optional

These are the most common runtime choices after the required variables.

| Variable | Use it when | Typical value |
| --- | --- | --- |
| `OPENAI_API_KEY` | You want the recommended first-run source path | `sk-...` |
| `OPENAI_RESPONSES_BASE_URL` | You need a non-default Responses endpoint | `https://api.openai.com/v1` |
| `OPENAI_RESPONSES_MODEL` | You want a different default OpenAI model | `gpt-5-nano` |
| `ONPREM_QWEN_BASE_URL` | You want a local OpenAI-compatible runtime | `http://127.0.0.1:8000/v1` |
| `ONPREM_QWEN_MODEL` | Your local runtime uses a different model id | `mlx-community/Qwen3.5-4B-4bit` |
| `QWEN_COMMAND` / `QWEN_ARGS` | You use the optional Qwen CLI provider path | `qwen` / `--auth-type qwen-oauth --output-format text` |

Recommended first success:

- Set `OPENAI_API_KEY`
- Keep the rest at defaults
- Use `Settings > Essentials` to confirm runtime mode and account state

## Advanced

These settings are for maintainers, release engineers, or power users. Prefer `.env.advanced.example` instead of expanding your normal `.env` by default.

High-signal advanced groups:

- Execution tuning: `EXECUTION_*`
- Sidecar overrides: `RUST_SIDECAR_*`
- GitHub App / relay wiring: `GITHUB_APP_*`
- Distillation tooling: `DISTILL_*`

Additional advanced notes:

- Outside Electron, the API auto-provisions a per-user secret-store key when one does not already exist.
- You can override the fallback key location with `APP_SECRETBOX_KEY_FILE` for testing or custom automation.
- Experimental channel signing secrets and provider keys are stored outside normal settings JSON.

## Which Mode Should I Choose?

- `Source + OpenAI`: best for first-time success
- `Source + local runtime`: best when local inference is the goal, not the fastest install
- `Browser preview`: only for inspection and light settings work

If you are still uncertain, read [known limitations](known-limitations.md) and [FAQ](faq.md).

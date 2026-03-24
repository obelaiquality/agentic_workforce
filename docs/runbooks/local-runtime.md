# Runbook: Local Runtime (Advanced)

## Goal

Run the app with a fully local OpenAI-compatible runtime instead of the recommended OpenAI-assisted quickstart.

## Default Runtime

- provider: `onprem-qwen`
- default coding model: `Qwen 3.5 4B`
- default Apple Silicon runtime artifact: `mlx-community/Qwen3.5-4B-4bit`
- utility model: `Qwen/Qwen3.5-0.8B`
- default base URL: `http://127.0.0.1:8000/v1`

## Recommended Start Path (Apple Silicon)

```bash
python3 -m pip install --upgrade mlx-lm
python3 -m mlx_lm.server --model mlx-community/Qwen3.5-4B-4bit --host 127.0.0.1 --port 8000 --temp 0.15 --max-tokens 1600
```

## Fallback Server

```bash
python3 scripts/local_qwen_openai_server.py --backend transformers --model Qwen/Qwen3.5-4B --host 127.0.0.1 --port 8000
```

## Health Checks

```bash
curl -sS http://127.0.0.1:8000/health
curl -sS http://127.0.0.1:8000/v1/models
```

Healthy signs:
- `/health` returns success
- `/v1/models` lists the active model
- the runtime answers normal OpenAI-compatible model requests

## Configure the App

1. Open `Settings`.
2. Stay in `Essentials`.
3. Switch runtime mode back to `Local Qwen`.
4. Confirm base URL `http://127.0.0.1:8000/v1`.
5. Open `Advanced` only if you need dedicated role runtimes or execution profile changes.

## Backend Failover Ladder

```mermaid
flowchart LR
  Start["Active Backend"] --> Fail["Backend Error"]
  Fail --> Next["Switch To Next Candidate"]
  Next --> Health["Run Health Check"]
  Health -->|"ok"| Resume["Resume Chat Or Run"]
  Health -->|"fail"| Next
```

## Doctor and Preflight

```bash
npm run doctor
```

Hard blockers:
- Docker unavailable
- Postgres unavailable
- sidecar build failure

Warnings:
- runtime command missing
- runtime endpoint down
- model cache missing

## Practical Notes

- `4B` is the default because it is the stronger local coding rung for this setup.
- `0.8B` still exists as the `utility_fast` rung for lighter classification and support tasks.
- If you want Google-backed quota failover instead of local inference, switch to the `Qwen CLI` provider in `Settings`.
- Distillation and benchmark tooling are not required for the local operator path.

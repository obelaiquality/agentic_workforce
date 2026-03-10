# Onboarding (First 30 Minutes)

## Goal

Get to one clean success signal fast, then attach a repo and validate the benchmark path.

## 0-5 min: Install and Boot

```bash
npm install
npm run start:desktop
```

Expected:
- desktop shell opens
- `doctor` shows no hard blockers

## 5-10 min: Verify the Default Runtime

The default coding runtime is local `Qwen 3.5 4B`, served by default as `mlx-community/Qwen3.5-4B-4bit` on Apple Silicon.

If you have not started it yet, run in another terminal:

```bash
python3 -m pip install --upgrade mlx-lm
python3 -m mlx_lm.server --model mlx-community/Qwen3.5-4B-4bit --host 127.0.0.1 --port 8000 --temp 0.15 --max-tokens 1600
```

Then in the app:

1. Open `Settings`.
2. Confirm provider `On-Prem Qwen`.
3. Confirm base URL `http://127.0.0.1:8000/v1`.
4. Open `Overseer`.
5. Send `Reply with exactly: APP_READY_OK`.

Optional terminal health check:

```bash
curl -sS http://127.0.0.1:8000/health
```

## 10-15 min: Validate Backlog and Basic State

1. Open `Backlog`.
2. Create one ticket.
3. Move it to another column.
4. Return to `Overseer` and confirm the app still feels responsive.

## 15-20 min: Validate Repos

1. Open `Repos`.
2. Click `Import Managed Pack`.
3. Activate one pack from the header switcher.
4. Confirm guideline and repo state panels populate.

## 20-25 min: Validate Benchmarks

1. Open `Benchmarks`.
2. Pick the active managed pack.
3. Start a benchmark run.
4. Execute the task through the app.
5. Recompute the scorecard.

Expected today:
- the benchmark pipeline runs end to end
- the scorecard is machine-generated
- baseline runs may still fail until autonomous code-apply is fully wired

## 25-30 min: Optional Provider Variants

### Qwen CLI Accounts

1. Open `Settings`.
2. Select provider `Qwen CLI`.
3. Use `Create + Auth` for a fresh account or `Import Current` for an existing `~/.qwen` login.
4. Verify the account becomes `ready`.

### OpenAI Escalation

Add to `.env`:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.4
```

Restart `npm run start:desktop` and select `OpenAI Responses` only when you want escalation.

## Daily Checklist

- `npm run doctor`
- confirm the active provider and runtime health
- check pending approvals
- verify the active repo in the header switcher
- re-run the critical Playwright or benchmark path after meaningful changes

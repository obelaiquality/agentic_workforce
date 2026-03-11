# Onboarding (First 30 Minutes)

## Goal

Get one real success signal fast:
- launch the desktop app
- connect or create a repo
- scaffold or run one bounded change
- inspect the result in `Live State`, `Codebase`, and `Console`

The product is now centered on the command-center flow, not a separate backlog/admin flow.

## 0-5 min: Boot the Product

From [/Users/neilslab/agentic_workforce](/Users/neilslab/agentic_workforce):

```bash
npm install
npm run start:desktop
```

Expected:
- Electron window opens
- local API is reachable on `127.0.0.1:8787`
- `Live State` loads as the primary command center

## 5-10 min: Verify the Default Local Runtime

The default coding runtime is local `Qwen 3.5 4B`.

If it is not already running, start it in another terminal:

```bash
python3 -m pip install --upgrade mlx-lm
python3 -m mlx_lm.server --model mlx-community/Qwen3.5-4B-4bit --host 127.0.0.1 --port 8000 --temp 0.15 --max-tokens 1600
```

Optional health check:

```bash
curl -sS http://127.0.0.1:8000/health
```

In the app:
1. Open `Settings`
2. Confirm provider `On-Prem Qwen`
3. Confirm base URL `http://127.0.0.1:8000/v1`
4. If you want a true local split:
   - open `Settings > Providers > Local role runtimes`
   - click `Apply recommended local split`
   - click `Start enabled runtimes`
   - use `Test` on `Fast`, `Build`, and `Review`
5. Return to `Live State`

## 10-15 min: Create or Connect a Project

### Fastest path: New project
1. Open `Projects`
2. Click `New Project`
3. Choose an empty folder
4. Keep the default template: `TypeScript App`
5. Let the app initialize Git, create the managed worktree, generate a blueprint, scaffold the app, and verify it

### Existing repo path
1. Open `Projects`
2. Click `Choose Local Repo`
3. Pick a local Git repo
4. Let the app build the blueprint and code graph

Expected:
- project appears in the header switcher
- `Projects` shows the active project and blueprint summary
- `Live State` is now populated

## 15-20 min: Use the Command Center

Return to `Live State`.

The screen is organized into:
- top `Overseer Command` card
- workflow summary row
- four-lane workflow board
- right-side detail drawer

Lanes:
- `Backlog`
- `In Progress`
- `Needs Review`
- `Completed`

What to try:
1. Type a bounded objective in the command card
2. Click `Review Route`
3. Click `Execute`
4. Watch the workflow card move through the board
5. Click a card to expand it inline
6. Open the task detail drawer for logs, approvals, authored notes, and verification

## 20-25 min: Inspect Real Outputs

### Codebase
1. Open `Codebase`
2. Confirm you can browse real files from the managed worktree
3. Open the generated or modified source file

### Console
1. Open `Console`
2. Confirm you see real:
   - execution events
   - verification events
   - provider events
   - approvals
   - indexing events

The console is no longer synthetic. If it is empty, it means nothing happened yet.

## 25-30 min: Run a Proven Task

Recommended first tasks:

1. `Scaffold a TypeScript app with tests and documentation`
2. `Add a status badge component and test it. Update docs if needed.`
3. `Change the hero headline and update the test`

The current local 4B flow is strongest on bounded, explicit changes with clear verification.

## What is Real Today

- Desktop app flow
- Local repo connect
- New project bootstrap from an empty folder
- Project blueprint generation
- Four-lane kanban command board
- Drag/drop lane transitions
- Inline workflow expansion
- Right-side task detail drawer
- Threaded authored notes/comments
- Real Codebase view
- Real Console view
- Local verification with lint/test/build

## What Is Still Advanced or Secondary

- Browser preview is secondary and cannot use the native folder picker
- OpenAI escalation is optional
- Qwen CLI multi-account failover is optional
- Benchmarks, distillation, and other internal tooling live behind `Settings > Labs`

## Daily Operator Checklist

- launch with `npm run start:desktop`
- confirm local runtime health
- confirm the active project in the header
- use `Live State` for workflow status and execution
- use `Codebase` and `Console` to inspect evidence
- use the drawer for threaded notes, approvals, and verification detail

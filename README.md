# Agentic Workforce

A local-first, desktop coding agent that connects to real repos, generates verified changes, and ships evidence — not hand-wavy agent output.

Built with Electron + React + Fastify + Prisma + local Qwen models (MLX). Runs entirely on your machine. Optional cloud escalation via OpenAI.

---

## Table of Contents

- [What It Does](#what-it-does)
- [How It Works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [First Run](#first-run)
- [Recommended First Tasks](#recommended-first-tasks)
- [Product Surfaces](#product-surfaces)
- [Model Roles](#model-roles)
- [Inference Backends](#inference-backends)
- [Project Blueprint](#project-blueprint)
- [Optional Providers](#optional-providers)
- [Testing](#testing)
- [Commands Reference](#commands-reference)
- [Troubleshooting](#troubleshooting)
- [Technical Architecture](#technical-architecture)
- [For Engineers Working on the Product](#for-engineers-working-on-the-product)

---

## What It Does

Connect a repo, describe a coding objective, and get verified changes back — with real lint, test, and build evidence.

The system:
1. Connects to a local repo or scaffolds a new one
2. Extracts a project blueprint (coding standards, test policy, doc policy)
3. Plans the change with a context-aware route
4. Generates code using local models in a managed worktree
5. Runs verification (lint, test, build)
6. Surfaces the work in a command-center UI with a four-lane workflow board
7. Produces a shareable report with evidence

This is not a chatbot. It is a **bounded, verified worker system** for coding tasks.

## How It Works

```mermaid
flowchart LR
  A["1. Connect Repo"] --> B["2. Extract Blueprint"]
  B --> C["3. Build Context Pack"]
  C --> D["4. Route + Plan"]
  D --> E["5. Generate Code"]
  E --> F["6. Verify"]
  F --> G["7. Report"]

  style A fill:#0e7490,color:#fff
  style B fill:#7c3aed,color:#fff
  style C fill:#0e7490,color:#fff
  style D fill:#7c3aed,color:#fff
  style E fill:#0e7490,color:#fff
  style F fill:#059669,color:#fff
  style G fill:#7c3aed,color:#fff
```

The operator flow in the UI:

1. **Connect repo** — pick a local folder or create a new project
2. **Confirm blueprint** — review the auto-extracted coding contract
3. **Ask the Overseer** — describe a change objective
4. **Review route** — see the plan before execution
5. **Execute** — model generates code in a managed worktree
6. **Track the board** — drag workflows across `Backlog`, `In Progress`, `Needs Review`, and `Completed`
7. **Verify** — lint, test, and build run automatically
8. **Inspect** — review code, console events, comments, and the run report

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | 20+ | Runtime for server and frontend |
| **Python** | 3.11+ | For local model server (mlx_lm, vLLM, etc.) |
| **Docker** | Any modern | For PostgreSQL (docker-compose) — **optional** if you run Postgres yourself |
| **Rust** | Latest stable | For the optional sidecar binary |

Plus **one** local inference backend (see [Inference Backends](#inference-backends) below).

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Start a local inference backend

The app needs a local model server exposing the OpenAI-compatible API. Pick the backend that matches your hardware (see [Inference Backends](#inference-backends) for all options).

**macOS Apple Silicon** (default):

```bash
pip install --upgrade mlx-lm
python3 -m mlx_lm.server --model mlx-community/Qwen3.5-4B-4bit --host 127.0.0.1 --port 8000
```

**Linux with NVIDIA GPU**:

```bash
pip install vllm
vllm serve Qwen/Qwen3.5-4B --host 127.0.0.1 --port 8000
```

**Any platform (Ollama)**:

```bash
ollama pull qwen3.5:4b && ollama serve
```

Verify it's running:

```bash
curl http://127.0.0.1:8000/health   # MLX / vLLM
curl http://127.0.0.1:11434/v1/models  # Ollama
```

### 3. Start PostgreSQL

The app needs PostgreSQL on port 5433.

**Option A — Docker (easiest)**:
```bash
npm run db:up        # starts Postgres via docker-compose on port 5433
```

**Option B — Existing Postgres**: If you already run Postgres (Homebrew, system service, cloud), just make sure it's reachable on `127.0.0.1:5433`. Set the connection string in `.env`:
```
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/agentic?schema=public"
```

### 4. Initialize the database

```bash
npx prisma db push     # Push schema (67 models)
npx prisma generate    # Generate Prisma client
```

### 5. Launch the desktop app

**Canonical operator command**:

```bash
npm run start:desktop
```

This runs the normal bootstrap path and launches the Electron app.

> **Faster dev path**: `npm run dev:desktop` starts Vite + the Electron shell directly. Use it when your API, database, and model runtime are already healthy and you just want the desktop UI quickly.

> **Dev without Electron**: To run just the web UI (no Electron window):
> ```bash
> npm run dev          # Vite dev server on http://localhost:5173
> npm run dev:api      # API server on http://localhost:8787 (separate terminal)
> ```

---

## First Run

### Fastest confidence path

1. Launch the desktop app with `npm run start:desktop`
2. Click **New Project** or **Connect Local Repo**
3. Pick an **empty folder** (for new projects) or an existing repo
4. For new projects, click **Initialize New Project** when prompted
5. The system will:
   - Initialize Git (if needed)
   - Create a managed worktree
   - Generate a project blueprint
   - Scaffold the app (TypeScript + Vite + React)
   - Run verification (lint, test, build)
6. Inspect results:
   - **Live State** — command center with the workflow board and report
   - **Codebase** — browse generated source files from the managed worktree
   - **Console** — see real execution, verification, provider, and indexing events

### What the app looks like

These screenshots are from the latest green desktop acceptance run on March 11, 2026. That run verified:
- empty-folder bootstrap
- TypeScript scaffold
- follow-up `StatusBadge` feature edit
- green `lint`, `test`, and `build`

**Live State** — the command center with the Overseer command card, workflow summary row, and four-lane kanban board:

![Live State - Execution](docs/screenshots/01-shell.png)

**Projects** — connect local repos, create new projects, and manage the active project blueprint:

![Projects View](docs/screenshots/01b-projects.png)

**Scaffold Complete** — after scaffolding, see the command-center outcome state with verification and execution evidence:

![Scaffold Complete](docs/screenshots/02-scaffold-complete.png)

**Codebase Explorer** — browse real source files from the managed worktree, with impacted files visible first when context is available:

![Codebase Explorer](docs/screenshots/03-codebase.png)

**Agent Console** — real event stream with execution, verification, provider, approval, and indexing events:

![Agent Console](docs/screenshots/04-console.png)

**Follow-up Change** — after a real feature task, the new component and test changes are visible immediately in the managed-worktree Codebase view:

![Follow-up Codebase](docs/screenshots/05-followup-codebase.png)

---

## Recommended First Tasks

Start with bounded, well-defined tasks:

| Task | What it proves |
|---|---|
| `Scaffold a TypeScript app with tests and documentation` | Full scaffold pipeline |
| `Add a status badge component and test it. Update docs if needed.` | Follow-up feature creation |
| `Add a progress bar component with tests` | Deterministic template path |
| `Change the hero headline and update the test` | Targeted edit + test update |
| `Add one button and verify lint, tests, and build` | Minimal edit + full verification |

The follow-up component scenarios (StatusBadge, ProgressBar, ThemeToggle, FormatUtility) use **deterministic templates** to guarantee reliable code generation on the local 4B model.

---

## Product Surfaces

### Sidebar sections

| Section | Purpose |
|---|---|
| **Live State** | Landing view (when no project active), execution status, run timeline, active execution panel |
| **Codebase** | Real file tree and file contents from the managed worktree, scoped to impacted work when available |
| **Console** | Real event stream (execution, verification, provider, approvals, indexing) |
| **Projects** | Project list, GitHub connections, repo management |
| **Settings** | Provider config, model settings, Labs toggle |

When no project is active, Live State shows the **Landing / Mission Control** view where you connect repos and create projects.

### Live State workflow board

The center of the product is a four-lane command board:

| Lane | Meaning |
|---|---|
| **Backlog** | Queued and ready for assignment |
| **In Progress** | Currently active implementation work |
| **Needs Review** | Waiting on verification follow-up or human review |
| **Completed** | Verified work with report-ready output |

Key behaviors:
- Drag a workflow card between lanes to perform a real backend state transition.
- Click a card to expand it inline without losing board context.
- Use the right drawer for deeper task detail, threaded notes, approvals, logs, and verification summary.
- `Blocked` is a card state, not a lane. Blocked items stay in their lane and sort to the top.

The board is not decorative. It is backed by live ticket, run, approval, and verification data.

### Internal / advanced (behind Settings > Labs)

Benchmarks, distillation, demo packs, deep runtime tuning, and developer diagnostics are hidden from the main product surface.

---

## Model Roles

The product exposes four mode names. Users think in modes, not raw model IDs.

| Mode | Role | Default Model | Purpose |
|---|---|---|---|
| **Fast** | `utility_fast` | Qwen 3.5 0.8B (MLX) | Targeting, context shaping, impact analysis |
| **Build** | `coder_default` | Qwen 3.5 4B (MLX) | Code generation, file edits |
| **Review** | `review_deep` | Qwen 3.5 4B (MLX, reasoning) | Verification-guided correction |
| **Escalate** | `overseer_escalation` | OpenAI (optional) | Complex failures, ambiguous requirements |

```mermaid
flowchart TD
  Objective["Coding Objective"]
  Fast["Fast (0.8B)<br/>Context shaping"]
  Build["Build (4B)<br/>Code generation"]
  Verify["Deterministic Verification<br/>lint / test / build"]
  Repair["Repair Loop<br/>max 3 rounds"]
  Review["Review (4B + reasoning)<br/>Failure correction"]
  Escalate["Escalate (OpenAI)<br/>Optional"]
  Done["Report + Evidence"]

  Objective --> Fast
  Fast --> Build
  Build --> Verify
  Verify -->|pass| Done
  Verify -->|fail: deterministic| Repair
  Repair --> Verify
  Verify -->|fail: needs model| Review
  Review --> Verify
  Verify -->|fail: policy allows| Escalate
  Escalate --> Verify

  style Fast fill:#0e7490,color:#fff
  style Build fill:#7c3aed,color:#fff
  style Verify fill:#059669,color:#fff
  style Review fill:#d97706,color:#fff
  style Escalate fill:#dc2626,color:#fff
```

---

## Inference Backends

The app talks to local models via the **OpenAI-compatible `/v1/chat/completions` API**. Any backend that exposes this API works without code changes — just configure the backend ID and base URL in `.env`.

### Supported backends

| Backend | Platform | `.env` backend ID | Default Port | Install |
|---|---|---|---|---|
| **MLX-LM** | macOS Apple Silicon | `mlx-lm` | 8000 | `pip install mlx-lm` |
| **vLLM** | Linux + NVIDIA GPU | `vllm-openai` | 8000 | `pip install vllm` |
| **SGLang** | Linux + NVIDIA GPU | `sglang` | 30000 | `pip install sglang` |
| **TensorRT-LLM** | Linux + NVIDIA GPU | `trtllm-openai` | 8000 | NVIDIA container |
| **llama.cpp** | Any (CPU/GPU) | `llama-cpp-openai` | 8080 | Build from source or `brew install llama.cpp` |
| **Ollama** | Any | `ollama-openai` | 11434 | [ollama.com](https://ollama.com) |
| **Transformers** | Any | `transformers-openai` | 8000 | `pip install transformers` |

### Platform quick reference

| Platform | Recommended | Easiest |
|---|---|---|
| **macOS Apple Silicon** | MLX-LM (fastest) | Ollama |
| **Linux + NVIDIA** | vLLM (best throughput) | Ollama |
| **Linux CPU-only** | llama.cpp (GGUF) | Ollama |
| **Windows** | Ollama (native) | Ollama |
| **Windows + NVIDIA** | Ollama or vLLM via WSL2 | Ollama |

### Configuration

Set three env vars in `.env` to switch backends:

```bash
ONPREM_QWEN_INFERENCE_BACKEND=mlx-lm          # Backend ID from table above
ONPREM_QWEN_BASE_URL=http://127.0.0.1:8000/v1 # Base URL for the backend
ONPREM_QWEN_MODEL=mlx-community/Qwen3.5-4B-4bit  # Model identifier (varies by backend)
```

**Model identifiers by backend:**

| Backend | 4B model | 0.8B model |
|---|---|---|
| MLX-LM | `mlx-community/Qwen3.5-4B-4bit` | `Qwen/Qwen3.5-0.8B` |
| vLLM | `Qwen/Qwen3.5-4B` | `Qwen/Qwen3.5-0.8B` |
| Ollama | `qwen3.5:4b` | `qwen3.5:0.8b` |
| llama.cpp | Path to `.gguf` file | Path to `.gguf` file |

> See [`long_term_upgrades.md` Section 10](long_term_upgrades.md#10-cross-platform-inference-backend-strategy) for the full cross-platform roadmap including auto-detection, managed subprocess lifecycle, and platform-specific packaging.

---

## Project Blueprint

Every connected project gets a **Project Blueprint** — the operating contract for that repo.

The blueprint text is auto-extracted from these files (when present):
- `AGENTS.md`
- `README.md` / `README`
- `docs/architecture.md`
- `docs/onboarding.md`
- `guidelines/Guidelines.md`

Repo guidelines (lint, test, build commands) are separately extracted from:
- `package.json` scripts (`lint`, `test`, `build`, `typecheck`)
- `Cargo.toml` (for Rust repos)
- These feed into the blueprint's verification command selection

### Blueprint sections

| Section | Controls |
|---|---|
| **Charter** | Product intent, success criteria, constraints, risk posture |
| **Coding Standards** | Principles, file placement rules, architecture rules, review style |
| **Testing Policy** | Tests required for behavior changes, default commands, full suite policy |
| **Documentation Policy** | User-facing doc updates, runbook updates, required doc paths |
| **Execution Policy** | Approval requirements, protected paths, max changed files, parallel execution |
| **Provider Policy** | Preferred coder role, review role, escalation policy |

The blueprint drives:
- Context pack creation
- Route planning
- Execution decisions
- Verification command selection
- Documentation enforcement
- Run report generation
- Benchmark scoring

The current UI surfaces blueprint enforcement directly in the command center:
- why lint/test/build commands were selected
- whether docs were required
- whether escalation was allowed
- which policy rules were enforced in the final run

The drawer and outcome panels also expose threaded authored notes and activity history for the selected workflow.

---

## Optional Providers

### OpenAI API (optional unified runtime or escalation)

Add to `.env`:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_RESPONSES_MODEL=gpt-5-nano
```

Then in **Settings** you can:

1. keep OpenAI as **Escalate-only**
2. or switch **Runtime mode** to **OpenAI API** and run all roles from one OpenAI model
3. or use **Role routing** to assign different OpenAI or Local Qwen models per responsibility:
   - `Fast`
   - `Build`
   - `Review`
   - `Escalate`

The app now fetches the live model list from your account’s `GET /v1/models` response, so the model picker is not hardcoded. `gpt-5-nano` is the default quick preset, and the recommended OpenAI role setup prefers:

- `Fast` -> `gpt-5-nano`
- `Build` -> latest available Codex-family model
- `Review` -> stronger GPT-5 general model
- `Escalate` -> `gpt-5.4`

There is also a **Hybrid Recommended** preset:

- `Fast` -> current local Qwen runtime
- `Build` -> latest available Codex-family model
- `Review` -> `gpt-5.4`
- `Escalate` -> `gpt-5.4`

### Qwen CLI (multi-account failover)

An optional provider path using Google-backed Qwen account rotation:

1. Open **Settings**
2. Enable the **Qwen CLI** provider
3. Add account profiles with **Create + Auth** or **Import Current**

### OpenAI-Compatible (generic)

Point any OpenAI-compatible endpoint (Ollama, vLLM, etc.) via `.env`:

```bash
OPENAI_COMPAT_BASE_URL=http://127.0.0.1:11434/v1
OPENAI_COMPAT_MODEL=your-model
```

---

## Testing

### Unit tests

```bash
npm test
# or
npx vitest run
```

312 tests across 24 test files covering:
- Provider routing and factory
- Blueprint extraction and helpers
- Patch manifest parsing
- Codebase file helpers
- Verification policy
- Inference scoring
- Privacy scanner
- Benchmark manifests
- Inference backends (FIM, speculative decoding, startup commands)
- Doom-loop detection (fingerprinting, sliding window)
- Adaptive context compaction (5-stage pressure-based)
- Tool result optimization (shell, file, search, build output)
- System reminders (interval and event-triggered injection)
- Edit matcher chain (8-level progressive matching)
- Tree-sitter analyzer (optional native integration)
- Shadow git snapshots (per-step undo)
- Dual-memory architecture (episodic + working memory)
- Agent architecture integration (cross-service pipeline)

### E2E desktop acceptance

```bash
npm run test:e2e:desktop-acceptance
```

Full Electron lifecycle: bootstrap, scaffold, verification, codebase/console inspection, follow-up edit, report generation. Uses dynamic free ports and API-backed assertions.

### Follow-up scenario tests

```bash
npm run test:e2e:followup:status-badge
npm run test:e2e:followup:progress-bar
npm run test:e2e:followup:utility-module
npm run test:e2e:followup:api-stop
npm run test:e2e:followup:rename-component
```

### Build verification

```bash
npm run build          # Frontend (Vite)
npm run build:server   # Backend (tsup)
```

---

## Commands Reference

| Command | Purpose |
|---|---|
| `npm run dev:desktop` | **Recommended**: Start Vite + Electron (Electron spawns the API server) |
| `npm run start:desktop` | Full bootstrap + dev + Electron (requires Docker for Postgres) |
| `npm run dev:api` | Start the Fastify API server in watch mode |
| `npm run dev` | Start Vite dev server only |
| `npm run build` | Build frontend for production |
| `npm run build:server` | Build server with tsup |
| `npm run build:desktop` | Full desktop build (frontend + server + sidecar) |
| `npm run dist:desktop` | Package Electron app for distribution |
| `npm run db:up` | Start PostgreSQL via docker-compose |
| `npm run db:down` | Stop PostgreSQL |
| `npm run doctor` | Run preflight health checks |
| `npm test` | Run unit tests (vitest) |
| `npm run test:e2e:desktop-acceptance` | Run full Electron E2E test |
| `npm run test:integration:agent-architecture` | Run agent architecture integration tests |
| `npx prisma db push` | Sync Prisma schema to database |
| `npx prisma generate` | Regenerate Prisma client |

---

## Troubleshooting

### App opens but the repo picker does nothing

You're in the browser preview. Use the Electron desktop app:

```bash
npm run start:desktop
```

### Model does not respond

Check the MLX server:

```bash
curl http://127.0.0.1:8000/health
```

If it's not running, start it:

```bash
python3 -m mlx_lm.server --model mlx-community/Qwen3.5-4B-4bit --host 127.0.0.1 --port 8000
```

### Database connection fails

Check PostgreSQL is running:

```bash
docker ps | grep agentic_workforce_postgres
```

If not:

```bash
npm run db:up
npx prisma db push
```

### Scaffold fails

Check in order:
1. Model health (`curl http://127.0.0.1:8000/health`)
2. PostgreSQL is up
3. Console tab for verification output
4. Try a clean empty folder

### White screen in Electron

Check the Electron DevTools console (Cmd+Option+I) for errors. Common causes:
- API server not running on the expected port
- Database not initialized
- Missing Prisma client (run `npx prisma generate`)

---

## Technical Architecture

### System overview

```mermaid
graph TB
  subgraph Desktop["Electron Desktop App"]
    UI["React Frontend<br/>(Vite + TailwindCSS)"]
    Bridge["Desktop Bridge<br/>(IPC)"]
    Electron["Electron Main Process"]
  end

  subgraph Server["Fastify API Server"]
    Routes["API Routes<br/>(/api/v8/*)"]
    Services["Service Layer"]
    EventBus["Event Bus"]
  end

  subgraph Data["Data Layer"]
    Prisma["Prisma ORM"]
    Postgres["PostgreSQL<br/>(port 5433)"]
    Worktrees["Managed Git<br/>Worktrees"]
  end

  subgraph Providers["Provider Factory"]
    OnPrem["On-Prem Qwen<br/>(MLX, port 8000)"]
    QwenCLI["Qwen CLI<br/>(optional)"]
    OpenAICompat["OpenAI-Compatible<br/>(optional)"]
    OpenAIResp["OpenAI Responses<br/>(optional)"]
  end

  subgraph Sidecar["Rust Sidecar"]
    TreeSitter["Tree-sitter<br/>Parsing"]
  end

  UI --> Bridge
  Bridge --> Electron
  Electron --> Routes
  UI -->|HTTP| Routes
  Routes --> Services
  Services --> EventBus
  Services --> Prisma
  Prisma --> Postgres
  Services --> Worktrees
  Services --> Providers
  Services --> Sidecar

  style Desktop fill:#1e1b4b,color:#fff
  style Server fill:#1e3a5f,color:#fff
  style Data fill:#1a2e1a,color:#fff
  style Providers fill:#3b1a1a,color:#fff
  style Sidecar fill:#3b2f1a,color:#fff
```

### Execution pipeline

```mermaid
sequenceDiagram
  participant User
  participant UI as React UI
  participant API as Fastify API
  participant Orch as Provider Orchestrator
  participant Fast as Fast Model (0.8B)
  participant Build as Build Model (4B)
  participant WT as Managed Worktree
  participant Verify as Verification Runner

  User->>UI: Describe objective
  UI->>API: POST /overseer/execute
  API->>Orch: planExecution()
  Orch->>Fast: Context shaping + impact analysis
  Fast-->>Orch: Context pack + file targets
  Orch->>Build: Generate patch manifest
  Build-->>Orch: PatchManifest (files, strategies)
  loop Per file in manifest
    Orch->>Build: Generate file content
    Build-->>Orch: File content
    Orch->>WT: Write file to worktree
  end
  Orch->>Verify: Run verification commands
  Verify-->>Orch: VerificationBundle
  alt Verification fails
    loop max 3 repair rounds
      Orch->>Build: Repair from failure evidence
      Build-->>Orch: Repaired content
      Orch->>Verify: Re-verify
    end
  end
  Orch-->>API: ExecutionResult + Report
  API-->>UI: Snapshot update
  UI-->>User: Show results + evidence
```

### Source directory layout

```
src/
  main.tsx                          # Vite entry point
  app/
    App.tsx                         # Root React component
    store/                          # Zustand UI state
    hooks/                          # React hooks (mission control live data)
    lib/                            # Desktop bridge, utilities
    components/
      UI.tsx                        # Shared UI primitives (Panel, Chip, etc.)
      views/
        CommandCenterView.tsx       # Live State command center + kanban board
        CodebaseView.tsx            # File tree + source viewer
        ConsoleView.tsx             # Event stream viewer
        ProjectsWorkspaceView.tsx   # Project management
        SettingsControlView.tsx     # Settings + Labs
      mission/
        OverseerDrawer.tsx          # Execution drawer
        ProjectBlueprintPanel.tsx   # Blueprint display + overrides
        MissionHeaderStrip.tsx      # Active project header
        ...
      ui/                           # shadcn/ui component library
  server/
    index.ts                        # Server entry (port binding)
    app.ts                          # Fastify app + all route definitions
    db.ts                           # Prisma client singleton
    eventBus.ts                     # Server-side event bus
    providers/
      factory.ts                    # Provider factory + role mapping
      stubAdapters.ts               # OnPremQwen, OpenAiCompatible adapters
      openaiResponsesAdapter.ts     # OpenAI Responses adapter
      qwenCliAdapter.ts             # Qwen CLI multi-account adapter
      modelPlugins.ts               # Model plugin registry
      inferenceBackends.ts          # Inference backend registry
    services/
      executionService.ts           # Manifest-first execution pipeline
      missionControlService.ts      # BFF snapshot aggregation
      projectBlueprintService.ts    # Blueprint extraction + persistence
      projectScaffoldService.ts     # New project scaffolding
      codeGraphService.ts           # Code graph + context packs
      providerOrchestrator.ts       # Model role orchestration + escalation
      verificationPolicy.ts         # Blueprint-driven verification planning
      repoService.ts                # Repo registry + worktree management
      approvalService.ts            # Human-in-the-loop approvals
      benchmarkService.ts           # Blueprint-aware benchmark scoring
      inferenceTuningService.ts     # VRAM detection, health monitoring, cache metrics
      doomLoopDetector.ts           # MD5 fingerprint doom-loop detection
      contextCompactionService.ts   # 5-stage adaptive context compaction
      toolResultOptimizer.ts        # Per-tool output optimization

### Generated local state

These directories are generated locally and can be cleaned when needed:

```
.local/repos/                      # Managed worktrees for connected projects
.local/benchmark-runs/             # Benchmark run sandboxes
output/playwright/                 # Acceptance and UI artifact runs
dist/                              # Renderer build output
dist-server/                       # Server build output
dist-sidecar/                      # Sidecar build output
```

They are not the source of truth. The source of truth is:
- `src/`
- `prisma/`
- `docs/`
- `scripts/`
- `rust/`
      systemReminderService.ts      # Blueprint-aware instruction reminders
      editMatcherChain.ts           # 8-level progressive edit matching
      treeSitterAnalyzer.ts         # Optional tree-sitter code analysis
      shadowGitService.ts           # Per-step git snapshots for undo
      memoryService.ts              # Dual-memory (episodic + working)
      shellDetect.ts                # Cross-platform shell detection
      patchHelpers.ts               # Patch parsing + application
      blueprintHelpers.ts           # Blueprint extraction helpers
      codebaseHelpers.ts            # File tree + content helpers
      ...
    sidecar/
      client.ts                     # Rust sidecar gRPC client
      manager.ts                    # Sidecar lifecycle management
  shared/
    contracts.ts                    # All domain types (HardwareProfile, BackendHealth, SpeculativeDecoding, etc.)
electron/
  main.mjs                         # Electron main process
prisma/
  schema.prisma                     # Database schema (67 models)
scripts/
  playwright/                       # E2E test scripts
  bootstrap.mjs                     # Preflight bootstrap checks
  doctor.mjs                        # Health diagnostics
```

### Key domain types

```mermaid
classDiagram
  class ProjectBlueprint {
    +id: string
    +projectId: string
    +version: number
    +charter: Charter
    +codingStandards: CodingStandards
    +testingPolicy: TestingPolicy
    +documentationPolicy: DocPolicy
    +executionPolicy: ExecutionPolicy
    +providerPolicy: ProviderPolicy
  }

  class PatchManifest {
    +summary: string
    +files: FileEntry[]
    +docsChecked: string[]
    +tests: string[]
  }

  class FileEntry {
    +path: string
    +action: create | update
    +strategy: full_file | unified_diff | search_replace
    +reason: string
  }

  class VerificationBundle {
    +id: string
    +runId: string
    +commands: CommandResult[]
    +passed: boolean
    +repairRounds: number
  }

  class ShareableRunReport {
    +id: string
    +runId: string
    +summary: string
    +changedFiles: string[]
    +testsPassed: string[]
    +docsUpdated: string[]
    +remainingRisks: string[]
  }

  class ConsoleEvent {
    +id: string
    +category: execution | verification | provider | approval | indexing
    +level: info | warn | error
    +message: string
  }

  ProjectBlueprint --> PatchManifest : drives planning
  PatchManifest --> FileEntry : contains
  PatchManifest --> VerificationBundle : verified by
  VerificationBundle --> ShareableRunReport : produces
```

### API endpoints (v8 mission)

**Queries:**

| Endpoint | Purpose |
|---|---|
| `GET /api/v8/mission/snapshot` | Full mission state (BFF aggregation) |
| `GET /api/v8/mission/timeline` | Run narrative timeline |
| `GET /api/v8/mission/codebase` | Codebase summary for active project |
| `GET /api/v8/mission/codebase/tree` | File tree from managed worktree |
| `GET /api/v8/mission/codebase/file` | File content from managed worktree |
| `GET /api/v8/mission/console` | Console event list |
| `GET /api/v8/mission/console/stream` | SSE console event stream |
| `GET /api/v8/mission/overseer` | Overseer state for active project |
| `GET /api/v8/projects/:id/blueprint` | Project blueprint |
| `GET /api/v8/projects/:id/blueprint/sources` | Blueprint extraction source refs |
| `GET /api/v8/projects/:id/scaffold/status` | Scaffold execution status |
| `GET /api/v8/projects/:id/report/latest` | Latest run report |

**Commands:**

| Endpoint | Purpose |
|---|---|
| `POST /api/v8/projects/connect/local` | Connect a local repo |
| `POST /api/v8/projects/connect/github` | Connect a GitHub repo |
| `POST /api/v8/projects/open-recent` | Reopen a recently used project |
| `POST /api/v8/projects/bootstrap/empty` | Bootstrap new project from empty folder |
| `POST /api/v8/projects/:id/scaffold/plan` | Plan scaffold for new project |
| `POST /api/v8/projects/:id/scaffold/execute` | Execute scaffold for new project |
| `POST /api/v8/projects/:id/blueprint/generate` | Generate blueprint from repo |
| `POST /api/v8/projects/:id/blueprint/update` | Update blueprint with overrides |
| `POST /api/v8/mission/overseer/chat` | Send message to overseer |
| `POST /api/v8/mission/overseer/route.review` | Review execution route |
| `POST /api/v8/mission/overseer/execute` | Execute coding objective |
| `POST /api/v8/mission/approval/decide` | Approve or reject pending action |
| `POST /api/v8/mission/actions/stop` | Stop active execution |
| `POST /api/v8/mission/actions/task.requeue` | Requeue a failed task |
| `POST /api/v8/mission/actions/task.transition` | Transition task status |

### Provider factory architecture

```mermaid
flowchart TD
  Factory["Provider Factory"]

  Factory --> OnPrem["On-Prem Qwen Adapter<br/>(MLX / Ollama / vLLM)"]
  Factory --> QwenCLI["Qwen CLI Adapter<br/>Multi-account failover"]
  Factory --> OpenAICompat["OpenAI-Compatible<br/>Generic adapter"]
  Factory --> OpenAIResp["OpenAI Responses<br/>Cloud escalation"]

  OnPrem --> MLX["MLX-LM<br/>Apple Silicon"]
  OnPrem --> VLLM["vLLM / SGLang / TRT-LLM<br/>NVIDIA CUDA"]
  OnPrem --> Portable["Ollama / llama.cpp<br/>Any platform"]

  QwenCLI --> Acct1["Account 1"]
  QwenCLI --> Acct2["Account 2"]
  QwenCLI --> AcctN["Account N"]

  RoleMap["Model Role Mapping"]
  RoleMap -->|utility_fast| OnPrem
  RoleMap -->|coder_default| OnPrem
  RoleMap -->|review_deep| OnPrem
  RoleMap -->|overseer_escalation| OpenAIResp

  style Factory fill:#7c3aed,color:#fff
  style RoleMap fill:#0e7490,color:#fff
```

### Edit strategy selection

```mermaid
flowchart TD
  File["Target File"]
  Check{"File exists?<br/>Line count?"}

  File --> Check
  Check -->|"new file"| FullFile["full_file<br/>Generate complete content"]
  Check -->|"< 150 lines"| FullFile
  Check -->|">= 150 lines"| DiffMode["unified_diff or<br/>search_replace"]

  DiffMode --> Apply["Apply patch to existing content"]
  FullFile --> Write["Write to worktree"]
  Apply --> Write

  Write --> Verify["Run verification"]

  style FullFile fill:#059669,color:#fff
  style DiffMode fill:#d97706,color:#fff
```

---

## For Engineers Working on the Product

### Active engineering priorities

1. **Agent reliability** — doom-loop detection, system reminders, edit matcher chain for robust execution
2. **Context management** — adaptive compaction, tool result optimization, dual-memory architecture
3. **Hardware-aware inference** — VRAM detection, speculative decoding, backend health monitoring
4. **Local 4B follow-up edit reliability** — expanding deterministic templates and improving unconstrained edit quality
5. **Blueprint-aware verification and reporting** — tighter enforcement visibility
6. **Single-agent reliability first** — mutating parallelism deferred until single-agent path is consistently green

### Key architectural decisions

- **Manifest-first execution**: patch manifest is planned before any code generation. Each file generated independently.
- **Deterministic repair before model repair**: unresolved imports, unused imports, path mismatches fixed without model calls.
- **Blueprint-as-contract**: `ProjectBlueprint` is not decorative metadata — it drives verification, reporting, and scoring.
- **chooseEditStrategy guard**: files >150 lines use diff/search-replace instead of full-file rewrite.
- **Bounded repair**: max 3 repair rounds, failure taxonomy drives repair, not vague re-prompting.
- **BFF snapshot aggregation**: `MissionControlService` composes snapshot, console events, blueprint, and codebase into one response.
- **Doom-loop detection**: MD5 fingerprint sliding window catches stuck agent loops before burning tokens.
- **Adaptive context compaction**: 5-stage pressure-based compaction prevents context overflow in long sessions.
- **Edit matcher chain**: 8-level progressive matching (exact → whitespace-normalized → indent-flexible → fuzzy → similarity) absorbs LLM edit imprecision.
- **Dual-memory**: episodic memory (compressed task summaries) + working memory (sliding window) improves long-session reasoning.

### Roadmap

See [`long_term_upgrades.md`](long_term_upgrades.md) for the full roadmap with implementation status.

Remaining deferred items:
- Cloud-aware prompt caching (Section 7)
- Mutating multi-agent parallelism (Section 8 conditions)
- Candidate-training-data promotion (Section 4.4)
- Cross-platform inference backend lifecycle (Section 10)
- Tree-sitter native grammar compilation (Section 16)
- Shadow git snapshot API endpoint (Section 16)
- Broader arbitrary multi-file follow-up edit reliability

---

## License

See [ATTRIBUTIONS.md](ATTRIBUTIONS.md) for third-party attribution details.

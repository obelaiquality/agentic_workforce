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
6. Produces a shareable report with evidence

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
6. **Verify** — lint, test, and build run automatically
7. **Inspect** — review code, console events, and the run report

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | 20+ | Runtime for server and frontend |
| **Python** | 3.11+ | For local model server (mlx_lm, vLLM, etc.) |
| **Docker** | Any modern | For PostgreSQL (docker-compose) |
| **Rust** | Latest stable | For the optional sidecar binary |

Plus **one** local inference backend (see [Inference Backends](#inference-backends) below).

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Copy environment config

```bash
cp .env.example .env
```

Edit `.env` if you want to change ports or add API keys. Defaults work out of the box for local operation.

### 3. Start PostgreSQL

```bash
npm run db:up
```

This starts a PostgreSQL 16 container on port **5433** via docker-compose.

### 4. Initialize the database

```bash
npx prisma db push
```

This creates all tables from the Prisma schema (67 models).

### 5. Start a local inference backend

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

### 6. Launch the desktop app

```bash
npm run start:desktop
```

This runs the bootstrap check, starts Vite + Fastify, and opens the Electron window.

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
   - **Codebase** tab — browse generated source files
   - **Console** tab — see real execution and verification events
   - **Live State** tab — see the run status and report

### What the app looks like

**Live State** — execution view with project blueprint, change briefs, overseer panel, and run status:

![Live State - Execution](docs/screenshots/01-shell.png)

**Projects** — connect local repos, create new projects, view active blueprint with enforcement rules:

![Projects View](docs/screenshots/01b-projects.png)

**Scaffold Complete** — after scaffolding, see the run narrative timeline and execution outcome:

![Scaffold Complete](docs/screenshots/02-scaffold-complete.png)

**Codebase Explorer** — browse real source files from the managed worktree with syntax highlighting:

![Codebase Explorer](docs/screenshots/03-codebase.png)

**Agent Console** — real event stream with execution, verification, provider, and indexing events:

![Agent Console](docs/screenshots/04-console.png)

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

### Normal surfaces

| Surface | Purpose |
|---|---|
| **Landing** | Connect repos, create projects, view blueprint |
| **Live State** | Execution status, run timeline, active execution panel |
| **Codebase** | Real file tree and file contents from the managed worktree |
| **Console** | Real event stream (execution, verification, provider, indexing) |
| **Projects** | Project list, GitHub connections, repo management |
| **Settings** | Provider config, model settings, Labs toggle |

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

The blueprint is auto-extracted from:
- `AGENTS.md`
- `README.md` / `README`
- `docs/` directory
- `package.json` (scripts, dependencies)
- Lint/test/build config
- CI config (`.github/workflows/`)

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

---

## Optional Providers

### OpenAI Responses (escalation)

Add to `.env`:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_RESPONSES_MODEL=gpt-5-mini
```

This enables the **Escalate** mode for complex failures. It is not part of the baseline happy path.

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

141+ tests across 15+ test files covering:
- Provider routing and factory
- Blueprint extraction and helpers
- Patch manifest parsing
- Codebase file helpers
- Verification policy
- Inference scoring
- Privacy scanner
- Benchmark manifests

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
| `npm run start:desktop` | Full startup: bootstrap + dev + Electron |
| `npm run dev:desktop` | Start Vite + Electron (assumes API running) |
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
        LandingMissionView.tsx      # Landing / mission control
        CodebaseView.tsx            # File tree + source viewer
        ConsoleView.tsx             # Event stream viewer
        ProjectsWorkspaceView.tsx   # Project management
        SettingsControlView.tsx     # Settings + Labs
        OverseerView.tsx            # Overseer execution surface
        RunsView.tsx                # Run history + reports
        ...
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
      patchHelpers.ts               # Patch parsing + application
      blueprintHelpers.ts           # Blueprint extraction helpers
      codebaseHelpers.ts            # File tree + content helpers
      ...
    sidecar/
      client.ts                     # Rust sidecar gRPC client
      manager.ts                    # Sidecar lifecycle management
  shared/
    contracts.ts                    # All domain types (1175 lines)
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
| `GET /api/v8/mission/codebase/tree` | File tree from managed worktree |
| `GET /api/v8/mission/codebase/file` | File content from managed worktree |
| `GET /api/v8/mission/console` | Console event stream |
| `GET /api/v8/projects/:id/blueprint` | Project blueprint |
| `GET /api/v8/projects/:id/report/latest` | Latest run report |

**Commands:**

| Endpoint | Purpose |
|---|---|
| `POST /api/v8/projects/connect/local` | Connect a local repo |
| `POST /api/v8/projects/bootstrap/empty` | Bootstrap new project from empty folder |
| `POST /api/v8/projects/:id/scaffold/execute` | Execute scaffold for new project |
| `POST /api/v8/projects/:id/blueprint/generate` | Generate blueprint from repo |
| `POST /api/v8/projects/:id/blueprint/update` | Update blueprint with overrides |
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

  OnPrem --> MLX["mlx_lm.server<br/>Apple Silicon"]
  OnPrem --> Ollama["Ollama<br/>(optional)"]
  OnPrem --> VLLM["vLLM<br/>(optional)"]

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

1. **Local 4B follow-up edit reliability** — expanding deterministic templates and improving unconstrained edit quality
2. **Blueprint-aware verification and reporting** — tighter enforcement visibility
3. **E2E acceptance harness** — maintaining 22-check comprehensive test suite
4. **Mission-control BFF unification** — server-side snapshot aggregation
5. **Single-agent reliability first** — mutating parallelism deferred until single-agent path is consistently green

### Key architectural decisions

- **Manifest-first execution**: patch manifest is planned before any code generation. Each file generated independently.
- **Deterministic repair before model repair**: unresolved imports, unused imports, path mismatches fixed without model calls.
- **Blueprint-as-contract**: `ProjectBlueprint` is not decorative metadata — it drives verification, reporting, and scoring.
- **chooseEditStrategy guard**: files >150 lines use diff/search-replace instead of full-file rewrite.
- **Bounded repair**: max 3 repair rounds, failure taxonomy drives repair, not vague re-prompting.
- **BFF snapshot aggregation**: `MissionControlService` composes snapshot, console events, blueprint, and codebase into one response.

### Roadmap

See [`long_term_upgrades.md`](long_term_upgrades.md) for the full roadmap with implementation status.

Remaining deferred items:
- Cloud-aware prompt caching (Section 7)
- Mutating multi-agent parallelism (Section 8 conditions)
- Candidate-training-data promotion (Section 4.4)
- Broader arbitrary multi-file follow-up edit reliability

---

## License

See [ATTRIBUTIONS.md](ATTRIBUTIONS.md) for third-party attribution details.

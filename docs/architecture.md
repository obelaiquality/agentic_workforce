# Architecture

## Product Shape

The product is a desktop-first command center for coding work.

The normal operator flow is:
1. connect or create a project
2. confirm the project blueprint
3. issue an objective in `Work`
4. review the route
5. execute in a managed worktree
6. verify with real lint/test/build commands
7. inspect code, logs, approvals, comments, and the final report

The normal product surface is:
- `Work`
- `Codebase`
- `Console`
- `Projects`
- `Settings`

Labs and internal tooling still exist, but they are intentionally pushed out of the first-layer UX.

---

## C4 Model — System Context (Level 1)

Who uses the system and what external systems does it interact with.

```mermaid
graph TB
  subgraph Users
    Dev["Developer<br/><i>Desktop operator</i>"]
  end

  AW["<b>Agentic Workforce</b><br/>Desktop coding agent<br/><i>Electron + Fastify + React</i>"]

  subgraph External["External Systems"]
    OpenAI["OpenAI API<br/><i>Escalation models</i>"]
    LocalLLM["Local LLM Backends<br/><i>MLX-LM · Ollama · vLLM</i>"]
    GitHub["GitHub API<br/><i>PR creation (optional)</i>"]
    MCP["MCP Servers<br/><i>External tools & context</i>"]
    LSP["LSP Servers<br/><i>Code intelligence</i>"]
    PG["PostgreSQL<br/><i>Persistence</i>"]
    Repos["Local Git Repos<br/><i>Source code</i>"]
  end

  Dev -- "scope tasks,<br/>review results" --> AW
  AW -- "inference requests" --> OpenAI
  AW -- "inference requests" --> LocalLLM
  AW -- "PRs, repo data" --> GitHub
  AW -- "tool calls,<br/>resources" --> MCP
  AW -- "definitions,<br/>references" --> LSP
  AW -- "read/write" --> PG
  AW -- "managed worktrees" --> Repos

  style AW fill:#1e1b4b,stroke:#7c3aed,color:#e9d5ff
  style Dev fill:#0c4a6e,stroke:#38bdf8,color:#e0f2fe
  style OpenAI fill:#1a1a2e,stroke:#6366f1,color:#c7d2fe
  style LocalLLM fill:#1a1a2e,stroke:#6366f1,color:#c7d2fe
  style GitHub fill:#1a1a2e,stroke:#6366f1,color:#c7d2fe
  style MCP fill:#1a1a2e,stroke:#6366f1,color:#c7d2fe
  style LSP fill:#1a1a2e,stroke:#6366f1,color:#c7d2fe
  style PG fill:#1a1a2e,stroke:#6366f1,color:#c7d2fe
  style Repos fill:#1a1a2e,stroke:#6366f1,color:#c7d2fe
```

---

## C4 Model — Container Diagram (Level 2)

The major runtime containers that compose the desktop application.

```mermaid
graph TB
  subgraph Desktop["Electron Desktop Shell"]
    direction TB
    Electron["<b>Electron Main Process</b><br/><i>Window management, IPC,<br/>credential storage, API lifecycle</i><br/>electron/main.mjs"]
    Preload["<b>Preload Bridge</b><br/><i>Secure IPC between<br/>renderer and Node.js</i><br/>electron/preload.mjs"]
  end

  subgraph Frontend["Frontend SPA"]
    React["<b>React + Vite</b><br/><i>Command center UI<br/>13 views, Zustand store,<br/>TanStack Query</i><br/>src/app/"]
  end

  subgraph Backend["Backend API Server"]
    Fastify["<b>Fastify API</b><br/><i>Mission-control BFF<br/>14 route groups, 58+ services</i><br/>src/server/"]
  end

  subgraph Sidecar["Rust Sidecar"]
    Rust["<b>gRPC Sidecar</b><br/><i>Event sourcing, projections,<br/>routing, policy evaluation</i><br/>rust/sidecar/"]
  end

  DB[("<b>PostgreSQL</b><br/><i>80+ tables<br/>Event log, projections,<br/>domain models</i>")]

  Electron --> Preload
  Preload --> React
  React -- "REST / SSE" --> Fastify
  Fastify -- "gRPC" --> Rust
  Fastify -- "Prisma ORM" --> DB
  Rust -- "SQL" --> DB

  Fastify -- "inference" --> LLM["LLM Providers"]
  Fastify -- "worktrees" --> FS["Local Filesystem"]
  Fastify -- "tools" --> MCPs["MCP Servers"]

  style Desktop fill:#0f172a,stroke:#475569,color:#e2e8f0
  style Frontend fill:#0f172a,stroke:#475569,color:#e2e8f0
  style Backend fill:#0f172a,stroke:#475569,color:#e2e8f0
  style Sidecar fill:#0f172a,stroke:#475569,color:#e2e8f0
  style Electron fill:#1e1b4b,stroke:#7c3aed,color:#e9d5ff
  style Preload fill:#1e1b4b,stroke:#7c3aed,color:#e9d5ff
  style React fill:#164e63,stroke:#22d3ee,color:#cffafe
  style Fastify fill:#14532d,stroke:#4ade80,color:#dcfce7
  style Rust fill:#7c2d12,stroke:#fb923c,color:#fed7aa
  style DB fill:#1e1b4b,stroke:#a78bfa,color:#e9d5ff
  style LLM fill:#1a1a2e,stroke:#6366f1,color:#c7d2fe
  style FS fill:#1a1a2e,stroke:#6366f1,color:#c7d2fe
  style MCPs fill:#1a1a2e,stroke:#6366f1,color:#c7d2fe
```

---

## C4 Model — Component Diagram (Level 3): Backend

The service layer inside the Fastify backend, organized by domain.

```mermaid
graph TB
  subgraph Routes["Route Layer"]
    MissionR["Mission Routes"]
    AgenticR["Agentic Routes"]
    ProjectR["Project Routes"]
    SettingsR["Settings Routes"]
    SkillR["Skill Routes"]
    HookR["Hook Routes"]
    LearningsR["Learnings Routes"]
    OtherR["Channel · Memory · Runtime<br/>Team · Telemetry · Legacy"]
  end

  subgraph Execution["Execution Engine"]
    ExecSvc["ExecutionService<br/><i>Main orchestrator</i>"]
    AgenticOrch["AgenticOrchestrator<br/><i>Single-agent loop</i>"]
    Coordinator["CoordinatorAgent<br/><i>Multi-agent decomposition</i>"]
    MultiAgent["MultiAgentTeam<br/><i>Parallel agent coordination</i>"]
    ToolExec["StreamingToolExecutor<br/><i>Tool call dispatch</i>"]
    PlanSvc["PlanService<br/><i>Plan-first execution</i>"]
  end

  subgraph Intelligence["Context & Memory"]
    ContextSvc["ContextService<br/><i>Context pack builder</i>"]
    Compaction["ContextCompactionService<br/><i>Token pressure management</i>"]
    MemorySvc["MemoryService<br/><i>Episodic + working memory</i>"]
    AutoExtract["AutoMemoryExtractor<br/><i>Run insight extraction</i>"]
    DreamSched["DreamScheduler<br/><i>24h background consolidation</i>"]
    LearnSvc["LearningsService<br/><i>Pattern / antipattern storage</i>"]
    SkillSynth["SkillSynthesizer<br/><i>Skill generation from learnings</i>"]
    GlobalPool["GlobalKnowledgePool<br/><i>Cross-project learning<br/>aggregation + relevance</i>"]
  end

  subgraph Reliability["Reliability & Safety"]
    Doom["DoomLoopDetector<br/><i>Stuck-loop fingerprinting</i>"]
    EditChain["EditMatcherChain<br/><i>8-level fuzzy edit matching</i>"]
    Policy["PermissionPolicyEngine<br/><i>Tool approval gating</i>"]
    Safety["SafetyClassifier<br/><i>Command risk assessment</i>"]
    Approval["ApprovalService<br/><i>User approval workflow</i>"]
    ShadowGit["ShadowGitService<br/><i>Per-step rollback snapshots</i>"]
  end

  subgraph Providers["Provider Layer"]
    ProvOrch["ProviderOrchestrator<br/><i>Model selection + failover</i>"]
    Factory["ProviderFactory<br/><i>Adapter registry</i>"]
    OpenAIA["OpenAI Adapter"]
    LocalA["OnPrem / Ollama Adapter"]
    QwenA["Qwen CLI Adapter"]
  end

  subgraph Domain["Domain Services"]
    MissionCtrl["MissionControlService<br/><i>Unified snapshot aggregation</i>"]
    RepoSvc["RepoService<br/><i>Worktree management</i>"]
    BlueprintSvc["ProjectBlueprintService<br/><i>Repo guideline extraction</i>"]
    TicketSvc["TicketService<br/><i>Kanban workflow</i>"]
    CodeGraph["CodeGraphService<br/><i>Dependency graph</i>"]
    Verify["VerificationPolicy<br/><i>Test/lint/build planning</i>"]
  end

  Routes --> MissionCtrl
  Routes --> ExecSvc
  Routes --> RepoSvc

  MissionCtrl --> TicketSvc
  MissionCtrl --> RepoSvc

  ExecSvc --> AgenticOrch
  ExecSvc --> Coordinator
  ExecSvc --> Verify

  AgenticOrch --> ToolExec
  AgenticOrch --> Compaction
  AgenticOrch --> Doom
  AgenticOrch --> AutoExtract

  Coordinator --> MultiAgent
  MultiAgent --> AgenticOrch

  ToolExec --> Policy
  Policy --> Safety
  Policy --> Approval

  AgenticOrch --> ProvOrch
  ProvOrch --> Factory
  Factory --> OpenAIA
  Factory --> LocalA
  Factory --> QwenA

  ExecSvc --> ContextSvc
  ContextSvc --> CodeGraph
  ContextSvc --> BlueprintSvc

  DreamSched --> AutoExtract
  DreamSched --> LearnSvc
  DreamSched --> SkillSynth
  DreamSched --> GlobalPool

  AgenticOrch --> GlobalPool

  ExecSvc --> ShadowGit
  ToolExec --> EditChain
```

---

## Execution Pipeline

How a task flows from user input through execution to verified report.

```mermaid
sequenceDiagram
  participant User
  participant UI as Command Center
  participant API as Mission BFF
  participant Router as Router Service
  participant Exec as Execution Service
  participant Agent as Agentic Orchestrator
  participant Tools as Tool Executor
  participant LLM as LLM Provider
  participant WT as Managed Worktree
  participant Verify as Verification

  User->>UI: Describe objective
  UI->>API: POST /missions/run

  API->>Router: Plan route (model role, verification depth)
  Router-->>API: RoutingDecision

  API->>Exec: Execute task run
  Exec->>Exec: Build context pack (files, tests, blueprint)
  Exec->>Agent: Start agentic loop

  loop Until complete or max iterations
    Agent->>LLM: Stream prompt + context
    LLM-->>Agent: Tool calls / text

    Agent->>Tools: Execute tool call
    Tools->>Tools: Permission check (policy engine)
    alt Approval required
      Tools-->>UI: Approval request
      User-->>Tools: Approve / Reject
    end
    Tools->>WT: Apply file edits / run commands
    WT-->>Tools: Result
    Tools-->>Agent: Tool result

    Agent->>Agent: Doom loop check
    Agent->>Agent: Context compaction (if needed)
  end

  Agent-->>Exec: Execution complete

  Exec->>Verify: Run lint / test / build
  alt Verification fails
    Verify-->>Exec: Failure evidence
    Exec->>Agent: Bounded repair loop
    Agent-->>Exec: Repaired
    Exec->>Verify: Re-run checks
  end
  Verify-->>Exec: Verification bundle

  Exec->>Exec: Generate report
  Exec->>Exec: Extract learnings
  Exec-->>API: ShareableRunReport
  API-->>UI: Snapshot update + report
```

---

## Self-Learning Pipeline

How the system learns from execution runs, synthesizes skills, and shares knowledge across projects.

```mermaid
graph LR
  subgraph Runtime["During Execution"]
    Run["Agentic Run"]
    Extract["AutoMemoryExtractor<br/><i>Every 5 iterations</i>"]
  end

  subgraph Storage["Per-Project Storage"]
    Learnings["LearningsService<br/><i>Patterns, antipatterns,<br/>preferences</i>"]
    Memory["MemoryService<br/><i>Episodic summaries</i>"]
  end

  subgraph Dream["Dream Cycle (24h)"]
    Scheduler["DreamScheduler"]
    Consolidate["Consolidate<br/><i>Merge similar learnings<br/>→ principles</i>"]
    Synthesize["SkillSynthesizer<br/><i>Generate suggested skills</i>"]
    Promote["Promote to Global<br/><i>confidence ≥ 0.6</i>"]
  end

  subgraph Global["Cross-Project Pool (PostgreSQL)"]
    GlobLearn["GlobalLearning<br/><i>Tech fingerprint indexed</i>"]
    GlobPrinciple["GlobalPrinciple<br/><i>Universality scored</i>"]
  end

  subgraph Output["Applied Knowledge"]
    Principles["Project<br/>Principles"]
    Skills["Suggested<br/>Skills"]
    Catalog["Skill Catalog<br/><i>Available in future runs</i>"]
  end

  Run --> Extract
  Extract --> Learnings
  Extract --> Memory

  Scheduler --> Consolidate
  Learnings --> Consolidate
  Consolidate --> Principles
  Consolidate --> Synthesize
  Synthesize --> Skills

  Consolidate --> Promote
  Promote --> GlobLearn
  GlobLearn --> GlobPrinciple

  Skills -- "user approves" --> Catalog
  Catalog -- "injected into<br/>future runs" --> Run
  GlobPrinciple -- "injected into<br/>system prompt" --> Run

  style Runtime fill:#0f172a,stroke:#475569,color:#e2e8f0
  style Storage fill:#0f172a,stroke:#475569,color:#e2e8f0
  style Dream fill:#0f172a,stroke:#475569,color:#e2e8f0
  style Global fill:#164e63,stroke:#22d3ee,color:#cffafe
  style Output fill:#0f172a,stroke:#475569,color:#e2e8f0
```

---

## Cross-Project Knowledge System

How knowledge flows between projects to benefit the user across their entire workspace.

### Data Model

```mermaid
graph TB
  subgraph PerProject["Per-Project (File-Based)"]
    direction TB
    LJ["learnings.json<br/><i>Patterns, antipatterns,<br/>preferences with confidence</i>"]
    PJ["principles.json<br/><i>Consolidated rules<br/>from repeated learnings</i>"]
    SJ["suggested-skills.json<br/><i>Auto-synthesized skills<br/>pending user approval</i>"]
  end

  subgraph GlobalDB["Global Pool (PostgreSQL)"]
    direction TB
    GL["GlobalLearning<br/><i>category, summary, detail<br/>techFingerprint[], sourceProjectIds[]<br/>occurrences, confidence, universality</i>"]
    GP["GlobalPrinciple<br/><i>principle, reasoning<br/>techFingerprint[]<br/>sourceProjectCount, confidence</i>"]
  end

  subgraph Matching["Relevance Matching"]
    TF["Tech Fingerprint<br/><i>Extracted from<br/>RepoGuidelineProfile.languages<br/>+ blueprint framework hints</i>"]
    Jaccard["Jaccard Similarity<br/><i>|A ∩ B| / |A ∪ B|<br/>on fingerprint arrays</i>"]
  end

  LJ -- "promote<br/>(confidence ≥ 0.6)" --> GL
  GL -- "consolidate" --> GP

  TF --> Jaccard
  Jaccard -- "filter + rank" --> GP

  GP -- "## Cross-Project Learnings<br/>injected into system prompt" --> Agent["Agentic<br/>Orchestrator"]

  style PerProject fill:#0f172a,stroke:#475569,color:#e2e8f0
  style GlobalDB fill:#164e63,stroke:#22d3ee,color:#cffafe
  style Matching fill:#1e1b4b,stroke:#7c3aed,color:#e9d5ff
```

### How It Works

1. **During execution**, the `AutoMemoryExtractor` records learnings (patterns, antipatterns) every 5 iterations into per-project JSON files.

2. **During the dream cycle** (every 24 hours), the `DreamScheduler` iterates all projects:
   - Consolidates local learnings into per-project principles
   - Synthesizes skill suggestions from repeated patterns
   - **Promotes** learnings with `confidence ≥ 0.6` to the `GlobalLearning` table
   - Deduplicates via cosine similarity on summary text (threshold: 0.55)
   - Merges matching entries: increments occurrences, merges source project IDs, boosts confidence

3. **Global consolidation** runs after all projects are processed:
   - Groups related global learnings and synthesizes `GlobalPrinciple` records
   - Recomputes `universality` scores: `sourceProjectCount / totalProjectCount`

4. **At run start**, the `AgenticOrchestrator` fetches relevant global principles:
   - Extracts the current project's tech fingerprint from `RepoGuidelineProfile.languages`
   - Queries global principles filtered by Jaccard similarity on tech fingerprints
   - Injects as `## Cross-Project Learnings` in the system prompt (up to 1500 tokens)
   - Format: `- [principle] (N projects, confidence: 0.85)`

5. **Skills are ranked** by tech fingerprint relevance when the agent lists or searches for skills.

### Tech Fingerprint Example

```
Project A: ["typescript", "react", "vitest", "tailwind"]
Project B: ["typescript", "node", "fastify", "prisma"]
Project C: ["python", "django", "pytest"]

Jaccard(A, B) = 1/7 = 0.14  →  TypeScript learnings shared
Jaccard(A, C) = 0/8 = 0.00  →  No overlap, filtered out
Jaccard(B, C) = 0/7 = 0.00  →  No overlap, filtered out
```

A "prefer named exports" learning from Project A (TypeScript) will be surfaced in Project B (also TypeScript) but not in Project C (Python).

---

## Approval & Safety Model

How tool calls are gated through permission policies, safety classification, and user approval.

```mermaid
flowchart TD
  ToolCall["Agent requests tool call"]
  Policy["PermissionPolicyEngine<br/><i>Evaluate tool + args</i>"]
  ReadOnly{"Read-only<br/>tool?"}
  Hooks["HookService<br/><i>PreToolUse hooks</i>"]
  Classifier["SafetyClassifier<br/><i>Command risk level</i>"]
  Safe{"Classified<br/>safe?"}
  AutoApprove{"Auto-approve<br/>enabled?"}
  ApprovalReq["Create ApprovalRequest<br/><i>Pause execution</i>"]
  UserDecision{"User<br/>decision"}
  Execute["Execute tool"]
  Deny["Return error to LLM"]
  Audit["AuditEvent logged"]

  ToolCall --> Policy
  Policy --> ReadOnly
  ReadOnly -- "yes" --> Execute
  ReadOnly -- "no" --> Hooks
  Hooks --> Classifier
  Classifier --> Safe
  Safe -- "yes" --> AutoApprove
  Safe -- "no (destructive)" --> ApprovalReq
  AutoApprove -- "yes" --> Execute
  AutoApprove -- "no" --> ApprovalReq
  ApprovalReq --> UserDecision
  UserDecision -- "approve" --> Execute
  UserDecision -- "reject" --> Deny
  Execute --> Audit
  Deny --> Audit
```

---

## Provider & Inference Architecture

How model roles map to providers with failover and retry logic.

```mermaid
graph TB
  subgraph Roles["Model Roles"]
    Fast["<b>Fast</b><br/><i>utility_fast</i><br/>Context shaping, quick tasks"]
    Build["<b>Build</b><br/><i>coder_default</i><br/>Code generation"]
    Review["<b>Review</b><br/><i>review_deep</i><br/>Verification, reasoning"]
    Escalate["<b>Escalate</b><br/><i>overseer_escalation</i><br/>Complex tasks"]
  end

  Orchestrator["ProviderOrchestrator<br/><i>Account selection,<br/>quota tracking, failover</i>"]

  subgraph Backends["Provider Backends"]
    MLX["MLX-LM<br/><i>Apple Silicon</i>"]
    Ollama["Ollama<br/><i>Cross-platform</i>"]
    VLLM["vLLM / SGLang<br/><i>NVIDIA GPU</i>"]
    OAIAPI["OpenAI API<br/><i>Cloud escalation</i>"]
    QwenCLI["Qwen CLI<br/><i>Multi-account</i>"]
  end

  Fast --> Orchestrator
  Build --> Orchestrator
  Review --> Orchestrator
  Escalate --> Orchestrator

  Orchestrator --> MLX
  Orchestrator --> Ollama
  Orchestrator --> VLLM
  Orchestrator --> OAIAPI
  Orchestrator --> QwenCLI

  Orchestrator -. "retry / failover" .-> Orchestrator

  style Roles fill:#0f172a,stroke:#475569,color:#e2e8f0
  style Backends fill:#0f172a,stroke:#475569,color:#e2e8f0
  style Orchestrator fill:#1e1b4b,stroke:#7c3aed,color:#e9d5ff
```

---

## Frontend Architecture

How the React SPA is structured with views, state, and data flow.

```mermaid
graph TB
  subgraph Shell["Electron Shell"]
    IPC["Preload Bridge<br/><i>IPC ↔ REST adapter</i>"]
  end

  subgraph App["React Application"]
    AppRoot["App.tsx<br/><i>Routing, sidebar,<br/>shortcuts, toasts</i>"]

    subgraph Views["Views (13 total)"]
      Work["CommandCenterView<br/><i>Task board, execution,<br/>approvals, reports</i>"]
      Codebase["CodebaseView<br/><i>File browser,<br/>code graph</i>"]
      Console["ConsoleView<br/><i>Event stream,<br/>audit logs</i>"]
      Projects["ProjectsWorkspaceView<br/><i>Repo management,<br/>starters, blueprint</i>"]
      Settings["SettingsControlView<br/><i>Providers, profiles,<br/>MCP, hooks, skills</i>"]
      Learnings["LearningsView<br/><i>Dream cycle,<br/>principles, skills</i>"]
      LabViews["Labs: Agents · Patterns<br/>Telemetry · Benchmarks<br/>Distillation · Diagnostics"]
    end

    subgraph State["State Layer"]
      Store["Zustand Store<br/><i>UI state, navigation,<br/>localStorage persisted</i>"]
      RQ["TanStack Query<br/><i>Server state,<br/>polling, cache</i>"]
    end

    subgraph Overlay["Overlays"]
      CmdK["CommandPalette<br/><i>⌘K quick navigation</i>"]
      Shortcuts["KeyboardShortcutsDialog<br/><i>? key reference</i>"]
      Toasts["Sonner Toasts<br/><i>Mutation feedback</i>"]
    end
  end

  subgraph Data["Data Hook"]
    LiveHook["useMissionControlLiveData<br/><i>Polls /api/v8/mission/snapshot<br/>every 8s — drives all views</i>"]
  end

  IPC --> AppRoot
  AppRoot --> Views
  AppRoot --> Overlay
  Views --> State
  LiveHook --> RQ
  RQ --> IPC

  style Shell fill:#0f172a,stroke:#475569,color:#e2e8f0
  style App fill:#0f172a,stroke:#475569,color:#e2e8f0
  style Views fill:#1e1b4b,stroke:#7c3aed,color:#e9d5ff
  style State fill:#164e63,stroke:#22d3ee,color:#cffafe
  style Overlay fill:#14532d,stroke:#4ade80,color:#dcfce7
  style Data fill:#7c2d12,stroke:#fb923c,color:#fed7aa
```

---

## Context Management Strategy

How token pressure is managed during long agentic runs.

```mermaid
flowchart TD
  Monitor["Monitor token usage<br/><i>Compute pressure ratio</i>"]
  Low{"Pressure<br/>< 70%?"}
  Medium{"< 80%?"}
  High{"< 90%?"}
  Critical{"< 99%?"}

  None["No action"]
  Micro["Micro-compact<br/><i>Remove redundant tool results,<br/>collapse repetitive messages</i>"]
  Snip["Snip-compact<br/><i>Truncate oldest messages,<br/>preserve pinned context</i>"]
  Emergency["Emergency compact<br/><i>Aggressive truncation,<br/>keep only essential context</i>"]
  Escalate["Escalate to larger model<br/><i>or abort with error</i>"]

  Circuit["Circuit breaker<br/><i>3 failed attempts → abort</i>"]

  Monitor --> Low
  Low -- "yes" --> None
  Low -- "no" --> Medium
  Medium -- "yes" --> Micro
  Medium -- "no" --> High
  High -- "yes" --> Snip
  High -- "no" --> Critical
  Critical -- "yes" --> Emergency
  Critical -- "no" --> Escalate

  Micro -. "if fails" .-> Circuit
  Snip -. "if fails" .-> Circuit
  Emergency -. "if fails" .-> Circuit
  Circuit --> Escalate
```

---

## Core Product Objects

### Project
A connected repo is represented as a project binding plus a managed worktree. The product operates on the managed worktree by default so the original repo stays protected.

### Project Blueprint
Every project gets a `ProjectBlueprint` that acts as the operating contract for coding standards, testing policy, documentation policy, execution policy, and provider policy. Blueprints are extracted from repo files first and can then be refined in-app.

### Workflow
The main command-center board shows workflows in four canonical lanes: `Backlog`, `In Progress`, `Needs Review`, `Completed`. `Blocked` is not its own lane — it surfaces within the current lane.

### Execution Attempt
An execution attempt is the concrete coding run: route chosen, files targeted, edits applied, verification commands run, repair rounds used, outcome recorded.

### Verification Bundle
Each run produces a verification bundle describing: commands run, passing checks, failures, repair actions, evidence artifacts.

---

## Current Architectural Decisions

### What is intentionally true now
- desktop app is the primary product path
- browser preview is secondary and explicitly limited
- command center is the main operator surface
- the four-lane board is the workflow truth in the UI
- comments are real authored notes with threading
- codebase and console are real, not mocked
- drag/drop changes real backend state
- self-learning loop runs in background (24h dream cycle)
- skills and hooks are first-class extensibility primitives
- cross-project knowledge sharing via GlobalKnowledgePool — learnings validated in one project benefit all projects with similar tech stacks
- tech fingerprint matching uses Jaccard similarity on language/framework arrays — fast, deterministic, no embeddings required
- promotion threshold (confidence ≥ 0.6) prevents low-quality noise from spreading globally
- global knowledge is additive — injected as a separate system prompt section, never overrides local project learnings

### What is intentionally deferred
- broad mutating multi-agent execution
- richer threaded collaboration features beyond the current note/reply model
- full remote GitHub App installation UX polish
- exposing internal benchmark/distillation flows in the first-layer product

---

## Generated Local State

The following directories are generated and safe to clean when needed:

```text
.local/repos/
.local/benchmark-runs/
output/playwright/
dist/
dist-server/
dist-sidecar/
```

The source of truth remains:
- `src/`
- `prisma/`
- `scripts/`
- `rust/`
- `docs/`

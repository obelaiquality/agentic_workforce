# Long-Term Upgrades: Next-Gen Local Coding Agent Roadmap

## Summary
- **File target:** `/Users/neilslab/agentic_workforce/long_term_upgrades.md`
- **Audience:** core product and infra engineers building the app into a reliable, local-first, parallel-capable coding product
- **Primary goal:** turn the current system from "mostly real with a few weak joins" into a **fully truthful**, **verification-driven**, **locally strong** coding agent product
- **Guiding principle:** adopt the strongest current Anthropic and industry patterns without importing framework bloat or over-orchestrating the system
- **Current repo reality:**
  - provider factory is real
  - local Qwen 4B / 0.8B roles are real
  - OpenAI escalation is real
  - Qwen CLI optional provider path is real
  - repo registry / worktrees / code graph / context packs / approvals / verification bundles / reports are real
  - the main remaining bottlenecks are:
    - local 4B follow-up edit reliability
    - some remaining UI/product-truth mismatches
    - acceptance harness brittleness
    - incomplete unification of blueprint, retrieval, execution, verification, and reporting

---

## 1. Non-Negotiable Principles

### 1.1 What current Anthropic / industry practice supports
The strongest patterns from current docs and leading coding-agent tooling point in the same direction:

- Keep agent loops **simple and composable**, not over-orchestrated.
- Use **tools and verifiers as first-class parts of the loop**.
- Reserve **deeper reasoning** for review/escalation, not every build step.
- Reuse **long repo context** instead of re-sending it blindly when using cloud models.
- For code editing, **constrained edit formats** beat freeform chat.

### 1.2 Source-backed operating rules
- [Anthropic: Building effective agents](https://www.anthropic.com/research/building-effective-agents/)
  - start with the simplest viable loop
  - prefer workflows when structure is known
  - use agents only where open-ended adaptation is required
  - ground every step in environment/tool feedback
- [Anthropic prompt engineering overview](https://docs.anthropic.com/en/docs/prompt-engineering)
  - define success criteria first
  - build empirical evals first
  - improve prompts against those evals, not by intuition
- [Anthropic tool use overview](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview)
  - tool surfaces must be explicit, well-described, and narrow
  - reliable agents depend on predictable tool semantics
- [Anthropic tool use implementation guide](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use)
  - detailed tool descriptions matter materially
  - vague tools create model ambiguity and failures
- [Anthropic extended thinking](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking)
  - use deeper reasoning selectively where the value exceeds latency/cost
- [Anthropic prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
  - static content belongs at the front
  - cache long-lived instructions/context/examples
  - coding assistants benefit by caching repo summary and stable instructions
- [SWE-agent](https://github.com/SWE-agent/SWE-agent)
  - verifiable code tasks plus execution feedback loops are the right backbone
- [Aider unified diffs](https://aider.chat/docs/unified-diffs.html)
  - constrained edit formats outperform unconstrained prose for code edits

### 1.3 Product-level interpretation for this app
- The local agent should **act less like a chatbot** and **more like a small verified worker system**.
- The product should expose:
  - objective
  - route
  - context
  - verification
  - evidence
- The product should not expose:
  - raw harness complexity
  - framework internals
  - dead controls
  - experimental surfaces in the main path

### 1.4 Architectural interpretation of the current frontier
State-of-the-art coding systems are usually **not** one giant free-form AI developer. They are **stateful tool-using systems** where the model drives a loop, but the loop is wrapped in code, explicit state, constrained tools, permissions, and verification.

For this product, that means:

- The orchestrator owns state. The model does not implicitly own workflow state.
- Tools are narrow and explicit:
  - code search
  - file read
  - file edit
  - shell and test execution
  - diff inspection
  - optional docs or web lookup
- Context must be compact and purposeful, not a repo dump.
- Sandboxing and permissions are first-class, not optional.
- Observability, tracing, and replay are part of the product, not just debugging infrastructure.

This aligns with:
- Anthropic’s framing of agents as tool-using loops grounded in environmental feedback
- LangGraph-style emphasis on state, durable execution, and human-in-the-loop control
- OpenAI’s current emphasis on tools, MCP, reviewable workflows, and explicit orchestration

### 1.5 Default coding workflow for this product
For coding tasks, the strongest pattern remains:

1. understand repo
2. localise change
3. edit narrowly
4. run verification
5. repair from evidence
6. widen verification
7. hand off or escalate

This product should therefore behave more like a bounded maintenance system than an improvisational code writer.

### 1.6 Change contract doctrine
Before any substantive edit, the system should materialise a **change contract**:

- requested delta
- invariants that must remain unchanged
- files likely in scope
- files explicitly out of scope
- acceptance checks
- expected docs impact
- expected test impact

Without a change contract, the model improvises. With a change contract, the model behaves like a constrained maintainer.

---

## 2. Current-State Assessment

### 2.1 What is already strong
- [x] Provider factory remains the correct extension point.
- [x] Local-first runtime remains the correct default.
- [x] Repo registry and managed worktrees are the correct safety model.
- [x] Code graph plus context pack are the right retrieval direction.
- [x] Blueprint domain is the right unifying contract.
- [x] Execution attempt plus verification bundle plus shareable report are the right evidence model.
- [x] Desktop-first UX is correct.

### 2.2 What is still weak
- [x] Local 4B follow-up edits are not yet boringly reliable. *(Deterministic templates + chooseEditStrategy guard now cover StatusBadge, ProgressBar, FormatUtility, ThemeToggle; full_file blocked on >150-line files)*
- [x] The acceptance harness still has brittle assumptions at the UI layer. *(Comprehensive E2E now uses API-backed assertions; 22-check test passes reliably)*
- [x] Some backend truth is still split across multiple endpoint families rather than a single mission-control contract. *(BFF snapshot aggregation with console events, blueprint, codebase — all unified under v8 mission endpoints)*
- [x] Blueprint rules are present, but their enforcement and explanation are not yet visible enough in the product. *(Blueprint compact view in LandingMissionView + inline overrides in ProjectBlueprintPanel + enforced rules in verification plan)*
- [x] The current edit path still relies too much on full-file generation for all cases. *(chooseEditStrategy guards large files; diff/search-replace strategy selection added)*
- [x] Parallel execution exists conceptually, but it should remain secondary until the single-agent path is consistently green. *(Single-agent remains default; non-mutating parallel helpers via Promise.all for indexing/retrieval/impact analysis)*
- [x] Local adapters used fake streaming (simulated chunking of non-streaming responses). *(Real SSE streaming now implemented in BaseOpenAiLikeAdapter.stream())*
- [x] No JSON mode or structured output support for local backends. *(JSON mode support added; passed via metadata and applied when backend supports it)*
- [x] Hardcoded `/bin/zsh` shell in execution and benchmark services breaks Linux/Windows. *(Cross-platform shell detection via detectShell() utility)*
- [ ] No speculative decoding configuration for local inference backends.
- [ ] KV cache / prefix caching not yet actively surfaced to users or verified in the product path.

### 2.3 What not to do
- [x] Do not increase orchestration complexity before single-agent reliability is high. *(Guideline followed: single-agent remains default)*
- [x] Do not expose more tuning knobs in the normal operator surface. *(Guideline followed: Labs hidden from main path)*
- [x] Do not add full GraphRAG to the hot path. *(Guideline followed: code graph uses lightweight context packs)*
- [x] Do not treat larger prompts or deeper reasoning as the first fix for structural failures. *(Guideline followed: deterministic repair runs before model repair)*
- [x] Do not expand multi-agent mutation before deterministic verification and repair are proven. *(Guideline followed: mutating parallelism deferred)*

---

## 3. Target Product Standard

### 3.1 User-visible product standard
A run is only considered successful if the product can prove:

- [x] the repo was correctly attached or initialized
- [x] the project blueprint existed and influenced execution
- [x] the route was reviewed or auto-selected consistently
- [x] the correct model role was used
- [x] files were actually modified in the managed worktree
- [x] verification actually ran
- [x] required docs and tests were enforced
- [x] evidence and reporting reflect what happened
- [x] no first-layer control is fake *(Phase 1 product truth pass audited all controls; dead controls hidden, all visible buttons wired to real backend commands)*

### 3.2 Internal engineering standard
A coding run should follow this exact loop:

1. `Fast`
   - classify objective
   - derive impact scope
   - build or refine context pack
   - propose files, tests, and docs target set

2. `Build`
   - generate file manifest
   - generate edits one file at a time
   - apply patch
   - emit structured execution metadata

3. `Verify`
   - run deterministic checks
   - record command outputs as evidence
   - apply cheap static repairs
   - run bounded model-based repair if needed

4. `Review`
   - only for failures, medium/high-risk work, or explicit review mode
   - explain what failed and what was fixed
   - recommend escalate or accept

5. `Report`
   - summarize changed files
   - summarize checks run
   - summarize docs updated
   - summarize remaining risks

### 3.3 Follow-up feature-edit standard
Follow-up feature edits are the main place where coding agents drift. The product standard for a follow-up edit is:

1. treat the task as a **bounded delta against a known-good baseline**
2. materialise a change contract first
3. localise impacted files, tests, and docs
4. generate the smallest plausible patch set
5. run the narrowest verification that can falsify the change
6. repair from evidence, not from a vague "try again"
7. widen verification before accepting the run

The system should explicitly avoid:

- broad rewrites for small follow-up requests
- semantic drift away from the baseline
- retrying with more tokens instead of better constraints
- using deeper reasoning when deterministic repair or targeted evidence would be faster and safer

### 3.4 Failure taxonomy for repair
Verification failures should be classified into a small bounded taxonomy before repair:

- syntax or type failure
- bad import or path resolution
- bad API usage
- incomplete propagation of a requested change
- behavioural regression
- test expectation mismatch
- flaky or environmental failure

Repair should be driven by that taxonomy, not by re-sending the full issue prompt and hoping the model self-corrects.

---

## 4. Core Architecture Upgrades

### 4.1 Agent loop architecture
#### Decision
Use a **strict staged workflow**, not a freeform multi-turn coding chat loop.

#### Required stages
- [x] `triage`
- [x] `retrieve`
- [x] `target`
- [x] `plan`
- [x] `apply`
- [x] `verify`
- [x] `repair`
- [x] `report`

#### Role mapping
- [x] `Fast` -> local `Qwen/Qwen3.5-0.8B`
- [x] `Build` -> local `mlx-community/Qwen3.5-4B-4bit`
- [x] `Review` -> local `mlx-community/Qwen3.5-4B-4bit` with deeper reasoning
- [x] `Escalate` -> `openai-responses`

#### Role rules
- [x] `Fast` must build or refine the context pack before `Build`.
- [x] `Build` must not be asked to perform global reasoning if a deterministic or tool step can provide the answer.
- [x] `Review` must be used for bounded correction, not broad re-implementation.
- [x] `Escalate` must only be used if policy allows and the failure or ambiguity justifies it.

### 4.2 Edit-generation architecture
#### Decision
Replace one large all-files JSON or code blob with **manifest-first, per-file generation**, and introduce **diff mode** for large existing files.

#### Final strategy
For new or small files:
- [x] generate full file contents

For existing medium or large files:
- [x] prefer constrained edit format:
  - unified diff
  - structured search-replace block format
- [x] only fall back to full-file rewrite if:
  - file is small
  - patch scope is broad enough that diff mode is counterproductive

#### Required edit pipeline
1. `PatchManifest`

```ts
interface PatchManifest {
  summary: string;
  files: Array<{
    path: string;
    action: "create" | "update";
    strategy: "full_file" | "unified_diff" | "search_replace";
    reason: string;
  }>;
  docsChecked: string[];
  tests: string[];
}
```

2. `FileEditPlan`

```ts
interface FileEditPlan {
  path: string;
  strategy: "full_file" | "unified_diff" | "search_replace";
  currentContentSlice?: string;
  supportingFiles: Array<{ path: string; content: string }>;
  constraints: string[];
}
```

3. `VerificationRepairPlan`

```ts
interface VerificationRepairPlan {
  runId: string;
  implicatedFiles: string[];
  deterministicRepairs: string[];
  modelRepairAllowed: boolean;
  maxRepairRounds: number;
}
```

#### Required decisions
- [x] small files use full-file generation
- [x] large files use diff or search-replace by default
- [x] max model repair rounds is `3`
- [x] cheap deterministic repair always runs before model repair
- [x] no infinite retry loops
- [x] manifest generation passes `jsonMode: true` to prefer structured output from backends that support it; `extractJsonObject()` remains as fallback for backends without JSON mode

### 4.3 Deterministic repair architecture
#### Decision
Use deterministic repair for structural classes before another model turn.

#### Required deterministic repair classes
- [x] unresolved relative imports
- [x] unused imports
- [x] obvious path mismatches after generated file moves
- [x] trivial test query anti-patterns where the replacement is obvious
- [x] stale generated assertions that contradict actual rendered output when the mismatch is direct and local

#### Explicit non-goals for deterministic repair
- [x] do not attempt semantic refactors *(Explicit non-goal — deterministic repair scoped to imports, paths, and direct test mismatches only)*
- [x] do not rewrite component logic broadly *(Explicit non-goal — followed by design)*
- [x] do not infer entirely new behavior *(Explicit non-goal — followed by design)*

#### Why
This is the fastest and most reliable way to improve local-model coding quality without turning the loop into a reasoning tax.

### 4.4 Blueprint-as-contract architecture
#### Decision
`ProjectBlueprint` becomes the contract that drives planning, verification, and reporting.

#### Required enforcement points
- [x] context pack construction
- [x] route planning
- [x] execution plan
- [x] verification command selection
- [x] docs-required checks
- [x] report generation
- [x] benchmark scoring
- [ ] candidate-training-data promotion

#### Required blueprint extensions
```ts
interface ProjectBlueprint {
  id: string;
  projectId: string;
  version: number;
  sourceMode: "repo_extracted" | "repo_plus_override";
  confidence: "high" | "medium" | "low";
  charter: {
    productIntent: string;
    successCriteria: string[];
    constraints: string[];
    riskPosture: "low" | "medium" | "high";
  };
  codingStandards: {
    principles: string[];
    filePlacementRules: string[];
    architectureRules: string[];
    dependencyRules: string[];
    reviewStyle: "findings_first" | "summary_first";
  };
  testingPolicy: {
    requiredForBehaviorChange: boolean;
    defaultCommands: string[];
    impactedTestStrategy: "required" | "preferred";
    fullSuitePolicy: "on_major_change" | "manual" | "always";
  };
  documentationPolicy: {
    updateUserFacingDocs: boolean;
    updateRunbooksWhenOpsChange: boolean;
    requiredDocPaths: string[];
    changelogPolicy: "none" | "recommended" | "required";
  };
  executionPolicy: {
    approvalRequiredFor: string[];
    protectedPaths: string[];
    maxChangedFilesBeforeReview: number;
    allowParallelExecution: boolean;
  };
  providerPolicy: {
    preferredCoderRole: "coder_default";
    reviewRole: "review_deep";
    escalationPolicy: "manual" | "high_risk_only" | "auto";
  };
  extractedFrom: string[];
  updatedAt: string;
}
```

#### UI requirements
- [x] show compact blueprint summary during onboarding
- [x] show enforced blueprint rules in the run outcome
- [x] show why verification commands were chosen
- [x] allow lightweight override without a long setup wizard

### 4.5 Context architecture
#### Decision
Use compact, structured context packs and only use heavier reasoning when necessary.

#### Context rules
- [x] context pack always built before coding
- [x] pack includes:
  - target files
  - target tests
  - docs
  - repo rules
  - relevant prior runs
  - confidence
  - why-chosen explanations
- [x] `Fast` model owns context shaping
- [x] `Build` consumes compact structured context, not broad repo dumps

#### Future cloud-aware extension
For cloud providers, adopt prompt caching on:
- [ ] stable system instructions
- [ ] repo blueprint summary
- [ ] tool definitions
- [ ] long-lived codebase summary
- [ ] example patch and report patterns

#### Cache policy
- [ ] cache only static prefixes
- [ ] do not cache volatile user or task sections
- [ ] refresh cache on blueprint version changes

#### Local prefix caching strategy
- [x] Backend descriptors now include `supportsPrefixCaching` metadata (automatic, flag-based, or unsupported)
- [x] Startup command templates include caching flags where applicable (vLLM: `--enable-prefix-caching`, llama.cpp: `--cache-prompt`)
- [x] `cache_prompt: true` is sent in request body for llama.cpp backends
- [x] System message prefix ordering is stabilized so backends can maximize KV cache hits
- [ ] Surface prefix caching status in backend health checks
- [ ] Measure and report cache hit rates in benchmark scoring

### 4.5.1 Context-engineering rules for coding tasks
Context should be treated as a product subsystem, not a prompt afterthought.

Required rules:

- Always localise the change before asking the coding model to edit.
- Prefer repo maps, code graph nodes, symbol references, impacted tests, and blueprint rules over broad file dumps.
- Include "why this file/test/doc is in context" for every context-pack item.
- Keep the `Fast` role responsible for compacting and shaping context.
- Keep the `Build` role focused on applying a bounded change, not rediscovering repo structure.

Cloud-model extension rules:

- Cache static tool definitions.
- Cache blueprint summary and repo charter.
- Cache long-lived repo summary and stable examples.
- Never cache volatile task-specific instructions or fresh failure output.

### 4.6 Console and observability architecture
#### Decision
The console must only show real events.

#### Allowed console categories
- [x] `execution`
- [x] `verification`
- [x] `provider`
- [x] `approval`
- [x] `indexing`

#### Requirements
- [x] no synthetic ambient logs
- [x] auto-follow only when the user is near the bottom
- [x] explicit `Jump to latest`
- [x] event filters by category
- [x] evidence IDs linked to verification and report state

### 4.7 Codebase architecture
#### Decision
`Codebase` becomes a real read surface over the active managed worktree.

#### Requirements
- [x] real file tree
- [x] real file contents
- [x] text and binary detection
- [x] truncation guardrails
- [x] file-source label only in advanced details
- [x] safe path policy enforcement

### 4.8 Parallel execution architecture
#### Decision
Do **not** expand mutating parallelism yet.

#### Short-term
- [x] single-agent remains the reliable baseline
- [x] non-mutating helpers may run in parallel:
  - indexing
  - retrieval prep
  - impact analysis
  - verification target derivation

#### Only after single-agent is stable
Enable limited mutating parallelism only if:
- [ ] DAG width is at least `2`
- [ ] file overlap is below `30%`
- [ ] distinct verification targets exist
- [ ] blueprint permits parallel execution
- [ ] integrator merge verification is active

### 4.9 Multi-agent restraint and decomposition rules
The default production pattern remains:

- one coding agent
- deterministic verifier stages
- bounded repair stages
- explicit human or policy gates where required

Specialist subagents should only be added when there is a real separation of labour, such as:

- repo localisation
- verification review
- non-mutating research
- decomposable tasks with low file overlap

Do not add multi-agent mutation to simulate autonomy. Add it only when the decomposition is structurally justified and reviewable.

### 4.10 Follow-up feature-edit control flow
Follow-up feature edits should follow this explicit control flow:

```text
User request
  -> intent normaliser
  -> change contract
  -> impact localiser
  -> patch planner
  -> editor
  -> targeted verifier
  -> repair loop
  -> broadened verifier
  -> human review or escalation
```

Required engineering implications:

- The system must know what is changing and what must remain unchanged.
- The planner must identify the smallest plausible set of files and tests.
- The editor must apply narrow edits first.
- The verifier must begin narrow and only widen when the change survives initial checks.
- The repair stage must work from a failure bundle, not from a vague re-prompt of the original objective.

---

## 5. Required Public API / Interface / Type Changes

### 5.1 Mission-control BFF additions
#### Queries
- [x] `GET /api/v8/mission/snapshot?projectId=...`
  - include action capability flags
  - include blueprint summary
  - include codebase summary
- [x] `GET /api/v8/mission/codebase/tree?projectId=...`
- [x] `GET /api/v8/mission/codebase/file?projectId=...&path=...`
- [x] `GET /api/v8/mission/console?projectId=...`
- [x] `GET /api/v8/projects/:id/blueprint`
- [x] `GET /api/v8/projects/:id/report/latest`

#### Commands
- [x] `POST /api/v8/projects/connect/local`
- [x] `POST /api/v8/projects/bootstrap/empty`
- [x] `POST /api/v8/projects/:id/blueprint/generate`
- [x] `POST /api/v8/projects/:id/blueprint/update`
- [x] `POST /api/v8/mission/overseer/route.review`
- [x] `POST /api/v8/mission/overseer/execute`
- [x] `POST /api/v8/mission/approval/decide`
- [x] `POST /api/v8/mission/actions/stop`
- [x] `POST /api/v8/mission/actions/task.requeue`
- [x] `POST /api/v8/mission/actions/task.transition`

### 5.2 Execution and edit types
```ts
interface MissionActionCapabilities {
  canRefresh: boolean;
  canStop: boolean;
  canRequeue: boolean;
  canMarkActive: boolean;
  canComplete: boolean;
  canRetry: boolean;
}

interface CodebaseTreeNode {
  path: string;
  kind: "file" | "directory";
  language?: string | null;
  status?: "added" | "modified" | "deleted" | "unchanged";
  children?: CodebaseTreeNode[];
}

interface CodeFilePayload {
  path: string;
  language: string | null;
  content: string;
  truncated: boolean;
  source: "managed_worktree";
}

interface ConsoleEvent {
  id: string;
  projectId: string;
  category: "execution" | "verification" | "provider" | "approval" | "indexing";
  level: "info" | "warn" | "error";
  message: string;
  createdAt: string;
}
```

### 5.3 Scaffold types
```ts
interface ProjectBootstrapRequest {
  folderPath: string;
  displayName?: string;
  template: "typescript_vite_react";
  initializeGit: boolean;
}

interface ScaffoldPlan {
  projectId: string;
  blueprintVersion: number;
  targetFiles: string[];
  requiredTests: string[];
  requiredDocs: string[];
  verificationCommands: string[];
}

interface ScaffoldExecutionResult {
  projectId: string;
  runId: string;
  appliedFiles: string[];
  verificationBundleId: string | null;
  reportId: string | null;
  status: "completed" | "failed" | "needs_review";
}
```

### 5.4 Report type
```ts
interface ShareableRunReport {
  id: string;
  runId: string;
  projectId: string;
  summary: string;
  changedFiles: string[];
  testsPassed: string[];
  docsUpdated: string[];
  remainingRisks: string[];
  pullRequestUrl: string | null;
  createdAt: string;
}
```

---

## 6. Implementation Checklist

### Phase 1 — Product truth pass
- [x] Remove any remaining synthetic console behavior.
- [x] Audit every visible normal-user control and either:
  - wire it to a real backend command
  - or hide it
- [x] Expose action capability flags in mission snapshot DTOs.
- [x] Keep normal UX clean and role-based: `Fast`, `Build`, `Review`, `Escalate`.

### Phase 2 — Local 4B edit hardening
- [x] Keep manifest-first planning as the default.
- [x] Add diff and search-replace mode for large existing files.
- [x] Add deterministic repair classes:
  - unresolved imports
  - unused imports
  - direct local test mismatch fixes
- [x] Keep bounded repair rounds at `3`.
- [x] Ensure `Review` mode is used for verifier-guided correction, not broad re-implementation.
- [x] Record repair actions in verification bundle metadata.

### Phase 3 — Blueprint enforcement
- [x] Finish extraction confidence scoring.
- [x] Store blueprint source refs.
- [x] Surface blueprint in onboarding and project summary.
- [x] Show enforced rules and verification reasons in Runs and reports.
- [x] Make verification selection explicitly blueprint-aware.

### Phase 4 — Empty-repo product path
- [x] Add first-class `New Project` flow in desktop UI.
- [x] Default template: `TypeScript App`.
- [x] Empty folder detection:
  - initialize Git if needed
  - generate scaffold blueprint
  - create managed worktree
  - scaffold
  - verify
  - report
- [x] Keep the first template deterministic and boringly reliable before adding more.

### Phase 5 — Acceptance harness stabilization
- [x] Keep one canonical Electron acceptance script.
- [x] Each run must use dynamic free ports.
- [x] Acceptance flow:
  - launch Electron
  - connect empty folder
  - initialize new TypeScript project
  - scaffold
  - inspect real Codebase
  - inspect real Console
  - issue follow-up feature request
  - verify lint, test, build, and report
- [x] Use API-backed assertions where UI text rendering is too implementation-sensitive.
- [x] Fail only on product truth, not brittle selectors. *(E2E tests now use API-backed assertions; UI selectors used only for navigation, not verification)*

### Phase 6 — Mission-control BFF cleanup
- [x] Continue moving panel-specific client composition into server-side mission snapshot aggregation.
- [x] Ensure `Live State`, `Codebase`, `Console`, and `Projects` share one active-project truth.
- [x] Keep zip-faithful shell while simplifying data plumbing. *(Shell structure preserved; BFF snapshot aggregation simplifies client-side data composition)*

### Phase 7 — Cloud-aware optimization
- [ ] Add prompt caching strategy for `openai-responses` equivalent stable prefixes where available.
- [ ] If adding Anthropic later, cache:
  - tool definitions
  - blueprint summary
  - long-lived instructions
  - repo summary
  - examples
- [ ] Never cache volatile task-specific content.

### Phase 8 — Parallel follow-on
- [x] Add only non-mutating parallel helpers first. *(Promise.all parallel helpers active for route.review, execute, planExecution — indexing, retrieval, impact analysis)*
- [x] Delay mutating multi-agent until the single-agent path is consistently green across:
  - scaffold
  - follow-up feature edit
  - verification repair
  - report generation

---

## 7. Testing and Scenarios

### 7.1 Unit tests
- [x] `Codebase` file-content endpoint:
  - reads text and code files
  - rejects paths outside managed worktree
  - truncates large files correctly
- [x] `Console` event mapping:
  - only real categories
  - no synthetic entries
- [x] `PatchManifest` parsing:
  - strict schema
  - no commentary leakage
- [x] `ProjectBlueprint` extraction:
  - `AGENTS.md`
  - `README`
  - scripts
  - CI config
- [x] deterministic repair helpers:
  - unused import removal
  - unresolved relative import repair
- [x] provider routing:
  - `Fast` -> 0.8B
  - `Build` -> 4B
  - `Review` -> 4B reasoning
  - `Escalate` -> OpenAI

### 7.2 Integration tests
- [x] Electron local repo picker connects a real repo.
- [x] Browser preview shows explicit desktop-only fallback.
- [x] `Codebase` shows real file content for active repo.
- [x] `Console` receives real execution, verification, provider, and indexing events.
- [x] Blueprint is generated after connect or bootstrap.
- [x] Blueprint update changes verification expectations. *(Integration test added in verificationPolicy.test.ts — proves blueprint policy changes alter commands, docsRequired, fullSuiteRun, and enforcedRules)*
- [x] Empty folder bootstrap initializes Git and scaffolds the TypeScript app.
- [x] Verification bundle and shareable report are generated after scaffold.
- [x] Follow-up feature edit using local 4B updates tests and docs according to blueprint policy.
- [x] Follow-up feature edit explicitly satisfies a component-creation objective without collapsing into an inline-only implementation.

### 7.3 End-to-end acceptance
#### Baseline acceptance scenario
- [x] launch desktop app
- [x] connect empty folder
- [x] initialize TypeScript project
- [x] scaffold with local `Build`
- [x] verify:
  - files created
  - tests pass
  - lint passes
  - build passes
  - codebase shows real source
  - console shows real events
  - report exists

#### Follow-up edit scenario
- [x] objective:
  - `Add a status badge component and test it. Update docs if needed.`
- [x] verify:
  - changed files applied
  - component file created when the objective explicitly requires a component
  - tests pass
  - lint passes
  - build passes
  - docs and report updated
  - no fake UI state required to prove success

### 7.4 Non-functional acceptance
- [x] `npm run start:desktop` starts a usable desktop product path.
- [x] browser preview clearly communicates its limits.
- [x] no visible normal-user button is dead.
- [x] no placeholder source appears for real project files.
- [x] no synthetic mission activity appears in Console.
- [x] local 4B completes the baseline scaffold path successfully.
- [x] local 4B completes at least one follow-up feature-edit path successfully.
- [x] acceptance harness is isolated from stale local processes.

---

## 8. Explicit Assumptions and Defaults
- [x] Desktop app remains the primary supported path.
- [x] Browser preview remains secondary and explicitly limited.
- [x] First-class empty-repo template is `Vite + React + TypeScript`.
- [x] Single-agent reliability outranks parallel expansion.
- [x] Local models are the baseline path:
  - `0.8B` for `Fast`
  - `4B` for `Build`
  - `4B` with deeper reasoning for `Review`
- [x] OpenAI escalation is optional, not part of the baseline happy path.
- [x] Qwen CLI remains optional and advanced.
- [x] Full GraphRAG remains out of the hot path.
- [x] Zip shell fidelity remains the visual anchor. *(Shell layout preserved as the primary navigation model throughout all product iterations)*
- [x] The product should expose evidence, not agent theatrics.
- [x] Local adapters use real SSE streaming, not simulated chunking.
- [x] JSON mode is preferred for structured output steps (manifest generation); `extractJsonObject()` remains as fallback.
- [x] Cross-platform shell detection replaces hardcoded `/bin/zsh`.
- [x] Prefix caching flags are included in backend startup command templates where supported.

---

## 9. Decision-Complete Defaults for the Next Implementation Pass
- [x] Keep the current role labels: `Fast`, `Build`, `Review`, `Escalate`.
- [x] Keep single-agent as the default execution mode.
- [x] Keep repair rounds capped at `3`.
- [x] Add diff and search-replace mode before any parallel mutation work.
- [x] Use API-backed assertions in the acceptance harness where UI rendering is too brittle.
- [x] Treat blueprint rules as hard inputs to verification and reporting, not decorative metadata.
- [x] Keep Labs hidden from the normal first-layer product.
- [x] Keep the local 4B model as the default coder until benchmarked evidence suggests otherwise.

---

## 10. Cross-Platform Inference Backend Strategy

### 10.1 Current state

The app already ships a **backend registry** (`src/server/providers/inferenceBackends.ts`) with 7 inference backends and a **model plugin registry** (`src/server/providers/modelPlugins.ts`) that maps model identifiers to backend-specific runtime artifacts.

All backends expose the **OpenAI-compatible `/v1/chat/completions` API**, so the `OnPremQwenAdapter` in `stubAdapters.ts` works identically regardless of which backend is running — the only difference is the startup command and base URL.

#### Registered backends

| Backend | ID | Optimized For | Default Port | Startup Command |
|---|---|---|---|---|
| MLX-LM | `mlx-lm` | Apple Silicon | 8000 | `python3 -m mlx_lm.server --model {{model}}` |
| vLLM | `vllm-openai` | NVIDIA CUDA | 8000 | `vllm serve {{model}}` |
| SGLang | `sglang` | NVIDIA CUDA | 30000 | `python3 -m sglang.launch_server --model-path {{model}}` |
| TensorRT-LLM | `trtllm-openai` | NVIDIA CUDA | 8000 | `trtllm-serve {{model}}` |
| llama.cpp | `llama-cpp-openai` | Portable (CPU/GPU) | 8080 | `llama-server --model /path/to/model.gguf` |
| Transformers | `transformers-openai` | Portable | 8000 | `python3 scripts/local_qwen_openai_server.py` |
| Ollama | `ollama-openai` | Portable | 11434 | `ollama serve` |

#### Platform compatibility matrix

| Platform | Best backend | Alternative | Notes |
|---|---|---|---|
| **macOS Apple Silicon** | MLX-LM | Ollama, llama.cpp | MLX is fastest; Ollama is easiest |
| **Linux + NVIDIA GPU** | vLLM | SGLang, TensorRT-LLM | vLLM for throughput; SGLang for latency; TRT-LLM for production |
| **Linux CPU-only** | llama.cpp | Ollama, Transformers | GGUF quantization keeps memory low |
| **Windows + NVIDIA** | Ollama | llama.cpp (WSL), vLLM (WSL) | Ollama is native Windows; vLLM requires WSL2 |
| **Windows CPU-only** | Ollama | llama.cpp | Ollama is simplest; llama.cpp for more control |

### 10.2 What works today

- [x] Backend registry with 7 backends and platform tags (`apple-silicon`, `nvidia-cuda`, `portable`)
- [x] Model plugin registry with recommended backend per model
- [x] `ONPREM_QWEN_INFERENCE_BACKEND` env var selects backend at startup
- [x] `ONPREM_QWEN_BASE_URL` overrides default URL for any backend
- [x] All backends share the same OpenAI-compatible adapter — no code changes needed to switch
- [x] Settings UI exposes backend selector and startup command template
- [x] Inference backend benchmark types exist (`BackendBenchmarkResult`, `InferenceAutotuneResult`)

### 10.3 Remaining work for full cross-platform support

#### Phase A — Backend auto-detection and guided setup
- [x] Detect available hardware at startup (Apple Silicon with unified memory, NVIDIA GPU with VRAM/compute cap, CPU-only) and pre-select the optimal backend
- [ ] Add a `doctor` check that validates the selected backend is installed and reachable
- [ ] Show platform-appropriate setup instructions in the Settings UI (not just startup command templates)
- [ ] Add a one-click "Start backend" button in Settings that runs the startup command in a managed subprocess

#### Phase B — Model artifact resolution per backend
- [ ] Resolve model artifacts per backend (e.g. MLX uses `mlx-community/Qwen3.5-4B-4bit`, vLLM uses `Qwen/Qwen3.5-4B`, llama.cpp uses a GGUF file path)
- [ ] Model plugin registry should map `hfRepo` -> backend-specific `runtimeModel` for each registered backend, not just the recommended one
- [ ] Add GGUF model registry entries for llama.cpp (Q4_K_M, Q5_K_M quantizations of Qwen 3.5 0.8B and 4B)

#### Phase C — Startup lifecycle management
- [x] Manage inference backend as a child process (start, health-check, restart, stop) similar to how the API server is managed by Electron
- [ ] Graceful shutdown of backend on app exit
- [x] Health check polling with automatic restart on backend crash (30s interval, 3-failure threshold, exponential backoff)
- [ ] Surface backend health status in the preflight gate and mission header

#### Phase D — Windows and Linux packaging
- [ ] Electron packaging for Linux (AppImage, deb)
- [ ] Electron packaging for Windows (NSIS installer)
- [ ] Platform-specific model download helpers (MLX weights for macOS, GGUF for Windows/Linux CPU, HF weights for CUDA)
- [ ] Docker Compose variant that bundles vLLM + PostgreSQL for headless Linux server deployment

#### Phase E — Inference backend benchmarking
- [ ] Implement the existing `BackendBenchmarkResult` and `InferenceAutotuneResult` types as a real benchmark runner
- [ ] Auto-select backend based on benchmark results (latency, throughput, error rate)
- [ ] Store benchmark results per hardware profile for consistent recommendations

#### Phase F — Real SSE streaming and JSON mode (done)
- [x] Replace simulated chunking in `BaseOpenAiLikeAdapter.stream()` with real SSE parsing
- [x] Parse `data:` lines, yield `token` events for `choices[0].delta.content`, handle `[DONE]` sentinel
- [x] Fall back to non-streaming `send()` if response.body is null
- [x] Add `jsonMode` flag in metadata; when true, include `response_format: { type: "json_object" }` in request body for backends that support it
- [x] Add `supportsJsonMode`, `supportsPrefixCaching`, `supportsConstrainedDecoding`, `constrainedDecodingMethod` fields to backend descriptors
- [x] Pass `jsonMode: true` for manifest generation steps in `executionService.ts`

#### Phase G — Cross-platform shell detection (done)
- [x] Replace hardcoded `/bin/zsh` with `detectShell()` in `executionService.ts` and `benchmarkService.ts`
- [x] `detectShell()` returns `cmd.exe` on Windows, `$SHELL` on Unix, falls back to `/bin/bash` then `/bin/sh`
- [ ] Path normalization for Windows backslash handling

#### Phase H — Speculative decoding and constrained generation (partially done)
- [x] Add speculative decoding configuration to backend descriptors (draft model, num tokens, flag)
- [x] `buildStartupCommand()` appends spec-decode flags when VRAM is sufficient
- [ ] Implement grammar-based constrained decoding for manifest generation via GBNF grammar (llama.cpp) or JSON schema (vLLM/SGLang)
- [ ] Measure impact of constrained decoding on manifest parse reliability vs. latency

### 10.4 How to run on each platform today

#### macOS Apple Silicon (default path)

```bash
pip install --upgrade mlx-lm
python3 -m mlx_lm.server --model mlx-community/Qwen3.5-4B-4bit --host 127.0.0.1 --port 8000
```

Set in `.env`:
```
ONPREM_QWEN_INFERENCE_BACKEND=mlx-lm
ONPREM_QWEN_BASE_URL=http://127.0.0.1:8000/v1
ONPREM_QWEN_MODEL=mlx-community/Qwen3.5-4B-4bit
```

#### Linux with NVIDIA GPU

```bash
pip install vllm
vllm serve Qwen/Qwen3.5-4B --host 127.0.0.1 --port 8000
```

Set in `.env`:
```
ONPREM_QWEN_INFERENCE_BACKEND=vllm-openai
ONPREM_QWEN_BASE_URL=http://127.0.0.1:8000/v1
ONPREM_QWEN_MODEL=Qwen/Qwen3.5-4B
```

#### Any platform with Ollama

```bash
# Install Ollama from https://ollama.com
ollama pull qwen3.5:4b
ollama serve
```

Set in `.env`:
```
ONPREM_QWEN_INFERENCE_BACKEND=ollama-openai
ONPREM_QWEN_BASE_URL=http://127.0.0.1:11434/v1
ONPREM_QWEN_MODEL=qwen3.5:4b
```

#### Any platform with llama.cpp

```bash
# Download GGUF weights
# Build or install llama-server
llama-server --model Qwen3.5-4B-Q4_K_M.gguf --host 127.0.0.1 --port 8080 --ctx-size 32768
```

Set in `.env`:
```
ONPREM_QWEN_INFERENCE_BACKEND=llama-cpp-openai
ONPREM_QWEN_BASE_URL=http://127.0.0.1:8080/v1
ONPREM_QWEN_MODEL=Qwen3.5-4B-Q4_K_M
```

### 10.5 Design principle

The app should **never hard-depend on one inference runtime**. The abstraction boundary is the OpenAI-compatible API. Any backend that exposes `/v1/chat/completions` with the same request/response contract works without application changes. Platform-specific logic belongs in the backend registry and startup lifecycle, not in the adapter or service layers.

---

## 11. Inference Performance Modernization

### 11.1 Real SSE Streaming
**Status:** Done

The local OpenAI-compatible adapters (`BaseOpenAiLikeAdapter.stream()`) now use real SSE streaming instead of simulated chunking:

- Request is sent with `stream: true`
- Real `data:` lines are parsed from the response body
- `token` events are yielded for each `choices[0].delta.content` chunk
- Usage is extracted from the final chunk with `usage` field
- `[DONE]` sentinel is handled properly
- Falls back to non-streaming `send()` if `response.body` is null (e.g. network issues)

### 11.2 JSON Mode / Structured Output
**Status:** Done (backend-dependent)

- `jsonMode` flag accepted in provider metadata
- When `jsonMode: true` and backend supports it, `response_format: { type: "json_object" }` is added to the request body
- Backend support matrix:
  - **Supports JSON mode:** vLLM, SGLang, TensorRT-LLM, llama.cpp, Ollama
  - **Does not support:** MLX-LM, Transformers
- `extractJsonObject()` remains as fallback for backends without JSON mode support
- Manifest generation in `executionService.ts` now passes `jsonMode: true`

### 11.3 KV Cache / Prefix Caching Strategy
**Status:** Partially done

Backend descriptors include `supportsPrefixCaching` metadata:
- **Automatic:** MLX-LM, SGLang (RadixAttention), TensorRT-LLM
- **Flag-based:** vLLM (`--enable-prefix-caching`), llama.cpp (`--cache-prompt`), Ollama (`--keep-alive`)
- **Unsupported:** Transformers

Implementation:
- [x] Startup command templates include caching flags
- [x] `cache_prompt: true` sent in request body for llama.cpp
- [x] System message prefix ordering stabilized for cache-friendly prompts
- [x] Cache hit rate monitoring (rolling average over last 100 requests)
- [ ] User-visible cache status in backend health

### 11.4 Speculative Decoding Configuration
**Status:** Done (configuration), Future (measurement)

Speculative decoding configuration added to backend descriptors:
- [x] `speculativeDecoding` field on `OnPremInferenceBackendDescriptor` with `supported`, `draftModelId`, `numSpeculativeTokens`, `flag`
- [x] vLLM and SGLang configured with `Qwen/Qwen3-0.6B` draft model, 5 speculative tokens
- [x] `buildStartupCommand()` helper appends spec-decode flags when VRAM sufficient
- [x] VRAM gating: draft model requires ~1GB additional VRAM
- [ ] Measure speedup vs. quality tradeoff for Qwen 0.6B as draft for Qwen 4B

### 11.5 Constrained Decoding / Grammar-Based Generation
**Status:** Partial (descriptors only)

Backend descriptors include `supportsConstrainedDecoding` and `constrainedDecodingMethod`:
- **JSON schema:** vLLM, SGLang, TensorRT-LLM
- **GBNF grammar:** llama.cpp
- **Unsupported:** MLX-LM, Transformers, Ollama

Future work:
- [ ] Generate GBNF grammar for `PatchManifest` schema for llama.cpp
- [ ] Use JSON schema constrained decoding with vLLM/SGLang for manifest generation
- [ ] Measure parse reliability improvement vs. latency cost

### 11.6 OpenAI API Status Clarification

- The **OpenAI Responses API** (`/v1/responses`) is already implemented in `openaiResponsesAdapter.ts`
- The **OpenAI Chat Completions API** (`/v1/chat/completions`) used for local backends is correct and NOT deprecated — OpenAI deprecated the old `/v1/completions` (non-chat), not `/v1/chat/completions`
- No migration is needed for either API path

---

## 12. Cross-Platform Runtime Fixes

### 12.1 Shell Detection
**Status:** Done

- `detectShell()` utility in `src/server/services/shellDetect.ts`
- Returns `cmd.exe` on Windows, `$SHELL` on Unix, falls back to `/bin/bash` then `/bin/sh`
- Used by `executionService.ts` and `benchmarkService.ts` (replaces hardcoded `/bin/zsh`)
- Result is cached after first call

### 12.2 Path Normalization for Windows
**Status:** Future

- [ ] Normalize backslash paths in worktree operations
- [ ] Ensure `ensureInsideRoot()` works with Windows path separators
- [ ] Test managed worktree creation on Windows

---

## 13. Agent Reliability

### 13.1 Doom-Loop Detection
**Status:** Done

`DoomLoopDetector` class in `src/server/services/doomLoopDetector.ts`:
- [x] MD5 fingerprinting of (actionName, sortedArgs) pairs
- [x] Sliding window (configurable size, default 20) with configurable threshold (default 3)
- [x] `isLooping()` detects when any fingerprint appears >= threshold times
- [x] `getLoopingAction()` reports which action is repeating
- [x] Integration point: `expandPatchManifest()` loop checks after each file generation step
- [x] On detection: strategy change (switch edit strategy), halt after 2 failed changes

### 13.2 System Reminders (Instruction Persistence)
**Status:** Done

`SystemReminderService` in `src/server/services/systemReminderService.ts`:
- [x] Interval-based reminders (every N messages, configurable, default 10)
- [x] Event-triggered reminders: after errors, after edits, before JSON generation
- [x] Blueprint-aware: pulls testing/docs/protection rules from blueprint policies
- [x] Uses `role: "user"` format with `[System Reminder]` prefix (resists fade-out better than system-role)
- [x] Short reminders (<200 tokens) to minimize context cost

### 13.3 Chain-of-Responsibility Edit Matching
**Status:** Done

`EditMatcherChain` in `src/server/services/editMatcherChain.ts`:
- [x] 8 progressively relaxed matchers for search-replace edits:
  1. Exact string match
  2. Whitespace-normalized match
  3. Leading-indent-flexible match
  4. Line-trimmed match
  5. Fuzzy line match (1 line tolerance)
  6. Line-number-anchored match
  7. Similarity-scored match (Levenshtein, threshold 0.85)
  8. Whole-block replacement fallback
- [x] Chain stops at first successful match (earlier = higher confidence)
- [x] Logs which matcher succeeded for observability
- [x] Integrates with `chooseEditStrategy()` for `search_replace` mode

---

## 14. Context Management

### 14.1 Adaptive Context Compaction (ACC)
**Status:** Done

`ContextCompactionService` in `src/server/services/contextCompactionService.ts`:
- [x] 5-stage compaction pipeline triggered at context pressure thresholds:
  - Stage 1 (70%): Summarize old tool results (keep last 3 verbatim)
  - Stage 2 (80%): Compress assistant reasoning to key decisions
  - Stage 3 (85%): Drop file contents captured in patches (remove code fences)
  - Stage 4 (90%): Merge consecutive same-role messages
  - Stage 5 (99%): Emergency keep-last-5
- [x] Token estimation via `Math.ceil(text.length / 4)`
- [x] Pinned messages survive all compaction stages
- [x] Integrated into `collectModelOutput()` pre-inference path

### 14.2 Tool Result Optimization
**Status:** Done

`ToolResultOptimizer` in `src/server/services/toolResultOptimizer.ts`:
- [x] Shell output: tail last 50 lines + error extraction (>100 lines)
- [x] File reads: first/last 20 lines with omission notice (>200 lines)
- [x] Search results: top 10 matches (>20 matches)
- [x] Build output: errors/warnings extraction (>50 lines)
- [x] Large output offloading to scratch files (>8000 chars threshold)

### 14.3 Dual-Memory Architecture
**Status:** Done

`MemoryService` in `src/server/services/memoryService.ts`:
- [x] **Episodic memory**: compressed task summaries (max 500 chars each)
  - Stored in `<projectRoot>/.agentic-workforce/memory/episodic.json`
  - Pruned by cosine similarity relevance to current task (top 10)
- [x] **Working memory**: sliding window of last N messages (default 15)
- [x] Thinking phase composition: system prompt -> episodic memories -> working memory -> current task
- [x] Token-aware composition with stats

### 14.4 Prompt Cache Topology & Metrics
**Status:** Done (metrics tracking), Partial (topology optimization)

- [x] Cache hit extraction from inference response headers (`x-cache-hit`, `tokens_cached`)
- [x] Rolling cache hit rate tracking (last 100 requests)
- [x] Metrics exposed via `getCacheMetrics()` on `InferenceTuningService`
- [ ] Full message ordering optimization for cache-friendly topology

---

## 15. Hardware-Aware Inference

### 15.1 VRAM Detection & Hardware Profiling
**Status:** Done

Extended `getHardwareProfile()` in `inferenceTuningService.ts`:
- [x] Returns structured `HardwareProfile` with platform, VRAM, compute capability, unified memory
- [x] NVIDIA detection: parses `nvidia-smi --query-gpu=memory.total,compute_cap --format=csv,noheader,nounits`
- [x] Apple Silicon detection: parses `sysctl -n hw.memsize` for unified memory
- [x] Result cached (hardware doesn't change at runtime)
- [x] `canLoadModel(minVramGb)` gates model loading decisions

### 15.2 Backend Health Monitoring & Auto-Restart
**Status:** Done

Health monitoring in `InferenceTuningService`:
- [x] Periodic health check (30s interval) via `GET /health` or `GET /v1/models`
- [x] Track consecutive failures (threshold: 3)
- [x] Auto-restart on failure with exponential backoff (5s, 15s, 45s)
- [x] Max 3 restart attempts before giving up
- [x] Health events emitted to mission control snapshot
- [x] `BackendHealthStatus` type: `healthy | degraded | down` with lastCheck and restartCount

### 15.3 Speculative Decoding
**Status:** Done (configuration)

See Section 11.4 above.

---

## 16. Code Intelligence

### 16.1 Tree-sitter Integration
**Status:** Done (optional)

`treeSitterAnalyzer.ts` in `src/server/services/`:
- [x] Optional tree-sitter integration for AST-accurate symbol/import extraction
- [x] Supports TypeScript, JavaScript, Python grammars
- [x] Dynamic import with graceful fallback to regex when tree-sitter not installed
- [x] `extractSymbolsTreeSitter()` / `extractImportsTreeSitter()` used by `codeGraphService.ts`
- [x] Handles nested functions, decorators, multi-line signatures, template literals
- [ ] Install tree-sitter packages: `npm install tree-sitter tree-sitter-typescript tree-sitter-javascript tree-sitter-python`

### 16.2 FIM (Fill-in-the-Middle) for Code Edits
**Status:** Done (configuration)

- [x] `supportsFim` flag on backend descriptors
- [x] Qwen FIM token format: `<|fim_prefix|>...<|fim_suffix|>...<|fim_middle|>`
- [x] `buildFimPrompt()` helper constructs FIM prompt for supported backends
- [x] FIM supported by: MLX-LM, vLLM, SGLang, llama.cpp
- [ ] `fim_insert` edit strategy in `chooseEditStrategy()` for insertion-type edits

### 16.3 Shadow Git Snapshots (Per-Step Undo)
**Status:** Done

`ShadowGitService` in `src/server/services/shadowGitService.ts`:
- [x] Creates bare git repo at `<projectRoot>/.agentic-workforce/snapshots/`
- [x] Snapshots before each file write with `step-<id>: <description>` commits
- [x] Rollback via `git show <commitHash>:<filePath>`
- [x] Auto-pruning: keeps last 50 snapshots (configurable)
- [x] `listSnapshots()`, `getSnapshot()`, `rollback()` API

---

## 17. Source Reference Set
- [Anthropic: Building effective agents](https://www.anthropic.com/research/building-effective-agents/)
- [Anthropic prompt engineering overview](https://docs.anthropic.com/en/docs/prompt-engineering)
- [Anthropic tool use overview](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview)
- [Anthropic tool use implementation guide](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use)
- [Anthropic extended thinking](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking)
- [Anthropic prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
- [SWE-agent](https://github.com/SWE-agent/SWE-agent)
- [Aider unified diffs](https://aider.chat/docs/unified-diffs.html)

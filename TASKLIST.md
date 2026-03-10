# Implementation Tasklist — Next-Gen Local Coding Agent

Derived from `long_term_upgrades.md` unchecked items and current codebase gaps.

---

## Phase 1: Unit Tests (Section 7.1 gaps)

These are all explicitly listed as unchecked in the roadmap.

- [x] **1.1** Codebase file-content endpoint tests (`codebaseHelpers.test.ts`)
  - reads text and code files (detectLanguageFromPath)
  - rejects paths outside managed worktree (ensureInsideRoot)
  - truncates large files correctly (truncateFileContent)
  - binary detection (isBinaryBuffer)
  - tree building (buildTree)
- [x] **1.2** Console event mapping tests (`patchHelpers.test.ts`)
  - only real categories (mapConsoleCategory)
  - no synthetic entries (mapConsoleLevel)
- [x] **1.3** PatchManifest parsing tests (`patchHelpers.test.ts`)
  - strict schema validation
  - no commentary leakage
  - strategy mapping
  - empty path filtering
- [x] **1.4** ProjectBlueprint extraction tests (`blueprintHelpers.test.ts`)
  - AGENTS.md / README.md source candidates
  - inferProductIntent from text
  - inferSuccessCriteria with guidelines
  - inferConstraints from text
  - classifyConfidence scoring
- [x] **1.5** Deterministic repair helper tests (`patchHelpers.test.ts`)
  - unused import removal (removeUnusedImportSymbol)
  - unresolved relative import detection (findMissingImportTargets)
  - path-mismatch repair (repairImportPathAfterMove) — NEW
  - stale assertion repair (repairStaleAssertion) — NEW
- [x] **1.6** Provider routing tests (`providerOrchestrator.test.ts`)
  - Fast → 0.8B
  - Build → 4B
  - Review → 4B reasoning
  - Escalate → OpenAI
- [x] **1.7** VerificationPolicy tests (`verificationPolicy.test.ts`)
  - buildVerificationPlan with blueprint
  - buildVerificationPlan without blueprint
  - docs enforcement
  - enforced rules
  - deduplication

## Phase 2: Deterministic Repair Expansion (Section 4.3 gaps)

- [x] **2.1** Add path-mismatch repair after generated file moves (`repairImportPathAfterMove`)
- [x] **2.2** Add stale generated assertion repair when mismatch is direct and local (`repairStaleAssertion`)

## Phase 3: Mission-Control BFF Completion (Section 5.1 gaps)

- [x] **3.1** `POST /api/v8/mission/actions/stop` endpoint — wired to `v2CommandService.stopExecution`
- [x] **3.2** `POST /api/v8/mission/actions/task.requeue` endpoint — wired to `v2CommandService.requeueTask`
- [x] **3.3** `POST /api/v8/mission/actions/task.transition` endpoint — wired to existing `v2CommandService.transitionTask`

## Phase 4: Context Pack Completeness (Section 4.5 gaps)

- [x] **4.1** Add why-chosen explanations to every context pack item
- [x] **4.2** Include relevant prior runs in context pack
- [x] **4.3** Ensure Fast model owns context shaping flow

## Phase 5: Expanded Acceptance Testing

Beyond the existing StatusBadge scenario, add more diverse follow-up feature scenarios.

- [x] **5.1** New acceptance scenario: "Add a ProgressBar component with tests and docs"
  - Deterministic template added + `npm run test:e2e:followup:progress-bar`
- [x] **5.2** New acceptance scenario: "Add a utility function module with tests"
  - Deterministic template added + `npm run test:e2e:followup:utility-module`
- [x] **5.3** New acceptance scenario: "Rename an existing component and update all references"
  - Renames StatusBadge → StatusIndicator + `npm run test:e2e:followup:rename-component`
  - Validates: old file gone, new file present, no stale references, lint/test/build pass
- [x] **5.4** Acceptance test for blueprint validation (console events, blueprint policy checks in harness)
- [x] **5.5** Acceptance test for stop action during execution (`npm run test:e2e:followup:api-stop`)
- [x] **5.6** Generalized acceptance harness (`scripts/playwright/run_followup_scenario.mjs`)
  - Parameterized by scenario name
  - Validates: scaffold, follow-up, codebase tree, console events, blueprint, lint/test/build

## Phase 6: Escalation Policy Enforcement (Section 4.1 gap)

- [x] **6.1** Escalate must only be used if policy allows and failure/ambiguity justifies it

## Phase 7: Blueprint UI Gaps (Section 4.4 gaps)

- [x] **7.1** Show compact blueprint summary during onboarding
- [x] **7.2** Allow lightweight override without a long setup wizard

---

## Implementation Order

1. ~~Phase 1 (unit tests) — foundational, validates existing code~~ DONE (135 tests, 60 new)
2. ~~Phase 2 (repair expansion) — improves local 4B reliability~~ DONE
3. ~~Phase 3 (BFF completion) — wires dead controls~~ DONE
4. ~~Phase 5 (acceptance testing) — proves generalized follow-up works~~ DONE (5 scenarios)
5. ~~Phase 4 (context pack completeness) — why-chosen, prior runs, Fast-model shaping~~ DONE
6. ~~Phase 6 (escalation policy enforcement)~~ DONE
7. ~~Phase 7 (blueprint UI gaps) — onboarding summary, compact override~~ DONE

## Phase 8: Remaining Roadmap Items

- [x] **8.1** Full-file rewrite fallback control — guard `chooseEditStrategy` against model-requested `full_file` on large files
- [x] **8.2** Blueprint-driven benchmark scoring — `policyCompliance` now checks blueprint testing/docs/execution policies
- [x] **8.3** BFF cleanup — console events included in snapshot, ConsoleView uses snapshot data, parallel fetch in endpoints
- [x] **8.4** Non-mutating parallel helpers — `Promise.all` for ticket/blueprint/guidelines/knowledge in route.review and execute
- [x] **8.5** Parallel context pack + routing decision in `planExecution` when decision ID exists
- [x] **8.6** Roadmap checkpoint sync — updated `long_term_upgrades.md` checkboxes for all completed items

## Test Summary

| Suite | Tests | Status |
|-------|-------|--------|
| verificationPolicy.test.ts | 10 | PASS |
| patchHelpers.test.ts | 41 | PASS |
| blueprintHelpers.test.ts | 26 | PASS |
| codebaseHelpers.test.ts | 27 | PASS |
| providerOrchestrator.test.ts | 15 | PASS |
| factory.test.ts | 2 | PASS |
| inferenceBackends.test.ts | 3 | PASS |
| modelPlugins.test.ts | 2 | PASS |
| qwenCliAdapter.test.ts | 3 | PASS |
| benchmarkManifests.test.ts | 2 | PASS |
| inferenceScoring.test.ts | 2 | PASS |
| privacyScanner.test.ts | 2 | PASS |
| quotaEstimator.test.ts | 2 | PASS |
| teacherRateLimiter.test.ts | 3 | PASS |
| trainerAdapters.test.ts | 1 | PASS |
| **Total** | **141** | **ALL PASS** |

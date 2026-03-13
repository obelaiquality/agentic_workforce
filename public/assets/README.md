# Asset Guide

This folder holds animated SVGs for the mounted app in `/src/app`.

All files here can be referenced from the UI as `/assets/<name>.svg`.

## Primary Placements

| App surface | Primary asset | Alternate assets |
| --- | --- | --- |
| Global shell brand in `App.tsx` | `agentic-workforce-shell.svg` | `quantum-nexus.svg` |
| Profile orb / identity badge in `App.tsx` | `agentic-workforce-profile.svg` | `live-orbit.svg` |
| Mission status emblem in `MissionHeaderStrip.tsx` | `live-orbit.svg` | `quantum-nexus.svg`, `verification-shield.svg` |
| Run phases, event nodes, stream execution in `RunTimelineRail.tsx` | `quantum-rail.svg` | `execution-node.svg`, `helix-progress.svg` |
| Stream metrics, lane progress, risk badges in `StreamProgressBoard.tsx` | `helix-progress.svg` | `quantum-rail.svg`, `execution-node.svg` |
| Agents overview in `AgentsView.tsx` | `worker-cluster.svg` | `neural-matrix.svg` |
| Overseer context packs, message badges, data bundles in `OverseerDrawer.tsx` | `hypercube.svg` | `artifact-vault.svg`, `neural-matrix.svg` |
| Synthesizer and routing logic panels | `neural-matrix.svg` | `provider-switchboard.svg` |
| Preflight gate, approvals, safe-pass states in `PreflightGate.tsx` | `verification-shield.svg` | `aegis-eye.svg`, `cryptographic-seal.svg` |
| Successful verification, outcome complete states in `OutcomeDebriefDrawer.tsx` | `cryptographic-seal.svg` | `verification-shield.svg` |
| Artifacts, outputs, bundles in `ArtifactsView.tsx` | `artifact-vault.svg` | `mutation-forge.svg`, `hypercube.svg` |
| Benchmarks, heavy compute, performance runs in `BenchmarksView.tsx` | `benchmark-reactor.svg` | `telemetry-wave.svg`, `quantum-rail.svg` |
| Console metrics and telemetry visuals in `ConsoleView.tsx` and `TelemetryView.tsx` | `telemetry-wave.svg` | `benchmark-reactor.svg` |
| Codebase browser, file system, repo contents in `CodebaseView.tsx` | `focus-reticle.svg` | `hypercube.svg`, `mutation-forge.svg` |
| Change briefs, patch previews, active rewrite states in `ChangeBriefStrip.tsx` | `mutation-forge.svg` | `focus-reticle.svg` |
| Active execution spotlight in `ActiveExecutionPanel.tsx` | `focus-reticle.svg` | `quantum-rail.svg` |
| Project blueprint, architecture summary, repo structure in `ProjectBlueprintPanel.tsx` | `structural-blueprint.svg` | `repo-gateway.svg` |
| Project connect/import/onboarding in `ProjectsWorkspaceView.tsx` | `repo-gateway.svg` | `structural-blueprint.svg`, `focus-reticle.svg` |
| Settings, provider routing, backend/runtime states in `SettingsControlView.tsx` | `provider-switchboard.svg` | `neural-matrix.svg` |
| Backlog, boards, task progression | `autonomous-kanban.svg` | `focus-reticle.svg` |

## Asset Notes

- `agentic-workforce-profile.svg`: profile orb, identity badge, personal/session marker.
- `agentic-workforce-shell.svg`: primary shell brand, launcher identity, favicon.
- `aegis-eye.svg`: alert-heavy security, stricter approval warnings, scan-first states.
- `artifact-vault.svg`: secure outputs, artifacts, bundles, context packages.
- `autonomous-kanban.svg`: task lanes, backlog movement, board summaries.
- `benchmark-reactor.svg`: benchmark runs, compute load, performance tasks.
- `cryptographic-seal.svg`: verification success, completed checks, trusted pass state.
- `execution-node.svg`: small inline timeline nodes or compact progress chips.
- `focus-reticle.svg`: active task targeting, spotlight markers, selected execution state.
- `helix-progress.svg`: circular progress, dual-stream completion, execution progress.
- `hypercube.svg`: context pack, synthesized bundle, overseer data package.
- `live-orbit.svg`: small status mark, shell pulse, mission live indicator.
- `mutation-forge.svg`: diffs, rewrites, patch generation, active edit state.
- `neural-matrix.svg`: synthesizer, worker network, coordination/routing.
- `provider-switchboard.svg`: settings, provider selection, routing, backend control plane.
- `quantum-nexus.svg`: hero orb, shell identity, high-energy live core.
- `quantum-rail.svg`: main timeline rail, lane flow, execution motion.
- `repo-gateway.svg`: connect repo, import codebase, project onboarding.
- `structural-blueprint.svg`: architecture, repo structure, blueprint panels.
- `telemetry-wave.svg`: console activity, telemetry summary, chart-adjacent accent.
- `verification-shield.svg`: neutral trust, approvals, preflight pass, gating.
- `worker-cluster.svg`: literal agents/workers, tokens, active robot squad.

## Recommended Defaults

- Use `agentic-workforce-shell.svg` as the shell default.
- Use `worker-cluster.svg` as the agents default.
- Use `verification-shield.svg` as the preflight default.
- Use `artifact-vault.svg` as the artifacts default.
- Use `benchmark-reactor.svg` as the benchmarks default.
- Use `provider-switchboard.svg` as the settings default.
- Use `repo-gateway.svg` as the projects default.

## Keep In Reserve

- `aegis-eye.svg` for threat, warning, or scanner-heavy moments.
- `execution-node.svg` for smaller inline badges where `quantum-rail.svg` is too busy.
- `live-orbit.svg` where `quantum-nexus.svg` is visually too heavy.

# Changelog

All notable user-facing changes to this project should be documented in this file.

The format follows a simple release structure:

- `Added` for new user-visible functionality
- `Changed` for behavior or workflow changes
- `Fixed` for bug fixes
- `Security` for security-relevant updates

## [Unreleased]

## [1.3.0] - 2026-04-01

### Added
- Snip compact: zero-cost time-based message pruning at 50% context pressure, applied before expensive compaction stages.
- File staleness detection: read-time tracking in FileStateCache with content-hash fallback for cloud sync false positives.
- Prompt cache break detection: EMA-based baseline tracking with cause diagnosis (system prompt changed, tool schema changed, compaction occurred).
- Hierarchical abort controllers: WeakRef-based parent-child abort cascade with isolated child abort and clean GC.
- Quote preservation in edits: curly/smart quote style detection and preservation when edits match via quote normalization.
- Micro-compact cache topology awareness: skip cached-region messages during tool result optimization to preserve API cache prefix.
- Comprehensive Electron E2E UI test suite: 6 Playwright scripts (navigation smoke, settings deep, projects deep, work deep, codebase deep, console deep) with 47 assertions across all 5 sidebar views.
- data-testid instrumentation across all view components (App, Settings, Console, Codebase, Projects, Work) for stable E2E selectors.
- Panel component now forwards data-testid prop.
- 60 new unit tests (918 total across 57 files).

### Fixed
- Missing Terminal icon import in ConsoleView that caused React crash on navigation.

## [1.0.0] - 2026-03-29

### Added
- Public OSS launch scaffolding: license, contribution docs, security policy, support policy, issue templates, PR template, and CI validation workflow.
- A lightweight CLI companion for connecting a repo, planning/running an objective, streaming console progress, and reading the latest report.
- Public install and onboarding docs for binary, source + OpenAI, and advanced local runtime paths.
- New public guidance docs for configuration, FAQ, known limitations, testing tiers, demo media, maintainers, roadmap, and release checklist.
- Stable desktop, nightly, CLI smoke, demo capture/render, and packaged desktop smoke command surfaces for more explicit end-to-end validation.
- README demo media pipeline and in-repo README GIF asset generation.
- Signed desktop release hardening: generated app icons, release checksums, release notes template, and stricter desktop release workflow gates.
- A mode-aware `npm run doctor` with focused core desktop checks plus dedicated local-runtime and distillation modes.
- Generated release-note publishing and a checked-in production CycloneDX SBOM for tagged releases.

### Changed
- Top-level branding, package metadata, and public docs now consistently use `Agentic Workforce`.
- The main README is now a landing page for installation and first success rather than a full internal operator manual.
- Settings and task-surface docs now present `Projects`, `Work`, `Codebase`, `Console`, and `Settings` as the primary product surfaces.
- Distillation and benchmark infrastructure are now treated as specialized tooling rather than part of the first-run product story.
- CI and release workflows now distinguish validation, stable desktop acceptance, nightly/manual coverage, and packaged smoke responsibilities more explicitly.
- GitHub Releases are now the canonical desktop artifact source, and repo-root npm publication is intentionally blocked.
- Mainline CI now treats stable desktop E2E as a required check for pushes and same-repo pull requests, while fork PRs keep the normal secretless skip path.
- Release notes, support claims, and packaged proof language now distinguish Linux packaged smoke from the lighter macOS and Windows launch-plus-preflight proof.

### Fixed
- Removed hardcoded personal-path references from launch-facing docs.
- Corrected stale public wording and attribution text left over from earlier internal prototypes.
- Cleared production `npm audit --omit=dev` findings by upgrading Prisma, Fastify, and YAML to release-safe versions.

### Security
- Tagged release validation now requires a clean production audit, generated release notes, and an in-sync production SBOM before artifacts are published.

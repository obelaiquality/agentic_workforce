# Changelog

All notable user-facing changes to this project should be documented in this file.

The format follows a simple release structure:

- `Added` for new user-visible functionality
- `Changed` for behavior or workflow changes
- `Fixed` for bug fixes
- `Security` for security-relevant updates

## [Unreleased]

### Added
- Public OSS launch scaffolding: license, contribution docs, security policy, support policy, issue templates, PR template, and CI validation workflow.
- A lightweight CLI companion for connecting a repo, planning/running an objective, streaming console progress, and reading the latest report.
- Public install and onboarding docs for binary, source + OpenAI, and advanced local runtime paths.
- New public guidance docs for configuration, FAQ, known limitations, testing tiers, demo media, maintainers, roadmap, and release checklist.
- Stable desktop, nightly, CLI smoke, demo capture/render, and packaged desktop smoke command surfaces for more explicit end-to-end validation.
- README demo media pipeline and in-repo README GIF asset generation.
- Signed desktop release hardening: generated app icons, release checksums, release notes template, and stricter desktop release workflow gates.
- A mode-aware `npm run doctor` with focused core desktop checks plus dedicated local-runtime and distillation modes.

### Changed
- Top-level branding, package metadata, and public docs now consistently use `Agentic Workforce`.
- The main README is now a landing page for installation and first success rather than a full internal operator manual.
- Settings and task-surface docs now present `Projects`, `Work`, `Codebase`, `Console`, and `Settings` as the primary product surfaces.
- Distillation and benchmark infrastructure are now treated as specialized tooling rather than part of the first-run product story.
- CI and release workflows now distinguish validation, stable desktop acceptance, nightly/manual coverage, and packaged smoke responsibilities more explicitly.
- GitHub Releases are now the canonical desktop artifact source, and repo-root npm publication is intentionally blocked.

### Fixed
- Removed hardcoded personal-path references from launch-facing docs.
- Corrected stale public wording and attribution text left over from earlier internal prototypes.

# Changelog

All notable user-facing changes to this project should be documented in this file.

The format follows a simple beta-first structure:

- `Added` for new user-visible functionality
- `Changed` for behavior or workflow changes
- `Fixed` for bug fixes
- `Security` for security-relevant updates

## [Unreleased]

### Added
- Public OSS launch scaffolding: license, contribution docs, security policy, support policy, issue templates, PR template, and CI validation workflow.
- A lightweight CLI companion for connecting a repo, planning/running an objective, streaming console progress, and reading the latest report.
- Public install and onboarding docs for binary, source + OpenAI, and advanced local runtime paths.

### Changed
- Top-level branding, package metadata, and public docs now consistently use `Agentic Workforce`.
- The main README is now a landing page for installation and first success rather than a full internal operator manual.
- Settings and task-surface docs now present `Projects`, `Work`, `Codebase`, `Console`, and `Settings` as the primary product surfaces.
- Distillation and benchmark infrastructure are now treated as advanced/internal tooling rather than part of the first-run product story.

### Fixed
- Removed hardcoded personal-path references from launch-facing docs.
- Corrected stale public wording and attribution text left over from earlier internal prototypes.

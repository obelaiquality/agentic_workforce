# Release Notes Guide

Tagged releases publish generated notes from this file plus the matching `CHANGELOG.md` version section.

Validate the source content before tagging with:

```bash
npm run release:notes -- --check
```

## Prerequisites

- Binary installs require the signed GitHub Release artifacts for the target platform.
- Source installs require Node 20+, npm, and PostgreSQL 16+ reachable through `DATABASE_URL`.
- The default first-success runtime path requires `OPENAI_API_KEY`; fully local runtime setups need an OpenAI-compatible endpoint and extra runbook setup.
- Docker is recommended for the default Postgres path, but any compatible local Postgres instance is acceptable.

## Platform Support

- macOS: release CI verifies signing, notarization, launch, and desktop preflight state. Full packaged task-flow signoff remains part of manual release-candidate validation.
- Windows: release CI verifies Authenticode signatures, launch, and desktop preflight state. Full packaged task-flow signoff remains part of manual release-candidate validation.
- Linux: release CI runs packaged create/connect/work smoke plus package metadata review before publication.

## Runtime Support

- OpenAI-backed path: primary supported first-success path and the only runtime exercised by stable desktop E2E in CI.
- Local-runtime path: supported specialized workflow with dedicated runbooks and manual release-candidate signoff.
- Browser preview: supported for inspection and light configuration work, not as a replacement for the desktop operator flow.
- CLI companion: release-gated by `npm run test:e2e:cli-smoke`.

## Known Issues

- Browser preview still lacks parity for native repo picking and full local execution ergonomics.
- macOS and Windows release automation currently proves signed launch plus preflight state, not the full packaged create/connect task flow.
- Benchmarks, Labs, distillation, and channel workflows remain in scope, but they require more operator setup and narrower validation than the desktop core path.

## Checksums And Verification

- Attach `SHA256SUMS.txt` to the release bundle and verify downloaded artifacts against it.
- Attach `docs/sbom.production.cdx.json` to the release bundle as the production dependency inventory.
- Call out platform-specific trust prompts or installation caveats, especially for first launch on macOS and Windows.

## Upgrade Notes

- Breaking changes: GitHub Releases are the canonical packaged app channel; the repo root remains blocked from npm publication.
- Config changes: none beyond the documented runtime/provider prerequisites for the chosen path.
- Migration or cleanup steps: contributors touching shipped dependencies or release policy must refresh the changelog, release notes, and production SBOM together.

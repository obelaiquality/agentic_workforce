# Known Limitations

This repo is usable today, but it is still a beta product. These limits are intentional and should be clear to users up front.

## Desktop vs Browser Preview

- Desktop is the primary supported operator path.
- Browser preview is limited and should not be treated as parity with Electron.
- Browser preview cannot replace native repo picking and full local execution ergonomics.

## Runtime Setup

- The fastest path today still assumes local Postgres plus either OpenAI or a working local OpenAI-compatible runtime.
- Fully local runtime setup is supported, but it is still a more advanced operator path than the OpenAI-backed source flow.
- Some failover and teacher/distillation paths depend on external CLIs or extra local services.

## Experimental Surfaces

- Labs, distillation, benchmarks, and experimental channels are not part of the default onboarding story.
- Channels and autonomy surfaces are intentionally separated from the stable first-run product path.
- Some experimental paths still rely on more infrastructure than the main desktop product flow.

## Packaging And Releases

- Packaged binaries are beta quality.
- Release packaging exists, but cross-platform parity is still evolving.
- Larger demo video assets are not committed to git history and should be attached to releases or external docs instead.

## CI And E2E

- Stable desktop E2E can gate CI when a provider credential is available.
- Advanced/nightly coverage is intentionally broader and more volatile than the PR gate.
- Some heavy failover paths are designed for manual or scheduled runs, not every single PR.

## Open Source Expectations

- The repo is public and installable, but some features are still intentionally flagged as advanced or internal.
- Contributors should use the documented paths in [docs/testing.md](testing.md) and [CONTRIBUTING.md](../CONTRIBUTING.md) rather than guessing which scripts are required.

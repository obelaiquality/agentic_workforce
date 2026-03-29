# Support Matrix

This matrix describes the current support expectation for each public surface in the repository and release bundle.

| Surface | Status | Primary audience | Validation path |
| --- | --- | --- | --- |
| Desktop app (`Projects`, `Work`, `Codebase`, `Console`, `Settings`) | Primary supported surface | All operators | `npm run validate`, `npm run test:e2e:desktop-stable`, Linux packaged smoke, macOS/Windows launch plus preflight proof, manual RC signoff |
| GitHub Release desktop binaries | Primary supported distribution | Operators who want packaged installs | Signed release workflow, checksums, production SBOM, Linux packaged smoke, macOS/Windows signed launch plus manual RC task-flow signoff |
| Source + OpenAI | Primary supported setup path | Contributors and source users | [docs/install.md](install.md), [docs/onboarding.md](onboarding.md), `npm run validate` |
| Browser preview | Supported secondary surface | Inspection, light settings work, UI development | Manual validation plus targeted E2E where available |
| CLI companion | Supported secondary surface | Terminal-oriented operators | `npm run test:e2e:cli-smoke` |
| Source + local runtime | Supported specialized workflow | Operators who want local inference | [docs/runbooks/local-runtime.md](runbooks/local-runtime.md), `npm run doctor -- --mode local-runtime` |
| Benchmarks | Supported specialized workflow | Evaluation and comparison work | [docs/runbooks/benchmarks.md](runbooks/benchmarks.md), manual release-candidate verification |
| Labs and channels | Supported specialized workflow | Operators integrating advanced automation surfaces | Manual release-candidate verification plus surface-specific checks |
| Distillation tooling | Supported specialized workflow | Maintainers and training operators | `npm run doctor -- --mode distillation`, manual release-candidate verification |

## Notes

- GitHub Releases are the canonical artifact source for packaged desktop installs.
- The repo root intentionally blocks npm publication. If a dedicated npm package is needed, it should ship from a separate package directory with its own contract.
- Linux is the only platform with full automated packaged create/connect smoke in release CI today. macOS and Windows keep signature plus launch/preflight proof in automation and require manual release-candidate task-flow signoff.
- Specialized workflows are supported, but they require more setup and narrower validation than the default desktop path. Use the linked runbooks before treating first-run docs as incomplete.

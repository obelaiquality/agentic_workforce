# Roadmap

## Now

- Sustain the desktop-first first-run path with signed releases and repeatable validation
- Keep stable desktop E2E, packaged launch proof, and demo-media freshness aligned with shipped artifacts
- Keep install, configuration, support, and troubleshooting docs consistent with the 1.0 release contract

## Next

- **Cross-platform verification** — Confirm the full E2E suite on Windows 10/11, macOS Intel, and non-Ubuntu Linux distributions. Community testing reports are the fastest path here.
- **Ollama-first local setup** — Make Ollama the default local runtime for non-macOS platforms with zero-config model pull
- Reduce setup friction for local-runtime users across all platforms
- Harden specialized channels and autonomy surfaces behind clearer trust boundaries
- Expand automated proof for specialized workflows that currently rely on manual release-candidate validation

## Later

- **Windows and Linux CI E2E** — Add Windows and Linux runners to the nightly E2E workflow once community testing confirms baseline stability
- Broader contributor ergonomics for local-runtime and CI coverage
- Deeper automation around demo capture, release proof, and nightly scenario reporting
- Multi-agent parallel execution for non-conflicting file edits
- Constrained decoding for structured output from local models

## Help Wanted

These items are specifically waiting on community contributions:

- Windows E2E test results (`npm run validate` + `npm run test:e2e:desktop-stable`)
- macOS Intel E2E test results
- Ollama backend testing on Linux and Windows
- vLLM/SGLang testing on NVIDIA GPUs (consumer and datacenter)
- Fedora/Arch/other Linux packaging feedback

See [CONTRIBUTING.md](CONTRIBUTING.md) for the platform testing report template.

This roadmap is directional and does not replace the published release notes or support matrix.

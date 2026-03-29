# Security Policy

## Supported Scope

This repo ships as a public desktop application. Security fixes are prioritized for:

- local API auth and transport
- Electron renderer and preload boundaries
- command execution policy and approval flows
- secret handling for provider keys and channel credentials

## Electron Sandbox Configuration

The desktop app sets `sandbox: false` in the BrowserWindow `webPreferences` because the preload script requires Node.js APIs for the IPC bridge (`desktop:api-request`, `desktop:open-stream`, `desktop:close-stream`). This is a conscious tradeoff, not an oversight.

Mitigations in place:

- `contextIsolation: true` — the renderer world cannot access preload globals directly.
- `nodeIntegration: false` — the renderer process cannot require Node.js modules.
- Content Security Policy — enforced via session headers; blocks inline scripts from external origins, sets `object-src 'none'`, and restricts `frame-ancestors`.
- Navigation hardening — `will-navigate` and `new-window` events are intercepted to prevent the renderer from navigating to untrusted origins.

The net effect is that the renderer behaves like a standard web page with no Node.js access. The preload script is the only bridge, and it exposes a narrow, typed API surface.

## Reporting A Vulnerability

Please do not open public issues for suspected vulnerabilities.

Send a private report with:

- affected commit or release tag
- reproduction steps
- expected impact
- whether the issue requires local access, renderer injection, or remote trigger

Current contact: `security@neilslab.com`

If that address changes, maintainers should update this file before the next release.

## Response Goals

- Initial acknowledgement: within 5 business days
- Triage: as soon as a maintainer can reproduce or bound impact
- Public disclosure: after a fix is available or a mitigation is documented

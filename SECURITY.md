# Security Policy

## Supported Scope

This repo is currently a public beta codebase. Security fixes are prioritized for:

- local API auth and transport
- Electron renderer and preload boundaries
- command execution policy and approval flows
- secret handling for provider keys and channel credentials

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

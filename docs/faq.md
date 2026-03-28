# FAQ

## Why is the desktop app the recommended path?

The desktop app is the only surface with full local file-picker support, the strongest local workflow parity, and the cleanest secret-handling path. Browser preview is useful, but it is intentionally secondary.

## Can I use browser preview instead of Electron?

For light inspection, yes. For normal operator use, no. Browser preview cannot replace the desktop app for native repo picking or full local operator flow.

## Which runtime should I use first?

If your goal is first success, use `OPENAI_API_KEY` and the desktop path. If your goal is local inference, follow [docs/runbooks/local-runtime.md](runbooks/local-runtime.md) instead of trying to force the first-run flow into a local-runtime tutorial.

## Do I need Docker?

Docker is strongly recommended because the default Postgres bootstrap path assumes it. Advanced users can provide a compatible local Postgres instance instead.

## Where do I put provider keys?

Use `Settings > Essentials`. Provider keys are treated as write-only values in the UI and stored outside normal settings JSON.

## Why does standalone browser preview need both `API_TOKEN` and `VITE_API_TOKEN`?

Because local API auth is header-only. The standalone API requires a non-empty `API_TOKEN`, and the browser renderer must send the same value via `VITE_API_TOKEN`.

## What should I try as my first task?

Use a bounded request with a clear verification target, for example:

- `Add a status badge component with tests`
- `Rename the hero headline and update the test`
- `Document the local runtime setup in the README`

## Is the CLI companion a replacement for the desktop app?

No. The CLI is a useful companion to the same local API, but the desktop app remains the primary supported operator surface.

## How should I treat Labs, channels, benchmarks, and distillation?

They are supported specialized workflows with dedicated runbooks and a higher setup burden than the default desktop path. Use the support matrix and release notes to understand current coverage before relying on them in production.

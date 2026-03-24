# Demo Guide

This repo keeps one small README GIF in git and treats longer walkthrough video as a generated release/docs artifact.

## Demo Assets

- README GIF: [`docs/media/agentic-workforce-demo.gif`](media/agentic-workforce-demo.gif)
- Source screenshots: [`docs/screenshots/`](screenshots)
- Generated long-form video: keep it under `output/playwright/` locally, then attach it to a release or external docs page

## Capture The Demo

Use the stable desktop acceptance harness as the source of truth:

```bash
npm run demo:capture
npm run demo:render
```

What this does:

1. Runs the desktop acceptance flow against a deterministic project path.
2. Stores capture output under `output/playwright/desktop-acceptance-*`.
3. Renders a README-sized GIF into `docs/media/`.
4. Writes a larger MP4 into `output/playwright/demo-render-*`.

Requirements:

- `ffmpeg`
- all prerequisites for the stable desktop E2E path
- either `OPENAI_API_KEY` with `E2E_RUNTIME_PRESET=openai_all`, or a healthy local runtime for the chosen preset

## Demo Transcript

The recommended short walkthrough sequence is:

1. Open the desktop app.
2. Go to `Projects`.
3. Create or connect a project.
4. Return to `Work`.
5. Review and run one bounded task.
6. Open `Codebase` to show a changed file.
7. Open `Console` to show real verification or execution events.

## Media Policy

- Keep the README GIF short, lightweight, and loopable.
- Do not commit large MP4/WebM artifacts to git history.
- Refresh the GIF and screenshots when the first-run UX or layout changes materially.
- Regenerate media from scripted flows, not one-off manual captures.

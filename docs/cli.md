# CLI Companion

The CLI is a terminal companion to the same local API used by the desktop app.

It is intentionally narrow:

- list known projects
- connect a local repo
- review a plan for a bounded task
- run a bounded task
- stream mission console progress
- print or open the latest report
- launch the desktop app

## Prerequisites

- The local API must be running.
- The easiest way to satisfy that is to start the desktop app or run `npm run dev:api`.
- Standalone `npm run dev:api` requires a non-empty `API_TOKEN`; export it in the environment or keep it in `.env`.

## Common Commands

List projects:

```bash
npm run cli -- projects
```

Connect a repo:

```bash
npm run cli -- connect /absolute/path/to/repo
```

Bootstrap an empty folder as a blank managed project:

```bash
npm run cli -- connect /absolute/path/to/empty-folder --bootstrap
```

Bootstrap an empty folder and immediately apply a starter:

```bash
npm run cli -- connect /absolute/path/to/empty-folder --bootstrap --starter neutral_baseline
npm run cli -- connect /absolute/path/to/empty-folder --bootstrap --starter typescript_vite_react
```

Review a plan:

```bash
npm run cli -- plan --project <project-id> --prompt "Add a status badge component with tests"
```

Run a task and stream console output:

```bash
npm run cli -- run --project <project-id> --prompt "Rename the hero headline and update the test"
```

Read the latest report for a project:

```bash
npm run cli -- report --project <project-id>
```

Launch the desktop app:

```bash
npm run cli -- desktop
```

## Notes

- `run` uses the same mission execution endpoint as the desktop app.
- `plan` does not change files; it only returns the route/context output.
- The CLI does not replace the desktop UI. It is a fast source-user wedge into the same local system.

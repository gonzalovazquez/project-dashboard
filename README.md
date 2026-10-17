# Project Dashboard

A macOS desktop app for finishing local projects. It scans `~/Development`, reads project status from
Notion, and shows an executive summary of every project plus a deep dive on the (at most 3) you are focusing on.

The interface is mocked in [`docs/ui-mockup.html`](docs/ui-mockup.html). The Notion setup is in
[`docs/notion-schema.md`](docs/notion-schema.md).

## Commands

```
npm install
npm run dev                    # run the app with hot reload
npm run build                  # build main, preload and renderer into out/
npm run smoke                  # build, launch the real app under xvfb, check what it rendered (Linux)
npm run ui-check               # build, serve the interface with sample data, run the interface checks and save light and dark screenshots
npm test                       # unit and integration tests
npm run typecheck
npm run scan                   # scan ~/Development and print a table
npm run scan -- <folder> --json
npm run notion:setup          # dry run of the Notion schema changes (see docs/notion-schema.md)
npm run notion:pull           # read only: folders matched to Notion pages
```

## The desktop app

Electron 44 with React and Vite, built by `electron-vite` 5 (chosen over `vite-plugin-electron` and a hand-rolled
setup: one config for main, preload and renderer, far wider use, and 5.0.0 is the settled release; 6.0.0 went stable
only days before this was decided, so upgrading is a later one-line bump).

The main process owns scanning, Notion access and the cache. The interface reaches it only through the bridge in
`src/preload/index.ts`, typed by `src/shared/ipc.ts`:

| Call | What it does |
|---|---|
| `getSnapshot`, `startScan`, `onProjectUpdate` | Read the current state, rescan, and receive each project as its scan finishes |
| `setNextAction`, `setCriterion` | Write a next action or a checklist item to Notion |
| `promote`, `park`, `kill`, `unpark` | Change focus and lifecycle. The pure rules run first; a rejected rule (a fourth focus project) writes nothing |
| `getSettings`, `saveSettings`, `setToken` | Development folder, folder to page overrides, appearance (system, light or dark) and the Notion token |
| `openLink` | Open a project's GitHub page, Notion page or folder. The interface names the project; the main process looks up the URL |

Safety properties, each covered by a test or by `npm run smoke`:

- The Notion token is encrypted with the system keychain (`safeStorage`). If encryption is unavailable the app refuses to
  save it instead of writing plain text; `NOTION_TOKEN` in the environment still works and is never stored.
- The token never crosses the bridge, and IPC arguments are validated. Messages from any page other than the app's own are rejected.
- `contextIsolation` on, `nodeIntegration` off, sandboxed renderer, no navigation or new windows, and a strict content security policy in the built app.
- A change that needs several Notion writes (park one project and promote another) undoes the first write if a later one fails.
- The Development folder is only ever read.

App data (settings, cache, stage snapshot, encrypted token) lives in Electron's user data folder. Set `DASHBOARD_HOME`
to use a different one, for example when experimenting.

## How it works

| Piece | Where | What it does |
|---|---|---|
| Scanner | `src/main/scanner` | Git history, GitHub link, tech detection, complexity score, activity pulse |
| Focus rules | `src/shared/rules.ts` | Progress, forecast, stall flags, health, closest-to-done ranking, the 3-project limit |
| Notion | `src/main/notion` | Gateway (read and write), schema setup, folder matching, page parsing, stage change detection |
| App service | `src/main/app` | Scan, merge with Notion, cache, settings, token storage, change handling, IPC |
| Shell | `src/main/index.ts`, `src/preload` | Window, security settings, bridge |
| Interface | `src/renderer` | React. `viewmodel/` holds the tested logic (headline, tiles, highlights, table); `components/` only draws it |
| Types | `src/shared/types.ts` | The data model shared by scanner, rules and UI |

## Status

- [x] Scanner, focus rules, Notion matching and parsing
- [x] Notion client: gateway, schema dry run, stage change detection (awaiting review before the schema is applied)
- [x] Electron shell, IPC, cache and settings (a plain list in the window; verified by a real launch)
- [x] Overview screen: layout, sidebar, toolbar, headline, six tiles, highlights, sortable portfolio table, empty and loading states
- [x] Overview charts: forecast, commits, stages over time, progress against complexity, time in stage, activity and technology ([colors](docs/chart-colors.md))
- [ ] Deep dive (Week 5), library, focus management and inbox (Week 6)
- [ ] Weekly review flow, file watching, packaging

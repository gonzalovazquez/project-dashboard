# Project Dashboard

A macOS desktop app for finishing local projects. It scans `~/Development`, reads project status from
Notion, and shows an executive summary of every project plus a deep dive on the (at most 3) you are focusing on.

The interface is mocked in [`docs/ui-mockup.html`](docs/ui-mockup.html). The Notion setup is in
[`docs/notion-schema.md`](docs/notion-schema.md).

## Commands

```
npm install
npm test                       # unit and integration tests
npm run typecheck
npm run scan                   # scan ~/Development and print a table
npm run scan -- <folder> --json
```

## How it works

| Piece | Where | What it does |
|---|---|---|
| Scanner | `src/main/scanner` | Git history, GitHub link, tech detection, complexity score, activity pulse |
| Focus rules | `src/main/focus/rules.ts` | Progress, forecast, stall flags, health, closest-to-done ranking, the 3-project limit |
| Notion | `src/main/notion` | Folder matching and page parsing |
| Types | `src/shared/types.ts` | The data model shared by scanner, rules and UI |

## Status

- [x] Scanner, focus rules, Notion matching and parsing (52 tests)
- [ ] Notion API client (query database, read page blocks, write back focus, next action and lifecycle)
- [ ] Electron shell and IPC
- [ ] React UI following the mockup
- [ ] Weekly review flow, file watching, packaging

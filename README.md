# Project Dashboard

A macOS desktop app for finishing local projects. It scans your Development folder, reads each project's status from a
Notion database, and shows an executive summary of every project plus a deep dive on the (at most three) you are focusing
on. It exists to push projects across the line: a limit of three, a ship checklist for each, one next action, stall
flags, and a weekly review that forces a decision.

The interface was designed in [`docs/ui-mockup.html`](docs/ui-mockup.html). The Notion setup is in
[`docs/notion-schema.md`](docs/notion-schema.md) (the properties) and [`docs/notion-setup.md`](docs/notion-setup.md) (the step-by-step guide), the chart colors in [`docs/chart-colors.md`](docs/chart-colors.md).

## Install

There is no signed release. Build it yourself on the Mac you will use it on:

```
git clone https://github.com/gonzalovazquez/project-dashboard.git
cd project-dashboard
npm install
npm run package        # writes release/Project Dashboard-<version>-arm64.dmg (and x64, and zips)
```

Open the `.dmg`, drag **Project Dashboard** to Applications. The app is not signed or notarized (that needs a paid Apple
developer account), so macOS blocks the first launch. Either right-click the app and choose **Open**, then **Open** again,
or remove the quarantine flag once:

```
xattr -dr com.apple.quarantine "/Applications/Project Dashboard.app"
```

`npm run package:dir` builds an unpacked app for the machine you are on, which is how the packaging was tested on Linux
(the `.dmg` target needs macOS to build). To run from source instead: `npm run dev`.

## Startup guide

Follow this once, in order. Each step says how to tell it worked. The full Notion walkthrough, with troubleshooting, is
in [`docs/notion-setup.md`](docs/notion-setup.md).

**1. Install and open the app.** See Install above, or run `npm run dev` from source.
*Worked when:* a window opens on a **Welcome** screen.

**2. Choose your Development folder.** Choose **Choose…** under Development folder. Every folder directly inside it becomes
a project, and the folder is only ever read.
*Worked when:* the path shown is yours and the sidebar counts your folders under **All projects**.

**3. Create a Notion integration and share your database with it.**
1. In Notion, open Settings, then Connections, then Develop or manage integrations, and create an **internal** integration
   named `Project Dashboard` with Read, Update and Insert content turned on.
2. Copy the integration secret.
3. Open your Brainstorming database, choose **•••**, **Connections**, and add the integration. Skipping this is the usual cause of "0 pages".

**4. Connect the app.** Paste the secret into the Notion field and choose **Connect**. It is stored encrypted in the system
keychain. If you prefer, set `NOTION_TOKEN` in the environment instead and the app never stores it.
*Worked when:* Settings says **Connected, N pages in the database**.

**5. Check what matched (read only).**

```
export NOTION_TOKEN=<your secret>
npm run notion:pull -- ~/Development
```

*Worked when:* your tracked projects appear under "Matched". Folders that are the same product (for example `TabSaver`,
`TabSaverAPI`, `TabSaverInfra` and `TabSaverMockAPI`) should be grouped: add the main folder to Notion from the
**Inbox**, then use **Group into…** on the others. They are then tracked as one project with one page.

**6. Add the six properties the app needs (you approve it).**

```
npm run notion:setup               # dry run, changes nothing
npm run notion:setup -- --apply    # adds Focus, Lifecycle, Next action, Stage changed, Park reason, Revisit on
```

*Worked when:* the dry run says nothing is missing and the app's Notion banner is gone.

**7. Add ship criteria.** On each project's Notion page, add to-do items for what must be true to ship, with an optional
estimate such as `(3h)`.
*Worked when:* the project shows a progress percentage and a forecast date.

**8. Pick up to three projects to focus on.** Open a project from **All projects** and choose **Make focus** in its quick look. (Only projects with a Notion page can take a focus slot.)
*Worked when:* the sidebar's Focus section lists them and each has a deep dive.

**9. Set the review reminder.** Settings, Weekly review reminder: choose a day and time. Then do your first **Weekly review**.
*Worked when:* the review ends with "Review complete" and a dated note appears on each reviewed Notion page.

Anything wrong at any step: the banner at the top of the app says what and has a button to fix or retry it, and the
troubleshooting table in [`docs/notion-setup.md`](docs/notion-setup.md) covers the rest.

## Using it

| Screen | What it is for |
|---|---|
| **Overview** | The executive summary: one headline, six tiles, forecast ship dates, commits per week, projects by stage over time, progress against complexity, time in stage, and a sortable portfolio table. Click a focus project to open it |
| **Deep dive** | One focus project in detail: next action, burnup chart with a forecast band, the ship checklist (ticking writes to Notion), commit heatmap, health breakdown, languages, details and recent commits, and **Mark shipped** once every criterion is done |
| **Weekly review** | Four steps: look back at the week, decide on every stalled project (keep going, park or kill), pick the next three, set a next action for each. Applying is all or nothing and leaves a dated note on each reviewed Notion page. A notification reminds you on the day and time you choose |
| **All projects** | Every folder, filtered by state, activity, complexity or technology, with search. Click a row for a quick look |
| **Inbox** | Folders with no Notion page: add one, link to a page that already exists, group it into another project (the same product in several folders), or ignore it |
| **Parked / Shipped** | Parked projects with the reason and revisit date (due ones are marked), and projects that reached General Available |
| **Settings** | Folder, Notion connection, appearance and the review reminder |

The app keeps itself current: it watches the Development folder for folders coming and going, and each project's `.git`
folder for commits, and refreshes just what changed. It also rescans when you return to it after ten minutes away.
Staged and uncommitted changes show up on the next commit, add or rescan.

### The rules

- At most **3** projects are in focus. A fourth needs another to be parked, with a reason and a revisit date.
- Progress is the share of ship criteria that are checked. Criteria are to-do items on the project's Notion page, with an
  optional estimate such as `(3h)`.
- The forecast is the open criteria divided by the criteria finished in the last four weeks (floor of 0.25 a week), with a
  band of 0.7 to 1.5 times that.
- A project is flagged after 30 days In progress or 45 days in Beta, with no next action, or with no commits (14 days for
  focus projects, 21 for others).
- Only a project whose criteria are all done can be marked shipped. A project with no criteria has no definition of done.

## Commands

```
npm install
npm run dev                    # run the app with hot reload
npm run build                  # build main, preload and renderer into out/
npm run package                # macOS .dmg and .zip (run on a Mac); npm run package:dir for the current OS
npm run icon                   # redraw build/icon.png
npm test                       # unit and integration tests
npm run typecheck
npm run smoke                  # launch the real app under xvfb and check what it rendered (Linux); SMOKE_BIN=<app> tests a packaged build
npm run ui-check               # serve the interface with sample data, run the interface checks, save light and dark screenshots
npm run scan                   # scan ~/Development and print a table
npm run scan -- <folder> --json
npm run notion:setup           # dry run of the Notion schema changes
npm run notion:pull            # read only: folders matched to Notion pages
```

## How it is built

Electron 44 with React and Vite, built by `electron-vite` 5. The main process owns scanning, Notion access, file watching
and the cache. The interface reaches it only through the bridge in `src/preload/index.ts`, typed by `src/shared/ipc.ts`.

| Call | What it does |
|---|---|
| `getSnapshot`, `startScan`, `onProjectUpdate` | Read the current state, rescan, and receive each change as it happens |
| `setNextAction`, `setCriterion` | Write a next action or a checklist item to Notion |
| `promote`, `park`, `kill`, `unpark`, `markShipped` | Change focus, lifecycle and stage. The pure rules run first; a rejected rule writes nothing |
| `applyReview` | A whole weekly review in one step, or none of it, then the dated notes |
| `addToNotion`, `linkFolder`, `groupFolder`, `ungroupFolder`, `ignoreFolder` | Inbox actions |
| `getSettings`, `saveSettings`, `setToken`, `chooseFolder` | Folder, overrides, appearance, review reminder, the Notion token and the folder picker |
| `openLink` | Open a project's GitHub page, Notion page or folder. The interface names the project; the main process looks up the URL |

| Piece | Where | What it does |
|---|---|---|
| Scanner | `src/main/scanner` | Git history, GitHub link, tech detection, complexity score, activity pulse |
| Rules | `src/shared/rules.ts`, `src/shared/review.ts` | Progress, forecast, flags, health, ranking, the 3-project limit, shipping, the weekly review, reminder timing |
| Notion | `src/main/notion` | Gateway (read and write), schema setup, folder matching, page parsing, stage change detection |
| App service | `src/main/app` | Scan, merge with Notion, cache, settings, token storage, atomic changes, IPC, file watching, reminder |
| Shell | `src/main/index.ts`, `src/preload` | Window, security settings, bridge, notifications |
| Interface | `src/renderer` | React. `viewmodel/` holds the tested logic; `components/` only draws it |

Safety properties, each covered by a test, `npm run ui-check` or `npm run smoke`:

- The Notion token is encrypted with the system keychain (`safeStorage`). If encryption is unavailable the app refuses to
  save it instead of writing plain text. It never crosses the bridge, and IPC arguments are validated. Messages from any
  page other than the app's own are rejected.
- `contextIsolation` on, `nodeIntegration` off, sandboxed renderer, no navigation or new windows, a strict content
  security policy in the built app, and a crashed window process is reloaded.
- A change that needs several Notion writes (a review, or parking one project and promoting another) undoes the earlier
  writes if a later one fails, and changes nothing in the app.
- Writes are blocked while a scan runs and when the Notion database lacks the properties they need.
- The Development folder is only ever read.

App data (settings, cache, stage history, encrypted token) lives in Electron's user data folder. Set `DASHBOARD_HOME` to
use another one, for example when experimenting.

### Known limits

- Notion keeps no status history, so the stage chart starts the day you first connect and fills in as the app scans.
- The date a criterion was completed is the block's last edit time in Notion. Editing a finished item moves its date.
- The macOS look (sidebar blur, traffic lights) is built for macOS but was only checked in a browser and on Linux.
- Reminders need the app to be running. There is no background helper.
- Folders that are not git repositories show activity from file changes and refresh only on a rescan.

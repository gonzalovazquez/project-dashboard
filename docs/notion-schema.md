# Notion schema

The dashboard reads one Notion database (your Brainstorming board). Property names are set in
`src/main/notion/parse.ts` (`PROPS`), so rename them there if yours differ.

| Property | Type | Purpose |
|---|---|---|
| Idea | Title | Matched to a folder name (see below) |
| Status | Status | Not started, In progress, Beta, General Available |
| Focus | Checkbox | In one of the 3 focus slots |
| Lifecycle | Select | Active, Parked, Killed (empty counts as Active) |
| Stage changed | Date | When Status last changed. Falls back to the page's created time |
| Park reason | Text | Why it was parked |
| Revisit on | Date | When a parked project returns for review |

## Page body: the Planning section

Ship criteria are the to-dos under a **Planning** heading in the page body, not a property. Every page in the
database has one, normally as the last section:

```
## Planning

- [ ] Deploy to production (4h)
- [ ] Use it daily for a week
```

- The section runs from the Planning heading to the next heading of the same or a higher level, so `###`
  subheadings inside it are fine. The heading matches at any level, ignoring case, emoji and punctuation.
- Only top-level to-dos count. A to-do inside a toggle or column is not read.
- To-dos elsewhere on the page (a demo prep checklist, say) are not ship criteria.
- The first unchecked one is the project's next step, so there is no separate next-action field.
- End one with an estimate in brackets, like `Deploy to production (4h)`, to give it hours.
- Adding a criterion from the app (deep dive or weekly review) inserts it right after the section's last to-do.
  A page with no Planning heading gets one at the end.
- A page with no Planning heading at all is read the old way: every top-level to-do counts.

Older versions of the app added a **Next action** text property. The app no longer reads or writes it, so you
can delete it from the database whenever you like.

## Setting it up

The step-by-step guide, with troubleshooting, is [notion-setup.md](notion-setup.md). The short version:

Create a Notion integration, share the Brainstorming database with it, and export its token.

```
export NOTION_TOKEN=secret_...
npm run notion:setup            # dry run: prints what is missing, changes nothing
npm run notion:setup -- --apply # adds the missing properties. It only ever adds
npm run notion:pull ~/Development   # read only: shows which folders matched which pages
```

`notion:setup` never removes or renames anything. Two things it cannot fix and will report instead:
a property that already exists with the wrong type, and missing Status values (the API cannot add status options).

## Stage changed

Notion does not record when a status changed. The app keeps a small snapshot of each page's last seen status
(`~/.project-dashboard/stage-snapshot.json`, or `$PROJECT_DASHBOARD_HOME`). When a page's status differs from the
snapshot, the app writes today's date to **Stage changed**. The first time a page is seen it is only recorded as a
baseline, because its real change date is unknown. Until the app has run, set Stage changed by hand for
projects that have been in a stage for a while, or "time in stage" falls back to the page's creation date.

## Ship criteria

Ship criteria are **to-do blocks in the page body**. Add an hour estimate in brackets at the end:

```
[x] Core logging flow
[ ] Deploy to production (4h)
```

A checked block's last-edited time is used as its completion date. That date drives velocity and the forecast.

## Folder matching

Each folder is paired with at most one page. In order:

1. An explicit override (folder name to page id)
2. An exact match after lowercasing and removing punctuation (`dark-factory` and "Dark Factory")
3. One name contained in the other, at least 5 characters (`ai-newsletter` and "AI Newsletter Agent")
4. A shared prefix of 6+ characters (`whisper-safe` and "WhisperVault")

Anything else needs an override, for example `chicken-friends` to Flockchat. Folders with no match appear in the Inbox.

## Several folders, one product

A product kept in several folders (`TabSaver`, `TabSaverAPI`, `TabSaverInfra`, `TabSaverMockAPI`) is one Notion page. In the
Inbox, use **Group into…** (or the suggested button) on each extra folder. The app then treats them as one project:
commits and uncommitted work add up, technology is combined, complexity is the highest of the folders, and the project
shows an Includes line. **Settings** lists grouped folders and can split one back out.

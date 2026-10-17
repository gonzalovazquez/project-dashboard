# Notion schema

The dashboard reads one Notion database (your Brainstorming board). Property names are set in
`src/main/notion/parse.ts` (`PROPS`), so rename them there if yours differ.

| Property | Type | Purpose |
|---|---|---|
| Name | Title | Matched to a folder name (see below) |
| Status | Status | Not started, In progress, Beta, General Available |
| Next action | Text | One thing you can finish in a sitting |
| Focus | Checkbox | In one of the 3 focus slots |
| Lifecycle | Select | Active, Parked, Killed (empty counts as Active) |
| Stage changed | Date | When Status last changed. Falls back to the page's created time |
| Park reason | Text | Why it was parked |
| Revisit on | Date | When a parked project returns for review |

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

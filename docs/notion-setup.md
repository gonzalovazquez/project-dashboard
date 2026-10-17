# Setting up Notion

The dashboard reads and writes one Notion database, your **Brainstorming** board. This guide takes you from nothing to a
working connection. Allow about ten minutes. Nothing in Notion changes until step 6, and you approve that step.

## What you need

- A Notion account that can edit the Brainstorming database.
- This repository cloned, with `npm install` done (the checks in steps 4 to 6 run from it).

## 1. Create an integration

An integration is how an app gets permission to use your Notion.

1. Open <https://www.notion.so/profile/integrations> (in Notion: **Settings**, **Connections**, **Develop or manage integrations**).
2. Choose **New integration**.
3. Name it `Project Dashboard`, pick your workspace, and leave the type as **Internal**.
4. Under **Capabilities**, turn on **Read content**, **Update content** and **Insert content**. The dashboard needs all three:
   reading pages, ticking criteria and setting properties, and adding review notes and new pages. It does not need user information.
5. Save, then open the integration's **Configuration** tab and copy the **Internal Integration Secret**. It starts with
   `ntn_` or `secret_`. Treat it like a password.

## 2. Give the integration access to the database

An integration sees nothing until you share pages with it.

1. Open your **Brainstorming** database in Notion as a full page.
2. Click the **•••** menu at the top right, choose **Connections**, then **Connect to**, and pick `Project Dashboard`.
3. Confirm. The integration now has access to the database and every page in it.

If you skip this step, the app reports "Could not reach Notion" or finds zero pages. It is the most common mistake.

## 3. Check the database

The app expects these properties on the database. The first two already exist on a Brainstorming board.

| Property | Type | Notes |
|---|---|---|
| Idea | Title | Matched to a folder name |
| Status | Status | Needs the four values Not started, In progress, Beta, General Available |
| Focus, Lifecycle, Next action, Stage changed, Park reason, Revisit on | Checkbox, Select, Text, Date, Text, Date | Added in step 6 |

Property names are set in `src/main/notion/parse.ts` (`PROPS`). If yours are named differently, change them there.

**If you use a different database than the default**, set its ID before launching the app or running the commands below:

```
export NOTION_DATA_SOURCE_ID=<the data source id>
```

The default is the ID of the original Brainstorming board, so most people can skip this. To find another database's ID,
open it in Notion, choose **•••**, then **Manage data sources**, and copy the ID (Notion moves this menu around, so if you
cannot find it, check Notion's API documentation for "data source ID").

## 4. Connect the app

Choose one:

- **In the app (recommended).** Open **Settings**, paste the secret into the Notion field, and choose **Connect**. The
  secret is stored encrypted in your system keychain. If the app says the computer cannot encrypt secrets, use the next option.
- **Environment variable.** Set `NOTION_TOKEN` before launching the app. The app never stores it. Settings shows
  "The token comes from the NOTION_TOKEN environment variable".

Settings should now show **Connected, N pages in the database**. If it does not, see Troubleshooting below.

## 5. See what matched (read only)

```
export NOTION_TOKEN=<your secret>
npm run notion:pull -- ~/Development
```

This prints which folders matched which pages, which folders have no page, and which pages have no folder. It changes
nothing. Do not add `--save-snapshot`: that stores a baseline for the command line tool, not for the app.

Matching is by name: exact, one name inside the other (5 or more characters), or a shared prefix of 6 or more
characters. Folders that belong to the same product, such as `TabSaver`, `TabSaverAPI` and `TabSaverInfra`, are best
**grouped**: add the main one to Notion, then in the app's **Inbox** choose **Group into…** for the others. They are then
tracked as one project with one page.

## 6. Add the properties the app needs (you approve it)

```
npm run notion:setup               # dry run: lists what would be added, changes nothing
npm run notion:setup -- --apply    # adds the missing properties
```

`notion:setup` only ever **adds** properties. It never renames or removes anything. It reports, rather than fixes, a
property that exists with the wrong type and missing Status values (Notion's API cannot add status options): add those in
Notion by hand. Until this step is done the app still reads everything, shows a banner, and blocks only the changes that
need the new properties. Ticking criteria still works.

## 7. Add ship criteria

Ship criteria are **to-do items in the body of each project's Notion page**. A project with none has no definition of
done, so it cannot be marked shipped. Add an estimate in brackets if you like:

```
[x] Core logging flow
[ ] Deploy to production (4h)
```

## Troubleshooting

| What you see | Cause and fix |
|---|---|
| "Could not reach Notion: unauthorized" or an API key error | The secret is wrong or was regenerated. Copy it again from the integration's Configuration tab and reconnect |
| Connected, but 0 pages | The database was not shared with the integration. Repeat step 2 |
| "Could not reach Notion" with a network message | You are offline or a firewall blocks api.notion.com. The app keeps showing the last data |
| "The Notion database is missing properties" | Run step 6 |
| `notion:setup` lists a line starting with `!` | A property has the wrong type or a Status value is missing. Fix it in Notion by hand, then run it again |
| A folder is in the Inbox but has a page | The names are too different to match. In the Inbox choose **Link to page…** and pick the page |
| "This computer cannot encrypt secrets" | The system keychain is unavailable. Use the `NOTION_TOKEN` environment variable instead |
| The secret leaked | In Notion's integrations page, regenerate the secret, then reconnect in Settings |

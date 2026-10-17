import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createGateway, createNotionClient, DEFAULT_DATA_SOURCE_ID } from './gateway.js';
import { matchFolders } from './match.js';
import { PROPS, getTitle } from './parse.js';
import { applySchema, checkSchema, describeDiff, hasChanges, hasProblems } from './schema.js';
import { detectStageChanges, loadSnapshot, saveSnapshot } from './stage.js';

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const positional = rest.filter((a) => !a.startsWith('--'));
const token = process.env.NOTION_TOKEN;
const dataSourceId = process.env.NOTION_DATA_SOURCE_ID ?? DEFAULT_DATA_SOURCE_ID;
const home = process.env.PROJECT_DASHBOARD_HOME ?? join(homedir(), '.project-dashboard');

if (!token || !['setup', 'pull'].includes(cmd ?? '')) {
  console.error(token ? 'Usage: notion:setup [--apply] | notion:pull [folder] [--save-snapshot]' : 'Set NOTION_TOKEN to a Notion integration token that has access to the Brainstorming database.');
  process.exit(1);
}
const api = createNotionClient(token);

if (cmd === 'setup') {
  const { diff, dataSource } = await checkSchema(api, dataSourceId);
  console.log(describeDiff(diff).join('\n'));
  if (!flags.has('--apply')) {
    console.log(hasChanges(diff) ? '\nDry run. Nothing was changed. Re-run with --apply to make the "+" changes above.' : '');
  } else if (await applySchema(api, dataSourceId, diff, dataSource)) {
    console.log('\nApplied the "+" changes. Lines marked "!" still need a manual fix.');
  } else {
    console.log(hasProblems(diff) ? '\nNothing to apply. Fix the "!" lines in Notion.' : '');
  }
}

if (cmd === 'pull') {
  const root = positional[0] ?? join(homedir(), 'Development');
  const folders = (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
  const loaded = await createGateway(api, dataSourceId).loadProjects();
  const titles = loaded.map((l) => ({ id: l.page.id, title: getTitle(l.page.properties[PROPS.title]) }));
  const byId = new Map(loaded.map((l) => [l.page.id, l]));
  const matches = matchFolders(folders, titles);

  console.log(`${loaded.length} Notion pages, ${folders.length} folders in ${root}\n\nMatched:`);
  for (const [folder, id] of matches) {
    const l = byId.get(id)!;
    console.log(`  ${folder.padEnd(26)} -> ${(l.info?.title ?? '?').padEnd(34)} ${l.info?.stage ?? 'unknown status'}, ${l.info?.criteria.length ?? 0} criteria`);
  }
  console.log('\nFolders with no page (they need a page or an override):');
  for (const f of folders.filter((f) => !matches.has(f))) console.log(`  ${f}`);
  const used = new Set(matches.values());
  console.log('\nPages with no folder:');
  for (const t of titles.filter((t) => !used.has(t.id))) console.log(`  ${t.title}`);

  const snapPath = join(home, 'stage-snapshot.json');
  const pages = loaded.flatMap((l) => (l.info ? [{ pageId: l.page.id, stage: l.info.stage }] : []));
  const { changes, next } = detectStageChanges(await loadSnapshot(snapPath), pages, new Date());
  console.log(`\nStage changes since the last snapshot: ${changes.length}`);
  for (const c of changes) console.log(`  ${byId.get(c.pageId)?.info?.title}: ${c.from} -> ${c.to} (would stamp "${PROPS.stageChanged}")`);
  if (flags.has('--save-snapshot')) { await saveSnapshot(snapPath, next); console.log(`Saved snapshot to ${snapPath}`); }
  else console.log('Read only: nothing was written. Use --save-snapshot to store this baseline locally.');
}

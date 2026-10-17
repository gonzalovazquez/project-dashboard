// Writes the sample Development folder (see test/fixtures/sample.ts) as a snapshot the interface can render without a main process.
import { mkdir, writeFile } from 'node:fs/promises';
import type { Snapshot } from '../src/shared/ipc.js';
import { sampleProjects } from '../test/fixtures/sample.js';
import { NOW } from '../test/helpers.js';

const variant = process.argv[2] ?? 'full';

/** Weekly pipeline records leading up to today, so the stage chart has something real-looking to draw. */
const week = (back: number, c: [number, number, number, number]) => {
  const d = new Date(NOW.getTime() - back * 7 * 86_400_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, counts: { 'Not started': c[0], 'In progress': c[1], Beta: c[2], 'General Available': c[3] } };
};
const history = variant === 'sparse' ? [week(0, [0, 2, 4, 0])] : variant === 'full' || variant === 'scanning' ? [week(8, [2, 3, 1, 0]), week(7, [2, 3, 1, 0]), week(6, [1, 3, 2, 0]), week(5, [1, 3, 2, 0]), week(4, [1, 2, 3, 0]), week(3, [0, 2, 3, 0]), week(2, [0, 2, 4, 0]), week(1, [0, 2, 4, 0]), week(0, [0, 2, 4, 0])] : [];
const all = sampleProjects();
const projects = variant === 'firstrun' ? [] : variant === 'untracked' ? all.filter((p) => !p.notion) : variant === 'empty' || variant === 'scanning-empty' ? [] : all;
const snapshot: Snapshot = {
  scanError: variant === 'broken' ? 'The folder /Users/gonzalo/Development does not exist. Choose your Development folder in settings.' : undefined,
  projects,
  scannedAt: NOW.toISOString(),
  scanning: variant === 'scanning' || variant === 'scanning-empty',
  notion: variant === 'untracked' || variant === 'firstrun' ? { state: 'not-configured', message: undefined } : variant === 'broken' ? { state: 'error', message: 'Could not reach Notion: getaddrinfo ENOTFOUND api.notion.com. Showing the last known data.', syncedAt: NOW.toISOString(), pages: 8 } : { state: 'connected', syncedAt: NOW.toISOString(), pages: 8 },
  stageHistory: history,
  unlinkedPages: variant === 'full' ? [{ id: 'u1', title: 'Garden Planner', stage: 'Not started', url: 'https://notion.so/u1' }, { id: 'u2', title: 'Mood Journal', stage: 'In progress', url: 'https://notion.so/u2' }] : [],
  settings: { developmentFolder: '/Users/gonzalo/Development', overrides: {}, groups: {}, ignored: variant === 'full' ? [all.find((p) => !p.notion)?.name ?? ''].filter(Boolean) : [], tokenSource: variant === 'firstrun' || variant === 'untracked' ? 'none' : 'keychain', secureStorageAvailable: true, appearance: 'system', reviewDay: 5, reviewTime: '16:00', reviewReminder: true, onboarded: variant !== 'firstrun' },
};
await mkdir('out', { recursive: true });
// A project with a missing pulse makes the Overview throw while drawing, to prove the crash screen catches it.
if (variant === 'crash') (snapshot.projects[0] as unknown as { pulse: unknown }).pulse = null;
await writeFile(`out/sample-${variant}.json`, JSON.stringify(snapshot));
console.log(`wrote out/sample-${variant}.json (${projects.length} projects)`);

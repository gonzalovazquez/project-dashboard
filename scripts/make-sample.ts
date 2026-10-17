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
const projects = variant === 'untracked' ? all.filter((p) => !p.notion) : variant === 'empty' || variant === 'scanning-empty' ? [] : all;
const snapshot: Snapshot = {
  projects,
  scannedAt: NOW.toISOString(),
  scanning: variant === 'scanning' || variant === 'scanning-empty',
  notion: variant === 'untracked' ? { state: 'not-configured', message: undefined } : { state: 'connected', syncedAt: NOW.toISOString(), pages: 8 },
  stageHistory: history,
  settings: { developmentFolder: '/Users/gonzalo/Development', overrides: {}, tokenSource: 'keychain', secureStorageAvailable: true, appearance: 'system' },
};
await mkdir('out', { recursive: true });
await writeFile(`out/sample-${variant}.json`, JSON.stringify(snapshot));
console.log(`wrote out/sample-${variant}.json (${projects.length} projects)`);

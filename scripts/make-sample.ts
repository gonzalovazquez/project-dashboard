// Writes the sample Development folder (see test/fixtures/sample.ts) as a snapshot the interface can render without a main process.
import { mkdir, writeFile } from 'node:fs/promises';
import type { Snapshot } from '../src/shared/ipc.js';
import { sampleProjects } from '../test/fixtures/sample.js';
import { NOW } from '../test/helpers.js';

const variant = process.argv[2] ?? 'full';
const all = sampleProjects();
const projects = variant === 'untracked' ? all.filter((p) => !p.notion) : variant === 'empty' || variant === 'scanning-empty' ? [] : all;
const snapshot: Snapshot = {
  projects,
  scannedAt: NOW.toISOString(),
  scanning: variant === 'scanning' || variant === 'scanning-empty',
  notion: variant === 'untracked' ? { state: 'not-configured', message: undefined } : { state: 'connected', syncedAt: NOW.toISOString(), pages: 8 },
  settings: { developmentFolder: '/Users/gonzalo/Development', overrides: {}, tokenSource: 'keychain', secureStorageAvailable: true, appearance: 'system' },
};
await mkdir('out', { recursive: true });
await writeFile(`out/sample-${variant}.json`, JSON.stringify(snapshot));
console.log(`wrote out/sample-${variant}.json (${projects.length} projects)`);

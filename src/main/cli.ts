import { homedir } from 'node:os';
import { join } from 'node:path';
import { scanRoot } from './scanner/scan.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const root = args.find((a) => !a.startsWith('--')) ?? join(homedir(), 'Development');

const started = Date.now();
const results = await scanRoot(root);
if (json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
  console.log(`${pad('Project', 26)}${pad('Pulse', 10)}${pad('Cx', 12)}${pad('Last', 8)}Tech`);
  for (const p of results) {
    const days = p.pulse.lastActivityDays;
    console.log(`${pad(p.name, 26)}${pad(p.pulse.level, 10)}${pad(`${p.complexity.score} ${p.complexity.level}`, 12)}${pad(days === null ? '-' : `${days}d`, 8)}${p.tech.join(', ')}`);
  }
  console.log(`\n${results.length} folders scanned in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

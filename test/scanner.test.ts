import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeComplexity, hasTests, infraMarkers, levelFor } from '../src/main/scanner/complexity.js';
import { normalizeRemote, weeklyBuckets } from '../src/main/scanner/git.js';
import { computePulse } from '../src/main/scanner/pulse.js';
import { scanProject, scanRoot } from '../src/main/scanner/scan.js';
import { detectTech, languageShares } from '../src/main/scanner/tech.js';
import { NOW, daysAgo, makeRepo, tmp, writeFiles } from './helpers.js';

describe('normalizeRemote', () => {
  it.each([
    ['git@github.com:gonzalo/dark-factory.git', 'https://github.com/gonzalo/dark-factory'],
    ['https://github.com/gonzalo/dark-factory.git', 'https://github.com/gonzalo/dark-factory'],
    ['https://user:token@github.com/gonzalo/x', 'https://github.com/gonzalo/x'],
    ['ssh://git@github.com/gonzalo/x.git', 'https://github.com/gonzalo/x'],
  ])('%s', (input, expected) => expect(normalizeRemote(input)).toBe(expected));
  it('ignores other hosts and empty input', () => {
    expect(normalizeRemote('git@gitlab.com:a/b.git')).toBeUndefined();
    expect(normalizeRemote(undefined)).toBeUndefined();
  });
});

describe('weeklyBuckets', () => {
  it('puts the latest commits in the last bucket and drops anything older than 12 weeks', () => {
    const b = weeklyBuckets([daysAgo(0), daysAgo(6), daysAgo(7), daysAgo(83), daysAgo(84), daysAgo(200)], NOW);
    expect(b).toHaveLength(12);
    expect(b[11]).toBe(2);
    expect(b[10]).toBe(1);
    expect(b[0]).toBe(1);
    expect(b.reduce((a, c) => a + c, 0)).toBe(4);
  });
  it('ignores commits dated in the future', () => {
    expect(weeklyBuckets([new Date(NOW.getTime() + 1000)], NOW).every((c) => c === 0)).toBe(true);
  });
});

describe('computePulse', () => {
  const w = (last: number[]) => [...new Array(12 - last.length).fill(0), ...last];
  it('is Hot for steady recent activity', () => expect(computePulse(w([3, 4, 5, 6]), false, daysAgo(0), NOW).level).toBe('Hot'));
  it('is Warm for light recent activity', () => expect(computePulse(w([0, 0, 1, 2]), false, daysAgo(1), NOW).level).toBe('Warm'));
  it('is Cooling when only older commits exist inside four weeks', () => expect(computePulse(w([1, 0, 0, 0]), false, daysAgo(25), NOW).level).toBe('Cooling'));
  it('is Dormant after four quiet weeks', () => expect(computePulse(w([4, 3, 0, 0, 0, 0]), false, daysAgo(30), NOW).level).toBe('Dormant'));
  it('counts uncommitted work as activity', () => expect(computePulse(w([]), true, daysAgo(60), NOW).level).toBe('Cooling'));
  it('reports days since last activity', () => expect(computePulse(w([1]), false, daysAgo(9), NOW).lastActivityDays).toBe(9));
});

describe('detectTech', () => {
  const run = (files: Record<string, string>) => detectTech({ files: Object.keys(files), read: (r) => files[r] });
  it('reads Node manifests', () => {
    const t = run({ 'package.json': JSON.stringify({ dependencies: { react: '1', openai: '1' }, devDependencies: { typescript: '5' } }), 'src/a.tsx': '' });
    expect(t).toEqual(expect.arrayContaining(['Node', 'React', 'LLM', 'TypeScript']));
  });
  it('reads Python manifests and AWS hints', () => {
    const t = run({ 'requirements.txt': 'anthropic==0.40\nboto3\n', 'main.py': '' });
    expect(t).toEqual(expect.arrayContaining(['Python', 'LLM', 'AWS']));
  });
  it('detects infrastructure and extensions', () => {
    const t = run({ 'infra/main.tf': '', Dockerfile: '', 'manifest.json': '{"manifest_version":3}' });
    expect(t).toEqual(expect.arrayContaining(['Terraform', 'Docker', 'Chrome Ext']));
  });
  it('survives malformed manifests', () => expect(() => run({ 'package.json': '{oops' })).not.toThrow());
});

describe('languageShares', () => {
  it('returns top three plus Other, summing to 100', () => {
    const s = languageShares(new Map([['A', 50], ['B', 25], ['C', 15], ['D', 6], ['E', 4]]));
    expect(s.map((l) => l.name)).toEqual(['A', 'B', 'C', 'Other']);
    expect(s.reduce((a, l) => a + l.share, 0)).toBe(100);
  });
  it('is empty without code', () => expect(languageShares(new Map())).toEqual([]));
});

describe('complexity', () => {
  const small = { loc: 200, files: 8, languages: 1, dependencies: 2, infraMarkers: 0, hasTests: false };
  const big = { loc: 60_000, files: 900, languages: 4, dependencies: 35, infraMarkers: 3, hasTests: true };
  it('scores within 0..100 and grows with size', () => {
    const a = computeComplexity(small), b = computeComplexity(big);
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(b.score).toBeLessThanOrEqual(100);
    expect(b.score).toBeGreaterThan(a.score);
    expect(a.level).toBe('Low');
    expect(b.level).toBe('High');
  });
  it('puts a mid-sized project in Medium', () => {
    const c = computeComplexity({ loc: 5_000, files: 120, languages: 2, dependencies: 15, infraMarkers: 1, hasTests: true });
    expect(c.level).toBe('Medium');
  });
  it('parts add up to the score', () => {
    const c = computeComplexity(big);
    expect(Math.round(c.parts.reduce((a, p) => a + p.contribution, 0))).toBe(c.score);
  });
  it('level boundaries', () => {
    expect([levelFor(24), levelFor(25), levelFor(59), levelFor(60)]).toEqual(['Low', 'Medium', 'Medium', 'High']);
  });
  it('counts infra kinds, not files', () => {
    expect(infraMarkers(['Dockerfile', 'docker-compose.yml', 'a.tf', 'b.tf', '.github/workflows/ci.yml'])).toBe(3);
  });
  it('detects tests', () => {
    expect(hasTests(['src/a.ts', 'src/a.test.ts'])).toBe(true);
    expect(hasTests(['src/a.ts'])).toBe(false);
  });
});

describe('scanRoot', () => {
  it('scans git repos, plain folders, and skips hidden folders and files', async () => {
    const root = tmp();
    makeRepo(join(root, 'hot-app'), {
      files: { 'package.json': JSON.stringify({ dependencies: { react: '1' } }), 'src/a.ts': 'export const a = 1\n'.repeat(50) },
      commitsDaysAgo: [0, 1, 2, 3, 9, 40],
      remote: 'git@github.com:gonzalo/hot-app.git',
      dirtyFile: true,
    });
    makeRepo(join(root, 'old-app'), { commitsDaysAgo: [70] });
    writeFiles(join(root, 'plain-notes'), { 'notes.md': '# hi', 'node_modules/x/index.js': 'ignored' });
    mkdirSync(join(root, '.hidden'));
    writeFiles(root, { 'stray-file.txt': 'x' });

    const seen: string[] = [];
    const res = await scanRoot(root, { now: NOW, onProject: (p) => seen.push(p.name) });
    expect(res.map((r) => r.name)).toEqual(['hot-app', 'old-app', 'plain-notes']);
    expect(seen.sort()).toEqual(['hot-app', 'old-app', 'plain-notes']);

    const hot = res[0];
    expect(hot.isGit).toBe(true);
    expect(hot.github).toBe('https://github.com/gonzalo/hot-app');
    expect(hot.branch).toBe('main');
    expect(hot.dirty).toBe(true);
    expect(hot.weekly[11]).toBe(4);
    expect(hot.weekly[10]).toBe(1);
    expect(hot.weekly.reduce((a, c) => a + c, 0)).toBe(6);
    expect(hot.tech).toEqual(expect.arrayContaining(['Node', 'React', 'TypeScript']));
    expect(hot.languages[0].name).toBe('TypeScript');
    expect(hot.pulse.level).toBe('Hot');

    expect(res[1].pulse.level).toBe('Dormant');
    expect(res[1].github).toBeUndefined();

    const plain = res[2];
    expect(plain.isGit).toBe(false);
    expect(plain.github).toBeUndefined();
    expect(plain.lastCommit).toBeDefined();
  });

  it('does not treat a folder inside a parent repo as its own repo', async () => {
    const root = tmp();
    makeRepo(root, { commitsDaysAgo: [1] });
    writeFiles(join(root, 'child'), { 'a.txt': 'x' });
    const r = await scanProject(join(root, 'child'), 'child', NOW);
    expect(r.isGit).toBe(false);
  });
});

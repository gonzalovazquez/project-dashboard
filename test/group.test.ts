import { describe, expect, it } from 'vitest';
import { mergeGroups } from '../src/main/app/group.js';
import { board, calls, expectFail, harness, scanned } from './harness.js';
import { daysAgo, NOW, project } from './helpers.js';

const week = (n: number) => [...new Array(11).fill(0), n];
const mk = (name: string, over: Record<string, unknown> = {}) => project({ name, ...over });

describe('mergeGroups', () => {
  const ui = mk('TabSaver', { weekly: week(2), daily: new Array(84).fill(0).map((_, i) => (i === 83 ? 2 : 0)), tech: ['TypeScript', 'React'], github: 'https://github.com/x/TabSaver', complexity: { score: 49, level: 'Medium', parts: [] }, lastCommit: daysAgo(5).toISOString(), pulse: { score: 1, level: 'Cooling', lastActivityDays: 5 }, recentCommits: [{ date: daysAgo(5).toISOString(), message: 'ui' }], languages: [{ name: 'TypeScript', share: 100 }] });
  const api = mk('TabSaverAPI', { weekly: week(3), daily: new Array(84).fill(0).map((_, i) => (i === 82 ? 3 : 0)), tech: ['Node', 'TypeScript'], dirty: true, complexity: { score: 61, level: 'High', parts: [] }, lastCommit: daysAgo(1).toISOString(), pulse: { score: 2, level: 'Warm', lastActivityDays: 1 }, recentCommits: [{ date: daysAgo(1).toISOString(), message: 'api' }], languages: [{ name: 'TypeScript', share: 80 }, { name: 'Other', share: 20 }] });
  const infra = mk('TabSaverInfra', { weekly: week(1), tech: ['Terraform'], isGit: false, pulse: { score: 0, level: 'Dormant', lastActivityDays: null } });
  const other = mk('other');
  const groups = { TabSaver: ['TabSaverAPI', 'TabSaverInfra'] };

  it('folds members into the primary and removes them from the list', () => {
    const out = mergeGroups([ui, api, infra, other], groups, NOW);
    expect(out.map((s) => s.name)).toEqual(['TabSaver', 'other']);
    const m = out[0];
    expect(m.members).toEqual(['TabSaverAPI', 'TabSaverInfra']);
    expect(m.path).toBe(ui.path);
    expect(m.weekly.at(-1)).toBe(6);
    expect(m.daily.at(-1)).toBe(2);
    expect(m.daily.at(-2)).toBe(3);
    expect(m.dirty).toBe(true);
    expect(m.isGit).toBe(true);
    expect(m.tech).toEqual(['TypeScript', 'React', 'Node', 'Terraform']);
    expect(m.complexity.score).toBe(61);
    expect(m.pulse.lastActivityDays).toBe(1);
    expect(m.recentCommits.map((c) => c.message)).toEqual(['api', 'ui']);
    expect(m.github).toBe('https://github.com/x/TabSaver');
    expect(m.pulse.level).not.toBe('Dormant');
  });
  it('averages languages across the folders', () => {
    const m = mergeGroups([ui, api], { TabSaver: ['TabSaverAPI'] }, NOW)[0];
    expect(m.languages).toEqual([{ name: 'TypeScript', share: 90 }, { name: 'Other', share: 10 }]);
  });
  it('leaves everything alone with no groups, missing primaries or missing members', () => {
    expect(mergeGroups([ui, api], {}, NOW)).toEqual([ui, api]);
    expect(mergeGroups([api], { TabSaver: ['TabSaverAPI'] }, NOW)).toEqual([api]);
    expect(mergeGroups([ui], { TabSaver: ['gone'] }, NOW)).toEqual([ui]);
  });
  it('lets a folder join only one group and never lets a primary be a member', () => {
    const b = mk('B');
    const out = mergeGroups([ui, api, b], { TabSaver: ['TabSaverAPI', 'B'], B: ['TabSaverAPI'] }, NOW);
    expect(out.map((s) => s.name)).toEqual(['TabSaver', 'B']); // B stays its own project: a primary cannot be a member
    expect(out[0].members).toEqual(['TabSaverAPI']);
  });
  it('does not change its input', () => {
    const before = JSON.stringify([ui, api]);
    mergeGroups([ui, api], { TabSaver: ['TabSaverAPI'] }, NOW);
    expect(JSON.stringify([ui, api])).toBe(before);
  });
});

describe('grouping through the service', () => {
  it('groups an untracked folder into a tracked project, and the next scan keeps it that way', async () => {
    const h = await scanned();
    expect((await h.svc.groupFolder('loose', 'alpha')).ok).toBe(true);
    const snap = await h.svc.getSnapshot();
    expect(snap.projects.map((p) => p.name)).not.toContain('loose');
    expect(snap.projects.find((p) => p.name === 'alpha')).toMatchObject({ members: ['loose'] });
    expect(snap.projects.find((p) => p.name === 'alpha')!.notion?.pageId).toBe('pa');
    expect(snap.settings.groups).toEqual({ alpha: ['loose'] });
    await h.svc.startScan();
    expect((await h.svc.getSnapshot()).projects.map((p) => p.name)).not.toContain('loose');
    expect(calls(h)).toEqual([]);
  });
  it('splits a folder back out', async () => {
    const h = await scanned();
    await h.svc.groupFolder('loose', 'alpha');
    expect((await h.svc.ungroupFolder('loose')).ok).toBe(true);
    const snap = await h.svc.getSnapshot();
    expect(snap.projects.map((p) => p.name)).toContain('loose');
    expect(snap.projects.find((p) => p.name === 'alpha')!.members).toBeUndefined();
    expect(snap.settings.groups).toEqual({});
  });
  it('refuses nonsense', async () => {
    const h = await scanned();
    expectFail(await h.svc.groupFolder('nope', 'alpha'), 'not-found');
    expectFail(await h.svc.groupFolder('loose', 'nope'), 'not-found');
    expectFail(await h.svc.groupFolder('loose', 'loose'), 'invalid');
    expectFail(await h.svc.groupFolder('beta', 'alpha'), 'not-eligible'); // already in Notion
    expectFail(await h.svc.ungroupFolder('loose'), 'not-found');
  });
  it('is blocked while scanning', async () => {
    let release!: () => void;
    const h = await harness({ ...board(), scanDelay: new Promise<void>((r) => { release = r; }) });
    const scan = h.svc.startScan();
    expectFail(await h.svc.groupFolder('loose', 'alpha'), 'busy');
    release();
    await scan;
  });
  it('refreshes the whole group when a member changes', async () => {
    const h = await scanned();
    await h.svc.groupFolder('loose', 'alpha');
    expect(await h.svc.refreshProject('loose')).toBe(true);
    await h.svc.startScan();
    expect(await h.svc.refreshProject('alpha')).toBe(true);
  });
});

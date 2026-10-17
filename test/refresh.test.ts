import { describe, expect, it } from 'vitest';
import { board, calls, harness, scanned } from './harness.js';
import { project } from './helpers.js';

describe('refreshProject', () => {
  it('re-reads one folder and keeps its Notion data', async () => {
    const fresh = project({ name: 'alpha', dirty: true, weekly: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9] });
    const h = await scanned({ fresh: { alpha: fresh } });
    expect(await h.svc.refreshProject('alpha')).toBe(true);
    const a = (await h.svc.getSnapshot()).projects.find((p) => p.name === 'alpha')!;
    expect(a).toMatchObject({ dirty: true });
    expect(a.weekly.at(-1)).toBe(9);
    expect(a.notion).toMatchObject({ pageId: 'pa', focus: true, nextAction: 'Ship it' });
    expect(h.updates.at(-1)).toMatchObject({ kind: 'project' });
    expect(calls(h)).toEqual([]);
  });
  it('ignores unknown folders, folders that vanished, and scans in progress', async () => {
    const h = await scanned({ fresh: {} });
    expect(await h.svc.refreshProject('nope')).toBe(false);
    expect(await h.svc.refreshProject('alpha')).toBe(false); // scanning it failed
    let release!: () => void;
    const busy = await harness({ ...board(), fresh: { alpha: project({ name: 'alpha' }) }, scanDelay: new Promise<void>((r) => { release = r; }) });
    const scan = busy.svc.startScan();
    expect(await busy.svc.refreshProject('alpha')).toBe(false);
    release();
    await scan;
  });
});

describe('chooseFolder', () => {
  it('returns the chosen path or null when cancelled', async () => {
    expect(await (await harness({ picked: '/Users/g/Code' })).svc.chooseFolder()).toEqual({ ok: true, value: '/Users/g/Code' });
    expect(await (await harness({ picked: null })).svc.chooseFolder()).toEqual({ ok: true, value: null });
  });
});

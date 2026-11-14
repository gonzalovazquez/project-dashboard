import { describe, expect, it } from 'vitest';
import { reopen } from '../src/shared/rules.js';
import { applyUpdate } from '../src/renderer/src/state.js';
import { actionsFor } from '../src/renderer/src/viewmodel/library.js';
import { sidebarModel } from '../src/renderer/src/viewmodel/portfolio.js';
import { loadSnapshot } from '../src/main/notion/stage.js';
import type { Snapshot } from '../src/shared/ipc.js';
import { calls, expectFail, scanned } from './harness.js';
import { NOW, project } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const prop = (h: Awaited<ReturnType<typeof scanned>>, id: string) => h.fake.pages.find((p: any) => p.id === id).properties;
const focusNames = (s: Snapshot) => sidebarModel(s.projects, NOW).focus.map((f) => f.name);

/** Keeps a renderer-side snapshot in step with the service, the way App does. */
async function live(h: Awaited<ReturnType<typeof scanned>>) {
  const box = { snap: await h.svc.getSnapshot() };
  h.svc.onUpdate((u) => { box.snap = applyUpdate(box.snap, u)!; });
  return box;
}

describe('reopen rule', () => {
  const shipped = (name: string, focus = false) => project({ name }, { stage: 'General Available', focus });
  const inFocus = (name: string) => project({ name }, { stage: 'Beta', focus: true });

  it('moves a shipped project back to In progress with today as the stage date', () => {
    const r = reopen([shipped('a')], 'a', NOW);
    expect(r.ok && r.projects[0].notion).toMatchObject({ stage: 'In progress', focus: false, stageChangedAt: NOW.toISOString().slice(0, 10) });
  });
  it('can put it straight into focus when a slot is free', () => {
    const r = reopen([shipped('a'), inFocus('b')], 'a', NOW, true);
    expect(r.ok && r.projects[0].notion!.focus).toBe(true);
  });
  it('refuses focus when every slot is taken, and anything that is not shipped', () => {
    expect(reopen([shipped('a'), inFocus('b'), inFocus('c'), inFocus('d')], 'a', NOW, true)).toMatchObject({ ok: false, error: 'full' });
    expect(reopen([inFocus('b')], 'b', NOW)).toMatchObject({ ok: false, error: 'not-eligible' });
    expect(reopen([project({ name: 'k' }, { stage: 'General Available', life: 'killed' })], 'k', NOW)).toMatchObject({ ok: false, error: 'not-eligible' });
  });
  it('is offered only for shipped projects', () => {
    expect(actionsFor([shipped('a')], 'a')).toMatchObject({ reopen: true, promote: 'no' });
    expect(actionsFor([inFocus('b')], 'b').reopen).toBe(false);
  });
});

describe('reopening through the service', () => {
  it('writes the stage and focus to Notion, and the project shows in focus again', async () => {
    const h = await scanned();
    const box = await live(h);
    // Free a slot and ship alpha the way a person would.
    expect((await h.svc.park('gamma', 'later', '2026-12-01')).ok).toBe(true);
    await h.svc.setCriterion('alpha', 'a2', true);
    expect((await h.svc.markShipped('alpha')).ok).toBe(true);
    expect(focusNames(box.snap)).toEqual(['beta']);
    h.fake.calls.length = 0;

    expect((await h.svc.reopen('alpha', true)).ok).toBe(true);
    expect(calls(h, 'pages.update')).toEqual([{ op: 'pages.update', args: { page_id: 'pa', properties: {
      // Shipped and reopened on the same day, so the stage date does not change.
      Focus: { checkbox: true }, Status: { status: { name: 'In progress' } },
    } } }]);
    expect(focusNames(box.snap)).toEqual(['alpha', 'beta']);
    expect((await loadSnapshot(h.stagePath)).pa.stage).toBe('In progress');
  });

  it('explains why it cannot reopen', async () => {
    const h = await scanned();
    expectFail(await h.svc.reopen('beta', false), 'not-eligible');
    expect(calls(h)).toEqual([]);
  });
});

describe('syncing Notion without a scan', () => {
  it('picks up a project parked in Notion and one put into focus there', async () => {
    const h = await scanned();
    const box = await live(h);
    expect(focusNames(box.snap)).toEqual(['alpha', 'beta', 'gamma']);
    prop(h, 'pb').Focus = { checkbox: false };
    prop(h, 'pb').Lifecycle = { select: { name: 'Parked' } };
    prop(h, 'pd').Focus = { checkbox: true };

    await h.svc.syncNotion();
    expect(focusNames(box.snap)).toEqual(['alpha', 'gamma', 'delta']);
    expect(h.updates.map((u) => u.kind)).toEqual(['synced']);
    expect(h.saved.at(-1)!.projects.find((p) => p.name === 'beta')!.notion!.life).toBe('parked');
  });

  it('keeps the folder data and does not rescan', async () => {
    const h = await scanned();
    const before = (await h.svc.getSnapshot()).projects.find((p) => p.name === 'alpha')!;
    await h.svc.syncNotion();
    const after = (await h.svc.getSnapshot()).projects.find((p) => p.name === 'alpha')!;
    expect({ ...after, notion: undefined }).toEqual({ ...before, notion: undefined });
    expect(h.updates.some((u) => u.kind === 'scan-started')).toBe(false);
  });

  it('keeps what the app just wrote when Notion still returns the old values', async () => {
    const h = await scanned();
    const box = await live(h);
    // The fake records writes but its query keeps returning the old properties, like Notion right after a write.
    expect((await h.svc.park('beta', 'blocked', '2026-12-01')).ok).toBe(true);
    await h.svc.syncNotion();
    expect(focusNames(box.snap)).toEqual(['alpha', 'gamma']);
    expect(box.snap.projects.find((p) => p.name === 'beta')!.notion).toMatchObject({ life: 'parked', parkReason: 'blocked', revisitOn: '2026-12-01' });
  });

  it('reports Notion as unreachable and keeps the last known data', async () => {
    const h = await scanned();
    h.fake.failNext('query', 'offline');
    await h.svc.syncNotion();
    const s = await h.svc.getSnapshot();
    expect(s.notion.state).toBe('error');
    expect(s.projects.filter((p) => p.notion?.focus)).toHaveLength(3);
  });

  it('does nothing without a token', async () => {
    const h = await scanned({ token: null });
    await h.svc.syncNotion();
    expect(h.updates).toEqual([]);
  });

  it('is ignored by the interface while a scan is running', () => {
    const prev = { projects: [], scanning: true } as unknown as Snapshot;
    const next = { projects: [project({ name: 'x' })], scanning: false } as unknown as Snapshot;
    expect(applyUpdate(prev, { kind: 'synced', snapshot: next })).toBe(prev);
    expect(applyUpdate({ ...prev, scanning: false }, { kind: 'synced', snapshot: next })).toBe(next);
  });
});

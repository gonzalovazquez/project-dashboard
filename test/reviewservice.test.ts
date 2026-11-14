/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { board, calls, expectFail, harness, scanned } from './harness.js';
import { NOW } from './helpers.js';

const find = async (h: Awaited<ReturnType<typeof scanned>>, name: string) => (await h.svc.getSnapshot()).projects.find((p) => p.name === name)!.notion!;
const text = (c: { args: any }) => c.args.children[0].paragraph.rich_text[0].text.content as string;

describe('applyReview', () => {
  const plan = { decisions: [
    { name: 'beta', action: 'park', reason: 'Blocked', revisitOn: '2026-11-20' },
    { name: 'delta', action: 'focus', addCriterion: 'Write the two criteria' },
    { name: 'alpha', action: 'keep', addCriterion: 'Deploy it (2h)' },
  ] } as const;
  const isTodo = (c: { args: any }) => c.args.children.some((b: any) => b.type === 'to_do');
  const isNote = (c: { args: any }) => c.args.children[0].type === 'paragraph';

  it('parks, promotes and adds criteria together, then leaves a dated note on each page', async () => {
    const h = await scanned();
    const before = (await find(h, 'alpha')).criteria.length;
    const r = await h.svc.applyReview(plan as any);
    expect(r).toEqual({ ok: true, value: { changed: 2, criteriaAdded: 2, notesWritten: 3, notesFailed: [] } });
    expect(await find(h, 'beta')).toMatchObject({ life: 'parked', focus: false, parkReason: 'Blocked' });
    expect(await find(h, 'delta')).toMatchObject({ focus: true });
    expect((await find(h, 'delta')).criteria.at(-1)).toMatchObject({ title: 'Write the two criteria', done: false });
    const alpha = (await find(h, 'alpha')).criteria;
    expect(alpha).toHaveLength(before + 1);
    expect(alpha.at(-1)).toMatchObject({ title: 'Deploy it', hours: 2, done: false });
    // Criteria go in before any property is written.
    expect(h.fake.calls.findIndex((c) => c.op === 'blocks.append')).toBeLessThan(h.fake.calls.findIndex((c) => c.op === 'pages.update'));
    const todos = calls(h, 'blocks.append').filter(isTodo);
    expect(todos.map((n) => (n.args as any).block_id)).toEqual(['pd', 'pa']);
    const notes = calls(h, 'blocks.append').filter(isNote);
    expect(notes.map((n) => (n.args as any).block_id)).toEqual(['pb', 'pd', 'pa']);
    expect(notes.map(text)).toEqual([
      'Weekly review 2026-10-12: Parked until 2026-11-20. Reason: Blocked',
      'Weekly review 2026-10-12: Moved into focus. Added criterion: Write the two criteria',
      'Weekly review 2026-10-12: Kept. Added criterion: Deploy it (2h)',
    ]);
    expect(h.settings().lastReviewAt).toBe(NOW.toISOString());
    expect((await h.svc.getSnapshot()).settings.lastReviewAt).toBe(NOW.toISOString());
  });

  it('writes nothing and does not count as done when a rule rejects the plan', async () => {
    const h = await scanned();
    expectFail(await h.svc.applyReview({ decisions: [{ name: 'delta', action: 'focus' }] }), 'full');
    expectFail(await h.svc.applyReview({ decisions: [{ name: 'loose', action: 'keep' }] }), 'not-eligible');
    expect(calls(h)).toEqual([]);
    expect(h.settings().lastReviewAt).toBeUndefined();
  });

  it('undoes earlier Notion writes and removes added criteria when a property write fails, and writes no notes', async () => {
    const h = await scanned();
    const before = (await find(h, 'alpha')).criteria;
    // The first property write succeeds; the second fails.
    const original = h.fake.api.pages.update;
    let n = 0;
    h.fake.api.pages.update = async (a) => { if (++n === 2) throw new Error('conflict'); return original(a); };
    expectFail(await h.svc.applyReview(plan as any), 'notion-write-failed');
    const writes = calls(h, 'pages.update').map((c) => (c.args as any).page_id);
    expect(writes).toEqual(['pb', 'pb']); // beta's park, then its undo when delta's write fails
    const added = calls(h, 'blocks.append');
    expect(added.every(isTodo)).toBe(true);
    expect(calls(h, 'blocks.delete').map((c) => (c.args as any).block_id)).toHaveLength(added.length);
    expect(h.settings().lastReviewAt).toBeUndefined();
    expect(await find(h, 'beta')).toMatchObject({ life: 'active', focus: true });
    expect(await find(h, 'delta')).toMatchObject({ focus: false });
    expect((await find(h, 'alpha')).criteria).toEqual(before);
  });

  it('changes nothing when a criterion cannot be added, removing any added before it', async () => {
    const h = await scanned();
    const original = h.fake.api.blocks.children.append;
    let n = 0;
    h.fake.api.blocks.children.append = async (a) => { if (++n === 2) throw new Error('rate limited'); return original(a); };
    const r = await h.svc.applyReview(plan as any);
    expectFail(r, 'notion-write-failed');
    expect(!r.ok && r.error.message).toMatch(/Criteria already added were removed/);
    expect(calls(h, 'blocks.delete')).toHaveLength(1);
    expect(calls(h, 'pages.update')).toEqual([]);
    expect(await find(h, 'beta')).toMatchObject({ life: 'active' });
    expect(h.settings().lastReviewAt).toBeUndefined();
  });

  it('keeps the review when a note fails and names the page', async () => {
    const h = await scanned();
    h.fake.failNext('blocks.append', 'rate limited');
    const notesOnly = { decisions: plan.decisions.map((d) => ({ ...d, addCriterion: undefined })) };
    const r = await h.svc.applyReview(notesOnly as any);
    expect(r).toMatchObject({ ok: true, value: { notesWritten: 2, notesFailed: ['beta'] } });
    expect((await find(h, 'beta')).life).toBe('parked');
    expect(h.settings().lastReviewAt).toBe(NOW.toISOString());
  });

  it('records an empty review as done without touching Notion', async () => {
    const h = await scanned();
    expect(await h.svc.applyReview({ decisions: [] })).toEqual({ ok: true, value: { changed: 0, criteriaAdded: 0, notesWritten: 0, notesFailed: [] } });
    expect(calls(h)).toEqual([]);
    expect(h.settings().lastReviewAt).toBe(NOW.toISOString());
  });

  it('is blocked while scanning and when the schema is missing', async () => {
    let release!: () => void;
    const busy = await harness({ ...board(), scanDelay: new Promise<void>((r) => { release = r; }) });
    const scan = busy.svc.startScan();
    expectFail(await busy.svc.applyReview(plan as any), 'busy');
    release();
    await scan;
    const h = await harness({ ...board(), schema: 'live' });
    await h.svc.startScan();
    expectFail(await h.svc.applyReview(plan as any), 'schema-missing');
    expect(calls(h)).toEqual([]);
  });

  it('needs a token', async () => {
    const h = await scanned();
    h.setToken(undefined);
    expectFail(await h.svc.applyReview(plan as any), 'no-notion');
  });
});

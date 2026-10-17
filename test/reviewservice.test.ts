/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { board, calls, expectFail, harness, scanned } from './harness.js';
import { NOW } from './helpers.js';

const find = async (h: Awaited<ReturnType<typeof scanned>>, name: string) => (await h.svc.getSnapshot()).projects.find((p) => p.name === name)!.notion!;
const text = (c: { args: any }) => c.args.children[0].paragraph.rich_text[0].text.content as string;

describe('applyReview', () => {
  const plan = { decisions: [
    { name: 'beta', action: 'park', reason: 'Blocked', revisitOn: '2026-11-20' },
    { name: 'delta', action: 'focus', nextAction: 'Write the two criteria' },
    { name: 'alpha', action: 'keep', nextAction: 'Deploy it' },
  ] } as const;

  it('parks, promotes and sets next actions together, then leaves a dated note on each page', async () => {
    const h = await scanned();
    const r = await h.svc.applyReview(plan as any);
    expect(r).toEqual({ ok: true, value: { changed: 3, notesWritten: 3, notesFailed: [] } });
    expect(await find(h, 'beta')).toMatchObject({ life: 'parked', focus: false, parkReason: 'Blocked' });
    expect(await find(h, 'delta')).toMatchObject({ focus: true, nextAction: 'Write the two criteria' });
    expect(await find(h, 'alpha')).toMatchObject({ nextAction: 'Deploy it' });
    const notes = calls(h, 'blocks.append');
    expect(notes.map((n) => (n.args as any).block_id)).toEqual(['pb', 'pd', 'pa']);
    expect(notes.map(text)).toEqual([
      'Weekly review 2026-10-12: Parked until 2026-11-20. Reason: Blocked',
      'Weekly review 2026-10-12: Moved into focus. Next action: Write the two criteria',
      'Weekly review 2026-10-12: Kept. Next action: Deploy it',
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

  it('undoes earlier Notion writes when a later one fails, and writes no notes', async () => {
    const h = await scanned();
    // The first write in the plan succeeds; the second fails.
    const original = h.fake.api.pages.update;
    let n = 0;
    h.fake.api.pages.update = async (a) => { if (++n === 2) throw new Error('conflict'); return original(a); };
    expectFail(await h.svc.applyReview(plan as any), 'notion-write-failed');
    const writes = calls(h, 'pages.update').map((c) => (c.args as any).page_id);
    expect(writes).toEqual(['pa', 'pa']); // alpha's next action, then its undo when beta's write fails
    expect(calls(h, 'blocks.append')).toEqual([]);
    expect(h.settings().lastReviewAt).toBeUndefined();
    expect(await find(h, 'beta')).toMatchObject({ life: 'active', focus: true });
    expect(await find(h, 'delta')).toMatchObject({ focus: false });
    expect((await find(h, 'alpha')).nextAction).toBe('Ship it');
    expect((calls(h, 'pages.update')[1].args as any).properties['Next action'].rich_text[0].text.content).toBe('Ship it');
  });

  it('keeps the review when a note fails and names the page', async () => {
    const h = await scanned();
    h.fake.failNext('blocks.append', 'rate limited');
    const r = await h.svc.applyReview(plan as any);
    expect(r).toMatchObject({ ok: true, value: { notesWritten: 2, notesFailed: ['beta'] } });
    expect((await find(h, 'beta')).life).toBe('parked');
    expect(h.settings().lastReviewAt).toBe(NOW.toISOString());
  });

  it('records an empty review as done without touching Notion', async () => {
    const h = await scanned();
    expect(await h.svc.applyReview({ decisions: [] })).toEqual({ ok: true, value: { changed: 0, notesWritten: 0, notesFailed: [] } });
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
  });

  it('needs a token', async () => {
    const h = await scanned();
    h.setToken(undefined);
    expectFail(await h.svc.applyReview(plan as any), 'no-notion');
  });
});

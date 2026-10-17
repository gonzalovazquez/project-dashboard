import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectStageChanges, loadSnapshot, saveSnapshot } from '../src/main/notion/stage.js';
import { NOW, tmp } from './helpers.js';

describe('detectStageChanges', () => {
  it('treats the first sight of a page as a baseline, not a change', () => {
    const r = detectStageChanges({}, [{ pageId: 'a', stage: 'Beta' }], NOW);
    expect(r.changes).toEqual([]);
    expect(r.next).toEqual({ a: { stage: 'Beta', seenAt: NOW.toISOString() } });
  });
  it('reports a changed stage and updates the snapshot', () => {
    const prev = { a: { stage: 'In progress' as const, seenAt: '2026-09-01T00:00:00.000Z' } };
    const r = detectStageChanges(prev, [{ pageId: 'a', stage: 'Beta' }], NOW);
    expect(r.changes).toEqual([{ pageId: 'a', from: 'In progress', to: 'Beta' }]);
    expect(r.next.a).toEqual({ stage: 'Beta', seenAt: NOW.toISOString() });
  });
  it('keeps the original seenAt for an unchanged page', () => {
    const prev = { a: { stage: 'Beta' as const, seenAt: '2026-09-01T00:00:00.000Z' } };
    const r = detectStageChanges(prev, [{ pageId: 'a', stage: 'Beta' }], NOW);
    expect(r.changes).toEqual([]);
    expect(r.next.a.seenAt).toBe('2026-09-01T00:00:00.000Z');
  });
  it('drops pages that no longer exist', () => {
    const prev = { gone: { stage: 'Beta' as const, seenAt: 'x' }, a: { stage: 'Beta' as const, seenAt: 'x' } };
    expect(Object.keys(detectStageChanges(prev, [{ pageId: 'a', stage: 'Beta' }], NOW).next)).toEqual(['a']);
  });
  it('handles several pages in one pass', () => {
    const prev = { a: { stage: 'Beta' as const, seenAt: 'x' }, b: { stage: 'In progress' as const, seenAt: 'x' } };
    const r = detectStageChanges(prev, [{ pageId: 'a', stage: 'General Available' }, { pageId: 'b', stage: 'In progress' }, { pageId: 'c', stage: 'Not started' }], NOW);
    expect(r.changes.map((c) => c.pageId)).toEqual(['a']);
    expect(Object.keys(r.next).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('snapshot storage', () => {
  it('round-trips and creates missing folders', async () => {
    const path = join(tmp(), 'nested', 'stage-snapshot.json');
    const snap = { a: { stage: 'Beta' as const, seenAt: NOW.toISOString() } };
    await saveSnapshot(path, snap);
    expect(await loadSnapshot(path)).toEqual(snap);
  });
  it('returns an empty snapshot when the file is missing or corrupt', async () => {
    const dir = tmp();
    expect(await loadSnapshot(join(dir, 'none.json'))).toEqual({});
    const path = join(dir, 'bad.json');
    await saveSnapshot(path, {});
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, '{oops');
    expect(await loadSnapshot(path)).toEqual({});
  });
  it('leaves no temp files behind', async () => {
    const dir = tmp();
    await saveSnapshot(join(dir, 's.json'), {});
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(dir)).toEqual(['s.json']);
    expect(JSON.parse(await readFile(join(dir, 's.json'), 'utf8'))).toEqual({});
  });
});

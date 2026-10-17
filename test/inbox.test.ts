/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { board, calls, expectFail, harness, scanned } from './harness.js';
import { page } from './fakeNotion.js';

const snapProject = async (h: Awaited<ReturnType<typeof scanned>>, name: string) => (await h.svc.getSnapshot()).projects.find((p) => p.name === name)!;

describe('add to Notion', () => {
  it('creates a page titled with the folder, links it and shows it as Not started', async () => {
    const h = await scanned();
    expect((await h.svc.addToNotion('loose')).ok).toBe(true);
    expect(calls(h, 'pages.create')).toHaveLength(1);
    expect((calls(h, 'pages.create')[0].args as any).properties.Idea.title[0].text.content).toBe('loose');
    expect(h.settings().overrides.loose).toBe('new-page');
    expect((await snapProject(h, 'loose')).notion).toMatchObject({ pageId: 'new-page', stage: 'Not started', focus: false, life: 'active', criteria: [] });
  });
  it('refuses a folder that already has a page, and an unknown folder', async () => {
    const h = await scanned();
    expectFail(await h.svc.addToNotion('alpha'), 'not-eligible');
    expectFail(await h.svc.addToNotion('nope'), 'not-found');
    expect(calls(h)).toEqual([]);
  });
  it('writes nothing locally when Notion fails', async () => {
    const h = await scanned();
    h.fake.failNext('pages.create', 'down');
    expectFail(await h.svc.addToNotion('loose'), 'notion-write-failed');
    expect((await snapProject(h, 'loose')).notion).toBeUndefined();
    expect(h.settings().overrides).toEqual({});
  });
  it('needs a token', async () => {
    const h = await scanned();
    h.setToken(undefined);
    expectFail(await h.svc.addToNotion('loose'), 'no-notion');
  });
  it('is blocked while scanning', async () => {
    let release!: () => void;
    const h = await harness({ ...board(), scanDelay: new Promise<void>((r) => { release = r; }) });
    const scan = h.svc.startScan();
    expectFail(await h.svc.addToNotion('loose'), 'busy');
    release();
    await scan;
  });
});

describe('ignore', () => {
  it('hides and restores a folder', async () => {
    const h = await scanned();
    await h.svc.ignoreFolder('loose', true);
    await h.svc.ignoreFolder('loose', true);
    expect(h.settings().ignored).toEqual(['loose']);
    expect((await h.svc.getSnapshot()).settings.ignored).toEqual(['loose']);
    await h.svc.ignoreFolder('loose', false);
    expect(h.settings().ignored).toEqual([]);
    expectFail(await h.svc.ignoreFolder('nope', true), 'not-found');
  });
});

describe('link to an existing page', () => {
  const withSpare = () => { const b = board(); return { ...b, pages: [...b.pages, page('px', 'Garden Planner', 'In progress')] }; };
  it('offers pages no folder matched', async () => {
    const h = await scanned(withSpare());
    expect((await h.svc.getSnapshot()).unlinkedPages).toEqual([{ id: 'px', title: 'Garden Planner', url: 'https://notion.so/px', stage: 'In progress' }]);
  });
  it('pairs the folder with the page and remembers it', async () => {
    const h = await scanned(withSpare());
    expect((await h.svc.linkFolder('loose', 'px')).ok).toBe(true);
    expect((await snapProject(h, 'loose')).notion?.pageId).toBe('px');
    expect(h.settings().overrides.loose).toBe('px');
    expect((await h.svc.getSnapshot()).unlinkedPages).toEqual([]);
    expect(calls(h)).toEqual([]);
  });
  it('survives the next scan', async () => {
    const h = await scanned(withSpare());
    await h.svc.linkFolder('loose', 'px');
    await h.svc.startScan();
    expect((await snapProject(h, 'loose')).notion?.title).toBe('Garden Planner');
  });
  it('refuses unknown pages, taken folders and unknown folders', async () => {
    const h = await scanned(withSpare());
    expectFail(await h.svc.linkFolder('loose', 'zzz'), 'not-found');
    expectFail(await h.svc.linkFolder('alpha', 'px'), 'not-eligible');
    expectFail(await h.svc.linkFolder('nope', 'px'), 'not-found');
  });
});

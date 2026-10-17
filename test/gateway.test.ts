import { describe, expect, it } from 'vitest';
import { buildPropertyUpdate, createGateway } from '../src/main/notion/gateway.js';
import { makeFakeNotion, page, todo } from './fakeNotion.js';

describe('buildPropertyUpdate', () => {
  it('includes only the fields that were given', () => {
    expect(buildPropertyUpdate({})).toEqual({});
    expect(buildPropertyUpdate({ focus: true })).toEqual({ Focus: { checkbox: true } });
  });
  it('maps every field to the right Notion shape', () => {
    expect(buildPropertyUpdate({
      stage: 'Beta', focus: false, life: 'parked', nextAction: 'Fix it', stageChangedAt: '2026-10-12', parkReason: 'blocked', revisitOn: '2026-11-12',
    })).toEqual({
      Status: { status: { name: 'Beta' } },
      Focus: { checkbox: false },
      Lifecycle: { select: { name: 'Parked' } },
      'Next action': { rich_text: [{ type: 'text', text: { content: 'Fix it' } }] },
      'Stage changed': { date: { start: '2026-10-12' } },
      'Park reason': { rich_text: [{ type: 'text', text: { content: 'blocked' } }] },
      'Revisit on': { date: { start: '2026-11-12' } },
    });
  });
  it('clears text and dates with null', () => {
    expect(buildPropertyUpdate({ nextAction: null, parkReason: '', revisitOn: null, stageChangedAt: null })).toEqual({
      'Next action': { rich_text: [] }, 'Park reason': { rich_text: [] }, 'Revisit on': { date: null }, 'Stage changed': { date: null },
    });
  });
});

describe('gateway reads', () => {
  it('follows pagination when listing pages', async () => {
    const n = makeFakeNotion(2);
    n.pages = ['a', 'b', 'c', 'd', 'e'].map((id) => page(id, id.toUpperCase(), 'Beta'));
    const pages = await createGateway(n.api).listPages();
    expect(pages.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(n.queries).toBe(3);
  });
  it('follows pagination when reading blocks', async () => {
    const n = makeFakeNotion(2);
    n.blocks.a = [todo('b1', 'one'), todo('b2', 'two', true), todo('b3', 'three (4h)')];
    const blocks = await createGateway(n.api).getBlocks('a');
    expect(blocks.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
  });
  it('loads each page with its parsed criteria, keeping block ids', async () => {
    const n = makeFakeNotion(2);
    n.pages = [page('a', 'Buddy Recomp', 'Beta', { Focus: { checkbox: true } }), page('b', 'Odd', 'Someday')];
    n.blocks.a = [todo('b1', 'Core flow', true), todo('b2', 'Deploy (3h)')];
    n.blocks.b = [];
    const loaded = await createGateway(n.api).loadProjects();
    expect(loaded).toHaveLength(2);
    expect(loaded[0].info).toMatchObject({ title: 'Buddy Recomp', stage: 'Beta', focus: true });
    expect(loaded[0].info!.criteria).toEqual([
      { blockId: 'b1', title: 'Core flow', hours: undefined, done: true, doneOn: '2026-10-01T00:00:00Z' },
      { blockId: 'b2', title: 'Deploy', hours: 3, done: false, doneOn: undefined },
    ]);
    expect(loaded[1].info).toBeUndefined();
  });
  it('propagates API errors instead of returning partial data', async () => {
    const n = makeFakeNotion(2);
    n.pages = [page('a', 'A', 'Beta'), page('b', 'B', 'Beta'), page('c', 'C', 'Beta')];
    n.failNext('query', 'rate limited');
    await expect(createGateway(n.api).listPages()).rejects.toThrow('rate limited');
  });
});

describe('gateway writes', () => {
  it('updates properties on the right page', async () => {
    const n = makeFakeNotion();
    await createGateway(n.api).setProperties('p1', { focus: true, nextAction: 'Ship' });
    expect(n.calls).toEqual([{ op: 'pages.update', args: { page_id: 'p1', properties: { Focus: { checkbox: true }, 'Next action': { rich_text: [{ type: 'text', text: { content: 'Ship' } }] } } } }]);
  });
  it('skips the API call when there is nothing to change', async () => {
    const n = makeFakeNotion();
    await createGateway(n.api).setProperties('p1', {});
    expect(n.calls).toEqual([]);
  });
  it('checks and unchecks a to-do block', async () => {
    const n = makeFakeNotion();
    const g = createGateway(n.api);
    await g.setCriterionChecked('b1', true);
    await g.setCriterionChecked('b1', false);
    expect(n.calls.map((c) => c.args)).toEqual([{ block_id: 'b1', to_do: { checked: true } }, { block_id: 'b1', to_do: { checked: false } }]);
  });
  it('creates a page under the data source with Not started by default', async () => {
    const n = makeFakeNotion();
    const r = await createGateway(n.api, 'ds-1').createPage('fet-tracker');
    expect(r).toEqual({ pageId: 'new-page', url: 'https://notion.so/new-page' });
    expect(n.calls[0].args).toEqual({
      parent: { type: 'data_source_id', data_source_id: 'ds-1' },
      properties: { Idea: { title: [{ type: 'text', text: { content: 'fet-tracker' } }] }, Status: { status: { name: 'Not started' } } },
    });
  });
  it('surfaces write failures to the caller', async () => {
    const n = makeFakeNotion();
    n.failNext('pages.update', 'conflict');
    await expect(createGateway(n.api).setProperties('p1', { focus: true })).rejects.toThrow('conflict');
  });
});

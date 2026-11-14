import { describe, expect, it } from 'vitest';
import { claudeNewChatUrl, IDEA_MAX, ideaRow, newProjectPrompt, planningModel } from '../src/shared/planning.js';
import type { NotionInfo } from '../src/shared/types.js';
import { board, expectFail, scanned } from './harness.js';
import { heading, page, todo } from './fakeNotion.js';

const info = (over: Partial<NotionInfo> = {}): NotionInfo => ({ pageId: 'p', url: 'https://notion.so/p', title: 'Idea', stage: 'Not started', criteria: [], focus: false, life: 'active', ...over });

describe('the new project prompt', () => {
  it('asks for both skills and the Planning section, with the idea trimmed at the end', () => {
    const p = newProjectPrompt('  A garden planner  ');
    expect(p).toMatch(/brainstorm-plan skill/);
    expect(p).toMatch(/build-budget skill/);
    expect(p).toMatch(/Planning section/);
    expect(p.endsWith('The idea: A garden planner')).toBe(true);
  });
  it('opens a new claude.ai chat with the prompt typed in, safely encoded', () => {
    const url = claudeNewChatUrl('a & b?\nc');
    expect(url.startsWith('https://claude.ai/new?q=')).toBe(true);
    expect(decodeURIComponent(new URL(url).searchParams.get('q')!)).toBe('a & b?\nc');
  });
});

describe('idea rows', () => {
  it('count criteria and name the first open one', () => {
    const r = ideaRow('p', info({ criteria: [{ title: 'A', done: true }, { title: 'B', done: false }, { title: 'C', done: false }] }));
    expect(r).toMatchObject({ id: 'p', title: 'Idea', done: 1, total: 3, next: 'B' });
  });
  it('split into not-started ideas and started pages, active and unshipped only, by title', () => {
    const rows = [
      ideaRow('1', info({ title: 'Zeta' })), ideaRow('2', info({ title: 'Alpha' })), ideaRow('5', info({ title: 'Beta app', stage: 'Beta' })),
      ideaRow('3', info({ title: 'Parked', life: 'parked' })), ideaRow('4', info({ title: 'Done', stage: 'General Available' })),
    ];
    const m = planningModel(rows);
    expect(m.ideas.map((r) => r.title)).toEqual(['Alpha', 'Zeta']);
    expect(m.started.map((r) => r.title)).toEqual(['Beta app']);
  });
});

describe('service', () => {
  const withIdea = () => {
    const b = board();
    return { ...b, pages: [...b.pages, page('px', 'Garden Planner', 'Not started')], blocks: { ...b.blocks, px: [heading('hx', 'Planning'), todo('x1', 'Sketch the beds')] } };
  };
  it('lists a page with no folder as an idea, with its Planning criteria', async () => {
    const h = await scanned(withIdea());
    expect((await h.svc.getSnapshot()).unlinkedPages).toEqual([{ id: 'px', title: 'Garden Planner', url: 'https://notion.so/px', stage: 'Not started', life: 'active', done: 0, total: 1, next: 'Sketch the beds' }]);
  });
  it('opens an idea in Notion, and refuses an id it does not know', async () => {
    const h = await scanned(withIdea());
    expect((await h.svc.openIdea('px')).ok).toBe(true);
    expect(h.opened).toEqual(['https://notion.so/px']);
    expectFail(await h.svc.openIdea('nope'), 'not-found');
  });
  it('starts a new project by opening Claude with the prompt', async () => {
    const h = await scanned();
    expect((await h.svc.startNewProject('  A garden planner ')).ok).toBe(true);
    expect(h.opened).toEqual([claudeNewChatUrl(newProjectPrompt('A garden planner'))]);
  });
  it('refuses an empty or oversized idea and opens nothing', async () => {
    const h = await scanned();
    expectFail(await h.svc.startNewProject('   '), 'invalid');
    expectFail(await h.svc.startNewProject('x'.repeat(IDEA_MAX + 1)), 'invalid');
    expect(h.opened).toEqual([]);
  });
});

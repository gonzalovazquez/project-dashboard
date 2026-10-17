import { describe, expect, it } from 'vitest';
import { actionsFor, inboxModel, inDays, libraryRows, NO_FILTERS, parkedRows, shippedRows, stateOf, techOptions } from '../src/renderer/src/viewmodel/library.js';
import { sidebarModel } from '../src/renderer/src/viewmodel/portfolio.js';
import { daysAgo, NOW, project } from './helpers.js';

const set = [
  project({ name: 'alpha', tech: ['TypeScript', 'React'], complexity: { score: 70, level: 'High', parts: [] }, pulse: { score: 4, level: 'Hot', lastActivityDays: 1 } }, { title: 'Alpha App', focus: true, stage: 'Beta' }),
  project({ name: 'beta', tech: ['Python'], complexity: { score: 20, level: 'Low', parts: [] }, pulse: { score: 0, level: 'Dormant', lastActivityDays: 90 } }, { life: 'parked', parkReason: 'Blocked on API', revisitOn: '2026-10-20' }),
  project({ name: 'gamma', tech: ['TypeScript'], pulse: { score: 1, level: 'Cooling', lastActivityDays: 20 } }, { stage: 'General Available', stageChangedAt: daysAgo(10).toISOString() }),
  project({ name: 'delta', tech: ['Go'], pulse: { score: 0, level: 'Dormant', lastActivityDays: null } }),
  project({ name: 'epsilon', tech: ['Swift'], pulse: { score: 3, level: 'Warm', lastActivityDays: 2 } }),
  project({ name: 'zeta', tech: [] }, { life: 'killed' }),
  project({ name: 'eta' }, { stage: 'In progress' }),
];

describe('stateOf', () => {
  it('names each state', () => {
    expect(set.map(stateOf)).toEqual(['focus', 'parked', 'shipped', 'untracked', 'untracked', 'killed', 'active']);
  });
});

describe('libraryRows', () => {
  const names = (f = {}, sort?: Parameters<typeof libraryRows>[2]) => libraryRows(set, { ...NO_FILTERS, ...f }, sort).map((r) => r.name);
  it('lists every folder by title with no filters', () => {
    expect(names()).toEqual(['Alpha App', 'beta', 'delta', 'epsilon', 'eta', 'gamma', 'zeta'].map((t) => set.find((p) => (p.notion?.title ?? p.name) === t)!.name));
  });
  it('filters by state, pulse, complexity and technology, and combines them', () => {
    expect(names({ state: 'untracked' })).toEqual(['delta', 'epsilon']);
    expect(names({ pulse: 'Dormant' })).toEqual(['beta', 'delta']);
    expect(names({ complexity: 'High' })).toEqual(['alpha']);
    expect(names({ tech: 'TypeScript' })).toEqual(['alpha', 'gamma']);
    expect(names({ tech: 'TypeScript', state: 'shipped' })).toEqual(['gamma']);
    expect(names({ state: 'killed', tech: 'Go' })).toEqual([]);
  });
  it('searches name, Notion title and technology, ignoring case and spaces at the ends', () => {
    expect(names({ query: '  ALPHA ' })).toEqual(['alpha']);
    expect(names({ query: 'swift' })).toEqual(['epsilon']);
    expect(names({ query: 'zzz' })).toEqual([]);
  });
  it('sorts by recent activity with unknown last', () => {
    expect(names({}, 'activity').slice(0, 3)).toEqual(['alpha', 'epsilon', 'eta']);
    expect(names({}, 'activity').at(-1)).toBe('delta');
  });
  it('sorts by complexity, highest first', () => {
    expect(names({}, 'complexity')[0]).toBe('alpha');
    expect(names({}, 'complexity').at(-1)).toBe('beta');
  });
  it('sorts by stage, furthest along first, untracked last', () => {
    const n = names({}, 'stage');
    expect(n[0]).toBe('gamma');
    expect(n.slice(-2)).toEqual(['delta', 'epsilon']);
  });
  it('lists technologies once, sorted', () => {
    expect(techOptions(set)).toEqual(['Go', 'Python', 'React', 'Swift', 'TypeScript']);
  });
});

describe('inbox', () => {
  it('splits folders without a page into pending and ignored, recent first', () => {
    const m = inboxModel(set, ['delta']);
    expect(m.pending.map((p) => p.name)).toEqual(['epsilon']);
    expect(m.ignored.map((p) => p.name)).toEqual(['delta']);
  });
  it('does not count ignored folders in the sidebar', () => {
    expect(sidebarModel(set, NOW, 3, []).counts.inbox).toBe(2);
    expect(sidebarModel(set, NOW, 3, ['delta']).counts.inbox).toBe(1);
  });
});

describe('parked and shipped', () => {
  it('shows the reason and how long until the revisit date, due ones first', () => {
    const extra = [...set, project({ name: 'late' }, { life: 'parked', revisitOn: '2026-10-01' }), project({ name: 'nodate' }, { life: 'parked' })];
    const rows = parkedRows(extra, NOW);
    expect(rows.map((r) => r.name)).toEqual(['late', 'beta', 'nodate']);
    expect(rows[0]).toMatchObject({ due: true });
    expect(rows[1]).toMatchObject({ reason: 'Blocked on API', due: false, daysUntil: 8 });
    expect(rows[2]).toMatchObject({ reason: 'No reason recorded', due: false, daysUntil: undefined });
  });
  it('lists shipped projects with when they shipped', () => {
    expect(shippedRows(set, NOW)).toEqual([{ name: 'gamma', title: 'gamma', shippedOn: daysAgo(10).toISOString(), criteria: 0, daysAgo: 10 }]);
  });
});

describe('actionsFor', () => {
  const full = ['a', 'b', 'c'].map((n) => project({ name: n }, { focus: true }));
  it('lets an active project take an open slot', () => {
    expect(actionsFor([...full.slice(0, 2), project({ name: 'x' }, {})], 'x')).toMatchObject({ promote: 'ok', park: true, kill: true, unpark: false });
  });
  it('asks for a swap when focus is full and names who could be parked', () => {
    const a = actionsFor([...full, project({ name: 'x' }, {})], 'x');
    expect(a.promote).toBe('swap');
    expect(a.focus.map((f) => f.name)).toEqual(['a', 'b', 'c']);
  });
  it('offers unpark only for parked projects, and nothing for untracked, shipped or killed', () => {
    expect(actionsFor(set, 'beta')).toMatchObject({ promote: 'no', park: false, kill: false, unpark: true });
    for (const n of ['delta', 'gamma', 'zeta']) expect(actionsFor(set, n)).toMatchObject({ promote: 'no', park: false, kill: false, unpark: false });
    expect(actionsFor(set, 'alpha')).toMatchObject({ promote: 'no', park: true, kill: true });
    expect(actionsFor(set, 'missing').promote).toBe('no');
  });
});

describe('inDays', () => {
  it('returns a date input value', () => {
    expect(inDays(new Date(2026, 9, 12, 12), 30)).toBe('2026-11-11');
  });
});

describe('groupSuggestion', () => {
  const ps = [project({ name: 'TabSaver' }), project({ name: 'TabSaverAPI' }), project({ name: 'TabSaverMock' }), project({ name: 'TabSaverMockAPI' }), project({ name: 'app' }), project({ name: 'app-store' }), project({ name: 'other' })];
  it('suggests the folder whose name this one starts with, longest first', async () => {
    const { groupSuggestion } = await import('../src/renderer/src/viewmodel/library.js');
    expect(groupSuggestion('TabSaverAPI', ps)?.name).toBe('TabSaver');
    expect(groupSuggestion('TabSaverMockAPI', ps)?.name).toBe('TabSaverMock'); // the longest name that prefixes it
    expect(groupSuggestion('Tab-Saver-Infra', ps)?.name).toBe('TabSaver');
  });
  it('ignores short names, the folder itself and unrelated folders', async () => {
    const { groupSuggestion } = await import('../src/renderer/src/viewmodel/library.js');
    expect(groupSuggestion('app-store', ps)).toBeUndefined();
    expect(groupSuggestion('TabSaver', ps)).toBeUndefined();
    expect(groupSuggestion('other', ps)).toBeUndefined();
  });
});

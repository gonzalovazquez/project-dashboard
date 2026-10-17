import { describe, expect, it } from 'vitest';
import { applyReview } from '../src/shared/review.js';
import { focusProjects } from '../src/shared/rules.js';
import { buildPlan, candidates, decide, initialDraft, planLines, problems, setNextAction, stalledProjects, toggleFocus, weekInReview, type Draft } from '../src/renderer/src/viewmodel/review.js';
import { daysAgo, NOW, project } from './helpers.js';

const crit = (id: string, done: boolean, doneAgo?: number) => ({ blockId: id, title: id, done, doneOn: doneAgo === undefined ? undefined : daysAgo(doneAgo).toISOString() });
const mk = (name: string, over: Record<string, unknown> = {}, notion: Record<string, unknown> = {}) =>
  project({ name, ...over }, { nextAction: 'go', stageChangedAt: daysAgo(5).toISOString(), ...notion });
const set = () => [
  mk('a', { weekly: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4] }, { focus: true, criteria: [crit('1', true, 2), crit('2', true, 20), crit('3', false)], stageChangedAt: daysAgo(3).toISOString() }),
  mk('b', { pulse: { score: 0, level: 'Dormant', lastActivityDays: 30 } }, { focus: true, stage: 'Beta', stageChangedAt: daysAgo(60).toISOString() }),
  mk('c', {}, { focus: true, nextAction: undefined }),
  mk('d', {}, { criteria: [crit('1', true, 3), crit('2', false)] }),
  mk('e', { pulse: { score: 0, level: 'Dormant', lastActivityDays: 40 } }, {}),
  mk('p', {}, { life: 'parked' }),
];
const next = (t: ReturnType<typeof toggleFocus>): Draft => { if (!('draft' in t)) throw new Error('blocked: ' + t.blocked); return t.draft; };

describe('weekInReview', () => {
  it('counts this week per focus project', () => {
    const w = weekInReview(set(), NOW);
    expect(w.rows.map((r) => [r.name, r.commits, r.criteriaDone, r.stageMoved])).toEqual([['a', 4, 1, 'In progress'], ['b', 0, 0, undefined], ['c', 0, 0, 'In progress']].map((x) => x));
    expect(w).toMatchObject({ commits: 4, criteriaDone: 1, quietFocus: 2 });
  });
});

describe('stalledProjects', () => {
  it('lists live projects that are not moving, focus first, and ignores a missing next action', () => {
    const s = stalledProjects(set(), NOW);
    expect(s.map((x) => x.name)).toEqual(['b', 'e']);
    expect(s[0].reasons.join()).toMatch(/Beta for 60 days/);
    expect(s.find((x) => x.name === 'c')).toBeUndefined();
  });
});

describe('draft', () => {
  it('starts with the current focus and nothing decided', () => {
    expect(initialDraft(set())).toEqual({ decisions: {}, focus: ['a', 'b', 'c'], nextActions: {} });
  });
  it('parking or killing takes a project out of focus; keeping does not', () => {
    const d = initialDraft(set());
    expect(decide(d, 'b', { action: 'kill' }).focus).toEqual(['a', 'c']);
    expect(decide(d, 'b', { action: 'park', reason: 'x', revisitOn: '2026-11-01' }).focus).toEqual(['a', 'c']);
    expect(decide(d, 'b', { action: 'keep' }).focus).toEqual(['a', 'b', 'c']);
    expect(decide(decide(d, 'b', { action: 'kill' }), 'b', undefined).decisions).toEqual({});
  });
  it('refuses a fourth focus project', () => {
    expect(toggleFocus(initialDraft(set()), set(), 'd', NOW)).toMatchObject({ blocked: expect.stringContaining('3 projects') });
  });
  it('removing a current focus project makes it a park decision that still needs a reason', () => {
    const d = next(toggleFocus(initialDraft(set()), set(), 'b', NOW));
    expect(d.focus).toEqual(['a', 'c']);
    expect(d.decisions.b).toMatchObject({ action: 'park', reason: '' });
    expect(problems(set(), d, NOW).join(' ')).toMatch(/Say why b is parked/);
  });
  it('adding a project that was marked for parking clears that decision', () => {
    let d = decide(initialDraft(set()), 'b', { action: 'kill' });
    d = next(toggleFocus(d, set(), 'b', NOW));
    expect(d.focus).toEqual(['a', 'c', 'b']);
    expect(d.decisions.b).toBeUndefined();
  });
  it('does not let a parked or shipped project take focus', () => {
    expect(toggleFocus(decide(initialDraft(set()), 'a', { action: 'kill' }), set(), 'p', NOW)).toHaveProperty('blocked');
  });
});

describe('candidates', () => {
  it('lists focus first, then the rest by how cheap they are to finish, with a hint', () => {
    const c = candidates(set(), NOW);
    expect(c.map((x) => x.name)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(c[3].hint).toMatch(/1 criterion left/);
    expect(c[4].hint).toBe('No ship criteria yet');
  });
});

describe('problems and plan', () => {
  it('blocks until every stalled project has a decision and every focus project has a next action', () => {
    const ps = set();
    const d0 = initialDraft(ps);
    expect(problems(ps, d0, NOW)).toEqual(['Decide what to do with b: in beta for 60 days.', 'Decide what to do with e: gone quiet.', 'c needs a next action.']);
    let d = decide(d0, 'b', { action: 'keep' });
    d = decide(d, 'e', { action: 'kill' });
    d = setNextAction(d, 'c', '  Write tests ');
    expect(problems(ps, d, NOW)).toEqual([]);
  });
  it('counts a stalled project that is put in focus as decided', () => {
    const ps = set();
    let d = decide(initialDraft(ps), 'b', { action: 'kill' });
    expect(problems(ps, d, NOW).join(' ')).toMatch(/Decide what to do with e/);
    d = next(toggleFocus(d, ps, 'e', NOW));
    expect(problems(ps, d, NOW).join(' ')).not.toMatch(/Decide what to do with e/);
  });
  it('still asks about a stalled project that is already in focus and stays there', () => {
    expect(problems(set(), initialDraft(set()), NOW).join(' ')).toMatch(/Decide what to do with b/);
  });
  it('builds a plan the rules accept and that changes only what was decided', () => {
    const ps = set();
    let d = decide(initialDraft(ps), 'b', { action: 'park', reason: 'Stuck', revisitOn: '2026-11-20' });
    d = decide(d, 'e', { action: 'kill' });
    d = next(toggleFocus(d, ps, 'd', NOW));
    d = setNextAction(d, 'c', ' Write tests ');
    d = setNextAction(d, 'a', 'go');
    expect(problems(ps, d, NOW)).toEqual([]);
    const plan = buildPlan(ps, d);
    expect(plan.decisions).toEqual([
      { name: 'b', action: 'park', reason: 'Stuck', revisitOn: '2026-11-20' },
      { name: 'e', action: 'kill' },
      { name: 'a', action: 'keep' },
      { name: 'c', action: 'keep', nextAction: 'Write tests' },
      { name: 'd', action: 'focus' },
    ]);
    const r = applyReview(ps, plan);
    expect(r.ok).toBe(true);
    if (r.ok) expect(focusProjects(r.projects).map((p) => p.name).sort()).toEqual(['a', 'c', 'd']);
  });
  it('describes the plan in plain words', () => {
    const ps = set();
    const d = decide(initialDraft(ps), 'b', { action: 'kill' });
    expect(planLines(ps, buildPlan(ps, d))).toEqual(['Kill b', 'Keep a', 'Keep c']);
  });
});

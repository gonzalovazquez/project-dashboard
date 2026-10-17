import { describe, expect, it } from 'vitest';
import { finishScore, flags, forecast, health, kill, park, progress, promote, queue, velocity } from '../src/shared/rules.js';
import type { Criterion } from '../src/shared/types.js';
import { NOW, daysAgo, project } from './helpers.js';

const crit = (done: number, total: number, doneDaysAgo: number[] = []): Criterion[] =>
  Array.from({ length: total }, (_, i) => ({ title: `c${i}`, hours: 4, done: i < done, doneOn: i < done ? daysAgo(doneDaysAgo[i] ?? 100).toISOString() : undefined }));

describe('progress and forecast', () => {
  it('computes progress and hours left', () => {
    const p = project({ name: 'a' }, { criteria: crit(3, 6) });
    expect(progress(p)).toBe(0.5);
    expect(forecast(p, NOW).hoursLeft).toBe(12);
  });
  it('has no progress without criteria', () => expect(progress(project({ name: 'a' }, { criteria: [] }))).toBeUndefined());
  it('derives velocity from the last 4 weeks and floors it', () => {
    expect(velocity(project({ name: 'a' }, { criteria: crit(4, 6, [1, 5, 10, 20]) }), NOW)).toBe(1);
    expect(velocity(project({ name: 'a' }, { criteria: crit(3, 6, [90, 91, 92]) }), NOW)).toBe(0.25);
  });
  it('forecasts remaining / velocity with a low and high band', () => {
    const p = project({ name: 'a' }, { criteria: crit(4, 6, [1, 5, 10, 20]) });
    const f = forecast(p, NOW);
    expect(f.remaining).toBe(2);
    expect(f.weeks).toBe(2);
    expect(Date.parse(f.date) - NOW.getTime()).toBe(14 * 86_400_000);
    expect(Date.parse(f.low)).toBeLessThan(Date.parse(f.date));
    expect(Date.parse(f.high)).toBeGreaterThan(Date.parse(f.date));
  });
  it('forecasts today when everything is done', () => expect(forecast(project({ name: 'a' }, { criteria: crit(2, 2) }), NOW).weeks).toBe(0));
});

describe('flags', () => {
  const stage = (days: number) => daysAgo(days).toISOString();
  it('flags long Beta stays, missing next action, and quiet focus projects', () => {
    const p = project({ name: 'a', pulse: { score: 1, level: 'Cooling', lastActivityDays: 22 } }, { stage: 'Beta', stageChangedAt: stage(60), focus: true, criteria: crit(1, 3) });
    expect(flags(p, NOW).map((f) => f.code)).toEqual(['stuck-beta', 'no-next', 'no-commits']);
  });
  it('flags non-focus projects as quiet only after 21 days', () => {
    const base = { stage: 'In progress' as const, stageChangedAt: stage(5), nextAction: 'x', criteria: crit(1, 3) };
    expect(flags(project({ name: 'a', pulse: { score: 0, level: 'Warm', lastActivityDays: 20 } }, base), NOW)).toEqual([]);
    expect(flags(project({ name: 'a', pulse: { score: 0, level: 'Cooling', lastActivityDays: 22 } }, base), NOW).map((f) => f.code)).toEqual(['quiet']);
  });
  it('ignores untracked, parked and shipped projects', () => {
    expect(flags(project({ name: 'a' }), NOW)).toEqual([]);
    expect(flags(project({ name: 'a' }, { life: 'parked' }), NOW)).toEqual([]);
    expect(flags(project({ name: 'a' }, { stage: 'General Available' }), NOW)).toEqual([]);
  });
});

describe('ranking and health', () => {
  it('ranks near-done, low-complexity projects first', () => {
    const quick = project({ name: 'quick', complexity: { score: 30, level: 'Medium', parts: [] } }, { criteria: crit(4, 5) });
    const slow = project({ name: 'slow', complexity: { score: 80, level: 'High', parts: [] } }, { criteria: crit(4, 5) });
    const early = project({ name: 'early', complexity: { score: 30, level: 'Medium', parts: [] } }, { criteria: crit(1, 5) });
    expect(finishScore(quick)).toBeGreaterThan(finishScore(slow));
    expect(queue([early, slow, quick]).map((p) => p.name)).toEqual(['quick', 'slow', 'early']);
  });
  it('keeps health within 0..100', () => {
    const best = project({ name: 'a', pulse: { score: 9, level: 'Hot', lastActivityDays: 0 } }, { criteria: crit(5, 5), nextAction: 'x', stageChangedAt: daysAgo(0).toISOString() });
    const worst = project({ name: 'b', pulse: { score: 0, level: 'Dormant', lastActivityDays: 80 } }, { criteria: crit(0, 5), stage: 'Beta', stageChangedAt: daysAgo(200).toISOString(), focus: true });
    expect(health(best, NOW)).toBe(100);
    expect(health(worst, NOW)).toBeGreaterThanOrEqual(0);
    expect(health(worst, NOW)).toBeLessThan(15);
  });
});

describe('focus limit of 3', () => {
  const mk = () => ['a', 'b', 'c', 'd'].map((n, i) => project({ name: n }, { focus: i < 3, criteria: crit(1, 3) }));
  it('promotes into an open slot', () => {
    const ps = mk().map((p) => (p.name === 'c' ? { ...p, notion: { ...p.notion!, focus: false } } : p));
    const r = promote(ps, 'c');
    expect(r.ok).toBe(true);
  });
  it('refuses a fourth focus project without a swap', () => {
    const r = promote(mk(), 'd');
    expect(r).toMatchObject({ ok: false, error: 'full' });
  });
  it('parks the chosen project and promotes the new one', () => {
    const r = promote(mk(), 'd', { parkName: 'a', reason: 'blocked', revisitOn: '2026-11-12' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const by = Object.fromEntries(r.projects.map((p) => [p.name, p.notion!]));
    expect(by.a).toMatchObject({ life: 'parked', focus: false, parkReason: 'blocked', revisitOn: '2026-11-12' });
    expect(by.d.focus).toBe(true);
    expect(r.projects.filter((p) => p.notion!.focus)).toHaveLength(3);
  });
  it('rejects swapping out a project that is not in focus', () => {
    expect(promote(mk(), 'd', { parkName: 'd', reason: 'x' })).toMatchObject({ ok: false, error: 'full' });
  });
  it('rejects untracked, parked and shipped projects', () => {
    const ps = [project({ name: 'u' }), project({ name: 'p' }, { life: 'parked' }), project({ name: 's' }, { stage: 'General Available' })];
    for (const n of ['u', 'p', 's', 'missing']) expect(promote(ps, n)).toMatchObject({ ok: false, error: 'not-eligible' });
  });
  it('does not mutate its input', () => {
    const ps = mk();
    const snapshot = JSON.stringify(ps);
    promote(ps, 'd', { parkName: 'a', reason: 'x' });
    park(ps, 'b', 'x');
    kill(ps, 'c');
    expect(JSON.stringify(ps)).toBe(snapshot);
  });
});

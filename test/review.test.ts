import { describe, expect, it } from 'vitest';
import { applyReview, dueSince, lastScheduled, type ReviewDecision } from '../src/shared/review.js';
import { focusProjects } from '../src/shared/rules.js';
import { project } from './helpers.js';

const mk = (name: string, notion: Record<string, unknown> = {}) => project({ name }, { ...notion });
const board = () => [
  mk('a', { focus: true, nextAction: 'x' }), mk('b', { focus: true }), mk('c', { focus: true }),
  mk('d'), mk('e'), mk('p', { life: 'parked' }), mk('s', { stage: 'General Available' }),
];
const run = (decisions: ReviewDecision[], ps = board()) => applyReview(ps, { decisions });
const names = (ps: ReturnType<typeof board>) => focusProjects(ps).map((p) => p.name).sort();

describe('applyReview', () => {
  it('does nothing for an empty review', () => {
    const r = run([]);
    expect(r.ok && r.projects).toEqual(board());
  });
  it('frees slots from parks and kills before promoting, whatever the order', () => {
    const r = run([{ name: 'd', action: 'focus' }, { name: 'a', action: 'park', reason: ' stuck ', revisitOn: '2026-11-20' }, { name: 'e', action: 'focus' }, { name: 'b', action: 'kill' }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(names(r.projects)).toEqual(['c', 'd', 'e']);
    expect(r.projects.find((p) => p.name === 'a')!.notion).toMatchObject({ life: 'parked', focus: false, parkReason: 'stuck', revisitOn: '2026-11-20' });
    expect(r.projects.find((p) => p.name === 'b')!.notion).toMatchObject({ life: 'killed', focus: false });
  });
  it('rejects a fourth focus project and changes nothing', () => {
    const ps = board();
    const r = run([{ name: 'd', action: 'focus' }], ps);
    expect(r).toMatchObject({ ok: false, error: { code: 'full', name: 'd' } });
    expect(ps).toEqual(board());
  });
  it('sets and clears next actions, trimmed, only where given', () => {
    const r = run([{ name: 'a', action: 'keep', nextAction: '  Ship it  ' }, { name: 'b', action: 'keep', nextAction: '   ' }, { name: 'c', action: 'keep' }]);
    if (!r.ok) throw new Error('rejected');
    expect(r.projects.find((p) => p.name === 'a')!.notion!.nextAction).toBe('Ship it');
    expect(r.projects.find((p) => p.name === 'b')!.notion!.nextAction).toBeUndefined();
    expect(r.projects.find((p) => p.name === 'c')!.notion!.nextAction).toBeUndefined();
  });
  it('lets a promoted project get its next action in the same review', () => {
    const r = run([{ name: 'a', action: 'park', reason: 'r', revisitOn: '2026-11-01' }, { name: 'd', action: 'focus', nextAction: 'Start' }]);
    if (!r.ok) throw new Error('rejected');
    expect(r.projects.find((p) => p.name === 'd')!.notion).toMatchObject({ focus: true, nextAction: 'Start' });
  });
  it.each([
    ['unknown project', [{ name: 'zzz', action: 'kill' }], 'not-found'],
    ['parked project', [{ name: 'p', action: 'kill' }], 'not-eligible'],
    ['shipped project', [{ name: 's', action: 'keep' }], 'not-eligible'],
    ['two decisions', [{ name: 'a', action: 'keep' }, { name: 'a', action: 'kill' }], 'duplicate'],
    ['park without reason', [{ name: 'a', action: 'park', reason: '  ', revisitOn: '2026-11-01' }], 'invalid'],
    ['park without date', [{ name: 'a', action: 'park', reason: 'r', revisitOn: '' }], 'invalid'],
  ] as Array<[string, ReviewDecision[], string]>)('rejects %s', (_n, decisions, code) => {
    expect(run(decisions)).toMatchObject({ ok: false, error: { code } });
  });
  it('rejects the whole review when one decision is bad, even after valid ones', () => {
    expect(run([{ name: 'a', action: 'kill' }, { name: 'zzz', action: 'kill' }]).ok).toBe(false);
  });
});

describe('reminder schedule', () => {
  const FRI = 5;
  // 2026-10-16 is a Friday.
  const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
  it('finds the latest scheduled moment at or before now', () => {
    expect(lastScheduled(at(2026, 10, 16, 17), FRI, '16:00')).toEqual(at(2026, 10, 16, 16));
    expect(lastScheduled(at(2026, 10, 16, 15), FRI, '16:00')).toEqual(at(2026, 10, 9, 16));
    expect(lastScheduled(at(2026, 10, 19, 9), FRI, '16:00')).toEqual(at(2026, 10, 16, 16));
    expect(lastScheduled(at(2026, 10, 16, 16, 0), FRI, '16:00')).toEqual(at(2026, 10, 16, 16));
  });
  const s = (over = {}) => ({ reviewDay: FRI, reviewTime: '16:00', reviewReminder: true, ...over });
  it('is due after the moment until a review is completed', () => {
    expect(dueSince(at(2026, 10, 16, 17), s())).toEqual(at(2026, 10, 16, 16));
    expect(dueSince(at(2026, 10, 16, 17), s({ lastReviewAt: at(2026, 10, 16, 16, 30).toISOString() }))).toBeNull();
    expect(dueSince(at(2026, 10, 16, 17), s({ lastReviewAt: at(2026, 10, 16, 15).toISOString() }))).not.toBeNull();
  });
  it('is due again the next week and never when reminders are off', () => {
    const last = at(2026, 10, 16, 16, 30).toISOString();
    expect(dueSince(at(2026, 10, 23, 17), s({ lastReviewAt: last }))).toEqual(at(2026, 10, 23, 16));
    expect(dueSince(at(2026, 10, 23, 17), s({ reviewReminder: false }))).toBeNull();
  });
});

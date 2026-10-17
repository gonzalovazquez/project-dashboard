import { describe, expect, it } from 'vitest';
import { createReminder } from '../src/main/app/reminder.js';
import type { ReviewSchedule } from '../src/shared/review.js';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m); // October 2026, the 16th is a Friday

function setup(initial: Partial<ReviewSchedule> = {}) {
  let schedule: ReviewSchedule = { reviewDay: 5, reviewTime: '16:00', reviewReminder: true, ...initial };
  let now = at(16, 15);
  const sent: Array<{ title: string; body: string }> = [];
  const r = createReminder({ schedule: async () => schedule, notify: (n) => sent.push(n), now: () => now });
  return { r, sent, at: (d: Date) => { now = d; }, set: (s: Partial<ReviewSchedule>) => { schedule = { ...schedule, ...s }; } };
}

describe('reminder', () => {
  it('stays quiet until the scheduled time', async () => {
    const t = setup({ lastReviewAt: at(9, 17).toISOString() }); // last week's review is done
    expect(await t.r.tick()).toBe(false);
    expect(t.sent).toEqual([]);
  });
  it('reminds right away when last week was never reviewed', async () => {
    const t = setup();
    expect(await t.r.tick()).toBe(true);
  });
  it('notifies once when the time passes and not again on later ticks', async () => {
    const t = setup({ lastReviewAt: at(9, 17).toISOString() });
    t.at(at(16, 16, 1));
    expect(await t.r.tick()).toBe(true);
    t.at(at(16, 16, 2));
    expect(await t.r.tick()).toBe(false);
    t.at(at(17, 9));
    expect(await t.r.tick()).toBe(false);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].title).toBe('Weekly review');
  });
  it('stays quiet once the review is done, and notifies again next week', async () => {
    const t = setup({ lastReviewAt: at(9, 17).toISOString() });
    t.at(at(16, 16, 1));
    t.set({ lastReviewAt: at(16, 16, 0).toISOString() });
    expect(await t.r.tick()).toBe(false);
    t.at(at(23, 16, 5));
    expect(await t.r.tick()).toBe(true);
  });
  it('never notifies with reminders off', async () => {
    const t = setup({ reviewReminder: false });
    t.at(at(16, 17));
    expect(await t.r.tick()).toBe(false);
  });
  it('follows a changed schedule', async () => {
    const t = setup({ lastReviewAt: at(9, 17).toISOString() });
    t.at(at(16, 15));
    t.set({ reviewTime: '14:30' });
    expect(await t.r.tick()).toBe(true);
  });
});

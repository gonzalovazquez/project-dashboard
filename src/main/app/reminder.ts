import { dueSince, type ReviewSchedule } from '../../shared/review.js';

export interface ReminderDeps {
  schedule(): Promise<ReviewSchedule>;
  notify(n: { title: string; body: string }): void;
  now?: () => Date;
}

/**
 * Shows one notification per scheduled review moment, and only while no review has been completed
 * since it. Call `tick` about once a minute. It remembers what it announced for this run only, so a
 * restart on the same day can remind once more, which is the safe side to err on.
 */
export function createReminder(d: ReminderDeps) {
  let announced: number | undefined;
  return {
    async tick(): Promise<boolean> {
      const now = (d.now ?? (() => new Date()))();
      const due = dueSince(now, await d.schedule());
      if (!due || announced === due.getTime()) return false;
      announced = due.getTime();
      d.notify({ title: 'Weekly review', body: 'Your weekly review is ready. Decide what stays in focus and what gets parked.' });
      return true;
    },
  };
}

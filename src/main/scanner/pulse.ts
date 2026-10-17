import type { Pulse, PulseLevel } from '../../shared/types.js';

const DAY = 86_400_000;

/**
 * Recency-weighted commit score. Each commit counts exp(-age/14 days), so a commit
 * from last week is worth about 0.6 and one from a month ago about 0.1.
 * Uncommitted work adds 1, since it is activity that git log cannot see.
 */
export function computePulse(weekly: number[], dirty: boolean, lastActivity: Date | undefined, now: Date): Pulse {
  const n = weekly.length;
  const score = weekly.reduce((a, c, i) => a + c * Math.exp(-(((n - 1 - i) * 7) + 3.5) / 14), 0) + (dirty ? 1 : 0);
  const quiet = weekly.slice(-4).every((c) => c === 0) && !dirty;
  const level: PulseLevel = quiet ? 'Dormant' : score >= 4 ? 'Hot' : score >= 1.5 ? 'Warm' : 'Cooling';
  const lastActivityDays = lastActivity ? Math.max(0, Math.floor((now.getTime() - lastActivity.getTime()) / DAY)) : null;
  return { score: Math.round(score * 100) / 100, level, lastActivityDays };
}

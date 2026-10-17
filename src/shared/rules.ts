import { WIP_LIMIT, type Criterion, type Project } from './types.js';

const DAY = 86_400_000;

/** Days in a stage after which a project is flagged for review. Charts draw the same line. */
export const REVIEW_DAYS = { 'In progress': 30, 'Beta': 45 } as const;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

export interface Flag { code: 'stuck-beta' | 'stuck-progress' | 'no-next' | 'no-commits' | 'quiet'; text: string }
export interface Forecast { remaining: number; velocity: number; weeks: number; date: string; low: string; high: string; hoursLeft: number }

const criteria = (p: Project): Criterion[] => p.notion?.criteria ?? [];
export const doneCount = (p: Project) => criteria(p).filter((c) => c.done).length;
export const progress = (p: Project): number | undefined => (criteria(p).length ? doneCount(p) / criteria(p).length : undefined);

/** Tracked, active, and not yet shipped. */
export const isLive = (p: Project) => !!p.notion && p.notion.life === 'active' && p.notion.stage !== 'General Available';
export const focusProjects = (ps: Project[]) => ps.filter((p) => p.notion?.focus && p.notion.life === 'active');

export function stageDays(p: Project, now: Date): number {
  const at = p.notion?.stageChangedAt;
  return at ? Math.max(0, Math.floor((now.getTime() - Date.parse(at)) / DAY)) : 0;
}

/** Criteria completed per week over the last 4 weeks, floored so forecasts stay finite. */
export function velocity(p: Project, now: Date): number {
  const cutoff = now.getTime() - 28 * DAY;
  const n = criteria(p).filter((c) => c.done && c.doneOn && Date.parse(c.doneOn) >= cutoff).length;
  return Math.max(0.25, n / 4);
}

export function forecast(p: Project, now: Date): Forecast {
  const open = criteria(p).filter((c) => !c.done);
  const v = velocity(p, now);
  const weeks = open.length / v;
  const at = (w: number) => addDays(now, Math.round(w * 7)).toISOString();
  return { remaining: open.length, velocity: v, weeks, date: at(weeks), low: at(weeks * 0.7), high: at(weeks * 1.5), hoursLeft: open.reduce((a, c) => a + (c.hours ?? 0), 0) };
}

export function flags(p: Project, now: Date): Flag[] {
  if (!isLive(p) || !p.notion) return [];
  const out: Flag[] = [];
  const days = stageDays(p, now);
  if (p.notion.stage === 'Beta' && days > REVIEW_DAYS.Beta) out.push({ code: 'stuck-beta', text: `In Beta for ${days} days` });
  if (p.notion.stage === 'In progress' && days > REVIEW_DAYS['In progress']) out.push({ code: 'stuck-progress', text: `In progress for ${days} days` });
  if (!p.notion.nextAction) out.push({ code: 'no-next', text: 'No next action' });
  const idle = p.pulse.lastActivityDays;
  if (idle !== null) {
    if (p.notion.focus && idle > 14) out.push({ code: 'no-commits', text: `No commits in ${idle} days` });
    else if (!p.notion.focus && idle > 21) out.push({ code: 'quiet', text: 'Gone quiet' });
  }
  return out;
}

/** Progress per unit of effort. Ranks the cheapest projects to finish first. */
export const finishScore = (p: Project) => (progress(p) ?? 0) / (0.3 + p.complexity.score / 100);
export const queue = (ps: Project[]) => ps.filter((p) => isLive(p) && !p.notion!.focus).sort((a, b) => finishScore(b) - finishScore(a));

export function healthParts(p: Project, now: Date): Array<{ label: string; value: number; weight: number }> {
  const hygiene = Math.max(0, 100 - 35 * flags(p, now).length);
  return [
    { label: 'Progress', value: (progress(p) ?? 0) * 100, weight: 0.35 },
    { label: 'Momentum', value: Math.min(1, p.pulse.score / 4) * 100, weight: 0.25 },
    { label: 'Freshness', value: (1 - Math.min(1, stageDays(p, now) / 90)) * 100, weight: 0.2 },
    { label: 'Hygiene', value: hygiene, weight: 0.2 },
  ];
}
export const health = (p: Project, now: Date) => Math.round(healthParts(p, now).reduce((a, x) => a + x.value * x.weight, 0));

export type PromoteResult =
  | { ok: true; projects: Project[] }
  | { ok: false; error: 'not-eligible' | 'full'; focus: Project[] };

const patch = (ps: Project[], name: string, change: Partial<NonNullable<Project['notion']>>) =>
  ps.map((p) => (p.name === name && p.notion ? { ...p, notion: { ...p.notion, ...change } } : p));

/** Moves a project into focus. When all slots are used, the caller must say which project to park. */
export function promote(ps: Project[], name: string, swap?: { parkName: string; reason: string; revisitOn?: string }): PromoteResult {
  const target = ps.find((p) => p.name === name);
  if (!target || !isLive(target)) return { ok: false, error: 'not-eligible', focus: focusProjects(ps) };
  let next = ps;
  const focus = focusProjects(ps);
  if (!target.notion!.focus && focus.length >= WIP_LIMIT) {
    if (!swap || !focus.some((p) => p.name === swap.parkName)) return { ok: false, error: 'full', focus };
    next = park(next, swap.parkName, swap.reason, swap.revisitOn);
  }
  return { ok: true, projects: patch(next, name, { focus: true }) };
}

export function park(ps: Project[], name: string, reason: string, revisitOn?: string): Project[] {
  return patch(ps, name, { life: 'parked', focus: false, parkReason: reason, revisitOn });
}
export const kill = (ps: Project[], name: string) => patch(ps, name, { life: 'killed', focus: false });

/** Brings a parked project back. It does not take a focus slot; promote it separately. */
export const unpark = (ps: Project[], name: string) => patch(ps, name, { life: 'active', parkReason: undefined, revisitOn: undefined });

export type ShipResult =
  | { ok: true; projects: Project[] }
  | { ok: false; error: 'not-found' | 'not-eligible' | 'no-criteria' | 'criteria-open'; open?: number };

/**
 * Moves a finished project to General Available and frees its focus slot. Only a live project with
 * ship criteria, every one of them done, can ship: a project with no criteria has no definition of done.
 */
export function ship(ps: Project[], name: string, now: Date): ShipResult {
  const p = ps.find((x) => x.name === name);
  if (!p) return { ok: false, error: 'not-found' };
  if (!isLive(p)) return { ok: false, error: 'not-eligible' };
  const criteria = p.notion!.criteria;
  if (criteria.length === 0) return { ok: false, error: 'no-criteria' };
  const open = criteria.filter((c) => !c.done).length;
  if (open > 0) return { ok: false, error: 'criteria-open', open };
  return { ok: true, projects: patch(ps, name, { stage: 'General Available', focus: false, stageChangedAt: now.toISOString().slice(0, 10) }) };
}

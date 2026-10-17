import { focusProjects, isLive, park, kill, promote } from './rules.js';
import { WIP_LIMIT, type Project } from './types.js';

const DAY = 86_400_000;

/** One decision about one project, made in the weekly review. */
export type ReviewDecision =
  | { name: string; action: 'keep'; nextAction?: string }
  | { name: string; action: 'focus'; nextAction?: string }
  | { name: string; action: 'park'; reason: string; revisitOn: string }
  | { name: string; action: 'kill' };

export interface ReviewPlan { decisions: ReviewDecision[] }

export type ReviewError =
  | { code: 'not-found' | 'not-eligible' | 'duplicate' | 'full' | 'invalid'; name?: string; message: string };

export type ReviewResult = { ok: true; projects: Project[] } | { ok: false; error: ReviewError };

const bad = (code: ReviewError['code'], message: string, name?: string): ReviewResult => ({ ok: false, error: { code, message, name } });
const label = (p: Project) => p.notion?.title ?? p.name;

/**
 * Applies a whole review to the projects, or rejects all of it. Parks and kills run first so their
 * focus slots are free, then next actions are set, then projects take focus. At most three end up
 * in focus. Nothing here writes anywhere: the caller writes the difference.
 */
export function applyReview(ps: Project[], plan: ReviewPlan): ReviewResult {
  const seen = new Set<string>();
  for (const d of plan.decisions) {
    const p = ps.find((x) => x.name === d.name);
    if (!p) return bad('not-found', `No project named ${d.name}.`, d.name);
    if (seen.has(d.name)) return bad('duplicate', `${label(p)} has two decisions.`, d.name);
    seen.add(d.name);
    if (!isLive(p)) return bad('not-eligible', `${label(p)} is not an active, unshipped project, so it cannot be reviewed.`, d.name);
    if (d.action === 'park' && (!d.reason.trim() || !d.revisitOn)) return bad('invalid', `Say why you are parking ${label(p)} and when to revisit it.`, d.name);
  }

  let next = ps;
  for (const d of plan.decisions) {
    if (d.action === 'park') next = park(next, d.name, d.reason.trim(), d.revisitOn);
    else if (d.action === 'kill') next = kill(next, d.name);
  }
  const edit = (name: string, nextAction: string | undefined) => {
    const text = nextAction?.trim();
    if (text === undefined) return;
    next = next.map((p) => (p.name === name && p.notion ? { ...p, notion: { ...p.notion, nextAction: text || undefined } } : p));
  };
  for (const d of plan.decisions) if (d.action === 'keep' || d.action === 'focus') edit(d.name, d.nextAction);
  for (const d of plan.decisions) {
    if (d.action !== 'focus') continue;
    const r = promote(next, d.name);
    if (!r.ok) {
      return r.error === 'full'
        ? bad('full', `Focus would hold more than ${WIP_LIMIT} projects. Park or kill one before ${label(next.find((p) => p.name === d.name)!)} takes a slot.`, d.name)
        : bad('not-eligible', `${label(next.find((p) => p.name === d.name)!)} cannot take a focus slot.`, d.name);
    }
    next = r.projects;
  }
  if (focusProjects(next).length > WIP_LIMIT) return bad('full', `Focus would hold more than ${WIP_LIMIT} projects.`);
  return { ok: true, projects: next };
}

export interface ReviewOutcome {
  /** Projects whose Notion properties changed. */
  changed: number;
  /** Dated notes written to project pages, and the projects whose note could not be written. */
  notesWritten: number;
  notesFailed: string[];
}

/** The dated line the review leaves on a project's Notion page. */
export function reviewNote(d: ReviewDecision, date: string): string {
  const head = `Weekly review ${date}: `;
  switch (d.action) {
    case 'park': return `${head}Parked until ${d.revisitOn}. Reason: ${d.reason.trim()}`;
    case 'kill': return `${head}Killed.`;
    case 'focus': return `${head}Moved into focus.${d.nextAction?.trim() ? ` Next action: ${d.nextAction.trim()}` : ''}`;
    case 'keep': return `${head}Kept.${d.nextAction?.trim() ? ` Next action: ${d.nextAction.trim()}` : ''}`;
  }
}

// ---------------------------------------------------------------- reminder

export interface ReviewSchedule { reviewDay: number; reviewTime: string; reviewReminder: boolean; lastReviewAt?: string }

export const REVIEW_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The most recent scheduled review moment at or before `now`, in local time. */
export function lastScheduled(now: Date, day: number, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() - day + 7) % 7));
  if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 7);
  return d;
}

/** A review is due once the scheduled moment has passed and none has been completed since it. Null when reminders are off. */
export function dueSince(now: Date, s: ReviewSchedule): Date | null {
  if (!s.reviewReminder) return null;
  const at = lastScheduled(now, s.reviewDay, s.reviewTime);
  const last = s.lastReviewAt ? Date.parse(s.lastReviewAt) : 0;
  return last >= at.getTime() ? null : at;
}

export const daysOverdue = (now: Date, at: Date) => Math.max(0, Math.floor((now.getTime() - at.getTime()) / DAY));

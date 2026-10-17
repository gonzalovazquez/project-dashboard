import type { Project } from '../../../shared/types.js';
import { WIP_LIMIT } from '../../../shared/types.js';
import { finishScore, flags, focusProjects, forecast, isLive, progress, queue } from '../../../shared/rules.js';
import type { ReviewDecision, ReviewPlan } from '../../../shared/review.js';
import { fmtDate, plural } from './format.js';
import { inDays } from './library.js';

const DAY = 86_400_000;
const title = (p: Project) => p.notion?.title ?? p.name;
const sinceDays = (iso: string | undefined, now: Date) => (iso ? (now.getTime() - Date.parse(iso)) / DAY : Infinity);

// ---------------------------------------------------------------- step 1: the week

export interface WeekRow { name: string; title: string; commits: number; criteriaDone: number; stageMoved?: string; progress?: number }
export interface WeekSummary { rows: WeekRow[]; commits: number; criteriaDone: number; quietFocus: number }

/** What moved in the last seven days on each focus project. */
export function weekInReview(ps: Project[], now: Date): WeekSummary {
  const rows = focusProjects(ps).map((p): WeekRow => ({
    name: p.name, title: title(p), commits: p.weekly.at(-1) ?? 0, progress: progress(p),
    criteriaDone: p.notion!.criteria.filter((c) => c.done && sinceDays(c.doneOn, now) <= 7).length,
    stageMoved: sinceDays(p.notion!.stageChangedAt, now) <= 7 ? p.notion!.stage : undefined,
  }));
  return { rows, commits: rows.reduce((a, r) => a + r.commits, 0), criteriaDone: rows.reduce((a, r) => a + r.criteriaDone, 0), quietFocus: rows.filter((r) => r.commits === 0 && r.criteriaDone === 0).length };
}

// ---------------------------------------------------------------- step 2: stalled projects

export interface Stalled { name: string; title: string; focus: boolean; reasons: string[] }

/** Live projects with a flag that says they are not moving. A missing next action is handled in the last step. */
export function stalledProjects(ps: Project[], now: Date): Stalled[] {
  return ps.filter(isLive).flatMap((p) => {
    const reasons = flags(p, now).filter((f) => f.code !== 'no-next').map((f) => f.text);
    return reasons.length ? [{ name: p.name, title: title(p), focus: !!p.notion!.focus, reasons }] : [];
  }).sort((a, b) => Number(b.focus) - Number(a.focus) || b.reasons.length - a.reasons.length || a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------- the draft

export type Choice = { action: 'keep' } | { action: 'park'; reason: string; revisitOn: string } | { action: 'kill' };
export interface Draft {
  decisions: Record<string, Choice>;
  /** Who is in focus when the review is applied. */
  focus: string[];
  nextActions: Record<string, string>;
}

export const initialDraft = (ps: Project[]): Draft => ({ decisions: {}, focus: focusProjects(ps).map((p) => p.name), nextActions: {} });

/** Records a decision. Parking or killing a project also takes it out of focus. */
export function decide(d: Draft, name: string, choice: Choice | undefined): Draft {
  const decisions = { ...d.decisions };
  if (choice) decisions[name] = choice; else delete decisions[name];
  const focus = choice && choice.action !== 'keep' ? d.focus.filter((n) => n !== name) : d.focus;
  return { ...d, decisions, focus };
}

export type Toggle = { draft: Draft } | { blocked: string };

/**
 * Adds or removes a project from the next focus set. A full set refuses another project. Removing a project
 * that is in focus now means parking it, so it gets a park decision that still needs a reason.
 */
export function toggleFocus(d: Draft, ps: Project[], name: string, now: Date): Toggle {
  const p = ps.find((x) => x.name === name);
  if (!p || !isLive(p)) return { blocked: 'Only active, unshipped projects can take focus.' };
  if (d.focus.includes(name)) {
    const focus = d.focus.filter((n) => n !== name);
    if (!p.notion!.focus) return { draft: { ...d, focus } };
    const existing = d.decisions[name];
    return { draft: { ...d, focus, decisions: { ...d.decisions, [name]: existing?.action === 'park' || existing?.action === 'kill' ? existing : { action: 'park', reason: '', revisitOn: inDays(now, 30) } } } };
  }
  if (d.focus.length >= WIP_LIMIT) return { blocked: `Focus holds ${WIP_LIMIT} projects. Take one out first.` };
  const decisions = { ...d.decisions };
  if (decisions[name]?.action === 'park' || decisions[name]?.action === 'kill') delete decisions[name];
  return { draft: { ...d, focus: [...d.focus, name], decisions } };
}

export const setNextAction = (d: Draft, name: string, text: string): Draft => ({ ...d, nextActions: { ...d.nextActions, [name]: text } });

// ---------------------------------------------------------------- step 3: candidates

export interface Candidate { name: string; title: string; focus: boolean; progress?: number; hint: string }

/** Every live project, the ones cheapest to finish first. Current focus projects lead so the set is easy to see. */
export function candidates(ps: Project[], now: Date): Candidate[] {
  const hint = (p: Project) => {
    const n = p.notion!;
    if (!n.criteria.length) return 'No ship criteria yet';
    const f = forecast(p, now);
    return f.remaining === 0 ? 'Ready to ship' : `${plural(f.remaining, 'criterion', 'criteria')} left, about ${fmtDate(new Date(f.date))}`;
  };
  const toC = (p: Project): Candidate => ({ name: p.name, title: title(p), focus: !!p.notion!.focus, progress: progress(p), hint: hint(p) });
  return [...focusProjects(ps).filter(isLive).map(toC), ...queue(ps).map(toC)];
}
export { finishScore };

// ---------------------------------------------------------------- step 4: plan and problems

export const effectiveNext = (p: Project, d: Draft): string => (d.nextActions[p.name] ?? p.notion?.nextAction ?? '').trim();

/** Everything that stops the review from being applied yet, in words. Empty when it is ready. */
export function problems(ps: Project[], d: Draft, now: Date): string[] {
  const out: string[] = [];
  // Choosing to bring a stalled project into focus is the decision to keep going. One already in focus still has to be confirmed.
  const promoted = (name: string) => d.focus.includes(name) && !ps.find((p) => p.name === name)?.notion?.focus;
  for (const s of stalledProjects(ps, now)) if (!d.decisions[s.name] && !promoted(s.name)) out.push(`Decide what to do with ${s.title}: ${s.reasons[0].toLowerCase()}.`);
  for (const [name, c] of Object.entries(d.decisions)) {
    const p = ps.find((x) => x.name === name);
    if (c.action === 'park' && (!c.reason.trim() || !c.revisitOn)) out.push(`Say why ${p ? title(p) : name} is parked and when to revisit it.`);
  }
  for (const name of d.focus) {
    const p = ps.find((x) => x.name === name);
    if (p && !effectiveNext(p, d)) out.push(`${title(p)} needs a next action.`);
  }
  if (d.focus.length > WIP_LIMIT) out.push(`Focus can hold at most ${WIP_LIMIT} projects.`);
  return out;
}

/** The decisions to send, in no particular order: the rules order them. Only changes and explicit decisions are included. */
export function buildPlan(ps: Project[], d: Draft): ReviewPlan {
  const decisions: ReviewDecision[] = [];
  const done = new Set<string>();
  const next = (p: Project) => {
    const typed = d.nextActions[p.name];
    return typed !== undefined && typed.trim() !== (p.notion!.nextAction ?? '') ? { nextAction: typed.trim() } : {};
  };
  for (const [name, c] of Object.entries(d.decisions)) {
    if (c.action === 'park') decisions.push({ name, action: 'park', reason: c.reason.trim(), revisitOn: c.revisitOn });
    else if (c.action === 'kill') decisions.push({ name, action: 'kill' });
    done.add(name);
  }
  for (const name of d.focus) {
    const p = ps.find((x) => x.name === name);
    if (!p?.notion) continue;
    decisions.push({ name, action: p.notion.focus ? 'keep' : 'focus', ...next(p) });
    done.add(name);
  }
  for (const [name, c] of Object.entries(d.decisions)) {
    if (c.action !== 'keep') continue;
    const p = ps.find((x) => x.name === name);
    if (p?.notion && !decisions.some((x) => x.name === name)) decisions.push({ name, action: 'keep', ...next(p) });
  }
  return { decisions };
}

/** One readable line per decision, for the confirmation step. */
export function planLines(ps: Project[], plan: ReviewPlan): string[] {
  const t = (name: string) => { const p = ps.find((x) => x.name === name); return p ? title(p) : name; };
  return plan.decisions.map((d) => {
    switch (d.action) {
      case 'park': return `Park ${t(d.name)} until ${fmtDate(new Date(d.revisitOn))}: ${d.reason}`;
      case 'kill': return `Kill ${t(d.name)}`;
      case 'focus': return `Move ${t(d.name)} into focus${d.nextAction ? `. Next: ${d.nextAction}` : ''}`;
      case 'keep': return `Keep ${t(d.name)}${d.nextAction ? `. Next: ${d.nextAction}` : ''}`;
    }
  });
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

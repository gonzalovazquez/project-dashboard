import { WIP_LIMIT, type Project, type Stage } from '../../../shared/types.js';
import { finishScore, flags, focusProjects, forecast, health, isLive, progress } from '../../../shared/rules.js';
import { avg, fmtDate, plural, sum } from './format.js';

const DAY = 86_400_000;

export type Tone = 'good' | 'bad' | 'warn' | 'flat';
export interface Delta { tone: Tone; label: string }

export interface Kpi {
  id: 'shipped' | 'progress' | 'next-ship' | 'commits' | 'health' | 'attention';
  label: string;
  /** Name of the color token the label dot uses. */
  color: string;
  value: string;
  unit?: string;
  sub: string;
  delta?: Delta;
  spark?: number[];
  badge?: { label: string; tone: Tone };
}

export interface HeadlineSegment { text: string; tone?: 'bad' | 'accent' }
export interface Insight { id: string; tone: Tone | 'info'; glyph: string; lead: string; text: string }

export interface OverviewModel {
  headline: HeadlineSegment[];
  kpis: Kpi[];
  insights: Insight[];
  /** True when at least one folder is matched to a Notion page. */
  hasNotion: boolean;
}

/** Week-over-week change. A rise from zero reads as "new" instead of an infinite percentage. */
export function weekDelta(cur: number, prev: number, invert = false): Delta {
  if (cur === prev) return { tone: 'flat', label: '● 0%' };
  if (prev === 0) return { tone: invert ? 'bad' : 'good', label: '▲ new' };
  const pct = Math.round(((cur - prev) / prev) * 100);
  const up = pct > 0;
  const good = invert ? !up : up;
  return { tone: good ? 'good' : 'bad', label: `${up ? '▲' : '▼'} ${Math.abs(pct)}%` };
}

/** Whether a criterion counted as done at `at`. Criteria checked before dates were tracked count as done long ago. */
const doneBy = (c: { done: boolean; doneOn?: string }, at: number) => c.done && (!c.doneOn || Date.parse(c.doneOn) <= at);

/** Average share of criteria done across the given projects at the end of each of the last 12 weeks. */
export function progressSeries(ps: Project[], now: Date, weeks = 12): number[] {
  return Array.from({ length: weeks }, (_, i) => {
    const at = now.getTime() - (weeks - 1 - i) * 7 * DAY;
    return avg(ps.flatMap((p) => {
      const cs = p.notion?.criteria ?? [];
      return cs.length ? [(cs.filter((c) => doneBy(c, at)).length / cs.length) * 100] : [];
    }));
  });
}

const shippedCount = (ps: Project[], now: Date, days = 90) =>
  ps.filter((p) => p.notion?.life === 'active' && p.notion.stage === 'General Available'
    && (!p.notion.stageChangedAt || now.getTime() - Date.parse(p.notion.stageChangedAt) <= days * DAY)).length;

const stageDaysOf = (p: Project, now: Date) => (p.notion?.stageChangedAt ? Math.max(0, Math.floor((now.getTime() - Date.parse(p.notion.stageChangedAt)) / DAY)) : 0);

export function buildOverview(projects: Project[], now: Date): OverviewModel {
  const tracked = projects.filter((p) => p.notion);
  const hasNotion = tracked.length > 0;
  const focus = focusProjects(projects);
  const live = projects.filter(isLive);
  const shipped = shippedCount(projects, now);

  const next = focus
    .filter((p) => (p.notion?.criteria.length ?? 0) > 0)
    .map((p) => ({ p, f: forecast(p, now) }))
    .sort((a, b) => Date.parse(a.f.date) - Date.parse(b.f.date))[0];

  // ---- commits
  const weeklyTotals = Array.from({ length: 12 }, (_, i) => sum(projects.map((p) => p.weekly[i] ?? 0)));
  const c1 = weeklyTotals[11] ?? 0;
  const c0 = weeklyTotals[10] ?? 0;

  // ---- focus numbers
  const withCriteria = focus.filter((p) => (p.notion?.criteria.length ?? 0) > 0);
  const avgProgress = Math.round(avg(withCriteria.map((p) => (progress(p) ?? 0) * 100)));
  const weekAgo = now.getTime() - 7 * DAY;
  const criteriaThisWeek = sum(focus.map((p) => (p.notion?.criteria ?? []).filter((c) => c.done && c.doneOn && Date.parse(c.doneOn) > weekAgo).length));
  const focusHealth = focus.length ? Math.round(avg(focus.map((p) => health(p, now)))) : 0;
  const avgAge = focus.length ? Math.round(avg(focus.map((p) => stageDaysOf(p, now)))) : 0;
  const flagged = live.filter((p) => flags(p, now).length > 0).length;
  const dash = '–';
  const connect = 'Connect Notion';

  const kpis: Kpi[] = [
    {
      id: 'shipped', label: 'Shipped, 90 days', color: 'green',
      value: hasNotion ? String(shipped) : dash,
      unit: hasNotion ? `of ${tracked.length} tracked` : undefined,
      sub: hasNotion ? `${plural(projects.filter((p) => p.notion?.stage === 'General Available').length, 'project')} in General Available` : connect,
    },
    {
      id: 'progress', label: 'Focus progress', color: 'blue',
      value: withCriteria.length ? String(avgProgress) : dash,
      unit: withCriteria.length ? '%' : undefined,
      sub: !hasNotion ? connect : !focus.length ? 'No projects in focus' : !withCriteria.length ? 'No ship criteria yet' : `+${criteriaThisWeek} ${criteriaThisWeek === 1 ? 'criterion' : 'criteria'} this week`,
      spark: withCriteria.length ? progressSeries(withCriteria, now) : undefined,
    },
    {
      id: 'next-ship', label: 'Next ship', color: 'indigo',
      value: next ? fmtDate(new Date(next.f.date)) : dash,
      sub: next ? (next.p.notion?.title ?? next.p.name) : !hasNotion ? connect : 'No focus project with criteria',
    },
    {
      id: 'commits', label: 'Commits, 7 days', color: 'teal',
      value: String(c1),
      sub: `vs ${c0} prior`,
      delta: weekDelta(c1, c0),
      spark: weeklyTotals,
    },
    {
      id: 'health', label: 'Focus health', color: 'orange',
      value: focus.length ? String(focusHealth) : dash,
      unit: focus.length ? '/100' : undefined,
      sub: focus.length ? `Avg ${avgAge} days in stage` : !hasNotion ? connect : 'No projects in focus',
      badge: focus.length ? { label: focusHealth >= 60 ? 'Good' : focusHealth >= 40 ? 'Fair' : 'Poor', tone: focusHealth >= 60 ? 'good' : focusHealth >= 40 ? 'warn' : 'bad' } : undefined,
    },
    {
      id: 'attention', label: 'Needs attention', color: 'red',
      value: hasNotion ? String(flagged) : dash,
      sub: hasNotion ? `of ${live.length} active projects flagged` : connect,
    },
  ];

  return { headline: buildHeadline({ focus: focus.length, shipped, hasNotion, next: next ? { title: next.p.notion?.title ?? next.p.name, date: new Date(next.f.date) } : undefined }), kpis, insights: buildInsights(projects, now, { c1, c0 }), hasNotion };
}

export function buildHeadline(a: { focus: number; shipped: number; hasNotion: boolean; next?: { title: string; date: Date } }): HeadlineSegment[] {
  if (!a.hasNotion) return [{ text: 'Connect Notion to see stages, progress and forecasts for every project.' }];
  if (a.focus === 0) return [{ text: `No projects in focus. Pick up to ${WIP_LIMIT} to start finishing.` }];
  const segs: HeadlineSegment[] = [{ text: `${a.focus} of ${WIP_LIMIT} focus slots in use. ` }];
  segs.push({ text: `${a.shipped} shipped`, tone: a.shipped === 0 ? 'bad' : undefined }, { text: ' so far' });
  if (a.next) segs.push({ text: ', and the first ship is forecast for ' }, { text: fmtDate(a.next.date), tone: 'accent' }, { text: ` (${a.next.title})` });
  segs.push({ text: '.' });
  return segs;
}

export function buildInsights(projects: Project[], now: Date, commits: { c1: number; c0: number }): Insight[] {
  const out: Insight[] = [];
  const tracked = projects.filter((p) => p.notion);
  const live = projects.filter(isLive);

  if (tracked.length === 0) {
    out.push({ id: 'no-notion', tone: 'warn', glyph: '!', lead: 'Notion is not connected.', text: 'Stages, ship criteria and forecasts come from your Notion board.' });
  } else {
    const beta = live.filter((p) => p.notion!.stage === ('Beta' as Stage));
    if (beta.length >= 3) {
      const days = Math.round(avg(beta.map((p) => stageDaysOf(p, now))));
      out.push({ id: 'beta', tone: 'bad', glyph: '!', lead: 'Beta is the bottleneck.', text: `${beta.length} of ${live.length} tracked projects sit in Beta for ${days} days on average. ${shippedCount(projects, now)} shipped.` });
    }
    const cheapest = live.filter((p) => (progress(p) ?? 0) > 0).sort((a, b) => finishScore(b) - finishScore(a))[0];
    if (cheapest) {
      const f = forecast(cheapest, now);
      const left = `${plural(f.remaining, 'criterion', 'criteria')}${f.hoursLeft ? ` and about ${f.hoursLeft} hours` : ''} left`;
      out.push({ id: 'cheapest', tone: 'good', glyph: '✓', lead: `Cheapest to finish: ${cheapest.notion!.title}.`, text: `${Math.round((progress(cheapest) ?? 0) * 100)}% done, ${left}, ${cheapest.complexity.level.toLowerCase()} complexity.${cheapest.notion!.focus ? '' : ' It is not in your focus slots.'}` });
    }
    for (const p of focusProjects(projects)) {
      const quiet = flags(p, now).find((f) => f.code === 'no-commits');
      if (quiet) out.push({ id: `quiet-${p.name}`, tone: 'warn', glyph: '…', lead: `${p.notion!.title} is in focus but quiet.`, text: `${quiet.text}.` });
    }
    const noNext = live.filter((p) => !p.notion!.nextAction);
    if (noNext.length) out.push({ id: 'no-next', tone: 'warn', glyph: '?', lead: `${plural(noNext.length, 'active project')} ${noNext.length === 1 ? 'has' : 'have'} no next action:`, text: `${noNext.map((p) => p.notion!.title).join(', ')}.` });
  }

  if (commits.c1 > 0 || commits.c0 > 0) {
    const up = commits.c1 >= commits.c0;
    const pct = commits.c0 === 0 ? undefined : Math.abs(Math.round(((commits.c1 - commits.c0) / commits.c0) * 100));
    out.push({ id: 'commits', tone: up ? 'good' : 'warn', glyph: up ? '↑' : '↓', lead: pct === undefined ? 'Commits are up from nothing last week' : `Commits are ${up ? 'up' : 'down'} ${pct}% week over week`, text: `(${commits.c1} vs ${commits.c0}).` });
  }
  const untracked = projects.filter((p) => !p.notion).length;
  if (tracked.length > 0 && untracked > 0) out.push({ id: 'untracked', tone: 'info', glyph: 'i', lead: `${untracked} of ${projects.length} folders are not in Notion.`, text: 'Triage them in the Inbox so nothing is unmanaged.' });
  return out;
}

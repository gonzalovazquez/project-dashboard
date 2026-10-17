import type { NotionStatus } from '../../../shared/ipc.js';
import type { Criterion, Project } from '../../../shared/types.js';
import { flags, forecast, health, healthParts, progress, stageDays } from '../../../shared/rules.js';
import { niceTicks, SERIES_TOKENS, OTHER_TOKEN } from './charts.js';
import { ago, fmtDate, plural, sum } from './format.js';
import type { Kpi } from './overview.js';
import { progressSeries, weekDelta } from './overview.js';

const DAY = 86_400_000;
const title = (p: Project) => p.notion?.title ?? p.name;
const doneBy = (c: Criterion, at: number) => c.done && (!c.doneOn || Date.parse(c.doneOn) <= at);

// ---------------------------------------------------------------- burnup

export interface BurnupPoint { end: string; label: string; done: number }
export interface Projection {
  velocity: number;
  /** Days from now to the expected, earliest and latest finish. */
  days: number; low: number; high: number;
  date: string; lowDate: string; highDate: string;
  /** How far past today the chart reaches. */
  reachDays: number;
  /** The expected date lies past the right edge. */
  beyond: boolean;
}
export interface BurnupModel {
  points: BurnupPoint[];
  total: number; done: number; remaining: number;
  ready: boolean; noCriteria: boolean;
  ticks: number[];
  projection?: Projection;
}

const MAX_REACH_WEEKS = 26;

/** Criteria completed over the last 12 weeks, and where the current pace leads. Criteria without a date count as done all along. */
export function burnup(p: Project, now: Date): BurnupModel {
  const cs = p.notion?.criteria ?? [];
  const total = cs.length;
  const points = Array.from({ length: 12 }, (_, i): BurnupPoint => {
    const d = new Date(now.getTime() - (11 - i) * 7 * DAY);
    return { end: d.toISOString(), label: fmtDate(d), done: cs.filter((c) => doneBy(c, d.getTime())).length };
  });
  const done = cs.filter((c) => c.done).length;
  const remaining = total - done;
  const base = { points, total, done, remaining, ready: total > 0 && remaining === 0, noCriteria: total === 0, ticks: total <= 8 ? Array.from({ length: total + 1 }, (_, i) => i) : niceTicks(total) };
  if (total === 0 || remaining === 0 || !p.notion) return base;
  const f = forecast(p, now);
  const days = Math.round(f.weeks * 7);
  const high = Math.round(f.weeks * 1.5 * 7);
  const reachWeeks = Math.min(MAX_REACH_WEEKS, Math.max(6, Math.ceil((high / 7) * 1) + 1));
  return {
    ...base,
    projection: { velocity: f.velocity, days, low: Math.round(f.weeks * 0.7 * 7), high, date: f.date, lowDate: f.low, highDate: f.high, reachDays: reachWeeks * 7, beyond: days > reachWeeks * 7 },
  };
}

// ---------------------------------------------------------------- heatmap and weekly bars

export interface HeatCell { col: number; row: number; count: number; date: string; label: string; level: 0 | 1 | 2 | 3 }
export interface HeatModel { cells: HeatCell[]; rowLabels: string[]; total: number; max: number; columnLabels: Array<{ col: number; label: string }> }

/** Twelve columns of seven days, oldest first. Every column starts on the same weekday, so rows are weekdays. */
export function heatmap(p: Project, now: Date): HeatModel {
  const daily = p.daily?.length === 84 ? p.daily : new Array<number>(84).fill(0);
  const cells: HeatCell[] = daily.map((count, idx) => {
    const d = new Date(now.getTime() - (83 - idx) * DAY);
    return { col: Math.floor(idx / 7), row: idx % 7, count, date: d.toISOString(), label: fmtDate(d), level: (count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : 3) as 0 | 1 | 2 | 3 };
  });
  const rowLabels = cells.slice(0, 7).map((c) => new Date(c.date).toLocaleDateString('en-US', { weekday: 'short' }));
  const columnLabels = [0, 4, 8, 11].map((col) => ({ col, label: cells[col * 7].label }));
  return { cells, rowLabels, total: sum(daily), max: Math.max(0, ...daily), columnLabels };
}

export interface WeekBar { label: string; value: number }
export function weekBars(p: Project, now: Date): WeekBar[] {
  return Array.from({ length: 12 }, (_, i) => ({ label: fmtDate(new Date(now.getTime() - (11 - i) * 7 * DAY)), value: p.weekly[i] ?? 0 }));
}

// ---------------------------------------------------------------- health, complexity, languages, details

export interface HealthModel { score: number; level: 'Good' | 'Fair' | 'Poor'; parts: Array<{ label: string; value: number; weight: number }>; risks: string[] }

export function healthModel(p: Project, now: Date): HealthModel {
  const score = health(p, now);
  return { score, level: score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Poor', parts: healthParts(p, now), risks: flags(p, now).map((f) => f.text) };
}

export interface LanguageSegment { name: string; share: number; token: string }

/** The top three languages get a color each; everything else folds into one neutral segment. */
export function languageSegments(p: Project): LanguageSegment[] {
  const langs = p.languages ?? [];
  const head = langs.filter((l) => l.name !== 'Other').slice(0, SERIES_TOKENS.length);
  const used = sum(head.map((l) => l.share));
  const out: LanguageSegment[] = head.map((l, i) => ({ name: l.name, share: l.share, token: SERIES_TOKENS[i] }));
  const rest = Math.max(0, 100 - used);
  if (head.length > 0 && rest > 0) out.push({ name: 'Other', share: rest, token: OTHER_TOKEN });
  return out;
}

export const detailRows = (p: Project, now: Date): Array<[string, string]> => [
  ['Notion status', p.notion?.stage ?? 'Not tracked'],
  ['Time in stage', p.notion ? plural(stageDays(p, now), 'day') : '–'],
  ['Repository', p.github ? p.github.replace('https://github.com/', '') : 'No remote'],
  ['Branch', !p.isGit ? 'Not a git repository' : `${p.branch ?? 'detached'} · ${p.dirty ? 'uncommitted changes' : 'clean'}`],
  ['Last commit', p.pulse.lastActivityDays === null ? 'None' : `${ago(p.pulse.lastActivityDays)} ago`],
  ...(p.members?.length ? [['Includes', p.members.join(', ')] as [string, string]] : []),
  ['Folder', p.path],
];

export const recentCommitRows = (p: Project, now: Date): Array<{ age: string; message: string }> =>
  (p.recentCommits ?? []).map((c) => ({ age: ago(Math.max(0, Math.floor((now.getTime() - Date.parse(c.date)) / DAY))), message: c.message }));

// ---------------------------------------------------------------- tiles

export function deepTiles(p: Project, now: Date): Kpi[] {
  const n = p.notion;
  const cs = n?.criteria ?? [];
  const total = cs.length;
  const done = cs.filter((c) => c.done).length;
  const open = cs.filter((c) => !c.done);
  const f = n && total > 0 ? forecast(p, now) : undefined;
  const pr = progress(p);
  const c4 = sum(p.weekly.slice(-4));
  const c4prior = sum(p.weekly.slice(-8, -4));
  const hours = sum(open.map((c) => c.hours ?? 0));
  const noEstimate = open.filter((c) => c.hours === undefined).length;
  const h = healthModel(p, now);
  const flagCount = h.risks.length;
  const dash = '–';
  return [
    { id: 'progress', label: 'Progress', color: 'blue', value: pr === undefined ? dash : String(Math.round(pr * 100)), unit: pr === undefined ? undefined : '%', sub: total ? `${done} of ${total} criteria` : 'No ship criteria yet', spark: total ? progressSeries([p], now) : undefined },
    { id: 'next-ship', label: 'Forecast ship', color: 'indigo', value: !f ? dash : f.remaining === 0 ? 'Ready' : fmtDate(new Date(f.date)), sub: !f ? 'Needs ship criteria' : f.remaining === 0 ? 'All criteria met' : `${(f.weeks).toFixed(1)} weeks away` },
    { id: 'commits', label: 'Velocity', color: 'teal', value: f ? f.velocity.toFixed(2) : dash, unit: f ? '/ week' : undefined, sub: f ? 'criteria, last 4 weeks' : 'Needs ship criteria' },
    { id: 'health', label: 'Remaining effort', color: 'orange', value: total ? String(hours) : dash, unit: total ? 'h' : undefined, sub: !total ? 'Needs ship criteria' : `${plural(open.length, 'criterion', 'criteria')} open${noEstimate ? `, ${noEstimate} without an estimate` : ''}` },
    { id: 'shipped', label: 'Commits, 4 weeks', color: 'green', value: String(c4), sub: `vs ${c4prior} prior`, delta: weekDelta(c4, c4prior), spark: p.weekly },
    { id: 'attention', label: 'Health', color: 'red', value: n ? String(h.score) : dash, unit: n ? '/100' : undefined, sub: !n ? 'Not tracked' : flagCount ? plural(flagCount, 'flag') : 'No flags', badge: n ? { label: h.level, tone: h.level === 'Good' ? 'good' : h.level === 'Fair' ? 'warn' : 'bad' } : undefined },
  ];
}

// ---------------------------------------------------------------- actions

/** What the interface may do with a Notion connection in this state. */
export function writeAccess(notion: NotionStatus): { criteria: boolean; properties: boolean; reason?: string } {
  switch (notion.state) {
    case 'connected': return { criteria: true, properties: true };
    case 'schema-missing': return { criteria: true, properties: false, reason: 'The Notion database is missing properties the app needs, so next actions cannot be saved yet.' };
    case 'error': return { criteria: false, properties: false, reason: 'Notion is unreachable. Showing the last known data.' };
    case 'not-configured': return { criteria: false, properties: false, reason: 'Connect Notion to make changes.' };
  }
}

/** A starting prompt for a Claude Code session on this project, built from what the dashboard knows. */
export function kickoffPrompt(p: Project, now: Date): string {
  const n = p.notion;
  const open = (n?.criteria ?? []).filter((c) => !c.done);
  const total = n?.criteria.length ?? 0;
  const lines = [
    `Project: ${title(p)} (${p.path})`,
    n ? `Stage: ${n.stage}, ${plural(stageDays(p, now), 'day')} in this stage` : 'Stage: not tracked in Notion',
    total ? `Progress: ${total - open.length} of ${total} ship criteria are done` : 'Progress: no ship criteria are defined',
    '',
    `Next action: ${n?.nextAction ?? 'none is set. Decide on one small thing to finish first.'}`,
  ];
  if (open.length) { lines.push('', 'Open ship criteria:', ...open.map((c) => `- ${c.title}${c.hours ? ` (${c.hours}h)` : ''}`)); }
  lines.push('', 'Start with the next action. Make routine decisions yourself and stop only for a real blocker. When you finish, summarize what changed and which criteria are now met.');
  return lines.join('\n');
}


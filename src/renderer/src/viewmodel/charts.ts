import type { Project, PulseLevel, Stage, StagePoint } from '../../../shared/types.js';
import { focusProjects, forecast, isLive, progress, REVIEW_DAYS, stageDays } from '../../../shared/rules.js';
import { fmtDate, sum } from './format.js';

const DAY = 86_400_000;
export type Range = 4 | 12;

/** Color tokens for charts. The three project slots and the stage ramp are validated in docs/chart-colors.md. */
export const SERIES_TOKENS = ['series-1', 'series-2', 'series-3'] as const;
export const OTHER_TOKEN = 'series-other';
export const STAGE_RAMP: Record<Stage, string> = { 'Not started': 'stage-0', 'In progress': 'stage-1', Beta: 'stage-2', 'General Available': 'stage-3' };
export const STAGES: Stage[] = ['Not started', 'In progress', 'Beta', 'General Available'];

export interface TableData { head: string[]; rows: string[][] }
export interface WeekSlot { end: string; label: string }

/**
 * Whole-number tick values from zero, at most five intervals. Counts are never fractional, so the
 * step comes from 1, 2, 5, 10, 20, 50... and the top is the first multiple at or above the maximum.
 */
export function niceTicks(max: number, maxIntervals = 5): number[] {
  const m = Math.max(1, Math.ceil(max));
  let step = 1;
  for (let mag = 1; ; mag *= 10) {
    const hit = [1, 2, 5].map((k) => k * mag).find((s) => Math.ceil(m / s) <= maxIntervals);
    if (hit) { step = hit; break; }
  }
  const top = Math.ceil(m / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return ticks;
}

const weekEnd = (now: Date, weeksAgo: number) => new Date(now.getTime() - weeksAgo * 7 * DAY);
const title = (p: Project) => p.notion?.title ?? p.name;

// ---------------------------------------------------------------- commits per week

export interface Series { id: string; name: string; token: string; values: number[] }
export interface CommitModel { weeks: WeekSlot[]; series: Series[]; totals: number[]; ticks: number[]; max: number; total: number }

/** Weekly commits, stacked bottom to top: everything else, then each focus project in slot order. */
export function commitSeries(projects: Project[], now: Date, range: Range): CommitModel {
  const idx = Array.from({ length: range }, (_, j) => 12 - range + j);
  const focus = focusProjects(projects).slice(0, SERIES_TOKENS.length);
  const inFocus = new Set(focus.map((p) => p.name));
  const weeks = idx.map((i) => { const d = weekEnd(now, 11 - i); return { end: d.toISOString(), label: fmtDate(d) }; });
  const other: Series = {
    id: 'other', name: focus.length ? 'Other projects' : 'All projects', token: OTHER_TOKEN,
    values: idx.map((i) => sum(projects.filter((p) => !inFocus.has(p.name)).map((p) => p.weekly[i] ?? 0))),
  };
  const series = [other, ...focus.map((p, k): Series => ({ id: p.name, name: title(p), token: SERIES_TOKENS[k], values: idx.map((i) => p.weekly[i] ?? 0) }))];
  const totals = idx.map((_, j) => sum(series.map((s) => s.values[j])));
  const max = Math.max(0, ...totals);
  return { weeks, series, totals, ticks: niceTicks(max), max, total: sum(totals) };
}

export function commitTable(m: CommitModel): TableData {
  return { head: ['Week ending', ...m.series.map((s) => s.name), 'Total'], rows: m.weeks.map((w, j) => [w.label, ...m.series.map((s) => String(s.values[j])), String(m.totals[j])]) };
}

// ---------------------------------------------------------------- forecast

export interface ForecastRow {
  name: string; title: string; token: string;
  weeks: number; days: number; remaining: number; velocity: number; hoursLeft: number;
  date: string; low: string; high: string;
  ready: boolean;
  /** The expected date falls after the right edge of the chart. */
  beyond: boolean;
}
export interface ForecastModel { rows: ForecastRow[]; capDays: number; withoutCriteria: string[] }

export function forecastRows(projects: Project[], now: Date, capWeeks = 24): ForecastModel {
  const focus = focusProjects(projects);
  const rows: ForecastRow[] = [];
  const withoutCriteria: string[] = [];
  focus.forEach((p, k) => {
    if (!p.notion || p.notion.criteria.length === 0) { withoutCriteria.push(title(p)); return; }
    const f = forecast(p, now);
    rows.push({
      name: p.name, title: title(p), token: SERIES_TOKENS[k] ?? OTHER_TOKEN,
      weeks: f.weeks, days: Math.round(f.weeks * 7), remaining: f.remaining, velocity: f.velocity, hoursLeft: f.hoursLeft,
      date: f.date, low: f.low, high: f.high, ready: f.remaining === 0, beyond: f.weeks > capWeeks,
    });
  });
  return { rows, capDays: capWeeks * 7, withoutCriteria };
}

export function forecastTable(m: ForecastModel): TableData {
  return {
    head: ['Project', 'Expected', 'Likely range', 'Criteria left', 'Per week'],
    rows: m.rows.map((r) => [r.title, r.ready ? 'Ready' : fmtDate(new Date(r.date)), r.ready ? '–' : `${fmtDate(new Date(r.low))} to ${fmtDate(new Date(r.high))}`, String(r.remaining), r.velocity.toFixed(2)]),
  };
}

// ---------------------------------------------------------------- progress against complexity

export interface ScatterPoint { name: string; title: string; complexity: number; progress: number; commits4w: number; stage: Stage; focus: boolean }
export interface ScatterModel { points: ScatterPoint[]; withoutCriteria: number }

export function scatterPoints(projects: Project[]): ScatterModel {
  const active = projects.filter((p) => p.notion?.life === 'active');
  const withCriteria = active.filter((p) => progress(p) !== undefined);
  return {
    withoutCriteria: active.length - withCriteria.length,
    points: withCriteria.map((p) => ({
      name: p.name, title: title(p), complexity: p.complexity.score, progress: Math.round((progress(p) ?? 0) * 100),
      commits4w: sum(p.weekly.slice(-4)), stage: p.notion!.stage, focus: p.notion!.focus,
    })),
  };
}

/** Bubble radius grows with the square root of recent commits so area tracks activity. */
export const bubbleRadius = (commits: number) => Math.min(22, 6 + Math.sqrt(Math.max(0, commits)) * 1.6);

/** The corner of the chart worth acting on: over half done and not complex. */
export const QUICK_WIN = { maxComplexity: 60, minProgress: 50 } as const;
export const isQuickWin = (p: Pick<ScatterPoint, 'complexity' | 'progress'>) => p.complexity < QUICK_WIN.maxComplexity && p.progress >= QUICK_WIN.minProgress;

export interface LabelInput { id: string; text: string; cx: number; cy: number; r: number }
export interface LabelBox { id: string; text: string; x: number; y: number; w: number; h: number; anchor: 'start' | 'end' | 'middle'; collides: boolean }
export interface Bounds { left: number; top: number; right: number; bottom: number }

const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const hitsCircle = (b: { x: number; y: number; w: number; h: number }, c: { cx: number; cy: number; r: number }) => {
  const nx = Math.max(b.x, Math.min(c.cx, b.x + b.w));
  const ny = Math.max(b.y, Math.min(c.cy, b.y + b.h));
  return (nx - c.cx) ** 2 + (ny - c.cy) ** 2 < c.r ** 2;
};

/**
 * Puts a text label beside each bubble without covering another label or bubble. Tries right, left,
 * above and below, then steps sideways positions up and down. If a label cannot be placed cleanly the
 * least-overlapping position is used and `collides` is set, so callers can fall back to the tooltip.
 */
export function placeLabels(inputs: LabelInput[], bounds: Bounds, opts: { charW?: number; h?: number; gap?: number } = {}): LabelBox[] {
  const { charW = 5.8, h = 13, gap = 4 } = opts;
  const placed: LabelBox[] = [];
  const order = inputs.slice().sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const inside = (b: { x: number; y: number; w: number; h: number }) => b.x >= bounds.left && b.y >= bounds.top && b.x + b.w <= bounds.right && b.y + b.h <= bounds.bottom;
  const cost = (b: { x: number; y: number; w: number; h: number }) =>
    placed.filter((p) => overlap(b, p)).length * 3 + inputs.filter((c) => hitsCircle(b, c)).length * 2 + (inside(b) ? 0 : 5);

  for (const c of order) {
    const w = c.text.length * charW;
    const cands: Array<Pick<LabelBox, 'x' | 'y' | 'anchor'>> = [
      { x: c.cx + c.r + gap, y: c.cy - h / 2, anchor: 'start' },
      { x: c.cx - c.r - gap - w, y: c.cy - h / 2, anchor: 'end' },
      { x: c.cx - w / 2, y: c.cy - c.r - gap - h, anchor: 'middle' },
      { x: c.cx - w / 2, y: c.cy + c.r + gap, anchor: 'middle' },
    ];
    for (let k = 1; k <= 4; k++) for (const dy of [k * h, -k * h]) {
      cands.push({ x: c.cx + c.r + gap, y: c.cy - h / 2 + dy, anchor: 'start' }, { x: c.cx - c.r - gap - w, y: c.cy - h / 2 + dy, anchor: 'end' });
    }
    let best = cands[0];
    let bestCost = Infinity;
    for (const cand of cands) {
      const k = cost({ x: cand.x, y: cand.y, w, h });
      if (k < bestCost) { best = cand; bestCost = k; if (k === 0) break; }
    }
    placed.push({ id: c.id, text: c.text, x: best.x, y: best.y, w, h, anchor: best.anchor, collides: bestCost > 0 });
  }
  return placed;
}

export function scatterTable(m: ScatterModel): TableData {
  return { head: ['Project', 'Stage', 'Progress', 'Complexity', 'Commits, 4 weeks'], rows: m.points.map((p) => [p.title, p.stage, `${p.progress}%`, String(p.complexity), String(p.commits4w)]) };
}

// ---------------------------------------------------------------- time in stage

export interface AgeBar { name: string; title: string; days: number; stage: Stage; threshold?: number; over: boolean }

export function ageBars(projects: Project[], now: Date): AgeBar[] {
  return projects.filter(isLive).map((p): AgeBar => {
    const stage = p.notion!.stage;
    const threshold = stage === 'Beta' ? REVIEW_DAYS.Beta : stage === 'In progress' ? REVIEW_DAYS['In progress'] : undefined;
    const days = stageDays(p, now);
    return { name: p.name, title: title(p), days, stage, threshold, over: threshold !== undefined && days > threshold };
  }).sort((a, b) => b.days - a.days || a.title.localeCompare(b.title));
}

export function ageTable(bars: AgeBar[]): TableData {
  return { head: ['Project', 'Stage', 'Days in stage', 'Review point', 'Status'], rows: bars.map((b) => [b.title, b.stage, String(b.days), b.threshold === undefined ? '–' : `${b.threshold} days`, b.over ? 'Past review point' : 'Within']) };
}

// ---------------------------------------------------------------- activity mix and technology

export const PULSE_ORDER: PulseLevel[] = ['Hot', 'Warm', 'Cooling', 'Dormant'];
export interface CountItem { label: string; value: number }

export const activityMix = (projects: Project[]): CountItem[] => PULSE_ORDER.map((l) => ({ label: l, value: projects.filter((p) => p.pulse.level === l).length }));

export function techBreakdown(projects: Project[], top = 6): CountItem[] {
  const counts = new Map<string, number>();
  for (const p of projects) for (const t of new Set(p.tech)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)).slice(0, top);
}

export const countTable = (head: string, items: CountItem[]): TableData => ({ head: [head, 'Projects'], rows: items.map((i) => [i.label, String(i.value)]) });

// ---------------------------------------------------------------- projects by stage over time

export interface StageColumn { date: string; end: string; label: string; counts: Record<Stage, number>; total: number }
export interface StageModel { slots: WeekSlot[]; columns: Array<StageColumn & { slot: number }>; max: number; ticks: number[]; startedOn?: string; sparse: boolean }

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** One column per week that has a recorded point: the latest point inside that week. Weeks with no record stay empty. */
export function stageColumns(history: StagePoint[], now: Date, range: Range): StageModel {
  const slots = Array.from({ length: range }, (_, j) => { const d = weekEnd(now, range - 1 - j); return { end: d.toISOString(), label: fmtDate(d) }; });
  const columns: StageModel['columns'] = [];
  slots.forEach((s, slot) => {
    const end = new Date(s.end);
    const hi = ymd(end);
    const lo = ymd(new Date(end.getTime() - 7 * DAY));
    const inWeek = history.filter((p) => p.date <= hi && p.date > lo).sort((a, b) => a.date.localeCompare(b.date));
    const p = inWeek.at(-1);
    if (p) columns.push({ slot, date: p.date, end: s.end, label: s.label, counts: p.counts, total: sum(STAGES.map((st) => p.counts[st])) });
  });
  const max = Math.max(0, ...columns.map((c) => c.total));
  return { slots, columns, max, ticks: niceTicks(max), startedOn: history[0]?.date, sparse: columns.length < 2 };
}

export function stageTable(m: StageModel): TableData {
  return { head: ['Week ending', 'Recorded on', ...STAGES], rows: m.columns.map((c) => [c.label, c.date, ...STAGES.map((s) => String(c.counts[s]))]) };
}

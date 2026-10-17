import type { Project, PulseLevel, Stage } from '../../../shared/types.js';
import { finishScore, flags, forecast, health, isLive, progress, stageDays } from '../../../shared/rules.js';

export type SortKey = 'finish' | 'name' | 'stage' | 'progress' | 'forecast' | 'pulse' | 'complexity' | 'age' | 'last' | 'health';
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }
export const DEFAULT_SORT: Sort = { key: 'finish', dir: 'desc' };

const STAGE_ORDER: Stage[] = ['Not started', 'In progress', 'Beta', 'General Available'];

export interface Row {
  name: string;
  title: string;
  stage: Stage;
  isFocus: boolean;
  /** 0 to 1, or undefined when the page has no ship criteria. */
  progress?: number;
  doneCount: number;
  criteriaCount: number;
  /** ISO date, or undefined for shipped projects and pages without criteria. */
  forecast?: string;
  ready: boolean;
  pulseLevel: PulseLevel;
  pulseScore: number;
  weekly: number[];
  complexity: number;
  complexityLevel: string;
  stageDays: number;
  lastActivityDays: number | null;
  dirty: boolean;
  health: number;
  flagCount: number;
  finish: number;
}

/** Tracked, active projects. Parked and killed ones live in the Library. */
export function portfolioRows(projects: Project[], now: Date): Row[] {
  return projects.filter((p) => p.notion && p.notion.life === 'active').map((p) => {
    const n = p.notion!;
    const pr = progress(p);
    const f = n.stage !== 'General Available' && n.criteria.length ? forecast(p, now) : undefined;
    return {
      name: p.name, title: n.title, stage: n.stage, isFocus: n.focus, progress: pr,
      doneCount: n.criteria.filter((c) => c.done).length, criteriaCount: n.criteria.length,
      forecast: f && f.remaining > 0 ? f.date : undefined, ready: !!f && f.remaining === 0,
      pulseLevel: p.pulse.level, pulseScore: p.pulse.score, weekly: p.weekly,
      complexity: p.complexity.score, complexityLevel: p.complexity.level,
      stageDays: stageDays(p, now), lastActivityDays: p.pulse.lastActivityDays, dirty: p.dirty,
      health: health(p, now), flagCount: flags(p, now).length,
      finish: isLive(p) ? finishScore(p) : -1,
    };
  });
}

const PULSE_ORDER: PulseLevel[] = ['Dormant', 'Cooling', 'Warm', 'Hot'];

/** The value a column sorts by. Missing values return undefined and always sort last. */
function valueOf(r: Row, key: SortKey): number | string | undefined {
  switch (key) {
    case 'finish': return r.finish;
    case 'name': return r.title.toLowerCase();
    case 'stage': return STAGE_ORDER.indexOf(r.stage);
    case 'progress': return r.progress;
    case 'forecast': return r.forecast ? Date.parse(r.forecast) : r.ready ? 0 : undefined;
    case 'pulse': return PULSE_ORDER.indexOf(r.pulseLevel) * 1000 + r.pulseScore;
    case 'complexity': return r.complexity;
    case 'age': return r.stageDays;
    case 'last': return r.lastActivityDays === null ? undefined : r.lastActivityDays;
    case 'health': return r.health;
  }
}

/** Stable sort with missing values last in either direction and the name as tie-breaker. */
export function sortRows(rows: Row[], sort: Sort): Row[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const x = valueOf(a, sort.key);
    const y = valueOf(b, sort.key);
    if (x === undefined && y === undefined) return a.title.localeCompare(b.title);
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    if (x < y) return -sign;
    if (x > y) return sign;
    return a.title.localeCompare(b.title);
  });
}

/** The direction a column starts in when first clicked: text and "soonest" ascend, magnitudes descend. */
const ASC_FIRST: SortKey[] = ['name', 'stage', 'forecast', 'last'];

export function nextSort(cur: Sort, key: SortKey): Sort {
  if (cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: ASC_FIRST.includes(key) ? 'asc' : 'desc' };
}

export interface SidebarModel {
  focus: Array<{ name: string; title: string; progress: number; stage: Stage }>;
  openSlots: number;
  counts: { all: number; inbox: number; parked: number; shipped: number; flagged: number };
}

export function sidebarModel(projects: Project[], now: Date, limit = 3, ignored: string[] = []): SidebarModel {
  const focus = projects.filter((p) => p.notion?.focus && p.notion.life === 'active');
  return {
    focus: focus.map((p) => ({ name: p.name, title: p.notion!.title, progress: progress(p) ?? 0, stage: p.notion!.stage })),
    openSlots: Math.max(0, limit - focus.length),
    counts: {
      all: projects.length,
      inbox: projects.filter((p) => !p.notion && !ignored.includes(p.name)).length,
      parked: projects.filter((p) => p.notion?.life === 'parked').length,
      shipped: projects.filter((p) => p.notion?.life === 'active' && p.notion.stage === 'General Available').length,
      flagged: projects.filter((p) => flags(p, now).length > 0).length,
    },
  };
}

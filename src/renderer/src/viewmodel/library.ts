import type { ComplexityLevel, Project, PulseLevel, Stage } from '../../../shared/types.js';
import { WIP_LIMIT } from '../../../shared/types.js';
import { focusProjects, isLive, progress, stageDays } from '../../../shared/rules.js';

const DAY = 86_400_000;
const title = (p: Project) => p.notion?.title ?? p.name;

export type State = 'focus' | 'active' | 'parked' | 'killed' | 'shipped' | 'untracked';
export const STATES: State[] = ['focus', 'active', 'parked', 'killed', 'shipped', 'untracked'];
export const STATE_LABEL: Record<State, string> = { focus: 'Focus', active: 'Active', parked: 'Parked', killed: 'Killed', shipped: 'Shipped', untracked: 'Not in Notion' };

export function stateOf(p: Project): State {
  const n = p.notion;
  if (!n) return 'untracked';
  if (n.life === 'parked') return 'parked';
  if (n.life === 'killed') return 'killed';
  if (n.stage === 'General Available') return 'shipped';
  return n.focus ? 'focus' : 'active';
}

// ---------------------------------------------------------------- library

export interface LibraryFilters {
  query: string;
  state: State | 'all';
  pulse: PulseLevel | 'all';
  complexity: ComplexityLevel | 'all';
  tech: string | 'all';
}
export const NO_FILTERS: LibraryFilters = { query: '', state: 'all', pulse: 'all', complexity: 'all', tech: 'all' };
export const isFiltered = (f: LibraryFilters) => JSON.stringify(f) !== JSON.stringify(NO_FILTERS);

export type LibrarySort = 'name' | 'activity' | 'complexity' | 'stage';

export interface LibraryRow {
  name: string; title: string; state: State; stage?: Stage;
  pulse: PulseLevel; complexity: number; complexityLevel: ComplexityLevel;
  tech: string[]; lastActivityDays: number | null; progress?: number; github: boolean;
}

export const techOptions = (ps: Project[]): string[] => [...new Set(ps.flatMap((p) => p.tech))].sort((a, b) => a.localeCompare(b));

const STAGE_ORDER: Stage[] = ['Not started', 'In progress', 'Beta', 'General Available'];

/** Every folder, filtered and sorted. Missing values sort last in either direction would be confusing in a list this plain, so they sort last always. */
export function libraryRows(ps: Project[], f: LibraryFilters, sort: LibrarySort = 'name'): LibraryRow[] {
  const q = f.query.trim().toLowerCase();
  const rows = ps
    .map((p): LibraryRow => ({
      name: p.name, title: title(p), state: stateOf(p), stage: p.notion?.stage, pulse: p.pulse.level,
      complexity: p.complexity.score, complexityLevel: p.complexity.level, tech: p.tech,
      lastActivityDays: p.pulse.lastActivityDays, progress: progress(p), github: !!p.github,
    }))
    .filter((r) => (f.state === 'all' || r.state === f.state)
      && (f.pulse === 'all' || r.pulse === f.pulse)
      && (f.complexity === 'all' || r.complexityLevel === f.complexity)
      && (f.tech === 'all' || r.tech.includes(f.tech))
      && (!q || r.name.toLowerCase().includes(q) || r.title.toLowerCase().includes(q) || r.tech.some((t) => t.toLowerCase().includes(q))));
  const byName = (a: LibraryRow, b: LibraryRow) => a.title.localeCompare(b.title);
  const key = (r: LibraryRow): number | undefined => {
    switch (sort) {
      case 'activity': return r.lastActivityDays ?? undefined;
      case 'complexity': return -r.complexity;
      case 'stage': return r.stage ? -STAGE_ORDER.indexOf(r.stage) : undefined;
      default: return undefined;
    }
  };
  return rows.sort((a, b) => {
    if (sort === 'name') return byName(a, b);
    const ka = key(a); const kb = key(b);
    if (ka === undefined && kb === undefined) return byName(a, b);
    if (ka === undefined) return 1;
    if (kb === undefined) return -1;
    return ka - kb || byName(a, b);
  });
}

// ---------------------------------------------------------------- inbox, parked, shipped

export interface InboxModel { pending: Project[]; ignored: Project[] }

/** Folders with no Notion page. Ignored ones stay out of the count but can be brought back. */
export function inboxModel(ps: Project[], ignored: string[]): InboxModel {
  const open = ps.filter((p) => !p.notion).sort((a, b) => (a.pulse.lastActivityDays ?? Infinity) - (b.pulse.lastActivityDays ?? Infinity) || a.name.localeCompare(b.name));
  return { pending: open.filter((p) => !ignored.includes(p.name)), ignored: open.filter((p) => ignored.includes(p.name)) };
}

export interface ParkedRow { name: string; title: string; reason: string; revisitOn?: string; daysUntil?: number; due: boolean; progress?: number }

/** Parked projects, the ones due for a second look first. */
export function parkedRows(ps: Project[], now: Date): ParkedRow[] {
  return ps.filter((p) => p.notion?.life === 'parked').map((p): ParkedRow => {
    const at = p.notion!.revisitOn;
    const daysUntil = at ? Math.ceil((Date.parse(at) - now.getTime()) / DAY) : undefined;
    return { name: p.name, title: title(p), reason: p.notion!.parkReason ?? 'No reason recorded', revisitOn: at, daysUntil, due: daysUntil !== undefined && daysUntil <= 0, progress: progress(p) };
  }).sort((a, b) => (a.daysUntil ?? Infinity) - (b.daysUntil ?? Infinity) || a.title.localeCompare(b.title));
}

export interface ShippedRow { name: string; title: string; shippedOn?: string; criteria: number; daysAgo?: number }

export function shippedRows(ps: Project[], now: Date): ShippedRow[] {
  return ps.filter((p) => stateOf(p) === 'shipped').map((p): ShippedRow => {
    const at = p.notion!.stageChangedAt;
    return { name: p.name, title: title(p), shippedOn: at, criteria: p.notion!.criteria.length, daysAgo: at ? stageDays(p, now) : undefined };
  }).sort((a, b) => (a.daysAgo ?? Infinity) - (b.daysAgo ?? Infinity) || a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------- focus actions

export interface Actions {
  /** `swap` means focus is full, so a project must be parked to make room. */
  promote: 'ok' | 'swap' | 'no';
  park: boolean;
  kill: boolean;
  unpark: boolean;
  /** Focus projects that could be parked to make room. */
  focus: Array<{ name: string; title: string }>;
}

export function actionsFor(ps: Project[], name: string): Actions {
  const p = ps.find((x) => x.name === name);
  const focus = focusProjects(ps).map((f) => ({ name: f.name, title: title(f) }));
  const live = !!p && isLive(p);
  return {
    promote: !p || !live || p.notion!.focus ? 'no' : focus.length >= WIP_LIMIT ? 'swap' : 'ok',
    park: live,
    kill: live,
    unpark: p?.notion?.life === 'parked',
    focus,
  };
}

/** Today plus `days`, as the YYYY-MM-DD the date inputs and Notion use. */
export function inDays(now: Date, days: number): string {
  const d = new Date(now.getTime() + days * DAY);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

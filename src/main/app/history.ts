import { type Project, type Stage, type StagePoint } from '../../shared/types.js';
import { readJson, writeJsonAtomic } from './jsonFile.js';

const MAX_POINTS = 400;
const STAGES: Stage[] = ['Not started', 'In progress', 'Beta', 'General Available'];

/** The local calendar date, which is what a person means by "today". */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Counts active tracked projects per stage. Parked and killed projects are not in the pipeline. */
export function stageCounts(projects: Project[]): Record<Stage, number> {
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const p of projects) if (p.notion && p.notion.life === 'active') counts[p.notion.stage]++;
  return counts;
}

/** Adds or replaces the point for its date, keeps the list sorted, and caps its length. */
export function upsertPoint(points: StagePoint[], point: StagePoint, max = MAX_POINTS): StagePoint[] {
  const next = [...points.filter((p) => p.date !== point.date), point].sort((a, b) => a.date.localeCompare(b.date));
  return next.slice(-max);
}

const valid = (p: unknown): p is StagePoint => {
  const o = p as StagePoint;
  return !!o && typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) && !!o.counts && STAGES.every((s) => Number.isFinite(o.counts[s]));
};

/** An append-only (one per day) record of the pipeline. Notion keeps no status history, so this is the only way to chart change over time. */
export interface HistoryStore {
  load(): Promise<StagePoint[]>;
  record(point: StagePoint): Promise<StagePoint[]>;
}

export function createHistoryStore(path: string): HistoryStore {
  const load = async () => {
    const raw = await readJson<unknown>(path);
    return Array.isArray(raw) ? raw.filter(valid) : [];
  };
  return {
    load,
    async record(point) {
      const next = upsertPoint(await load(), point);
      await writeJsonAtomic(path, next);
      return next;
    },
  };
}


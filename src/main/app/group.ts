import type { LanguageShare, ScanResult } from '../../shared/types.js';
import { computePulse } from '../scanner/pulse.js';

/** Folder groups: the primary folder's name maps to the folders that belong to the same product. */
export type Groups = Record<string, string[]>;

const sumArrays = (lists: number[][], len: number) => Array.from({ length: len }, (_, i) => lists.reduce((a, l) => a + (l[i] ?? 0), 0));
const unique = <T,>(xs: T[]) => [...new Set(xs)];

function mergeLanguages(all: LanguageShare[][]): LanguageShare[] {
  const totals = new Map<string, number>();
  for (const langs of all) for (const l of langs) totals.set(l.name, (totals.get(l.name) ?? 0) + l.share / all.length);
  const out = [...totals].map(([name, share]) => ({ name, share: Math.round(share) })).sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));
  return out;
}

/**
 * Folds the member folders of each group into the primary folder, so one Notion page is tracked as one project.
 * Commits and uncommitted work add up, technology is the union, complexity is the highest of the folders
 * (the hardest part sets the difficulty), and the pulse is recomputed from the combined commits.
 * A group whose primary folder is missing is ignored, a folder joins at most one group, and a primary cannot also be a member.
 */
export function mergeGroups(scans: ScanResult[], groups: Groups, now: Date): ScanResult[] {
  const byName = new Map(scans.map((s) => [s.name, s]));
  const claimed = new Set<string>();
  const merged = new Map<string, ScanResult>();
  for (const [primary, names] of Object.entries(groups)) {
    const head = byName.get(primary);
    if (!head || claimed.has(primary)) continue;
    const members = unique(names).filter((n) => n !== primary && byName.has(n) && !claimed.has(n) && !(n in groups));
    if (members.length === 0) continue;
    members.forEach((n) => claimed.add(n));
    const all = [head, ...members.map((n) => byName.get(n)!)];
    const dirty = all.some((s) => s.dirty);
    const weekly = sumArrays(all.map((s) => s.weekly), head.weekly.length);
    const lastCommit = all.map((s) => s.lastCommit).filter((d): d is string => !!d).sort().at(-1);
    const idle = all.map((s) => s.pulse.lastActivityDays).filter((d): d is number => d !== null);
    const top = all.reduce((a, s) => (s.complexity.score > a.complexity.score ? s : a), head);
    const pulse = computePulse(weekly, dirty, lastCommit ? new Date(lastCommit) : undefined, now);
    merged.set(primary, {
      ...head,
      isGit: all.some((s) => s.isGit),
      github: head.github ?? all.find((s) => s.github)?.github,
      dirty, lastCommit, weekly,
      daily: sumArrays(all.map((s) => s.daily), head.daily.length),
      recentCommits: all.flatMap((s) => s.recentCommits).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
      tech: unique(all.flatMap((s) => s.tech)),
      languages: mergeLanguages(all.map((s) => s.languages)),
      complexity: top.complexity,
      pulse: { ...pulse, lastActivityDays: idle.length ? Math.min(...idle) : null },
      members,
    });
  }
  return scans.filter((s) => !claimed.has(s.name)).map((s) => merged.get(s.name) ?? s);
}

/** Folders that are folded into another one, for hiding them while scans stream in. */
export const memberNames = (groups: Groups): Set<string> => new Set(Object.values(groups).flat());

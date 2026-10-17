export interface NotionPageRef { id: string; title: string }

export const normalizeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** 1 for an exact match, lower for weaker matches, 0 for none. */
export function scoreMatch(folder: string, title: string): number {
  const f = normalizeName(folder);
  const t = normalizeName(title);
  if (!f || !t) return 0;
  if (f === t) return 1;
  const [short, long] = f.length <= t.length ? [f, t] : [t, f];
  if (short.length >= 5 && long.includes(short)) return 0.85;
  const prefix = commonPrefix(f, t);
  if (prefix >= 6 && prefix / Math.min(f.length, t.length) >= 0.5) return 0.6;
  return 0;
}

/**
 * Pairs each folder with at most one Notion page, best scores first.
 * `overrides` maps a folder name to a page id and always wins.
 */
export function matchFolders(folders: string[], pages: NotionPageRef[], overrides: Record<string, string> = {}): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Set<string>();
  for (const [folder, id] of Object.entries(overrides)) {
    if (folders.includes(folder) && pages.some((p) => p.id === id)) { result.set(folder, id); used.add(id); }
  }
  const candidates = folders
    .filter((f) => !result.has(f))
    .flatMap((f) => pages.filter((p) => !used.has(p.id)).map((p) => ({ f, id: p.id, s: scoreMatch(f, p.title) })))
    .filter((c) => c.s > 0)
    .sort((a, b) => b.s - a.s);
  for (const c of candidates) {
    if (result.has(c.f) || used.has(c.id)) continue;
    result.set(c.f, c.id);
    used.add(c.id);
  }
  return result;
}

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Stage } from '../../shared/types.js';

/** What the app last saw for each page. Notion has no status history, so this is how a change is noticed. */
export type StageSnapshot = Record<string, { stage: Stage; seenAt: string }>;

export interface StageChange { pageId: string; from: Stage; to: Stage }

export interface DetectResult {
  /** Pages whose status differs from the last snapshot. The caller stamps Stage changed on each. */
  changes: StageChange[];
  /** The snapshot to store next. Pages that no longer exist are dropped. */
  next: StageSnapshot;
}

/**
 * First sight of a page is a baseline, not a change: we cannot know when it moved, so its
 * Stage changed property (or creation time) stays the source of truth for that page.
 */
export function detectStageChanges(prev: StageSnapshot, pages: Array<{ pageId: string; stage: Stage }>, now: Date): DetectResult {
  const changes: StageChange[] = [];
  const next: StageSnapshot = {};
  const stamp = now.toISOString();
  for (const p of pages) {
    const before = prev[p.pageId];
    if (!before) next[p.pageId] = { stage: p.stage, seenAt: stamp };
    else if (before.stage !== p.stage) {
      changes.push({ pageId: p.pageId, from: before.stage, to: p.stage });
      next[p.pageId] = { stage: p.stage, seenAt: stamp };
    } else next[p.pageId] = before;
  }
  return { changes, next };
}

export async function loadSnapshot(path: string): Promise<StageSnapshot> {
  try { return JSON.parse(await readFile(path, 'utf8')) as StageSnapshot; } catch { return {}; }
}

/** Writes to a temp file and renames, so a crash never leaves half a snapshot. */
export async function saveSnapshot(path: string, snapshot: StageSnapshot): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(snapshot, null, 2));
  await rename(tmp, path);
}

import type { NotionInfo, Project, ScanResult } from '../../shared/types.js';
import type { LoadedPage } from '../notion/gateway.js';
import { matchFolders } from '../notion/match.js';

export interface MergeResult {
  /** Notion info per folder name for every matched folder. */
  infoByFolder: Map<string, NotionInfo>;
  /** Folders with no Notion page. */
  unmatched: string[];
}

/** Pairs scanned folders with Notion pages, using explicit overrides first. */
export function matchNotion(folders: string[], loaded: LoadedPage[], overrides: Record<string, string> = {}): MergeResult {
  const withInfo = loaded.flatMap((l) => (l.info ? [{ id: l.page.id, title: l.info.title, info: l.info }] : []));
  const matches = matchFolders(folders, withInfo.map((p) => ({ id: p.id, title: p.title })), overrides);
  const byId = new Map(withInfo.map((p) => [p.id, p.info]));
  const infoByFolder = new Map<string, NotionInfo>();
  for (const [folder, id] of matches) infoByFolder.set(folder, byId.get(id)!);
  return { infoByFolder, unmatched: folders.filter((f) => !infoByFolder.has(f)) };
}

export const toProject = (scan: ScanResult, notion?: NotionInfo): Project => (notion ? { ...scan, notion } : { ...scan });

export function mergeProjects(scans: ScanResult[], infoByFolder: Map<string, NotionInfo>): Project[] {
  return scans.map((s) => toProject(s, infoByFolder.get(s.name)));
}

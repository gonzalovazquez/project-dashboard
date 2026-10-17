import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { WEEKS, type ScanResult } from '../../shared/types.js';
import { computeComplexity, countDependencies, hasTests, infraMarkers } from './complexity.js';
import { branchName, commitDates, dailyBuckets, isDirty, isRepoRoot, lastCommitDate, recentCommits, remoteUrl, trackedFiles, weeklyBuckets, type CommitInfo } from './git.js';
import { computePulse } from './pulse.js';
import { detectTech, LANGUAGE_BY_EXT, languageShares } from './tech.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', '__pycache__', '.next', 'target', '.terraform', '.idea']);
const LOCKFILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Pipfile\.lock|Cargo\.lock)$/;
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 1_000_000;
const DAY = 86_400_000;

/** Non-git folders: walk the tree while skipping dependency and build output. */
async function walk(root: string): Promise<{ files: string[]; mtimes: Date[] }> {
  const files: string[] = [];
  const mtimes: Date[] = [];
  const queue = [''];
  while (queue.length && files.length < MAX_FILES) {
    const rel = queue.shift()!;
    let entries;
    try { entries = await readdir(join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) queue.push(child); }
      else if (e.isFile()) {
        files.push(child);
        try { mtimes.push((await stat(join(root, child))).mtime); } catch { /* file vanished */ }
      }
    }
  }
  return { files, mtimes };
}

async function readSmall(root: string, rel: string): Promise<string | undefined> {
  try {
    const full = join(root, rel);
    if ((await stat(full)).size > MAX_FILE_BYTES) return undefined;
    return await readFile(full, 'utf8');
  } catch { return undefined; }
}

async function countLoc(root: string, files: string[]): Promise<{ loc: number; byLanguage: Map<string, number> }> {
  const byLanguage = new Map<string, number>();
  let loc = 0;
  for (const f of files) {
    const lang = LANGUAGE_BY_EXT[f.includes('.') ? f.split('.').pop()!.toLowerCase() : ''];
    if (!lang) continue;
    const text = await readSmall(root, f);
    if (text === undefined) continue;
    const lines = text.split('\n').filter((l) => l.trim()).length;
    loc += lines;
    byLanguage.set(lang, (byLanguage.get(lang) ?? 0) + lines);
  }
  return { loc, byLanguage };
}

export async function scanProject(dir: string, name: string, now = new Date()): Promise<ScanResult> {
  const isGit = await isRepoRoot(dir);
  let files: string[];
  let dates: Date[];
  let last: Date | undefined;
  let dirty = false;
  let recent: CommitInfo[] = [];
  if (isGit) {
    [files, dates, last, dirty, recent] = await Promise.all([trackedFiles(dir), commitDates(dir, now), lastCommitDate(dir), isDirty(dir), recentCommits(dir)]);
  } else {
    const w = await walk(dir);
    files = w.files;
    dates = w.mtimes.filter((d) => now.getTime() - d.getTime() <= WEEKS * 7 * DAY);
    last = w.mtimes.sort((a, b) => b.getTime() - a.getTime())[0];
  }
  files = files.filter((f) => !f.split('/').some((p) => SKIP_DIRS.has(p)));

  const manifests = new Map<string, string | undefined>();
  for (const f of ['package.json', 'requirements.txt', 'pyproject.toml', 'manifest.json']) {
    if (files.includes(f)) manifests.set(f, await readSmall(dir, f));
  }
  const read = (rel: string) => manifests.get(rel);

  const { loc, byLanguage } = await countLoc(dir, files);
  const weekly = weeklyBuckets(dates, now);
  const complexity = computeComplexity({
    loc,
    files: files.filter((f) => !LOCKFILES.test(f)).length,
    languages: byLanguage.size,
    dependencies: countDependencies(read, files),
    infraMarkers: infraMarkers(files),
    hasTests: hasTests(files),
  });

  return {
    name,
    path: dir,
    isGit,
    github: isGit ? await remoteUrl(dir) : undefined,
    branch: isGit ? await branchName(dir) : undefined,
    dirty,
    lastCommit: last?.toISOString(),
    weekly,
    daily: dailyBuckets(dates, now),
    recentCommits: recent,
    tech: detectTech({ files, read }),
    languages: languageShares(byLanguage),
    complexity,
    pulse: computePulse(weekly, dirty, last, now),
  };
}

export interface ScanOptions {
  now?: Date;
  concurrency?: number;
  /** Called as each project finishes, so the UI can fill in progressively. */
  onProject?: (p: ScanResult) => void;
}

/** Scans every visible directory directly inside `root`. */
export async function scanRoot(root: string, opts: ScanOptions = {}): Promise<ScanResult[]> {
  const { now = new Date(), concurrency = 4, onProject } = opts;
  const dirs = (await readdir(root, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  const results: ScanResult[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, dirs.length) }, async () => {
    while (next < dirs.length) {
      const name = dirs[next++];
      const r = await scanProject(join(root, name), name, now);
      results.push(r);
      onProject?.(r);
    }
  }));
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

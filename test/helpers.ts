import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Criterion, Project } from '../src/shared/types.js';

export const NOW = new Date('2026-10-12T12:00:00Z');
export const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

export const tmp = () => mkdtempSync(join(tmpdir(), 'pd-test-'));

export function writeFiles(dir: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
}

interface RepoOpts { files?: Record<string, string>; commitsDaysAgo?: number[]; remote?: string; dirtyFile?: boolean }

/** Creates a git repo whose commits carry the given ages. */
export function makeRepo(dir: string, opts: RepoOpts = {}) {
  mkdirSync(dir, { recursive: true });
  const run = (args: string[], date?: Date) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
      cwd: dir, stdio: 'pipe',
      env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date.toISOString(), GIT_COMMITTER_DATE: date.toISOString() } : {}) },
    });
  run(['init', '-q', '-b', 'main']);
  writeFiles(dir, opts.files ?? { 'README.md': '# x\n' });
  (opts.commitsDaysAgo ?? [1]).forEach((d, i) => {
    writeFileSync(join(dir, `c${i}.txt`), String(i));
    run(['add', '-A']);
    run(['commit', '-q', '-m', `c${i}`], daysAgo(d));
  });
  if (opts.remote) run(['remote', 'add', 'origin', opts.remote]);
  if (opts.dirtyFile) writeFileSync(join(dir, 'wip.txt'), 'wip');
}

export function project(over: Partial<Project> & { name: string }, notion?: Partial<NonNullable<Project['notion']>>): Project {
  const criteria: Criterion[] = notion?.criteria ?? [];
  return {
    path: `/dev/${over.name}`, isGit: true, dirty: false, weekly: new Array(12).fill(0), tech: [], languages: [],
    complexity: { score: 50, level: 'Medium', parts: [] },
    pulse: { score: 2, level: 'Warm', lastActivityDays: 3 },
    ...over,
    notion: notion === undefined ? undefined : {
      pageId: `id-${over.name}`, url: 'https://notion.so/x', title: over.name, stage: 'In progress', focus: false, life: 'active', criteria,
      ...notion,
    },
  };
}

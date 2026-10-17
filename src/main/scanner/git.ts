import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import { WEEKS } from '../../shared/types.js';

const exec = promisify(execFile);
const DAY = 86_400_000;

export async function git(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await exec('git', args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 20_000,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    return stdout;
  } catch {
    return undefined;
  }
}

/** True only when `dir` is itself a repository root, not a folder inside a parent repo. */
export async function isRepoRoot(dir: string): Promise<boolean> {
  const top = await git(dir, ['rev-parse', '--show-toplevel']);
  if (!top) return false;
  return (await realpath(top.trim())) === (await realpath(dir));
}

/** Turns ssh and https GitHub remotes into a browsable https URL. Other hosts return undefined. */
export function normalizeRemote(remote: string | undefined): string | undefined {
  if (!remote) return undefined;
  const m = remote.trim().match(/^(?:git@|ssh:\/\/git@|https?:\/\/(?:[^@/]+@)?)github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return m ? `https://github.com/${m[1]}/${m[2]}` : undefined;
}

export async function remoteUrl(dir: string): Promise<string | undefined> {
  return normalizeRemote(await git(dir, ['config', '--get', 'remote.origin.url']));
}

export async function branchName(dir: string): Promise<string | undefined> {
  const out = (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim();
  return out && out !== 'HEAD' ? out : undefined;
}

export async function isDirty(dir: string): Promise<boolean> {
  const out = await git(dir, ['status', '--porcelain']);
  return !!out && out.trim().length > 0;
}

export async function commitDates(dir: string, now: Date, days = WEEKS * 7): Promise<Date[]> {
  const since = new Date(now.getTime() - days * DAY).toISOString();
  const out = await git(dir, ['log', '--all', `--since=${since}`, '--format=%cI']);
  return (out ?? '').split('\n').filter(Boolean).map((s) => new Date(s));
}

export async function lastCommitDate(dir: string): Promise<Date | undefined> {
  const out = (await git(dir, ['log', '--all', '-1', '--format=%cI']))?.trim();
  return out ? new Date(out) : undefined;
}

export async function trackedFiles(dir: string): Promise<string[]> {
  const out = await git(dir, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  return [...new Set((out ?? '').split('\0').filter(Boolean))];
}

/** Buckets timestamps into trailing 7-day windows ending at `now`. Index WEEKS-1 is the latest week. */
export function weeklyBuckets(dates: Date[], now: Date, weeks = WEEKS): number[] {
  const out = new Array<number>(weeks).fill(0);
  for (const d of dates) {
    const age = now.getTime() - d.getTime();
    if (age < 0) continue;
    const idx = weeks - 1 - Math.floor(age / (7 * DAY));
    if (idx >= 0) out[idx]++;
  }
  return out;
}

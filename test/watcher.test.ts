import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWatcher, type WatchHandle } from '../src/main/app/watcher.js';

function setup() {
  const open = new Map<string, (f: string | null) => void>();
  const closed: string[] = [];
  const folders = vi.fn();
  const project = vi.fn();
  const failFor = new Set<string>();
  const w = createWatcher({
    debounceMs: 1000,
    watch: (dir, cb): WatchHandle => {
      if (failFor.has(dir)) throw new Error('ENOENT');
      open.set(dir, cb);
      return { close: () => { open.delete(dir); closed.push(dir); } };
    },
    onFolders: folders, onProject: project,
  });
  return { w, open, closed, folders, project, failFor };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('createWatcher', () => {
  it('watches the root and each project .git folder, one level only', () => {
    const t = setup();
    t.w.sync('/dev', ['a', 'b']);
    expect([...t.open.keys()].sort()).toEqual(['/dev', '/dev/a/.git', '/dev/b/.git']);
  });
  it('turns a burst of git events into one refresh of that project', () => {
    const t = setup();
    t.w.sync('/dev', ['a', 'b']);
    for (let i = 0; i < 5; i++) { t.open.get('/dev/a/.git')!('index'); vi.advanceTimersByTime(300); }
    expect(t.project).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(t.project).toHaveBeenCalledTimes(1);
    expect(t.project).toHaveBeenCalledWith('a');
  });
  it('keeps projects apart', () => {
    const t = setup();
    t.w.sync('/dev', ['a', 'b']);
    t.open.get('/dev/a/.git')!('x');
    t.open.get('/dev/b/.git')!('x');
    vi.advanceTimersByTime(1000);
    expect(t.project.mock.calls.map((c) => c[0]).sort()).toEqual(['a', 'b']);
  });
  it('asks for a full scan when a folder appears, and drops pending single refreshes', () => {
    const t = setup();
    t.w.sync('/dev', ['a']);
    t.open.get('/dev/a/.git')!('x');
    t.open.get('/dev')!('new-project');
    t.open.get('/dev/a/.git')!('y'); // arrives after, still covered by the full scan
    vi.advanceTimersByTime(5000);
    expect(t.folders).toHaveBeenCalledTimes(1);
    expect(t.project).not.toHaveBeenCalled();
  });
  it('ignores hidden entries in the root such as .DS_Store', () => {
    const t = setup();
    t.w.sync('/dev', ['a']);
    t.open.get('/dev')!('.DS_Store');
    vi.advanceTimersByTime(5000);
    expect(t.folders).not.toHaveBeenCalled();
    t.open.get('/dev')!(null); // some platforms give no name
    vi.advanceTimersByTime(1000);
    expect(t.folders).toHaveBeenCalledTimes(1);
  });
  it('adds and removes project watchers as the list changes, without reopening the rest', () => {
    const t = setup();
    t.w.sync('/dev', ['a', 'b']);
    t.closed.length = 0;
    t.w.sync('/dev', ['b', 'c']);
    expect(t.closed).toEqual(['/dev/a/.git']);
    expect(t.w.watching()).toEqual(['b', 'c']);
  });
  it('moves everything when the root changes', () => {
    const t = setup();
    t.w.sync('/dev', ['a']);
    t.w.sync('/code', ['a']);
    expect([...t.open.keys()].sort()).toEqual(['/code', '/code/a/.git']);
  });
  it('skips folders that cannot be watched, such as ones that are not git repositories', () => {
    const t = setup();
    t.failFor.add('/dev/plain/.git');
    t.w.sync('/dev', ['a', 'plain']);
    expect(t.w.watching()).toEqual(['a']);
    t.w.sync('/dev', ['a', 'plain']); // trying again later is harmless
    expect(t.w.watching()).toEqual(['a']);
  });
  it('close stops everything, including timers already running', () => {
    const t = setup();
    t.w.sync('/dev', ['a']);
    t.open.get('/dev/a/.git')!('x');
    t.w.close();
    vi.advanceTimersByTime(5000);
    expect(t.project).not.toHaveBeenCalled();
    expect(t.open.size).toBe(0);
  });
});

describe('with the real file system', () => {
  it('reports a commit in a real repository, and a new folder in the root', async () => {
    vi.useRealTimers();
    const { execFileSync } = await import('node:child_process');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { fsWatch } = await import('../src/main/app/watcher.js');
    const { makeRepo, tmp } = await import('./helpers.js');
    const root = tmp();
    makeRepo(join(root, 'proj'));
    const seen: string[] = [];
    const w = createWatcher({ watch: fsWatch, debounceMs: 150, onProject: (n) => seen.push(`project:${n}`), onFolders: () => seen.push('folders') });
    w.sync(root, ['proj']);
    const until = async (pred: () => boolean) => { for (let i = 0; i < 60 && !pred(); i++) await new Promise((r) => setTimeout(r, 50)); };

    writeFileSync(join(root, 'proj', 'new.txt'), 'x');
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'add', '-A'], { cwd: join(root, 'proj') });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'second'], { cwd: join(root, 'proj') });
    await until(() => seen.includes('project:proj'));
    expect(seen).toContain('project:proj');

    mkdirSync(join(root, 'brand-new'));
    await until(() => seen.includes('folders'));
    expect(seen).toContain('folders');
    w.close();
  });
});

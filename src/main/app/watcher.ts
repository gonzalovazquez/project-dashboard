import { watch as fsWatchNative } from 'node:fs';
import { join } from 'node:path';

export interface WatchHandle { close(): void }
/** Watches one directory, not its children. `file` is the name of what changed, when the platform says. */
export type WatchFn = (dir: string, onEvent: (file: string | null) => void) => WatchHandle;

export interface WatcherDeps {
  watch: WatchFn;
  /** A folder appeared, disappeared or was renamed in the Development folder. */
  onFolders(): void;
  /** Something changed inside a project's .git folder, which means a commit, a checkout or a staged change. */
  onProject(name: string): void;
  debounceMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

/**
 * Keeps the dashboard current without polling. It watches the Development folder for folders coming and
 * going, and each project's .git folder (one level deep, so node_modules is never walked) for commits.
 * Bursts of events become one callback after a quiet moment. A change to the folder list wins over
 * pending single-project refreshes, because the full scan covers them.
 */
export function createWatcher(d: WatcherDeps) {
  const wait = d.debounceMs ?? 1500;
  const setT = d.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = d.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let root: string | undefined;
  let rootHandle: WatchHandle | undefined;
  const gitHandles = new Map<string, WatchHandle>();
  const pending = new Map<string, unknown>();
  let foldersTimer: unknown;

  const safe = (dir: string, onEvent: (f: string | null) => void): WatchHandle | undefined => {
    try { return d.watch(dir, onEvent); } catch { return undefined; }
  };

  const projectChanged = (name: string) => {
    if (foldersTimer !== undefined) return;
    if (pending.has(name)) clearT(pending.get(name));
    pending.set(name, setT(() => { pending.delete(name); d.onProject(name); }, wait));
  };
  const foldersChanged = () => {
    if (foldersTimer !== undefined) clearT(foldersTimer);
    for (const t of pending.values()) clearT(t);
    pending.clear();
    foldersTimer = setT(() => { foldersTimer = undefined; d.onFolders(); }, wait);
  };

  return {
    /** Points the watchers at the current root and project names. Cheap to call after every scan. */
    sync(nextRoot: string, names: string[]) {
      if (root !== nextRoot) {
        rootHandle?.close();
        for (const h of gitHandles.values()) h.close();
        gitHandles.clear();
        root = nextRoot;
        rootHandle = safe(nextRoot, (file) => { if (!file || !file.startsWith('.')) foldersChanged(); });
      }
      const want = new Set(names);
      for (const [name, h] of gitHandles) if (!want.has(name)) { h.close(); gitHandles.delete(name); }
      for (const name of want) {
        if (gitHandles.has(name)) continue;
        const h = safe(join(nextRoot, name, '.git'), () => projectChanged(name));
        if (h) gitHandles.set(name, h);
      }
    },
    close() {
      rootHandle?.close();
      for (const h of gitHandles.values()) h.close();
      gitHandles.clear();
      for (const t of pending.values()) clearT(t);
      pending.clear();
      if (foldersTimer !== undefined) clearT(foldersTimer);
      foldersTimer = undefined;
      root = undefined;
      rootHandle = undefined;
    },
    /** Names with a live watcher, for tests and diagnostics. */
    watching: () => [...gitHandles.keys()].sort(),
  };
}

/** The real thing: node's directory watcher. It throws when the directory is missing, which the watcher treats as "nothing to watch". */
export const fsWatch: WatchFn = (dir, onEvent) => {
  const w = fsWatchNative(dir, { persistent: false }, (_event, file) => onEvent(file ? String(file) : null));
  w.on('error', () => w.close());
  return { close: () => w.close() };
};

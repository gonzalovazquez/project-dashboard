import type { Project } from '../../shared/types.js';
import { readJson, writeJsonAtomic } from './jsonFile.js';

/** Bumped when the shape of a project changes, so an old cache is ignored instead of misread. */
const VERSION = 2;

export interface CacheData { version: number; scannedAt?: string; projects: Project[] }

/** The last known projects, so the window has something to show before the first scan finishes. */
export interface Cache {
  load(): Promise<CacheData | undefined>;
  save(data: { scannedAt?: string; projects: Project[] }): Promise<void>;
}

export function createFileCache(path: string): Cache {
  return {
    async load() {
      const data = await readJson<CacheData>(path);
      return data && data.version === VERSION && Array.isArray(data.projects) ? data : undefined;
    },
    save: (data) => writeJsonAtomic(path, { version: VERSION, ...data }),
  };
}

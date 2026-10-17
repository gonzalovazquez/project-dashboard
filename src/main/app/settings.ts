import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { SettingsPatch } from '../../shared/ipc.js';
import { readJson, writeJsonAtomic } from './jsonFile.js';

export interface StoredSettings { developmentFolder: string; overrides: Record<string, string> }

export const defaultSettings = (): StoredSettings => ({ developmentFolder: join(homedir(), 'Development'), overrides: {} });

export interface SettingsStore {
  load(): Promise<StoredSettings>;
  save(patch: SettingsPatch): Promise<StoredSettings>;
}

/** Returns an error message, or undefined when the patch is acceptable. */
export function validatePatch(patch: SettingsPatch): string | undefined {
  if (patch.developmentFolder !== undefined && (typeof patch.developmentFolder !== 'string' || !isAbsolute(patch.developmentFolder))) return 'The Development folder must be an absolute path.';
  if (patch.overrides !== undefined) {
    if (typeof patch.overrides !== 'object' || patch.overrides === null || Array.isArray(patch.overrides)) return 'Overrides must be a map of folder name to page id.';
    for (const [k, v] of Object.entries(patch.overrides)) if (!k || typeof v !== 'string' || !v) return 'Each override needs a folder name and a page id.';
  }
  return undefined;
}

export function createSettingsStore(path: string): SettingsStore {
  const load = async (): Promise<StoredSettings> => {
    const stored = await readJson<Partial<StoredSettings>>(path);
    const d = defaultSettings();
    return { developmentFolder: stored?.developmentFolder ?? d.developmentFolder, overrides: stored?.overrides ?? {} };
  };
  return {
    load,
    async save(patch) {
      const err = validatePatch(patch);
      if (err) throw new Error(err);
      const next = { ...(await load()), ...patch };
      await writeJsonAtomic(path, next);
      return next;
    },
  };
}

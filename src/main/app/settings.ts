import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { APPEARANCES, type Appearance, type SettingsPatch } from '../../shared/ipc.js';
import { readJson, writeJsonAtomic } from './jsonFile.js';

export interface StoredSettings { developmentFolder: string; overrides: Record<string, string>; ignored: string[]; appearance: Appearance }

export const defaultSettings = (): StoredSettings => ({ developmentFolder: join(homedir(), 'Development'), overrides: {}, ignored: [], appearance: 'system' });

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
  if (patch.ignored !== undefined && (!Array.isArray(patch.ignored) || patch.ignored.some((n) => typeof n !== 'string' || !n))) return 'Ignored folders must be a list of folder names.';
  if (patch.appearance !== undefined && !APPEARANCES.includes(patch.appearance)) return 'Appearance must be system, light or dark.';
  return undefined;
}

export function createSettingsStore(path: string): SettingsStore {
  const load = async (): Promise<StoredSettings> => {
    const stored = await readJson<Partial<StoredSettings>>(path);
    const d = defaultSettings();
    return {
      developmentFolder: stored?.developmentFolder ?? d.developmentFolder,
      overrides: stored?.overrides ?? {},
      ignored: Array.isArray(stored?.ignored) ? stored!.ignored.filter((n) => typeof n === 'string') : [],
      appearance: stored?.appearance && APPEARANCES.includes(stored.appearance) ? stored.appearance : d.appearance,
    };
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

import type { Project, StagePoint } from './types.js';

export type Appearance = 'system' | 'light' | 'dark';
export const APPEARANCES: Appearance[] = ['system', 'light', 'dark'];

export type NotionState = 'not-configured' | 'connected' | 'error' | 'schema-missing';

export interface NotionStatus {
  state: NotionState;
  message?: string;
  syncedAt?: string;
  pages?: number;
}

/** Settings as the interface sees them. The token itself never crosses the bridge. */
export interface PublicSettings {
  developmentFolder: string;
  overrides: Record<string, string>;
  /** Folders hidden from the Inbox. */
  ignored: string[];
  tokenSource: 'env' | 'keychain' | 'none';
  secureStorageAvailable: boolean;
  appearance: Appearance;
}

/** A Notion page that no folder is paired with, offered when linking a folder by hand. */
export interface UnlinkedPage { id: string; title: string; url: string; stage: string }

export interface Snapshot {
  projects: Project[];
  scannedAt?: string;
  scanning: boolean;
  scanError?: string;
  notion: NotionStatus;
  settings: PublicSettings;
  /** Daily record of projects per stage, oldest first. Starts when the app first sees Notion. */
  stageHistory: StagePoint[];
  /** Pages in the database that no folder matched, so an unmatched folder can be linked to one. */
  unlinkedPages: UnlinkedPage[];
}

export type ErrorCode =
  | 'invalid' | 'not-found' | 'not-eligible' | 'full'
  | 'no-notion' | 'schema-missing' | 'notion-write-failed' | 'no-criteria' | 'criteria-open'
  | 'no-secure-storage' | 'scan-failed' | 'busy' | 'internal';

export interface ActionError {
  code: ErrorCode;
  message: string;
  /** For `full`: the names of the projects currently in focus, so the caller can offer a swap. */
  focus?: string[];
}

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: ActionError };

export type ProjectUpdate =
  | { kind: 'scan-started' }
  | { kind: 'project'; project: Project }
  | { kind: 'scan-finished'; snapshot: Snapshot }
  | { kind: 'notion'; notion: NotionStatus };

export type LinkKind = 'github' | 'notion' | 'folder';

export interface SwapChoice { parkName: string; reason: string; revisitOn?: string }
export interface SettingsPatch { developmentFolder?: string; overrides?: Record<string, string>; ignored?: string[]; appearance?: Appearance }

/**
 * Everything the interface may call. Mutating calls run the pure rules in
 * src/shared/rules.ts first and write nothing when a rule rejects the change.
 */
export interface DashboardApi {
  getSnapshot(): Promise<Snapshot>;
  startScan(): Promise<void>;
  onProjectUpdate(listener: (update: ProjectUpdate) => void): () => void;
  setNextAction(name: string, text: string | null): Promise<Result>;
  setCriterion(name: string, blockId: string, checked: boolean): Promise<Result>;
  promote(name: string, swap?: SwapChoice): Promise<Result>;
  park(name: string, reason: string, revisitOn?: string): Promise<Result>;
  kill(name: string): Promise<Result>;
  unpark(name: string): Promise<Result>;
  /** Moves a project whose criteria are all done to General Available and frees its focus slot. */
  markShipped(name: string): Promise<Result>;
  /** Creates a Notion page titled with the folder name, in Not started, and pairs the folder with it. */
  addToNotion(name: string): Promise<Result>;
  /** Hides a folder from the Inbox, or brings it back. */
  ignoreFolder(name: string, ignored: boolean): Promise<Result>;
  /** Pairs a folder with an existing Notion page that no folder matched. */
  linkFolder(name: string, pageId: string): Promise<Result>;
  getSettings(): Promise<PublicSettings>;
  saveSettings(patch: SettingsPatch): Promise<Result>;
  setToken(token: string | null): Promise<Result>;
  /** Opens a project's GitHub page, Notion page or folder. The interface names the project; the main process looks up the URL. */
  openLink(name: string, kind: LinkKind): Promise<Result>;
}

export const CHANNELS = {
  getSnapshot: 'dashboard:getSnapshot',
  startScan: 'dashboard:startScan',
  setNextAction: 'dashboard:setNextAction',
  setCriterion: 'dashboard:setCriterion',
  promote: 'dashboard:promote',
  park: 'dashboard:park',
  kill: 'dashboard:kill',
  unpark: 'dashboard:unpark',
  markShipped: 'dashboard:markShipped',
  addToNotion: 'dashboard:addToNotion',
  ignoreFolder: 'dashboard:ignoreFolder',
  linkFolder: 'dashboard:linkFolder',
  getSettings: 'dashboard:getSettings',
  saveSettings: 'dashboard:saveSettings',
  setToken: 'dashboard:setToken',
  openLink: 'dashboard:openLink',
  /** Main to renderer events. */
  update: 'dashboard:update',
} as const;

export const ok = <T = void>(value?: T): Result<T> => ({ ok: true, value: value as T });
export const fail = (code: ErrorCode, message: string, extra: Partial<ActionError> = {}): Result<never> => ({ ok: false, error: { code, message, ...extra } });

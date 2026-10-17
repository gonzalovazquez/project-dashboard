import { join } from 'node:path';
import { expect } from 'vitest';
import type { ProjectUpdate } from '../src/shared/ipc.js';
import type { Project, ScanResult } from '../src/shared/types.js';
import type { Cache } from '../src/main/app/cache.js';
import { DashboardService, type ServiceDeps } from '../src/main/app/service.js';
import type { SettingsStore, StoredSettings } from '../src/main/app/settings.js';
import { createGateway } from '../src/main/notion/gateway.js';
import { diffSchema } from '../src/main/notion/schema.js';
import { saveSnapshot, type StageSnapshot } from '../src/main/notion/stage.js';
import { completeSchema, liveSchema, makeFakeNotion, page, todo } from './fakeNotion.js';
import { NOW, project, tmp } from './helpers.js';

export interface HarnessOptions {
  token?: string | null;
  scans?: ScanResult[];
  pages?: Array<ReturnType<typeof page>>;
  blocks?: Record<string, ReturnType<typeof todo>[]>;
  schema?: 'complete' | 'live';
  folderExists?: boolean;
  cached?: Project[];
  overrides?: Record<string, string>;
  stageSnapshot?: StageSnapshot;
  secureStorage?: boolean;
  scanDelay?: Promise<void>;
  appearanceLog?: string[];
}

/** A service wired to an in-memory Notion, a fake filesystem view and recording fakes. */
export async function harness(o: HarnessOptions = {}) {
  const fake = makeFakeNotion(2);
  fake.pages = o.pages ?? [];
  fake.blocks = o.blocks ?? {};
  fake.dataSource = (o.schema ?? 'complete') === 'complete' ? completeSchema() : liveSchema();
  const updates: ProjectUpdate[] = [];
  const saved: Array<{ scannedAt?: string; projects: Project[] }> = [];
  const opened: string[] = [];
  const shown: string[] = [];
  const stagePath = join(tmp(), 'stage.json');
  if (o.stageSnapshot) await saveSnapshot(stagePath, o.stageSnapshot);

  let settings: StoredSettings = { developmentFolder: '/dev', overrides: o.overrides ?? {}, appearance: 'system' };
  const settingsStore: SettingsStore = {
    load: async () => settings,
    save: async (patch) => { settings = { ...settings, ...patch }; return settings; },
  };
  const cache: Cache = {
    load: async () => (o.cached ? { version: 1, projects: o.cached } : undefined),
    save: async (d) => { saved.push(d); },
  };
  let token: string | undefined = o.token === null ? undefined : o.token ?? 'secret_token';
  const tokens = {
    secureStorageAvailable: o.secureStorage ?? true,
    get: async () => (token ? { token, source: 'keychain' as const } : { source: 'none' as const }),
    set: async (t: string | null) => {
      if (t && !(o.secureStorage ?? true)) { const { SecureStorageUnavailable } = await import('../src/main/app/secrets.js'); throw new SecureStorageUnavailable(); }
      token = t ?? undefined;
    },
  };
  let backendsMade = 0;
  const deps: ServiceDeps = {
    scanFolders: async (_root, onProject) => { await o.scanDelay; for (const s of o.scans ?? []) onProject(s); return o.scans ?? []; },
    notion: () => { backendsMade++; return { ...createGateway(fake.api), schemaStatus: async () => diffSchema(fake.dataSource) }; },
    cache, settings: settingsStore, tokens: tokens as ServiceDeps['tokens'],
    stageSnapshotPath: stagePath,
    folderExists: async () => o.folderExists ?? true,
    openExternal: async (u) => { opened.push(u); },
    showInFolder: (p) => { shown.push(p); },
    setAppearance: (a) => { o.appearanceLog?.push(a); },
    now: () => NOW,
  };
  const svc = new DashboardService(deps);
  svc.onUpdate((u) => updates.push(u));
  await svc.init();
  return { svc, fake, updates, saved, opened, shown, stagePath, settings: () => settings, setToken: (t?: string) => { token = t; }, backends: () => backendsMade };
}

/** Three tracked projects, an untracked folder, and the matching Notion pages and checklist blocks. */
export function board() {
  const scans = ['alpha', 'beta', 'gamma', 'delta', 'loose'].map((name) => project({ name }));
  const mk = (id: string, title: string, stage: string, focus: boolean, extra: Record<string, unknown> = {}) =>
    page(id, title, stage, { Focus: { checkbox: focus }, Lifecycle: { select: { name: 'Active' } }, 'Stage changed': { date: { start: '2026-09-20' } }, ...extra });
  const pages = [
    mk('pa', 'alpha', 'Beta', true, { 'Next action': { rich_text: [{ plain_text: 'Ship it' }] } }),
    mk('pb', 'beta', 'In progress', true),
    mk('pc', 'gamma', 'Beta', true),
    mk('pd', 'delta', 'Beta', false),
  ];
  const blocks = { pa: [todo('a1', 'Core', true), todo('a2', 'Deploy (3h)')], pb: [], pc: [], pd: [todo('d1', 'One'), todo('d2', 'Two')] };
  return { scans, pages, blocks };
}

export const calls = (h: { fake: { calls: Array<{ op: string; args: unknown }> } }, op?: string) => h.fake.calls.filter((c) => !op || c.op === op);
export const names = (ps: Project[]) => ps.map((p) => p.name);
export async function scanned(o: HarnessOptions = {}) {
  const h = await harness({ ...board(), ...o });
  await h.svc.startScan();
  h.fake.calls.length = 0;
  h.updates.length = 0;
  return h;
}
export const expectFail = (r: { ok: boolean; error?: { code: string } }, code: string) => { expect(r.ok).toBe(false); expect(r.error?.code).toBe(code); };

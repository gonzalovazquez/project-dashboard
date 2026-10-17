import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANNELS, type ProjectUpdate, type Snapshot } from '../src/shared/ipc.js';
import { createFileCache } from '../src/main/app/cache.js';
import { registerIpc, type IpcMainLike } from '../src/main/app/ipc.js';
import { matchNotion } from '../src/main/app/merge.js';
import { SecureStorageUnavailable, TokenStore, type SecretBox } from '../src/main/app/secrets.js';
import { createSettingsStore, defaultSettings, validatePatch } from '../src/main/app/settings.js';
import { unpark } from '../src/shared/rules.js';
import { applyUpdate } from '../src/renderer/src/state.js';
import { writeJsonAtomic } from '../src/main/app/jsonFile.js';
import { board, calls, harness, scanned } from './harness.js';
import { page } from './fakeNotion.js';
import { project, tmp } from './helpers.js';
import { createGateway } from '../src/main/notion/gateway.js';
import { makeFakeNotion } from './fakeNotion.js';

describe('token store', () => {
  const box = (available = true): SecretBox => ({
    isAvailable: () => available,
    encrypt: (s) => Buffer.from('enc:' + Buffer.from(s).toString('base64')),
    decrypt: (b) => Buffer.from(b.toString().replace('enc:', ''), 'base64').toString(),
  });

  it('round-trips through the keychain and never writes the token in plain text', async () => {
    const path = join(tmp(), 'token.bin');
    const store = new TokenStore(path, box(), {});
    await store.set('secret_abc123');
    expect(await store.get()).toEqual({ token: 'secret_abc123', source: 'keychain' });
    expect((await readFile(path)).toString()).not.toContain('secret_abc123');
  });
  it('prefers NOTION_TOKEN from the environment and never stores it', async () => {
    const path = join(tmp(), 'token.bin');
    const store = new TokenStore(path, box(), { NOTION_TOKEN: ' secret_env ' });
    expect(await store.get()).toEqual({ token: 'secret_env', source: 'env' });
    await expect(readFile(path)).rejects.toThrow();
  });
  it('refuses to save when secure storage is unavailable instead of falling back to plain text', async () => {
    const path = join(tmp(), 'token.bin');
    const store = new TokenStore(path, box(false), {});
    await expect(store.set('secret_x')).rejects.toBeInstanceOf(SecureStorageUnavailable);
    await expect(readFile(path)).rejects.toThrow();
    expect((await store.get()).source).toBe('none');
  });
  it('clears the token with null or an empty string', async () => {
    const path = join(tmp(), 'token.bin');
    const store = new TokenStore(path, box(), {});
    await store.set('secret_abc');
    await store.set(null);
    expect((await store.get()).source).toBe('none');
    await store.set('');
    expect((await store.get()).source).toBe('none');
  });
  it('treats a corrupt token file as no token', async () => {
    const path = join(tmp(), 'token.bin');
    await writeJsonAtomic(path, { not: 'bytes' });
    const bad: SecretBox = { ...box(), decrypt: () => { throw new Error('bad data'); } };
    expect((await new TokenStore(path, bad, {}).get()).source).toBe('none');
  });
});

describe('settings, cache and merge', () => {
  it('defaults to ~/Development and saves patches', async () => {
    const path = join(tmp(), 's.json');
    const store = createSettingsStore(path);
    expect(await store.load()).toEqual(defaultSettings());
    await store.save({ developmentFolder: '/Users/g/Code' });
    await store.save({ overrides: { a: 'p1' } });
    expect(await createSettingsStore(path).load()).toEqual({ developmentFolder: '/Users/g/Code', overrides: { a: 'p1' }, ignored: [], groups: {}, appearance: 'system', reviewDay: 5, reviewTime: '16:00', reviewReminder: true, onboarded: false, lastReviewAt: undefined });
    await store.save({ appearance: 'dark' });
    expect((await createSettingsStore(path).load()).appearance).toBe('dark');
  });
  it('rejects bad settings', async () => {
    expect(validatePatch({ developmentFolder: 'relative' })).toContain('absolute');
    expect(validatePatch({ overrides: { a: '' } })).toBeDefined();
    expect(validatePatch({ appearance: 'purple' as never })).toContain('Appearance');
    expect(validatePatch({ developmentFolder: '/ok', overrides: { a: 'p' }, appearance: 'dark' })).toBeUndefined();
    await expect(createSettingsStore(join(tmp(), 's.json')).save({ developmentFolder: 'x' })).rejects.toThrow();
  });
  it('round-trips the cache and ignores other versions and corrupt files', async () => {
    const path = join(tmp(), 'c.json');
    const cache = createFileCache(path);
    expect(await cache.load()).toBeUndefined();
    await cache.save({ scannedAt: '2026-10-12T00:00:00Z', projects: [project({ name: 'a' })] });
    expect((await cache.load())!.projects[0].name).toBe('a');
    await writeJsonAtomic(path, { version: 99, projects: [] });
    expect(await cache.load()).toBeUndefined();
    await writeJsonAtomic(path, 'nope');
    expect(await cache.load()).toBeUndefined();
  });
  it('matches folders to parsed pages only and lists the rest as unmatched', async () => {
    const f = makeFakeNotion(5);
    f.pages = [page('p1', 'Dark Factory', 'Beta'), page('p2', 'Mystery', 'Someday')];
    const loaded = await createGateway(f.api).loadProjects();
    const r = matchNotion(['dark-factory', 'mystery', 'other'], loaded);
    expect([...r.infoByFolder.keys()]).toEqual(['dark-factory']);
    expect(r.unmatched).toEqual(['mystery', 'other']);
  });
});

describe('renderer state', () => {
  const snap = (over: Partial<Snapshot> = {}): Snapshot => ({ projects: [project({ name: 'a' })], scanning: false, stageHistory: [], unlinkedPages: [], notion: { state: 'connected' }, settings: { developmentFolder: '/d', overrides: {}, ignored: [], groups: {}, tokenSource: 'none', secureStorageAvailable: true, appearance: 'system', reviewDay: 5, reviewTime: '16:00', reviewReminder: true, onboarded: false }, ...over });
  it('adds and replaces projects as they stream in', () => {
    let s = applyUpdate(snap(), { kind: 'project', project: project({ name: 'b' }) })!;
    expect(s.projects.map((p) => p.name)).toEqual(['a', 'b']);
    s = applyUpdate(s, { kind: 'project', project: project({ name: 'a', dirty: true }) })!;
    expect(s.projects).toHaveLength(2);
    expect(s.projects[0].dirty).toBe(true);
  });
  it('tracks scanning state and replaces everything when a scan finishes', () => {
    expect(applyUpdate(snap(), { kind: 'scan-started' })!.scanning).toBe(true);
    const final = snap({ projects: [] });
    expect(applyUpdate(snap(), { kind: 'scan-finished', snapshot: final })).toBe(final);
  });
  it('ignores updates before the first snapshot except a finished scan', () => {
    expect(applyUpdate(undefined, { kind: 'scan-started' })).toBeUndefined();
    const u: ProjectUpdate = { kind: 'scan-finished', snapshot: snap() };
    expect(applyUpdate(undefined, u)).toBe((u as { snapshot: Snapshot }).snapshot);
  });
});

describe('unpark rule', () => {
  it('returns a parked project to active without giving it a focus slot', () => {
    const ps = [project({ name: 'a' }, { life: 'parked', focus: false, parkReason: 'x', revisitOn: '2026-11-01' })];
    expect(unpark(ps, 'a')[0].notion).toMatchObject({ life: 'active', focus: false, parkReason: undefined, revisitOn: undefined });
  });
});

describe('IPC registration', () => {
  async function wired(trusted = true) {
    const h = await scanned();
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const ipc: IpcMainLike = { handle: (c, fn) => { handlers.set(c, fn); } };
    const logs: string[] = [];
    registerIpc(ipc, h.svc, { isTrusted: () => trusted, log: (m) => logs.push(m) });
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args) as Promise<{ ok: boolean; error?: { code: string; message: string } }>;
    return { h, call, handlers, logs };
  }

  it('registers every channel except the event channel', async () => {
    const { handlers } = await wired();
    const expected = Object.values(CHANNELS).filter((c) => c !== CHANNELS.update).sort();
    expect([...handlers.keys()].sort()).toEqual(expected);
  });
  it('rejects messages that did not come from the app window', async () => {
    const { call, h } = await wired(false);
    const r = await call(CHANNELS.kill, 'beta');
    expect(r).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(calls(h)).toEqual([]);
  });
  it('rejects malformed arguments before they reach the service', async () => {
    const { call, h } = await wired();
    for (const [channel, ...args] of [
      [CHANNELS.kill, 42], [CHANNELS.markShipped, 7], [CHANNELS.kill, ''], [CHANNELS.kill, 'x'.repeat(300)],
      [CHANNELS.setCriterion, 'alpha', 'a1', 'yes'],
      [CHANNELS.park, 'beta', 'reason', 'next tuesday'],
      [CHANNELS.promote, 'delta', 'not an object'],
      [CHANNELS.promote, 'delta', { parkName: 5, reason: 'x' }],
      [CHANNELS.saveSettings, 'nope'], [CHANNELS.saveSettings, { overrides: [1] }], [CHANNELS.saveSettings, { appearance: 'purple' }],
      [CHANNELS.openLink, 'alpha', 'javascript'],
      [CHANNELS.setToken, 12345],
      [CHANNELS.addToNotion, 5], [CHANNELS.ignoreFolder, 'loose', 'yes'], [CHANNELS.ignoreFolder, 7, true], [CHANNELS.linkFolder, 'loose', ''], [CHANNELS.linkFolder, 'loose'],
      [CHANNELS.saveSettings, { ignored: 'loose' }], [CHANNELS.saveSettings, { ignored: [3] }],
    ] as unknown[][]) {
      const r = await call(channel as string, ...args);
      expect(r, `${channel} ${JSON.stringify(args)}`).toMatchObject({ ok: false, error: { code: 'invalid' } });
    }
    expect(calls(h)).toEqual([]);
  });
  it('passes valid calls to the service', async () => {
    const { call, h } = await wired();
    expect((await call(CHANNELS.setNextAction, 'beta', 'Do it')).ok).toBe(true);
    expect((await call(CHANNELS.setCriterion, 'alpha', 'a2', true)).ok).toBe(true);
    expect((await call(CHANNELS.park, 'gamma', 'blocked', '2026-11-12')).ok).toBe(true);
    expect(calls(h)).toHaveLength(3);
    expect(await call(CHANNELS.promote, 'delta')).toMatchObject({ ok: true });
  });
  it('returns the full-slots error with who is in focus', async () => {
    const { call } = await wired();
    const r = (await call(CHANNELS.promote, 'delta')) as unknown as { ok: boolean; error: { code: string; focus: string[] } };
    expect(r.error.code).toBe('full');
    expect(r.error.focus).toHaveLength(3);
  });
  it('masks unexpected errors and logs the details', async () => {
    const { h, call, logs } = await wired();
    h.svc.getSnapshot = async () => { throw new Error('/Users/secret/path exploded'); };
    const r = await call(CHANNELS.getSnapshot);
    expect(r).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(JSON.stringify(r)).not.toContain('secret/path');
    expect(logs).toEqual([`IPC ${CHANNELS.getSnapshot} failed`]);
  });
  it('never exposes the token through the snapshot or settings channels', async () => {
    const { call } = await wired();
    expect(JSON.stringify(await call(CHANNELS.getSnapshot))).not.toContain('secret_token');
    expect(JSON.stringify(await call(CHANNELS.getSettings))).not.toContain('secret_token');
  });
});

describe('board fixture sanity', () => {
  it('has three focus projects and one candidate', async () => {
    const h = await harness(board());
    await h.svc.startScan();
    const ps = (await h.svc.getSnapshot()).projects;
    expect(ps.filter((p) => p.notion?.focus)).toHaveLength(3);
    expect(ps.filter((p) => p.notion && !p.notion.focus)).toHaveLength(1);
  });
});

import { isTrustedUrl } from '../src/main/app/trust.js';

describe('trusted sender', () => {
  const prod = { indexFileUrl: 'file:///Applications/Project%20Dashboard.app/Contents/Resources/app/out/renderer/index.html' };
  const dev = { devUrl: 'http://localhost:5173', indexFileUrl: prod.indexFileUrl };
  it('accepts exactly the built page, with or without a hash or query', () => {
    expect(isTrustedUrl(prod.indexFileUrl, prod)).toBe(true);
    expect(isTrustedUrl(prod.indexFileUrl + '#/overview?x=1', prod)).toBe(true);
  });
  it('rejects any other file, even one with a similar name', () => {
    expect(isTrustedUrl('file:///tmp/evil/renderer/index.html', prod)).toBe(false);
    expect(isTrustedUrl('file:///Applications/Project%20Dashboard.app/Contents/Resources/app/out/renderer/other.html', prod)).toBe(false);
  });
  it('rejects remote pages, garbage and empty values in production', () => {
    for (const u of ['https://example.com/', 'http://localhost:5173/', 'not a url', '', 'data:text/html,hi']) expect(isTrustedUrl(u, prod), u).toBe(false);
  });
  it('trusts only the dev server origin while developing', () => {
    expect(isTrustedUrl('http://localhost:5173/', dev)).toBe(true);
    expect(isTrustedUrl('http://localhost:5173/src/main.tsx', dev)).toBe(true);
    expect(isTrustedUrl('http://localhost:5174/', dev)).toBe(false);
    expect(isTrustedUrl('http://evil.test/', dev)).toBe(false);
    expect(isTrustedUrl(prod.indexFileUrl, dev)).toBe(false);
  });
});

describe('renderer state: meta updates', () => {
  it('replaces settings and unlinked pages and leaves projects alone', async () => {
    const { applyUpdate } = await import('../src/renderer/src/state.js');
    const prev = { projects: [project({ name: 'a' })], scanning: false, stageHistory: [], unlinkedPages: [], notion: { state: 'connected' }, settings: { developmentFolder: '/d', overrides: {}, ignored: [], groups: {}, tokenSource: 'none', secureStorageAvailable: true, appearance: 'system', reviewDay: 5, reviewTime: '16:00', reviewReminder: true, onboarded: false } } as unknown as Snapshot;
    const next = applyUpdate(prev, { kind: 'meta', settings: { ...prev.settings, onboarded: true, ignored: ['x'] }, unlinkedPages: [{ id: 'u', title: 'T', url: 'https://n', stage: 'Beta' }] })!;
    expect(next.settings).toMatchObject({ onboarded: true, ignored: ['x'] });
    expect(next.unlinkedPages).toHaveLength(1);
    expect(next.projects).toBe(prev.projects);
    expect(applyUpdate(undefined, { kind: 'meta', settings: prev.settings, unlinkedPages: [] })).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import type { Project } from '../src/shared/types.js';
import { loadSnapshot } from '../src/main/notion/stage.js';
import { board, calls, expectFail, harness, names, scanned } from './harness.js';
import { page, todo } from './fakeNotion.js';
import { NOW, project } from './helpers.js';

describe('startup and scanning', () => {
  it('loads the cached projects before any scan', async () => {
    const cached = [project({ name: 'old' })];
    const h = await harness({ cached });
    expect(names((await h.svc.getSnapshot()).projects)).toEqual(['old']);
  });

  it('scans without a token: progressive updates, no Notion data, a clear status', async () => {
    const h = await harness({ ...board(), token: null });
    await h.svc.startScan();
    const kinds = h.updates.map((u) => u.kind);
    expect(kinds[0]).toBe('scan-started');
    expect(kinds.filter((k) => k === 'project')).toHaveLength(5);
    expect(kinds.at(-1)).toBe('scan-finished');
    const snap = await h.svc.getSnapshot();
    expect(snap.scanning).toBe(false);
    expect(snap.notion.state).toBe('not-configured');
    expect(snap.projects.every((p) => !p.notion)).toBe(true);
    expect(h.saved).toHaveLength(1);
    expect(h.fake.queries).toBe(0);
  });

  it('merges Notion data into matched folders and leaves the rest untracked', async () => {
    const h = await harness(board());
    await h.svc.startScan();
    const snap = await h.svc.getSnapshot();
    expect(snap.notion).toMatchObject({ state: 'connected', pages: 4 });
    const by = Object.fromEntries(snap.projects.map((p) => [p.name, p]));
    expect(by.alpha.notion).toMatchObject({ stage: 'Beta', focus: true, nextAction: 'Ship it' });
    expect(by.alpha.notion!.criteria.map((c) => c.blockId)).toEqual(['a1', 'a2']);
    expect(by.loose.notion).toBeUndefined();
  });

  it('applies folder overrides from settings', async () => {
    const b = board();
    const h = await harness({ ...b, scans: [...b.scans, project({ name: 'chicken-friends' })], pages: [...b.pages, (await import('./fakeNotion.js')).page('pf', 'Flockchat', 'In progress')], overrides: { 'chicken-friends': 'pf' } });
    await h.svc.startScan();
    expect((await h.svc.getSnapshot()).projects.find((p) => p.name === 'chicken-friends')!.notion!.title).toBe('Flockchat');
  });

  it('reports a missing Development folder and keeps what it had', async () => {
    const h = await harness({ ...board(), folderExists: false, cached: [project({ name: 'old' })] });
    await h.svc.startScan();
    const snap = await h.svc.getSnapshot();
    expect(snap.scanError).toContain('does not exist');
    expect(names(snap.projects)).toEqual(['old']);
    expect(snap.scanning).toBe(false);
  });

  it('runs one scan at a time and shares the result', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const h = await harness({ ...board(), scanDelay: gate });
    const a = h.svc.startScan();
    const b = h.svc.startScan();
    release();
    await Promise.all([a, b]);
    expect(h.updates.filter((u) => u.kind === 'scan-started')).toHaveLength(1);
    expect(h.fake.queries).toBe(2);
  });

  it('shows the last known Notion data when Notion is unreachable', async () => {
    const b = board();
    const h = await harness({ ...b });
    await h.svc.startScan();
    h.fake.failNext('query', 'ENOTFOUND api.notion.com');
    await h.svc.startScan();
    const snap = await h.svc.getSnapshot();
    expect(snap.notion.state).toBe('error');
    expect(snap.notion.message).toContain('ENOTFOUND');
    expect(snap.projects.find((p) => p.name === 'alpha')!.notion).toBeDefined();
  });

  it('flags a database that is missing the app properties and does not write to it', async () => {
    const h = await harness({ ...board(), schema: 'live' });
    await h.svc.startScan();
    expect((await h.svc.getSnapshot()).notion.state).toBe('schema-missing');
    expect(calls(h)).toEqual([]);
  });
});

describe('stage change stamping', () => {
  const baseline = { pa: { stage: 'Beta' as const, seenAt: 'x' }, pb: { stage: 'In progress' as const, seenAt: 'x' }, pc: { stage: 'Beta' as const, seenAt: 'x' }, pd: { stage: 'Beta' as const, seenAt: 'x' } };

  it('treats the first scan as a baseline and writes nothing', async () => {
    const h = await harness(board());
    await h.svc.startScan();
    expect(calls(h)).toEqual([]);
  });

  it('stamps Stage changed with today for a page whose status moved', async () => {
    const b = board();
    b.pages[1] = (await import('./fakeNotion.js')).page('pb', 'beta', 'Beta', { Focus: { checkbox: true }, Lifecycle: { select: { name: 'Active' } } });
    const h = await harness({ ...b, stageSnapshot: baseline });
    await h.svc.startScan();
    expect(calls(h, 'pages.update')).toEqual([{ op: 'pages.update', args: { page_id: 'pb', properties: { 'Stage changed': { date: { start: '2026-10-12' } } } } }]);
    expect((await h.svc.getSnapshot()).projects.find((p) => p.name === 'beta')!.notion!.stageChangedAt).toBe('2026-10-12');
  });

  it('keeps the old snapshot when a stamp fails, so the next scan retries', async () => {
    const b = board();
    b.pages[1] = (await import('./fakeNotion.js')).page('pb', 'beta', 'Beta', { Focus: { checkbox: true }, Lifecycle: { select: { name: 'Active' } } });
    const h = await harness({ ...b, stageSnapshot: baseline });
    h.fake.failNext('pages.update', 'conflict');
    await h.svc.startScan();
    expect(calls(h)).toEqual([]);
    await h.svc.startScan();
    expect(calls(h, 'pages.update')).toHaveLength(1);
  });
});

describe('focus changes', () => {
  it('promotes into an open slot with one write', async () => {
    const h = await scanned();
    await h.svc.park('gamma', 'blocked', '2026-11-12');
    h.fake.calls.length = 0;
    const r = await h.svc.promote('delta');
    expect(r.ok).toBe(true);
    expect(calls(h)).toEqual([{ op: 'pages.update', args: { page_id: 'pd', properties: { Focus: { checkbox: true } } } }]);
    expect((await h.svc.getSnapshot()).projects.find((p) => p.name === 'delta')!.notion!.focus).toBe(true);
  });

  it('refuses a fourth focus project, names who is in focus, and writes nothing', async () => {
    const h = await scanned();
    const r = await h.svc.promote('delta');
    expectFail(r, 'full');
    expect((r as { error: { focus: string[] } }).error.focus.sort()).toEqual(['alpha', 'beta', 'gamma']);
    expect(calls(h)).toEqual([]);
    expect((await h.svc.getSnapshot()).projects.filter((p) => p.notion?.focus)).toHaveLength(3);
  });

  it('parks one project and promotes another in a single action', async () => {
    const h = await scanned();
    const r = await h.svc.promote('delta', { parkName: 'beta', reason: 'blocked on API', revisitOn: '2026-11-12' });
    expect(r.ok).toBe(true);
    const writes = calls(h, 'pages.update').map((c) => c.args);
    expect(writes).toHaveLength(2);
    const by = Object.fromEntries((await h.svc.getSnapshot()).projects.map((p) => [p.name, p.notion]));
    expect(by.beta).toMatchObject({ life: 'parked', focus: false, parkReason: 'blocked on API', revisitOn: '2026-11-12' });
    expect(by.delta!.focus).toBe(true);
  });

  it('undoes the first write and changes nothing when the second write fails', async () => {
    const h = await scanned();
    let n = 0;
    const real = h.fake.api.pages.update;
    h.fake.api.pages.update = async (a) => { if (++n === 2) throw new Error('rate limited'); return real(a); };
    const before = JSON.stringify((await h.svc.getSnapshot()).projects);
    const r = await h.svc.promote('delta', { parkName: 'beta', reason: 'blocked', revisitOn: '2026-11-12' });
    expectFail(r, 'notion-write-failed');
    expect((r as { error: { message: string } }).error.message).toContain('Earlier changes were undone');
    h.fake.api.pages.update = real;
    // the first write was a park of beta, so the revert restores Focus, Lifecycle and the cleared park fields
    const revert = calls(h, 'pages.update')[1].args as { page_id: string; properties: Record<string, unknown> };
    expect(revert.page_id).toBe('pb');
    expect(revert.properties).toMatchObject({ Focus: { checkbox: true }, Lifecycle: { select: { name: 'Active' } } });
    expect(JSON.stringify((await h.svc.getSnapshot()).projects)).toBe(before);
  });

  it('requires a reason and a revisit date to park', async () => {
    const h = await scanned();
    expectFail(await h.svc.park('beta', '  ', '2026-11-12'), 'invalid');
    expectFail(await h.svc.park('beta', 'blocked', undefined), 'invalid');
    expectFail(await h.svc.promote('delta', { parkName: 'beta', reason: '', revisitOn: '2026-11-12' }), 'invalid');
    expectFail(await h.svc.promote('delta', { parkName: 'beta', reason: 'x' }), 'invalid');
    expect(calls(h)).toEqual([]);
  });

  it('parks, unparks and kills', async () => {
    const h = await scanned();
    expect((await h.svc.park('beta', 'blocked', '2026-11-12')).ok).toBe(true);
    expect((await h.svc.unpark('beta')).ok).toBe(true);
    const beta = (await h.svc.getSnapshot()).projects.find((p) => p.name === 'beta')!.notion!;
    expect(beta).toMatchObject({ life: 'active', focus: false, parkReason: undefined, revisitOn: undefined });
    expect((await h.svc.kill('beta')).ok).toBe(true);
    expect((await h.svc.getSnapshot()).projects.find((p) => p.name === 'beta')!.notion!.life).toBe('killed');
    expectFail(await h.svc.unpark('delta'), 'not-eligible');
  });

  it('rejects unknown and untracked projects', async () => {
    const h = await scanned();
    expectFail(await h.svc.park('nope', 'x', '2026-11-12'), 'not-found');
    expectFail(await h.svc.park('loose', 'x', '2026-11-12'), 'no-notion');
    expectFail(await h.svc.promote('loose'), 'not-eligible');
    expect(calls(h)).toEqual([]);
  });

  it('blocks property writes while the Notion schema is incomplete', async () => {
    const h = await harness({ ...board(), schema: 'live' });
    await h.svc.startScan();
    expectFail(await h.svc.park('beta', 'x', '2026-11-12'), 'schema-missing');
    expectFail(await h.svc.setNextAction('alpha', 'x'), 'schema-missing');
    expect(calls(h)).toEqual([]);
  });

  it('blocks changes while a scan is running', async () => {
    let release!: () => void;
    const h = await harness({ ...board(), scanDelay: new Promise<void>((r) => { release = r; }) });
    const scan = h.svc.startScan();
    expectFail(await h.svc.kill('beta'), 'busy');
    release();
    await scan;
  });

  it('needs a token to change anything', async () => {
    const h = await scanned();
    h.setToken(undefined);
    expectFail(await h.svc.kill('beta'), 'no-notion');
  });
});

describe('next action and criteria', () => {
  it('saves and clears a next action', async () => {
    const h = await scanned();
    expect((await h.svc.setNextAction('beta', '  Wire the sandbox  ')).ok).toBe(true);
    expect(calls(h)[0].args).toEqual({ page_id: 'pb', properties: { 'Next action': { rich_text: [{ type: 'text', text: { content: 'Wire the sandbox' } }] } } });
    const get = async () => (await h.svc.getSnapshot()).projects.find((p) => p.name === 'beta')!.notion!.nextAction;
    expect(await get()).toBe('Wire the sandbox');
    await h.svc.setNextAction('beta', '   ');
    expect(await get()).toBeUndefined();
  });

  it('keeps the old value when the write fails', async () => {
    const h = await scanned();
    h.fake.failNext('pages.update', 'conflict');
    expectFail(await h.svc.setNextAction('alpha', 'New'), 'notion-write-failed');
    expect((await h.svc.getSnapshot()).projects.find((p) => p.name === 'alpha')!.notion!.nextAction).toBe('Ship it');
  });

  it('checks a criterion in Notion and records when', async () => {
    const h = await scanned();
    expect((await h.svc.setCriterion('alpha', 'a2', true)).ok).toBe(true);
    expect(calls(h)[0]).toEqual({ op: 'blocks.update', args: { block_id: 'a2', to_do: { checked: true } } });
    const c = (await h.svc.getSnapshot()).projects.find((p) => p.name === 'alpha')!.notion!.criteria[1];
    expect(c).toMatchObject({ done: true, doneOn: NOW.toISOString() });
    await h.svc.setCriterion('alpha', 'a2', false);
    expect((await h.svc.getSnapshot()).projects.find((p) => p.name === 'alpha')!.notion!.criteria[1]).toMatchObject({ done: false, doneOn: undefined });
  });

  it('still works when only the new properties are missing', async () => {
    const h = await harness({ ...board(), schema: 'live' });
    await h.svc.startScan();
    expect((await h.svc.setCriterion('alpha', 'a2', true)).ok).toBe(true);
  });

  it('reports a criterion that is no longer on the page', async () => {
    const h = await scanned();
    expectFail(await h.svc.setCriterion('alpha', 'gone', true), 'not-found');
    expect(calls(h)).toEqual([]);
  });

  it('keeps the old state when the criterion write fails', async () => {
    const h = await scanned();
    h.fake.failNext('blocks.update', 'locked');
    expectFail(await h.svc.setCriterion('alpha', 'a2', true), 'notion-write-failed');
    expect((await h.svc.getSnapshot()).projects.find((p) => p.name === 'alpha')!.notion!.criteria[1].done).toBe(false);
  });
});

describe('links, settings and token', () => {
  it('opens only URLs and paths that belong to a known project', async () => {
    const b = board();
    b.scans[0] = project({ name: 'alpha', github: 'https://github.com/g/alpha' });
    const h = await harness(b);
    await h.svc.startScan();
    expect((await h.svc.openLink('alpha', 'github')).ok).toBe(true);
    expect((await h.svc.openLink('alpha', 'notion')).ok).toBe(true);
    expect((await h.svc.openLink('alpha', 'folder')).ok).toBe(true);
    expect(h.opened).toEqual(['https://github.com/g/alpha', 'https://notion.so/pa']);
    expect(h.shown).toEqual(['/dev/alpha']);
    expectFail(await h.svc.openLink('beta', 'github'), 'not-found');
    expectFail(await h.svc.openLink('loose', 'notion'), 'not-found');
    expectFail(await h.svc.openLink('nope', 'folder'), 'not-found');
  });

  it('validates and saves settings', async () => {
    const h = await harness({ ...board() });
    expectFail(await h.svc.saveSettings({ developmentFolder: 'relative/path' }), 'invalid');
    expectFail(await h.svc.saveSettings({ overrides: { '': 'id' } }), 'invalid');
    expect((await h.svc.saveSettings({ developmentFolder: '/Users/g/Dev', overrides: { a: 'p1' } })).ok).toBe(true);
    expect(h.settings()).toEqual({ developmentFolder: '/Users/g/Dev', overrides: { a: 'p1' }, appearance: 'system' });
    const missing = await harness({ ...board(), folderExists: false });
    expectFail(await missing.svc.saveSettings({ developmentFolder: '/nowhere' }), 'invalid');
  });

  it('applies the appearance when saved and on startup', async () => {
    const log: string[] = [];
    const h = await harness({ ...board(), appearanceLog: log });
    expect(log).toEqual(['system']);
    expect((await h.svc.saveSettings({ appearance: 'dark' })).ok).toBe(true);
    expect(log).toEqual(['system', 'dark']);
    expect((await h.svc.getSettings()).appearance).toBe('dark');
    expectFail(await h.svc.saveSettings({ appearance: 'purple' as never }), 'invalid');
    expect(log).toEqual(['system', 'dark']);
  });

  it('never returns the token in settings', async () => {
    const h = await harness({ ...board(), token: 'secret_abc' });
    const s = await h.svc.getSettings();
    expect(JSON.stringify(s)).not.toContain('secret_abc');
    expect(s.tokenSource).toBe('keychain');
  });

  it('refuses to store a token when secure storage is unavailable', async () => {
    const h = await harness({ ...board(), token: null, secureStorage: false });
    expectFail(await h.svc.setToken('secret_x'), 'no-secure-storage');
    expect((await h.svc.getSettings()).tokenSource).toBe('none');
  });

  it('uses a new token for the next request and clears with null', async () => {
    const h = await scanned();
    const made = h.backends();
    expect((await h.svc.setToken('secret_new')).ok).toBe(true);
    await h.svc.kill('beta');
    expect(h.backends()).toBe(made + 1);
    expect((await h.svc.setToken(null)).ok).toBe(true);
    expectFail(await h.svc.kill('delta'), 'no-notion');
  });
});

export type { Project };

describe('shipping a project', () => {
  /** alpha is in focus with every criterion done; beta and gamma are in focus too. */
  async function finished() {
    const b = board();
    b.blocks.pa = [todo('a1', 'Core', true), todo('a2', 'Deploy', true)];
    return scanned(b);
  }

  it('writes the stage, the date and the freed slot in one update', async () => {
    const h = await finished();
    const r = await h.svc.markShipped('alpha');
    expect(r.ok).toBe(true);
    expect(calls(h, 'pages.update')).toEqual([{ op: 'pages.update', args: { page_id: 'pa', properties: {
      Status: { status: { name: 'General Available' } }, Focus: { checkbox: false }, 'Stage changed': { date: { start: '2026-10-12' } },
    } } }]);
    const snap = await h.svc.getSnapshot();
    expect(snap.projects.find((p) => p.name === 'alpha')!.notion).toMatchObject({ stage: 'General Available', focus: false, stageChangedAt: '2026-10-12' });
    expect(snap.projects.filter((p) => p.notion?.focus)).toHaveLength(2);
    expect(h.updates.some((u) => u.kind === 'project' && u.project.name === 'alpha')).toBe(true);
  });

  it('lets another project take the freed slot', async () => {
    const h = await finished();
    await h.svc.markShipped('alpha');
    expect((await h.svc.promote('delta')).ok).toBe(true);
  });

  it('tells the stage snapshot about it so the next scan does not stamp the page again', async () => {
    const h = await finished();
    await h.svc.markShipped('alpha');
    expect((await loadSnapshot(h.stagePath)).pa.stage).toBe('General Available');
  });

  it('refuses with a clear message while a criterion is open, and writes nothing', async () => {
    const h = await scanned();
    const r = await h.svc.markShipped('alpha');
    expectFail(r, 'criteria-open');
    expect((r as { error: { message: string } }).error.message).toBe('1 criterion is still open on alpha.');
    expect(calls(h)).toEqual([]);
  });

  it('refuses a project with no criteria', async () => {
    const h = await scanned();
    expectFail(await h.svc.markShipped('beta'), 'no-criteria');
    expect(calls(h)).toEqual([]);
  });

  it('refuses unknown, untracked and already shipped projects', async () => {
    const h = await finished();
    expectFail(await h.svc.markShipped('nope'), 'not-found');
    expectFail(await h.svc.markShipped('loose'), 'not-eligible');
    await h.svc.markShipped('alpha');
    expectFail(await h.svc.markShipped('alpha'), 'not-eligible');
  });

  it('leaves everything as it was when Notion rejects the write', async () => {
    const h = await finished();
    h.fake.failNext('pages.update', 'conflict');
    const r = await h.svc.markShipped('alpha');
    expectFail(r, 'notion-write-failed');
    expect((await h.svc.getSnapshot()).projects.find((p) => p.name === 'alpha')!.notion).toMatchObject({ stage: 'Beta', focus: true });
    expect((await loadSnapshot(h.stagePath)).pa.stage).toBe('Beta'); // still the baseline from the first scan
  });

  it('is blocked while the Notion schema is incomplete, like every other property write', async () => {
    const b = board();
    b.blocks.pa = [todo('a1', 'Core', true)];
    const h = await harness({ ...b, schema: 'live' });
    await h.svc.startScan();
    expectFail(await h.svc.markShipped('alpha'), 'schema-missing');
  });
});

export { page };

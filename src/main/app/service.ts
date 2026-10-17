import { join } from 'node:path';
import type { NotionInfo, Project, ScanResult, StagePoint } from '../../shared/types.js';
import {
  fail, ok,
  type Appearance, type LinkKind, type NotionStatus, type ProjectUpdate, type PublicSettings, type Result, type SettingsPatch, type Snapshot, type SwapChoice, type UnlinkedPage,
} from '../../shared/ipc.js';
import { kill, park, promote, ship, unpark } from '../../shared/rules.js';
import { applyReview, reviewNote, type ReviewOutcome, type ReviewPlan } from '../../shared/review.js';
import type { NotionBackend } from '../notion/backend.js';
import type { PageChange } from '../notion/gateway.js';
import { hasChanges } from '../notion/schema.js';
import { detectStageChanges, loadSnapshot, saveSnapshot } from '../notion/stage.js';
import type { Cache } from './cache.js';
import { localDate, stageCounts, type HistoryStore } from './history.js';
import { matchNotion, mergeProjects, toProject } from './merge.js';
import { SecureStorageUnavailable, type TokenStore } from './secrets.js';
import { validatePatch, type SettingsStore } from './settings.js';

export interface ServiceDeps {
  scanFolders(root: string, onProject: (p: ScanResult) => void, now: Date): Promise<ScanResult[]>;
  notion(token: string): NotionBackend;
  cache: Cache;
  /** Optional so tests that do not care about history stay small. */
  history?: HistoryStore;
  settings: SettingsStore;
  tokens: Pick<TokenStore, 'get' | 'set' | 'secureStorageAvailable'>;
  stageSnapshotPath: string;
  /** Scans one folder. Optional so tests that never refresh a single project stay small. */
  scanProject?(dir: string, name: string, now: Date): Promise<ScanResult>;
  /** Opens the system folder picker. */
  chooseFolder?(defaultPath?: string): Promise<string | null>;
  folderExists(path: string): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  showInFolder(path: string): void;
  /** Applies the light, dark or system appearance to the window and native effects. */
  setAppearance?(appearance: Appearance): void;
  now?: () => Date;
}

type RuleOutcome = { ok: true; projects: Project[] } | { ok: false; error: Extract<Result, { ok: false }>['error'] };

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What changed on a page between two versions, and how to undo it. Rules and the weekly review change focus, lifecycle and next-action fields. */
function diffNotion(before: NotionInfo, after: NotionInfo): { change: PageChange; revert: PageChange } | undefined {
  const change: PageChange = {};
  const revert: PageChange = {};
  if (before.focus !== after.focus) { change.focus = after.focus; revert.focus = before.focus; }
  if (before.nextAction !== after.nextAction) { change.nextAction = after.nextAction ?? null; revert.nextAction = before.nextAction ?? null; }
  if (before.stage !== after.stage) { change.stage = after.stage; revert.stage = before.stage; }
  if (before.stageChangedAt !== after.stageChangedAt) { change.stageChangedAt = after.stageChangedAt ?? null; revert.stageChangedAt = before.stageChangedAt ?? null; }
  if (before.life !== after.life) { change.life = after.life; revert.life = before.life; }
  if (before.parkReason !== after.parkReason) { change.parkReason = after.parkReason ?? null; revert.parkReason = before.parkReason ?? null; }
  if (before.revisitOn !== after.revisitOn) { change.revisitOn = after.revisitOn ?? null; revert.revisitOn = before.revisitOn ?? null; }
  return Object.keys(change).length ? { change, revert } : undefined;
}

export class DashboardService {
  private projects: Project[] = [];
  private scannedAt?: string;
  private scanning = false;
  private scanError?: string;
  private notion: NotionStatus = { state: 'not-configured' };
  private stageHistory: StagePoint[] = [];
  private unlinked: Array<UnlinkedPage & { info: NotionInfo }> = [];
  private running?: Promise<void>;
  private listeners = new Set<(u: ProjectUpdate) => void>();
  private backend?: { token: string; api: NotionBackend };

  constructor(private d: ServiceDeps) {}

  private now = () => (this.d.now ?? (() => new Date()))();

  /** Loads the last known projects so there is something to show before the first scan finishes. */
  async init(): Promise<void> {
    const cached = await this.d.cache.load();
    if (cached) { this.projects = cached.projects; this.scannedAt = cached.scannedAt; }
    this.d.setAppearance?.((await this.d.settings.load()).appearance);
    this.stageHistory = (await this.d.history?.load()) ?? [];
  }

  onUpdate(listener: (u: ProjectUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(u: ProjectUpdate) { for (const l of this.listeners) l(u); }

  async getSettings(): Promise<PublicSettings> {
    const s = await this.d.settings.load();
    const { source } = await this.d.tokens.get();
    return { developmentFolder: s.developmentFolder, overrides: s.overrides, tokenSource: source, secureStorageAvailable: this.d.tokens.secureStorageAvailable, appearance: s.appearance, ignored: s.ignored, reviewDay: s.reviewDay, reviewTime: s.reviewTime, reviewReminder: s.reviewReminder, onboarded: s.onboarded, lastReviewAt: s.lastReviewAt };
  }

  async getSnapshot(): Promise<Snapshot> {
    return { projects: this.projects, scannedAt: this.scannedAt, scanning: this.scanning, scanError: this.scanError, notion: this.notion, settings: await this.getSettings(), stageHistory: this.stageHistory, unlinkedPages: this.unlinked.map(({ info: _info, ...u }) => u) };
  }

  private getBackend(token: string): NotionBackend {
    if (this.backend?.token !== token) this.backend = { token, api: this.d.notion(token) };
    return this.backend.api;
  }

  // ---------- scanning

  startScan(): Promise<void> {
    if (!this.running) this.running = this.doScan().finally(() => { this.running = undefined; });
    return this.running;
  }

  /** Tells the interface that settings or the unlinked pages changed, since those are not part of any project. */
  private async emitMeta() {
    const s = await this.getSnapshot();
    this.emit({ kind: 'meta', settings: s.settings, unlinkedPages: s.unlinkedPages });
  }

  private upsert(p: Project) {
    const i = this.projects.findIndex((x) => x.name === p.name);
    if (i >= 0) this.projects[i] = p; else this.projects.push(p);
  }

  private async pullNotion(token: string) {
    try {
      const backend = this.getBackend(token);
      const [loaded, diff] = await Promise.all([backend.loadProjects(), backend.schemaStatus()]);
      return { backend, loaded, diff };
    } catch (e) { return { error: msg(e) }; }
  }

  private async doScan(): Promise<void> {
    const now = this.now();
    this.scanning = true;
    this.scanError = undefined;
    this.emit({ kind: 'scan-started' });
    try {
      const settings = await this.d.settings.load();
      const { token } = await this.d.tokens.get();
      if (!(await this.d.folderExists(settings.developmentFolder))) throw new Error(`The folder ${settings.developmentFolder} does not exist. Choose your Development folder in settings.`);

      // Cached Notion data fills in cards while the fresh pull is in flight.
      const known = new Map(this.projects.flatMap((p) => (p.notion ? [[p.name, p.notion] as const] : [])));
      const pulling = token ? this.pullNotion(token) : Promise.resolve(undefined);
      const scans = await this.d.scanFolders(settings.developmentFolder, (s) => {
        const project = toProject(s, token ? known.get(s.name) : undefined);
        this.upsert(project);
        this.emit({ kind: 'project', project });
      }, now);
      const pulled = await pulling;

      let infoByFolder = new Map<string, NotionInfo>(token ? known : []);
      if (!token) {
        this.notion = { state: 'not-configured', message: 'Add a Notion token in settings to see stages and criteria.' };
      } else if (!pulled || 'error' in pulled) {
        this.notion = { state: 'error', message: `Could not reach Notion: ${pulled && 'error' in pulled ? pulled.error : 'unknown error'}. Showing the last known data.` };
      } else {
        infoByFolder = matchNotion(scans.map((s) => s.name), pulled.loaded, settings.overrides).infoByFolder;
        const matched = new Set([...infoByFolder.values()].map((i) => i.pageId));
        this.unlinked = pulled.loaded.flatMap((l) => (l.info && !matched.has(l.page.id) ? [{ id: l.page.id, title: l.info.title, url: l.info.url, stage: l.info.stage, info: l.info }] : []));
        const schemaMissing = hasChanges(pulled.diff);
        this.notion = schemaMissing
          ? { state: 'schema-missing', message: 'The Notion database is missing properties the app needs. Run npm run notion:setup to review and add them.', syncedAt: now.toISOString(), pages: pulled.loaded.length }
          : { state: 'connected', syncedAt: now.toISOString(), pages: pulled.loaded.length };
        if (!schemaMissing) await this.stampStageChanges(pulled.backend, pulled.loaded.flatMap((l) => (l.info ? [l.info] : [])), infoByFolder, now);
      }

      this.projects = mergeProjects(scans, infoByFolder);
      this.scannedAt = now.toISOString();
      await this.d.cache.save({ scannedAt: this.scannedAt, projects: this.projects });
      if (this.d.history && this.notion.state !== 'not-configured' && this.notion.state !== 'error') {
        this.stageHistory = await this.d.history.record({ date: localDate(now), counts: stageCounts(this.projects) });
      }
    } catch (e) {
      this.scanError = msg(e);
    } finally {
      this.scanning = false;
      this.emit({ kind: 'scan-finished', snapshot: await this.getSnapshot() });
    }
  }

  /** Writes today's date to Stage changed for pages whose status moved since the last snapshot. All or nothing: if any write fails the snapshot is kept so the next scan retries. */
  private async stampStageChanges(backend: NotionBackend, infos: NotionInfo[], byFolder: Map<string, NotionInfo>, now: Date) {
    const prev = await loadSnapshot(this.d.stageSnapshotPath);
    const { changes, next } = detectStageChanges(prev, infos.map((i) => ({ pageId: i.pageId, stage: i.stage })), now);
    try {
      for (const c of changes) {
        await backend.setProperties(c.pageId, { stageChangedAt: isoDate(now) });
        for (const info of byFolder.values()) if (info.pageId === c.pageId) info.stageChangedAt = isoDate(now);
      }
      await saveSnapshot(this.d.stageSnapshotPath, next);
    } catch { /* keep the old snapshot; the change is detected again on the next scan */ }
  }

  // ---------- changes

  private busy(): Result | undefined {
    return this.scanning ? fail('busy', 'A scan is running. Try again in a moment.') : undefined;
  }

  private async backendFor(needsSchema: boolean): Promise<{ backend: NotionBackend } | { error: Result }> {
    const { token } = await this.d.tokens.get();
    if (!token) return { error: fail('no-notion', 'Add a Notion token in settings first.') };
    if (needsSchema && this.notion.state === 'schema-missing') return { error: fail('schema-missing', 'The Notion database is missing properties the app needs. Run npm run notion:setup to review and add them.') };
    return { backend: this.getBackend(token) };
  }

  /** Runs a pure rule, then writes the resulting differences to Notion. Writes nothing when the rule rejects the change. */
  private async applyRule(compute: (ps: Project[]) => RuleOutcome): Promise<Result> {
    const busy = this.busy();
    if (busy) return busy;
    const outcome = compute(this.projects);
    if (!outcome.ok) return { ok: false, error: outcome.error };

    const edits = outcome.projects.flatMap((after) => {
      const before = this.projects.find((p) => p.name === after.name);
      const d = before?.notion && after.notion ? diffNotion(before.notion, after.notion) : undefined;
      return d ? [{ name: after.name, pageId: after.notion!.pageId, ...d }] : [];
    });
    if (edits.length === 0) return ok();

    const b = await this.backendFor(true);
    if ('error' in b) return b.error;
    const done: typeof edits = [];
    for (const e of edits) {
      try {
        await b.backend.setProperties(e.pageId, e.change);
        done.push(e);
      } catch (err) {
        let reverted = true;
        for (const r of done.reverse()) { try { await b.backend.setProperties(r.pageId, r.revert); } catch { reverted = false; } }
        return fail('notion-write-failed', `Could not update ${e.name} in Notion: ${msg(err)}.${done.length ? (reverted ? ' Earlier changes were undone.' : ' Some earlier changes could not be undone and may need fixing in Notion.') : ''} Nothing changed in the app.`);
      }
    }
    this.projects = outcome.projects;
    await this.d.cache.save({ scannedAt: this.scannedAt, projects: this.projects });
    for (const e of edits) this.emit({ kind: 'project', project: this.projects.find((p) => p.name === e.name)! });
    return ok();
  }

  async promote(name: string, swap?: SwapChoice): Promise<Result> {
    if (swap && !swap.reason?.trim()) return fail('invalid', 'Say why you are parking the other project.');
    if (swap && !swap.revisitOn) return fail('invalid', 'Choose when to revisit the parked project.');
    return this.applyRule((ps) => {
      const r = promote(ps, name, swap);
      if (r.ok) return r;
      return r.error === 'full'
        ? { ok: false, error: { code: 'full', message: `Focus is full (${r.focus.length} of 3). Park one project to make room.`, focus: r.focus.map((p) => p.name) } }
        : { ok: false, error: { code: 'not-eligible', message: `${name} cannot take a focus slot. It needs a Notion page, must be active, and must not be shipped.` } };
    });
  }

  async park(name: string, reason: string, revisitOn?: string): Promise<Result> {
    if (!reason?.trim()) return fail('invalid', 'Say why you are parking it.');
    if (!revisitOn) return fail('invalid', 'Choose when to revisit it.');
    return this.applyRule((ps) => this.eligible(ps, name) ?? { ok: true, projects: park(ps, name, reason.trim(), revisitOn) });
  }

  async kill(name: string): Promise<Result> {
    return this.applyRule((ps) => this.eligible(ps, name) ?? { ok: true, projects: kill(ps, name) });
  }

  async markShipped(name: string): Promise<Result> {
    const p = this.projects.find((x) => x.name === name);
    const label = p?.notion?.title ?? name;
    const r = await this.applyRule((ps) => {
      const out = ship(ps, name, this.now());
      if (out.ok) return out;
      const message = {
        'not-found': `No project named ${name}.`,
        'not-eligible': `${label} cannot be shipped. It must be tracked, active and not already shipped.`,
        'no-criteria': `${label} has no ship criteria, so there is nothing to finish. Add a checklist on its Notion page first.`,
        'criteria-open': `${out.open} ${out.open === 1 ? 'criterion is' : 'criteria are'} still open on ${label}.`,
      }[out.error];
      return { ok: false, error: { code: out.error, message } };
    });
    // The page just changed stage, so make the stage snapshot agree and the next scan does not stamp it a second time.
    if (r.ok && p?.notion) {
      try {
        const snap = await loadSnapshot(this.d.stageSnapshotPath);
        snap[p.notion.pageId] = { stage: 'General Available', seenAt: this.now().toISOString() };
        await saveSnapshot(this.d.stageSnapshotPath, snap);
      } catch { /* the worst case is one repeated stamp with the same date */ }
    }
    return r;
  }

  async unpark(name: string): Promise<Result> {
    return this.applyRule((ps) => {
      const p = ps.find((x) => x.name === name);
      if (!p) return { ok: false, error: { code: 'not-found', message: `No project named ${name}.` } };
      if (p.notion?.life !== 'parked') return { ok: false, error: { code: 'not-eligible', message: `${name} is not parked.` } };
      return { ok: true, projects: unpark(ps, name) };
    });
  }

  private eligible(ps: Project[], name: string): RuleOutcome | undefined {
    const p = ps.find((x) => x.name === name);
    if (!p) return { ok: false, error: { code: 'not-found', message: `No project named ${name}.` } };
    if (!p.notion) return { ok: false, error: { code: 'no-notion', message: `${name} has no Notion page yet. Add it to Notion first.` } };
    return undefined;
  }

  async setNextAction(name: string, text: string | null): Promise<Result> {
    const busy = this.busy();
    if (busy) return busy;
    const p = this.projects.find((x) => x.name === name);
    const e = p ? this.eligible(this.projects, name) : undefined;
    if (!p) return fail('not-found', `No project named ${name}.`);
    if (e && !e.ok) return { ok: false, error: e.error };
    const clean = text?.trim() || null;
    const b = await this.backendFor(true);
    if ('error' in b) return b.error;
    try { await b.backend.setProperties(p.notion!.pageId, { nextAction: clean }); }
    catch (err) { return fail('notion-write-failed', `Could not save the next action: ${msg(err)}`); }
    await this.replace({ ...p, notion: { ...p.notion!, nextAction: clean ?? undefined } });
    return ok();
  }

  async setCriterion(name: string, blockId: string, checked: boolean): Promise<Result> {
    const busy = this.busy();
    if (busy) return busy;
    const p = this.projects.find((x) => x.name === name);
    if (!p) return fail('not-found', `No project named ${name}.`);
    if (!p.notion) return fail('no-notion', `${name} has no Notion page yet. Add it to Notion first.`);
    const i = p.notion.criteria.findIndex((c) => c.blockId === blockId);
    if (i < 0) return fail('not-found', 'That criterion is no longer on the Notion page. Rescan to refresh.');
    const b = await this.backendFor(false);
    if ('error' in b) return b.error;
    try { await b.backend.setCriterionChecked(blockId, checked); }
    catch (err) { return fail('notion-write-failed', `Could not update the criterion in Notion: ${msg(err)}`); }
    const criteria = p.notion.criteria.map((c, j) => (j === i ? { ...c, done: checked, doneOn: checked ? this.now().toISOString() : undefined } : c));
    await this.replace({ ...p, notion: { ...p.notion, criteria } });
    return ok();
  }

  private async replace(p: Project) {
    this.upsert(p);
    await this.d.cache.save({ scannedAt: this.scannedAt, projects: this.projects });
    this.emit({ kind: 'project', project: p });
  }

  // ---------- keeping up with the disk

  /**
   * Re-reads one folder after something changed in it, keeping its Notion data. Does nothing while a scan
   * is running or when the folder is not a known project (a new folder needs a full scan).
   */
  async refreshProject(name: string): Promise<boolean> {
    if (this.scanning || !this.d.scanProject) return false;
    const known = this.projects.find((x) => x.name === name);
    if (!known) return false;
    const settings = await this.d.settings.load();
    let fresh: ScanResult;
    try { fresh = await this.d.scanProject(join(settings.developmentFolder, name), name, this.now()); }
    catch { return false; }
    if (this.scanning) return false;
    const current = this.projects.find((x) => x.name === name);
    if (!current) return false;
    await this.replace(toProject(fresh, current.notion));
    return true;
  }

  async chooseFolder(): Promise<Result<string | null>> {
    if (!this.d.chooseFolder) return fail('internal', 'Choosing a folder is not available here.');
    const current = (await this.d.settings.load()).developmentFolder;
    return ok(await this.d.chooseFolder(current));
  }

  // ---------- weekly review

  /**
   * Applies every decision of a weekly review or none: the rules check the whole plan first, the Notion
   * writes are rolled back together if one fails, and only then do the dated notes go on each page.
   * A note that cannot be written does not undo the review; it is reported so it can be added by hand.
   */
  async applyReview(plan: ReviewPlan): Promise<Result<ReviewOutcome>> {
    const before = this.projects;
    const r = await this.applyRule((ps) => {
      const out = applyReview(ps, plan);
      if (out.ok) return out;
      return { ok: false, error: { code: out.error.code === 'duplicate' ? 'invalid' : out.error.code, message: out.error.message } };
    });
    if (!r.ok) return r;
    const changed = this.projects.filter((p) => { const b = before.find((x) => x.name === p.name); return b?.notion && p.notion && diffNotion(b.notion, p.notion); }).length;

    const now = this.now();
    const notesFailed: string[] = [];
    let notesWritten = 0;
    const b = plan.decisions.length ? await this.backendFor(false) : undefined;
    for (const d of plan.decisions) {
      const p = this.projects.find((x) => x.name === d.name);
      if (!p?.notion) continue;
      if (!b || 'error' in b) { notesFailed.push(p.notion.title); continue; }
      try { await b.backend.appendNote(p.notion.pageId, reviewNote(d, isoDate(now))); notesWritten++; }
      catch { notesFailed.push(p.notion.title); }
    }
    await this.d.settings.save({ lastReviewAt: now.toISOString() });
    await this.emitMeta();
    return ok({ changed, notesWritten, notesFailed });
  }

  // ---------- inbox

  /** Creates a page for a folder that has none, and pairs the two so the next scan cannot lose the link. */
  async addToNotion(name: string): Promise<Result> {
    const busy = this.busy();
    if (busy) return busy;
    const p = this.projects.find((x) => x.name === name);
    if (!p) return fail('not-found', `No project named ${name}.`);
    if (p.notion) return fail('not-eligible', `${name} already has a Notion page.`);
    const b = await this.backendFor(false);
    if ('error' in b) return b.error;
    let created: { pageId: string; url: string };
    try { created = await b.backend.createPage(name); }
    catch (err) { return fail('notion-write-failed', `Could not create the Notion page: ${msg(err)}`); }
    const info: NotionInfo = { pageId: created.pageId, url: created.url, title: name, stage: 'Not started', criteria: [], focus: false, life: 'active' };
    try { await this.d.settings.save({ overrides: { ...(await this.d.settings.load()).overrides, [name]: created.pageId } }); }
    catch (err) { await this.replace({ ...p, notion: info }); return fail('internal', `The page was created, but the link could not be saved: ${msg(err)}. It will match by name on the next scan.`); }
    await this.replace({ ...p, notion: info });
    await this.emitMeta();
    return ok();
  }

  async ignoreFolder(name: string, ignored: boolean): Promise<Result> {
    if (!this.projects.some((x) => x.name === name)) return fail('not-found', `No project named ${name}.`);
    const cur = (await this.d.settings.load()).ignored;
    const next = ignored ? [...new Set([...cur, name])] : cur.filter((n) => n !== name);
    await this.d.settings.save({ ignored: next });
    await this.emitMeta();
    return ok();
  }

  async linkFolder(name: string, pageId: string): Promise<Result> {
    const busy = this.busy();
    if (busy) return busy;
    const p = this.projects.find((x) => x.name === name);
    if (!p) return fail('not-found', `No project named ${name}.`);
    if (p.notion) return fail('not-eligible', `${name} already has a Notion page.`);
    const page = this.unlinked.find((u) => u.id === pageId);
    if (!page) return fail('not-found', 'That Notion page is already linked or no longer exists. Rescan to refresh.');
    await this.d.settings.save({ overrides: { ...(await this.d.settings.load()).overrides, [name]: pageId } });
    this.unlinked = this.unlinked.filter((u) => u.id !== pageId);
    await this.replace({ ...p, notion: page.info });
    await this.emitMeta();
    return ok();
  }

  // ---------- settings and links

  async saveSettings(patch: SettingsPatch): Promise<Result> {
    const err = validatePatch(patch);
    if (err) return fail('invalid', err);
    if (patch.developmentFolder && !(await this.d.folderExists(patch.developmentFolder))) return fail('invalid', 'That folder does not exist.');
    const saved = await this.d.settings.save(patch);
    if (patch.appearance) this.d.setAppearance?.(saved.appearance);
    await this.emitMeta();
    return ok();
  }

  async setToken(token: string | null): Promise<Result> {
    if (token !== null && (typeof token !== 'string' || token.length > 500)) return fail('invalid', 'That does not look like a Notion token.');
    try { await this.d.tokens.set(token); }
    catch (e) { return e instanceof SecureStorageUnavailable ? fail('no-secure-storage', e.message) : fail('invalid', msg(e)); }
    this.backend = undefined;
    await this.emitMeta();
    return ok();
  }

  async openLink(name: string, kind: LinkKind): Promise<Result> {
    const p = this.projects.find((x) => x.name === name);
    if (!p) return fail('not-found', `No project named ${name}.`);
    if (kind === 'folder') { this.d.showInFolder(p.path); return ok(); }
    const url = kind === 'github' ? p.github : p.notion?.url;
    if (!url) return fail('not-found', kind === 'github' ? `${name} has no GitHub remote.` : `${name} has no Notion page.`);
    await this.d.openExternal(url);
    return ok();
  }
}


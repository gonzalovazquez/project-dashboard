import { APPEARANCES, CHANNELS, fail, type LinkKind, type Result, type SettingsPatch, type SwapChoice } from '../../shared/ipc.js';
import type { ReviewDecision, ReviewPlan } from '../../shared/review.js';
import type { DashboardService } from './service.js';

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

export interface IpcOptions {
  /** Returns true only for messages sent by our own window. */
  isTrusted: (event: unknown) => boolean;
  log?: (message: string, error: unknown) => void;
}

class BadInput extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, name: string, max = 500): string => {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) throw new BadInput(`${name} must be text of 1 to ${max} characters.`);
  return v;
};
const optStr = (v: unknown, name: string, max = 2000): string | undefined => (v === undefined || v === null ? undefined : str(v, name, max));
const bool = (v: unknown, name: string): boolean => { if (typeof v !== 'boolean') throw new BadInput(`${name} must be true or false.`); return v; };
const date = (v: unknown, name: string): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || !DATE.test(v) || Number.isNaN(Date.parse(v))) throw new BadInput(`${name} must be a date like 2026-11-12.`);
  return v;
};
const kind = (v: unknown): LinkKind => { if (v === 'github' || v === 'notion' || v === 'folder') return v; throw new BadInput('Unknown link type.'); };

function swap(v: unknown): SwapChoice | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object') throw new BadInput('The swap choice is not valid.');
  const o = v as Record<string, unknown>;
  return { parkName: str(o.parkName, 'parkName'), reason: str(o.reason, 'reason', 1000), revisitOn: date(o.revisitOn, 'revisitOn') };
}

const MAX_DECISIONS = 100;
function plan(v: unknown): ReviewPlan {
  if (typeof v !== 'object' || v === null) throw new BadInput('The review is not valid.');
  const list = (v as Record<string, unknown>).decisions;
  if (!Array.isArray(list) || list.length > MAX_DECISIONS) throw new BadInput('The review needs a list of decisions.');
  const decisions = list.map((raw): ReviewDecision => {
    if (typeof raw !== 'object' || raw === null) throw new BadInput('A decision is not valid.');
    const o = raw as Record<string, unknown>;
    const name = str(o.name, 'name', 255);
    switch (o.action) {
      case 'keep': case 'focus': return { name, action: o.action, nextAction: optStr(o.nextAction, 'nextAction', 200) };
      case 'park': return { name, action: 'park', reason: str(o.reason, 'reason', 1000), revisitOn: date(o.revisitOn, 'revisitOn') ?? (() => { throw new BadInput('Choose when to revisit it.'); })() };
      case 'kill': return { name, action: 'kill' };
      default: throw new BadInput('Unknown review action.');
    }
  });
  return { decisions };
}

function patch(v: unknown): SettingsPatch {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new BadInput('Settings must be an object.');
  const o = v as Record<string, unknown>;
  const out: SettingsPatch = {};
  if (o.developmentFolder !== undefined) out.developmentFolder = str(o.developmentFolder, 'developmentFolder', 1000);
  if (o.overrides !== undefined) {
    if (typeof o.overrides !== 'object' || o.overrides === null || Array.isArray(o.overrides)) throw new BadInput('Overrides must be a map.');
    const m: Record<string, string> = {};
    for (const [k, val] of Object.entries(o.overrides)) m[str(k, 'folder name', 255)] = str(val, 'page id', 100);
    out.overrides = m;
  }
  if (o.ignored !== undefined) {
    if (!Array.isArray(o.ignored)) throw new BadInput('Ignored folders must be a list.');
    out.ignored = o.ignored.map((n) => str(n, 'folder name', 255));
  }
  if (o.reviewDay !== undefined) {
    if (typeof o.reviewDay !== 'number' || !Number.isInteger(o.reviewDay) || o.reviewDay < 0 || o.reviewDay > 6) throw new BadInput('The review day must be 0 to 6.');
    out.reviewDay = o.reviewDay;
  }
  if (o.reviewTime !== undefined) out.reviewTime = str(o.reviewTime, 'reviewTime', 5);
  if (o.onboarded !== undefined) out.onboarded = bool(o.onboarded, 'onboarded');
  if (o.reviewReminder !== undefined) out.reviewReminder = bool(o.reviewReminder, 'reviewReminder');
  if (o.appearance !== undefined) {
    if (typeof o.appearance !== 'string' || !(APPEARANCES as string[]).includes(o.appearance)) throw new BadInput('Appearance must be system, light or dark.');
    out.appearance = o.appearance as SettingsPatch['appearance'];
  }
  return out;
}

/**
 * Connects the service to the IPC channels. Every argument from the renderer is validated,
 * messages from any other sender are rejected, and unexpected errors are logged and returned
 * as a generic failure so internal details never reach the interface.
 */
export function registerIpc(ipc: IpcMainLike, svc: DashboardService, opts: IpcOptions): void {
  const handle = (channel: string, fn: (...args: unknown[]) => Promise<unknown>) =>
    ipc.handle(channel, async (event, ...args) => {
      if (!opts.isTrusted(event)) return fail('invalid', 'This request did not come from the app window.');
      try { return await fn(...args); }
      catch (e) {
        if (e instanceof BadInput) return fail('invalid', e.message);
        opts.log?.(`IPC ${channel} failed`, e);
        return fail('internal', 'Something went wrong. The details were written to the log.');
      }
    });

  handle(CHANNELS.getSnapshot, () => svc.getSnapshot());
  handle(CHANNELS.startScan, async () => { await svc.startScan(); });
  handle(CHANNELS.setNextAction, (name, text) => svc.setNextAction(str(name, 'name', 255), optStr(text, 'text') ?? null));
  handle(CHANNELS.setCriterion, (name, blockId, checked) => svc.setCriterion(str(name, 'name', 255), str(blockId, 'blockId', 100), bool(checked, 'checked')));
  handle(CHANNELS.promote, (name, s) => svc.promote(str(name, 'name', 255), swap(s)));
  handle(CHANNELS.park, (name, reason, revisitOn) => svc.park(str(name, 'name', 255), str(reason, 'reason', 1000), date(revisitOn, 'revisitOn')));
  handle(CHANNELS.kill, (name) => svc.kill(str(name, 'name', 255)));
  handle(CHANNELS.unpark, (name) => svc.unpark(str(name, 'name', 255)));
  handle(CHANNELS.markShipped, (name) => svc.markShipped(str(name, 'name', 255)));
  handle(CHANNELS.addToNotion, (name) => svc.addToNotion(str(name, 'name', 255)));
  handle(CHANNELS.ignoreFolder, (name, ignored) => svc.ignoreFolder(str(name, 'name', 255), bool(ignored, 'ignored')));
  handle(CHANNELS.linkFolder, (name, id) => svc.linkFolder(str(name, 'name', 255), str(id, 'pageId', 100)));
  handle(CHANNELS.applyReview, (p) => svc.applyReview(plan(p)));
  handle(CHANNELS.chooseFolder, () => svc.chooseFolder());
  handle(CHANNELS.getSettings, () => svc.getSettings());
  handle(CHANNELS.saveSettings, (p) => svc.saveSettings(patch(p)));
  handle(CHANNELS.setToken, (t) => svc.setToken(t === null ? null : str(t, 'token', 500)));
  handle(CHANNELS.openLink, (name, k) => svc.openLink(str(name, 'name', 255), kind(k)));
}

export type { Result };

import type { Snapshot } from '../../../shared/ipc.js';

export interface BannerModel {
  id: string;
  tone: 'info' | 'warn' | 'bad';
  text: string;
  /** What the button on the banner does. */
  action?: { label: string; kind: 'settings' | 'rescan' };
}

const MISSING_FOLDER = /does not exist/i;

/** Messages shown above the content when something needs attention. Nothing when all is well. */
export function banners(s: Pick<Snapshot, 'scanError' | 'notion'>): BannerModel[] {
  const out: BannerModel[] = [];
  if (s.scanError) {
    out.push({ id: 'scan', tone: 'bad', text: s.scanError, action: MISSING_FOLDER.test(s.scanError) ? { label: 'Choose folder', kind: 'settings' } : { label: 'Try again', kind: 'rescan' } });
  }
  switch (s.notion.state) {
    case 'not-configured':
      out.push({ id: 'notion', tone: 'info', text: 'Notion is not connected, so stages, criteria and focus are not shown.', action: { label: 'Connect Notion', kind: 'settings' } });
      break;
    case 'error':
      out.push({ id: 'notion', tone: 'warn', text: s.notion.message ?? 'There is a problem with the Notion connection.', action: { label: 'Try again', kind: 'rescan' } });
      break;
    case 'schema-missing':
      out.push({ id: 'notion', tone: 'warn', text: s.notion.message ?? 'The Notion database is missing properties the app needs.', action: { label: 'See what to do', kind: 'settings' } });
      break;
    case 'connected':
      break;
  }
  return out;
}

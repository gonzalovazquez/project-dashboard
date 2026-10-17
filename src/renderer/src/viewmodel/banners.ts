import type { Snapshot } from '../../../shared/ipc.js';

export interface BannerModel { id: string; tone: 'info' | 'warn' | 'bad'; text: string }

/** Messages shown above the content when something needs attention. Nothing when all is well. */
export function banners(s: Pick<Snapshot, 'scanError' | 'notion'>): BannerModel[] {
  const out: BannerModel[] = [];
  if (s.scanError) out.push({ id: 'scan', tone: 'bad', text: s.scanError });
  switch (s.notion.state) {
    case 'not-configured':
      out.push({ id: 'notion', tone: 'info', text: 'Notion is not connected. Set the NOTION_TOKEN environment variable and rescan. A settings screen arrives with first-run setup.' });
      break;
    case 'error':
    case 'schema-missing':
      out.push({ id: 'notion', tone: 'warn', text: s.notion.message ?? 'There is a problem with the Notion connection.' });
      break;
    case 'connected':
      break;
  }
  return out;
}

import type { Criterion, Life, NotionInfo, Stage } from '../../shared/types.js';

/** Property names in the Brainstorming database. Rename here if your database differs. */
export const PROPS = {
  title: 'Idea',
  stage: 'Status',
  nextAction: 'Next action',
  focus: 'Focus',
  life: 'Lifecycle',
  stageChanged: 'Stage changed',
  parkReason: 'Park reason',
  revisitOn: 'Revisit on',
} as const;

const STAGES: Stage[] = ['Not started', 'In progress', 'Beta', 'General Available'];

/* eslint-disable @typescript-eslint/no-explicit-any */
type Prop = any;
export interface NotionPage { id: string; url: string; created_time?: string; properties: Record<string, Prop> }
export interface NotionBlock { id?: string; type: string; last_edited_time?: string; to_do?: { rich_text: Array<{ plain_text: string }>; checked: boolean } }

const text = (rt: Array<{ plain_text: string }> | undefined) => (rt ?? []).map((t) => t.plain_text).join('').trim();
export const getTitle = (p?: Prop): string => text(p?.title);
export const getRichText = (p?: Prop): string | undefined => text(p?.rich_text) || undefined;
export const getSelect = (p?: Prop): string | undefined => p?.status?.name ?? p?.select?.name;
export const getDate = (p?: Prop): string | undefined => p?.date?.start ?? undefined;

/** "Deploy to production (4h)" becomes title and 4 hours. */
export function parseCriterion(block: NotionBlock): Criterion | undefined {
  if (block.type !== 'to_do' || !block.to_do) return undefined;
  const raw = text(block.to_do.rich_text);
  if (!raw) return undefined;
  const m = raw.match(/^(.*?)\s*\((\d+(?:\.\d+)?)\s*h\)$/i);
  const done = block.to_do.checked;
  return { blockId: block.id, title: m ? m[1] : raw, hours: m ? Number(m[2]) : undefined, done, doneOn: done ? block.last_edited_time : undefined };
}

export const parseCriteria = (blocks: NotionBlock[]): Criterion[] => blocks.map(parseCriterion).filter((c): c is Criterion => !!c);

export function parsePage(page: NotionPage, blocks: NotionBlock[]): NotionInfo | undefined {
  const stage = getSelect(page.properties[PROPS.stage]);
  if (!stage || !STAGES.includes(stage as Stage)) return undefined;
  const life = (getSelect(page.properties[PROPS.life])?.toLowerCase() ?? 'active') as Life;
  return {
    pageId: page.id,
    url: page.url,
    title: getTitle(page.properties[PROPS.title]),
    stage: stage as Stage,
    stageChangedAt: getDate(page.properties[PROPS.stageChanged]) ?? page.created_time,
    criteria: parseCriteria(blocks),
    nextAction: getRichText(page.properties[PROPS.nextAction]),
    focus: !!page.properties[PROPS.focus]?.checkbox,
    life: ['active', 'parked', 'killed'].includes(life) ? life : 'active',
    parkReason: getRichText(page.properties[PROPS.parkReason]),
    revisitOn: getDate(page.properties[PROPS.revisitOn]),
  };
}

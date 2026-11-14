import type { Criterion, Life, NotionInfo, Stage } from '../../shared/types.js';

/** Property names in the Brainstorming database. Rename here if your database differs. */
export const PROPS = {
  title: 'Idea',
  stage: 'Status',
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
type RichText = Array<{ plain_text: string }>;
export interface NotionBlock {
  id?: string; type: string; last_edited_time?: string;
  to_do?: { rich_text: RichText; checked: boolean };
  heading_1?: { rich_text: RichText }; heading_2?: { rich_text: RichText }; heading_3?: { rich_text: RichText };
}

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

/** The heading that holds a page's ship criteria. Matched ignoring case, emoji and punctuation, at any heading level. */
export const PLANNING = 'Planning';

const headingLevel = (b: NotionBlock): number | undefined => ({ heading_1: 1, heading_2: 2, heading_3: 3 } as Record<string, number>)[b.type];
const isPlanningHeading = (b: NotionBlock) => {
  const level = headingLevel(b);
  if (!level) return false;
  const words = text((b as Record<string, any>)[b.type]?.rich_text).toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  return words === PLANNING.toLowerCase();
};

/**
 * The top-level blocks of a page's Planning section: everything after the first Planning heading up to the next heading
 * of the same or a higher level. Undefined when the page has no Planning heading.
 */
export function planningSection(blocks: NotionBlock[]): { heading: NotionBlock; body: NotionBlock[] } | undefined {
  const start = blocks.findIndex(isPlanningHeading);
  if (start < 0) return undefined;
  const level = headingLevel(blocks[start])!;
  const rest = blocks.slice(start + 1);
  const end = rest.findIndex((b) => { const l = headingLevel(b); return l !== undefined && l <= level; });
  return { heading: blocks[start], body: end < 0 ? rest : rest.slice(0, end) };
}

/**
 * Ship criteria are the to-dos in the Planning section, so other checklists on the page (a demo prep list, say) do not count.
 * A page with no Planning heading falls back to every top-level to-do, which is how pages were read before the section existed.
 */
export function parseCriteria(blocks: NotionBlock[]): Criterion[] {
  const scope = planningSection(blocks)?.body ?? blocks;
  return scope.map(parseCriterion).filter((c): c is Criterion => !!c);
}

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
    focus: !!page.properties[PROPS.focus]?.checkbox,
    life: ['active', 'parked', 'killed'].includes(life) ? life : 'active',
    parkReason: getRichText(page.properties[PROPS.parkReason]),
    revisitOn: getDate(page.properties[PROPS.revisitOn]),
  };
}

import { Client } from '@notionhq/client';
import type { Life, NotionInfo, Stage } from '../../shared/types.js';
import { PLANNING, PROPS, parseCriterion, parsePage, planningSection, type NotionBlock, type NotionPage } from './parse.js';
import type { Criterion } from '../../shared/types.js';

/** The brainstorming database's data source. Override with NOTION_DATA_SOURCE_ID. */
export const DEFAULT_DATA_SOURCE_ID = '308975d3-26ba-809d-92ce-000bc4085b1d';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Page<T> { results: T[]; has_more: boolean; next_cursor: string | null }

/** The slice of the Notion SDK this app uses. A fake implements it in tests. */
export interface NotionApi {
  dataSources: {
    retrieve(a: { data_source_id: string }): Promise<any>;
    query(a: { data_source_id: string; start_cursor?: string; page_size?: number }): Promise<Page<any>>;
    update(a: { data_source_id: string; properties: Record<string, any> }): Promise<any>;
  };
  pages: {
    update(a: { page_id: string; properties: Record<string, any> }): Promise<any>;
    create(a: { parent: { data_source_id: string; type?: 'data_source_id' }; properties: Record<string, any> }): Promise<any>;
  };
  blocks: {
    update(a: { block_id: string; to_do: { checked: boolean } }): Promise<any>;
    delete(a: { block_id: string }): Promise<any>;
    children: { list(a: { block_id: string; start_cursor?: string; page_size?: number }): Promise<Page<any>>; append(a: { block_id: string; children: any[]; position?: { type: 'after_block'; after_block: { id: string } } }): Promise<any> };
  };
}

export interface PageChange {
  stage?: Stage;
  focus?: boolean;
  life?: Life;
  stageChangedAt?: string | null;
  parkReason?: string | null;
  revisitOn?: string | null;
}

export interface LoadedPage { page: NotionPage; blocks: NotionBlock[]; info?: NotionInfo }

export interface NotionGateway {
  listPages(): Promise<NotionPage[]>;
  getBlocks(pageId: string): Promise<NotionBlock[]>;
  loadProjects(): Promise<LoadedPage[]>;
  setProperties(pageId: string, change: PageChange): Promise<void>;
  setCriterionChecked(blockId: string, checked: boolean): Promise<void>;
  /** Adds a paragraph to the end of a page. */
  appendNote(pageId: string, text: string): Promise<void>;
  /** Adds an unchecked to-do to the end of the page's Planning section, creating the section if the page has none, and returns it as a ship criterion. */
  appendCriterion(pageId: string, text: string): Promise<Criterion>;
  /** Removes a block, used to undo an added criterion. */
  deleteBlock(blockId: string): Promise<void>;
  createPage(title: string, stage?: Stage): Promise<{ pageId: string; url: string }>;
}

const text = (s: string | null | undefined) => (s ? [{ type: 'text', text: { content: s } }] : []);
const date = (s: string | null | undefined) => ({ date: s ? { start: s } : null });
const cap = (l: string) => l.charAt(0).toUpperCase() + l.slice(1);

/** Builds a Notion property payload containing only the fields that were given. */
export function buildPropertyUpdate(c: PageChange): Record<string, any> {
  const out: Record<string, any> = {};
  if (c.stage !== undefined) out[PROPS.stage] = { status: { name: c.stage } };
  if (c.focus !== undefined) out[PROPS.focus] = { checkbox: c.focus };
  if (c.life !== undefined) out[PROPS.life] = { select: { name: cap(c.life) } };
  if (c.stageChangedAt !== undefined) out[PROPS.stageChanged] = date(c.stageChangedAt);
  if (c.parkReason !== undefined) out[PROPS.parkReason] = { rich_text: text(c.parkReason) };
  if (c.revisitOn !== undefined) out[PROPS.revisitOn] = date(c.revisitOn);
  return out;
}

async function collect<T>(fetchPage: (cursor?: string) => Promise<Page<T>>): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  do {
    const r = await fetchPage(cursor);
    all.push(...r.results);
    cursor = r.has_more && r.next_cursor ? r.next_cursor : undefined;
  } while (cursor);
  return all;
}

/** Runs `fn` over `items` with at most `limit` in flight, keeping order. Notion allows about 3 requests a second. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

export function createGateway(api: NotionApi, dataSourceId = DEFAULT_DATA_SOURCE_ID, concurrency = 3): NotionGateway {
  const listPages = () => collect<NotionPage>((cursor) => api.dataSources.query({ data_source_id: dataSourceId, start_cursor: cursor, page_size: 100 }));
  const getBlocks = (pageId: string) => collect<NotionBlock>((cursor) => api.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 }));
  return {
    listPages,
    getBlocks,
    async loadProjects() {
      const pages = await listPages();
      return mapLimit(pages, concurrency, async (page) => {
        const blocks = await getBlocks(page.id);
        return { page, blocks, info: parsePage(page, blocks) };
      });
    },
    async setProperties(pageId, change) {
      const properties = buildPropertyUpdate(change);
      if (Object.keys(properties).length === 0) return;
      await api.pages.update({ page_id: pageId, properties });
    },
    async setCriterionChecked(blockId, checked) {
      await api.blocks.update({ block_id: blockId, to_do: { checked } });
    },
    async appendNote(pageId, content) {
      await api.blocks.children.append({ block_id: pageId, children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: text(content) } }] });
    },
    async appendCriterion(pageId, content) {
      const todo = { object: 'block', type: 'to_do', to_do: { rich_text: text(content), checked: false } };
      const section = planningSection(await getBlocks(pageId));
      // Right after the section's last to-do keeps the list together even when notes or blank lines follow it.
      const last = section ? ([...section.body].reverse().find((b) => b.type === 'to_do') ?? section.heading) : undefined;
      const r = last?.id
        ? await api.blocks.children.append({ block_id: pageId, children: [todo], position: { type: 'after_block', after_block: { id: last.id } } })
        : await api.blocks.children.append({ block_id: pageId, children: [{ object: 'block', type: 'heading_2', heading_2: { rich_text: text(PLANNING) } }, todo] });
      const block = (r?.results ?? []).find((b: NotionBlock) => b.type === 'to_do');
      const c = block && parseCriterion(block);
      if (!c?.blockId) throw new Error('Notion did not return the new to-do.');
      return c;
    },
    async deleteBlock(blockId) {
      await api.blocks.delete({ block_id: blockId });
    },
    async createPage(title, stage = 'Not started') {
      const r = await api.pages.create({
        parent: { type: 'data_source_id', data_source_id: dataSourceId },
        properties: { [PROPS.title]: { title: text(title) }, [PROPS.stage]: { status: { name: stage } } },
      });
      return { pageId: r.id, url: r.url };
    },
  };
}

export function createNotionClient(token: string): NotionApi {
  return new Client({ auth: token }) as unknown as NotionApi;
}

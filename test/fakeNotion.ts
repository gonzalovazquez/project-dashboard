import type { NotionApi } from '../src/main/notion/gateway.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface FakeNotion {
  api: NotionApi;
  /** Pages returned by the data source query. */
  pages: any[];
  /** Block children by page id. */
  blocks: Record<string, any[]>;
  /** What dataSources.retrieve returns. */
  dataSource: any;
  /** Every write the code under test made. */
  calls: Array<{ op: string; args: any }>;
  queries: number;
  /** Make the next call to the named operation throw. */
  failNext(op: string, message?: string): void;
}

/** An in-memory Notion that paginates `pageSize` items at a time and records every write. */
export function makeFakeNotion(pageSize = 2): FakeNotion {
  const f: FakeNotion = { pages: [], blocks: {}, dataSource: { properties: {} }, calls: [], queries: 0, api: undefined as unknown as NotionApi, failNext: () => {} };
  const failures = new Map<string, string>();
  f.failNext = (op, message = 'boom') => { failures.set(op, message); };
  const guard = (op: string) => { const m = failures.get(op); if (m) { failures.delete(op); throw new Error(m); } };
  const write = (op: string, args: any, result: any = {}) => { guard(op); f.calls.push({ op, args }); return result; };
  const paginate = <T>(items: T[], cursor?: string) => {
    const start = cursor ? Number(cursor) : 0;
    const end = start + pageSize;
    return { results: items.slice(start, end), has_more: end < items.length, next_cursor: end < items.length ? String(end) : null };
  };
  f.api = {
    dataSources: {
      retrieve: async () => f.dataSource,
      query: async (a) => { guard('query'); f.queries++; return paginate(f.pages, a.start_cursor); },
      update: async (a) => write('dataSources.update', a),
    },
    pages: {
      update: async (a) => write('pages.update', a),
      create: async (a) => write('pages.create', a, { id: 'new-page', url: 'https://notion.so/new-page' }),
    },
    blocks: {
      children: { list: async (a) => paginate(f.blocks[a.block_id] ?? [], a.start_cursor) },
      update: async (a) => write('blocks.update', a),
    },
  };
  return f;
}

export const todo = (id: string, text: string, checked = false, edited = '2026-10-01T00:00:00Z') => ({
  id, type: 'to_do', last_edited_time: edited, to_do: { rich_text: [{ plain_text: text }], checked },
});

export const page = (id: string, title: string, status: string, extra: Record<string, any> = {}) => ({
  id, url: `https://notion.so/${id}`, created_time: '2026-08-01T00:00:00Z',
  properties: { Idea: { title: [{ plain_text: title }] }, Status: { status: { name: status } }, ...extra },
});

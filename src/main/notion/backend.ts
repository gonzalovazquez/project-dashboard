import { createGateway, createNotionClient, DEFAULT_DATA_SOURCE_ID, type NotionGateway } from './gateway.js';
import { checkSchema, type SchemaDiff } from './schema.js';

/** The gateway plus a read-only schema check. The app talks to Notion only through this. */
export interface NotionBackend extends NotionGateway {
  schemaStatus(): Promise<SchemaDiff>;
}

export function createNotionBackend(token: string, dataSourceId = process.env.NOTION_DATA_SOURCE_ID ?? DEFAULT_DATA_SOURCE_ID): NotionBackend {
  const api = createNotionClient(token);
  return { ...createGateway(api, dataSourceId), schemaStatus: async () => (await checkSchema(api, dataSourceId)).diff };
}

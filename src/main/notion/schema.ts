import type { NotionApi } from './gateway.js';
import { PROPS } from './parse.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface RequiredProperty { name: string; type: 'checkbox' | 'select' | 'rich_text' | 'date'; options?: Array<{ name: string; color: string }> }

/** The properties the dashboard needs on the Brainstorming database. See docs/notion-schema.md. */
export const REQUIRED_PROPERTIES: RequiredProperty[] = [
  { name: PROPS.focus, type: 'checkbox' },
  { name: PROPS.life, type: 'select', options: [{ name: 'Active', color: 'green' }, { name: 'Parked', color: 'yellow' }, { name: 'Killed', color: 'red' }] },
  { name: PROPS.nextAction, type: 'rich_text' },
  { name: PROPS.stageChanged, type: 'date' },
  { name: PROPS.parkReason, type: 'rich_text' },
  { name: PROPS.revisitOn, type: 'date' },
];

export const REQUIRED_STAGES = ['Not started', 'In progress', 'Beta', 'General Available'];

export interface SchemaDiff {
  missing: RequiredProperty[];
  wrongType: Array<{ name: string; expected: string; actual: string }>;
  /** Select options that exist in the plan but not in the database. */
  missingOptions: Array<{ property: string; options: string[] }>;
  /** Status values the app expects but the database lacks. The API cannot add these, so they need a manual fix. */
  missingStages: string[];
  titleOk: boolean;
}

export const hasChanges = (d: SchemaDiff) => d.missing.length > 0 || d.missingOptions.length > 0;
export const hasProblems = (d: SchemaDiff) => d.wrongType.length > 0 || d.missingStages.length > 0 || !d.titleOk;

export function diffSchema(dataSource: any): SchemaDiff {
  const props: Record<string, any> = dataSource?.properties ?? {};
  const diff: SchemaDiff = { missing: [], wrongType: [], missingOptions: [], missingStages: [], titleOk: false };
  for (const req of REQUIRED_PROPERTIES) {
    const have = props[req.name];
    if (!have) { diff.missing.push(req); continue; }
    if (have.type !== req.type) { diff.wrongType.push({ name: req.name, expected: req.type, actual: have.type }); continue; }
    if (req.type === 'select' && req.options) {
      const present = new Set<string>((have.select?.options ?? []).map((o: any) => o.name));
      const absent = req.options.map((o) => o.name).filter((n) => !present.has(n));
      if (absent.length) diff.missingOptions.push({ property: req.name, options: absent });
    }
  }
  const status = props[PROPS.stage];
  if (!status || status.type !== 'status') diff.wrongType.push({ name: PROPS.stage, expected: 'status', actual: status?.type ?? 'missing' });
  else {
    const names = new Set<string>((status.status?.options ?? []).map((o: any) => o.name));
    diff.missingStages = REQUIRED_STAGES.filter((s) => !names.has(s));
  }
  diff.titleOk = Object.values(props).some((p: any) => p.type === 'title');
  return diff;
}

/** The payload for dataSources.update that adds what is missing and never removes or renames anything. */
export function buildSchemaUpdate(diff: SchemaDiff, dataSource: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const p of diff.missing) {
    out[p.name] = p.type === 'select' ? { select: { options: p.options } } : { [p.type]: {} };
  }
  for (const m of diff.missingOptions) {
    const req = REQUIRED_PROPERTIES.find((r) => r.name === m.property)!;
    const existing = (dataSource.properties[m.property].select?.options ?? []).map((o: any) => ({ id: o.id, name: o.name, color: o.color }));
    out[m.property] = { select: { options: [...existing, ...req.options!.filter((o) => m.options.includes(o.name))] } };
  }
  return out;
}

export function describeDiff(diff: SchemaDiff): string[] {
  const lines: string[] = [];
  for (const p of diff.missing) lines.push(`+ add ${p.type} property "${p.name}"${p.options ? ` with options ${p.options.map((o) => o.name).join(', ')}` : ''}`);
  for (const m of diff.missingOptions) lines.push(`+ add options to "${m.property}": ${m.options.join(', ')}`);
  for (const w of diff.wrongType) lines.push(`! "${w.name}" is ${w.actual} but the app expects ${w.expected}. This needs a manual fix`);
  if (diff.missingStages.length) lines.push(`! Status is missing ${diff.missingStages.join(', ')}. The API cannot add status options, so add them in Notion`);
  if (!diff.titleOk) lines.push('! the data source has no title property');
  if (!lines.length) lines.push('Schema already matches. Nothing to do.');
  return lines;
}

/** Fetches the live schema and returns the diff. Reads only. */
export async function checkSchema(api: NotionApi, dataSourceId: string): Promise<{ diff: SchemaDiff; dataSource: any }> {
  const dataSource = await api.dataSources.retrieve({ data_source_id: dataSourceId });
  return { diff: diffSchema(dataSource), dataSource };
}

/** Writes only the additive changes. Does nothing when the schema already matches. */
export async function applySchema(api: NotionApi, dataSourceId: string, diff: SchemaDiff, dataSource: any): Promise<boolean> {
  if (!hasChanges(diff)) return false;
  await api.dataSources.update({ data_source_id: dataSourceId, properties: buildSchemaUpdate(diff, dataSource) });
  return true;
}

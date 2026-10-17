import { describe, expect, it } from 'vitest';
import { applySchema, buildSchemaUpdate, checkSchema, describeDiff, diffSchema, hasChanges, hasProblems } from '../src/main/notion/schema.js';
import { makeFakeNotion } from './fakeNotion.js';

const statusProp = (names: string[]) => ({ type: 'status', status: { options: names.map((name) => ({ name })) } });
const stages = ['Not started', 'In progress', 'Beta', 'General Available'];
/** The Brainstorming database as it was when the plan was written. */
const live = () => ({ properties: { Idea: { type: 'title' }, Status: statusProp(stages), Priority: { type: 'select' }, Category: { type: 'multi_select' } } });
const complete = () => ({
  properties: {
    ...live().properties,
    Focus: { type: 'checkbox' },
    Lifecycle: { type: 'select', select: { options: [{ id: '1', name: 'Active', color: 'green' }, { id: '2', name: 'Parked', color: 'yellow' }, { id: '3', name: 'Killed', color: 'red' }] } },
    'Next action': { type: 'rich_text' }, 'Stage changed': { type: 'date' }, 'Park reason': { type: 'rich_text' }, 'Revisit on': { type: 'date' },
  },
});

describe('diffSchema', () => {
  it('finds the six missing properties on the current database', () => {
    const d = diffSchema(live());
    expect(d.missing.map((p) => p.name)).toEqual(['Focus', 'Lifecycle', 'Next action', 'Stage changed', 'Park reason', 'Revisit on']);
    expect(d.wrongType).toEqual([]);
    expect(d.missingStages).toEqual([]);
    expect(d.titleOk).toBe(true);
    expect(hasChanges(d)).toBe(true);
    expect(hasProblems(d)).toBe(false);
  });
  it('is clean when everything exists', () => {
    const d = diffSchema(complete());
    expect(hasChanges(d)).toBe(false);
    expect(describeDiff(d)).toEqual(['Schema already matches. Nothing to do.']);
  });
  it('reports a property with the wrong type without trying to fix it', () => {
    const ds = complete();
    ds.properties.Focus = { type: 'select' } as never;
    const d = diffSchema(ds);
    expect(d.wrongType).toEqual([{ name: 'Focus', expected: 'checkbox', actual: 'select' }]);
    expect(d.missing).toEqual([]);
    expect(hasProblems(d)).toBe(true);
  });
  it('reports missing select options on an existing Lifecycle', () => {
    const ds = complete();
    ds.properties.Lifecycle.select.options = [{ id: '1', name: 'Active', color: 'green' }];
    expect(diffSchema(ds).missingOptions).toEqual([{ property: 'Lifecycle', options: ['Parked', 'Killed'] }]);
  });
  it('reports missing status values, which only a person can add', () => {
    const ds = complete();
    ds.properties.Status = statusProp(['Not started', 'In progress']) as never;
    const d = diffSchema(ds);
    expect(d.missingStages).toEqual(['Beta', 'General Available']);
    expect(describeDiff(d).join('\n')).toContain('cannot add status options');
  });
  it('flags a Status property of the wrong kind', () => {
    const ds = complete();
    ds.properties.Status = { type: 'select' } as never;
    expect(diffSchema(ds).wrongType).toContainEqual({ name: 'Status', expected: 'status', actual: 'select' });
  });
});

describe('buildSchemaUpdate', () => {
  it('only adds. It never removes or renames', () => {
    const ds = live();
    const u = buildSchemaUpdate(diffSchema(ds), ds);
    expect(Object.keys(u)).toEqual(['Focus', 'Lifecycle', 'Next action', 'Stage changed', 'Park reason', 'Revisit on']);
    expect(u.Focus).toEqual({ checkbox: {} });
    expect(u['Next action']).toEqual({ rich_text: {} });
    expect(u['Stage changed']).toEqual({ date: {} });
    expect(u.Lifecycle.select.options.map((o: { name: string }) => o.name)).toEqual(['Active', 'Parked', 'Killed']);
  });
  it('keeps existing options when adding missing ones', () => {
    const ds = complete();
    ds.properties.Lifecycle.select.options = [{ id: '1', name: 'Active', color: 'green' }];
    const u = buildSchemaUpdate(diffSchema(ds), ds);
    expect(u.Lifecycle.select.options).toEqual([{ id: '1', name: 'Active', color: 'green' }, { name: 'Parked', color: 'yellow' }, { name: 'Killed', color: 'red' }]);
  });
});

describe('checkSchema and applySchema', () => {
  it('checkSchema reads only. It never writes', async () => {
    const n = makeFakeNotion();
    n.dataSource = live();
    const { diff } = await checkSchema(n.api, 'ds');
    expect(hasChanges(diff)).toBe(true);
    expect(n.calls).toEqual([]);
  });
  it('applySchema writes the additive update once', async () => {
    const n = makeFakeNotion();
    n.dataSource = live();
    const { diff, dataSource } = await checkSchema(n.api, 'ds');
    expect(await applySchema(n.api, 'ds', diff, dataSource)).toBe(true);
    expect(n.calls).toHaveLength(1);
    expect(n.calls[0].op).toBe('dataSources.update');
    expect(n.calls[0].args.data_source_id).toBe('ds');
  });
  it('applySchema does nothing when the schema already matches', async () => {
    const n = makeFakeNotion();
    n.dataSource = complete();
    const { diff, dataSource } = await checkSchema(n.api, 'ds');
    expect(await applySchema(n.api, 'ds', diff, dataSource)).toBe(false);
    expect(n.calls).toEqual([]);
  });
});

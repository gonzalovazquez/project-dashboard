import { describe, expect, it } from 'vitest';
import { matchFolders, normalizeName, scoreMatch } from '../src/main/notion/match.js';
import { parseCriterion, parsePage, type NotionPage } from '../src/main/notion/parse.js';

const pages = [
  { id: '1', title: 'Dark Factory' }, { id: '2', title: 'Flockchat' }, { id: '3', title: 'Agentic Development Environment' },
  { id: '4', title: 'Buddy Recomp' }, { id: '5', title: 'AI Newsletter Agent' }, { id: '6', title: 'WhisperVault' }, { id: '7', title: 'SparkRide: Turn Commutes into Startups' },
];
const folders = ['ai-newsletter', 'Buddy Recomp', 'chicken-friends', 'dark-factory', 'sdlc-ai', 'whisper-safe', 'TabSaver', 'TabSaverAPI', 'fet-tracker'];

describe('folder to Notion matching', () => {
  it('normalizes punctuation and case', () => expect(normalizeName('Dark-Factory_2')).toBe('darkfactory2'));
  it('scores exact above containment above shared prefix', () => {
    expect(scoreMatch('dark-factory', 'Dark Factory')).toBe(1);
    expect(scoreMatch('ai-newsletter', 'AI Newsletter Agent')).toBeGreaterThan(scoreMatch('whisper-safe', 'WhisperVault'));
    expect(scoreMatch('whisper-safe', 'WhisperVault')).toBeGreaterThan(0);
    expect(scoreMatch('fet-tracker', 'Dark Factory')).toBe(0);
  });
  it('matches what it can and leaves the rest unmatched', () => {
    const m = matchFolders(folders, pages);
    expect(Object.fromEntries(m)).toEqual({ 'ai-newsletter': '5', 'Buddy Recomp': '4', 'dark-factory': '1', 'whisper-safe': '6' });
  });
  it('applies overrides first and never reuses a page', () => {
    const m = matchFolders(folders, pages, { 'chicken-friends': '2', 'sdlc-ai': '3', 'dark-factory': '999' });
    expect(m.get('chicken-friends')).toBe('2');
    expect(m.get('sdlc-ai')).toBe('3');
    expect(m.get('dark-factory')).toBe('1');
    expect(new Set(m.values()).size).toBe(m.size);
  });
  it('gives a page to only one folder', () => {
    const m = matchFolders(['dark-factory', 'dark-factory-api'], [{ id: '1', title: 'Dark Factory' }]);
    expect([...m.values()]).toEqual(['1']);
    expect(m.get('dark-factory')).toBe('1');
  });
});

describe('Notion parsing', () => {
  const todo = (t: string, checked: boolean, edited = '2026-10-01T00:00:00Z') => ({ type: 'to_do', last_edited_time: edited, to_do: { rich_text: [{ plain_text: t }], checked } });
  it('parses criteria with optional hour estimates and completion dates', () => {
    expect(parseCriterion(todo('Deploy to production (4h)', false))).toEqual({ title: 'Deploy to production', hours: 4, done: false, doneOn: undefined });
    expect(parseCriterion(todo('Auth', true))).toEqual({ title: 'Auth', hours: undefined, done: true, doneOn: '2026-10-01T00:00:00Z' });
    expect(parseCriterion({ type: 'paragraph' })).toBeUndefined();
    expect(parseCriterion(todo('  ', false))).toBeUndefined();
  });
  const page: NotionPage = {
    id: 'abc', url: 'https://notion.so/abc', created_time: '2026-08-01T00:00:00Z',
    properties: {
      Name: { title: [{ plain_text: 'Buddy Recomp' }] },
      Status: { status: { name: 'Beta' } },
      'Next action': { rich_text: [{ plain_text: 'Fix Safari bug' }] },
      Focus: { checkbox: true },
      Lifecycle: { select: { name: 'Active' } },
      'Stage changed': { date: { start: '2026-09-04' } },
    },
  };
  it('maps a page and its blocks', () => {
    const info = parsePage(page, [todo('Core flow', true), todo('Deploy (3h)', false)])!;
    expect(info).toMatchObject({ pageId: 'abc', title: 'Buddy Recomp', stage: 'Beta', nextAction: 'Fix Safari bug', focus: true, life: 'active', stageChangedAt: '2026-09-04' });
    expect(info.criteria).toHaveLength(2);
  });
  it('falls back to created time and defaults', () => {
    const p = { ...page, properties: { Name: page.properties.Name, Status: page.properties.Status } };
    expect(parsePage(p, [])).toMatchObject({ stageChangedAt: '2026-08-01T00:00:00Z', focus: false, life: 'active', nextAction: undefined });
  });
  it('skips pages with an unknown status', () => {
    expect(parsePage({ ...page, properties: { ...page.properties, Status: { status: { name: 'Someday' } } } }, [])).toBeUndefined();
  });
});

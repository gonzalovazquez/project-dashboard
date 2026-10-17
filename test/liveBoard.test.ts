import { describe, expect, it } from 'vitest';
import { matchFolders } from '../src/main/notion/match.js';
import { describeDiff, diffSchema, hasChanges, hasProblems } from '../src/main/notion/schema.js';

/** Titles and folder names captured from the real Brainstorming board and Development folder (Oct 2026). Names only. */
const pages = [
  { id: 'ade', title: 'Agentic Development Environment' }, { id: 'ain', title: 'AI Newsletter Agent' }, { id: 'bud', title: 'Buddy Recomp' },
  { id: 'dar', title: 'Dark Factory' }, { id: 'flo', title: 'Flockchat' }, { id: 'pro', title: 'Project Dashboard' },
  { id: 'spa', title: 'SparkRide: Turn Commutes into Startups' }, { id: 'whi', title: 'WhisperVault' },
];
const folders = ['ai-newsletter', 'ai-ticketing-pipeline', 'AWS-Exam-Helper', 'Buddy Recomp', 'budget-traffik', 'chicken-friends', 'dark-factory', 'fet-tracker', 'hal-intent-classifier', 'linear-developer-agent', 'pm-asp', 'project-dashboard', 'reward-chest', 'sdlc-ai', 'TabSaver', 'TabSaverAPI', 'TabSaverInfra', 'TabSaverMockAPI', 'travel-workouts', 'whisper-safe', 'ynab-daylio-llm', 'ynab-weekly-report'];

describe('against the real board', () => {
  it('matches five folders automatically and leaves no wrong matches', () => {
    expect(Object.fromEntries(matchFolders(folders, pages))).toEqual({
      'Buddy Recomp': 'bud', 'dark-factory': 'dar', 'project-dashboard': 'pro', 'ai-newsletter': 'ain', 'whisper-safe': 'whi',
    });
  });
  it('does not pair the four TabSaver folders or other unrelated folders with any page', () => {
    const m = matchFolders(folders, pages);
    for (const f of ['TabSaver', 'TabSaverAPI', 'TabSaverInfra', 'TabSaverMockAPI', 'budget-traffik', 'fet-tracker']) expect(m.has(f)).toBe(false);
  });
  it('reaches seven of eight pages with the two documented overrides', () => {
    const m = matchFolders(folders, pages, { 'chicken-friends': 'flo', 'sdlc-ai': 'ade' });
    expect(m.size).toBe(7);
    expect([...m.values()]).not.toContain('spa');
  });
  it('sees the six missing properties on the live schema and nothing else', () => {
    const status = { type: 'status', status: { options: ['Not started', 'In progress', 'Beta', 'General Available'].map((name) => ({ name })) } };
    const d = diffSchema({ properties: { Idea: { type: 'title' }, Status: status, Priority: { type: 'select' }, Category: { type: 'multi_select' }, Type: { type: 'multi_select' }, Place: { type: 'place' } } });
    expect(hasChanges(d)).toBe(true);
    expect(hasProblems(d)).toBe(false);
    expect(describeDiff(d)).toHaveLength(6);
  });
});

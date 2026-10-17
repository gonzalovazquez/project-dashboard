import { describe, expect, it } from 'vitest';
import type { Criterion, Project } from '../src/shared/types.js';
import { burnup, deepTiles, detailRows, healthModel, heatmap, kickoffPrompt, languageSegments, recentCommitRows, weekBars, writeAccess } from '../src/renderer/src/viewmodel/deepdive.js';
import { sampleProjects } from './fixtures/sample.js';
import { NOW, project } from './helpers.js';

const DAY = 86_400_000;
const iso = (daysBack: number) => new Date(NOW.getTime() - daysBack * DAY).toISOString();
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const by = (name: string) => sampleProjects().find((p) => p.name === name)!;
const withCriteria = (cs: Criterion[], over: Partial<Project> = {}) => project({ name: 'x', ...over }, { stage: 'In progress', stageChangedAt: iso(10), nextAction: 'Go', criteria: cs });
const c = (done: boolean, doneAgo?: number, hours?: number, title = 't'): Criterion => ({ title, done, doneOn: done && doneAgo !== undefined ? iso(doneAgo) : undefined, hours });

describe('burnup', () => {
  it('has twelve weekly points ending today at the current count', () => {
    const m = burnup(by('Buddy Recomp'), NOW);
    expect(m.points).toHaveLength(12);
    expect(m.points.at(-1)!.end).toBe(NOW.toISOString());
    expect(m.points.at(-1)!.done).toBe(3);
    expect(m).toMatchObject({ total: 6, done: 3, remaining: 3, ready: false, noCriteria: false });
  });
  it('is never decreasing and counts a criterion from the week it was completed', () => {
    // week i ends 7*(11-i) days ago: 30 days ago counts from week 7, 10 days ago from week 10
    const m = burnup(withCriteria([c(true, 10), c(false), c(true, 30)]), NOW);
    expect(m.points.map((p) => p.done)).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2]);
    for (let i = 1; i < 12; i++) expect(m.points[i].done).toBeGreaterThanOrEqual(m.points[i - 1].done);
  });
  it('counts criteria without a date as done from the start', () => {
    const m = burnup(withCriteria([c(true), c(false)]), NOW);
    expect(m.points[0].done).toBe(1);
    expect(m.points.at(-1)!.done).toBe(1);
  });
  it('shows nothing done and a projection when no criterion is complete yet', () => {
    const m = burnup(withCriteria([c(false, undefined, 2), c(false, undefined, 3)]), NOW);
    expect(m.points.every((p) => p.done === 0)).toBe(true);
    expect(m.done).toBe(0);
    expect(m.projection).toBeDefined();
    expect(m.projection!.velocity).toBe(0.25); // the floor, so the date is finite
    expect(m.projection!.days).toBe(56);
  });
  it('is ready with no projection when everything is done', () => {
    const m = burnup(withCriteria([c(true, 3), c(true, 20)]), NOW);
    expect(m).toMatchObject({ ready: true, remaining: 0, done: 2 });
    expect(m.projection).toBeUndefined();
  });
  it('says there are no criteria instead of drawing an empty chart', () => {
    const m = burnup(withCriteria([]), NOW);
    expect(m).toMatchObject({ noCriteria: true, total: 0, ready: false });
    expect(m.projection).toBeUndefined();
    expect(m.points.every((p) => p.done === 0)).toBe(true);
  });
  it('has no projection for an untracked project', () => {
    const m = burnup(project({ name: 'u' }), NOW);
    expect(m.noCriteria).toBe(true);
    expect(m.projection).toBeUndefined();
  });
  it('orders the earliest, expected and latest finish and reaches past all of them', () => {
    const m = burnup(by('dark-factory'), NOW).projection!;
    expect(m.low).toBeLessThanOrEqual(m.days);
    expect(m.days).toBeLessThanOrEqual(m.high);
    expect(Date.parse(m.lowDate)).toBeLessThanOrEqual(Date.parse(m.date));
    expect(m.reachDays).toBeGreaterThanOrEqual(m.high);
    expect(m.beyond).toBe(false);
  });
  it('caps the reach and flags a finish beyond it', () => {
    const slow = withCriteria(Array.from({ length: 40 }, () => c(false)));
    const m = burnup(slow, NOW).projection!;
    expect(m.reachDays).toBe(26 * 7);
    expect(m.beyond).toBe(true);
  });
  it('ticks every whole criterion for small checklists and rounds for large ones', () => {
    expect(burnup(withCriteria([c(false), c(false), c(false)]), NOW).ticks).toEqual([0, 1, 2, 3]);
    expect(burnup(withCriteria(Array.from({ length: 30 }, () => c(false))), NOW).ticks.at(-1)!).toBeGreaterThanOrEqual(30);
  });
});

describe('heatmap', () => {
  it('has 84 cells in 12 columns of 7 rows', () => {
    const m = heatmap(by('Buddy Recomp'), NOW);
    expect(m.cells).toHaveLength(84);
    expect(Math.max(...m.cells.map((x) => x.col))).toBe(11);
    expect(Math.max(...m.cells.map((x) => x.row))).toBe(6);
  });
  it('accounts for every commit exactly once', () => {
    const p = by('Buddy Recomp');
    const m = heatmap(p, NOW);
    expect(m.total).toBe(sum(p.daily));
    expect(m.total).toBe(sum(p.weekly));
    expect(sum(m.cells.map((x) => x.count))).toBe(m.total);
  });
  it('ends today and starts 83 days earlier', () => {
    const m = heatmap(by('Buddy Recomp'), NOW);
    expect(m.cells.at(-1)!.date).toBe(NOW.toISOString());
    expect(Date.parse(m.cells[0].date)).toBe(NOW.getTime() - 83 * DAY);
  });
  it('labels rows with seven consecutive weekdays that repeat down every column', () => {
    const m = heatmap(by('Buddy Recomp'), NOW);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const i = days.indexOf(m.rowLabels[0]);
    expect(m.rowLabels).toEqual(Array.from({ length: 7 }, (_, k) => days[(i + k) % 7]));
    const c5 = m.cells.filter((x) => x.col === 5);
    expect(c5.map((x) => new Date(x.date).toLocaleDateString('en-US', { weekday: 'short' }))).toEqual(m.rowLabels);
  });
  it('buckets intensity as none, one, two and three or more', () => {
    const p = { ...project({ name: 'x' }), daily: Object.assign(new Array(84).fill(0), { 0: 0, 1: 1, 2: 2, 3: 3, 4: 9 }) };
    expect(heatmap(p, NOW).cells.slice(0, 5).map((x) => x.level)).toEqual([0, 1, 2, 3, 3]);
    expect(heatmap(p, NOW).max).toBe(9);
  });
  it('survives missing or short daily data', () => {
    for (const daily of [undefined, [], [1, 2, 3]] as unknown as number[][]) {
      const m = heatmap({ ...project({ name: 'x' }), daily }, NOW);
      expect(m.cells).toHaveLength(84);
      expect(m.total).toBe(0);
    }
  });
  it('labels four columns along the bottom', () => expect(heatmap(by('dark-factory'), NOW).columnLabels.map((l) => l.col)).toEqual([0, 4, 8, 11]));
  it('has weekly bars that match the weekly counts', () => {
    const p = by('dark-factory');
    expect(weekBars(p, NOW).map((b) => b.value)).toEqual(p.weekly);
    expect(weekBars(p, NOW)).toHaveLength(12);
  });
});

describe('health, details and commits', () => {
  it('adds up to the score and names the risks that lower it', () => {
    const m = healthModel(by('sdlc-ai'), NOW);
    expect(m.score).toBe(Math.round(m.parts.reduce((a, x) => a + x.value * x.weight, 0)));
    expect(m.risks).toEqual(expect.arrayContaining(['In Beta for 90 days', 'No next action']));
    expect(m.level).toBe('Poor');
  });
  it('has no risks for a healthy project and grades it', () => {
    const m = healthModel(by('Buddy Recomp'), NOW);
    expect(m.risks).toEqual([]);
    expect(['Good', 'Fair']).toContain(m.level);
  });
  it('grades at the boundaries', () => {
    const g = (s: number) => (s >= 60 ? 'Good' : s >= 40 ? 'Fair' : 'Poor');
    expect([g(59), g(60), g(39), g(40)]).toEqual(['Fair', 'Good', 'Poor', 'Fair']);
  });
  it('describes the repository, branch, last commit and folder', () => {
    const rows = Object.fromEntries(detailRows({ ...by('Buddy Recomp'), branch: 'main' }, NOW));
    expect(rows['Repository']).toBe('gonzalovazquez/Buddy Recomp');
    expect(rows['Branch']).toBe('main · uncommitted changes');
    expect(rows['Notion status']).toBe('Beta');
    expect(rows['Time in stage']).toBe('38 days');
    expect(rows['Folder']).toBe('/dev/Buddy Recomp');
    const bare = Object.fromEntries(detailRows({ ...project({ name: 'n' }), github: undefined, isGit: false }, NOW));
    expect(bare['Repository']).toBe('No remote');
    expect(bare['Branch']).toBe('Not a git repository');
    expect(bare['Notion status']).toBe('Not tracked');
  });
  it('lists recent commits with compact ages', () => {
    const rows = recentCommitRows(by('dark-factory'), NOW);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.message.length > 0 && /^(today|\d+d|\d+w|\d+mo)$/.test(r.age))).toBe(true);
    expect(recentCommitRows(project({ name: 'n' }), NOW)).toEqual([]);
  });
  it('gives the top three languages a color and folds the rest together', () => {
    const p = { ...project({ name: 'x' }), languages: [{ name: 'TypeScript', share: 50 }, { name: 'CSS', share: 20 }, { name: 'Shell', share: 10 }, { name: 'Other', share: 20 }] };
    expect(languageSegments(p)).toEqual([
      { name: 'TypeScript', share: 50, token: 'series-1' }, { name: 'CSS', share: 20, token: 'series-2' }, { name: 'Shell', share: 10, token: 'series-3' }, { name: 'Other', share: 20, token: 'series-other' },
    ]);
    expect(languageSegments({ ...project({ name: 'y' }), languages: [] })).toEqual([]);
    const four = { ...project({ name: 'z' }), languages: [{ name: 'A', share: 40 }, { name: 'B', share: 30 }, { name: 'C', share: 20 }, { name: 'D', share: 10 }] };
    expect(languageSegments(four).map((s) => s.name)).toEqual(['A', 'B', 'C', 'Other']);
    expect(sum(languageSegments(four).map((s) => s.share))).toBe(100);
  });
});

describe('deep dive tiles', () => {
  const tile = (p: Project, id: string) => deepTiles(p, NOW).find((k) => k.id === id)!;
  const p = by('Buddy Recomp');
  it('has six tiles', () => expect(deepTiles(p, NOW)).toHaveLength(6));
  it('reports progress, forecast, velocity, effort, commits and health', () => {
    expect(tile(p, 'progress')).toMatchObject({ value: '50', unit: '%', sub: '3 of 6 criteria' });
    expect(tile(p, 'next-ship').value).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
    expect(tile(p, 'next-ship').sub).toBe('6.0 weeks away');
    expect(tile(p, 'commits')).toMatchObject({ value: '0.50', unit: '/ week' });
    expect(tile(p, 'health')).toMatchObject({ value: '13', unit: 'h', sub: '3 criteria open' });
    expect(tile(p, 'shipped')).toMatchObject({ value: '21', sub: 'vs 14 prior' });
    expect(tile(p, 'shipped').delta).toEqual({ tone: 'good', label: '▲ 50%' });
    expect(tile(p, 'attention').badge).toBeDefined();
  });
  it('says which open criteria have no hour estimate', () => {
    const q = withCriteria([c(false, undefined, 3), c(false), c(false)]);
    expect(tile(q, 'health')).toMatchObject({ value: '3', sub: '3 criteria open, 2 without an estimate' });
  });
  it('shows dashes with a reason when there are no criteria', () => {
    const q = withCriteria([]);
    expect(tile(q, 'progress')).toMatchObject({ value: '–', sub: 'No ship criteria yet' });
    expect(tile(q, 'next-ship')).toMatchObject({ value: '–', sub: 'Needs ship criteria' });
    expect(tile(q, 'commits').value).toBe('–');
    expect(tile(q, 'health').value).toBe('–');
  });
  it('says Ready when everything is done', () => {
    const q = withCriteria([c(true, 2), c(true, 9)]);
    expect(tile(q, 'next-ship')).toMatchObject({ value: 'Ready', sub: 'All criteria met' });
    expect(tile(q, 'health')).toMatchObject({ value: '0', sub: '0 criteria open' });
  });
  it('handles an untracked project without crashing', () => {
    const t = deepTiles(project({ name: 'u' }), NOW);
    expect(t).toHaveLength(6);
    expect(t.find((k) => k.id === 'attention')).toMatchObject({ value: '–', sub: 'Not tracked' });
  });
  it('compares commits with the prior four weeks without dividing by zero', () => {
    const q = { ...withCriteria([c(false)]), weekly: [...new Array(8).fill(0), 1, 2, 3, 4] };
    expect(tile(q, 'shipped').delta).toEqual({ tone: 'good', label: '▲ new' });
  });
});

describe('write access', () => {
  it('allows everything when connected', () => expect(writeAccess({ state: 'connected' })).toEqual({ criteria: true, properties: true }));
  it('still allows criteria when only the new properties are missing', () => {
    const a = writeAccess({ state: 'schema-missing' });
    expect(a).toMatchObject({ criteria: true, properties: false });
    expect(a.reason).toContain('missing properties');
  });
  it('blocks writes when Notion is unreachable or not connected, and says why', () => {
    for (const state of ['error', 'not-configured'] as const) {
      const a = writeAccess({ state });
      expect(a).toMatchObject({ criteria: false, properties: false });
      expect(a.reason).toBeTruthy();
    }
  });
});

describe('Claude Code prompt', () => {
  it('names the project, stage, next action and every open criterion with its estimate', () => {
    const text = kickoffPrompt(by('Buddy Recomp'), NOW);
    expect(text).toContain('Project: Buddy Recomp (/dev/Buddy Recomp)');
    expect(text).toContain('Stage: Beta, 38 days in this stage');
    expect(text).toContain('Progress: 3 of 6 ship criteria are done');
    expect(text).toContain('Next action: Fix macro import bug on Safari');
    expect(text).toContain('- Fix macro import bug (3h)');
    expect(text).toContain('- Use it daily for 7 days (6h)');
    expect(text).not.toContain('Core logging flow');
    expect(text).toMatch(/stop only for a real blocker/);
  });
  it('is honest when there is no next action or no criteria', () => {
    const text = kickoffPrompt(withCriteria([], { name: 'x' }) , NOW).replace('Next action: Go', 'Next action: Go');
    expect(text).toContain('Progress: no ship criteria are defined');
    expect(text).not.toContain('Open ship criteria');
    const none = project({ name: 'n' }, { stage: 'Beta', criteria: [c(false, undefined, undefined, 'Only one')] });
    expect(kickoffPrompt(none, NOW)).toContain('Next action: none is set');
    expect(kickoffPrompt(project({ name: 'u' }), NOW)).toContain('Stage: not tracked in Notion');
  });
});

import { describe, expect, it } from 'vitest';
import type { Project } from '../src/shared/types.js';
import { buildHeadline, buildInsights, buildOverview, progressSeries, weekDelta } from '../src/renderer/src/viewmodel/overview.js';
import { DEFAULT_SORT, nextSort, portfolioRows, sidebarModel, sortRows } from '../src/renderer/src/viewmodel/portfolio.js';
import { ago, fmtDate } from '../src/renderer/src/viewmodel/format.js';
import { sampleProjects } from './fixtures/sample.js';
import { NOW, project } from './helpers.js';

const text = (segs: Array<{ text: string }>) => segs.map((s) => s.text).join('');
const kpi = (ps: Project[], id: string) => buildOverview(ps, NOW).kpis.find((k) => k.id === id)!;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const untrackedOnly = () => sampleProjects().filter((p) => !p.notion);
const noFocus = () => sampleProjects().map((p) => (p.notion ? { ...p, notion: { ...p.notion, focus: false } } : p));

describe('formatting', () => {
  it('ages read at a glance', () => {
    expect([ago(null), ago(0), ago(5), ago(13), ago(14), ago(30), ago(69), ago(70), ago(200)]).toEqual(['–', 'today', '5d', '13d', '2w', '4w', '10w', '2mo', '7mo']);
  });
  it('dates are short', () => expect(fmtDate(new Date('2026-10-28T12:00:00Z'))).toBe('Oct 28'));
});

describe('weekDelta', () => {
  it('is flat when nothing changed, including zero to zero', () => {
    expect(weekDelta(5, 5)).toEqual({ tone: 'flat', label: '● 0%' });
    expect(weekDelta(0, 0)).toEqual({ tone: 'flat', label: '● 0%' });
  });
  it('shows a rise from zero as new instead of a huge percentage', () => expect(weekDelta(4, 0)).toEqual({ tone: 'good', label: '▲ new' }));
  it('computes percentages in both directions', () => {
    expect(weekDelta(12, 10)).toEqual({ tone: 'good', label: '▲ 20%' });
    expect(weekDelta(5, 10)).toEqual({ tone: 'bad', label: '▼ 50%' });
  });
  it('can treat a rise as bad', () => expect(weekDelta(12, 10, true)).toEqual({ tone: 'bad', label: '▲ 20%' }));
});

describe('progressSeries', () => {
  const p = (criteria: Array<{ done: boolean; doneOn?: string }>) => project({ name: 'x' }, { criteria: criteria.map((c, i) => ({ title: `c${i}`, ...c })) });
  it('has 12 points and ends at the current progress', () => {
    const s = progressSeries([p([{ done: true, doneOn: '2026-10-01T00:00:00Z' }, { done: false }])], NOW);
    expect(s).toHaveLength(12);
    expect(s[11]).toBe(50);
    expect(s[0]).toBe(0);
  });
  it('counts a criterion only from the week it was completed', () => {
    const s = progressSeries([p([{ done: true, doneOn: '2026-10-09T00:00:00Z' }, { done: false }])], NOW);
    expect(s.slice(0, 11).every((v) => v === 0)).toBe(true);
    expect(s[11]).toBe(50);
  });
  it('counts criteria without a date as done all along', () => {
    expect(progressSeries([p([{ done: true }, { done: false }])], NOW)[0]).toBe(50);
  });
  it('skips projects with no criteria', () => {
    expect(progressSeries([p([])], NOW).every((v) => v === 0)).toBe(true);
    expect(progressSeries([p([]), p([{ done: true }])], NOW)[11]).toBe(100);
  });
});

describe('headline', () => {
  it('reads like the mockup when three projects are in focus and none shipped', () => {
    const m = buildOverview(sampleProjects(), NOW);
    expect(text(m.headline)).toMatch(/^3 of 3 focus slots in use\. 0 shipped so far, and the first ship is forecast for [A-Z][a-z]{2} \d{1,2} \(.+\)\.$/);
    expect(m.headline.find((s) => s.text === '0 shipped')!.tone).toBe('bad');
    expect(m.headline.some((s) => s.tone === 'accent')).toBe(true);
  });
  it('only marks shipped as bad when it is zero', () => {
    const segs = buildHeadline({ focus: 2, shipped: 3, hasNotion: true });
    expect(segs.find((s) => s.text === '3 shipped')!.tone).toBeUndefined();
    expect(text(segs)).toBe('2 of 3 focus slots in use. 3 shipped so far.');
  });
  it('asks to connect Notion when nothing is tracked', () => expect(text(buildOverview(untrackedOnly(), NOW).headline)).toContain('Connect Notion'));
  it('asks to pick focus when no project is in focus', () => expect(text(buildOverview(noFocus(), NOW).headline)).toBe('No projects in focus. Pick up to 3 to start finishing.'));
});

describe('tiles', () => {
  const ps = sampleProjects();
  it('has the six tiles in order', () => expect(buildOverview(ps, NOW).kpis.map((k) => k.id)).toEqual(['shipped', 'progress', 'next-ship', 'commits', 'health', 'attention']));
  it('counts commits across every folder and compares with the prior week', () => {
    const k = kpi(ps, 'commits');
    expect(k.value).toBe(String(sum(ps.map((p) => p.weekly[11]))));
    expect(k.sub).toBe(`vs ${sum(ps.map((p) => p.weekly[10]))} prior`);
    expect(k.spark).toHaveLength(12);
    expect(k.spark![11]).toBe(Number(k.value));
  });
  it('shows zero shipped from the real data', () => {
    const k = kpi(ps, 'shipped');
    expect(k).toMatchObject({ value: '0', unit: 'of 6 tracked', sub: '0 projects in General Available' });
  });
  it('averages progress over focus projects that have criteria', () => {
    // Buddy 3 of 6, AI Newsletter 3 of 5, Dark Factory 2 of 5 -> (50 + 60 + 40) / 3 = 50
    const k = kpi(ps, 'progress');
    expect(k.value).toBe('50');
    expect(k.unit).toBe('%');
    expect(k.spark![11]).toBeCloseTo(50, 5);
    expect(k.sub).toMatch(/^\+\d+ criteria this week$/);
  });
  it('picks the earliest forecast among focus projects', () => {
    const k = kpi(ps, 'next-ship');
    expect(k.sub).toBe('AI Newsletter Agent');
  });
  it('reports focus health with a badge', () => {
    const k = kpi(ps, 'health');
    expect(Number(k.value)).toBeGreaterThanOrEqual(0);
    expect(Number(k.value)).toBeLessThanOrEqual(100);
    expect(k.badge!.label).toBe(Number(k.value) >= 60 ? 'Good' : Number(k.value) >= 40 ? 'Fair' : 'Poor');
    expect(k.sub).toMatch(/^Avg \d+ days in stage$/);
  });
  it('counts flagged active projects', () => {
    const k = kpi(ps, 'attention');
    expect(Number(k.value)).toBeGreaterThan(0);
    expect(k.sub).toBe('of 5 active projects flagged'.replace('5', String(ps.filter((p) => p.notion).length)));
  });

  describe('without any focus project', () => {
    it('shows dashes with an honest reason instead of zeros', () => {
      const m = buildOverview(noFocus(), NOW).kpis;
      const by = Object.fromEntries(m.map((k) => [k.id, k]));
      expect(by.progress).toMatchObject({ value: '–', sub: 'No projects in focus' });
      expect(by['next-ship']).toMatchObject({ value: '–' });
      expect(by.health).toMatchObject({ value: '–', sub: 'No projects in focus' });
      expect(by.progress.spark).toBeUndefined();
      expect(by.health.badge).toBeUndefined();
    });
  });
  describe('with focus projects that have no criteria', () => {
    it('says so and has no forecast', () => {
      const bare = sampleProjects().map((p) => (p.notion?.focus ? { ...p, notion: { ...p.notion, criteria: [] } } : p));
      const by = Object.fromEntries(buildOverview(bare, NOW).kpis.map((k) => [k.id, k]));
      expect(by.progress).toMatchObject({ value: '–', sub: 'No ship criteria yet' });
      expect(by['next-ship']).toMatchObject({ value: '–', sub: 'No focus project with criteria' });
    });
  });
  describe('without Notion', () => {
    it('keeps commits and dashes everything that needs Notion', () => {
      const ps = untrackedOnly().map((p, i) => (i === 0 ? { ...p, weekly: [...p.weekly.slice(0, 11), 3] } : p));
      const by = Object.fromEntries(buildOverview(ps, NOW).kpis.map((k) => [k.id, k]));
      for (const id of ['shipped', 'progress', 'next-ship', 'health', 'attention']) expect(by[id].value, id).toBe('–');
      expect(by.progress.sub).toBe('Connect Notion');
      expect(by.commits.value).toBe('3');
      expect(by.commits.sub).toBe(`vs ${sum(ps.map((p) => p.weekly[10]))} prior`);
      expect(by.commits.delta).toEqual(weekDelta(3, sum(ps.map((p) => p.weekly[10]))));
    });
  });
  describe('with zero commits last week and the week before', () => {
    it('does not divide by zero', () => {
      const quiet = sampleProjects().map((p) => ({ ...p, weekly: new Array(12).fill(0) }));
      const k = kpi(quiet, 'commits');
      expect(k.value).toBe('0');
      expect(k.delta).toEqual({ tone: 'flat', label: '● 0%' });
      expect(buildOverview(quiet, NOW).insights.find((i) => i.id === 'commits')).toBeUndefined();
    });
  });
  it('counts a project shipped in the last 90 days but not an older one', () => {
    const ship = (days: number) => project({ name: `s${days}` }, { stage: 'General Available', stageChangedAt: new Date(NOW.getTime() - days * 86_400_000).toISOString() });
    expect(kpi([ship(10), ship(120)], 'shipped').value).toBe('1');
  });
});

describe('highlights', () => {
  const ids = (ps: Project[]) => buildOverview(ps, NOW).insights.map((i) => i.id);
  it('calls out Beta as the bottleneck with real numbers', () => {
    const i = buildOverview(sampleProjects(), NOW).insights.find((x) => x.id === 'beta')!;
    expect(i.tone).toBe('bad');
    expect(i.text).toBe('4 of 6 tracked projects sit in Beta for 60 days on average. 0 shipped.');
  });
  it('does not call Beta a bottleneck with fewer than three', () => {
    const few = sampleProjects().map((p) => (p.name === 'whisper-safe' || p.name === 'sdlc-ai' ? { ...p, notion: { ...p.notion!, stage: 'In progress' as const } } : p));
    expect(ids(few)).not.toContain('beta');
  });
  it('names the cheapest project to finish and whether it has a focus slot', () => {
    const i = buildOverview(sampleProjects(), NOW).insights.find((x) => x.id === 'cheapest')!;
    expect(i.lead).toMatch(/^Cheapest to finish: .+\.$/);
    expect(i.text).toMatch(/^\d+% done, \d+ criteria( and about \d+ hours)? left, (low|medium|high) complexity\./);
  });
  it('ignores projects with no progress when choosing the cheapest', () => {
    const fresh = sampleProjects().map((p) => (p.notion ? { ...p, notion: { ...p.notion, criteria: p.notion.criteria.map((c) => ({ ...c, done: false })) } } : p));
    expect(ids(fresh)).not.toContain('cheapest');
  });
  it('flags focus projects with no recent commits', () => {
    const quiet = sampleProjects().map((p) => (p.name === 'dark-factory' ? { ...p, pulse: { ...p.pulse, lastActivityDays: 20 } } : p));
    const i = buildOverview(quiet, NOW).insights.find((x) => x.id === 'quiet-dark-factory')!;
    expect(i.lead).toBe('Dark Factory is in focus but quiet.');
    expect(i.text).toBe('No commits in 20 days.');
  });
  it('lists active projects with no next action', () => {
    const i = buildOverview(sampleProjects(), NOW).insights.find((x) => x.id === 'no-next')!;
    expect(i.lead).toBe('2 active projects have no next action:');
    expect(i.text).toBe('Flockchat, Agentic Development Environment.');
  });
  it('uses the singular for one project', () => {
    const one = sampleProjects().map((p) => (p.name === 'sdlc-ai' ? { ...p, notion: { ...p.notion!, nextAction: 'x' } } : p));
    expect(buildOverview(one, NOW).insights.find((x) => x.id === 'no-next')!.lead).toBe('1 active project has no next action:');
  });
  it('reports the commit trend in the right direction', () => {
    const up = buildInsights([project({ name: 'a' })], NOW, { c1: 12, c0: 10 }).find((i) => i.id === 'commits')!;
    expect(up).toMatchObject({ tone: 'good', glyph: '↑', lead: 'Commits are up 20% week over week', text: '(12 vs 10).' });
    const down = buildInsights([project({ name: 'a' })], NOW, { c1: 5, c0: 10 }).find((i) => i.id === 'commits')!;
    expect(down).toMatchObject({ tone: 'warn', glyph: '↓', lead: 'Commits are down 50% week over week' });
    expect(buildInsights([project({ name: 'a' })], NOW, { c1: 3, c0: 0 }).find((i) => i.id === 'commits')!.lead).toBe('Commits are up from nothing last week');
  });
  it('counts untracked folders only once Notion is connected', () => {
    expect(buildOverview(sampleProjects(), NOW).insights.find((i) => i.id === 'untracked')!.lead).toBe('15 of 21 folders are not in Notion.');
    expect(ids(untrackedOnly())).not.toContain('untracked');
  });
  it('explains that Notion is missing instead of inventing insights', () => {
    const got = ids(untrackedOnly());
    expect(got).toContain('no-notion');
    expect(got).not.toContain('beta');
    expect(got).not.toContain('cheapest');
  });
});

describe('portfolio table', () => {
  const now = NOW;
  const rows = () => portfolioRows(sampleProjects(), now);
  it('lists tracked, active projects only', () => {
    expect(rows()).toHaveLength(6);
    const parked = sampleProjects().map((p) => (p.name === 'whisper-safe' ? { ...p, notion: { ...p.notion!, life: 'parked' as const } } : p));
    expect(portfolioRows(parked, now).map((r) => r.name)).not.toContain('whisper-safe');
  });
  it('carries progress, forecast, health and time in stage', () => {
    const buddy = rows().find((r) => r.name === 'Buddy Recomp')!;
    expect(buddy).toMatchObject({ progress: 0.5, doneCount: 3, criteriaCount: 6, stageDays: 38, isFocus: true, stage: 'Beta', ready: false });
    expect(buddy.forecast).toBeDefined();
    expect(buddy.health).toBeGreaterThan(0);
  });
  it('has no forecast for shipped projects and marks finished ones ready', () => {
    const done = project({ name: 'd' }, { criteria: [{ title: 'a', done: true }] });
    const shipped = project({ name: 's' }, { stage: 'General Available', criteria: [{ title: 'a', done: false }] });
    const [d, s] = portfolioRows([done, shipped], now);
    expect(d).toMatchObject({ ready: true, forecast: undefined });
    expect(s).toMatchObject({ ready: false, forecast: undefined });
  });
  it('handles a page with no criteria', () => {
    const [r] = portfolioRows([project({ name: 'n' }, { criteria: [] })], now);
    expect(r).toMatchObject({ progress: undefined, forecast: undefined, ready: false, criteriaCount: 0 });
  });

  it('defaults to closest to done first', () => {
    const order = sortRows(rows(), DEFAULT_SORT).map((r) => r.title);
    const scores = sortRows(rows(), DEFAULT_SORT).map((r) => r.finish);
    expect(scores).toEqual(scores.slice().sort((a, b) => b - a));
    expect(order).toHaveLength(6);
  });
  it('sorts text ascending and numbers either way', () => {
    expect(sortRows(rows(), { key: 'name', dir: 'asc' }).map((r) => r.title)).toEqual(['Agentic Development Environment', 'AI Newsletter Agent', 'Buddy Recomp', 'Dark Factory', 'Flockchat', 'WhisperVault']);
    const asc = sortRows(rows(), { key: 'complexity', dir: 'asc' }).map((r) => r.complexity);
    expect(asc).toEqual(asc.slice().sort((a, b) => a - b));
    expect(sortRows(rows(), { key: 'age', dir: 'desc' })[0].stageDays).toBe(90);
  });
  it('puts missing values last in both directions', () => {
    const rs = [...rows(), ...portfolioRows([project({ name: 'bare' }, { criteria: [] })], now)];
    for (const dir of ['asc', 'desc'] as const) {
      expect(sortRows(rs, { key: 'forecast', dir }).at(-1)!.title).toBe('bare');
      expect(sortRows(rs, { key: 'progress', dir }).at(-1)!.title).toBe('bare');
    }
  });
  it('is stable: equal values fall back to the name', () => {
    const a = project({ name: 'b' }, { title: 'Bravo', criteria: [] });
    const b = project({ name: 'a' }, { title: 'Alpha', criteria: [] });
    expect(sortRows(portfolioRows([a, b], now), { key: 'complexity', dir: 'desc' }).map((r) => r.title)).toEqual(['Alpha', 'Bravo']);
  });
  it('orders stages by progression and pulse by heat', () => {
    expect(sortRows(rows(), { key: 'stage', dir: 'asc' })[0].stage).toBe('In progress');
    const hot = sortRows(rows(), { key: 'pulse', dir: 'desc' })[0];
    expect(hot.pulseLevel).toBe('Hot');
  });
  it('toggles direction on the same column and starts text columns ascending', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' });
    expect(nextSort({ key: 'name', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' });
    expect(nextSort(DEFAULT_SORT, 'name')).toEqual({ key: 'name', dir: 'asc' });
    expect(nextSort(DEFAULT_SORT, 'forecast')).toEqual({ key: 'forecast', dir: 'asc' });
    expect(nextSort(DEFAULT_SORT, 'health')).toEqual({ key: 'health', dir: 'desc' });
  });
});

describe('sidebar model', () => {
  it('lists focus projects with progress and counts the library', () => {
    const m = sidebarModel(sampleProjects(), NOW);
    expect(m.focus.map((f) => f.title)).toEqual(['Buddy Recomp', 'AI Newsletter Agent', 'Dark Factory']);
    expect(m.focus[0].progress).toBe(0.5);
    expect(m.openSlots).toBe(0);
    expect(m.counts).toMatchObject({ all: 21, inbox: 15, parked: 0, shipped: 0 });
    expect(m.counts.flagged).toBeGreaterThan(0);
  });
  it('shows open slots', () => {
    expect(sidebarModel(noFocus(), NOW).openSlots).toBe(3);
    expect(sidebarModel(untrackedOnly(), NOW)).toMatchObject({ focus: [], openSlots: 3, counts: { all: 15, inbox: 15 } });
  });
});

import { describe, expect, it } from 'vitest';
import type { Project, StagePoint } from '../src/shared/types.js';
import {
  activityMix, ageBars, ageTable, bubbleRadius, commitSeries, commitTable, countTable, forecastRows, forecastTable, isQuickWin, niceTicks, placeLabels,
  scatterPoints, scatterTable, stageColumns, stageTable, techBreakdown, type LabelInput,
} from '../src/renderer/src/viewmodel/charts.js';
import { sampleProjects } from './fixtures/sample.js';
import { NOW, project } from './helpers.js';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const noFocus = () => sampleProjects().map((p) => (p.notion ? { ...p, notion: { ...p.notion, focus: false } } : p));

describe('niceTicks', () => {
  it('ticks small ranges by one', () => {
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(1)).toEqual([0, 1]);
    expect(niceTicks(5)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it('steps by 2, 5, 10 and so on as the range grows', () => {
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(18)).toEqual([0, 5, 10, 15, 20]);
    expect(niceTicks(45)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(niceTicks(130)).toEqual([0, 50, 100, 150]);
    expect(niceTicks(480)).toEqual([0, 100, 200, 300, 400, 500]);
  });
  it('never returns an empty axis, even for zero or nonsense', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(-4)).toEqual([0, 1]);
  });
  it('only ever returns whole numbers, starts at zero, ends at or above the maximum, and has at most five intervals', () => {
    for (const m of [1, 2, 3, 4, 6, 7, 9, 11, 13, 17, 24, 26, 49, 51, 99, 101, 249, 480, 1234, 99999]) {
      const t = niceTicks(m);
      expect(t[0]).toBe(0);
      expect(t.at(-1)!).toBeGreaterThanOrEqual(m);
      expect(t.every(Number.isInteger), `max ${m}`).toBe(true);
      expect(t.length - 1).toBeLessThanOrEqual(5);
    }
  });
  it('rounds a fractional maximum up', () => expect(niceTicks(2.2).at(-1)).toBe(3));
});

describe('commitSeries', () => {
  const ps = sampleProjects();
  it('stacks everything else first, then each focus project in slot order', () => {
    const m = commitSeries(ps, NOW, 12);
    expect(m.series.map((s) => s.id)).toEqual(['other', 'Buddy Recomp', 'ai-newsletter', 'dark-factory']);
    expect(m.series.map((s) => s.token)).toEqual(['series-other', 'series-1', 'series-2', 'series-3']);
    expect(m.series[0].name).toBe('Other projects');
    expect(m.series[2].name).toBe('AI Newsletter Agent');
  });
  it('accounts for every commit exactly once', () => {
    const m = commitSeries(ps, NOW, 12);
    expect(m.total).toBe(sum(ps.flatMap((p) => p.weekly)));
    expect(m.totals).toEqual(Array.from({ length: 12 }, (_, i) => sum(ps.map((p) => p.weekly[i]))));
  });
  it('slices the last 4 weeks and keeps the newest', () => {
    const m = commitSeries(ps, NOW, 4);
    expect(m.weeks).toHaveLength(4);
    expect(m.series.every((s) => s.values.length === 4)).toBe(true);
    expect(m.totals).toEqual(Array.from({ length: 4 }, (_, j) => sum(ps.map((p) => p.weekly[8 + j]))));
    expect(m.weeks.at(-1)!.end).toBe(NOW.toISOString());
  });
  it('names the single series All projects when nothing is in focus', () => {
    const m = commitSeries(noFocus(), NOW, 12);
    expect(m.series).toHaveLength(1);
    expect(m.series[0]).toMatchObject({ name: 'All projects', token: 'series-other' });
  });
  it('folds focus projects beyond the third into the rest instead of inventing a color', () => {
    const four = [...ps.slice(0, 3), { ...ps[3], notion: { ...ps[3].notion!, focus: true } }, ...ps.slice(4)];
    const m = commitSeries(four, NOW, 12);
    expect(m.series).toHaveLength(4);
    expect(m.total).toBe(sum(four.flatMap((p) => p.weekly)));
  });
  it('handles all zeros with a usable axis', () => {
    const m = commitSeries(ps.map((p) => ({ ...p, weekly: new Array(12).fill(0) })), NOW, 12);
    expect(m.max).toBe(0);
    expect(m.ticks).toEqual([0, 1]);
  });
  it('handles one project with a huge week', () => {
    const big = [{ ...project({ name: 'x' }), weekly: [...new Array(11).fill(0), 480] }];
    const m = commitSeries(big, NOW, 12);
    expect(m.max).toBe(480);
    expect(m.ticks.at(-1)!).toBeGreaterThanOrEqual(480);
  });
  it('has a table with one row per week and a total column', () => {
    const t = commitTable(commitSeries(ps, NOW, 4));
    expect(t.head).toEqual(['Week ending', 'Other projects', 'Buddy Recomp', 'AI Newsletter Agent', 'Dark Factory', 'Total']);
    expect(t.rows).toHaveLength(4);
    for (const r of t.rows) expect(Number(r.at(-1))).toBe(sum(r.slice(1, -1).map(Number)));
  });
});

describe('forecastRows', () => {
  const ps = sampleProjects();
  it('has a row for each focus project with criteria, in slot order with matching colors', () => {
    const m = forecastRows(ps, NOW);
    expect(m.rows.map((r) => r.name)).toEqual(['Buddy Recomp', 'ai-newsletter', 'dark-factory']);
    expect(m.rows.map((r) => r.token)).toEqual(['series-1', 'series-2', 'series-3']);
    expect(m.capDays).toBe(168);
  });
  it('orders low, expected and high dates', () => {
    for (const r of forecastRows(ps, NOW).rows) {
      expect(Date.parse(r.low)).toBeLessThanOrEqual(Date.parse(r.date));
      expect(Date.parse(r.date)).toBeLessThanOrEqual(Date.parse(r.high));
      expect(r.days).toBe(Math.round(r.weeks * 7));
    }
  });
  it('marks a forecast past the chart edge', () => {
    const slow = ps.map((p) => (p.name === 'dark-factory' ? { ...p, notion: { ...p.notion!, criteria: p.notion!.criteria.map((c) => ({ ...c, done: false, doneOn: undefined })) } } : p));
    const r = forecastRows(slow, NOW).rows.find((x) => x.name === 'dark-factory')!;
    expect(r.weeks).toBe(20);
    expect(r.beyond).toBe(false);
    expect(forecastRows(slow, NOW, 12).rows.find((x) => x.name === 'dark-factory')!.beyond).toBe(true);
  });
  it('reports a finished project as ready', () => {
    const done = ps.map((p) => (p.name === 'dark-factory' ? { ...p, notion: { ...p.notion!, criteria: p.notion!.criteria.map((c) => ({ ...c, done: true })) } } : p));
    const r = forecastRows(done, NOW).rows.find((x) => x.name === 'dark-factory')!;
    expect(r).toMatchObject({ ready: true, remaining: 0, weeks: 0 });
    expect(forecastTable(forecastRows(done, NOW)).rows.find((x) => x[0] === 'Dark Factory')!.slice(1, 3)).toEqual(['Ready', '–']);
  });
  it('lists focus projects without criteria instead of inventing a date', () => {
    const bare = ps.map((p) => (p.name === 'dark-factory' ? { ...p, notion: { ...p.notion!, criteria: [] } } : p));
    const m = forecastRows(bare, NOW);
    expect(m.rows.map((r) => r.name)).not.toContain('dark-factory');
    expect(m.withoutCriteria).toEqual(['Dark Factory']);
  });
  it('is empty without focus', () => expect(forecastRows(noFocus(), NOW).rows).toEqual([]));
});

describe('scatterPoints', () => {
  const ps = sampleProjects();
  it('plots tracked active projects with criteria', () => {
    const m = scatterPoints(ps);
    expect(m.points).toHaveLength(6);
    expect(m.points.find((p) => p.name === 'Buddy Recomp')).toMatchObject({ progress: 50, complexity: 58, stage: 'Beta', focus: true });
    expect(m.withoutCriteria).toBe(0);
  });
  it('counts, but does not plot, projects with no criteria', () => {
    const bare = ps.map((p) => (p.name === 'sdlc-ai' ? { ...p, notion: { ...p.notion!, criteria: [] } } : p));
    const m = scatterPoints(bare);
    expect(m.points.map((p) => p.name)).not.toContain('sdlc-ai');
    expect(m.withoutCriteria).toBe(1);
  });
  it('leaves out parked projects and untracked folders', () => {
    const parked = ps.map((p) => (p.name === 'whisper-safe' ? { ...p, notion: { ...p.notion!, life: 'parked' as const } } : p));
    expect(scatterPoints(parked).points.map((p) => p.name)).not.toContain('whisper-safe');
  });
  it('sizes bubbles by recent activity within limits', () => {
    expect(bubbleRadius(0)).toBe(6);
    expect(bubbleRadius(4)).toBeCloseTo(9.2);
    expect(bubbleRadius(10_000)).toBe(22);
    expect(bubbleRadius(-3)).toBe(6);
  });
  it('knows the quick-win corner', () => {
    expect(isQuickWin({ complexity: 59, progress: 50 })).toBe(true);
    expect(isQuickWin({ complexity: 60, progress: 90 })).toBe(false);
    expect(isQuickWin({ complexity: 30, progress: 49 })).toBe(false);
  });
  it('has a table row per point', () => expect(scatterTable(scatterPoints(ps)).rows).toHaveLength(6));
});

describe('placeLabels', () => {
  const bounds = { left: 40, top: 12, right: 600, bottom: 260 };
  const boxOverlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const circleHits = (b: { x: number; y: number; w: number; h: number }, c: LabelInput) => {
    const nx = Math.max(b.x, Math.min(c.cx, b.x + b.w)); const ny = Math.max(b.y, Math.min(c.cy, b.y + b.h));
    return (nx - c.cx) ** 2 + (ny - c.cy) ** 2 < c.r ** 2;
  };
  const assertClean = (inputs: LabelInput[]) => {
    const boxes = placeLabels(inputs, bounds);
    expect(boxes).toHaveLength(inputs.length);
    boxes.forEach((b, i) => {
      expect(b.collides, b.text).toBe(false);
      for (let j = i + 1; j < boxes.length; j++) expect(boxOverlap(b, boxes[j]), `${b.text} vs ${boxes[j].text}`).toBe(false);
      for (const c of inputs) expect(circleHits(b, c), `${b.text} over ${c.text}'s bubble`).toBe(false);
      expect(b.x).toBeGreaterThanOrEqual(bounds.left); expect(b.x + b.w).toBeLessThanOrEqual(bounds.right);
      expect(b.y).toBeGreaterThanOrEqual(bounds.top); expect(b.y + b.h).toBeLessThanOrEqual(bounds.bottom);
    });
  };
  it('places a single label to the right', () => {
    const [b] = placeLabels([{ id: 'a', text: 'Alpha', cx: 100, cy: 100, r: 8 }], bounds);
    expect(b).toMatchObject({ anchor: 'start', collides: false });
    expect(b.x).toBeGreaterThan(108);
  });
  it('keeps two bubbles at almost the same spot readable', () => {
    assertClean([{ id: 'a', text: 'Buddy Recomp', cx: 300, cy: 120, r: 10 }, { id: 'b', text: 'AI Newsletter Agent', cx: 330, cy: 120, r: 9 }]);
  });
  it('moves a label left when the bubble sits at the right edge', () => {
    const [b] = placeLabels([{ id: 'a', text: 'Agentic Development', cx: 580, cy: 100, r: 8 }], bounds);
    expect(b.anchor).toBe('end');
    expect(b.x + b.w).toBeLessThanOrEqual(bounds.right);
  });
  it('places labels for the real sample data without a single collision', () => {
    const m = scatterPoints(sampleProjects());
    const px = (v: number) => 40 + (v / 100) * 560;
    const py = (v: number) => 260 - (v / 100) * 240;
    assertClean(m.points.map((p) => ({ id: p.name, text: p.title.length > 22 ? p.title.slice(0, 21) + '…' : p.title, cx: px(p.complexity), cy: py(p.progress), r: bubbleRadius(p.commits4w) })));
  });
  it('resolves a crowd of eight bubbles in a tight cluster', () => {
    const inputs = Array.from({ length: 8 }, (_, i): LabelInput => ({ id: `p${i}`, text: `Project ${i}`, cx: 250 + (i % 4) * 22, cy: 100 + Math.floor(i / 4) * 24, r: 7 }));
    const boxes = placeLabels(inputs, bounds);
    boxes.forEach((b, i) => { for (let j = i + 1; j < boxes.length; j++) expect(boxOverlap(b, boxes[j])).toBe(false); });
  });
  it('reports a collision instead of hiding it when there is no room', () => {
    const tiny = { left: 0, top: 0, right: 40, bottom: 20 };
    const boxes = placeLabels([{ id: 'a', text: 'A very long project name', cx: 20, cy: 10, r: 8 }], tiny);
    expect(boxes[0].collides).toBe(true);
  });
  it('is deterministic', () => {
    const inputs = scatterPoints(sampleProjects()).points.map((p) => ({ id: p.name, text: p.title, cx: p.complexity * 5 + 40, cy: 260 - p.progress * 2.4, r: bubbleRadius(p.commits4w) }));
    expect(placeLabels(inputs, bounds)).toEqual(placeLabels([...inputs].reverse(), bounds));
  });
});

describe('ageBars', () => {
  const ps = sampleProjects();
  it('lists live tracked projects, oldest stage first', () => {
    const bars = ageBars(ps, NOW);
    expect(bars).toHaveLength(6);
    expect(bars.map((b) => b.days)).toEqual(bars.map((b) => b.days).slice().sort((a, b) => b - a));
    expect(bars[0]).toMatchObject({ name: 'sdlc-ai', days: 90 });
  });
  it('uses the same review points as the flags: 45 days in Beta, 30 in progress', () => {
    const by = Object.fromEntries(ageBars(ps, NOW).map((b) => [b.name, b]));
    expect(by['sdlc-ai']).toMatchObject({ threshold: 45, over: true });
    expect(by['Buddy Recomp']).toMatchObject({ threshold: 45, over: false, days: 38 });
    expect(by['dark-factory']).toMatchObject({ threshold: 30, over: false, days: 27 });
    expect(by['chicken-friends']).toMatchObject({ threshold: 30, over: true, days: 44 });
  });
  it('has no review point for a project that has not started', () => {
    const [b] = ageBars([project({ name: 'n' }, { stage: 'Not started', stageChangedAt: '2026-10-01T00:00:00Z' })], NOW);
    expect(b.threshold).toBeUndefined();
    expect(b.over).toBe(false);
  });
  it('does not flag exactly on the review point', () => {
    const at45 = project({ name: 'x' }, { stage: 'Beta', stageChangedAt: new Date(NOW.getTime() - 45 * 86_400_000).toISOString() });
    expect(ageBars([at45], NOW)[0].over).toBe(false);
  });
  it('skips shipped, parked and untracked projects', () => {
    const rest = [project({ name: 'a' }), project({ name: 'b' }, { life: 'parked' }), project({ name: 'c' }, { stage: 'General Available' })];
    expect(ageBars(rest, NOW)).toEqual([]);
  });
  it('has a table that says which are past their review point', () => {
    expect(ageTable(ageBars(ps, NOW)).rows.filter((r) => r[4] === 'Past review point').length).toBe(ageBars(ps, NOW).filter((b) => b.over).length);
  });
});

describe('activity and technology', () => {
  const ps = sampleProjects();
  it('counts every folder in exactly one activity level, hottest first', () => {
    const mix = activityMix(ps);
    expect(mix.map((m) => m.label)).toEqual(['Hot', 'Warm', 'Cooling', 'Dormant']);
    expect(sum(mix.map((m) => m.value))).toBe(ps.length);
  });
  it('ranks technologies by how many projects use them, counting each project once', () => {
    const t = techBreakdown(ps);
    expect(t.length).toBeLessThanOrEqual(6);
    expect(t.map((x) => x.value)).toEqual(t.map((x) => x.value).slice().sort((a, b) => b - a));
    expect(t.find((x) => x.label === 'TypeScript')!.value).toBe(ps.filter((p) => p.tech.includes('TypeScript')).length);
    const dup = techBreakdown([project({ name: 'a', tech: ['Node', 'Node'] })]);
    expect(dup).toEqual([{ label: 'Node', value: 1 }]);
  });
  it('breaks ties alphabetically and respects the limit', () => {
    const rs = [project({ name: 'a', tech: ['B', 'A'] }), project({ name: 'b', tech: ['C'] })];
    expect(techBreakdown(rs).map((x) => x.label)).toEqual(['A', 'B', 'C']);
    expect(techBreakdown(rs, 2)).toHaveLength(2);
    expect(techBreakdown([])).toEqual([]);
  });
  it('has tables', () => expect(countTable('Technology', techBreakdown(ps)).head).toEqual(['Technology', 'Projects']));
});

describe('stageColumns', () => {
  const day = (back: number) => { const d = new Date(NOW.getTime() - back * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const pt = (back: number, beta: number): StagePoint => ({ date: day(back), counts: { 'Not started': 0, 'In progress': 2, Beta: beta, 'General Available': 0 } });
  it('is sparse with no history and says nothing started', () => {
    const m = stageColumns([], NOW, 12);
    expect(m).toMatchObject({ columns: [], sparse: true, startedOn: undefined, max: 0 });
    expect(m.slots).toHaveLength(12);
  });
  it('is sparse with a single day of history', () => {
    const m = stageColumns([pt(0, 4)], NOW, 12);
    expect(m.columns).toHaveLength(1);
    expect(m.sparse).toBe(true);
    expect(m.startedOn).toBe(day(0));
    expect(m.columns[0]).toMatchObject({ slot: 11, total: 6 });
  });
  it('takes the latest point in each week and leaves empty weeks empty', () => {
    // 25 days back is week 8, 20 and 16 are both week 9, 3 and 1 are both week 11. Weeks 10 and the rest have no record.
    const m = stageColumns([pt(25, 1), pt(20, 2), pt(16, 3), pt(3, 4), pt(1, 5)], NOW, 12);
    expect(m.columns.map((c) => c.slot)).toEqual([8, 9, 11]);
    expect(m.columns.map((c) => c.counts.Beta)).toEqual([1, 3, 5]);
    expect(m.sparse).toBe(false);
  });
  it('ignores points outside the range and reports the start of history', () => {
    const m = stageColumns([pt(200, 9), pt(2, 3)], NOW, 4);
    expect(m.columns).toHaveLength(1);
    expect(m.startedOn).toBe(day(200));
  });
  it('scales the axis to the tallest column', () => {
    const m = stageColumns([pt(8, 10), pt(1, 3)], NOW, 12);
    expect(m.max).toBe(12);
    expect(m.ticks.at(-1)!).toBeGreaterThanOrEqual(12);
  });
  it('has a table with the recording date', () => {
    const t = stageTable(stageColumns([pt(1, 3)], NOW, 12));
    expect(t.head.slice(0, 2)).toEqual(['Week ending', 'Recorded on']);
    expect(t.rows[0][1]).toBe(day(1));
  });
});

export type { Project };

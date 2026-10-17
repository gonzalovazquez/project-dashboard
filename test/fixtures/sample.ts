import type { Criterion, Project } from '../../src/shared/types.js';
import { computePulse } from '../../src/main/scanner/pulse.js';
import { NOW, project } from '../helpers.js';

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();

const crit = (items: Array<[string, number | null, number?]>): Criterion[] =>
  items.map(([title, doneAgo, hours], i) => ({ blockId: `b${i}-${title}`, title, done: doneAgo !== null, doneOn: doneAgo !== null ? daysAgo(doneAgo) : undefined, hours: doneAgo === null ? hours : undefined }));

interface Tracked {
  name: string; title: string; stage: 'Not started' | 'In progress' | 'Beta' | 'General Available'; focus: boolean; complexity: number; weekly: number[];
  dirty?: boolean; stageDays: number; next?: string; criteria: Criterion[]; github?: boolean; tech: string[]; lastActivityDays?: number;
}

const MESSAGES = ['Fix flaky retry in sync job', 'Add loading state to list view', 'Refactor config loading', 'Tighten input validation', 'Bump dependencies', 'Write README setup steps', 'Handle empty response from API', 'Add basic integration test', 'Rename env vars, update docs', 'Wire the review step into the planner'];
const seed = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Spreads each week's commits over its seven days, the same way every time. Sums back to the weekly totals. */
function spreadDaily(weekly: number[], name: string): number[] {
  const h = seed(name);
  const daily = new Array<number>(84).fill(0);
  weekly.forEach((count, w) => { for (let j = 0; j < count; j++) daily[w * 7 + ((h + w * 5 + j * 3 + (j % 2)) % 7)]++; });
  return daily;
}

function recent(daily: number[], name: string): Array<{ date: string; message: string }> {
  const out: Array<{ date: string; message: string }> = [];
  const h = seed(name);
  for (let i = 83; i >= 0 && out.length < 5; i--) for (let k = 0; k < daily[i] && out.length < 5; k++) out.push({ date: new Date(NOW.getTime() - (83 - i) * DAY - k * 3_600_000).toISOString(), message: MESSAGES[(h + out.length * 3) % MESSAGES.length] });
  return out;
}

function lastDays(weekly: number[]): number | null {
  const i = weekly.map((v) => v > 0).lastIndexOf(true);
  return i < 0 ? null : (11 - i) * 7 + 1;
}

function tracked(t: Tracked): Project {
  const last = t.lastActivityDays ?? lastDays(t.weekly);
  return project({
    name: t.name, dirty: t.dirty ?? false, weekly: t.weekly, daily: spreadDaily(t.weekly, t.name), recentCommits: recent(spreadDaily(t.weekly, t.name), t.name), tech: t.tech, languages: langs(t.tech),
    github: t.github === false ? undefined : `https://github.com/gonzalovazquez/${t.name}`,
    complexity: { score: t.complexity, level: t.complexity < 25 ? 'Low' : t.complexity < 60 ? 'Medium' : 'High', parts: [] },
    pulse: computePulse(t.weekly, t.dirty ?? false, last === null ? undefined : new Date(NOW.getTime() - last * DAY), NOW),
  }, {
    title: t.title, stage: t.stage, focus: t.focus, stageChangedAt: daysAgo(t.stageDays), nextAction: t.next, criteria: t.criteria,
  });
}

/** A plausible language mix from a project's technology tags. */
function langs(tech: string[]) {
  const known = tech.filter((t) => ['TypeScript', 'Python', 'Swift', 'Go', 'Rust'].includes(t));
  if (known.length === 0) return [];
  const shares = [62, 24, 9, 5].slice(0, known.length);
  const total = shares.reduce((a, b) => a + b, 0);
  return [...known.map((name, i) => ({ name, share: Math.round((shares[i] / total) * 92) })), { name: "Other", share: 0 }].map((l, _i, all) => (l.name === "Other" ? { ...l, share: 100 - all.slice(0, -1).reduce((a, b) => a + b.share, 0) } : l));
}

function untracked(name: string, tech: string[], complexity: number, weekly: number[], github = true): Project {
  const last = lastDays(weekly);
  return project({
    name, tech, weekly, daily: spreadDaily(weekly, name), recentCommits: recent(spreadDaily(weekly, name), name), languages: langs(tech), github: github ? `https://github.com/gonzalovazquez/${name}` : undefined,
    complexity: { score: complexity, level: complexity < 25 ? 'Low' : complexity < 60 ? 'Medium' : 'High', parts: [] },
    pulse: computePulse(weekly, false, last === null ? undefined : new Date(NOW.getTime() - last * DAY), NOW),
  });
}

const w = (...v: number[]) => [...new Array(12 - v.length).fill(0), ...v];

/** The Development folder as the mockup shows it: six tracked projects (three in focus, four in Beta, none shipped) and 15 untracked folders. */
export function sampleProjects(): Project[] {
  return [
    tracked({ name: 'Buddy Recomp', title: 'Buddy Recomp', stage: 'Beta', focus: true, complexity: 58, weekly: [0, 0, 1, 2, 3, 2, 4, 5, 3, 6, 5, 7], dirty: true, stageDays: 38, next: 'Fix macro import bug on Safari', tech: ['TypeScript', 'React', 'LLM'],
      criteria: crit([['Core logging flow', 58], ['Auth and sync', 21], ['Onboarding', 9], ['Fix macro import bug', null, 3], ['Deploy to production', null, 4], ['Use it daily for 7 days', null, 6]]) }),
    tracked({ name: 'ai-newsletter', title: 'AI Newsletter Agent', stage: 'Beta', focus: true, complexity: 52, weekly: [3, 4, 2, 5, 6, 4, 3, 5, 6, 4, 5, 3], stageDays: 52, next: 'Add unsubscribe link, then send to 5 friends', tech: ['Python', 'LLM', 'AWS'],
      criteria: crit([['Scraper and summarizer', 60], ['Email template', 12], ['Scheduled send', 5], ['Unsubscribe flow', null, 4], ['Four weekly issues sent', null, 8]]) }),
    tracked({ name: 'dark-factory', title: 'Dark Factory', stage: 'In progress', focus: true, complexity: 71, weekly: [1, 3, 5, 8, 6, 9, 7, 4, 6, 8, 5, 6], dirty: true, stageDays: 27, next: 'Wire spec to build agent loop in a sandbox repo', tech: ['TypeScript', 'Node', 'LLM'],
      criteria: crit([['Spec format', 40], ['Agent loop', 3], ['Sandboxed runs', null, 6], ['Run history UI', null, 8], ['First end-to-end build', null, 10]]) }),
    tracked({ name: 'chicken-friends', title: 'Flockchat', stage: 'In progress', focus: false, complexity: 63, weekly: [2, 0, 0, 3, 1, 0, 0, 2, 0, 0, 1, 0], stageDays: 44, tech: ['TypeScript', 'React', 'Node'],
      criteria: crit([['Room model', 70], ['Realtime messages', 50], ['Auth', null, 6], ['Mobile layout', null, 8], ['Invite links', null, 4], ['Deploy', null, 4]]) }),
    tracked({ name: 'whisper-safe', title: 'WhisperVault', stage: 'Beta', focus: false, complexity: 66, weekly: [0, 0, 0, 1, 0, 3, 2, 0, 1, 0, 0, 0], stageDays: 61, next: 'Rotate KMS key in staging', tech: ['Python', 'AWS', 'Terraform'],
      criteria: crit([['Encrypted store', 80], ['Share links', 60], ['Expiry', 45], ['Audit log', 20], ['Key rotation', null, 5], ['Threat model written', null, 3]]) }),
    tracked({ name: 'sdlc-ai', title: 'Agentic Development Environment', stage: 'Beta', focus: false, complexity: 74, weekly: [4, 5, 3, 2, 1, 0, 0, 1, 0, 0, 0, 0], stageDays: 90, github: false, tech: ['Python', 'LLM', 'Terraform'],
      criteria: crit([['Task intake', 120], ['Planner', 100], ['Executor', 85], ['Review step', null, 8], ['Cost limits', null, 5], ['Docs', null, 4], ['Demo video', null, 3]]) }),
    untracked('ai-ticketing-pipeline', ['Python', 'AWS', 'LLM'], 55, w(2, 3, 1, 0, 0, 0, 0)),
    untracked('AWS-Exam-Helper', ['TypeScript', 'AWS', 'LLM'], 30, w(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)),
    untracked('budget-traffik', ['Python', 'Node'], 28, w(1, 1, 0, 0, 0)),
    untracked('fet-tracker', ['TypeScript', 'React'], 34, w(2, 2, 3, 1, 0, 0, 0)),
    untracked('hal-intent-classifier', ['Python', 'LLM'], 40, w(1, 1, 0, 0, 0, 0, 0, 0, 0)),
    untracked('linear-developer-agent', ['TypeScript', 'LLM', 'Node'], 44, w(2, 2, 0, 0, 0, 0, 0, 0)),
    untracked('pm-asp', ['TypeScript', 'LLM'], 38, w(2, 3, 1, 0)),
    untracked('reward-chest', ['TypeScript', 'React'], 36, w(1, 0, 0, 0, 0, 0, 0, 0, 0, 0)),
    untracked('TabSaver', ['TypeScript', 'React', 'Chrome Ext'], 49, w(3, 2, 4, 0, 0)),
    untracked('TabSaverAPI', ['Node', 'TypeScript', 'AWS'], 41, w(1, 1, 0, 0, 0, 0, 0, 0)),
    untracked('TabSaverInfra', ['Terraform', 'AWS'], 33, w(1, 0, 0, 0, 0, 0, 0, 0, 0)),
    untracked('TabSaverMockAPI', ['Node', 'TypeScript'], 14, w(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)),
    untracked('travel-workouts', ['Python', 'LLM'], 22, w(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)),
    untracked('ynab-daylio-llm', ['Python', 'LLM'], 27, w(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)),
    untracked('ynab-weekly-report', ['Python', 'AWS'], 31, w(1, 1, 0, 0, 0, 0, 0, 0)),
  ];
}

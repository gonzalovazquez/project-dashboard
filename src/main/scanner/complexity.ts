import type { Complexity, ComplexityLevel } from '../../shared/types.js';

export interface Metrics {
  loc: number;
  files: number;
  languages: number;
  dependencies: number;
  infraMarkers: number;
  hasTests: boolean;
}

const PARTS: Array<{ key: keyof Metrics; label: string; weight: number; ref: number }> = [
  { key: 'loc', label: 'Lines of code', weight: 30, ref: 100_000 },
  { key: 'files', label: 'File count', weight: 15, ref: 2_000 },
  { key: 'languages', label: 'Languages', weight: 15, ref: 5 },
  { key: 'dependencies', label: 'Dependencies', weight: 15, ref: 40 },
  { key: 'infraMarkers', label: 'Infra and CI', weight: 15, ref: 3 },
  { key: 'hasTests', label: 'Tests', weight: 10, ref: 1 },
];

/**
 * Log scale so one huge project does not flatten the rest, raised to 1.5 so very small
 * projects stay near zero (a 200-line script should read as Low, not Medium).
 */
const frac = (v: number, ref: number) => Math.min(1, Math.log10(1 + v) / Math.log10(1 + ref)) ** 1.5;

export const levelFor = (score: number): ComplexityLevel => (score < 25 ? 'Low' : score < 60 ? 'Medium' : 'High');

export function computeComplexity(m: Metrics): Complexity {
  const parts = PARTS.map((p) => {
    const raw = p.key === 'hasTests' ? (m.hasTests ? 1 : 0) : frac(m[p.key] as number, p.ref);
    return { label: p.label, weight: p.weight, contribution: raw * p.weight };
  });
  const score = Math.round(parts.reduce((a, p) => a + p.contribution, 0));
  return { score, level: levelFor(score), parts };
}

const INFRA = [/^Dockerfile$/, /^docker-compose/, /\.tf$/, /^\.github\/workflows\//, /(^|\/)template\.yaml$/, /(^|\/)serverless\.yml$/, /(^|\/)cdk\.json$/];
const TESTS = [/(^|\/)(test|tests|__tests__)\//, /\.(test|spec)\.[jt]sx?$/, /(^|\/)test_[^/]+\.py$/, /_test\.go$/];

/** Counts distinct infrastructure markers (Docker, Terraform, CI, serverless), not files. */
export function infraMarkers(files: string[]): number {
  const kinds = new Set<string>();
  for (const f of files) INFRA.forEach((re, i) => { if (re.test(f)) kinds.add(String(i === 0 || i === 1 ? 'docker' : i)); });
  return kinds.size;
}

export const hasTests = (files: string[]) => files.some((f) => TESTS.some((re) => re.test(f)));

export function countDependencies(read: (rel: string) => string | undefined, files: string[]): number {
  let n = 0;
  if (files.includes('package.json')) {
    try {
      const pkg = JSON.parse(read('package.json') ?? '{}');
      n += Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length;
    } catch { /* ignore malformed manifest */ }
  }
  if (files.includes('requirements.txt')) {
    n += (read('requirements.txt') ?? '').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length;
  }
  return n;
}

import type { LanguageShare } from '../../shared/types.js';

export const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', go: 'Go', rs: 'Rust', swift: 'Swift', java: 'Java', kt: 'Kotlin', rb: 'Ruby', php: 'PHP',
  cs: 'C#', tf: 'HCL', sh: 'Shell', html: 'HTML', css: 'CSS', scss: 'CSS', sql: 'SQL',
};

const NODE_DEPS: Record<string, string> = {
  react: 'React', next: 'Next.js', vue: 'Vue', svelte: 'Svelte', express: 'Express', fastify: 'Fastify',
  electron: 'Electron', vite: 'Vite', '@anthropic-ai/sdk': 'LLM', openai: 'LLM', langchain: 'LLM', '@langchain/core': 'LLM',
  'aws-sdk': 'AWS', '@aws-sdk/client-s3': 'AWS', 'aws-cdk-lib': 'AWS',
};
const PY_DEPS: Record<string, string> = {
  anthropic: 'LLM', openai: 'LLM', langchain: 'LLM', boto3: 'AWS', fastapi: 'FastAPI', flask: 'Flask', django: 'Django',
};

export interface TechInput {
  files: string[];
  /** Returns file contents for small manifest files, or undefined. */
  read: (rel: string) => string | undefined;
}

const base = (f: string) => f.split('/').pop() ?? f;
const ext = (f: string) => (f.includes('.') ? f.split('.').pop()!.toLowerCase() : '');

function parseJson(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

export function detectTech({ files, read }: TechInput): string[] {
  const tech = new Set<string>();
  const names = new Set(files.map(base));
  const exts = new Set(files.map(ext));
  const top = (n: string) => files.find((f) => f === n);

  const pkg = parseJson(top('package.json') ? read('package.json') : undefined) as
    | { dependencies?: object; devDependencies?: object } | undefined;
  if (pkg) {
    tech.add('Node');
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    if (deps.includes('typescript')) tech.add('TypeScript');
    for (const d of deps) if (NODE_DEPS[d]) tech.add(NODE_DEPS[d]);
  }
  if (names.has('tsconfig.json') || exts.has('ts') || exts.has('tsx')) tech.add('TypeScript');

  const py = ['requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py'].find((f) => top(f));
  if (py || exts.has('py')) {
    tech.add('Python');
    const text = ['requirements.txt', 'pyproject.toml'].map((f) => (top(f) ? read(f) ?? '' : '')).join('\n').toLowerCase();
    for (const [dep, label] of Object.entries(PY_DEPS)) if (new RegExp(`(^|[\\s"'\\[,])${dep}([\\s=<>~\\]"',;]|$)`, 'm').test(text)) tech.add(label);
  }

  if (exts.has('tf')) tech.add('Terraform');
  if ([...names].some((n) => n === 'Dockerfile' || n.startsWith('docker-compose'))) tech.add('Docker');
  if (names.has('template.yaml') || names.has('serverless.yml') || names.has('cdk.json') || names.has('samconfig.toml')) tech.add('AWS');
  if (files.some((f) => f.endsWith('.tf')) && files.some((f) => /aws/i.test(f))) tech.add('AWS');
  const manifest = parseJson(top('manifest.json') ? read('manifest.json') : undefined);
  if (manifest && 'manifest_version' in manifest) tech.add('Chrome Ext');
  if (names.has('go.mod')) tech.add('Go');
  if (names.has('Cargo.toml')) tech.add('Rust');
  if (names.has('Package.swift') || files.some((f) => f.endsWith('.xcodeproj/project.pbxproj'))) tech.add('Swift');
  return [...tech];
}

/** Shares by lines of code per language, top 3 plus Other. */
export function languageShares(locByLanguage: Map<string, number>): LanguageShare[] {
  const total = [...locByLanguage.values()].reduce((a, b) => a + b, 0);
  if (!total) return [];
  const sorted = [...locByLanguage.entries()].sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, 3).map(([name, n]) => ({ name, share: Math.round((n / total) * 100) }));
  const rest = 100 - head.reduce((a, l) => a + l.share, 0);
  return rest > 0 && sorted.length > 3 ? [...head, { name: 'Other', share: rest }] : head;
}

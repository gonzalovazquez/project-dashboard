export const WIP_LIMIT = 3;
export const WEEKS = 12;

export type Stage = 'Not started' | 'In progress' | 'Beta' | 'General Available';
export type Life = 'active' | 'parked' | 'killed';
export type PulseLevel = 'Hot' | 'Warm' | 'Cooling' | 'Dormant';
export type ComplexityLevel = 'Low' | 'Medium' | 'High';

export interface ComplexityPart {
  label: string;
  weight: number;
  contribution: number;
}

export interface Complexity {
  score: number;
  level: ComplexityLevel;
  parts: ComplexityPart[];
}

export interface Pulse {
  score: number;
  level: PulseLevel;
  lastActivityDays: number | null;
}

export interface LanguageShare {
  name: string;
  share: number;
}

/** Everything the scanner can learn from a folder alone. */
export interface ScanResult {
  name: string;
  path: string;
  isGit: boolean;
  github?: string;
  branch?: string;
  dirty: boolean;
  lastCommit?: string;
  /** Commits per trailing 7-day window, oldest first, last entry is the most recent week. */
  weekly: number[];
  tech: string[];
  languages: LanguageShare[];
  complexity: Complexity;
  pulse: Pulse;
}

export interface Criterion {
  /** Notion block id, needed to write the checkbox back. */
  blockId?: string;
  title: string;
  done: boolean;
  doneOn?: string;
  hours?: number;
}

/** Everything that lives in Notion. */
export interface NotionInfo {
  pageId: string;
  url: string;
  title: string;
  stage: Stage;
  stageChangedAt?: string;
  criteria: Criterion[];
  nextAction?: string;
  focus: boolean;
  life: Life;
  parkReason?: string;
  revisitOn?: string;
}

export interface Project extends ScanResult {
  notion?: NotionInfo;
}

/** How many active tracked projects sat in each stage on a given day. One is recorded per day, per scan. */
export interface StagePoint {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  counts: Record<Stage, number>;
}

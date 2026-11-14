import type { Life, NotionInfo, Stage } from './types.js';

/**
 * Starting a new project happens in Claude, not here: the brainstorm-plan skill writes the plan to a new page in the
 * Brainstorming database, ending with a Planning section of ship criteria, and build-budget turns it into a schedule.
 * The app hands over the idea and picks the page up from Notion afterwards.
 */

/** Longest idea the app passes on. It ends up in a URL, and a paragraph is plenty to start a brainstorm. */
export const IDEA_MAX = 2000;

export function newProjectPrompt(idea: string): string {
  return [
    'Use my brainstorm-plan skill to plan a new project and create its page in my Notion Brainstorming database,',
    'ending with a Planning section that lists the ship criteria.',
    'Once the phases are settled, use my build-budget skill to budget it.',
    '',
    `The idea: ${idea.trim()}`,
  ].join('\n');
}

/** Opens a new Claude chat with the prompt already typed in, ready to send. */
export const claudeNewChatUrl = (prompt: string) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;

/** A Notion page no folder is paired with: an idea still being planned, or a project whose folder does not exist yet. */
export interface IdeaRow {
  id: string;
  title: string;
  stage: Stage;
  life: Life;
  done: number;
  total: number;
  /** The first open ship criterion. */
  next?: string;
}

export const ideaRow = (id: string, info: NotionInfo): IdeaRow => ({
  id,
  title: info.title,
  stage: info.stage,
  life: info.life,
  done: info.criteria.filter((c) => c.done).length,
  total: info.criteria.length,
  next: info.criteria.find((c) => !c.done)?.title,
});

type Row = Pick<IdeaRow, 'life' | 'stage' | 'title'>;
const byTitle = (a: Row, b: Row) => a.title.localeCompare(b.title);

/**
 * The Planning screen's two lists, both active and unshipped. Ideas have not started, which is where a new brainstorm
 * lands. Started pages are In progress or in Beta but have no folder here, usually because it lives elsewhere or has
 * a name the matcher misses.
 */
export function planningModel<T extends Row>(rows: T[]): { ideas: T[]; started: T[] } {
  const live = rows.filter((r) => r.life === 'active' && r.stage !== 'General Available');
  return { ideas: live.filter((r) => r.stage === 'Not started').sort(byTitle), started: live.filter((r) => r.stage !== 'Not started').sort(byTitle) };
}

export type Route =
  | { view: 'overview' }
  | { view: 'project'; name: string }
  | { view: 'review' | 'library' | 'inbox' | 'parked' | 'shipped' };

export const OVERVIEW: Route = { view: 'overview' };

export const sameRoute = (a: Route, b: Route) => a.view === b.view && (a.view !== 'project' || (b.view === 'project' && a.name === b.name));

/** Which build week delivers a screen that is not built yet. */
export const PLACEHOLDER: Record<Exclude<Route['view'], 'overview'>, { title: string; week: number; note: string }> = {
  project: { title: 'Deep dive', week: 5, note: 'Burnup, criteria, commit heatmap and health for one project.' },
  review: { title: 'Weekly review', week: 7, note: 'A guided review that forces a decision on every stalled project and picks the next three.' },
  library: { title: 'Library', week: 6, note: 'Every folder with filters for stage, activity, complexity and technology.' },
  inbox: { title: 'Inbox', week: 6, note: 'Folders with no Notion page, ready to add or ignore.' },
  parked: { title: 'Parked', week: 6, note: 'Projects set aside, with the date each one returns for review.' },
  shipped: { title: 'Shipped', week: 6, note: 'Projects that reached General Available.' },
};

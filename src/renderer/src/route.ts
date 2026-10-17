export type Route =
  | { view: 'overview' }
  | { view: 'project'; name: string }
  | { view: 'review' | 'library' | 'inbox' | 'parked' | 'shipped' | 'settings' };

export const OVERVIEW: Route = { view: 'overview' };

export const sameRoute = (a: Route, b: Route) => a.view === b.view && (a.view !== 'project' || (b.view === 'project' && a.name === b.name));

import { PLACEHOLDER, type Route } from '../route.js';

export function Placeholder({ view, detail }: { view: Exclude<Route['view'], 'overview'>; detail?: string }) {
  const p = PLACEHOLDER[view];
  return (
    <div className="card empty" data-placeholder={view}>
      <b>{p.title}{detail ? `: ${detail}` : ''}</b>
      <span>{p.note}</span>
      <span className="mut">Built in Week {p.week} of the plan.</span>
    </div>
  );
}

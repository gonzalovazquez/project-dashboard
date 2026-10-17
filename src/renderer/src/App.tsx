import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Snapshot } from '../../shared/ipc.js';
import { DeepDive } from './components/DeepDive.js';
import { NavContext } from './components/nav.js';
import { Settings } from './components/Settings.js';
import { Inbox, Parked, Shipped } from './components/Lists.js';
import { newReview, Review, type ReviewState } from './components/Review.js';
import { Library } from './components/Library.js';
import { QuickLook } from './components/QuickLook.js';
import { dueSince, daysOverdue } from '../../shared/review.js';
import { NO_FILTERS, type LibraryFilters } from './viewmodel/library.js';
import { Overview } from './components/Overview.js';
import { Sidebar } from './components/Sidebar.js';
import { TipProvider } from './components/charts/infra.js';
import { Toolbar, type Range } from './components/Toolbar.js';
import { OVERVIEW, type Route } from './route.js';
import { applyUpdate } from './state.js';
import { fmtDate } from './viewmodel/format.js';
import { sidebarModel } from './viewmodel/portfolio.js';

function useDark(): boolean {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setDark(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return dark;
}

export function App() {
  const [snap, setSnap] = useState<Snapshot>();
  const [route, setRoute] = useState<Route>(OVERVIEW);
  const [range, setRange] = useState<Range>(12);
  const [filters, setFilters] = useState<LibraryFilters>(NO_FILTERS);
  const [look, setLook] = useState<string>();
  const [review, setReview] = useState<ReviewState>();
  const dark = useDark();

  useEffect(() => {
    let alive = true;
    const off = window.dashboard.onProjectUpdate((u) => { if (u.kind === 'open-review') setRoute({ view: 'review' }); setSnap((prev) => applyUpdate(prev, u)); });
    void window.dashboard.getSnapshot().then((s) => alive && setSnap((prev) => prev ?? s));
    void window.dashboard.startScan();
    return () => { alive = false; off(); };
  }, []);

  // Coming back to the app after a while rescans, so a missed file event never leaves stale numbers on screen.
  const latest = useRef(snap);
  latest.current = snap;
  useEffect(() => {
    const STALE = 10 * 60_000;
    const refocus = () => {
      const s = latest.current;
      if (s && !s.scanning && s.scannedAt && Date.now() - Date.parse(s.scannedAt) > STALE) void window.dashboard.startScan();
    };
    window.addEventListener('focus', refocus);
    return () => window.removeEventListener('focus', refocus);
  }, []);

  // Time-based numbers are computed against the moment the data last changed, not on every render.
  const now = useMemo(() => new Date(), [snap?.projects]);
  const rescan = useCallback(() => void window.dashboard.startScan(), []);
  const nav = useMemo(() => ({ openSettings: () => setRoute({ view: 'settings' }), rescan }), [rescan]);
  const toggleAppearance = useCallback(() => void window.dashboard.saveSettings({ appearance: dark ? 'light' : 'dark' }), [dark]);

  if (!snap) return <div className="loading" data-state="loading">Loading…</div>;

  // A focus project that was parked or shipped no longer has a deep dive.
  const gone = route.view === 'project' && !snap.projects.some((p) => p.name === route.name && p.notion?.focus);
  // The first launch lands on setup until the person finishes or skips it. Someone who already has a token skips it.
  const firstRun = !snap.settings.onboarded && snap.notion.state === 'not-configured';
  const current: Route = firstRun ? { view: 'settings' } : gone ? OVERVIEW : route;
  const due = dueSince(now, snap.settings);
  const lookProject = look ? snap.projects.find((p) => p.name === look) : undefined;
  const model = sidebarModel(snap.projects, now, 3, snap.settings.ignored);

  const meta = current.view === 'overview'
    ? { title: 'Overview', subtitle: `Week ending ${fmtDate(now)}, ${snap.projects.length} ${snap.projects.length === 1 ? 'folder' : 'folders'}` }
    : current.view === 'project'
      ? { title: snap.projects.find((p) => p.name === current.name)?.notion?.title ?? current.name, subtitle: `Deep dive · ${current.name}` }
      : current.view === 'library' ? { title: 'All projects', subtitle: `${snap.projects.length} folders in ${snap.settings.developmentFolder}` }
      : current.view === 'inbox' ? { title: 'Inbox', subtitle: 'Folders not in Notion yet' }
      : current.view === 'parked' ? { title: 'Parked', subtitle: 'Set aside, with a date to revisit' }
      : current.view === 'shipped' ? { title: 'Shipped', subtitle: 'Reached General Available' }
      : current.view === 'settings' ? { title: firstRun ? 'Welcome' : 'Settings', subtitle: firstRun ? 'Set up the dashboard' : 'Folder, Notion and reminders' }
      : { title: 'Weekly review', subtitle: 'Decide what stays in focus' };

  return (
    <NavContext.Provider value={nav}>
    <TipProvider>
    <div className="app">
      <Sidebar model={model} route={current} notion={snap.notion} scanning={snap.scanning} scannedAt={snap.scannedAt} folder={snap.settings.developmentFolder} onNavigate={setRoute} />
      <div className="main">
        <Toolbar title={meta.title} subtitle={meta.subtitle} range={current.view === 'overview' ? range : undefined} onRange={setRange} scanning={snap.scanning} onRescan={rescan} onToggleAppearance={toggleAppearance} />
        <div className="content" data-route={current.view}>
          {due && !firstRun && current.view !== 'review' && (
            <p className="banner info" data-review-due>
              Your weekly review is due{daysOverdue(now, due) > 0 ? `, ${daysOverdue(now, due)} ${daysOverdue(now, due) === 1 ? 'day' : 'days'} ago` : ''}.{' '}
              <button className="link" onClick={() => setRoute({ view: 'review' })} data-action="start-review">Start it</button>
            </p>
          )}
          {current.view === 'overview' && <Overview snap={snap} now={now} range={range} onOpenProject={(name) => setRoute({ view: 'project', name })} />}
          {current.view === 'project' && <DeepDive snap={snap} project={snap.projects.find((p) => p.name === current.name)!} now={now} />}
          {current.view === 'library' && <Library snap={snap} filters={filters} onFilters={setFilters} onQuickLook={setLook} />}
          {current.view === 'inbox' && <Inbox snap={snap} onQuickLook={setLook} />}
          {current.view === 'parked' && <Parked snap={snap} now={now} onQuickLook={setLook} />}
          {current.view === 'shipped' && <Shipped snap={snap} now={now} onQuickLook={setLook} />}
          {current.view === 'settings' && <Settings snap={snap} first={firstRun} onFinish={() => { void window.dashboard.saveSettings({ onboarded: true }); setRoute(OVERVIEW); }} />}
          {current.view === 'review' && <Review snap={snap} now={now} state={review ?? newReview(snap.projects)} onState={setReview} onFinish={() => { setReview(undefined); setRoute(OVERVIEW); }} />}
        </div>
      </div>
    </div>
    {lookProject && <QuickLook snap={snap} project={lookProject} now={now} onClose={() => setLook(undefined)} onOpenDeepDive={(name) => setRoute({ view: 'project', name })} />}
    </TipProvider>
    </NavContext.Provider>
  );
}

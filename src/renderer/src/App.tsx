import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Snapshot } from '../../shared/ipc.js';
import { Overview } from './components/Overview.js';
import { Placeholder } from './components/Placeholder.js';
import { Sidebar } from './components/Sidebar.js';
import { TipProvider } from './components/charts/infra.js';
import { Toolbar, type Range } from './components/Toolbar.js';
import { OVERVIEW, PLACEHOLDER, type Route } from './route.js';
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
  const dark = useDark();

  useEffect(() => {
    let alive = true;
    const off = window.dashboard.onProjectUpdate((u) => setSnap((prev) => applyUpdate(prev, u)));
    void window.dashboard.getSnapshot().then((s) => alive && setSnap((prev) => prev ?? s));
    void window.dashboard.startScan();
    return () => { alive = false; off(); };
  }, []);

  // Time-based numbers are computed against the moment the data last changed, not on every render.
  const now = useMemo(() => new Date(), [snap?.projects]);
  const rescan = useCallback(() => void window.dashboard.startScan(), []);
  const toggleAppearance = useCallback(() => void window.dashboard.saveSettings({ appearance: dark ? 'light' : 'dark' }), [dark]);

  if (!snap) return <div className="loading" data-state="loading">Loading…</div>;

  // A focus project that was parked or shipped no longer has a deep dive.
  const gone = route.view === 'project' && !snap.projects.some((p) => p.name === route.name && p.notion?.focus);
  const current: Route = gone ? OVERVIEW : route;
  const model = sidebarModel(snap.projects, now);

  const meta = current.view === 'overview'
    ? { title: 'Overview', subtitle: `Week ending ${fmtDate(now)}, ${snap.projects.length} ${snap.projects.length === 1 ? 'folder' : 'folders'}` }
    : current.view === 'project'
      ? { title: snap.projects.find((p) => p.name === current.name)?.notion?.title ?? current.name, subtitle: `Deep dive · ${current.name}` }
      : { title: PLACEHOLDER[current.view].title, subtitle: '' };

  return (
    <TipProvider>
    <div className="app">
      <Sidebar model={model} route={current} notion={snap.notion} scanning={snap.scanning} scannedAt={snap.scannedAt} folder={snap.settings.developmentFolder} onNavigate={setRoute} />
      <div className="main">
        <Toolbar title={meta.title} subtitle={meta.subtitle} range={current.view === 'overview' ? range : undefined} onRange={setRange} scanning={snap.scanning} onRescan={rescan} onToggleAppearance={toggleAppearance} />
        <div className="content" data-route={current.view}>
          {current.view === 'overview' && <Overview snap={snap} now={now} range={range} onOpenProject={(name) => setRoute({ view: 'project', name })} />}
          {current.view === 'project' && <Placeholder view="project" detail={meta.title} />}
          {current.view !== 'overview' && current.view !== 'project' && <Placeholder view={current.view} />}
        </div>
      </div>
    </div>
    </TipProvider>
  );
}

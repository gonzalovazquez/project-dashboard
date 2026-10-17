import { useEffect, useState } from 'react';
import type { Snapshot } from '../../shared/ipc.js';
import { applyUpdate, sortByName } from './state.js';

/** A plain list that proves the wiring. The real screens replace this. */
export function App() {
  const [snap, setSnap] = useState<Snapshot>();

  useEffect(() => {
    let alive = true;
    const off = window.dashboard.onProjectUpdate((u) => setSnap((prev) => applyUpdate(prev, u)));
    void window.dashboard.getSnapshot().then((s) => alive && setSnap((prev) => prev ?? s));
    void window.dashboard.startScan();
    return () => { alive = false; off(); };
  }, []);

  if (!snap) return <p className="muted">Loading…</p>;
  const banner = snap.scanError ?? (snap.notion.state === 'connected' ? undefined : snap.notion.message);

  return (
    <main>
      <header>
        <h1>Project Dashboard</h1>
        <button onClick={() => void window.dashboard.startScan()} disabled={snap.scanning}>{snap.scanning ? 'Scanning…' : 'Rescan'}</button>
      </header>
      {banner && <p className="banner" data-banner>{banner}</p>}
      <p className="muted">{snap.projects.length} folders in {snap.settings.developmentFolder}{snap.scannedAt ? ` · scanned ${new Date(snap.scannedAt).toLocaleTimeString()}` : ''}</p>
      <table>
        <thead><tr><th>Project</th><th>Stage</th><th>Pulse</th><th>Complexity</th><th>Tech</th></tr></thead>
        <tbody>
          {sortByName(snap.projects).map((p) => (
            <tr key={p.name} data-project={p.name}>
              <td>{p.notion?.title ?? p.name}</td>
              <td>{p.notion ? p.notion.stage : 'Not in Notion'}</td>
              <td>{p.pulse.level}</td>
              <td>{p.complexity.score} {p.complexity.level}</td>
              <td>{p.tech.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

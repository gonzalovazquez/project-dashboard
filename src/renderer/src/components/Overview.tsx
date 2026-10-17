import { useMemo, useState } from 'react';
import type { Snapshot } from '../../../shared/ipc.js';
import { banners } from '../viewmodel/banners.js';
import { buildOverview, type Kpi } from '../viewmodel/overview.js';
import { portfolioRows } from '../viewmodel/portfolio.js';
import { Chg, Sparkline } from './Bits.js';
import { PortfolioTable } from './PortfolioTable.js';
import { colorVar } from '../tokens.js';

export function KpiTile({ k }: { k: Kpi }) {
  return (
    <div className="card kpi" data-kpi={k.id}>
      <div className="l"><i style={colorVar(k.color)} />{k.label}</div>
      <div className="v">{k.value}{k.unit && <small>{k.unit.startsWith('%') || k.unit.startsWith('/') ? k.unit : ` ${k.unit}`}</small>}</div>
      <div className="f">
        <span>{k.sub} {k.delta && <Chg tone={k.delta.tone}>{k.delta.label}</Chg>}</span>
        {k.spark && <Sparkline data={k.spark} color={k.color} />}
        {k.badge && <span className="hl" style={{ ['--c' as string]: `var(--${k.badge.tone === 'good' ? 'green' : k.badge.tone === 'warn' ? 'orange' : 'red'})` }}>{k.badge.label}</span>}
      </div>
    </div>
  );
}

const INSIGHT_COLOR = { bad: 'red', good: 'green', warn: 'orange', info: 'gray', flat: 'gray' } as const;

interface Props {
  snap: Snapshot;
  now: Date;
  onOpenProject: (name: string) => void;
}

export function Overview({ snap, now, onOpenProject }: Props) {
  const [selected, setSelected] = useState<string>();
  const model = useMemo(() => buildOverview(snap.projects, now), [snap.projects, now]);
  const rows = useMemo(() => portfolioRows(snap.projects, now), [snap.projects, now]);
  const notices = banners(snap);
  const folder = snap.settings.developmentFolder;
  const untracked = snap.projects.filter((p) => !p.notion).length;

  if (snap.projects.length === 0) {
    return (
      <>
        {notices.map((b) => <p key={b.id} className={`banner ${b.tone}`} data-banner>{b.text}</p>)}
        <div className="card empty" data-state={snap.scanning ? 'scanning' : 'empty'}>
          {snap.scanning
            ? <><b>Scanning {folder}…</b><span>Projects appear here as each folder finishes.</span></>
            : <><b>No projects found in {folder}</b><span>Each folder directly inside it becomes a project. Check that this is your Development folder.</span></>}
        </div>
      </>
    );
  }

  return (
    <>
      {notices.map((b) => <p key={b.id} className={`banner ${b.tone}`} data-banner>{b.text}</p>)}
      <div className="hello">
        <div className="eye">Executive summary</div>
        <h1 data-testid="headline">{model.headline.map((s, i) => (s.tone ? <span key={i} className={`h-${s.tone}`}>{s.text}</span> : s.text))}</h1>
      </div>
      <div className="kpis">{model.kpis.map((k) => <KpiTile key={k.id} k={k} />)}</div>
      <section className="card" aria-labelledby="hl-title">
        <h3 id="hl-title">Highlights</h3>
        <div className="ins">
          {model.insights.map((i) => (
            <div key={i.id} data-insight={i.id}>
              <i style={colorVar(INSIGHT_COLOR[i.tone])}>{i.glyph}</i>
              <p><b>{i.lead}</b> {i.text}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="card" aria-labelledby="pf-title">
        <div className="hd">
          <h3 id="pf-title">Portfolio</h3>
          <span className="mut small">{rows.length} active tracked · {untracked} untracked folders</span>
        </div>
        {rows.length === 0
          ? <div className="empty inner" data-state="no-tracked"><b>None of the {snap.projects.length} folders are in Notion yet</b><span>Connect Notion, or add a folder to your Brainstorming board, to see stages, progress and forecasts here.</span></div>
          : <PortfolioTable rows={rows} selected={selected} onSelect={setSelected} onOpen={onOpenProject} />}
      </section>
    </>
  );
}

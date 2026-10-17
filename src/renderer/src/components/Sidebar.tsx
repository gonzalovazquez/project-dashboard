import type { NotionStatus } from '../../../shared/ipc.js';
import { sameRoute, type Route } from '../route.js';
import { STAGE_COLOR } from '../tokens.js';
import type { SidebarModel } from '../viewmodel/portfolio.js';
import { Icon, type IconName } from './Icon.js';
import { ProgressRing } from './Bits.js';

const NOTION_LABEL: Record<NotionStatus['state'], { text: string; color: string }> = {
  connected: { text: 'Notion connected', color: 'green' },
  'not-configured': { text: 'Notion not connected', color: 'gray' },
  error: { text: 'Notion unreachable', color: 'red' },
  'schema-missing': { text: 'Notion needs setup', color: 'orange' },
};

interface Props {
  model: SidebarModel;
  route: Route;
  notion: NotionStatus;
  scanning: boolean;
  scannedAt?: string;
  folder: string;
  onNavigate: (r: Route) => void;
}

export function Sidebar({ model, route, notion, scanning, scannedAt, folder, onNavigate }: Props) {
  const Item = ({ to, icon, label, count, alert }: { to: Route; icon: IconName; label: string; count?: number; alert?: boolean }) => (
    <button className="item" aria-current={sameRoute(route, to) ? 'page' : undefined} onClick={() => onNavigate(to)}>
      <Icon name={icon} />
      <span className="t">{label}</span>
      {count !== undefined && count > 0 && <span className={`c${alert ? ' al' : ''}`}>{count}</span>}
    </button>
  );
  const n = NOTION_LABEL[notion.state];
  const used = model.focus.length;
  return (
    <aside className="side" aria-label="Sidebar">
      <div className="side-drag" />
      <nav className="sec" aria-label="Dashboard">
        <h6>Dashboard</h6>
        <Item to={{ view: 'overview' }} icon="grid" label="Overview" />
        <Item to={{ view: 'review' }} icon="check" label="Weekly review" count={model.counts.flagged} alert />
      </nav>
      <nav className="sec" aria-label="Focus">
        <h6><span>Focus</span><span data-testid="focus-count">{used}/{used + model.openSlots}</span></h6>
        {model.focus.map((f) => (
          <button key={f.name} className="item" data-focus-item={f.name} aria-current={sameRoute(route, { view: 'project', name: f.name }) ? 'page' : undefined} onClick={() => onNavigate({ view: 'project', name: f.name })}>
            <ProgressRing value={f.progress} color={STAGE_COLOR[f.stage]} />
            <span className="t">{f.title}</span>
            <span className="c num">{Math.round(f.progress * 100)}%</span>
          </button>
        ))}
        {Array.from({ length: model.openSlots }, (_, i) => <div key={i} className="item slot-empty"><span className="t">Open slot</span></div>)}
      </nav>
      <nav className="sec" aria-label="Library">
        <h6>Library</h6>
        <Item to={{ view: 'library' }} icon="folder" label="All projects" count={model.counts.all} />
        <Item to={{ view: 'inbox' }} icon="tray" label="Inbox" count={model.counts.inbox} />
        <Item to={{ view: 'parked' }} icon="pause" label="Parked" count={model.counts.parked} />
        <Item to={{ view: 'shipped' }} icon="flag" label="Shipped" count={model.counts.shipped} />
      </nav>
      <div className="sidefoot">
        <span data-testid="notion-state"><i className="dot" style={{ background: `var(--${n.color})` }} />{n.text}</span>
        <span>{scanning ? 'Scanning…' : scannedAt ? `Scanned ${new Date(scannedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Not scanned yet'}</span>
        <span className="mono path" title={folder}>{folder}</span>
      </div>
    </aside>
  );
}

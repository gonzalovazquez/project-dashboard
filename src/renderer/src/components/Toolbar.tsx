import { Icon } from './Icon.js';

export type Range = 4 | 12;

interface Props {
  title: string;
  subtitle: string;
  /** Only the Overview shows the range switch. */
  range?: Range;
  onRange: (r: Range) => void;
  scanning: boolean;
  onRescan: () => void;
  onToggleAppearance: () => void;
}

export function Toolbar({ title, subtitle, range, onRange, scanning, onRescan, onToggleAppearance }: Props) {
  return (
    <header className="toolbar">
      <div className="ttl"><b>{title}</b><span>{subtitle}</span></div>
      <div className="sp" />
      {range !== undefined && (
        <div className="seg" role="group" aria-label="Time range">
          {([4, 12] as const).map((r) => <button key={r} aria-pressed={range === r} onClick={() => onRange(r)}>{r} weeks</button>)}
        </div>
      )}
      <button className="btn icon" onClick={onRescan} disabled={scanning} title="Rescan folders" aria-label="Rescan folders"><Icon name="refresh" className={`ic${scanning ? ' spin' : ''}`} /></button>
      <button className="btn icon" onClick={onToggleAppearance} title="Switch between light and dark" aria-label="Switch between light and dark"><Icon name="half" /></button>
    </header>
  );
}

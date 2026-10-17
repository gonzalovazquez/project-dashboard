import { useState } from 'react';
import { healthColor, PULSE_COLOR, STAGE_COLOR } from '../tokens.js';
import { ago, fmtDate } from '../viewmodel/format.js';
import { DEFAULT_SORT, nextSort, sortRows, type Row, type Sort, type SortKey } from '../viewmodel/portfolio.js';
import { Pill, Sparkline } from './Bits.js';

const COLUMNS: Array<{ key: SortKey; label: string; right?: boolean }> = [
  { key: 'name', label: 'Project' }, { key: 'stage', label: 'Stage' }, { key: 'progress', label: 'Progress' }, { key: 'forecast', label: 'Forecast' },
  { key: 'pulse', label: 'Pulse' }, { key: 'complexity', label: 'Complexity' }, { key: 'age', label: 'In stage', right: true },
  { key: 'last', label: 'Last commit', right: true }, { key: 'health', label: 'Health', right: true },
];

interface Props {
  rows: Row[];
  selected?: string;
  onSelect: (name: string) => void;
  /** Focus projects open their deep dive. */
  onOpen: (name: string) => void;
  initialSort?: Sort;
}

export function PortfolioTable({ rows, selected, onSelect, onOpen, initialSort = DEFAULT_SORT }: Props) {
  const [sort, setSort] = useState<Sort>(initialSort);
  const sorted = sortRows(rows, sort);
  const activate = (r: Row) => (r.isFocus ? onOpen(r.name) : onSelect(r.name));

  return (
    <div className="tw">
      <table>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.key} className={c.right ? 'r' : undefined} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button onClick={() => setSort((s) => nextSort(s, c.key))}>{c.label}{sort.key === c.key && <span className="arrow">{sort.dir === 'asc' ? '▲' : '▼'}</span>}</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.name} data-project={r.name} data-focus={r.isFocus || undefined} tabIndex={0} aria-selected={selected === r.name} className={selected === r.name ? 'sel' : undefined}
              onClick={() => activate(r)} onKeyDown={(e) => { if (e.key === 'Enter') activate(r); }}>
              <td><div className="pn"><b>{r.title}</b><span className="mono">{r.name}</span></div></td>
              <td><Pill color={STAGE_COLOR[r.stage]}>{r.stage}</Pill></td>
              <td>{r.progress === undefined ? <span className="mut">–</span> : (
                <div className="pb"><div className="tr"><i style={{ width: `${r.progress * 100}%` }} /></div><span className="num mut pct">{Math.round(r.progress * 100)}%</span></div>
              )}</td>
              <td className="num">{r.forecast ? fmtDate(new Date(r.forecast)) : r.ready ? <span className="good">Ready</span> : <span className="mut">–</span>}</td>
              <td><span className="pulse"><Sparkline data={r.weekly} width={58} height={20} color={PULSE_COLOR[r.pulseLevel]} label={`Commits per week, ${r.pulseLevel}`} /><Pill color={PULSE_COLOR[r.pulseLevel]}>{r.pulseLevel}</Pill></span></td>
              <td className="num">{r.complexity} <span className="mut">{r.complexityLevel}</span></td>
              <td className="num r">{r.stageDays ? `${r.stageDays}d` : '–'}</td>
              <td className="num r">{ago(r.lastActivityDays)}{r.dirty ? ' *' : ''}</td>
              <td className="r"><span className="hl num" style={{ ['--c' as string]: `var(${healthColor(r.health)})` }}>{r.health}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

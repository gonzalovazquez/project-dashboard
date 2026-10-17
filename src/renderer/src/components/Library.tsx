import { useMemo, useState } from 'react';
import type { Snapshot } from '../../../shared/ipc.js';
import type { ComplexityLevel, PulseLevel } from '../../../shared/types.js';
import { PULSE_COLOR, STAGE_COLOR } from '../tokens.js';
import { ago } from '../viewmodel/format.js';
import { isFiltered, libraryRows, NO_FILTERS, STATES, STATE_LABEL, techOptions, type LibraryFilters, type LibrarySort } from '../viewmodel/library.js';
import { Pill } from './Bits.js';

const PULSES: PulseLevel[] = ['Hot', 'Warm', 'Cooling', 'Dormant'];
const LEVELS: ComplexityLevel[] = ['Low', 'Medium', 'High'];
const SORTS: Array<[LibrarySort, string]> = [['name', 'Name'], ['activity', 'Last commit'], ['complexity', 'Complexity'], ['stage', 'Stage']];

interface Props { snap: Snapshot; filters: LibraryFilters; onFilters: (f: LibraryFilters) => void; onQuickLook: (name: string) => void }

export function Library({ snap, filters, onFilters, onQuickLook }: Props) {
  const [sort, setSort] = useState<LibrarySort>('name');
  const rows = useMemo(() => libraryRows(snap.projects, filters, sort), [snap.projects, filters, sort]);
  const techs = useMemo(() => techOptions(snap.projects), [snap.projects]);
  const set = <K extends keyof LibraryFilters>(k: K, v: LibraryFilters[K]) => onFilters({ ...filters, [k]: v });
  const Select = <T extends string>({ label, value, options, onChange }: { label: string; value: T | 'all'; options: Array<[T, string]>; onChange: (v: T | 'all') => void }) => (
    <label className="flt">{label}
      <select value={value} onChange={(e) => onChange(e.target.value as T | 'all')} data-filter={label.toLowerCase()}>
        <option value="all">All</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  return (
    <section className="card" aria-labelledby="lib-t" data-view="library">
      <div className="hd"><h3 id="lib-t">All projects</h3><span className="mut small" data-testid="lib-count">{rows.length} of {snap.projects.length} folders</span></div>
      <div className="filters">
        <input className="field search" type="search" placeholder="Search name or technology" aria-label="Search projects" value={filters.query} onChange={(e) => set('query', e.target.value)} />
        <Select label="State" value={filters.state} options={STATES.map((s) => [s, STATE_LABEL[s]])} onChange={(v) => set('state', v)} />
        <Select label="Pulse" value={filters.pulse} options={PULSES.map((s) => [s, s])} onChange={(v) => set('pulse', v)} />
        <Select label="Complexity" value={filters.complexity} options={LEVELS.map((s) => [s, s])} onChange={(v) => set('complexity', v)} />
        <Select label="Technology" value={filters.tech} options={techs.map((t) => [t, t])} onChange={(v) => set('tech', v)} />
        <label className="flt">Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as LibrarySort)} data-filter="sort">{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        {isFiltered(filters) && <button className="btn" onClick={() => onFilters(NO_FILTERS)} data-action="clear-filters">Clear filters</button>}
      </div>
      {rows.length === 0 ? (
        <div className="empty inner" data-state="no-match"><b>No folders match</b><span>{isFiltered(filters) ? 'Try clearing a filter.' : 'Nothing was found in your Development folder.'}</span></div>
      ) : (
        <div className="tw">
          <table>
            <thead><tr><th>Project</th><th>State</th><th>Pulse</th><th>Complexity</th><th>Technology</th><th className="r">Last commit</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} data-project={r.name} tabIndex={0} onClick={() => onQuickLook(r.name)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onQuickLook(r.name); } }}>
                  <td><div className="pn"><b>{r.title}</b><span className="mono">{r.name}</span></div></td>
                  <td>{r.stage ? <span className="stk"><Pill color={STAGE_COLOR[r.stage]}>{r.stage}</Pill>{r.state !== 'active' && r.state !== 'shipped' && <span className="mut small">{STATE_LABEL[r.state]}</span>}</span> : <span className="mut">{STATE_LABEL[r.state]}</span>}</td>
                  <td><Pill color={PULSE_COLOR[r.pulse]}>{r.pulse}</Pill></td>
                  <td className="num">{r.complexity} <span className="mut">{r.complexityLevel}</span></td>
                  <td>{r.tech.length ? r.tech.join(', ') : <span className="mut">–</span>}</td>
                  <td className="num r">{ago(r.lastActivityDays)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

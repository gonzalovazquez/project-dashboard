import { fmtDate } from '../../viewmodel/format.js';
import {
  commitTable, stageTable, STAGE_RAMP, STAGES,
  type CommitModel, type Range, type StageModel,
} from '../../viewmodel/charts.js';
import { ChartCard, topRounded, truncate, useTip, useWidth, type LegendItem } from './infra.js';

const GAP = 2;
const MAX_BAR = 24;
const M = { l: 30, t: 14, b: 24 };
/** Room to the right of the last column for series names. Narrow charts skip them; the legend and tooltip still name everything. */
const LABEL_ROOM = 128;
const LABEL_MIN_WIDTH = 460;
const H = 224;

interface Seg { id: string; name: string; token: string; value: number }
interface Col { slot: number; label: string; segs: Seg[]; total: number; tipTitle: string }

/** Shared drawing for stacked columns: axis, gridlines, 2px gaps, rounded data end, direct labels, hit targets. */
function Columns({ width, slots, cols, ticks, unit }: { width: number; slots: string[]; cols: Col[]; ticks: number[]; unit: string }) {
  const tip = useTip();
  const direct = width >= LABEL_MIN_WIDTH;
  const r = direct ? LABEL_ROOM : 16;
  const pw = width - M.l - r;
  const ph = H - M.t - M.b;
  const top = ticks.at(-1) ?? 1;
  const slotW = pw / slots.length;
  const bw = Math.min(MAX_BAR, slotW * 0.62);
  const y = (v: number) => M.t + ph - (v / top) * ph;
  const cx = (slot: number) => M.l + slot * slotW + slotW / 2;
  const every = slots.length <= 6 ? 1 : 2;
  const last = cols.at(-1);

  return (
    <svg className="chart" width={width} height={H} role="img" aria-label={`Stacked columns, ${unit}`}>
      {ticks.map((t) => <g key={t}><line x1={M.l} x2={M.l + pw} y1={y(t)} y2={y(t)} className="grid" /><text x={M.l - 6} y={y(t) + 3.5} textAnchor="end">{t}</text></g>)}
      {slots.map((s, i) => ((slots.length - 1 - i) % every === 0 ? <text key={i} x={cx(i)} y={H - 7} textAnchor="middle">{s}</text> : null))}
      {cols.map((c) => {
        let acc = 0;
        const drawn = c.segs.filter((s) => s.value > 0);
        const topId = drawn.at(-1)?.id;
        return (
          <g key={c.slot} className="col">
            {c.segs.map((s) => {
              if (s.value <= 0) return null;
              const y0 = y(acc + s.value);
              const hgt = Math.max(3, y(acc) - y0);
              const isBottom = acc === 0;
              acc += s.value;
              const x = cx(c.slot) - bw / 2;
              const h = isBottom ? hgt : Math.max(1, hgt - GAP);
              const fill = `var(--${s.token})`;
              return s.id === topId
                ? <path key={s.id} d={topRounded(x, y0, bw, h)} fill={fill} />
                : <rect key={s.id} x={x} y={y0} width={bw} height={h} fill={fill} />;
            })}
            <rect className="hit" x={cx(c.slot) - Math.max(slotW, 24) / 2} y={M.t} width={Math.max(slotW, 24)} height={ph} {...tip({ title: c.tipTitle, rows: [...c.segs.slice().reverse().map((s) => ({ label: s.name, value: String(s.value), token: s.token })), { label: 'Total', value: String(c.total) }] })} />
          </g>
        );
      })}
      {last && <text x={cx(last.slot)} y={y(last.total) - 6} textAnchor="middle" className="val">{last.total}</text>}
      {last && direct && (() => {
        let acc = 0;
        return (
          <g>
            {last.segs.map((s) => {
              const mid = y(acc + s.value / 2);
              const hgt = y(acc) - y(acc + s.value);
              acc += s.value;
              if (hgt < 12) return null;
              return <g key={s.id}><rect x={cx(last.slot) + bw / 2 + 8} y={mid - 4} width="8" height="8" rx="2" fill={`var(--${s.token})`} /><text x={cx(last.slot) + bw / 2 + 21} y={mid + 3.5}>{truncate(s.name, 16)}</text></g>;
            })}
          </g>
        );
      })()}
    </svg>
  );
}

export function CommitsChart({ model, range }: { model: CommitModel; range: Range }) {
  const [ref, width] = useWidth();
  const slots = model.weeks.map((w) => w.label);
  const cols: Col[] = model.weeks.map((w, j) => ({
    slot: j, label: w.label, total: model.totals[j], tipTitle: `Week ending ${w.label}`,
    segs: model.series.map((s) => ({ id: s.id, name: s.name, token: s.token, value: s.values[j] })),
  }));
  const legend: LegendItem[] = model.series.slice().reverse().map((s) => ({ label: s.name, token: s.token }));
  return (
    <ChartCard id="commits" title="Commits per week" aside={`${model.total} in ${range} weeks`} legend={legend} table={commitTable(model)}>
      <div ref={ref}><Columns width={width} slots={slots} cols={cols} ticks={model.ticks} unit="commits per week by project" /></div>
    </ChartCard>
  );
}

export function StageChart({ model, range, notionConnected }: { model: StageModel; range: Range; notionConnected: boolean }) {
  const [ref, width] = useWidth();
  const order = [...STAGES].reverse();
  const cols: Col[] = model.columns.map((c) => ({
    slot: c.slot, label: c.label, total: c.total, tipTitle: `Week ending ${c.label}, recorded ${fmtDate(new Date(c.date + 'T12:00:00'))}`,
    segs: order.map((s) => ({ id: s, name: s === 'General Available' ? 'Shipped' : s, token: STAGE_RAMP[s], value: c.counts[s] })),
  }));
  const note = model.columns.length === 0
    ? notionConnected ? 'No history yet. The app records the pipeline each time it scans, so this fills in over the coming weeks.' : 'Connect Notion and the app starts recording how many projects sit in each stage.'
    : model.sparse ? `History starts ${fmtDate(new Date(model.startedOn + 'T12:00:00'))}. The chart fills in as the app records each scan.` : undefined;
  const legend: LegendItem[] = order.map((s) => ({ label: s === 'General Available' ? 'Shipped' : s, token: STAGE_RAMP[s] }));
  return (
    <ChartCard id="stages" title="Projects by stage" aside="Where work is piling up" legend={legend} table={stageTable(model)} subtitle={note ? <span data-note="history">{note}</span> : undefined}>
      <div ref={ref}><Columns width={width} slots={model.slots.map((s) => s.label)} cols={cols} ticks={model.ticks} unit={`projects per stage over the last ${range} weeks`} /></div>
    </ChartCard>
  );
}

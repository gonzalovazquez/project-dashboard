import type { BurnupModel, HealthModel, HeatModel, LanguageSegment, WeekBar } from '../../viewmodel/deepdive.js';
import { fmtDate } from '../../viewmodel/format.js';
import { niceTicks } from '../../viewmodel/charts.js';
import { ChartCard, topRounded, useTip, useWidth } from '../charts/infra.js';

const H = 220;
const M = { l: 30, t: 14, b: 24, r: 16 };
const DAY = 86_400_000;

/** Completed criteria over twelve weeks, a dashed line to the finish and a shaded band for the forecast range. */
export function BurnupChart({ model, now }: { model: BurnupModel; now: Date }) {
  const [ref, width] = useWidth();
  const tip = useTip();
  const proj = model.projection;
  const spanDays = 12 * 7 - 7 + (proj ? proj.reachDays : 0);
  const pw = width - M.l - M.r;
  const ph = H - M.t - M.b;
  const top = model.ticks.at(-1) || 1;
  const x = (daysFromStart: number) => M.l + (daysFromStart / spanDays) * pw;
  const y = (v: number) => M.t + ph - (v / top) * ph;
  const start = now.getTime() - 77 * DAY;
  const nowX = x(77);
  const line = model.points.map((p, i) => `${i ? 'L' : 'M'}${x(i * 7).toFixed(1)} ${y(p.done).toFixed(1)}`).join(' ');
  const legend = [{ label: 'Criteria done', token: 'series-1' }, ...(proj ? [{ label: 'Expected finish', token: 'series-other', shape: 'tick' as const }] : [])];
  const table = { head: ['Week ending', 'Done', 'Of'], rows: model.points.map((p) => [p.label, String(p.done), String(model.total)]) };
  const aside = model.noCriteria ? 'No criteria' : model.ready ? 'All criteria met' : `${model.done} of ${model.total} done`;

  return (
    <ChartCard id="burnup" title="Burnup" aside={aside} legend={legend} table={model.noCriteria ? undefined : table} subtitle={proj ? `At ${proj.velocity.toFixed(2)} criteria a week, finishing around ${fmtDate(new Date(proj.date))}${proj.beyond ? ' (beyond the chart)' : ''}.` : undefined}>
      <div ref={ref}>
        {model.noCriteria ? (
          <div className="empty inner" data-state="no-criteria"><b>No ship criteria yet</b><span>Add to-do items to this project's Notion page. Each one becomes a step toward shipping.</span></div>
        ) : (
          <svg className="chart" width={width} height={H} role="img" aria-label="Criteria completed per week with the forecast finish">
            {model.ticks.map((t) => <g key={t}><line x1={M.l} x2={M.l + pw} y1={y(t)} y2={y(t)} className="grid" /><text x={M.l - 6} y={y(t) + 3.5} textAnchor="end">{t}</text></g>)}
            {proj && !proj.beyond && (
              <rect x={x(77 + Math.min(proj.low, proj.reachDays))} y={y(model.total)} width={Math.max(2, x(77 + Math.min(proj.high, proj.reachDays)) - x(77 + Math.min(proj.low, proj.reachDays)))} height={y(0) - y(model.total)} fill="var(--series-other)" opacity="0.16" data-band="" />
            )}
            {proj && <path d={`M${nowX} ${y(model.done)}L${x(77 + Math.min(proj.days, proj.reachDays))} ${y(model.total)}`} stroke="var(--series-other)" strokeWidth="2" strokeDasharray="5 4" fill="none" data-projection="" />}
            <path d={`${line}L${nowX} ${y(0)}L${x(0)} ${y(0)}Z`} fill="var(--series-1)" opacity="0.12" />
            <path d={line} fill="none" stroke="var(--series-1)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
            <line x1={M.l} x2={M.l + pw} y1={y(model.total)} y2={y(model.total)} stroke="var(--label2)" strokeWidth="1" strokeDasharray="2 3" />
            <text x={M.l + pw} y={y(model.total) - 5} textAnchor="end" className="val">Ship: {model.total}</text>
            {model.points.map((p, i) => ([3, 7, 11].includes(i) ? <text key={i} x={x(i * 7)} y={H - 7} textAnchor="middle">{p.label}</text> : null))}
            <circle cx={nowX} cy={y(model.done)} r="4" fill="var(--series-1)" />
            {model.points.map((p, i) => (
              <rect key={i} className="hit" x={x(i * 7) - 12} y={M.t} width={24} height={ph} {...tip({ title: `Week ending ${p.label}`, rows: [{ label: 'done', value: String(p.done), token: 'series-1' }, { label: 'remaining', value: String(model.total - p.done) }] })} />
            ))}
            <text x={x(0)} y={H - 7} textAnchor="middle" opacity="0">{fmtDate(new Date(start))}</text>
          </svg>
        )}
      </div>
    </ChartCard>
  );
}

const HEAT_TOKENS = ['fill2', 'stage-0', 'stage-1', 'stage-3'] as const;

/** Twelve weeks by seven weekdays. One hue stepped by lightness, since commit count is an ordered quantity. */
export function Heatmap({ model }: { model: HeatModel }) {
  const tip = useTip();
  const [ref, width] = useWidth();
  const left = 34;
  const PITCH = Math.max(16, Math.min(22, Math.floor((width - left - 4) / 12)));
  const CELL = PITCH - 2;
  return (
    <ChartCard id="heatmap" title="Commit heatmap" aside={`${model.total} commits, 12 weeks`}
      legend={[{ label: 'None', token: 'fill2' }, { label: '1', token: 'stage-0' }, { label: '2', token: 'stage-1' }, { label: '3 or more', token: 'stage-3' }]}
      table={{ head: ['Day', 'Commits'], rows: model.cells.filter((c) => c.count > 0).map((c) => [c.label, String(c.count)]) }}>
      <div ref={ref}><svg className="chart heat" width={left + 12 * PITCH} height={7 * PITCH + 22} role="img" aria-label="Commits per day over twelve weeks">
        {model.rowLabels.map((l, r) => (r % 2 === 0 ? <text key={r} x={left - 6} y={r * PITCH + CELL - 2} textAnchor="end">{l}</text> : null))}
        {model.columnLabels.map((c) => <text key={c.col} x={left + c.col * PITCH} y={7 * PITCH + 14}>{c.label}</text>)}
        {model.cells.map((c) => (
          <rect key={`${c.col}-${c.row}`} x={left + c.col * PITCH} y={c.row * PITCH} width={CELL} height={CELL} rx="3" fill={`var(--${HEAT_TOKENS[c.level]})`} data-level={c.level}
            {...tip({ title: c.label, rows: [{ label: c.count === 1 ? 'commit' : 'commits', value: String(c.count) }] })} />
        ))}
      </svg></div>
    </ChartCard>
  );
}

const WH = 150;
export function WeekChart({ bars }: { bars: WeekBar[] }) {
  const [ref, width] = useWidth();
  const tip = useTip();
  const max = Math.max(1, ...bars.map((b) => b.value));
  const ticks = niceTicks(max);
  const topT = ticks.at(-1) || 1;
  const pw = width - 30 - 12;
  const slot = pw / bars.length;
  const bw = Math.min(24, slot * 0.62);
  const ph = WH - 14 - 22;
  const y = (v: number) => 14 + ph - (v / topT) * ph;
  return (
    <ChartCard id="weekly" title="Commits per week" aside={`${bars.reduce((a, b) => a + b.value, 0)} in 12 weeks`} table={{ head: ['Week ending', 'Commits'], rows: bars.map((b) => [b.label, String(b.value)]) }}>
      <div ref={ref}>
        <svg className="chart" width={width} height={WH} role="img" aria-label="Commits per week for this project">
          {ticks.map((t) => <g key={t}><line x1={30} x2={30 + pw} y1={y(t)} y2={y(t)} className="grid" /><text x={24} y={y(t) + 3.5} textAnchor="end">{t}</text></g>)}
          {bars.map((b, i) => {
            const cx = 30 + i * slot + slot / 2;
            return (
              <g key={i}>
                {b.value > 0 && <path d={topRounded(cx - bw / 2, y(b.value), bw, y(0) - y(b.value))} fill="var(--series-1)" />}
                {i % 2 === 1 || i === bars.length - 1 ? <text x={cx} y={WH - 7} textAnchor="middle">{b.label}</text> : null}
                <rect className="hit" x={cx - Math.max(slot, 24) / 2} y={14} width={Math.max(slot, 24)} height={ph} {...tip({ title: `Week ending ${b.label}`, rows: [{ label: 'commits', value: String(b.value), token: 'series-1' }] })} />
              </g>
            );
          })}
          {bars.at(-1) && bars.at(-1)!.value > 0 && <text x={30 + 11 * slot + slot / 2} y={y(bars.at(-1)!.value) - 5} textAnchor="middle" className="val">{bars.at(-1)!.value}</text>}
        </svg>
      </div>
    </ChartCard>
  );
}

/** One bar for the language mix, direct labels beneath, 2px gaps between segments. */
export function LanguageBar({ segments }: { segments: LanguageSegment[] }) {
  const tip = useTip();
  if (segments.length === 0) return <p className="mut small" data-state="no-languages">No source files detected.</p>;
  return (
    <div className="langs">
      <div className="lbar" role="img" aria-label="Languages by share of code">
        {segments.map((s) => <i key={s.name} style={{ flexGrow: s.share, background: `var(--${s.token})` }} {...tip({ title: s.name, rows: [{ label: 'of code', value: `${s.share}%`, token: s.token }] })} />)}
      </div>
      <ul className="lnames">{segments.map((s) => <li key={s.name}><i style={{ background: `var(--${s.token})` }} />{s.name} <b className="num">{s.share}%</b></li>)}</ul>
    </div>
  );
}

export function HealthPanel({ model }: { model: HealthModel }) {
  return (
    <ChartCard id="health" title="Health" aside={`${model.score} / 100 · ${model.level}`}
      table={{ head: ['Part', 'Score', 'Weight'], rows: model.parts.map((p) => [p.label, String(Math.round(p.value)), `${Math.round(p.weight * 100)}%`]) }}>
      <div className="hbars">
        {model.parts.map((p) => (
          <div key={p.label} className="hrow"><span>{p.label}</span><span className="trk"><i style={{ width: `${Math.max(2, Math.min(100, p.value))}%` }} /></span><b className="num">{Math.round(p.value)}</b></div>
        ))}
      </div>
      {model.risks.length > 0 && <ul className="risks" data-testid="risks">{model.risks.map((r) => <li key={r}>{r}</li>)}</ul>}
    </ChartCard>
  );
}

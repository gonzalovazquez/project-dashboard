import {
  ageTable, bubbleRadius, countTable, forecastTable, isQuickWin, placeLabels, QUICK_WIN, scatterTable, STAGE_RAMP, STAGES,
  type AgeBar, type CountItem, type ForecastModel, type ScatterModel,
} from '../../viewmodel/charts.js';
import { fmtDate, plural } from '../../viewmodel/format.js';
import { ChartCard, rightRounded, truncate, useTip, useWidth, type LegendItem } from './infra.js';

// ---------------------------------------------------------------- forecast

export function ForecastChart({ model }: { model: ForecastModel }) {
  const [ref, width] = useWidth();
  const tip = useTip();
  const rowH = 40;
  const m = { l: 140, r: 20, t: 8, b: 26 };
  const height = m.t + m.b + Math.max(1, model.rows.length) * rowH;
  const pw = width - m.l - m.r;
  const x = (days: number) => m.l + (Math.min(days, model.capDays) / model.capDays) * pw;
  const today = new Date(model.rows[0] ? Date.parse(model.rows[0].date) - model.rows[0].days * 86_400_000 : Date.now());
  const ticks = [0, 28, 56, 84, 112, 140, 168].filter((d) => d <= model.capDays);
  const day = (d: number) => new Date(today.getTime() + d * 86_400_000);
  const names = model.withoutCriteria;

  return (
    <ChartCard id="forecast" title="Forecast ship dates" aside="From criteria per week, last 4 weeks" subtitle="Dot is the expected date. The band is the likely range."
      table={model.rows.length ? forecastTable(model) : undefined}>
      <div ref={ref}>
        {model.rows.length === 0 ? (
          <div className="empty inner" data-state="no-forecast"><b>No forecast yet</b><span>{names.length ? `${names.join(', ')} ${names.length === 1 ? 'has' : 'have'} no ship criteria. Add a checklist on the Notion page.` : 'Put a project in focus and give it ship criteria to see when it should finish.'}</span></div>
        ) : (
          <svg className="chart" width={width} height={height} role="img" aria-label="Forecast ship date for each focus project">
            {ticks.map((d) => <g key={d}><line x1={x(d)} x2={x(d)} y1={m.t} y2={height - m.b} className="grid" /><text x={x(d)} y={height - 8} textAnchor={d === 0 ? 'start' : 'middle'}>{d === 0 ? 'Today' : fmtDate(day(d))}</text></g>)}
            {model.rows.map((r, i) => {
              const cy = m.t + i * rowH + rowH / 2;
              const color = `var(--${r.token})`;
              const lo = Math.round((Date.parse(r.low) - today.getTime()) / 86_400_000);
              const hi = Math.round((Date.parse(r.high) - today.getTime()) / 86_400_000);
              const ex = x(r.days);
              return (
                <g key={r.name}>
                  <text x={m.l - 12} y={cy + 4} textAnchor="end" className="val">{truncate(r.title, 19)}</text>
                  <rect x={x(0)} y={cy - 3} width={Math.max(2, x(hi) - x(0))} height="6" rx="3" fill={color} opacity="0.14" />
                  {!r.ready && <rect x={x(lo)} y={cy - 5} width={Math.max(4, x(hi) - x(lo))} height="10" rx="4" fill={color} opacity="0.4" />}
                  <circle cx={ex} cy={cy} r="6" fill={color} stroke="var(--card)" strokeWidth="2" />
                  <text x={Math.min(ex, width - m.r - 24)} y={cy - 12} textAnchor="middle" className="val">{r.ready ? 'Ready' : r.beyond ? `after ${fmtDate(day(model.capDays))}` : fmtDate(new Date(r.date))}</text>
                  <rect className="hit" x={m.l} y={cy - rowH / 2} width={pw} height={rowH} {...tip({
                    title: r.title,
                    rows: r.ready ? [{ label: 'Every criterion is done', value: 'Ready', token: r.token }] : [
                      { label: 'Expected', value: fmtDate(new Date(r.date)), token: r.token },
                      { label: 'Likely range', value: `${fmtDate(new Date(r.low))} to ${fmtDate(new Date(r.high))}` },
                      { label: 'Criteria left', value: String(r.remaining) }, { label: 'Per week', value: r.velocity.toFixed(2) },
                      ...(r.hoursLeft ? [{ label: 'Estimated hours left', value: String(r.hoursLeft) }] : []),
                    ],
                  })} />
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </ChartCard>
  );
}

// ---------------------------------------------------------------- progress against complexity

export function ScatterChart({ model }: { model: ScatterModel }) {
  const [ref, width] = useWidth();
  const tip = useTip();
  const height = 310;
  const m = { l: 44, r: 16, t: 14, b: 40 };
  const pw = width - m.l - m.r;
  const ph = height - m.t - m.b;
  const X = (v: number) => m.l + (v / 100) * pw;
  const Y = (v: number) => m.t + ph - (v / 100) * ph;
  const bubbles = model.points.map((p) => ({ p, cx: X(p.complexity), cy: Y(p.progress), r: bubbleRadius(p.commits4w) }));
  const boxes = placeLabels(bubbles.map((b) => ({ id: b.p.name, text: truncate(b.p.title, 22), cx: b.cx, cy: b.cy, r: b.r })), { left: m.l, top: m.t, right: m.l + pw, bottom: m.t + ph });
  const legend: LegendItem[] = STAGES.map((s) => ({ label: s === 'General Available' ? 'Shipped' : s, token: STAGE_RAMP[s], shape: 'dot' }));

  return (
    <ChartCard id="scatter" title="Progress against complexity" aside="Bubble size is commits in 4 weeks" legend={legend} table={scatterTable(model)}
      subtitle={model.withoutCriteria ? `${plural(model.withoutCriteria, 'project')} without ship criteria ${model.withoutCriteria === 1 ? 'is' : 'are'} not shown.` : undefined}>
      <div ref={ref}>
        {model.points.length === 0 ? (
          <div className="empty inner" data-state="no-scatter"><b>Nothing to plot yet</b><span>Projects appear here once their Notion page has ship criteria.</span></div>
        ) : (
          <svg className="chart" width={width} height={height} role="img" aria-label="Progress against complexity for tracked projects">
            <rect x={X(0)} y={Y(100)} width={X(QUICK_WIN.maxComplexity) - X(0)} height={Y(QUICK_WIN.minProgress) - Y(100)} rx="6" fill="var(--series-3)" opacity="0.1" />
            <text x={X(0) + 8} y={Y(100) + 15} className="zone">Quick wins: over half done, not complex</text>
            {[0, 25, 50, 75, 100].map((v) => (
              <g key={v}>
                <line x1={X(v)} x2={X(v)} y1={m.t} y2={m.t + ph} className="grid" /><text x={X(v)} y={height - 22} textAnchor="middle">{v}</text>
                <line x1={m.l} x2={m.l + pw} y1={Y(v)} y2={Y(v)} className="grid" /><text x={m.l - 6} y={Y(v) + 3.5} textAnchor="end">{v}%</text>
              </g>
            ))}
            <text x={m.l + pw / 2} y={height - 5} textAnchor="middle">Complexity score (higher means more effort)</text>
            {bubbles.slice().sort((a, b) => b.r - a.r).map(({ p, cx, cy, r }) => (
              <g key={p.name} data-bubble={p.name}>
                <circle cx={cx} cy={cy} r={r} fill={`var(--${STAGE_RAMP[p.stage]})`} opacity="0.92" stroke="var(--card)" strokeWidth="2" />
                <circle className="hit" cx={cx} cy={cy} r={Math.max(r, 14)} {...tip({ title: p.title, rows: [
                  { label: 'Done', value: `${p.progress}%` }, { label: 'Complexity', value: String(p.complexity) }, { label: 'Commits, 4 weeks', value: String(p.commits4w) },
                  { label: p.stage === 'General Available' ? 'Shipped' : p.stage, value: isQuickWin(p) ? 'Quick win' : p.focus ? 'In focus' : '' },
                ].filter((r) => r.value !== '') })} />
              </g>
            ))}
            {boxes.filter((b) => !b.collides).map((b) => (
              <text key={b.id} data-label={b.id} className={`lbl${model.points.find((p) => p.name === b.id)?.focus ? ' val' : ''}`}
                x={b.anchor === 'start' ? b.x : b.anchor === 'end' ? b.x + b.w : b.x + b.w / 2} y={b.y + b.h * 0.78} textAnchor={b.anchor}>{b.text}</text>
            ))}
          </svg>
        )}
      </div>
    </ChartCard>
  );
}

// ---------------------------------------------------------------- time in stage

export function AgeChart({ bars }: { bars: AgeBar[] }) {
  const [ref, width] = useWidth();
  const tip = useTip();
  const rowH = 30;
  const m = { l: 150, r: 74, t: 8, b: 6 };
  const height = m.t + m.b + Math.max(1, bars.length) * rowH;
  const pw = width - m.l - m.r;
  const max = Math.max(60, ...bars.map((b) => b.days), ...bars.map((b) => b.threshold ?? 0)) * 1.05;
  const x = (d: number) => m.l + (d / max) * pw;
  const legend: LegendItem[] = [{ label: 'Within review point', token: 'series-1' }, { label: 'Past review point', token: 'status-serious' }, { label: 'Review point', token: 'label2', shape: 'tick' }];
  return (
    <ChartCard id="age" title="Time in current stage" subtitle="Days since the stage last changed. Ticks mark when it is flagged for review." legend={legend} table={bars.length ? ageTable(bars) : undefined}>
      <div ref={ref}>
        {bars.length === 0 ? <div className="empty inner" data-state="no-age"><b>No active projects</b><span>Tracked projects that are not shipped appear here.</span></div> : (
          <svg className="chart" width={width} height={height} role="img" aria-label="Days each project has spent in its current stage">
            {bars.map((b, i) => {
              const cy = m.t + i * rowH + rowH / 2;
              return (
                <g key={b.name}>
                  <text x={m.l - 10} y={cy + 4} textAnchor="end" className="val-soft">{truncate(b.title, 22)}</text>
                  <path d={rightRounded(m.l, cy - 7, Math.max(3, x(b.days) - m.l), 14)} fill={`var(--${b.over ? 'status-serious' : 'series-1'})`} />
                  {b.threshold !== undefined && <line x1={x(b.threshold)} x2={x(b.threshold)} y1={cy - 11} y2={cy + 11} className="review-tick" />}
                  <text x={x(Math.max(b.days, b.threshold ?? 0)) + 8} y={cy + 4} className="val">{b.days}d{b.over ? ' · over' : ''}</text>
                  <rect className="hit" x={0} y={cy - rowH / 2} width={width} height={rowH} {...tip({ title: b.title, rows: [
                    { label: b.stage, value: `${b.days} days` },
                    ...(b.threshold !== undefined ? [{ label: b.over ? `past the ${b.threshold} day review point` : `review point is ${b.threshold} days`, value: b.over ? `+${b.days - b.threshold}` : `${b.threshold - b.days} left` }] : []),
                  ] })} />
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </ChartCard>
  );
}

// ---------------------------------------------------------------- bar lists (activity mix, technology)

export function BarList({ id, title, head, items, subtitle }: { id: string; title: string; head: string; items: CountItem[]; subtitle?: string }) {
  const tip = useTip();
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ChartCard id={id} title={title} subtitle={subtitle} table={countTable(head, items)}>
      <div className="barlist">
        {items.length === 0 && <span className="mut">Nothing to show yet.</span>}
        {items.map((i) => (
          <div key={i.label} className="brow" {...tip({ title: i.label, rows: [{ label: i.value === 1 ? 'project' : 'projects', value: String(i.value) }] })}>
            <span>{i.label}</span>
            <span className="trk"><i style={{ width: `${(i.value / max) * 100}%` }} /></span>
            <b className="num">{i.value}</b>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

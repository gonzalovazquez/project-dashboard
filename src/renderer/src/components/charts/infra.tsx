import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react';
import type { TableData } from '../../viewmodel/charts.js';

// ---------------------------------------------------------------- width

/** The width in pixels of an element, kept current, so a chart draws at its real size and its text never shrinks. */
export function useWidth(initial = 560) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(260, Math.floor(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// ---------------------------------------------------------------- tooltip

export interface TipContent { title: string; rows: Array<{ label: string; value: string; token?: string }> }
interface TipState { content: TipContent; x: number; y: number }
const Ctx = createContext<(t: TipState | null) => void>(() => undefined);

/** One tooltip for every chart. Text goes in as text nodes, never as HTML, because names come from folders and Notion. */
export function TipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<TipState | null>(null);
  const style = tip ? { left: Math.min(tip.x + 14, window.innerWidth - 250), top: Math.min(tip.y + 16, window.innerHeight - 120) } : undefined;
  return (
    <Ctx.Provider value={setTip}>
      {children}
      {tip && (
        <div className="tip" role="tooltip" style={style}>
          <div className="tip-title">{tip.content.title}</div>
          {tip.content.rows.map((r, i) => (
            <div key={i} className="tip-row">
              {r.token && <i style={{ background: `var(--${r.token})` }} />}
              <b className="num">{r.value}</b><span>{r.label}</span>
            </div>
          ))}
        </div>
      )}
    </Ctx.Provider>
  );
}

/** Props that make a mark show the tooltip on hover and on keyboard focus. */
export function useTip() {
  const set = useContext(Ctx);
  return useCallback((content: TipContent) => ({
    tabIndex: 0,
    onPointerEnter: (e: PointerEvent) => set({ content, x: e.clientX, y: e.clientY }),
    onPointerMove: (e: PointerEvent) => set({ content, x: e.clientX, y: e.clientY }),
    onPointerLeave: () => set(null),
    onFocus: (e: FocusEvent<Element>) => { const r = e.currentTarget.getBoundingClientRect(); set({ content, x: r.left + r.width / 2, y: r.top }); },
    onBlur: () => set(null),
    'aria-label': `${content.title}: ${content.rows.map((r) => `${r.value} ${r.label}`).join(', ')}`,
  }), [set]);
}

// ---------------------------------------------------------------- card, legend, table view

export interface LegendItem { label: string; token: string; shape?: 'rect' | 'tick' | 'dot' }

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div className="legend" aria-label="Legend">
      {items.map((i) => <span key={i.label} className={`lg lg-${i.shape ?? 'rect'}`}><i style={{ background: `var(--${i.token})` }} />{i.label}</span>)}
    </div>
  );
}

export function TableView({ table, caption }: { table: TableData; caption: string }) {
  return (
    <details className="tview">
      <summary>View as table</summary>
      <div className="tw">
        <table aria-label={caption}>
          <thead><tr>{table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j > 0 ? 'num' : undefined}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

interface CardProps { id: string; title: string; subtitle?: ReactNode; aside?: ReactNode; legend?: LegendItem[]; table?: TableData; children: ReactNode; className?: string }

export function ChartCard({ id, title, subtitle, aside, legend, table, children, className }: CardProps) {
  return (
    <section className={`card chart-card ${className ?? ''}`} aria-labelledby={`${id}-t`} data-chart={id}>
      <div className="hd"><h3 id={`${id}-t`}>{title}</h3>{aside && <span className="mut small">{aside}</span>}</div>
      {subtitle && <div className="sub">{subtitle}</div>}
      {children}
      {legend && <Legend items={legend} />}
      {table && <TableView table={table} caption={title} />}
    </section>
  );
}

// ---------------------------------------------------------------- drawing helpers

/** A rectangle with only its top corners rounded, for the data end of a column. */
export function topRounded(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x} ${y + h}V${y + rr}Q${x} ${y} ${x + rr} ${y}H${x + w - rr}Q${x + w} ${y} ${x + w} ${y + rr}V${y + h}Z`;
}

/** A rectangle with only its right corners rounded, for the data end of a horizontal bar. */
export function rightRounded(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, h / 2, w);
  return `M${x} ${y}H${x + w - rr}Q${x + w} ${y} ${x + w} ${y + rr}V${y + h - rr}Q${x + w} ${y + h} ${x + w - rr} ${y + h}H${x}Z`;
}

export const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s);

export function useStable<T>(v: T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => v, deps);
}

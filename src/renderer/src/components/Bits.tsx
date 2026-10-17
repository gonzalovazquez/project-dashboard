import type { ReactNode } from 'react';
import type { Tone } from '../viewmodel/overview.js';
import { colorVar } from '../tokens.js';

export const Pill = ({ children, color }: { children: ReactNode; color: string }) => <span className="pill" style={colorVar(color)}>{children}</span>;

export const Chg = ({ tone, children }: { tone: Tone; children: ReactNode }) => <span className={`chg ${tone}`}>{children}</span>;

/** A 12 point trend line with an area fill and an emphasized end point. */
export function Sparkline({ data, width = 84, height = 26, color = '--blue', label = 'Trend over the last 12 weeks' }: { data: number[]; width?: number; height?: number; color?: string; label?: string }) {
  const n = data.length;
  if (n < 2) return null;
  const max = Math.max(...data, 1);
  const x = (i: number) => 2 + (i * (width - 4)) / (n - 1);
  const y = (v: number) => height - 3 - (v / max) * (height - 8);
  const pts = data.map((v, i) => [x(i), y(v)] as const);
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const [ex, ey] = pts[n - 1];
  const stroke = `var(--${color.replace(/^--/, '')})`;
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <path d={`${line} L${ex} ${height - 2} L${pts[0][0]} ${height - 2}Z`} fill={stroke} opacity="0.15" />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={ex} cy={ey} r="2.4" fill={stroke} />
    </svg>
  );
}

/** A ring showing how far a project is toward done. */
export function ProgressRing({ value, color }: { value: number; color: string }) {
  const r = 6.5;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ic" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r={r} fill="none" stroke="var(--fill2)" strokeWidth="2.4" />
      <circle cx="9" cy="9" r={r} fill="none" stroke={`var(--${color.replace(/^--/, '')})`} strokeWidth="2.4" strokeLinecap="round" strokeDasharray={`${c * value} ${c}`} transform="rotate(-90 9 9)" />
    </svg>
  );
}

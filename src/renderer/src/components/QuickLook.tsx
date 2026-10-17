import { useState } from 'react';
import type { Snapshot } from '../../../shared/ipc.js';
import type { Project } from '../../../shared/types.js';
import { forecast, health, progress, stageDays } from '../../../shared/rules.js';
import { PULSE_COLOR, STAGE_COLOR } from '../tokens.js';
import { ago, fmtDate, plural } from '../viewmodel/format.js';
import { STATE_LABEL, stateOf } from '../viewmodel/library.js';
import { writeAccess } from '../viewmodel/deepdive.js';
import { Pill } from './Bits.js';
import { ProjectActions } from './ProjectActions.js';
import { Sheet } from './Sheet.js';

interface Props { snap: Snapshot; project: Project; now: Date; onClose: () => void; onOpenDeepDive: (name: string) => void }

/** A read-only summary of any folder with the actions that apply to it. Focus projects link to their deep dive. */
export function QuickLook({ snap, project: p, now, onClose, onOpenDeepDive }: Props) {
  const [nested, setNested] = useState(false);
  const n = p.notion;
  const state = stateOf(p);
  const access = writeAccess(snap.notion);
  const pr = progress(p);
  const f = n && n.criteria.length && n.stage !== 'General Available' ? forecast(p, now) : undefined;
  const rows: Array<[string, string]> = [
    ['State', STATE_LABEL[state]],
    ...(n ? [['Stage', `${n.stage}${n.stageChangedAt ? `, ${plural(stageDays(p, now), 'day')}` : ''}`] as [string, string]] : []),
    ...(pr !== undefined ? [['Progress', `${Math.round(pr * 100)}%, ${n!.criteria.filter((c) => c.done).length} of ${n!.criteria.length} criteria`] as [string, string]] : []),
    ...(f ? [['Forecast', f.remaining === 0 ? 'Ready to ship' : fmtDate(new Date(f.date))] as [string, string]] : []),
    ...(n ? [['Next action', n.nextAction ?? 'None set'] as [string, string]] : []),
    ...(n?.life === 'parked' ? [['Parked', `${n.parkReason ?? 'No reason'}${n.revisitOn ? `, revisit ${fmtDate(new Date(n.revisitOn))}` : ''}`] as [string, string]] : []),
    ['Last commit', p.pulse.lastActivityDays === null ? 'None' : `${ago(p.pulse.lastActivityDays)} ago`],
    ['Complexity', `${p.complexity.score}, ${p.complexity.level}`],
    ...(n ? [['Health', String(health(p, now))] as [string, string]] : []),
    ['Technology', p.tech.length ? p.tech.join(', ') : 'None detected'],
    ...(p.members?.length ? [['Includes', p.members.join(', ')] as [string, string]] : []),
    ['Folder', p.path],
  ];
  const api = window.dashboard;
  return (
    <Sheet name="quick-look" hidden={nested} width={520} title={n?.title ?? p.name} onClose={onClose}>
      <div className="dd-meta">
        {n && <Pill color={STAGE_COLOR[n.stage]}>{n.stage}</Pill>}
        <Pill color={PULSE_COLOR[p.pulse.level]}>{p.pulse.level}</Pill>
      </div>
      <dl className="details">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <div className="sheet-foot spread">
        <span className="pa">
          {state === 'focus' && <button className="btn primary" onClick={() => { onClose(); onOpenDeepDive(p.name); }}>Open deep dive</button>}
          {p.github && <button className="btn" onClick={() => void api.openLink(p.name, 'github')}>GitHub</button>}
          {n && <button className="btn" onClick={() => void api.openLink(p.name, 'notion')}>Notion</button>}
          <button className="btn" onClick={() => void api.openLink(p.name, 'folder')}>Folder</button>
        </span>
        <ProjectActions projects={snap.projects} project={p} now={now} canWrite={access.properties && !snap.scanning} why={access.reason} onDone={onClose} onSheet={setNested} />
      </div>
    </Sheet>
  );
}

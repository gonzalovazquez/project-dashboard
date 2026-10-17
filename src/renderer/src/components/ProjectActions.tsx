import { useState } from 'react';
import type { Project } from '../../../shared/types.js';
import { useAction, NoticeBar } from './actions.js';
import { Sheet } from './Sheet.js';
import { actionsFor, inDays } from '../viewmodel/library.js';

type Which = 'promote' | 'park' | 'kill';
const title = (p: Project) => p.notion?.title ?? p.name;

interface Props {
  projects: Project[];
  project: Project;
  now: Date;
  /** Whether Notion accepts property changes right now. */
  canWrite: boolean;
  /** Called after an action worked, so the caller can leave a screen the project no longer belongs to. */
  onDone?: (what: Which | 'unpark') => void;
  /** The reason writes are off, shown on hover. */
  why?: string;
  /** Tells a parent sheet that one of this component's sheets opened or closed. */
  onSheet?: (open: boolean) => void;
}

/** Focus, park, kill and unpark for one project, each behind a confirming sheet. Everything the rules would reject is not offered. */
export function ProjectActions({ projects, project, now, canWrite, onDone, why, onSheet }: Props) {
  const [open, setOpenRaw] = useState<Which>();
  const setOpen = (w?: Which) => { setOpenRaw(w); onSheet?.(!!w); };
  const a = actionsFor(projects, project.name);
  const act = useAction();
  const name = project.name;
  const close = () => { setOpen(undefined); act.clear(); };
  const off = !canWrite || act.busy;
  const hint = canWrite ? undefined : why;

  const unpark = async () => { if (await act.run(() => window.dashboard.unpark(name), `${title(project)} is active again.`)) onDone?.('unpark'); };

  return (
    <>
      <span className="pa" data-actions={name}>
        {a.promote !== 'no' && <button className="btn" disabled={off} title={hint} data-action="promote" onClick={() => setOpen('promote')}>Make focus</button>}
        {a.unpark && <button className="btn" disabled={off} title={hint} data-action="unpark" onClick={unpark}>Unpark</button>}
        {a.park && <button className="btn" disabled={off} title={hint} data-action="park" onClick={() => setOpen('park')}>Park</button>}
        {a.kill && <button className="btn danger" disabled={off} title={hint} data-action="kill" onClick={() => setOpen('kill')}>Kill</button>}
      </span>
      {!open && <NoticeBar notice={act.notice} />}
      {open === 'promote' && <PromoteSheet {...{ project, actions: a, now, onClose: close, onDone: () => { close(); onDone?.('promote'); } }} />}
      {open === 'park' && <ParkSheet project={project} now={now} onClose={close} onDone={() => { close(); onDone?.('park'); }} />}
      {open === 'kill' && <KillSheet project={project} onClose={close} onDone={() => { close(); onDone?.('kill'); }} />}
    </>
  );
}

function SheetButtons({ confirm, onClose, disabled, danger, busy }: { confirm: string; onClose: () => void; disabled?: boolean; danger?: boolean; busy: boolean }) {
  return (
    <>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="submit" className={`btn ${danger ? 'danger solid' : 'primary'}`} disabled={disabled || busy} data-confirm>{busy ? 'Working…' : confirm}</button>
    </>
  );
}

function ParkFields({ reason, setReason, revisit, setRevisit, label }: { reason: string; setReason: (s: string) => void; revisit: string; setRevisit: (s: string) => void; label: string }) {
  return (
    <>
      <label className="fld">{label}
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder="For example: blocked on the API, or I lost interest" data-autofocus data-field="reason" />
      </label>
      <label className="fld">Revisit on
        <input type="date" value={revisit} onChange={(e) => setRevisit(e.target.value)} data-field="revisit" />
      </label>
    </>
  );
}

function ParkSheet({ project, now, onClose, onDone }: { project: Project; now: Date; onClose: () => void; onDone: () => void }) {
  const act = useAction();
  const [reason, setReason] = useState('');
  const [revisit, setRevisit] = useState(inDays(now, 30));
  const ready = reason.trim().length > 0 && !!revisit;
  const submit = async () => { if (await act.run(() => window.dashboard.park(project.name, reason.trim(), revisit), `${title(project)} parked until ${revisit}.`)) onDone(); };
  return (
    <Sheet name="park" title={`Park ${title(project)}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }}>
        <p className="mut">Parking frees its focus slot. It comes back for review on the date you choose.</p>
        <ParkFields label="Why are you parking it?" {...{ reason, setReason, revisit, setRevisit }} />
        <NoticeBar notice={act.notice} />
        <div className="sheet-foot"><SheetButtons confirm="Park" onClose={onClose} disabled={!ready} busy={act.busy} /></div>
      </form>
    </Sheet>
  );
}

function KillSheet({ project, onClose, onDone }: { project: Project; onClose: () => void; onDone: () => void }) {
  const act = useAction();
  const submit = async () => { if (await act.run(() => window.dashboard.kill(project.name), `${title(project)} killed.`)) onDone(); };
  return (
    <Sheet name="kill" title={`Kill ${title(project)}?`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p>It leaves your focus and your active list, and its Notion Lifecycle becomes Killed. The folder and the page stay; you can set Lifecycle back to Active in Notion.</p>
        <NoticeBar notice={act.notice} />
        <div className="sheet-foot"><SheetButtons confirm="Kill project" onClose={onClose} danger busy={act.busy} /></div>
      </form>
    </Sheet>
  );
}

function PromoteSheet({ project, actions, now, onClose, onDone }: { project: Project; actions: ReturnType<typeof actionsFor>; now: Date; onClose: () => void; onDone: () => void }) {
  const act = useAction();
  const swap = actions.promote === 'swap';
  const [park, setPark] = useState(actions.focus[0]?.name ?? '');
  const [reason, setReason] = useState('');
  const [revisit, setRevisit] = useState(inDays(now, 30));
  const ready = !swap || (!!park && reason.trim().length > 0 && !!revisit);
  const submit = async () => {
    const choice = swap ? { parkName: park, reason: reason.trim(), revisitOn: revisit } : undefined;
    if (await act.run(() => window.dashboard.promote(project.name, choice), `${title(project)} is now a focus project.`)) onDone();
  };
  const parkTitle = actions.focus.find((f) => f.name === park)?.title ?? park;
  return (
    <Sheet name="promote" title={swap ? `Swap in ${title(project)}` : `Focus on ${title(project)}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }}>
        {swap ? (
          <>
            <p>All three focus slots are taken. To make room, park one of them.</p>
            <label className="fld">Park
              <select value={park} onChange={(e) => setPark(e.target.value)} data-field="park">
                {actions.focus.map((f) => <option key={f.name} value={f.name}>{f.title}</option>)}
              </select>
            </label>
            <ParkFields label={`Why are you parking ${parkTitle}?`} {...{ reason, setReason, revisit, setRevisit }} />
          </>
        ) : <p>It takes one of your three focus slots and gets a deep dive.</p>}
        <NoticeBar notice={act.notice} />
        <div className="sheet-foot"><SheetButtons confirm={swap ? 'Swap' : 'Make focus'} onClose={onClose} disabled={!ready} busy={act.busy} /></div>
      </form>
    </Sheet>
  );
}

import { useMemo } from 'react';
import type { Snapshot } from '../../../shared/ipc.js';
import { groupSuggestion, inboxModel, parkedRows, shippedRows } from '../viewmodel/library.js';
import { fmtDate, plural } from '../viewmodel/format.js';
import { writeAccess } from '../viewmodel/deepdive.js';
import { NoticeBar, useAction } from './actions.js';
import { Pill } from './Bits.js';
import { ProjectActions } from './ProjectActions.js';
import { PULSE_COLOR } from '../tokens.js';
import { ago } from '../viewmodel/format.js';

// ---------------------------------------------------------------- inbox

export function Inbox({ snap, onQuickLook }: { snap: Snapshot; onQuickLook: (name: string) => void }) {
  const act = useAction();
  const { pending, ignored } = useMemo(() => inboxModel(snap.projects, snap.settings.ignored), [snap.projects, snap.settings.ignored]);
  const canAdd = snap.notion.state === 'connected' || snap.notion.state === 'schema-missing';
  const off = !canAdd || snap.scanning || act.busy;
  const api = window.dashboard;
  const why = !canAdd ? 'Connect Notion first.' : snap.scanning ? 'Wait for the scan to finish.' : undefined;

  const row = (name: string, isIgnored: boolean) => {
    const p = snap.projects.find((x) => x.name === name)!;
    const suggested = isIgnored ? undefined : groupSuggestion(name, snap.projects);
    return (
      <tr key={name} data-inbox={name}>
        <td><button className="link" onClick={() => onQuickLook(name)}><div className="pn"><b>{name}</b><span className="mono">{p.tech.join(', ') || 'No technology detected'}</span>{suggested && <span className="small mut">Looks like part of {suggested.notion?.title ?? suggested.name}</span>}</div></button></td>
        <td><Pill color={PULSE_COLOR[p.pulse.level]}>{p.pulse.level}</Pill></td>
        <td className="num r">{ago(p.pulse.lastActivityDays)}</td>
        <td className="r">
          {isIgnored
            ? <button className="btn" onClick={() => void act.run(() => api.ignoreFolder(name, false), `${name} is back in the Inbox.`)} data-action="unignore">Restore</button>
            : <span className="pa">
                <button className="btn primary" disabled={off} title={why} onClick={() => void act.run(() => api.addToNotion(name), `Created a Notion page for ${name}.`)} data-action="add">Add to Notion</button>
                {snap.unlinkedPages.length > 0 && (
                  <select className="field" aria-label={`Link ${name} to an existing page`} value="" disabled={off} data-action="link"
                    onChange={(e) => { const id = e.target.value; if (id) void act.run(() => api.linkFolder(name, id), `Linked ${name} to its Notion page.`); }}>
                    <option value="">Link to page…</option>
                    {snap.unlinkedPages.map((u) => <option key={u.id} value={u.id}>{u.title}</option>)}
                  </select>
                )}
                {suggested && <button className="btn" disabled={off} title={why} onClick={() => void act.run(() => api.groupFolder(name, suggested.name), `${name} is now part of ${suggested.notion?.title ?? suggested.name}.`)} data-action="group-suggested">Group into {suggested.notion?.title ?? suggested.name}</button>}
                <select className="field" aria-label={`Group ${name} into another project`} value="" disabled={off} data-action="group"
                  onChange={(e) => { const into = e.target.value; if (into) void act.run(() => api.groupFolder(name, into), `${name} is now part of ${snap.projects.find((x) => x.name === into)?.notion?.title ?? into}.`); }}>
                  <option value="">Group into…</option>
                  {snap.projects.filter((x) => x.name !== name).map((x) => <option key={x.name} value={x.name}>{x.notion?.title ?? x.name}</option>)}
                </select>
                <button className="btn" onClick={() => void act.run(() => api.ignoreFolder(name, true), `${name} will not show here.`)} data-action="ignore">Ignore</button>
              </span>}
        </td>
      </tr>
    );
  };

  return (
    <>
      <NoticeBar notice={act.notice} />
      <section className="card" aria-labelledby="inbox-t" data-view="inbox">
        <div className="hd"><h3 id="inbox-t">Inbox</h3><span className="mut small">{plural(pending.length, 'folder')} not in Notion</span></div>
        <p className="mut small">Each folder here has no page in your Brainstorming database. Add it, link it to a page that already exists, or ignore it if it is not a project.</p>
        {pending.length === 0
          ? <div className="empty inner" data-state="inbox-empty"><b>Inbox zero</b><span>Every folder is tracked or ignored.</span></div>
          : <div className="tw"><table><thead><tr><th>Folder</th><th>Pulse</th><th className="r">Last commit</th><th className="r">Action</th></tr></thead><tbody>{pending.map((p) => row(p.name, false))}</tbody></table></div>}
      </section>
      {ignored.length > 0 && (
        <section className="card" aria-labelledby="ign-t" data-view="ignored">
          <div className="hd"><h3 id="ign-t">Ignored</h3><span className="mut small">{ignored.length} hidden from the Inbox</span></div>
          <div className="tw"><table><tbody>{ignored.map((p) => row(p.name, true))}</tbody></table></div>
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------- parked

export function Parked({ snap, now, onQuickLook }: { snap: Snapshot; now: Date; onQuickLook: (name: string) => void }) {
  const rows = useMemo(() => parkedRows(snap.projects, now), [snap.projects, now]);
  const access = writeAccess(snap.notion);
  return (
    <section className="card" aria-labelledby="parked-t" data-view="parked">
      <div className="hd"><h3 id="parked-t">Parked</h3><span className="mut small">{rows.length} set aside</span></div>
      {rows.length === 0
        ? <div className="empty inner" data-state="parked-empty"><b>Nothing parked</b><span>Park a project from its deep dive to free a focus slot without losing it.</span></div>
        : <div className="tw"><table><thead><tr><th>Project</th><th>Why</th><th>Revisit</th><th className="r">Action</th></tr></thead><tbody>
          {rows.map((r) => {
            const p = snap.projects.find((x) => x.name === r.name)!;
            return (
              <tr key={r.name} data-parked={r.name}>
                <td><button className="link" onClick={() => onQuickLook(r.name)}><div className="pn"><b>{r.title}</b><span className="mono">{r.name}</span></div></button></td>
                <td>{r.reason}</td>
                <td>{r.revisitOn ? <><span className="num">{fmtDate(new Date(r.revisitOn))}</span> {r.due ? <Pill color="--orange">Due for review</Pill> : <span className="mut small">in {plural(r.daysUntil!, 'day')}</span>}</> : <span className="mut">No date</span>}</td>
                <td className="r"><ProjectActions projects={snap.projects} project={p} now={now} canWrite={access.properties && !snap.scanning} why={access.reason} /></td>
              </tr>
            );
          })}
        </tbody></table></div>}
    </section>
  );
}

// ---------------------------------------------------------------- shipped

export function Shipped({ snap, now, onQuickLook }: { snap: Snapshot; now: Date; onQuickLook: (name: string) => void }) {
  const rows = useMemo(() => shippedRows(snap.projects, now), [snap.projects, now]);
  return (
    <section className="card" aria-labelledby="ship-t" data-view="shipped">
      <div className="hd"><h3 id="ship-t">Shipped</h3><span className="mut small">{rows.length} at General Available</span></div>
      {rows.length === 0
        ? <div className="empty inner" data-state="shipped-empty"><b>Nothing shipped yet</b><span>When every ship criterion on a focus project is done, Mark shipped moves it here.</span></div>
        : <div className="tw"><table><thead><tr><th>Project</th><th>Shipped</th><th className="r">Criteria met</th></tr></thead><tbody>
          {rows.map((r) => (
            <tr key={r.name} data-shipped={r.name}>
              <td><button className="link" onClick={() => onQuickLook(r.name)}><div className="pn"><b>{r.title}</b><span className="mono">{r.name}</span></div></button></td>
              <td className="num">{r.shippedOn ? `${fmtDate(new Date(r.shippedOn))}${r.daysAgo !== undefined ? `, ${r.daysAgo === 0 ? 'today' : plural(r.daysAgo, 'day') + ' ago'}` : ''}` : <span className="mut">Date unknown</span>}</td>
              <td className="num r">{r.criteria}</td>
            </tr>
          ))}
        </tbody></table></div>}
    </section>
  );
}

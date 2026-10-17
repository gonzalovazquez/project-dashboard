import { useEffect, useMemo, useState } from 'react';
import type { Snapshot } from '../../../shared/ipc.js';
import type { Project } from '../../../shared/types.js';
import { banners } from '../viewmodel/banners.js';
import { burnup, deepTiles, detailRows, healthModel, heatmap, kickoffPrompt, languageSegments, recentCommitRows, weekBars, writeAccess } from '../viewmodel/deepdive.js';
import { Pill } from './Bits.js';
import { KpiTile } from './Overview.js';
import { BurnupChart, HealthPanel, Heatmap, LanguageBar, WeekChart } from './deep/DeepCharts.js';
import { STAGE_COLOR } from '../tokens.js';

type Notice = { tone: 'bad' | 'good'; text: string };

/** Runs an action and turns a refused or failed result into a message the person can read. */
function useAction() {
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, success?: string) => {
    setBusy(true);
    try {
      const r = await fn();
      setNotice(r.ok ? (success ? { tone: 'good', text: success } : undefined) : { tone: 'bad', text: r.error?.message ?? 'That did not work.' });
    } catch (e) {
      setNotice({ tone: 'bad', text: e instanceof Error ? e.message : 'That did not work.' });
    } finally { setBusy(false); }
  };
  return { notice, busy, run, clear: () => setNotice(undefined) };
}

function NextAction({ p, can, onSave }: { p: Project; can: boolean; onSave: (t: string | null) => void }) {
  const saved = p.notion?.nextAction ?? '';
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  const dirty = text.trim() !== saved;
  return (
    <form className="next" onSubmit={(e) => { e.preventDefault(); if (dirty) onSave(text.trim() || null); }}>
      <label htmlFor="next-action">Next action</label>
      <input id="next-action" value={text} disabled={!can} maxLength={200} placeholder="The one small thing to do next" onChange={(e) => setText(e.target.value)} />
      <button className="btn" type="submit" disabled={!can || !dirty}>Save</button>
    </form>
  );
}

export function DeepDive({ snap, project, now }: { snap: Snapshot; project: Project; now: Date }) {
  const act = useAction();
  const n = project.notion;
  const access = writeAccess(snap.notion);
  const canWrite = access.properties && !snap.scanning;
  const canCheck = access.criteria && !snap.scanning;
  const model = useMemo(() => ({
    tiles: deepTiles(project, now), burn: burnup(project, now), heat: heatmap(project, now), weeks: weekBars(project, now),
    health: healthModel(project, now), langs: languageSegments(project), rows: detailRows(project, now), commits: recentCommitRows(project, now),
  }), [project, now]);
  const notices = banners(snap);
  const allDone = model.burn.ready;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(kickoffPrompt(project, now)); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { act.run(async () => ({ ok: false, error: { message: 'Could not copy to the clipboard.' } })); }
  };
  const api = window.dashboard;

  return (
    <>
      {notices.map((b) => <p key={b.id} className={`banner ${b.tone}`} data-banner>{b.text}</p>)}
      {access.reason && <p className="banner warn" data-banner="write-access">{access.reason}</p>}
      {act.notice && <p className={`banner ${act.notice.tone === 'good' ? 'info' : 'bad'}`} role="status" data-notice={act.notice.tone}>{act.notice.text}</p>}
      <div className="dd-head">
        <div>
          <div className="eye">Deep dive</div>
          <h1 data-testid="dd-title">{n?.title ?? project.name}</h1>
          <div className="dd-meta">
            {n && <Pill color={STAGE_COLOR[n.stage]}>{n.stage}</Pill>}
            <span className="mut small">{project.path}</span>
          </div>
        </div>
        <div className="dd-actions">
          {project.github && <button className="btn" onClick={() => void api.openLink(project.name, 'github')}>GitHub</button>}
          {n && <button className="btn" onClick={() => void api.openLink(project.name, 'notion')}>Notion</button>}
          <button className="btn" onClick={() => void api.openLink(project.name, 'folder')}>Folder</button>
          <button className="btn" onClick={copy} data-action="copy-kickoff">{copied ? 'Copied' : 'Copy kickoff prompt'}</button>
          <button className="btn primary" disabled={!allDone || !canWrite || act.busy} title={allDone ? undefined : 'Every ship criterion must be done first'} data-action="ship"
            onClick={() => void act.run(() => api.markShipped(project.name), `${n?.title ?? project.name} shipped. Its focus slot is free.`)}>Mark shipped</button>
        </div>
      </div>
      <NextAction p={project} can={canWrite && !act.busy} onSave={(t) => void act.run(() => api.setNextAction(project.name, t))} />
      <div className="kpis">{model.tiles.map((k) => <KpiTile key={k.id} k={k} />)}</div>
      <div className="g21">
        <BurnupChart model={model.burn} now={now} />
        <section className="card" aria-labelledby="crit-t" data-section="criteria">
          <div className="hd"><h3 id="crit-t">Ship criteria</h3><span className="mut small">{model.burn.done} of {model.burn.total}</span></div>
          {(n?.criteria ?? []).length === 0
            ? <p className="mut small">None yet. Add to-do items to the Notion page.</p>
            : <ul className="crit">
                {n!.criteria.map((c) => (
                  <li key={c.blockId} data-done={c.done}>
                    <label>
                      <input type="checkbox" checked={c.done} disabled={!canCheck || act.busy} onChange={(e) => void act.run(() => api.setCriterion(project.name, c.blockId!, e.target.checked))} />
                      <span>{c.title}</span>
                    </label>
                    <span className="mut small num">{c.hours ? `${c.hours}h` : 'no estimate'}</span>
                  </li>
                ))}
              </ul>}
        </section>
      </div>
      <div className="g2">
        <Heatmap model={model.heat} />
        <WeekChart bars={model.weeks} />
      </div>
      <div className="g2">
        <HealthPanel model={model.health} />
        <section className="card" aria-labelledby="lang-t">
          <div className="hd"><h3 id="lang-t">Languages</h3><span className="mut small">Complexity {project.complexity.score}</span></div>
          <LanguageBar segments={model.langs} />
        </section>
      </div>
      <div className="g2">
        <section className="card" aria-labelledby="det-t" data-section="details">
          <h3 id="det-t">Details</h3>
          <dl className="details">{model.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        </section>
        <section className="card" aria-labelledby="rc-t" data-section="recent">
          <h3 id="rc-t">Recent commits</h3>
          {model.commits.length === 0 ? <p className="mut small">No commits.</p>
            : <ul className="commits">{model.commits.map((c, i) => <li key={i}><span className="mut small num">{c.age}</span><span>{c.message}</span></li>)}</ul>}
        </section>
      </div>
    </>
  );
}

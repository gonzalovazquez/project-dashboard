import { useMemo, useState } from 'react';
import type { Snapshot } from '../../../shared/ipc.js';
import type { UnlinkedPage } from '../../../shared/ipc.js';
import { IDEA_MAX, newProjectPrompt, planningModel } from '../../../shared/planning.js';
import { STAGE_COLOR } from '../tokens.js';
import { plural } from '../viewmodel/format.js';
import { requestRescanOnReturn } from '../rescan.js';
import { NoticeBar, useAction } from './actions.js';
import { Pill } from './Bits.js';
import { Sheet } from './Sheet.js';

/** Hands a new idea to Claude, where the brainstorm-plan skill turns it into a Notion page. */
function NewProjectSheet({ onClose, onStarted }: { onClose: () => void; onStarted: () => void }) {
  const [idea, setIdea] = useState('');
  const [copied, setCopied] = useState(false);
  const act = useAction();
  const ready = idea.trim().length > 0;
  const open = () => void act.run(() => window.dashboard.startNewProject(idea)).then((ok) => { if (ok) { requestRescanOnReturn(); onStarted(); } });
  const copy = async () => {
    try { await navigator.clipboard.writeText(newProjectPrompt(idea)); setCopied(true); requestRescanOnReturn(); setTimeout(() => setCopied(false), 1800); }
    catch { act.fail('Could not copy to the clipboard.'); }
  };
  return (
    <Sheet name="new-project" title="New project" width={520} onClose={onClose}
      footer={<>
        <button className="btn" disabled={!ready} onClick={() => void copy()} data-action="copy-prompt">{copied ? 'Copied' : 'Copy prompt'}</button>
        <button className="btn primary" disabled={!ready || act.busy} onClick={open} data-action="open-claude">Open in Claude</button>
      </>}>
      <NoticeBar notice={act.notice} />
      <p className="small">A new project starts as a brainstorm in Claude. The <b>brainstorm-plan</b> skill turns the idea into a plan on a new page in your Brainstorming database, ending with a Planning section of ship criteria, and <b>build-budget</b> turns the phases into a schedule.</p>
      <label className="fld">What is the idea?
        <textarea rows={4} maxLength={IDEA_MAX} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="A sentence or two is enough. The details come out in the brainstorm." data-autofocus data-field="idea" />
      </label>
      <p className="mut small"><b>Open in Claude</b> starts a new chat on claude.ai with the prompt typed in. To use Claude Code or the desktop app instead, copy the prompt and paste it there. When the page is in Notion, come back here: the app checks Notion as soon as you return.</p>
    </Sheet>
  );
}

export function Planning({ snap }: { snap: Snapshot }) {
  const { ideas, started: elsewhere } = useMemo(() => planningModel(snap.unlinkedPages), [snap.unlinkedPages]);
  const [sheet, setSheet] = useState(false);
  const [started, setStarted] = useState(false);
  const act = useAction();
  const connected = snap.notion.state === 'connected' || snap.notion.state === 'schema-missing';
  const table = (rows: UnlinkedPage[], list: string) => (
    <div className="tw"><table data-list={list}><thead><tr><th>Idea</th><th>Stage</th><th>Ship criteria</th><th>Next</th></tr></thead><tbody>
      {rows.map((i) => (
        <tr key={i.id} data-idea={i.id}>
          <td><button className="link" title="Open in Notion" onClick={() => void act.run(() => window.dashboard.openIdea(i.id))}><div className="pn"><b>{i.title}</b></div></button></td>
          <td><Pill color={STAGE_COLOR[i.stage]}>{i.stage}</Pill></td>
          <td className="num">{i.total ? `${i.done} of ${i.total}` : <span className="mut">None yet</span>}</td>
          <td className="clip" title={i.next}>{i.next ?? <span className="mut">{i.total ? 'All done' : 'Add criteria under Planning'}</span>}</td>
        </tr>
      ))}
    </tbody></table></div>
  );
  return (
    <>
      <NoticeBar notice={act.notice} />
      {started && <p className="banner info" role="status" data-banner="started">The brainstorm is open in Claude. When the plan is in Notion, come back here and the new idea shows up below.</p>}
      <section className="card" aria-labelledby="plan-t" data-view="planning">
        <div className="hd">
          <h3 id="plan-t">Ideas</h3>
          <span className="pa">
            <span className="mut small">{plural(ideas.length, 'idea')} not started</span>
            <button className="btn primary" onClick={() => setSheet(true)} data-action="new-project">New project</button>
          </span>
        </div>
        <p className="mut small">Not started pages in your Brainstorming database with no folder yet. Create the project's folder in your Development folder and it moves to your projects.</p>
        {!connected
          ? <div className="empty inner" data-state="planning-no-notion"><b>Notion is not connected</b><span>Ideas come from your Brainstorming database. Connect Notion in Settings to see them.</span></div>
          : ideas.length === 0
            ? <div className="empty inner" data-state="planning-empty"><b>No ideas in planning</b><span>Start one with New project. It shows up here once its page is in Notion.</span></div>
            : table(ideas, 'ideas')}
      </section>
      {connected && elsewhere.length > 0 && (
        <section className="card" aria-labelledby="else-t" data-view="started-elsewhere">
          <div className="hd"><h3 id="else-t">Started, but no folder here</h3><span className="mut small">{plural(elsewhere.length, 'page')}</span></div>
          <p className="mut small">In progress or in Beta in Notion, but no folder in your Development folder matches. If the folder is there under another name, link it from the Inbox.</p>
          {table(elsewhere, 'started')}
        </section>
      )}
      {sheet && <NewProjectSheet onClose={() => setSheet(false)} onStarted={() => { setSheet(false); setStarted(true); }} />}
    </>
  );
}

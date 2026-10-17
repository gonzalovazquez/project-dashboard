import { useMemo, useState } from 'react';
import type { Snapshot } from '../../../shared/ipc.js';
import type { ReviewOutcome } from '../../../shared/review.js';
import type { Project } from '../../../shared/types.js';
import { STAGE_COLOR } from '../tokens.js';
import { plural } from '../viewmodel/format.js';
import { writeAccess } from '../viewmodel/deepdive.js';
import { inDays } from '../viewmodel/library.js';
import {
  buildPlan, candidates, decide, initialDraft, planLines, problems, setNextAction, stalledProjects, toggleFocus, WEEKDAYS, weekInReview,
  type Choice, type Draft,
} from '../viewmodel/review.js';
import { NoticeBar, useAction } from './actions.js';
import { Pill } from './Bits.js';

export interface ReviewState { step: 1 | 2 | 3 | 4; draft: Draft; outcome?: ReviewOutcome }
export const newReview = (ps: Project[]): ReviewState => ({ step: 1, draft: initialDraft(ps) });

const STEPS = ['Look back', 'Stalled projects', 'Pick focus', 'Next actions'] as const;
const title = (p: Project | undefined, fallback: string) => p?.notion?.title ?? fallback;

interface Props { snap: Snapshot; now: Date; state: ReviewState; onState: (s: ReviewState) => void; onFinish: () => void }

export function Review({ snap, now, state, onState, onFinish }: Props) {
  const { step, draft, outcome } = state;
  const ps = snap.projects;
  const act = useAction();
  const week = useMemo(() => weekInReview(ps, now), [ps, now]);
  const stalled = useMemo(() => stalledProjects(ps, now), [ps, now]);
  const cands = useMemo(() => candidates(ps, now), [ps, now]);
  const blockers = useMemo(() => problems(ps, draft, now), [ps, draft, now]);
  const plan = useMemo(() => buildPlan(ps, draft), [ps, draft]);
  const access = writeAccess(snap.notion);
  const canApply = access.properties && !snap.scanning && blockers.length === 0 && !act.busy;
  const [blocked, setBlocked] = useState<string>();
  const set = (patch: Partial<ReviewState>) => onState({ ...state, ...patch });
  const setDraft = (d: Draft) => set({ draft: d });
  const find = (name: string) => ps.find((p) => p.name === name);

  if (outcome) {
    return (
      <section className="card" data-view="review-done" aria-labelledby="rv-done">
        <h3 id="rv-done">Review complete</h3>
        <p>{plural(outcome.changed, 'project')} changed in Notion. {plural(outcome.notesWritten, 'dated note')} added to project pages.</p>
        {outcome.notesFailed.length > 0 && <p className="banner warn" data-banner="notes">The review was applied, but the note could not be written for {outcome.notesFailed.join(', ')}. Add it in Notion by hand if you want it on record.</p>}
        <div><button className="btn primary" onClick={onFinish}>Back to Overview</button></div>
      </section>
    );
  }

  const run = async () => { await act.run(async () => { const r = await window.dashboard.applyReview(plan); if (r.ok) onState({ step: 1, draft: initialDraft(ps), outcome: r.value }); return r; }); };

  const parkFields = (name: string, c: Extract<Choice, { action: 'park' }>) => (
    <div className="park-fields" data-park-fields={name}>
      <label className="fld">Why?
        <input value={c.reason} maxLength={500} onChange={(e) => setDraft(decide(draft, name, { ...c, reason: e.target.value }))} data-field="reason" placeholder="Blocked, lost interest, waiting on something" />
      </label>
      <label className="fld">Revisit on
        <input type="date" value={c.revisitOn} onChange={(e) => setDraft(decide(draft, name, { ...c, revisitOn: e.target.value }))} data-field="revisit" />
      </label>
    </div>
  );

  return (
    <>
      <NoticeBar notice={act.notice} />
      {access.reason && <p className="banner warn" data-banner="write-access">{access.reason} You can look through the review, but not apply it.</p>}
      <ol className="steps" aria-label="Review steps">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button aria-current={step === i + 1 ? 'step' : undefined} onClick={() => set({ step: (i + 1) as ReviewState['step'] })} data-step={i + 1}>
              <span className="n">{i + 1}</span>{label}
            </button>
          </li>
        ))}
      </ol>

      {step === 1 && (
        <>
          <section className="card" aria-labelledby="rv1" data-review-step="1">
            <div className="hd"><h3 id="rv1">The week</h3><span className="mut small">{plural(week.commits, 'commit')}, {plural(week.criteriaDone, 'criterion', 'criteria')} done on focus projects</span></div>
            {week.rows.length === 0 ? <p className="mut">No project is in focus. Step 3 picks the next three.</p> : (
              <div className="tw"><table><thead><tr><th>Project</th><th className="r">Commits</th><th className="r">Criteria done</th><th>Stage</th><th className="r">Progress</th></tr></thead><tbody>
                {week.rows.map((r) => {
                  const p = find(r.name);
                  return (
                    <tr key={r.name}>
                      <td><b>{r.title}</b></td>
                      <td className="num r">{r.commits}</td>
                      <td className="num r">{r.criteriaDone}</td>
                      <td>{p?.notion && <Pill color={STAGE_COLOR[p.notion.stage]}>{p.notion.stage}</Pill>}{r.stageMoved && <span className="mut small"> moved this week</span>}</td>
                      <td className="num r">{r.progress === undefined ? '–' : `${Math.round(r.progress * 100)}%`}</td>
                    </tr>
                  );
                })}
              </tbody></table></div>
            )}
            {week.quietFocus > 0 && <p data-testid="quiet-focus">{plural(week.quietFocus, 'focus project')} had no commits and no criteria done this week.</p>}
          </section>
          <ScheduleCard snap={snap} />
        </>
      )}

      {step === 2 && (
        <section className="card" aria-labelledby="rv2" data-review-step="2">
          <div className="hd"><h3 id="rv2">Stalled projects</h3><span className="mut small">{plural(stalled.length, 'project')} need a decision</span></div>
          {stalled.length === 0 ? <div className="empty inner" data-state="none-stalled"><b>Nothing is stalled</b><span>Every active project is moving. Go on to pick focus.</span></div> : (
            <ul className="decisions">
              {stalled.map((s) => {
                const c = draft.decisions[s.name];
                const pick = (a: Choice['action']) => setDraft(decide(draft, s.name, a === 'keep' ? { action: 'keep' } : a === 'kill' ? { action: 'kill' } : { action: 'park', reason: '', revisitOn: inDays(now, 30) }));
                return (
                  <li key={s.name} data-stalled={s.name}>
                    <div className="who"><b>{s.title}</b>{s.focus && <Pill color="--blue">Focus</Pill>}<span className="mut small">{s.reasons.join(' · ')}</span></div>
                    <div className="seg" role="group" aria-label={`Decision for ${s.title}`}>
                      {(['keep', 'park', 'kill'] as const).map((a) => <button key={a} aria-pressed={c?.action === a} onClick={() => pick(a)} data-choice={a}>{a === 'keep' ? 'Keep going' : a === 'park' ? 'Park' : 'Kill'}</button>)}
                    </div>
                    {c?.action === 'park' && parkFields(s.name, c)}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {step === 3 && (
        <section className="card" aria-labelledby="rv3" data-review-step="3">
          <div className="hd"><h3 id="rv3">Pick focus</h3><span className="mut small" data-testid="slots">{draft.focus.length} of 3 slots</span></div>
          <p className="mut small">Projects cheapest to finish come first. Taking a project out of focus parks it.</p>
          {blocked && <p className="banner warn" role="status" data-banner="blocked">{blocked}</p>}
          <ul className="decisions">
            {cands.filter((c) => { const d = draft.decisions[c.name]; return !d || d.action === 'keep' || (d.action === 'park' && c.focus); }).map((c) => {
              const on = draft.focus.includes(c.name);
              const d = draft.decisions[c.name];
              return (
                <li key={c.name} data-candidate={c.name}>
                  <label className="who">
                    <input type="checkbox" checked={on} onChange={() => { const t = toggleFocus(draft, ps, c.name, now); if ('draft' in t) { setBlocked(undefined); setDraft(t.draft); } else setBlocked(t.blocked); }} />
                    <b>{c.title}</b>
                    <span className="mut small">{c.hint}{c.progress !== undefined ? `, ${Math.round(c.progress * 100)}% done` : ''}</span>
                  </label>
                  {d?.action === 'park' && !on && <><span className="mut small">Will be parked</span>{parkFields(c.name, d)}</>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {step === 4 && (
        <section className="card" aria-labelledby="rv4" data-review-step="4">
          <div className="hd"><h3 id="rv4">Next actions</h3><span className="mut small">One small thing to do first on each focus project</span></div>
          {draft.focus.length === 0 ? <p className="mut">No project is in focus. Step 3 picks the next three.</p> : (
            <ul className="decisions">
              {draft.focus.map((name) => {
                const p = find(name);
                return (
                  <li key={name} data-next={name}>
                    <label className="fld">{title(p, name)}
                      <input value={draft.nextActions[name] ?? p?.notion?.nextAction ?? ''} maxLength={200} onChange={(e) => setDraft(setNextAction(draft, name, e.target.value))} placeholder="The next thing to do" data-field="next" />
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <h3>What will change</h3>
          {plan.decisions.length === 0 ? <p className="mut">No changes. Finishing records that you did the review.</p> : <ul className="plan" data-testid="plan">{planLines(ps, plan).map((l, i) => <li key={i}>{l}</li>)}</ul>}
          {blockers.length > 0 && <ul className="blockers" data-testid="blockers">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
          <div className="sheet-foot"><button className="btn primary" disabled={!canApply} onClick={() => void run()} data-action="apply-review">{act.busy ? 'Applying…' : 'Apply review'}</button></div>
        </section>
      )}

      <div className="rv-nav">
        <button className="btn" disabled={step === 1} onClick={() => set({ step: (step - 1) as ReviewState['step'] })} data-action="back">Back</button>
        {step < 4 && <button className="btn primary" onClick={() => set({ step: (step + 1) as ReviewState['step'] })} data-action="next">Next</button>}
      </div>
    </>
  );
}

function ScheduleCard({ snap }: { snap: Snapshot }) {
  const s = snap.settings;
  const act = useAction();
  const save = (patch: Parameters<typeof window.dashboard.saveSettings>[0]) => void act.run(() => window.dashboard.saveSettings(patch));
  return (
    <section className="card" aria-labelledby="rv-sched" data-section="schedule">
      <h3 id="rv-sched">Reminder</h3>
      <NoticeBar notice={act.notice} />
      <div className="filters">
        <label className="flt"><span>Remind me</span>
          <input type="checkbox" checked={s.reviewReminder} onChange={(e) => save({ reviewReminder: e.target.checked })} data-field="reminder" />
        </label>
        <label className="flt">Day
          <select value={s.reviewDay} disabled={!s.reviewReminder} onChange={(e) => save({ reviewDay: Number(e.target.value) })} data-field="day">{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
        </label>
        <label className="flt">Time
          <input className="field" type="time" value={s.reviewTime} disabled={!s.reviewReminder} onChange={(e) => { if (e.target.value) save({ reviewTime: e.target.value }); }} data-field="time" />
        </label>
      </div>
      <p className="mut small">{s.lastReviewAt ? `Last review: ${new Date(s.lastReviewAt).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}.` : 'No review recorded yet.'} You get a notification when it is due and the app is running.</p>
    </section>
  );
}

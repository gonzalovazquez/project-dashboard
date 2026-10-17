import { useState } from 'react';
import type { Appearance, NotionState, Snapshot } from '../../../shared/ipc.js';
import { NoticeBar, useAction } from './actions.js';
import { ScheduleCard } from './Review.js';

const NOTION_TEXT: Record<NotionState, string> = {
  connected: 'Connected',
  'not-configured': 'Not connected',
  error: 'Could not reach Notion',
  'schema-missing': 'Connected, but the database needs setup',
};
const APPEARANCES: Array<[Appearance, string]> = [['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']];

interface Props { snap: Snapshot; first: boolean; onFinish: () => void }

export function Settings({ snap, first, onFinish }: Props) {
  const s = snap.settings;
  const folder = useAction();
  const token = useAction();
  const look = useAction();
  const group = useAction();
  const [secret, setSecret] = useState('');
  const api = window.dashboard;
  const env = s.tokenSource === 'env';

  const choose = async () => {
    const picked = await api.chooseFolder();
    if (!picked.ok) { folder.fail(picked.error.message); return; }
    if (picked.value === null) return;
    if (await folder.run(() => api.saveSettings({ developmentFolder: picked.value! }), `Scanning ${picked.value}…`)) void api.startScan();
  };
  const connect = async () => {
    const value = secret.trim();
    if (!value) return;
    if (await token.run(() => api.setToken(value))) { setSecret(''); void api.startScan(); }
  };
  const disconnect = async () => { if (await token.run(() => api.setToken(null), 'Notion disconnected.')) void api.startScan(); };

  return (
    <>
      {first && (
        <div className="hello" data-view="welcome">
          <div className="eye">Welcome</div>
          <h1>Finish what you start</h1>
          <p className="mut">Two steps: tell the app where your projects live, then connect Notion so it knows what each one needs to ship. You can change both later in Settings.</p>
        </div>
      )}

      <section className="card" aria-labelledby="set-folder" data-section="folder">
        <h3 id="set-folder">{first ? '1. ' : ''}Development folder</h3>
        <p className="mut small">Every folder directly inside it becomes a project.</p>
        <NoticeBar notice={folder.notice} />
        <div className="setrow"><code className="mono" data-testid="folder-path">{s.developmentFolder}</code><button className="btn" onClick={() => void choose()} disabled={snap.scanning} data-action="choose-folder">Choose…</button></div>
        {snap.scanError && <p className="banner bad" role="alert" data-banner="scan">{snap.scanError}</p>}
      </section>

      {Object.keys(s.groups).length > 0 && (
        <section className="card" aria-labelledby="set-groups" data-section="groups">
          <h3 id="set-groups">Grouped folders</h3>
          <p className="mut small">These folders are tracked together with another project as one.</p>
          <NoticeBar notice={group.notice} />
          <ul className="plan">
            {Object.entries(s.groups).flatMap(([primary, members]) => members.map((m) => (
              <li key={`${primary}/${m}`} data-group-member={m}>
                <span className="mono">{m}</span> is part of <b>{primary}</b>{' '}
                <button className="link" disabled={snap.scanning || group.busy} onClick={() => void group.run(() => api.ungroupFolder(m), `${m} is its own project again.`)} data-action="ungroup">Split out</button>
              </li>
            )))}
          </ul>
        </section>
      )}

      <section className="card" aria-labelledby="set-notion" data-section="notion">
        <h3 id="set-notion">{first ? '2. ' : ''}Notion</h3>
        <p data-testid="notion-line"><b>{NOTION_TEXT[snap.notion.state]}</b>{snap.notion.pages !== undefined && snap.notion.state !== 'not-configured' ? `, ${snap.notion.pages} pages in the database` : ''}</p>
        {snap.notion.message && snap.notion.state !== 'not-configured' && <p className="mut small">{snap.notion.message}</p>}
        {snap.notion.state === 'schema-missing' && (
          <p className="small" data-testid="schema-help">Run <code className="mono">npm run notion:setup</code> in the project folder to see the missing properties. That is only a preview. To add them, run <code className="mono">npm run notion:setup -- --apply</code>, then rescan.</p>
        )}
        <NoticeBar notice={token.notice} />
        {env ? (
          <p className="mut small" data-testid="token-env">The token comes from the NOTION_TOKEN environment variable. Remove the variable to manage it here.</p>
        ) : !s.secureStorageAvailable ? (
          <p className="banner warn" data-testid="no-secure-storage">This computer cannot encrypt secrets for the app, so it will not save a token. Set the NOTION_TOKEN environment variable instead.</p>
        ) : (
          <form className="setrow" onSubmit={(e) => { e.preventDefault(); void connect(); }}>
            <input className="field grow" type="password" autoComplete="off" spellCheck={false} placeholder={s.tokenSource === 'keychain' ? 'Paste a new token to replace the saved one' : 'Paste your integration token'} aria-label="Notion integration token" value={secret} onChange={(e) => setSecret(e.target.value)} data-field="token" />
            <button className="btn primary" type="submit" disabled={!secret.trim() || token.busy} data-action="connect">{s.tokenSource === 'keychain' ? 'Replace' : 'Connect'}</button>
            {s.tokenSource === 'keychain' && <button type="button" className="btn danger" onClick={() => void disconnect()} disabled={token.busy} data-action="disconnect">Disconnect</button>}
          </form>
        )}
        <details className="tview"><summary>How to get a token</summary>
          <ol className="small">
            <li>In Notion, open Settings, then Connections, then Develop or manage integrations, and create an internal integration.</li>
            <li>Copy its secret and paste it above. It is stored in your system keychain and never leaves this computer except to reach Notion.</li>
            <li>Open your Brainstorming database, choose Connections from the ••• menu, and add the integration.</li>
          </ol>
        </details>
      </section>

      {!first && (
        <section className="card" aria-labelledby="set-look" data-section="appearance">
          <h3 id="set-look">Appearance</h3>
          <NoticeBar notice={look.notice} />
          <div className="seg" role="group" aria-label="Appearance">
            {APPEARANCES.map(([v, l]) => <button key={v} aria-pressed={s.appearance === v} onClick={() => void look.run(() => api.saveSettings({ appearance: v }))} data-appearance={v}>{l}</button>)}
          </div>
        </section>
      )}

      {!first && <ScheduleCard snap={snap} />}

      {first && (
        <div className="rv-nav">
          <button className="btn" onClick={onFinish} data-action="skip-setup">Skip for now</button>
          <button className="btn primary" onClick={onFinish} data-action="finish-setup">{snap.notion.state === 'connected' ? 'Finish' : 'Continue without Notion'}</button>
        </div>
      )}
    </>
  );
}

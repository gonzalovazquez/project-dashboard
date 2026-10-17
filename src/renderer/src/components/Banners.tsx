import type { Snapshot } from '../../../shared/ipc.js';
import { banners } from '../viewmodel/banners.js';
import { useNav } from './nav.js';

/** What needs attention about the folder scan and the Notion connection, each with the button that fixes it. */
export function Banners({ snap }: { snap: Pick<Snapshot, 'scanError' | 'notion' | 'scanning'> }) {
  const nav = useNav();
  return (
    <>
      {banners(snap).map((b) => (
        <p key={b.id} className={`banner ${b.tone}`} data-banner={b.id} role={b.tone === 'bad' ? 'alert' : undefined}>
          {b.text}{' '}
          {b.action && <button className="link" disabled={b.action.kind === 'rescan' && snap.scanning} onClick={b.action.kind === 'settings' ? nav.openSettings : nav.rescan} data-banner-action={b.action.kind}>{b.action.label}</button>}
        </p>
      ))}
    </>
  );
}

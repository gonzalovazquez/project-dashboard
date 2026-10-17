import { describe, expect, it } from 'vitest';
import { banners } from '../src/renderer/src/viewmodel/banners.js';

describe('banners', () => {
  it('says nothing when all is well', () => {
    expect(banners({ notion: { state: 'connected' } })).toEqual([]);
  });
  it('offers a way to connect Notion', () => {
    expect(banners({ notion: { state: 'not-configured' } })[0]).toMatchObject({ id: 'notion', action: { kind: 'settings', label: 'Connect Notion' } });
  });
  it('offers a retry when Notion is unreachable and keeps the reason', () => {
    expect(banners({ notion: { state: 'error', message: 'Could not reach Notion: offline.' } })[0]).toMatchObject({ tone: 'warn', text: 'Could not reach Notion: offline.', action: { kind: 'rescan' } });
  });
  it('points a missing folder to settings and any other scan failure to a retry', () => {
    expect(banners({ notion: { state: 'connected' }, scanError: 'The folder /x does not exist. Choose your Development folder in settings.' })[0]).toMatchObject({ tone: 'bad', action: { kind: 'settings' } });
    expect(banners({ notion: { state: 'connected' }, scanError: 'EACCES: permission denied' })[0]).toMatchObject({ tone: 'bad', action: { kind: 'rescan' } });
  });
  it('shows a scan failure and a Notion problem together', () => {
    expect(banners({ notion: { state: 'schema-missing' }, scanError: 'boom' }).map((b) => b.id)).toEqual(['scan', 'notion']);
  });
});

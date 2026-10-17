import { useCallback, useState } from 'react';
import type { Result } from '../../../shared/ipc.js';

export interface Notice { tone: 'bad' | 'good'; text: string }

/** Runs a bridge call and turns a refused or failed result into a message a person can read. Resolves to whether it worked. */
export function useAction() {
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<Result<unknown>>, success?: string): Promise<boolean> => {
    setBusy(true);
    try {
      const r = await fn();
      setNotice(r.ok ? (success ? { tone: 'good', text: success } : undefined) : { tone: 'bad', text: r.error.message });
      return r.ok;
    } catch (e) {
      setNotice({ tone: 'bad', text: e instanceof Error ? e.message : 'That did not work.' });
      return false;
    } finally { setBusy(false); }
  }, []);
  return { notice, busy, run, clear: () => setNotice(undefined), fail: (text: string) => setNotice({ tone: 'bad', text }) };
}

export const NoticeBar = ({ notice }: { notice?: Notice }) =>
  notice ? <p className={`banner ${notice.tone === 'good' ? 'info' : 'bad'}`} role="status" data-notice={notice.tone}>{notice.text}</p> : null;

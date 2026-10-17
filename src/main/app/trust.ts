/**
 * True only for the app's own page: the dev server's origin while developing, or exactly the
 * built index.html in a packaged app. Anything else, including other local files, is untrusted.
 */
export function isTrustedUrl(url: string, allowed: { devUrl?: string; indexFileUrl: string }): boolean {
  try {
    const u = new URL(url);
    if (allowed.devUrl) return u.origin === new URL(allowed.devUrl).origin;
    return u.protocol === 'file:' && u.pathname === new URL(allowed.indexFileUrl).pathname;
  } catch {
    return false;
  }
}

/**
 * Work that happens outside the app (a brainstorm in Claude writing a new Notion page) asks for a rescan the next time
 * the window gets focus, instead of waiting for the usual ten minutes.
 */
let requested = false;

export const requestRescanOnReturn = () => { requested = true; };

/** True once after a request, then false until the next one. */
export function takeRescanRequest(): boolean {
  const was = requested;
  requested = false;
  return was;
}

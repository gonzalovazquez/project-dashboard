import { writeFile } from 'node:fs/promises';
import type { BrowserWindow } from 'electron';
import { app } from 'electron';
import type { DashboardService } from './app/service.js';

/**
 * Launch check used by `npm run smoke`: waits for the first scan to finish, reads what the window
 * actually rendered, saves a screenshot, prints one SMOKE_RESULT line and exits.
 */
export function runSmoke(service: DashboardService, win: BrowserWindow, outPrefix: string): void {
  let done = false;
  const finish = async (code: number, result: unknown) => {
    if (done) return; done = true;
    console.log('SMOKE_RESULT ' + JSON.stringify(result));
    app.exit(code);
  };
  setTimeout(() => void finish(1, { error: 'timed out waiting for the first scan' }), 45_000);
  service.onUpdate((u) => {
    if (u.kind !== 'scan-finished') return;
    setTimeout(async () => {
      try {
        const page = await win.webContents.executeJavaScript(`({
          headline: document.querySelector('[data-testid=headline]')?.textContent ?? null,
          banner: document.querySelector('[data-banner]')?.textContent ?? null,
          notionState: document.querySelector('[data-testid=notion-state]')?.textContent ?? null,
          noTracked: !!document.querySelector('[data-state=no-tracked]'),
          allProjects: [...document.querySelectorAll('.item')].find((e) => e.textContent.includes('All projects'))?.querySelector('.c')?.textContent ?? null,
          inbox: [...document.querySelectorAll('.item')].find((e) => e.textContent.includes('Inbox'))?.querySelector('.c')?.textContent ?? null,
          bridgeKeys: Object.keys(window.dashboard ?? {}).sort(),
          nodeLeaked: typeof require !== 'undefined' || typeof process !== 'undefined',
          title: document.title,
          csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? null,
        })`);
        const image = await win.webContents.capturePage();
        await writeFile(outPrefix + '.png', image.toPNG());
        await finish(0, { ...page, projects: u.snapshot.projects.length, scanError: u.snapshot.scanError ?? null, notion: u.snapshot.notion.state });
      } catch (e) { await finish(1, { error: String(e) }); }
    }, 600);
  });
}

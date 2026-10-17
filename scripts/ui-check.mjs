// Serves the built interface, stubs the bridge with sample data and checks what a person would see and click.
// Usage: npm run ui-check   (builds first). Screenshots go to $SHOTS or out/shots.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { readdirSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from 'playwright-core';

const root = join(process.cwd(), 'out/renderer');
const shots = process.env.SHOTS ?? join(process.cwd(), 'out/shots');
await mkdir(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try {
    const path = join(root, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;

const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
const dir = readdirSync(browsers).filter((d) => /^chromium-\d+$/.test(d)).sort().at(-1);
const executablePath = existsSync(join(browsers, dir, 'chrome-linux64/chrome')) ? join(browsers, dir, 'chrome-linux64/chrome') : join(browsers, dir, 'chrome-linux/chrome');
const browser = await chromium.launch({ executablePath });

const load = async (variant, scheme = 'light', size = { width: 1280, height: 1500 }) => {
  const snap = JSON.parse(await readFile(`out/sample-${variant}.json`, 'utf8'));
  const page = await browser.newPage({ viewport: size, colorScheme: scheme });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  // A browser asks for a favicon; the packaged app loads from disk and never does. Anything else that fails is a real problem.
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`${r.status()} ${r.url()}`); });
  await page.addInitScript((s) => {
    window.__calls = [];
    const ok = async () => ({ ok: true });
    window.dashboard = {
      getSnapshot: async () => s, startScan: async () => { window.__calls.push('startScan'); },
      onProjectUpdate: () => () => {}, saveSettings: async (p) => { window.__calls.push(['saveSettings', p]); return { ok: true }; },
      getSettings: async () => s.settings, setNextAction: ok, setCriterion: ok, promote: ok, park: ok, kill: ok, unpark: ok, setToken: ok, openLink: ok,
    };
  }, snap);
  await page.goto(base);
  await page.waitForSelector('.app, [data-state]');
  return { page, errors };
};

const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass || !detail ? '' : ' -> ' + detail}`); };
const order = (page) => page.$$eval('tbody tr[data-project]', (rs) => rs.map((r) => r.getAttribute('data-project')));

// ----- full overview, light and dark
for (const scheme of ['light', 'dark']) {
  const { page, errors } = await load('full', scheme);
  await page.screenshot({ path: join(shots, `overview-${scheme}.png`) });
  if (scheme === 'light') {
    check('no console errors', errors.length === 0, errors.join('; '));
    check('headline reads from the data', /^3 of 3 focus slots in use\. 0 shipped so far, and the first ship is forecast for \w+ \d+ \(.+\)\.$/.test((await page.textContent('[data-testid=headline]')).trim()));
    check('six tiles', (await page.$$('[data-kpi]')).length === 6);
    check('tile order', JSON.stringify(await page.$$eval('[data-kpi]', (n) => n.map((x) => x.getAttribute('data-kpi')))) === JSON.stringify(['shipped', 'progress', 'next-ship', 'commits', 'health', 'attention']));
    check('highlights present', (await page.$$('[data-insight]')).length >= 5);
    check('table shows the six tracked projects', (await order(page)).length === 6);
    check('sidebar lists three focus projects', (await page.$$('[data-focus-item]')).length === 3);
    check('sidebar shows Notion connected', (await page.textContent('[data-testid=notion-state]')).includes('Notion connected'));
    check('no banner when connected', (await page.$$('[data-banner]')).length === 0);
    const tops = await page.$$eval('[data-kpi]', (n) => n.map((x) => Math.round(x.getBoundingClientRect().top)));
    check('the six tiles share one row on a wide window', new Set(tops).size === 1, tops.join(','));
    const lines = await page.$$eval('tbody tr', (rs) => rs.map((r) => {
      const range = document.createRange();
      range.selectNodeContents(r.children[5]);
      return new Set([...range.getClientRects()].filter((q) => q.height > 0).map((q) => Math.round(q.top))).size;
    }));
    check('complexity stays on one line in every row', lines.every((n) => n === 1), lines.join(','));
    check('the sidebar shows the folder path from its first character', (await page.textContent('.sidefoot .path')).startsWith('/Users/'));
    check('page does not scroll sideways', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    // sorting
    const byFinish = await order(page);
    await page.click('th button:has-text("Project")');
    const byName = await order(page);
    check('sorting by name changes the order', JSON.stringify(byName) !== JSON.stringify(byFinish));
    check('name sort is ascending by title', JSON.stringify(byName) === JSON.stringify(['sdlc-ai', 'ai-newsletter', 'Buddy Recomp', 'dark-factory', 'chicken-friends', 'whisper-safe']), byName.join(','));
    check('header reports ascending', (await page.getAttribute('th:has(button:has-text("Project"))', 'aria-sort')) === 'ascending');
    await page.click('th button:has-text("Project")');
    check('second click reverses', JSON.stringify(await order(page)) === JSON.stringify([...byName].reverse()));
    await page.click('th button:has-text("In stage")');
    const ages = (await page.$$eval('tbody tr', (rs) => rs.map((r) => r.children[6].textContent))).map((t) => parseInt(t, 10));
    check('sorting by time in stage puts the oldest first', ages.length === 6 && ages.every((a, i) => i === 0 || ages[i - 1] >= a), ages.join(','));

    // selection and navigation
    await page.click('tbody tr[data-project="whisper-safe"]');
    check('clicking a non-focus row selects it without leaving', (await page.getAttribute('tbody tr[data-project="whisper-safe"]', 'aria-selected')) === 'true' && (await page.getAttribute('.content', 'data-route')) === 'overview');
    await page.click('tbody tr[data-project="dark-factory"]');
    check('clicking a focus row opens its deep dive', (await page.getAttribute('.content', 'data-route')) === 'project');
    check('toolbar names the project', (await page.textContent('.toolbar .ttl b')) === 'Dark Factory');
    check('sidebar highlights the open project', (await page.getAttribute('[data-focus-item="dark-factory"]', 'aria-current')) === 'page');
    await page.click('.item:has-text("Overview")');
    check('Overview returns', (await page.getAttribute('.content', 'data-route')) === 'overview');
    await page.focus('tbody tr[data-project="ai-newsletter"]');
    await page.keyboard.press('Enter');
    check('Enter opens a focus project from the keyboard', (await page.getAttribute('.content', 'data-route')) === 'project');
    await page.click('.item:has-text("Overview")');

    // toolbar
    await page.click('.seg button:has-text("4 weeks")');
    check('range switch updates', (await page.getAttribute('.seg button:has-text("4 weeks")', 'aria-pressed')) === 'true');
    await page.click('[aria-label="Rescan folders"]');
    check('rescan calls the main process', (await page.evaluate(() => window.__calls)).includes('startScan'));
    await page.click('[aria-label="Switch between light and dark"]');
    check('appearance toggle asks for dark while light', JSON.stringify((await page.evaluate(() => window.__calls)).at(-1)) === JSON.stringify(['saveSettings', { appearance: 'dark' }]));
    await page.click('.item:has-text("Weekly review")');
    check('unbuilt screens say which week builds them', (await page.textContent('[data-placeholder="review"]')).includes('Week 7'));
  } else {
    await page.click('[aria-label="Switch between light and dark"]');
    check('appearance toggle asks for light while dark', JSON.stringify((await page.evaluate(() => window.__calls)).at(-1)) === JSON.stringify(['saveSettings', { appearance: 'light' }]));
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.main')).backgroundColor);
    check('dark mode uses dark surfaces', bg === 'rgb(28, 28, 30)', bg);
  }
  await page.close();
}

// ----- states
{
  const { page } = await load('untracked', 'light', { width: 1280, height: 900 });
  await page.screenshot({ path: join(shots, 'no-notion.png') });
  check('without Notion: banner explains how to connect', (await page.textContent('[data-banner]')).includes('NOTION_TOKEN'));
  check('without Notion: headline asks to connect', (await page.textContent('[data-testid=headline]')).includes('Connect Notion'));
  check('without Notion: the portfolio says nothing is tracked', (await page.getAttribute('[data-state=no-tracked]', 'data-state')) === 'no-tracked');
  const stacked = await page.$eval('[data-state=no-tracked]', (el) => { const [a, b] = [...el.children].map((c) => c.getBoundingClientRect()); return a.bottom <= b.top + 1; });
  check('without Notion: the empty message stacks its heading above its explanation', stacked);
  check('without Notion: Notion tiles show dashes', (await page.$$eval('[data-kpi="progress"] .v', (n) => n[0].textContent)) === '–');
  await page.close();
}
{
  const { page } = await load('empty', 'light', { width: 1280, height: 700 });
  await page.screenshot({ path: join(shots, 'empty.png') });
  check('empty folder: says so and names the folder', (await page.textContent('[data-state=empty]')).includes('/Users/gonzalo/Development'));
  await page.close();
}
{
  const { page } = await load('scanning', 'light', { width: 1280, height: 700 });
  check('while scanning: the sidebar says so', (await page.textContent('.sidefoot')).includes('Scanning…'));
  check('while scanning: rescan is disabled and spins', (await page.isDisabled('[aria-label="Rescan folders"]')) && (await page.$$('.spin')).length === 1);
  check('while scanning: projects found so far are shown', (await order(page)).length === 6);
  await page.close();
}
{
  const { page } = await load('scanning-empty', 'light', { width: 1280, height: 700 });
  await page.screenshot({ path: join(shots, 'scanning-empty.png') });
  check('first scan with nothing yet: names the folder being scanned', (await page.textContent('[data-state=scanning]')).includes('Scanning /Users/gonzalo/Development'));
  await page.close();
}
{
  const { page } = await load('full', 'light', { width: 900, height: 800 });
  await page.screenshot({ path: join(shots, 'narrow.png') });
  const narrowTops = await page.$$eval('[data-kpi]', (n) => n.map((x) => Math.round(x.getBoundingClientRect().top)));
  check('narrow window: tiles form two even rows of three', JSON.stringify([...new Set(narrowTops)].map((t) => narrowTops.filter((x) => x === t).length)) === JSON.stringify([3, 3]), narrowTops.join(','));
  check('narrow window: no page-level sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  check('narrow window: the table scrolls inside its own box', await page.evaluate(() => { const t = document.querySelector('.tw'); return t.scrollWidth >= t.clientWidth; }));
  await page.close();
}

await browser.close();
server.close();
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length} of ${results.length} checks passed. Screenshots in ${shots}`);
process.exit(bad.length ? 1 : 0);

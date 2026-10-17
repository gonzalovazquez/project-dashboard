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
    const rec = (n) => async (...a) => { window.__calls.push([n, ...a]); return { ok: true }; };
    const ok = async () => ({ ok: true });
    window.dashboard = {
      getSnapshot: async () => s, startScan: async () => { window.__calls.push('startScan'); },
      onProjectUpdate: () => () => {}, saveSettings: async (p) => { window.__calls.push(['saveSettings', p]); return { ok: true }; },
      getSettings: async () => s.settings, setNextAction: rec('setNextAction'), setCriterion: rec('setCriterion'), promote: ok, park: ok, kill: ok, unpark: ok, markShipped: rec('markShipped'), setToken: ok, openLink: rec('openLink'),
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
    const lines = await page.$$eval('tbody tr[data-project]', (rs) => rs.map((r) => {
      const range = document.createRange();
      range.selectNodeContents(r.children[5]);
      return new Set([...range.getClientRects()].filter((q) => q.height > 0).map((q) => Math.round(q.top))).size;
    }));
    check('complexity stays on one line in every row', lines.every((n) => n === 1), lines.join(','));
    check('the sidebar shows the folder path from its first character', (await page.textContent('.sidefoot .path')).startsWith('/Users/'));
    check('page does not scroll sideways', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    // ----- charts
    const charts = await page.$$eval('[data-chart]', (n) => n.map((x) => x.getAttribute('data-chart')));
    check('all seven charts are on the page', JSON.stringify(charts.sort()) === JSON.stringify(['activity', 'age', 'commits', 'forecast', 'scatter', 'stages', 'tech']), charts.join(','));
    const legends = await page.$$eval('[data-chart]', (n) => Object.fromEntries(n.map((x) => [x.getAttribute('data-chart'), x.querySelectorAll('.legend .lg').length])));
    check('stacked and scatter charts have a legend', legends.commits === 4 && legends.stages === 4 && legends.scatter === 4, JSON.stringify(legends));
    check('every chart has a table view', (await page.$$('[data-chart] details.tview table')).length === 7);
    const tableRows = await page.$$eval('[data-chart=commits] details.tview tbody tr', (r) => r.length);
    check('the commits table has one row per week', tableRows === 12, String(tableRows));
    check('the forecast shows one dot per focus project', (await page.$$('[data-chart=forecast] svg circle:not(.hit)')).length === 3);
    check('the age chart has a bar and a review tick for each active project', (await page.$$('[data-chart=age] .review-tick')).length === 6);
    check('the stage chart draws recorded weeks without a sparse note', (await page.$$('[data-chart=stages] g.col')).length >= 5 && (await page.$$('[data-note=history]')).length === 0);

    const legendGeo = await page.evaluate(() => [...document.querySelectorAll('[data-chart]')].flatMap((c) => {
      const items = [...c.querySelectorAll('.legend .lg')].map((i) => i.getBoundingClientRect());
      const next = c.querySelector('details.tview summary')?.getBoundingClientRect();
      const bad = [];
      items.forEach((a, i) => { if (a.width < 30) bad.push(`${c.dataset.chart}: item ${i} collapsed to ${Math.round(a.width)}px`); items.slice(i + 1).forEach((b, j) => { if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) bad.push(`${c.dataset.chart}: items ${i} and ${i + j + 1} overlap`); }); });
      if (next && items.length && Math.max(...items.map((i) => i.bottom)) > next.top + 1) bad.push(`${c.dataset.chart}: legend runs into the table link`);
      return bad;
    }));
    check('legends are laid out cleanly in every chart', legendGeo.length === 0, legendGeo.join('; '));
    const tileTops = await page.$$eval('[data-kpi] .v', (n) => n.map((x) => Math.round(x.getBoundingClientRect().top)));
    check('all tile values line up', new Set(tileTops).size === 1, tileTops.join(','));
    const fullNames = await page.$$eval('[data-chart=commits] svg text', (n) => n.map((t) => t.textContent));
    check('direct labels on the commits chart are readable, not cut to a few letters', fullNames.some((t) => t === 'Dark Factory') && fullNames.some((t) => /^AI Newsletter/.test(t)), fullNames.filter((t) => /…/.test(t)).join(','));
    const radii = await page.$$eval('[data-chart=scatter] [data-bubble]', (g) => g.map((x) => parseFloat(x.querySelector('circle:not(.hit)').getAttribute('r'))));
    check('bigger bubbles are drawn first so small ones stay on top', radii.every((r, i) => i === 0 || radii[i - 1] >= r), radii.join(','));

    // validated colors reach the screen
    const colors = await page.evaluate(() => ['--series-1', '--series-2', '--series-3', '--stage-0', '--stage-3'].map((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()));
    check('light chart colors are the validated ones', JSON.stringify(colors) === JSON.stringify(['#2a78d6', '#eb6834', '#1baf7a', '#86b6ef', '#1c5cab']), colors.join(','));
    const painted = await page.$$eval('[data-chart=commits] svg g.col > path, [data-chart=commits] svg g.col > rect:not(.hit)', (n) => new Set(n.map((x) => getComputedStyle(x).fill)).size);
    check('commit segments use four distinct fills', painted === 4, String(painted));

    // tooltips: pointer and keyboard
    await page.hover('[data-chart=commits] .hit >> nth=11');
    check('hovering a week shows a tooltip with every series and a total', await page.isVisible('.tip') && (await page.textContent('.tip')).includes('Total') && (await page.textContent('.tip')).includes('Week ending'));
    await page.mouse.move(5, 5);
    check('the tooltip goes away', !(await page.isVisible('.tip').catch(() => false)));
    await page.focus('[data-chart=scatter] [data-bubble="Buddy Recomp"] .hit');
    check('keyboard focus on a bubble shows the same details', (await page.textContent('.tip')).includes('Complexity') && (await page.textContent('.tip')).includes('Buddy Recomp'));
    await page.evaluate(() => document.activeElement.blur());

    // labels never collide or leave their chart
    const clash = await page.evaluate(() => {
      const svg = document.querySelector('[data-chart=scatter] svg');
      const boxes = [...svg.querySelectorAll('text.lbl')].map((t) => ({ id: t.getAttribute('data-label'), r: t.getBoundingClientRect() }));
      const circles = [...svg.querySelectorAll('[data-bubble] circle:not(.hit)')].map((c) => c.getBoundingClientRect());
      const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const out = [];
      boxes.forEach((a, i) => { boxes.slice(i + 1).forEach((b) => { if (hit(a.r, b.r)) out.push(`${a.id}/${b.id}`); }); circles.forEach((c) => { const pad = 1; if (a.r.left < c.right - pad && c.left + pad < a.r.right && a.r.top < c.bottom - pad && c.top + pad < a.r.bottom) out.push(`${a.id}/bubble`); }); });
      return { n: boxes.length, out };
    });
    check('scatter labels do not overlap each other or any bubble', clash.n === 6 && clash.out.length === 0, JSON.stringify(clash));
    const clipped = await page.evaluate(() => [...document.querySelectorAll('svg.chart')].flatMap((svg) => { const s = svg.getBoundingClientRect(); return [...svg.querySelectorAll('text')].filter((t) => { const r = t.getBoundingClientRect(); return r.width > 0 && (r.left < s.left - 1 || r.right > s.right + 1); }).map((t) => t.textContent); }));
    check('no chart text is clipped by its chart', clipped.length === 0, clipped.join(' | '));

    // the range switch drives the time series charts
    await page.click('.seg button:has-text("4 weeks")');
    check('4 weeks shows four commit columns', (await page.$$('[data-chart=commits] g.col')).length === 4);
    check('the commits table follows the range', (await page.$$('[data-chart=commits] details.tview tbody tr')).length === 4);
    check('the forecast does not change with the range', (await page.$$('[data-chart=forecast] svg circle:not(.hit)')).length === 3);
    await page.click('.seg button:has-text("12 weeks")');
    check('12 weeks restores twelve', (await page.$$('[data-chart=commits] g.col')).length === 12);

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
    const ages = (await page.$$eval('tbody tr[data-project]', (rs) => rs.map((r) => r.children[6].textContent))).map((t) => parseInt(t, 10));
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
    await page.click('.seg button:has-text("12 weeks")');
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
    const dark = await page.evaluate(() => ['--series-1', '--series-2', '--series-3', '--stage-0', '--stage-3'].map((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()));
    check('dark chart colors are the validated ones', JSON.stringify(dark) === JSON.stringify(['#3987e5', '#d95926', '#199e70', '#1c5cab', '#86b6ef']), dark.join(','));
  }
  await page.close();
}


// ----- deep dive
for (const scheme of ['light', 'dark']) {
  const { page, errors } = await load('full', scheme);
  await page.click('tbody tr[data-project="dark-factory"]');
  await page.waitForSelector('[data-testid=dd-title]');
  await page.screenshot({ path: join(shots, `deepdive-${scheme}.png`), fullPage: true });
  if (scheme === 'light') {
    check('deep dive has no console errors', errors.length === 0, errors.join('; '));
    check('deep dive shows six tiles', (await page.$$('.kpi')).length === 6);
    for (const id of ['burnup', 'heatmap', 'weekly']) check(`deep dive draws the ${id} chart`, (await page.$$(`[data-chart=${id}] svg.chart`)).length === 1);
    check('health panel lists its four parts', (await page.$$('[data-chart=health] .hrow')).length === 4);
    check('burnup draws a projection and a forecast band', (await page.$$('[data-projection]')).length === 1);
    const crit = await page.$$('[data-section=criteria] input[type=checkbox]');
    check('criteria render as checkboxes', crit.length > 0);
    const before = await page.evaluate(() => window.__calls.length);
    await crit[0].click();
    const call = await page.evaluate(() => window.__calls.at(-1));
    check('ticking a criterion calls the bridge with the block id', call[0] === 'setCriterion' && call[1] === 'dark-factory' && typeof call[2] === 'string' && typeof call[3] === 'boolean', JSON.stringify(call));
    await page.fill('#next-action', 'Wire the export button');
    await page.click('.next button');
    check('saving the next action calls the bridge', JSON.stringify(await page.evaluate(() => window.__calls.at(-1))) === JSON.stringify(['setNextAction', 'dark-factory', 'Wire the export button']));
    check('Mark shipped is disabled while criteria are open', await page.isDisabled('[data-action=ship]'));
    await page.click('button:has-text("Folder")');
    check('Folder button opens the folder', JSON.stringify(await page.evaluate(() => window.__calls.at(-1))) === JSON.stringify(['openLink', 'dark-factory', 'folder']));
    const cell = await page.$('svg.heat rect[data-level]');
    const box = await cell.boundingBox();
    check('heatmap cells are at least 14px', box.width >= 14 && box.height >= 14);
    const hits = await page.$$eval('[data-chart=burnup] .hit', (rs) => rs.map((r) => r.getBoundingClientRect().width));
    check('burnup hit areas are at least 24px wide', hits.length === 12 && hits.every((w) => w >= 23.5), hits.join(','));
    await page.hover('[data-chart=burnup] .hit:nth-of-type(6)');
    check('hovering a burnup point shows a tooltip', (await page.$$('.tip')).length === 1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check('deep dive does not scroll sideways', !overflow);
  }
  await page.close();
}
{
  const { page } = await load('full', 'light', { width: 1280, height: 1500 });
  const name = await page.evaluate(async () => (await window.dashboard.getSnapshot()).projects.find((p) => p.notion?.focus && p.notion.criteria.length && p.notion.criteria.every((c) => c.done))?.name);
  if (name) { await page.click(`tbody tr[data-project="${name}"]`); check('Mark shipped is enabled when every criterion is done', !(await page.isDisabled('[data-action=ship]'))); }
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
  const { page } = await load('sparse', 'light', { width: 1280, height: 1500 });
  await page.screenshot({ path: join(shots, 'sparse-history.png') });
  check('one day of history: says when it starts and draws that day', (await page.textContent('[data-note=history]')).includes('History starts') && (await page.$$('[data-chart=stages] g.col')).length === 1);
  await page.close();
}
{
  const { page } = await load('untracked', 'light', { width: 1280, height: 1500 });
  check('without Notion: the stage chart explains it needs Notion', (await page.textContent('[data-note=history]')).includes('Connect Notion'));
  check('without Notion: the forecast says there is nothing to forecast', (await page.getAttribute('[data-state=no-forecast]', 'data-state')) === 'no-forecast');
  check('without Notion: commits and technology still draw', (await page.$$('[data-chart=commits] g.col')).length === 12 && (await page.$$('[data-chart=tech] .brow')).length > 0);
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
  const spill = await page.evaluate(() => [...document.querySelectorAll('svg.chart')].filter((svg) => svg.getBoundingClientRect().right > svg.closest('.card').getBoundingClientRect().right + 1).length);
  check('narrow window: every chart fits inside its card', spill === 0, String(spill));
  const clash2 = await page.evaluate(() => { const svg = document.querySelector('[data-chart=scatter] svg'); const b = [...svg.querySelectorAll('text.lbl')].map((t) => t.getBoundingClientRect()); const hit = (a, c) => a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom; let n = 0; b.forEach((a, i) => b.slice(i + 1).forEach((c) => { if (hit(a, c)) n++; })); return n; });
  check('narrow window: scatter labels still do not overlap', clash2 === 0, String(clash2));
  check('narrow window: no page-level sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  check('narrow window: the table scrolls inside its own box', await page.evaluate(() => { const t = document.querySelector('.tw'); return t.scrollWidth >= t.clientWidth; }));
  await page.close();
}

await browser.close();
server.close();
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length} of ${results.length} checks passed. Screenshots in ${shots}`);
process.exit(bad.length ? 1 : 0);

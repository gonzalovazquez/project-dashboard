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

const load = async (variant, scheme = 'light', size = { width: 1280, height: 1500 }, patch = (s) => s) => {
  const snap = patch(JSON.parse(await readFile(`out/sample-${variant}.json`, 'utf8')));
  const page = await browser.newPage({ viewport: size, colorScheme: scheme });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  // A browser asks for a favicon; the packaged app loads from disk and never does. Anything else that fails is a real problem.
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`${r.status()} ${r.url()}`); });
  await page.addInitScript((s) => {
    window.__calls = [];
    const listeners = [];
    // Like the main process, settings changes are announced so the interface never shows stale values.
    const meta = () => listeners.forEach((l) => l({ kind: 'meta', settings: s.settings, unlinkedPages: s.unlinkedPages }));
    const rec = (n, after) => async (...a) => { window.__calls.push([n, ...a]); after?.(...a); return { ok: true }; };
    const ok = async () => ({ ok: true });
    window.dashboard = {
      getSnapshot: async () => s, startScan: async () => { window.__calls.push('startScan'); },
      onProjectUpdate: (l) => { listeners.push(l); return () => {}; },
      saveSettings: async (p) => { window.__calls.push(['saveSettings', p]); Object.assign(s.settings, p); meta(); return { ok: true }; },
      getSettings: async () => s.settings, setNextAction: rec('setNextAction'), setCriterion: rec('setCriterion'),
      promote: rec('promote'), park: rec('park'), kill: rec('kill'), unpark: rec('unpark'), addToNotion: rec('addToNotion'),
      groupFolder: rec('groupFolder'), ungroupFolder: rec('ungroupFolder'),
      ignoreFolder: rec('ignoreFolder', (name, ignored) => { s.settings.ignored = ignored ? [...new Set([...s.settings.ignored, name])] : s.settings.ignored.filter((n) => n !== name); meta(); }),
      linkFolder: rec('linkFolder'), markShipped: rec('markShipped'),
      applyReview: async (plan) => { window.__calls.push(['applyReview', plan]); return { ok: true, value: { changed: plan.decisions.length, notesWritten: plan.decisions.length, notesFailed: [] } }; },
      setToken: rec('setToken', (t) => { s.settings.tokenSource = t ? 'keychain' : 'none'; meta(); }),
      chooseFolder: async () => { window.__calls.push(['chooseFolder']); return { ok: true, value: '/Users/gonzalo/Code' }; }, openLink: rec('openLink'),
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
    check('weekly review opens', (await page.$$('[data-review-step="1"]')).length === 1);
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

// ----- week 6: library, inbox, parked, shipped, sheets
for (const scheme of ['light', 'dark']) {
  const { page, errors } = await load('full', scheme);
  const lastCall = () => page.evaluate(() => window.__calls.at(-1));
  await page.click('.item:has-text("All projects")');
  await page.waitForSelector('[data-view=library]');
  await page.screenshot({ path: join(shots, `library-${scheme}.png`), fullPage: true });
  if (scheme === 'light') {
    const total = (await page.$$('[data-view=library] tbody tr')).length;
    check('library lists every folder', total === 21, String(total));
    await page.selectOption('[data-filter=state]', 'untracked');
    const untracked = (await page.$$('[data-view=library] tbody tr')).length;
    check('state filter narrows the list', untracked > 0 && untracked < total && (await page.textContent('[data-testid=lib-count]')).startsWith(`${untracked} of 21`));
    await page.selectOption('[data-filter=technology]', { index: 1 });
    const both = (await page.$$('[data-view=library] tbody tr')).length;
    check('filters combine', both <= untracked);
    await page.click('[data-action=clear-filters]');
    check('clear filters restores the list', (await page.$$('[data-view=library] tbody tr')).length === 21 && (await page.$('[data-action=clear-filters]')) === null);
    await page.fill('[aria-label="Search projects"]', 'zzzzqq');
    check('no match says so', (await page.getAttribute('[data-state=no-match]', 'data-state')) === 'no-match');
    await page.fill('[aria-label="Search projects"]', 'dark');
    check('search finds a project', (await page.$$('[data-view=library] tbody tr[data-project="dark-factory"]')).length === 1);
    await page.fill('[aria-label="Search projects"]', '');

    // quick look
    await page.click('tbody tr[data-project="dark-factory"]');
    check('clicking a row opens a quick look', (await page.$$('[data-sheet=quick-look]')).length === 1);
    check('quick look of a focus project links to its deep dive', (await page.$$('[data-sheet=quick-look] button:has-text("Open deep dive")')).length === 1);
    await page.keyboard.press('Escape');
    check('Escape closes the sheet', (await page.$$('[data-sheet]')).length === 0);
    check('focus returns to the row', await page.evaluate(() => document.activeElement?.getAttribute('data-project') === 'dark-factory'));
    await page.click('tbody tr[data-project="dark-factory"]');
    await page.click('button:has-text("Open deep dive")');
    check('Open deep dive navigates', (await page.getAttribute('.content', 'data-route')) === 'project');

    // park from the deep dive
    await page.click('[data-action=park]');
    check('park opens a sheet', (await page.$$('[data-sheet=park]')).length === 1);
    check('park needs a reason', await page.isDisabled('[data-sheet=park] [data-confirm]'));
    await page.fill('[data-field=reason]', '  Waiting on API access ');
    const revisit = await page.inputValue('[data-field=revisit]');
    check('revisit date defaults to a date', /^\d{4}-\d{2}-\d{2}$/.test(revisit));
    await page.click('[data-sheet=park] [data-confirm]');
    const c = await lastCall();
    check('park calls the bridge with the trimmed reason and the date', c[0] === 'park' && c[1] === 'dark-factory' && c[2] === 'Waiting on API access' && c[3] === revisit, JSON.stringify(c));
    check('the sheet closes after a successful park', (await page.$$('[data-sheet]')).length === 0);
    await page.click('[data-action=kill]');
    await page.screenshot({ path: join(shots, 'kill-sheet.png') });
    await page.keyboard.press('Escape');
    check('cancelling kill calls nothing', (await lastCall())[0] === 'park');
    await page.click('[data-action=kill]');
    await page.click('[data-sheet=kill] [data-confirm]');
    check('kill calls the bridge', JSON.stringify(await lastCall()) === JSON.stringify(['kill', 'dark-factory']));

    // swap in a project when focus is full
    await page.click('.item:has-text("All projects")');
    await page.fill('[aria-label="Search projects"]', 'flockchat');
    await page.click('tbody tr:first-child');
    await page.click('[data-sheet=quick-look] [data-action=promote]');
    check('promote with full focus asks which project to park', (await page.$$('[data-sheet=promote] select[data-field=park]')).length === 1);
    check('swap needs a reason', await page.isDisabled('[data-sheet=promote] [data-confirm]'));
    await page.screenshot({ path: join(shots, 'swap-sheet.png') });
    await page.fill('[data-sheet=promote] [data-field=reason]', 'Lost momentum');
    await page.click('[data-sheet=promote] [data-confirm]');
    const pc = await lastCall();
    check('swap sends who to park, why and when', pc[0] === 'promote' && typeof pc[1] === 'string' && pc[2] && pc[2].reason === 'Lost momentum' && typeof pc[2].parkName === 'string' && /^\d{4}/.test(pc[2].revisitOn), JSON.stringify(pc));
  }
  await page.close();
}
{
  const { page, errors } = await load('full', 'light');
  await page.click('.item:has-text("Inbox")');
  await page.waitForSelector('[data-view=inbox]');
  await page.screenshot({ path: join(shots, 'inbox.png'), fullPage: true });
  const rows = await page.$$('[data-view=inbox] tbody tr');
  check('inbox lists folders without a page', rows.length > 0);
  check('ignored folders are listed apart', (await page.$$('[data-view=ignored] tbody tr')).length === 1);
  const name = await rows[0].getAttribute('data-inbox');
  await page.click(`[data-inbox="${name}"] [data-action=add]`);
  check('Add to Notion calls the bridge', JSON.stringify(await page.evaluate(() => window.__calls.at(-1))) === JSON.stringify(['addToNotion', name]));
  await page.selectOption(`[data-inbox="${name}"] [data-action=link]`, 'u1');
  check('linking sends the folder and page id', JSON.stringify(await page.evaluate(() => window.__calls.at(-1))) === JSON.stringify(['linkFolder', name, 'u1']));
  await page.click(`[data-inbox="${name}"] [data-action=ignore]`);
  check('Ignore calls the bridge', JSON.stringify(await page.evaluate(() => window.__calls.at(-1))) === JSON.stringify(['ignoreFolder', name, true]));
  check('an ignored folder moves to the ignored list', (await page.$$(`[data-view=inbox] [data-inbox="${name}"]`)).length === 0 && (await page.$$(`[data-view=ignored] [data-inbox="${name}"]`)).length === 1);
  await page.click('[data-view=ignored] [data-action=unignore]');
  check('Restore calls the bridge', (await page.evaluate(() => window.__calls.at(-1)))[2] === false);
  check('sidebar inbox count excludes ignored folders', Number(await page.textContent('.item:has-text("Inbox") .c')) === rows.length);
  await page.click('.item:has-text("Parked")');
  await page.waitForSelector('[data-view=parked]');
  await page.screenshot({ path: join(shots, 'parked.png'), fullPage: true });
  check('parked shows a reason', (await page.textContent('[data-view=parked]')).length > 0);
  await page.click('.item:has-text("Shipped")');
  await page.waitForSelector('[data-view=shipped]');
  check('shipped screen renders its list or its empty state', (await page.$$('[data-shipped], [data-state=shipped-empty]')).length > 0);
  check('week 6 screens have no console errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// ----- week 7: weekly review
{
  const { page, errors } = await load('full', 'light');
  const lastCall = () => page.evaluate(() => window.__calls.at(-1));
  check('a review that was never done shows the due banner', (await page.$$('[data-review-due]')).length === 1);
  await page.click('[data-action=start-review]');
  await page.waitForSelector('[data-review-step="1"]');
  await page.screenshot({ path: join(shots, 'review-1.png'), fullPage: true });
  check('step 1 lists the three focus projects', (await page.$$('[data-review-step="1"] tbody tr')).length === 3);
  check('the due banner is not shown on the review itself', (await page.$$('[data-review-due]')).length === 0);
  await page.selectOption('[data-field=day]', '2');
  check('changing the reminder day saves it', JSON.stringify(await lastCall()) === JSON.stringify(['saveSettings', { reviewDay: 2 }]));

  await page.click('[data-action=next]');
  const stalled = await page.$$('[data-stalled]');
  check('step 2 lists stalled projects', stalled.length > 0);
  await page.screenshot({ path: join(shots, 'review-2.png'), fullPage: true });
  const names = await page.$$eval('[data-stalled]', (els) => els.map((e) => e.getAttribute('data-stalled')));
  await page.click(`[data-stalled="${names[0]}"] [data-choice=park]`);
  check('choosing Park asks for a reason and a date', (await page.$$(`[data-park-fields="${names[0]}"]`)).length === 1);
  await page.click('[data-step="4"]');
  check('Apply is disabled while decisions are missing', await page.isDisabled('[data-action=apply-review]'));
  const blockers = await page.textContent('[data-testid=blockers]');
  check('the blockers say what is missing', /Say why/.test(blockers) || /Decide what to do/.test(blockers), blockers);
  await page.click('[data-step="2"]');
  await page.fill(`[data-park-fields="${names[0]}"] [data-field=reason]`, 'No time this month');
  for (const n of names.slice(1)) await page.click(`[data-stalled="${n}"] [data-choice=keep]`);

  await page.click('[data-step="3"]');
  await page.screenshot({ path: join(shots, 'review-3.png'), fullPage: true });
  const cand = await page.$$eval('[data-candidate]', (els) => els.map((e) => ({ name: e.getAttribute('data-candidate'), on: e.querySelector('input').checked })));
  const slots = async () => (await page.textContent('[data-testid=slots]')).trim();
  const on = cand.filter((c) => c.on).length;
  check('step 3 shows used slots', (await slots()) === `${on} of 3 slots`, await slots());
  const off = cand.find((c) => !c.on);
  if (on === 3) {
    await page.check(`[data-candidate="${off.name}"] input`).catch(() => {});
    check('a full focus refuses another project', (await page.$$('[data-banner=blocked]')).length === 1);
  }
  const wanted = cand.find((c) => !c.on && c.name !== names[0]);
  if ((await slots()).startsWith('3')) {
    const drop = cand.find((c) => c.on && c.name !== names[0]);
    await page.uncheck(`[data-candidate="${drop.name}"] input`);
    check('removing a focus project parks it and asks why', (await page.$$(`[data-park-fields="${drop.name}"]`)).length === 1);
    await page.fill(`[data-park-fields="${drop.name}"] [data-field=reason]`, 'Making room');
  }
  await page.check(`[data-candidate="${wanted.name}"] input`);
  check('the swapped-in project takes the slot', (await slots()) === '3 of 3 slots', await slots());

  await page.click('[data-action=next]');
  await page.screenshot({ path: join(shots, 'review-4.png'), fullPage: true });
  const missing = await page.$$eval('[data-field=next]', (els) => els.filter((e) => !e.value).length);
  check('Apply is disabled exactly while a focus project lacks a next action', (await page.isDisabled('[data-action=apply-review]')) === (missing > 0), String(missing));
  for (const el of await page.$$('[data-field=next]')) if (!(await el.inputValue())) await el.fill('Do the first small thing');
  check('Apply is enabled once everything is decided', !(await page.isDisabled('[data-action=apply-review]')), (await page.textContent('[data-testid=blockers]').catch(() => '')) ?? '');
  const lines = await page.$$eval('[data-testid=plan] li', (els) => els.map((e) => e.textContent));
  check('the plan reads in plain words', lines.some((l) => l.startsWith('Park ')) && lines.some((l) => l.startsWith('Move ')), lines.join(' | '));
  await page.click('[data-action=apply-review]');
  const call = await lastCall();
  check('Apply sends one plan with every decision', call[0] === 'applyReview' && call[1].decisions.length === lines.length, JSON.stringify(call));
  const park = call[1].decisions.find((d) => d.action === 'park' && d.name === names[0]);
  check('the plan carries the reason and date', park && park.reason === 'No time this month' && /^\d{4}-\d{2}-\d{2}$/.test(park.revisitOn), JSON.stringify(park));
  await page.waitForSelector('[data-view=review-done]');
  await page.screenshot({ path: join(shots, 'review-done.png') });
  check('a finished review says what changed', /changed in Notion/.test(await page.textContent('[data-view=review-done]')));
  check('week 7 has no console errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// ----- week 8: setup, settings, failure states
{
  const { page, errors } = await load('firstrun');
  const calls = () => page.evaluate(() => window.__calls);
  check('first launch lands on setup', (await page.$$('[data-view=welcome]')).length === 1 && (await page.getAttribute('.content', 'data-route')) === 'settings');
  await page.screenshot({ path: join(shots, 'setup.png'), fullPage: true });
  check('setup says Notion is not connected', (await page.textContent('[data-testid=notion-line]')).includes('Not connected'));
  check('the token field hides what is typed', (await page.getAttribute('[data-field=token]', 'type')) === 'password');
  check('Connect is disabled until a token is typed', await page.isDisabled('[data-action=connect]'));
  await page.click('[data-action=choose-folder]');
  const c1 = await calls();
  check('Choose folder asks the main process, saves the folder and rescans', c1.some((c) => c[0] === 'chooseFolder') && c1.some((c) => c[0] === 'saveSettings' && c[1].developmentFolder === '/Users/gonzalo/Code') && c1.includes('startScan'), JSON.stringify(c1));
  await page.fill('[data-field=token]', '  secret_abc  ');
  await page.click('[data-action=connect]');
  const c2 = await calls();
  check('Connect sends the trimmed token and rescans', JSON.stringify(c2.filter((c) => c[0] === 'setToken')) === JSON.stringify([['setToken', 'secret_abc']]) && c2.at(-1) === 'startScan', JSON.stringify(c2.slice(-3)));
  check('the token is cleared from the field afterwards', (await page.inputValue('[data-field=token]')) === '');
  await page.click('[data-action=finish-setup]');
  check('finishing records it and opens the Overview', JSON.stringify((await calls()).filter((c) => c[0] === 'saveSettings').at(-1)) === JSON.stringify(['saveSettings', { onboarded: true }]) && (await page.getAttribute('.content', 'data-route')) === 'overview');
  check('setup has no console errors', errors.length === 0, errors.join('; '));
  await page.close();
}
{
  const { page, errors } = await load('full');
  await page.click('.item:has-text("Settings")');
  await page.waitForSelector('[data-section=notion]');
  await page.screenshot({ path: join(shots, 'settings.png'), fullPage: true });
  check('settings shows the connection', (await page.textContent('[data-testid=notion-line]')).includes('Connected'));
  check('settings has the reminder schedule', (await page.$$('[data-section=schedule]')).length === 1);
  await page.click('[data-appearance=dark]');
  check('appearance buttons save', JSON.stringify(await page.evaluate(() => window.__calls.at(-1))) === JSON.stringify(['saveSettings', { appearance: 'dark' }]));
  await page.click('[data-action=disconnect]');
  check('Disconnect clears the token', JSON.stringify(await page.evaluate(() => window.__calls.at(-2))) === JSON.stringify(['setToken', null]));
  check('settings has no console errors', errors.length === 0, errors.join('; '));
  await page.close();
}
{
  const env = await load('full', 'light', undefined, (s) => ({ ...s, settings: { ...s.settings, tokenSource: 'env' } }));
  await env.page.click('.item:has-text("Settings")');
  check('a token from the environment is explained, not editable', (await env.page.$$('[data-testid=token-env]')).length === 1 && (await env.page.$$('[data-field=token]')).length === 0);
  await env.page.close();
  const nosec = await load('untracked', 'light', undefined, (s) => ({ ...s, settings: { ...s.settings, onboarded: true, secureStorageAvailable: false } }));
  await nosec.page.click('.item:has-text("Settings")');
  check('without secure storage the field is replaced by an explanation', (await nosec.page.$$('[data-testid=no-secure-storage]')).length === 1 && (await nosec.page.$$('[data-field=token]')).length === 0);
  await nosec.page.close();
  const schema = await load('full', 'light', undefined, (s) => ({ ...s, notion: { state: 'schema-missing', message: 'The Notion database is missing properties the app needs.' } }));
  await schema.page.click('.item:has-text("Settings")');
  check('a missing schema says which command to run', (await schema.page.textContent('[data-testid=schema-help]')).includes('npm run notion:setup'));
  await schema.page.close();
}
{
  const { page, errors } = await load('broken');
  await page.screenshot({ path: join(shots, 'broken.png') });
  const banners = await page.$$eval('[data-banner]', (els) => els.map((e) => e.getAttribute('data-banner')));
  check('a failed scan and an unreachable Notion both show', banners.includes('scan') && banners.includes('notion'), banners.join());
  check('failure banners keep the last known data on screen', (await page.$$('tbody tr[data-project]')).length > 0);
  await page.click('[data-banner=notion] [data-banner-action=rescan]');
  check('Try again rescans', (await page.evaluate(() => window.__calls)).includes('startScan'));
  await page.click('[data-banner=scan] [data-banner-action=settings]');
  check('a missing folder banner opens settings', (await page.getAttribute('.content', 'data-route')) === 'settings');
  check('failure screens have no console errors', errors.length === 0, errors.join('; '));
  await page.close();
}
{
  const { page } = await load('crash');
  await page.waitForSelector('[data-state=crashed]', { timeout: 5000 }).catch(() => {});
  await page.screenshot({ path: join(shots, 'crash.png') });
  check('a screen that cannot draw shows a recovery screen, not a blank window', (await page.$$('[data-state=crashed]')).length === 1 && (await page.$$('[data-action=reload]')).length === 1);
  await page.close();
}

// ----- grouped folders
{
  const { page, errors } = await load('full', 'light', undefined, (s) => {
    const base = s.projects.find((p) => !p.notion);
    // Give the sample a TabSaver family: one tracked-looking primary folder and an API folder that should be offered for grouping.
    s.projects.push({ ...base, name: 'TabSaverX', path: '/dev/TabSaverX' }, { ...base, name: 'TabSaverX-API', path: '/dev/TabSaverX-API' });
    s.settings.groups = { 'dark-factory': ['legacy-folder'] };
    return s;
  });
  await page.click('.item:has-text("Inbox")');
  check('inbox suggests the product a folder belongs to', (await page.textContent('[data-inbox="TabSaverX-API"]')).includes('Looks like part of TabSaverX'));
  await page.click('[data-inbox="TabSaverX-API"] [data-action=group-suggested]');
  check('the suggestion groups the folder into that project', JSON.stringify(await page.evaluate(() => window.__calls.at(-1))) === JSON.stringify(['groupFolder', 'TabSaverX-API', 'TabSaverX']));
  await page.selectOption('[data-inbox="TabSaverX"] [data-action=group]', 'dark-factory');
  check('the group menu groups into any project', JSON.stringify(await page.evaluate(() => window.__calls.at(-1))) === JSON.stringify(['groupFolder', 'TabSaverX', 'dark-factory']));
  await page.click('.item:has-text("Settings")');
  check('settings lists grouped folders', (await page.$$('[data-group-member="legacy-folder"]')).length === 1);
  await page.click('[data-group-member="legacy-folder"] [data-action=ungroup]');
  check('Split out calls the bridge', JSON.stringify(await page.evaluate(() => window.__calls.at(-1))) === JSON.stringify(['ungroupFolder', 'legacy-folder']));
  check('grouping screens have no console errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// ----- states
{
  const { page } = await load('untracked', 'light', { width: 1280, height: 900 });
  await page.screenshot({ path: join(shots, 'no-notion.png') });
  check('without Notion: banner explains how to connect', (await page.textContent('[data-banner]')).includes('Notion is not connected'));
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

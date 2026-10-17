// Draws the app icon (a progress ring closing on a check mark) and writes build/icon.png at 1024px.
// electron-builder converts it to .icns for macOS. Run: node scripts/make-icon.mjs
import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5ac8fa"/><stop offset="1" stop-color="#0a64d6"/></linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="14" flood-color="#00234d" flood-opacity="0.35"/></filter>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#bg)" filter="url(#sh)"/>
  <circle cx="512" cy="512" r="250" fill="none" stroke="#ffffff" stroke-opacity="0.28" stroke-width="64"/>
  <circle cx="512" cy="512" r="250" fill="none" stroke="#ffffff" stroke-width="64" stroke-linecap="round" stroke-dasharray="1180 1571" transform="rotate(-90 512 512)"/>
  <path d="M424 520l62 62 118-132" fill="none" stroke="#ffffff" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
const dir = readdirSync(browsers).filter((d) => /^chromium-\d+$/.test(d)).sort().at(-1);
const executablePath = existsSync(join(browsers, dir, 'chrome-linux64/chrome')) ? join(browsers, dir, 'chrome-linux64/chrome') : join(browsers, dir, 'chrome-linux/chrome');
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
mkdirSync('build', { recursive: true });
await page.screenshot({ path: 'build/icon.png', omitBackground: true });
await browser.close();
console.log('wrote build/icon.png');

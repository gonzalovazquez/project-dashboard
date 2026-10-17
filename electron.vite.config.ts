import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

// The packaged app loads only its own files. The dev server needs inline scripts and a websocket for hot reload.
const PROD_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
const DEV_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:* http://localhost:*";
const csp = (): Plugin => ({
  name: 'dashboard-csp',
  transformIndexHtml: { order: 'pre', handler: (html, ctx) => html.replace('%CSP%', ctx.server ? DEV_CSP : PROD_CSP) },
});

export default defineConfig({
  main: { build: { outDir: 'out/main', rollupOptions: { input: { index: 'src/main/index.ts' } } } },
  // A sandboxed preload must be CommonJS even though the package is ESM.
  preload: { build: { outDir: 'out/preload', rollupOptions: { input: { index: 'src/preload/index.ts' }, output: { format: 'cjs', entryFileNames: '[name].cjs' } } } },
  renderer: { root: 'src/renderer', build: { outDir: 'out/renderer', rollupOptions: { input: 'src/renderer/index.html' } }, plugins: [react(), csp()] },
});

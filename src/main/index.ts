import { app, BrowserWindow, ipcMain, nativeTheme, safeStorage, session, shell } from 'electron';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHANNELS } from '../shared/ipc.js';
import { createFileCache } from './app/cache.js';
import { registerIpc } from './app/ipc.js';
import { TokenStore } from './app/secrets.js';
import { DashboardService } from './app/service.js';
import { createSettingsStore } from './app/settings.js';
import { isTrustedUrl } from './app/trust.js';
import { createNotionBackend } from './notion/backend.js';
import { scanRoot } from './scanner/scan.js';
import { runSmoke } from './smoke.js';

const here = dirname(fileURLToPath(import.meta.url));
const devUrl = process.env.ELECTRON_RENDERER_URL;
const smoke = process.env.DASHBOARD_SMOKE;

// A separate data folder keeps tests and experiments away from real settings and the real token.
if (process.env.DASHBOARD_HOME) app.setPath('userData', process.env.DASHBOARD_HOME);

const isDir = (p: string) => stat(p).then((s) => s.isDirectory(), () => false);

function createService(): DashboardService {
  const data = app.getPath('userData');
  return new DashboardService({
    scanFolders: (root, onProject, now) => scanRoot(root, { now, onProject }),
    notion: (token) => createNotionBackend(token),
    cache: createFileCache(join(data, 'snapshot.json')),
    settings: createSettingsStore(join(data, 'settings.json')),
    tokens: new TokenStore(join(data, 'token.bin'), {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (s) => safeStorage.encryptString(s),
      decrypt: (b) => safeStorage.decryptString(b),
    }),
    stageSnapshotPath: join(data, 'stage-snapshot.json'),
    folderExists: isDir,
    openExternal: async (url) => {
      if (!url.startsWith('https://')) throw new Error('Only https links can be opened.');
      await shell.openExternal(url);
    },
    showInFolder: (p) => shell.showItemInFolder(p),
    setAppearance: (a) => { nativeTheme.themeSource = a; },
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280, height: 840, minWidth: 900, minHeight: 600,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e20' : '#ffffff',
    // On a Mac the traffic lights sit over the sidebar and the sidebar picks up the native blur.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 17 }, vibrancy: 'sidebar' as const, visualEffectState: 'followWindow' as const } : {}),
    webPreferences: { preload: join(here, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  if (devUrl) void win.loadURL(devUrl); else void win.loadFile(join(here, '../renderer/index.html'));
  return win;
}

/** Only our own window may call the IPC handlers. */
const indexFileUrl = pathToFileURL(join(here, '../renderer/index.html')).href;
const trustedUrl = (url: string) => isTrustedUrl(url, { devUrl, indexFileUrl });

void app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  const service = createService();
  await service.init();
  registerIpc(ipcMain, service, {
    isTrusted: (e) => trustedUrl((e as { senderFrame?: { url: string } }).senderFrame?.url ?? ''),
    log: (m, err) => console.error(m, err),
  });
  const win = createWindow();
  service.onUpdate((u) => { if (!win.isDestroyed()) win.webContents.send(CHANNELS.update, u); });
  if (smoke) runSmoke(service, win, smoke);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

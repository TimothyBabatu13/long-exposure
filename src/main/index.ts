import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { bindSmartSpectraIpc } from '@smartspectra/node-sdk/main';

// ---------------------------------------------------------------------------
// Configuration: the API key comes from the environment or a local .env file.
// It is never bundled into the app.
// ---------------------------------------------------------------------------
function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trimStart().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = {
  ...loadEnvFile(join(app.getAppPath(), '.env')),
  ...loadEnvFile(join(app.getPath('userData'), '.env')),
  ...process.env,
};
const apiKey = env.SMARTSPECTRA_API_KEY ?? '';
const telemetry = env.SMARTSPECTRA_TELEMETRY === '1';

const devUrl = process.env.ELECTRON_RENDERER_URL;

function isOwnPage(url: string): boolean {
  return url.startsWith('file://') || (!!devUrl && url.startsWith(devUrl));
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: '#0d0c0a',
    title: 'Long Exposure',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // The smoke test runs unattended behind other windows.
      backgroundThrottling: !process.env.LE_SMOKE_DIR,
    },
  });

  bindSmartSpectraIpc(win);

  // Never navigate away from the studio or open new windows.
  win.webContents.on('will-navigate', (e, url) => {
    if (!isOwnPage(url)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'), process.env.LE_SMOKE_DIR ? { query: { smoke: '1' } } : undefined);
  return win;
}

app.whenReady().then(() => {
  // Grant only the camera, only to our own bundled page.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = details?.requestingUrl || wc?.getURL() || '';
    callback(permission === 'media' && isOwnPage(url));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) =>
    permission === 'media' && isOwnPage(origin),
  );

  const win = createWindow();

  // Studio Ledger, network side: every request the page makes is reported to
  // the renderer, and anything that is not our own page is blocked. Note that
  // the SDK's native library talks to Presage from the main process, below
  // this layer; that traffic is audited separately (docs/PRIVACY.md).
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const own = isOwnPage(details.url) || details.url.startsWith('devtools://') ||
      details.url.startsWith('data:') || details.url.startsWith('blob:') ||
      (!!devUrl && details.url.startsWith(devUrl.replace('http', 'ws')));
    if (!own) {
      win.webContents.send('studio:network', { url: details.url, bytes: 0, blocked: true });
    }
    callback({ cancel: !own });
  });

  ipcMain.handle('studio:config', () => ({
    hasApiKey: apiKey.length > 0,
    apiKey,
    telemetry,
    // Developer option: keep received signals in memory so a replay can be saved.
    record: env.SMARTSPECTRA_RECORD === '1',
    version: app.getVersion(),
  }));

  // Files are written only here, only after the sitter picks a location.
  ipcMain.handle('studio:save', async (_e, opts: {
    defaultName: string; data: Uint8Array | string; filters: { name: string; extensions: string[] }[];
  }) => {
    const res = await dialog.showSaveDialog(win, { defaultPath: opts.defaultName, filters: opts.filters });
    if (res.canceled || !res.filePath) return null;
    writeFileSync(res.filePath, typeof opts.data === 'string' ? opts.data : Buffer.from(opts.data));
    return res.filePath;
  });

  ipcMain.handle('studio:openPlate', async () => {
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Long Exposure plate', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return readFileSync(res.filePaths[0], 'utf8');
  });
});

app.on('window-all-closed', () => app.quit());

// Smoke test (npm run smoke): run a synthetic sitting and capture each stage.
// Only active when LE_SMOKE_DIR is set; never in normal use.
if (process.env.LE_SMOKE_DIR) {
  const dir = process.env.LE_SMOKE_DIR;
  app.whenReady().then(() => {
    const win = BrowserWindow.getAllWindows()[0];
    const shot = async (name: string) => {
      const img = await win.webContents.capturePage();
      writeFileSync(join(dir, `${name}.png`), img.toPNG());
    };
    win.webContents.once('did-finish-load', async () => {
      const wait = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
      await wait(1.5); await shot('1-welcome');
      await win.webContents.executeJavaScript("document.getElementById('btn-sit').click()");
      await wait(6); await shot('2-focusing');
      await wait(14); await shot('3-heart');
      await wait(16); await shot('4-breath');
      await wait(30); await shot('5-result');
      await win.webContents.executeJavaScript("document.getElementById('btn-flip').click()");
      await wait(1.2); await shot('6-verso');
      app.quit();
    });
  });
}

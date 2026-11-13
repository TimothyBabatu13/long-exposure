import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { bindStudioSdk } from './sdk';

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

  bindStudioSdk(win, apiKey, telemetry);
  // Diagnostics: renderer lines tagged [studio] are echoed to the terminal so a
  // sitting can be followed from the log. They carry stage, pause and SDK
  // status text only: never frames, landmarks or vital-sign values.
  win.webContents.on('console-message', (e) => {
    const msg = (e as unknown as { message?: string }).message ?? '';
    if (msg.startsWith('[studio]')) console.log(msg);
  });

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

if (!process.env.LE_HARNESS) app.whenReady().then(() => {
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
      // Optional: stay on the result screen (e.g. to measure CPU), seconds.
      await wait(Number(process.env.LE_SMOKE_HOLD ?? 0));
      await win.webContents.executeJavaScript("document.getElementById('btn-flip').click()");
      await wait(1.2); await shot('6-verso');
      app.quit();
    });
  });
}

// Render harness (npm run render:plate): draws a plate from a recorded sitting
// in fixed states and writes PNGs. Dev only; active only when LE_HARNESS is set.
if (process.env.LE_HARNESS) {
  const rec = process.env.LE_HARNESS;
  const outDir = process.env.LE_HARNESS_OUT ?? 'renders';
  app.whenReady().then(async () => {
    const { normalise } = await import('../renderer/render/landmarks');
    const { mkdirSync, readFileSync: read } = await import('node:fs');
    // Average the normalised face over the sitting, as the app does for the plate.
    let sum: { x: number; y: number }[] | null = null, n = 0, talking = false;
    let raw: { x: number; y: number }[] | null = null; // one mid-sitting face, camera pixels, for the guide
    const pulse: { t: number; v: number }[] = [], breathS: { t: number; v: number }[] = [];
    for (const line of read(rec, 'utf8').split('\n')) {
      if (line.includes('"pulseTrace"') || line.includes('"breathTrace"')) {
        const pk = JSON.parse(line).e?.packet;
        for (const s of pk?.pulseTrace ?? []) if (!pulse.length || s.t > pulse[pulse.length - 1].t) pulse.push(s);
        for (const s of pk?.breathTrace ?? []) if (!breathS.length || s.t > breathS[breathS.length - 1].t) breathS.push(s);
      }
      if (line.includes('"talking"')) { const t = JSON.parse(line).e?.packet?.talking; if (t?.length) talking = !!t[t.length - 1].detected; }
      if (!line.includes('"landmarks"') || talking) continue;
      const pts = JSON.parse(line).e?.packet?.landmarks?.points as { x: number; y: number }[] | undefined;
      if (!pts?.length) continue;
      if (n === 1500) raw = pts;
      const f = normalise(pts);
      if (!sum || sum.length !== f.length) { sum = f.map((q) => ({ ...q })); n = 1; }
      else { sum = sum.map((q, i) => ({ x: q.x + f[i].x, y: q.y + f[i].y })); n++; }
    }
    if (!sum) { console.error('No landmarks in', rec); app.exit(1); return; }
    const face = sum.map((q) => ({ x: q.x / n, y: q.y / n }));
    const win = new BrowserWindow({ show: false, width: 800, height: 800, webPreferences: { contextIsolation: true, sandbox: true } });
    if (devUrl) await win.loadURL(`${devUrl}/harness.html`);
    else await win.loadFile(join(import.meta.dirname, '../renderer/harness.html'));
    const shots = await win.webContents.executeJavaScript(`window.__harness(${JSON.stringify(face)}, 720)`) as { name: string; png: string }[];
    if (pulse.length) shots.push(...await win.webContents.executeJavaScript(`window.__kymo(${JSON.stringify(pulse)}, ${JSON.stringify(breathS)})`) as { name: string; png: string }[]);
    if (raw) shots.push(...await win.webContents.executeJavaScript(`window.__guide(${JSON.stringify(raw)})`) as { name: string; png: string }[]);
    mkdirSync(outDir, { recursive: true });
    for (const s of shots) writeFileSync(join(outDir, `${s.name}.png`), Buffer.from(s.png.split(',')[1], 'base64'));
    console.log(`Rendered ${shots.length} images from ${n} face frames into ${outDir}`);
    app.exit(0);
  });
}

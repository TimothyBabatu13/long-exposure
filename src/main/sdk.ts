// SmartSpectra on the native camera, in the main process.
//
// Why here and not in the window: the SDK's renderer path copies every camera
// frame as raw RGBA from the window to the main process. On a 4-core laptop
// that path delivered only 8-18 of the camera's 30 frames per second, and the
// SDK stopped with kSustainedLowFrameRate (14). Reading the camera natively
// (the same path as `npm run spike`) keeps frames inside the SDK; the window
// only receives the decoded results, which are a few kilobytes.
//
// The API key stays in this process and is never sent to the window.
import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import {
  SmartSpectraSDK,
  CameraSelection,
  ProcessingStatus,
  cardioMetrics,
  breathingMetrics,
  faceMetrics,
} from '@smartspectra/node-sdk';

export function bindStudioSdk(win: BrowserWindow, apiKey: string, telemetry: boolean): void {
  let sdk: SmartSpectraSDK | null = null;
  const send = (channel: string, ...args: unknown[]) => {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args);
  };

  async function stop(): Promise<void> {
    const s = sdk;
    sdk = null;
    if (!s) return;
    try { await s.stopAsync(); } catch { /* already stopped */ }
    try { await s.destroy(); } catch { /* ignore */ }
  }

  ipcMain.handle('studio:sdk:start', async () => {
    if (!apiKey) throw new Error('No SMARTSPECTRA_API_KEY configured.');
    await stop();
    const s = new SmartSpectraSDK({
      apiKey,
      requestedMetrics: [...cardioMetrics, ...breathingMetrics, ...faceMetrics],
      enableTelemetry: telemetry,
    });
    // Only this session's events reach the window; a late event from a
    // stopped session is dropped.
    const live = () => sdk === s;
    s.on('metrics', (buf: Uint8Array) => { if (live()) send('studio:sdk:metrics', new Uint8Array(buf)); });
    s.on('validationStatus', (code: number, _ts: number, hint: string) => { if (live()) send('studio:sdk:validation', code, hint ?? ''); });
    s.on('processingStatus', (status: number) => { if (live()) send('studio:sdk:running', status === ProcessingStatus.kRunning); });
    s.on('error', (code: number, message: string) => { if (live()) send('studio:sdk:error', code, message); });
    // HRV arrives in the live metrics (after about two minutes in our sittings).
    // Accumulated output is not requested: the SDK sends it only when a session
    // ends, too late for a 60-second plate.
    sdk = s;
    s.useCamera(CameraSelection.default); // the spike's camera setup: SDK defaults
    s.start();
  });

  ipcMain.handle('studio:sdk:stop', () => stop());
  win.on('closed', () => { void stop(); });
}

// Sandboxed preload. Bundled into a single CommonJS file by electron-vite,
// because a sandboxed preload cannot require() packages from node_modules.
// The SDK runs in the main process on the native camera (src/main/sdk.ts);
// this bridge only carries its decoded results to the window.
import { contextBridge, ipcRenderer } from 'electron';
import type { StudioBridge } from '../shared/types';

const listen = <A extends unknown[]>(channel: string, cb: (...args: A) => void) => {
  const fn = (_e: unknown, ...args: unknown[]) => cb(...(args as A));
  ipcRenderer.on(channel, fn);
  return () => { ipcRenderer.removeListener(channel, fn); };
};

const studio: StudioBridge = {
  config: () => ipcRenderer.invoke('studio:config'),
  saveFile: (opts) => ipcRenderer.invoke('studio:save', opts),
  openPlate: () => ipcRenderer.invoke('studio:openPlate'),
  onNetwork: (cb) => {
    ipcRenderer.on('studio:network', (_e, entry) => cb(entry));
  },
  sdk: {
    start: () => ipcRenderer.invoke('studio:sdk:start'),
    stop: () => ipcRenderer.invoke('studio:sdk:stop'),
    onMetrics: (cb) => listen<[Uint8Array]>('studio:sdk:metrics', cb),
    onValidation: (cb) => listen<[number, string]>('studio:sdk:validation', cb),
    onRunning: (cb) => listen<[boolean]>('studio:sdk:running', cb),
    onError: (cb) => listen<[number, string]>('studio:sdk:error', cb),
  },
};

contextBridge.exposeInMainWorld('studio', studio);

// Sandboxed preload. Bundled into a single CommonJS file by electron-vite,
// because a sandboxed preload cannot require() packages from node_modules.
import '@smartspectra/node-sdk/preload';
import { contextBridge, ipcRenderer } from 'electron';
import type { StudioBridge } from '../shared/types';

const studio: StudioBridge = {
  config: () => ipcRenderer.invoke('studio:config'),
  saveFile: (opts) => ipcRenderer.invoke('studio:save', opts),
  openPlate: () => ipcRenderer.invoke('studio:openPlate'),
  onNetwork: (cb) => {
    ipcRenderer.on('studio:network', (_e, entry) => cb(entry));
  },
};

contextBridge.exposeInMainWorld('studio', studio);

import { contextBridge, ipcRenderer } from 'electron';

import type { ElectronAPI } from '../../shared/electron-api.js';

const electronAPI = Object.freeze({
  platform: process.platform,
  versions: Object.freeze({
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  }),
  openWindow: async (windowId: string): Promise<void> => {
    await ipcRenderer.invoke('window:open', windowId);
  },
}) satisfies ElectronAPI;

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

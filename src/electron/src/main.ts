import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow } from 'electron';

import { getRendererConfig } from './renderer-config.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: resolve(currentDirectory, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  const renderer = getRendererConfig('main');

  if (!renderer) {
    throw new Error('Missing renderer config for windowId "main"');
  }

  const fallbackPath = resolve(app.getAppPath(), renderer.fallback);

  if (renderer.url) {
    try {
      await window.loadURL(renderer.url);
      return;
    } catch (error) {
      console.error(`Failed to load remote renderer ${renderer.url}; using ${fallbackPath}`, error);
    }
  }

  await window.loadFile(fallbackPath);
}

app
  .whenReady()
  .then(async () => {
    await createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow().catch((error) => {
          console.error('Failed to recreate the main window', error);
        });
      }
    });
  })
  .catch((error) => {
    console.error('Failed to create the main window', error);
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

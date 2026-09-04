import { app, Menu } from 'electron';

import { IpcHandlers } from './ipc-handlers.js';
import { WindowManager } from './window-manager.js';

const windowManager = new WindowManager();
const ipcHandlers = new IpcHandlers(windowManager);

app
  .whenReady()
  .then(async () => {
    Menu.setApplicationMenu(null);
    ipcHandlers.register();
    await windowManager.open('main');

    app.on('activate', () => {
      if (windowManager.size === 0) {
        void windowManager.open('main').catch((error) => {
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

app.on('will-quit', () => {
  ipcHandlers.unregister();
});

import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';

import { WindowManager } from './window-manager.js';

const openWindowChannel = 'window:open';

export class IpcHandlers {
  constructor(private readonly windowManager: WindowManager) {}

  register(): void {
    ipcMain.handle(openWindowChannel, this.handleOpenWindow);
  }

  unregister(): void {
    ipcMain.removeHandler(openWindowChannel);
  }

  private readonly handleOpenWindow = async (event: IpcMainInvokeEvent, windowId: string): Promise<void> => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender);
    if (!sourceWindow || !this.windowManager.owns(sourceWindow)) {
      throw new Error('Only managed application windows may open another window');
    }

    await this.windowManager.open(windowId);
  };
}

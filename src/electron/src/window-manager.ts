import { isAbsolute, relative, resolve, sep } from 'node:path';

import { app, BrowserWindow } from 'electron';

import { getRendererConfig, type RendererConfigEntry } from './renderer-config.js';

const validWindowId = /^[a-z0-9][a-z0-9_-]*$/;

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(parentPath, candidatePath);
  return relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}

export class WindowManager {
  private readonly windows = new Map<string, BrowserWindow>();
  private readonly openingWindows = new Map<string, Promise<BrowserWindow>>();

  get size(): number {
    return this.windows.size;
  }

  owns(window: BrowserWindow): boolean {
    for (const managedWindow of this.windows.values()) {
      if (managedWindow === window) return true;
    }
    return false;
  }

  open(windowId: string): Promise<BrowserWindow> {
    this.validateWindowId(windowId);
    const pendingWindow = this.openingWindows.get(windowId);
    if (pendingWindow) return pendingWindow;

    const existingWindow = this.windows.get(windowId);

    if (existingWindow && !existingWindow.isDestroyed()) {
      if (existingWindow.isMinimized()) existingWindow.restore();
      existingWindow.show();
      return Promise.resolve(existingWindow);
    }

    const renderer = getRendererConfig(windowId);
    if (!renderer) throw new Error(`Unknown windowId: ${windowId}`);

    const openingWindow = this.create(windowId, renderer).finally(() => {
      this.openingWindows.delete(windowId);
    });
    this.openingWindows.set(windowId, openingWindow);
    return openingWindow;
  }

  private validateWindowId(windowId: string): void {
    if (typeof windowId !== 'string' || !validWindowId.test(windowId)) {
      throw new TypeError('windowId must contain only lowercase letters, numbers, hyphens, and underscores');
    }
  }

  private async create(windowId: string, renderer: RendererConfigEntry): Promise<BrowserWindow> {
    const window = new BrowserWindow({
      width: 200,
      height: 100,
      show: false,
      webPreferences: {
        preload: resolve(import.meta.dirname, 'preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });

    window.setMenu(null);
    this.windows.set(windowId, window);
    window.once('closed', () => {
      this.remove(windowId, window);
    });
    window.webContents.once('render-process-gone', (_event, details) => {
      this.remove(windowId, window);
      console.error(`Renderer process for windowId "${windowId}" exited (${details.reason})`);
      if (!window.isDestroyed()) window.destroy();
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.key !== 'F12' || input.isAutoRepeat) return;

      event.preventDefault();
      if (window.webContents.isDevToolsOpened()) {
        window.webContents.closeDevTools();
      } else {
        window.webContents.openDevTools();
      }
    });

    try {
      await this.load(window, windowId, renderer);
      if (!window.isDestroyed()) window.show();
      return window;
    } catch (error) {
      this.remove(windowId, window);
      if (!window.isDestroyed()) window.destroy();
      throw error;
    }
  }

  private remove(windowId: string, window: BrowserWindow): void {
    if (this.windows.get(windowId) === window) this.windows.delete(windowId);
  }

  private async load(window: BrowserWindow, windowId: string, { url, fallback }: RendererConfigEntry): Promise<void> {
    if (!url) {
      await this.loadFallback(window, windowId, fallback);
      return;
    }

    try {
      await window.loadURL(url);
    } catch (error) {
      if (!fallback) {
        throw new Error(`Failed to load development renderer "${windowId}" from ${url}`, {
          cause: error,
        });
      }

      console.error(`Failed to load renderer ${windowId} from ${url}; using fallback`, error);
      await this.loadFallback(window, windowId, fallback);
    }
  }

  private async loadFallback(window: BrowserWindow, windowId: string, fallback: string | null): Promise<void> {
    if (!fallback) {
      throw new Error(
        `Renderer "${windowId}" is not running. Start it from the development console before opening the window.`,
      );
    }

    const appPath = app.getAppPath();
    const fallbackPath = resolve(appPath, fallback);
    if (!isPathInside(appPath, fallbackPath)) {
      throw new Error(`Renderer fallback for windowId "${windowId}" is outside the application directory`);
    }

    await window.loadFile(fallbackPath);
  }
}

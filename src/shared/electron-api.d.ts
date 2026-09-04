export interface ElectronAPI {
  readonly platform: string;
  readonly versions: {
    readonly chrome: string;
    readonly electron: string;
    readonly node: string;
  };
  openWindow(windowId: string): Promise<void>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

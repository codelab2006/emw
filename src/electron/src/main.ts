import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow } from "electron";

import { getRendererConfig } from "./renderer-config.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

function createWindow(): void {
  const window = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: resolve(currentDirectory, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  const renderer = getRendererConfig("main");

  if (renderer?.url) {
    void window.loadURL(renderer.url);
  } else {
    void window.loadFile(
      resolve(
        app.getAppPath(),
        renderer?.fallback ?? "windows/main/index.html",
      ),
    );
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

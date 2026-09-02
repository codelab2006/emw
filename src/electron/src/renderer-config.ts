import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { app } from "electron";

export interface RendererConfigEntry {
  url: string | null;
  fallback: string;
  running?: boolean;
}

type RendererConfig = Record<string, RendererConfigEntry>;

let rendererConfig: RendererConfig | undefined;

function loadRendererConfig(): RendererConfig {
  const configPath =
    process.env.ELECTRON_RENDERER_CONFIG ??
    resolve(app.getAppPath(), "config/renderers.json");

  return JSON.parse(readFileSync(configPath, "utf8")) as RendererConfig;
}

export function getRendererConfig(
  windowId: string,
): RendererConfigEntry | undefined {
  rendererConfig ??= loadRendererConfig();
  return rendererConfig[windowId];
}

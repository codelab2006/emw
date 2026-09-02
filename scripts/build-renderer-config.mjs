import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findWindowProjects } from './window-projects.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windowsDirectory = resolve(root, 'src/windows');
const outputPath = resolve(root, 'dist/config/renderers.json');

const rendererConfig = Object.fromEntries(
  findWindowProjects(windowsDirectory)
    .map((directory) => basename(directory))
    .map((windowId) => {
      const environmentName = `RENDERER_${windowId.replaceAll('-', '_').toUpperCase()}_URL`;

      return [
        windowId,
        {
          url: process.env[environmentName] ?? null,
          fallback: `windows/${windowId}/index.html`,
        },
      ];
    }),
);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(rendererConfig, null, 2)}\n`);

console.log(`Renderer config written to ${outputPath}`);

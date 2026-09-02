import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findWindowProjects } from './window-projects.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windowsDirectory = resolve(root, 'src/windows');
const destinationDirectory = resolve(root, 'dist/windows');

const windows = findWindowProjects(windowsDirectory);

for (const window of windows) {
  console.log(`\nBuilding ${window}...`);
  execFileSync('npm', ['run', 'build', '--prefix', window], {
    stdio: 'inherit',
  });
}

await rm(destinationDirectory, { recursive: true, force: true });
await mkdir(destinationDirectory, { recursive: true });

await Promise.all(
  windows.map((window) =>
    cp(resolve(window, 'dist'), resolve(destinationDirectory, basename(window)), {
      recursive: true,
    }),
  ),
);

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findWindowProjects } from './window-projects.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windowsDirectory = resolve(root, 'src/windows');
const environment = {
  ...process.env,
  ELECTRON_MIRROR: process.env.ELECTRON_MIRROR ?? 'https://npmmirror.com/mirrors/electron/',
};
const windows = findWindowProjects(windowsDirectory);

console.log('\nInstalling root and Electron workspace dependencies...');
execFileSync('npm', ['install'], {
  cwd: root,
  env: environment,
  stdio: 'inherit',
});

console.log(`\nInstalling Electron Runtime from ${environment.ELECTRON_MIRROR}...`);
execFileSync('npm', ['exec', '--', 'install-electron'], {
  cwd: root,
  env: environment,
  stdio: 'inherit',
});

for (const window of windows) {
  console.log(`\nInstalling dependencies in ${window}...`);
  execFileSync('npm', ['install', '--prefix', window], { stdio: 'inherit' });
}

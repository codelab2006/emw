import { existsSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';

export function findWindowProjects(windowsDirectory) {
  return readdirSync(windowsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(windowsDirectory, entry.name))
    .filter((directory) => existsSync(resolve(directory, 'package.json')))
    .sort((left, right) => {
      if (basename(left) === 'main') return -1;
      if (basename(right) === 'main') return 1;
      return left.localeCompare(right);
    });
}

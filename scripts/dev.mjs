import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import electronExecutable from 'electron';

import { DevApplication } from './dev/dev-application.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let application;

try {
  application = new DevApplication({ root, electronExecutable });
  await application.start(process.argv.slice(2));
} catch (error) {
  console.error(`Cannot start development mode: ${error.message}`);
  if (application) {
    await application.exit(1);
  } else {
    process.exitCode = 1;
  }
}

import { exec } from 'node:child_process';
import { watch as watchFiles } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { build, context } from 'esbuild';

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = resolve(projectDirectory, 'src');

const outputDirectory = resolve(projectDirectory, 'dist');
const watch = process.argv.includes('--watch');
const buildStatusFile = process.env.ELECTRON_BUILD_STATUS_FILE;
const execAsync = promisify(exec);

const sharedOptions = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  external: ['electron'],
  logLevel: 'info',
};

const buildOptions = [
  {
    ...sharedOptions,
    entryPoints: [resolve(sourceDirectory, 'main.ts')],
    outfile: resolve(outputDirectory, 'main.js'),
    format: 'esm',
  },
  {
    ...sharedOptions,
    entryPoints: [resolve(sourceDirectory, 'preload.ts')],
    outfile: resolve(outputDirectory, 'preload.cjs'),
    format: 'cjs',
  },
];

await rm(outputDirectory, { recursive: true, force: true });

if (watch) {
  const contexts = await Promise.all(buildOptions.map((options) => context(options)));
  let rebuildPromise = Promise.resolve();
  let rebuildTimer;

  async function writeBuildStatus(status) {
    if (!buildStatusFile) return;

    const temporaryFile = `${buildStatusFile}.tmp`;
    await mkdir(dirname(buildStatusFile), { recursive: true });
    await writeFile(temporaryFile, `${JSON.stringify({ status, timestamp: Date.now() })}\n`);
    await rename(temporaryFile, buildStatusFile);
  }

  async function rebuildAll() {
    let status = 'success';
    try {
      await writeBuildStatus('building');
      await Promise.all(contexts.map((buildContext) => buildContext.rebuild()));
      await execAsync('npm run typecheck', { cwd: projectDirectory });
    } catch (error) {
      status = 'failed';
      if (error.stdout) process.stdout.write(error.stdout);
      if (error.stderr) process.stderr.write(error.stderr);
    }

    try {
      await writeBuildStatus(status);
    } catch (error) {
      console.error(`Failed to write Electron build status: ${error.message}`);
    }
  }

  function scheduleRebuild() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      rebuildPromise = rebuildPromise.then(() => rebuildAll());
    }, 100);
  }

  await rebuildAll();
  const sourceWatcher = watchFiles(sourceDirectory, { recursive: true }, scheduleRebuild);
  const projectWatcher = watchFiles(projectDirectory, (event, filename) => {
    const changedFile = filename?.toString();
    if (changedFile === 'tsconfig.json' || changedFile === 'package.json') {
      scheduleRebuild();
    } else if (changedFile === 'esbuild.config.mjs') {
      process.exit(75);
    }
  });

  function handleWatcherError(error) {
    console.error(`Electron source watcher failed: ${error.message}`);
    sourceWatcher.close();
    projectWatcher.close();
    process.exit(1);
  }

  sourceWatcher.once('error', handleWatcherError);
  projectWatcher.once('error', handleWatcherError);
} else {
  await Promise.all(buildOptions.map((options) => build(options)));
}

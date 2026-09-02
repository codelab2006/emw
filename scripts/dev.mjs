import { spawn } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import kill from 'tree-kill';

import { findWindowProjects } from './window-projects.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windowsDirectory = resolve(root, 'src/windows');
const rendererConfigPath = resolve(root, '.dev/renderers.json');
const colors = [36, 35, 34, 33, 32, 31];
const processes = new Set();
const windows = new Map(
  findWindowProjects(windowsDirectory).map((directory, index) => [
    basename(directory),
    {
      directory,
      port: 5173 + index,
      process: undefined,
    },
  ]),
);

let shuttingDown = false;
let readline;

function colorize(name) {
  const names = [...windows.keys(), 'electron-main', 'electron'];
  const color = colors[names.indexOf(name) % colors.length];
  return `\u001B[${color}m[${name}]\u001B[39m`;
}

function log(name, message) {
  console.log(`${colorize(name)} ${message}`);
  if (!shuttingDown) readline?.prompt(true);
}

function pipeOutput(child, name) {
  for (const stream of [child.stdout, child.stderr]) {
    const lines = createInterface({ input: stream });
    lines.on('line', (line) => log(name, line));
  }
}

function spawnCommand(name, command, cwd = root, environment = {}) {
  const child = spawn(command, {
    cwd,
    env: { ...process.env, ...environment },
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  processes.add(child);
  pipeOutput(child, name);
  child.once('exit', (code, signal) => {
    processes.delete(child);
    log(name, `exited (${signal ?? code})`);
  });

  return child;
}

function writeRendererConfig() {
  const config = Object.fromEntries(
    [...windows].map(([windowId, state]) => [
      windowId,
      {
        url: `http://localhost:${state.port}`,
        fallback: `windows/${windowId}/index.html`,
      },
    ]),
  );
  const temporaryPath = `${rendererConfigPath}.tmp`;

  mkdirSync(dirname(rendererConfigPath), { recursive: true });
  writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`);
  renameSync(temporaryPath, rendererConfigPath);
}

function startRenderer(windowId) {
  const state = windows.get(windowId);

  if (!state) {
    console.log(`Unknown windowId: ${windowId}`);
    return;
  }

  if (state.process) {
    console.log(`${windowId} is already running at http://localhost:${state.port}`);
    return;
  }

  const child = spawnCommand(windowId, `npm run dev -- --port ${state.port} --strictPort`, state.directory);
  state.process = child;
  child.once('exit', () => {
    if (state.process === child) {
      state.process = undefined;
      writeRendererConfig();
    }
  });
  writeRendererConfig();
  console.log(`Started ${windowId} at http://localhost:${state.port}`);
}

function killProcess(child) {
  return new Promise((complete) => {
    if (!child?.pid) {
      complete();
      return;
    }

    kill(child.pid, 'SIGTERM', () => complete());
  });
}

async function stopRenderer(windowId, allowMain = false) {
  if (windowId === 'main' && !allowMain) {
    console.log('main is required by Electron and cannot be stopped independently');
    return;
  }

  const state = windows.get(windowId);

  if (!state) {
    console.log(`Unknown windowId: ${windowId}`);
    return;
  }

  if (!state.process) {
    console.log(`${windowId} is not running`);
    return;
  }

  const child = state.process;
  state.process = undefined;
  writeRendererConfig();
  await killProcess(child);
  console.log(`Stopped ${windowId}`);
}

function listRenderers() {
  for (const [windowId, state] of windows) {
    const status = state.process ? 'running' : 'stopped';
    console.log(`${windowId.padEnd(20)} ${status.padEnd(8)} http://localhost:${state.port}`);
  }
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  readline?.close();

  for (const state of windows.values()) state.process = undefined;
  writeRendererConfig();
  await Promise.all([...processes].map((child) => killProcess(child)));
}

function printHelp() {
  console.log(`
Commands:
  list                 Show all renderer processes
  start <windowId>     Start a renderer
  stop <windowId>      Stop a renderer
  restart <windowId>   Restart a renderer
  start all            Start all renderers
  stop all             Stop optional renderers
  help                 Show this help
  quit                 Stop all processes and exit
`);
}

async function handleCommand(input) {
  const [command, windowId] = input.trim().split(/\s+/);

  if (!command) return;

  if (command === 'list') {
    listRenderers();
  } else if (command === 'start' && windowId === 'all') {
    for (const id of windows.keys()) startRenderer(id);
  } else if (command === 'stop' && windowId === 'all') {
    for (const id of windows.keys()) {
      if (id !== 'main') await stopRenderer(id);
    }
  } else if (command === 'start' && windowId) {
    startRenderer(windowId);
  } else if (command === 'stop' && windowId) {
    await stopRenderer(windowId);
  } else if (command === 'restart' && windowId) {
    await stopRenderer(windowId, true);
    startRenderer(windowId);
  } else if (command === 'help') {
    printHelp();
  } else if (command === 'quit' || command === 'exit') {
    await shutdown();
    process.exit(0);
  } else {
    console.log(`Unknown command: ${input}`);
    printHelp();
  }
}

writeRendererConfig();
startRenderer('main');

const argumentsToStart = process.argv.slice(2);
if (argumentsToStart.includes('--all')) {
  for (const windowId of windows.keys()) startRenderer(windowId);
} else {
  for (const windowId of argumentsToStart) startRenderer(windowId);
}

spawnCommand('electron-main', 'npm run dev --workspace @emw/electron');
spawnCommand(
  'electron',
  'wait-on tcp:5173 file:src/electron/dist/main.js && electronmon src/electron/dist/main.js',
  root,
  { ELECTRON_RENDERER_CONFIG: rendererConfigPath },
);

printHelp();
readline = createInterface({ input: process.stdin, output: process.stdout });
readline.setPrompt('dev> ');
let commandQueue = Promise.resolve();
readline.on('line', (line) => {
  commandQueue = commandQueue.then(async () => {
    await handleCommand(line);
    if (!shuttingDown) readline.prompt();
  });
});
readline.prompt();

process.once('SIGINT', async () => {
  await shutdown();
  process.exit(0);
});
process.once('SIGTERM', async () => {
  await shutdown();
  process.exit(0);
});

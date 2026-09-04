import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import { isPortAvailable, isPortListening, waitFor } from './runtime-utils.mjs';

export class RendererManager {
  constructor({
    windowDirectories,
    startPort,
    configPath,
    processManager,
    startConcurrency = 8,
    configWriteDelay = 50,
    onMainStarted = () => {},
    onFatal = () => {},
  }) {
    this.configPath = configPath;
    this.processManager = processManager;
    this.startConcurrency = startConcurrency;
    this.configWriteDelay = Math.max(0, configWriteDelay);
    this.onMainStarted = onMainStarted;
    this.onFatal = onFatal;
    this.shuttingDown = false;
    this.configDirty = true;
    this.configWriteTimer = undefined;
    this.configFailureReported = false;
    this.configBatchDepth = 0;
    this.pendingStarts = new Set();
    this.startupTasks = new Set();
    this.startupWorkerCount = 0;
    this.windows = new Map(
      windowDirectories.map((directory, index) => [
        basename(directory),
        {
          directory,
          port: startPort + index,
          process: undefined,
          startVersion: 0,
          status: 'stopped',
        },
      ]),
    );
  }

  setMainStartedHandler(onMainStarted) {
    this.onMainStarted = onMainStarted;
  }

  hasMainRenderer() {
    return this.windows.has('main');
  }

  windowIds() {
    return this.windows.keys();
  }

  optionalWindowIds(argumentsToStart) {
    if (argumentsToStart.includes('--all')) {
      return [...this.windows.keys()].filter((windowId) => windowId !== 'main');
    }
    return argumentsToStart.filter((windowId) => windowId !== 'main');
  }

  mainIsRunning() {
    const main = this.windows.get('main');
    return Boolean(main?.process) && main.status === 'running';
  }

  async mainIsReachable() {
    const main = this.windows.get('main');
    return Boolean(main && (await isPortListening(main.port)));
  }

  flushConfig() {
    clearTimeout(this.configWriteTimer);
    this.configWriteTimer = undefined;
    if (!this.configDirty) return;

    const config = Object.fromEntries(
      [...this.windows].map(([windowId, state]) => [
        windowId,
        {
          url: state.status === 'running' ? `http://localhost:${state.port}` : null,
          fallback: null,
        },
      ]),
    );
    const temporaryPath = `${this.configPath}.tmp`;

    mkdirSync(dirname(this.configPath), { recursive: true });
    writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`);
    renameSync(temporaryPath, this.configPath);
    this.configDirty = false;
  }

  reportConfigFailure(error) {
    if (this.configFailureReported || this.shuttingDown) return;
    this.configFailureReported = true;
    console.error(`Failed to update renderer config: ${error.message}`);
    void Promise.resolve(this.onFatal(error)).catch((fatalError) => {
      console.error(`Failed to shut down after renderer config error: ${fatalError.message}`);
    });
  }

  beginConfigBatch() {
    this.configBatchDepth += 1;
    if (this.configBatchDepth !== 1) return;

    clearTimeout(this.configWriteTimer);
    this.configWriteTimer = undefined;
  }

  endConfigBatch({ immediate = false } = {}) {
    if (this.configBatchDepth === 0) return;

    this.configBatchDepth -= 1;
    if (this.configBatchDepth === 0 && this.configDirty && !this.shuttingDown) {
      this.scheduleConfigWrite({ immediate });
    }
  }

  scheduleConfigWrite({ immediate = false } = {}) {
    this.configDirty = true;
    if (immediate) {
      try {
        this.flushConfig();
      } catch (error) {
        this.reportConfigFailure(error);
        throw error;
      }
      return;
    }
    if (this.shuttingDown || this.configBatchDepth > 0 || this.configWriteTimer) return;

    this.configWriteTimer = setTimeout(() => {
      this.configWriteTimer = undefined;
      try {
        this.flushConfig();
      } catch (error) {
        this.reportConfigFailure(error);
      }
    }, this.configWriteDelay);
  }

  async start(windowId) {
    this.pendingStarts.delete(windowId);
    if (this.shuttingDown) return false;

    const state = this.windows.get(windowId);
    if (!state) {
      console.log(`Unknown windowId: ${windowId}`);
      return false;
    }

    if (state.process || state.status === 'starting') {
      console.log(`${windowId} is already ${state.status} at http://localhost:${state.port}`);
      return state.status === 'running';
    }

    state.status = 'starting';
    const startVersion = ++state.startVersion;
    let portAvailable;
    try {
      portAvailable = await isPortAvailable(state.port);
    } catch (error) {
      if (this.shuttingDown || state.startVersion !== startVersion) return false;
      state.status = 'failed';
      console.error(`Cannot check port ${state.port} for ${windowId}: ${error.message}`);
      return false;
    }

    if (this.shuttingDown || state.startVersion !== startVersion) return false;
    if (!portAvailable) {
      state.status = 'failed';
      console.error(
        `Cannot start ${windowId}: its assigned port ${state.port} is occupied by another or stale process`,
      );
      return false;
    }

    const child = this.processManager.spawn(windowId, `npm run dev -- --port ${state.port} --strictPort`, {
      cwd: state.directory,
    });
    state.process = child;
    child.once('error', () => {
      if (state.process === child) {
        state.process = undefined;
        state.status = 'failed';
      }
    });
    child.once('exit', () => {
      if (state.process === child) {
        state.process = undefined;
        state.status = this.processManager.isExpectedStop(child) ? 'stopped' : 'failed';
        this.scheduleConfigWrite();
      }
    });
    const ready = await waitFor(() => isPortListening(state.port), {
      timeout: 30_000,
      shouldContinue: () => !this.shuttingDown && state.process === child,
    });
    if (ready && state.process === child) {
      state.status = 'running';
      this.scheduleConfigWrite({ immediate: windowId === 'main' });
      console.log(`Started ${windowId} at http://localhost:${state.port}`);
      if (windowId === 'main') this.onMainStarted();
      return true;
    }

    if (this.shuttingDown) return false;
    if (state.process === child) {
      state.status = 'failed';
      console.error(`${windowId} did not become ready on port ${state.port} within 30 seconds`);
      state.process = undefined;
      try {
        await this.processManager.stop(child);
      } catch (error) {
        if (child.exitCode === null && child.signalCode === null) state.process = child;
        console.error(error.message);
      }
    }
    return false;
  }

  async stop(windowId, allowMain = false) {
    if (windowId === 'main' && !allowMain) {
      console.log('main is required by Electron and cannot be stopped independently');
      return false;
    }

    const state = this.windows.get(windowId);
    if (!state) {
      console.log(`Unknown windowId: ${windowId}`);
      return false;
    }

    this.pendingStarts.delete(windowId);
    state.startVersion += 1;
    if (!state.process) {
      if (state.status === 'starting') {
        state.status = 'stopped';
        this.scheduleConfigWrite();
        console.log(`Stopped ${windowId}`);
        return true;
      }
      console.log(`${windowId} is not running`);
      return true;
    }

    const child = state.process;
    state.process = undefined;
    state.status = 'stopped';
    this.scheduleConfigWrite();
    try {
      await this.processManager.stop(child);
      const portReleased = await waitFor(() => isPortAvailable(state.port), {
        timeout: 5_000,
        shouldContinue: () => !this.shuttingDown,
      });
      if (!portReleased) {
        state.status = 'failed';
        console.error(`Stopped ${windowId}, but port ${state.port} was not released within 5 seconds`);
        return false;
      }
      console.log(`Stopped ${windowId}`);
      return true;
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) {
        state.process = child;
        state.status = 'failed';
      } else {
        state.status = 'stopped';
      }
      console.error(error.message);
      return false;
    }
  }

  startStartupWorkers() {
    while (!this.shuttingDown && this.startupWorkerCount < this.startConcurrency && this.pendingStarts.size > 0) {
      this.startupWorkerCount += 1;
      let task;
      task = (async () => {
        while (!this.shuttingDown) {
          const windowId = this.pendingStarts.values().next().value;
          if (windowId === undefined) return;
          this.pendingStarts.delete(windowId);

          try {
            await this.start(windowId);
          } catch (error) {
            console.error(`Failed to start ${windowId}: ${error.message}`);
          }
        }
      })().finally(() => {
        this.startupWorkerCount -= 1;
        this.startupTasks.delete(task);
        this.startStartupWorkers();
      });
      this.startupTasks.add(task);
    }
  }

  startInBackground(windowIds) {
    const rendererIds = [...new Set(windowIds)].filter((windowId) => windowId !== 'main');
    if (rendererIds.length === 0 || this.shuttingDown) return;

    let added = 0;
    for (const windowId of rendererIds) {
      const state = this.windows.get(windowId);
      if (this.pendingStarts.has(windowId) || state?.process || state?.status === 'starting') continue;
      this.pendingStarts.add(windowId);
      added += 1;
    }
    if (added === 0) return;

    console.log(
      `Starting ${added} optional renderer${added === 1 ? '' : 's'} in the background ` +
        `(up to ${this.startConcurrency} at a time)`,
    );
    this.startStartupWorkers();
  }

  async stopOptional() {
    this.pendingStarts.clear();
    this.beginConfigBatch();
    try {
      for (const windowId of this.windows.keys()) {
        if (windowId !== 'main') await this.stop(windowId);
      }
    } finally {
      this.endConfigBatch({ immediate: true });
    }
  }

  list() {
    for (const [windowId, state] of this.windows) {
      console.log(`${windowId.padEnd(20)} ${state.status.padEnd(8)} http://localhost:${state.port}`);
    }
  }

  beginShutdown() {
    this.shuttingDown = true;
    this.pendingStarts.clear();
    clearTimeout(this.configWriteTimer);
    this.configWriteTimer = undefined;
  }

  async prepareShutdown() {
    this.beginShutdown();
    await Promise.allSettled([...this.startupTasks]);
    for (const state of this.windows.values()) {
      state.startVersion += 1;
      state.process = undefined;
      state.status = 'stopped';
    }
    this.configDirty = true;
    this.flushConfig();
  }
}

import { existsSync, readFileSync, rmSync, statSync, unwatchFile, watchFile } from 'node:fs';

import { waitFor } from './runtime-utils.mjs';

export class ElectronManager {
  constructor({
    executable,
    buildStatusFile,
    outputDirectory,
    outputFiles,
    rendererConfigPath,
    processManager,
    rendererManager,
    onFatal = () => {},
  }) {
    this.buildStatusFile = buildStatusFile;
    this.outputDirectory = outputDirectory;
    this.outputFiles = outputFiles;
    this.processManager = processManager;
    this.rendererManager = rendererManager;
    this.onFatal = onFatal;
    this.shuttingDown = false;
    this.restartPromise = Promise.resolve();
    this.restartDrainActive = false;
    this.restartTimer = undefined;
    this.buildWatcherRestartTimer = undefined;
    this.restartRequested = 0;
    this.restartCompleted = 0;
    this.restartRetryRequested = false;
    this.buildVersion = 0;
    this.services = {
      'electron-main': {
        command: 'npm run dev --workspace @emw/electron',
        environment: { ELECTRON_BUILD_STATUS_FILE: buildStatusFile },
        required: true,
        restartExitCode: 75,
        process: undefined,
        startPromise: undefined,
        status: 'stopped',
      },
      electron: {
        command: executable,
        args: [outputFiles[0]],
        environment: { ELECTRON_RENDERER_CONFIG: rendererConfigPath },
        process: undefined,
        startPromise: undefined,
        status: 'stopped',
      },
    };
  }

  readBuildStatus() {
    try {
      return JSON.parse(readFileSync(this.buildStatusFile, 'utf8')).status;
    } catch {
      return undefined;
    }
  }

  startService(name) {
    if (this.shuttingDown) return Promise.resolve(false);

    const service = this.services[name];
    if (service.process) {
      console.log(`${name} is already ${service.status}`);
      return service.startPromise ?? Promise.resolve(service.status === 'running');
    }

    service.status = 'starting';
    let child;
    try {
      child = this.processManager.spawn(name, service.command, {
        args: service.args,
        environment: service.environment,
        shell: service.args ? false : true,
      });
    } catch (error) {
      service.status = 'failed';
      console.error(`Cannot start ${name}: ${error.message}`);
      if (service.required && !this.shuttingDown) void this.onFatal();
      return Promise.resolve(false);
    }

    service.process = child;
    let completeStart;
    const startPromise = new Promise((complete) => {
      completeStart = complete;
    });
    const trackedStartPromise = startPromise.finally(() => {
      if (service.startPromise === trackedStartPromise) service.startPromise = undefined;
    });
    service.startPromise = trackedStartPromise;

    child.once('spawn', () => {
      if (service.process === child) {
        service.status = 'running';
        completeStart(true);
      }
    });
    child.once('error', () => {
      if (service.process === child) {
        service.process = undefined;
        service.status = 'failed';
        completeStart(false);
        if (service.required && !this.shuttingDown) {
          this.processManager.log(name, 'required service failed to start; shutting down');
          void this.onFatal();
        }
      }
    });
    child.once('exit', () => {
      if (service.process === child) {
        service.process = undefined;
        const expected = this.processManager.isExpectedStop(child) || this.shuttingDown;
        const shouldRestart = !expected && service.restartExitCode === child.exitCode;
        service.status = shouldRestart ? 'starting' : expected ? 'stopped' : 'failed';
        if (shouldRestart) {
          this.processManager.log(name, 'configuration changed; restarting build watcher');
          clearTimeout(this.buildWatcherRestartTimer);
          this.buildWatcherRestartTimer = setTimeout(() => void this.startService(name), 100);
        } else if (!expected && service.required) {
          this.processManager.log(name, 'required service exited unexpectedly; shutting down');
          void this.onFatal();
        }
      }
      completeStart(false);
    });

    return service.startPromise;
  }

  async dependencyError() {
    if (!this.rendererManager.mainIsRunning()) return 'the main renderer is not running';
    if (!this.services['electron-main'].process || this.services['electron-main'].status === 'failed') {
      return 'the Electron build watcher is not running';
    }
    if (this.readBuildStatus() !== 'success') {
      return 'the Electron source has not built and type-checked successfully';
    }
    if (!this.outputFiles.every(existsSync)) return 'the Electron build outputs are missing';
    if (!(await this.rendererManager.mainIsReachable())) return 'the main renderer is not reachable';
    return undefined;
  }

  async startElectron({ exitOnSpawnFailure = false } = {}) {
    if (this.shuttingDown) return false;

    const service = this.services.electron;
    if (service.process) return service.startPromise ?? true;
    if (service.status === 'starting') return false;
    if (!this.rendererManager.mainIsRunning()) {
      service.status = 'failed';
      console.error('Cannot start Electron: the main renderer is not running');
      return false;
    }

    service.status = 'starting';
    const ready = await waitFor(
      async () =>
        this.readBuildStatus() === 'success' &&
        this.outputFiles.every(existsSync) &&
        (await this.rendererManager.mainIsReachable()),
      {
        timeout: 30_000,
        shouldContinue: () =>
          !this.shuttingDown &&
          this.rendererManager.mainIsRunning() &&
          Boolean(this.services['electron-main'].process) &&
          this.services['electron-main'].status !== 'failed' &&
          this.readBuildStatus() !== 'failed',
      },
    );

    if (!ready) {
      if (this.shuttingDown) return false;
      service.status = 'failed';
      if (!this.services['electron-main'].process || this.services['electron-main'].status === 'failed') {
        console.error('Cannot start Electron: the Electron build watcher exited before the build completed');
      } else if (this.readBuildStatus() === 'failed') {
        console.error('Cannot start Electron: the Electron source failed to build or type-check');
      } else if (!this.rendererManager.mainIsRunning()) {
        console.error('Cannot start Electron: the main renderer stopped while waiting for the build');
      } else {
        console.error('Electron dependencies did not become ready within 30 seconds');
      }
      return false;
    }

    const started = await this.startService('electron');
    if (!started && exitOnSpawnFailure && !this.shuttingDown) {
      console.error('Cannot start development mode because the Electron process failed to start');
      await this.onFatal();
    }
    return started;
  }

  async restartElectron() {
    const service = this.services.electron;
    const child = service.process;

    if (child) {
      const dependencyError = await this.dependencyError();
      if (dependencyError) {
        console.error(`Cannot restart Electron: ${dependencyError}; keeping the current process`);
        return false;
      }

      service.process = undefined;
      service.status = 'stopped';
      try {
        await this.processManager.stop(child);
      } catch (error) {
        if (child.exitCode === null && child.signalCode === null) {
          service.process = child;
          service.status = 'failed';
        } else {
          service.status = 'stopped';
        }
        console.error(error.message);
        return false;
      }
    }

    return this.startElectron();
  }

  queueRestart(request = ++this.restartRequested) {
    this.restartRequested = Math.max(this.restartRequested, request);
    if (this.restartDrainActive) return this.restartPromise;

    this.restartDrainActive = true;
    this.restartPromise = Promise.resolve()
      .then(async () => {
        while (!this.shuttingDown && this.restartCompleted < this.restartRequested) {
          const targetRequest = this.restartRequested;
          this.restartRetryRequested = false;
          let restarted = false;
          try {
            restarted = await this.restartElectron();
          } catch (error) {
            console.error(`Failed to restart Electron: ${error.message}`);
          }

          if (restarted) {
            this.restartCompleted = targetRequest;
          } else if (this.restartRequested <= targetRequest && !this.restartRetryRequested) {
            break;
          }
        }
      })
      .finally(() => {
        this.restartDrainActive = false;
        if (!this.shuttingDown && this.restartCompleted < this.restartRequested && this.restartRetryRequested) {
          void this.queueRestart(this.restartRequested);
        }
      });
    return this.restartPromise;
  }

  retryPendingRestart() {
    if (this.shuttingDown || this.restartCompleted >= this.restartRequested) return;
    this.restartRetryRequested = true;
    void this.queueRestart(this.restartRequested);
  }

  scheduleRestart() {
    if (this.shuttingDown) return;
    const request = ++this.restartRequested;
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => void this.queueRestart(request), 200);
  }

  watchBuild() {
    this.buildVersion = existsSync(this.buildStatusFile) ? statSync(this.buildStatusFile).mtimeMs : 0;
    watchFile(this.buildStatusFile, { interval: 200 }, (current) => {
      if (current.mtimeMs === 0 || current.mtimeMs === this.buildVersion) return;
      this.buildVersion = current.mtimeMs;
      const buildStatus = this.readBuildStatus();
      if (buildStatus === 'success') {
        this.scheduleRestart();
      } else if (buildStatus === 'failed') {
        console.error('Electron source failed to build or type-check; keeping the current Electron process');
      }
    });
  }

  async startDevelopment() {
    rmSync(this.outputDirectory, { recursive: true, force: true });
    rmSync(this.buildStatusFile, { force: true });
    await this.startService('electron-main');
    if (!this.shuttingDown) {
      const started = await this.startElectron({ exitOnSpawnFailure: true });
      if (!started && !this.shuttingDown) this.restartRequested += 1;
    }
    if (!this.shuttingDown) this.watchBuild();
  }

  list() {
    for (const [name, service] of Object.entries(this.services)) {
      console.log(`${name.padEnd(20)} ${service.status}`);
    }
  }

  beginShutdown() {
    this.shuttingDown = true;
    clearTimeout(this.restartTimer);
    clearTimeout(this.buildWatcherRestartTimer);
    unwatchFile(this.buildStatusFile);
  }

  async prepareShutdown() {
    this.beginShutdown();
    await this.restartPromise;
    for (const service of Object.values(this.services)) {
      service.process = undefined;
      service.status = 'stopped';
    }
  }
}

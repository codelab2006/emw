import { basename, resolve } from 'node:path';

import { findWindowProjects } from '../window-projects.mjs';
import { DevConsole } from './dev-console.mjs';
import { ElectronManager } from './electron-manager.mjs';
import { ProcessManager } from './process-manager.mjs';
import { RendererManager } from './renderer-manager.mjs';

export class DevApplication {
  constructor({ root, electronExecutable }) {
    const windowsDirectory = resolve(root, 'src/windows');
    const rendererConfigPath = resolve(root, '.dev/renderers.json');
    const electronBuildStatusFile = resolve(root, '.dev/electron-build-status.json');
    const electronOutputDirectory = resolve(root, 'src/electron/dist');
    const electronOutputFiles = ['main.js', 'preload.cjs'].map((filename) =>
      resolve(electronOutputDirectory, filename),
    );
    const windowDirectories = findWindowProjects(windowsDirectory);
    const processNames = [...windowDirectories.map((directory) => basename(directory)), 'electron-main', 'electron'];

    this.shuttingDown = false;
    this.shutdownPromise = undefined;
    this.processManager = new ProcessManager({ root, names: processNames, stopConcurrency: 8 });
    this.rendererManager = new RendererManager({
      windowDirectories,
      startPort: 15173,
      configPath: rendererConfigPath,
      processManager: this.processManager,
      startConcurrency: 8,
      configWriteDelay: 100,
      onFatal: () => this.exit(1),
    });
    this.electronManager = new ElectronManager({
      executable: electronExecutable,
      buildStatusFile: electronBuildStatusFile,
      outputDirectory: electronOutputDirectory,
      outputFiles: electronOutputFiles,
      rendererConfigPath,
      processManager: this.processManager,
      rendererManager: this.rendererManager,
      onFatal: () => this.exit(1),
    });
    this.rendererManager.setMainStartedHandler(() => this.electronManager.retryPendingRestart());
    this.console = new DevConsole({
      rendererManager: this.rendererManager,
      electronManager: this.electronManager,
      processManager: this.processManager,
      onExit: () => this.exit(),
    });
  }

  installSignalHandlers() {
    process.once('SIGINT', () => void this.exit());
    process.once('SIGTERM', () => void this.exit());
  }

  async start(argumentsToStart) {
    this.installSignalHandlers();
    if (!this.rendererManager.hasMainRenderer()) {
      console.error('Cannot start development mode: src/windows/main/package.json is missing');
      await this.exit(1);
      return;
    }

    this.rendererManager.flushConfig();
    const mainStarted = await this.rendererManager.start('main');
    if (!mainStarted && !this.shuttingDown) {
      console.error('Cannot start development mode because the main renderer failed to start');
      await this.exit(1);
      return;
    }

    const optionalRenderers = this.rendererManager.optionalWindowIds(argumentsToStart);
    if (!this.shuttingDown) await this.electronManager.startDevelopment();
    if (!this.shuttingDown) this.rendererManager.startInBackground(optionalRenderers);
    if (!this.shuttingDown) this.console.start();
  }

  shutdown() {
    if (this.shutdownPromise) return this.shutdownPromise;

    this.shuttingDown = true;
    this.console.close();
    this.processManager.beginShutdown();
    this.rendererManager.beginShutdown();
    this.electronManager.beginShutdown();

    this.shutdownPromise = (async () => {
      let clean = true;
      const preparations = await Promise.allSettled([
        this.rendererManager.prepareShutdown(),
        this.electronManager.prepareShutdown(),
      ]);
      for (const result of preparations) {
        if (result.status === 'rejected') {
          clean = false;
          console.error(result.reason.message);
        }
      }
      if (!(await this.processManager.stopAll())) clean = false;
      return clean;
    })();

    return this.shutdownPromise;
  }

  async exit(exitCode = 0) {
    const clean = await this.shutdown();
    process.exit(clean ? exitCode : 1);
  }
}

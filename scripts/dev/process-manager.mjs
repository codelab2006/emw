import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import kill from 'tree-kill';

const defaultColors = [36, 35, 34, 33, 32, 31];

export class ProcessManager {
  constructor({ root, names, colors = defaultColors, stopConcurrency = 8 }) {
    this.root = root;
    this.processes = new Set();
    this.expectedStops = new WeakSet();
    this.shuttingDown = false;
    this.refreshPrompt = undefined;
    this.colors = new Map(names.map((name, index) => [name, colors[index % colors.length]]));
    this.stopConcurrency = Number.isFinite(stopConcurrency) ? Math.max(1, Math.floor(stopConcurrency)) : 8;
  }

  setPromptRefresher(refreshPrompt) {
    this.refreshPrompt = refreshPrompt;
  }

  beginShutdown() {
    this.shuttingDown = true;
    this.refreshPrompt = undefined;
  }

  isExpectedStop(child) {
    return this.expectedStops.has(child) || this.shuttingDown;
  }

  colorize(name) {
    const color = this.colors.get(name) ?? 37;
    return `\u001B[${color}m[${name}]\u001B[39m`;
  }

  log(name, message) {
    console.log(`${this.colorize(name)} ${message}`);
    if (!this.shuttingDown) this.refreshPrompt?.();
  }

  pipeOutput(child, name) {
    for (const stream of [child.stdout, child.stderr]) {
      const lines = createInterface({ input: stream });
      lines.on('line', (line) => this.log(name, line));
    }
  }

  spawn(name, command, options = {}) {
    const child = spawn(command, options.args ?? [], {
      cwd: options.cwd ?? this.root,
      env: { ...process.env, ...options.environment },
      shell: options.shell ?? true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.processes.add(child);
    this.pipeOutput(child, name);
    child.once('error', (error) => {
      this.processes.delete(child);
      this.log(name, `failed to start: ${error.message}`);
    });
    child.once('exit', (code, signal) => {
      this.processes.delete(child);
      const expected = this.isExpectedStop(child);
      this.log(name, `${expected ? 'stopped' : 'exited unexpectedly'} (${signal ?? code})`);
    });

    return child;
  }

  killProcessTree(child, signal) {
    return new Promise((complete, reject) => {
      if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
        complete();
        return;
      }

      kill(child.pid, signal, (error) => {
        if (error && error.code !== 'ESRCH') {
          reject(new Error(`Failed to send ${signal} to process ${child.pid}: ${error.message}`));
        } else {
          complete();
        }
      });
    });
  }

  waitForProcessExit(child, timeout) {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);

    return new Promise((complete) => {
      const timer = setTimeout(() => {
        child.off('exit', onExit);
        complete(false);
      }, timeout);
      function onExit() {
        clearTimeout(timer);
        complete(true);
      }
      child.once('exit', onExit);
    });
  }

  async stop(child) {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;

    this.expectedStops.add(child);
    try {
      await this.killProcessTree(child, 'SIGTERM');
      if (await this.waitForProcessExit(child, 5_000)) return;

      console.warn(`Process ${child.pid} did not stop after SIGTERM; sending SIGKILL`);
      await this.killProcessTree(child, 'SIGKILL');
      if (!(await this.waitForProcessExit(child, 2_000))) {
        throw new Error(`Process ${child.pid} did not exit after SIGKILL`);
      }
    } catch (error) {
      this.expectedStops.delete(child);
      throw error;
    }
  }

  async stopAll() {
    const processes = [...this.processes];
    let nextProcess = 0;
    let clean = true;

    const stopNext = async () => {
      while (nextProcess < processes.length) {
        const child = processes[nextProcess];
        nextProcess += 1;
        try {
          await this.stop(child);
        } catch (error) {
          clean = false;
          console.error(error.message);
        }
      }
    };

    const workerCount = Math.min(this.stopConcurrency, processes.length);
    await Promise.all(Array.from({ length: workerCount }, () => stopNext()));
    return clean;
  }
}

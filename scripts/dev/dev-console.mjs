import { createInterface } from 'node:readline';

export class DevConsole {
  constructor({ rendererManager, electronManager, processManager, onExit }) {
    this.rendererManager = rendererManager;
    this.electronManager = electronManager;
    this.processManager = processManager;
    this.onExit = onExit;
    this.readline = undefined;
    this.commandQueue = Promise.resolve();
  }

  printHelp() {
    console.log(`
Commands:
  list                 Show renderer and Electron process states
  start <windowId>     Start a renderer
  stop <windowId>      Stop a renderer
  restart <windowId>   Restart a renderer
  restart electron     Restart the Electron process
  start all            Start all renderers
  stop all             Stop optional renderers
  help                 Show this help
  quit                 Stop all processes and exit
`);
  }

  async handleCommand(input) {
    const [command, windowId] = input.trim().split(/\s+/);
    if (!command) return;

    if (command === 'list') {
      this.rendererManager.list();
      this.electronManager.list();
    } else if (command === 'start' && windowId === 'all') {
      this.rendererManager.startInBackground(this.rendererManager.windowIds());
    } else if (command === 'stop' && windowId === 'all') {
      await this.rendererManager.stopOptional();
    } else if (command === 'start' && windowId) {
      await this.rendererManager.start(windowId);
    } else if (command === 'stop' && windowId) {
      await this.rendererManager.stop(windowId);
    } else if (command === 'restart' && windowId === 'electron') {
      await this.electronManager.queueRestart();
    } else if (command === 'restart' && windowId) {
      if (await this.rendererManager.stop(windowId, true)) await this.rendererManager.start(windowId);
    } else if (command === 'help') {
      this.printHelp();
    } else if (command === 'quit' || command === 'exit') {
      await this.onExit();
    } else {
      console.log(`Unknown command: ${input}`);
      this.printHelp();
    }
  }

  start() {
    this.printHelp();
    this.readline = createInterface({ input: process.stdin, output: process.stdout });
    this.readline.setPrompt('dev> ');
    this.processManager.setPromptRefresher(() => this.readline?.prompt(true));
    this.readline.on('line', (line) => {
      this.commandQueue = this.commandQueue
        .then(() => this.handleCommand(line))
        .catch((error) => console.error(error))
        .finally(() => this.readline?.prompt());
    });
    this.readline.on('SIGINT', () => void this.onExit());
    this.readline.prompt();
  }

  close() {
    this.processManager.setPromptRefresher(undefined);
    this.readline?.close();
  }
}

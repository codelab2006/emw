import { createConnection, createServer } from 'node:net';

export function isPortAvailable(port) {
  return new Promise((complete, reject) => {
    const server = createServer();

    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        complete(false);
      } else {
        reject(error);
      }
    });
    server.listen(port, 'localhost', () => {
      server.close((error) => (error ? reject(error) : complete(true)));
    });
  });
}

export function isPortListening(port) {
  return new Promise((complete) => {
    const socket = createConnection({ host: 'localhost', port });
    let settled = false;

    function finish(listening) {
      if (settled) return;
      settled = true;
      socket.destroy();
      complete(listening);
    }

    socket.setTimeout(1_000);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

export async function waitFor(check, { timeout = 30_000, shouldContinue = () => true } = {}) {
  const deadline = Date.now() + timeout;
  while (shouldContinue() && Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((complete) => setTimeout(complete, 100));
  }
  return false;
}

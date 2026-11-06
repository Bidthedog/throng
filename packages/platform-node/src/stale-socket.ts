import { lstat, unlink } from 'node:fs/promises';
import { connect } from 'node:net';
import { logExpected } from '@throng/core';

/**
 * Remove a socket file left by a process that crashed, so it cannot stop the next start (062 FR-011). A socket something
 * answers on is left alone: that is the "already running" case, which the following `listen` reports as it always has.
 * A second start racing this one can still lose its socket in the moment between the probe and the unlink; the instance
 * guard's own connect then finds no one and retries. Anything that is not a socket path is none of this function's business, which makes it a no-op for a Windows pipe.
 */
export async function clearStaleSocket(address: string): Promise<void> {
  if (!address.startsWith('/')) return;
  const info = await lstat(address).catch((error: unknown) => {
    logExpected('stale-socket: stat socket', 'no socket file is the ordinary case after a clean exit', error);
    return null;
  });
  if (info === null || !info.isSocket()) return;
  const live = await new Promise<boolean>((resolve) => {
    const socket = connect(address);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    // Only "nobody is listening" makes it stale: a socket throng may not reach is not throng's to remove.
    socket.once('error', (error) => resolve((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED'));
  });
  if (!live) {
    await unlink(address).catch((error: unknown) => {
      logExpected('stale-socket: remove stale socket', 'a second start racing this one may already have removed it', error);
    });
  }
}

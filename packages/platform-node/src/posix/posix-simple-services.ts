import { stat } from 'node:fs/promises';
import os from 'node:os';
import process from 'node:process';
import type { Holder, IDirectoryLock, IElevationState, LockHandle } from '@throng/core';
import { logExpected } from '@throng/core';

/**
 * A POSIX platform has no elevation model throng takes part in: main refuses to start as root (062 FR-019), and `sudo`
 * inside a terminal is the user's own affair. The interface's answer is what hides every elevation control (FR-008).
 */
export class PosixElevation implements IElevationState {
  isElevated(): boolean {
    return false;
  }
}

/** There is nothing to hand a process back to, because nothing is ever elevated. */
export class NoDeElevatedLauncher {
  isAvailable(): boolean {
    return false;
  }

  launch(_file: string, _args: string[], report?: (reason: string) => void): void {
    report?.('de-elevation does not exist on this platform');
  }
}

function fail(message: string, code: string): Error {
  const error: NodeJS.ErrnoException = new Error(message);
  error.code = code;
  return error;
}

/**
 * A folder cannot be held against deletion on a POSIX system: a running process's working directory stops neither
 * `rmdir` nor `rename`. So `acquire` validates and records, with no helper process, and the difference is in the
 * platform's known-differences page (062 contracts/platform-services.md). The contract suite runs with its hold
 * assertions off for this class.
 */
export class PosixDirectoryLock implements IDirectoryLock {
  private readonly held = new Set<LockHandle>();

  async acquire(absPath: string): Promise<LockHandle> {
    // Async: a folder on a stuck mount must not stop the daemon's event loop.
    const info = await stat(absPath).catch((error: unknown) => {
      logExpected('posix-simple-services: stat folder to hold', 'a folder deleted or never created is refused just below with ENOENT, which the caller reports', error);
      return null;
    });
    if (info === null) throw fail(`Cannot use "${absPath}": the path does not exist`, 'ENOENT');
    if (!info.isDirectory()) throw fail(`Cannot use "${absPath}": not a directory`, 'ENOTDIR');
    const handle: LockHandle = { path: absPath };
    this.held.add(handle);
    return handle;
  }

  release(handle: LockHandle): Promise<void> {
    this.held.delete(handle);
    return Promise.resolve();
  }

  heldPids(): readonly { readonly path: string; readonly pid: number }[] {
    return [];
  }
}

/** Who else holds a path: not identified, as on Windows today (#210). */
export function posixLookupHolder(_absPath: string): Promise<Holder | undefined> {
  return Promise.resolve(undefined);
}

/** The refusal main shows when started as root (062 FR-019), or null. */
export function posixStartupRefusal(uid: number | undefined = process.getuid?.()): string | null {
  if (uid !== 0) return null;
  const user = os.userInfo().username;
  return (
    `throng will not run as ${user}. Start it as your normal user, and use sudo inside a terminal when a command needs it.`
  );
}

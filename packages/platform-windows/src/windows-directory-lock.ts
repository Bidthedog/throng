import { spawn, type ChildProcess } from 'node:child_process';
import { renameSync, statSync } from 'node:fs';
import process from 'node:process';

/** Wait `ms` on a timer — never the thread (051 R7): the daemon serves every terminal meanwhile. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
import { logCaught, logExpected, type IDirectoryLock, type LockHandle } from '@throng/core';
import { watchChild } from '@throng/platform-node';
import { consoleLog } from './console-log.js';

/**
 * Windows `IDirectoryLock` (005 Phase C, FR-022). Holds a folder so the OS refuses
 * to delete or move it, without blocking reads/writes of files inside.
 *
 * Mechanism: a tiny helper process is spawned with its **current directory set to
 * the locked folder**. Windows refuses to delete or rename a directory that is a
 * running process's working directory, so the folder is held for the helper's
 * lifetime — yet files inside remain freely writable. Pure Node (no native addon /
 * no FFI), which `fs.open`'s share flags can't achieve. The helper exits when its
 * parent (the daemon) is gone, so an unexpected daemon death releases every lock.
 */
const HELPER_SCRIPT =
  // chdir explicitly into the folder (more robust than relying solely on the spawn
  // `cwd` option, which some host environments override), then stay alive until the
  // parent process disappears.
  'process.chdir(process.env.THRONG_LOCK_DIR);' +
  'const p=process.ppid;' +
  'setInterval(()=>{try{process.kill(p,0)}catch{process.exit(0)}},1000);' +
  'setInterval(()=>{},1e9);';

/** Tag an internal Error with an errno so it classifies like an OS failure (029, FR-011). */
function withCode(error: Error, code: string): Error {
  (error as NodeJS.ErrnoException).code = code;
  return error;
}

export class WindowsDirectoryLock implements IDirectoryLock {
  private readonly held = new Map<LockHandle, ChildProcess>();
  /** Holders `release` killed: their exit is the one throng asked for. */
  private readonly released = new WeakSet<ChildProcess>();

  async acquire(absPath: string): Promise<LockHandle> {
    let isDir: boolean;
    try {
      isDir = statSync(absPath).isDirectory();
    } catch {
      /*
       * Carries an errno (029). This threw a plain Error, which classified as NOTHING — so the user
       * was shown `Internal error: Cannot lock "…": the path does not exist` verbatim, which is half
       * of what #181 reports. The path really IS missing, and saying so in the OS's own vocabulary is
       * what lets ONE classifier serve both this and `fs`, instead of pattern-matching our own
       * internal message strings somewhere far from here.
       */
      throw withCode(new Error(`Cannot lock "${absPath}": the path does not exist`), 'ENOENT');
    }
    if (!isDir) throw withCode(new Error(`Cannot lock "${absPath}": not a directory`), 'ENOTDIR');

    const child = spawn(process.execPath, ['-e', HELPER_SCRIPT], {
      cwd: absPath,
      env: { ...process.env, THRONG_LOCK_DIR: absPath },
      windowsHide: true,
      stdio: 'ignore',
    });
    // 066 FR-008 — the holder lives until released; any other exit means the folder is no longer held.
    // Warn rather than fatal: losing one lock degrades a file operation, it crashes nothing.
    watchChild(child, {
      name: `directory lock holder (${absPath})`,
      longLived: false,
      log: consoleLog,
      expectedExit: () => (this.released.has(child) ? 'the lock was released' : undefined),
    });
    // Let the OS finish creating the process so its cwd lock is in effect before
    // this returns (the holder is established at process creation).
    await sleep(30);
    if (typeof child.pid !== 'number') {
      throw new Error(`Cannot lock "${absPath}": failed to start the lock holder`);
    }
    const handle: LockHandle = { path: absPath };
    this.held.set(handle, child);
    return handle;
  }

  heldPids(): { path: string; pid: number }[] {
    return [...this.held].flatMap(([h, child]) => (typeof child.pid === 'number' ? [{ path: h.path, pid: child.pid }] : []));
  }

  async release(handle: LockHandle): Promise<void> {
    const child = this.held.get(handle);
    if (!child) return; // idempotent / unknown handle → no-op
    this.held.delete(handle);
    this.released.add(child);
    try {
      child.kill(); // SIGTERM → TerminateProcess on Windows (forceful)
    } catch (error) {
      logExpected('windows-directory-lock: kill holder', 'the holder exits by itself once the daemon that spawned it is gone, so it may already be dead', error);
    }
    // The folder is the holder's cwd, so it stays locked until the OS reclaims the
    // handle. `kill` is async, and — critically — Windows keeps the cwd handle for
    // a short moment *after* the process is already dead, so waiting on process
    // liveness returns too early. Instead poll the folder itself with a
    // non-destructive rename-to-self: it fails (EBUSY/EPERM) while the handle is
    // held and succeeds once released, so on return the directory is genuinely
    // free to delete/move. Bounded so a stuck handle can't hang the caller.
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      try {
        renameSync(handle.path, handle.path);
        return; // rename-to-self succeeded → the OS has released the directory
      } catch (error) {
        // ENOENT → the folder is already gone, so it is certainly not locked.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        logExpected('windows-directory-lock: probe release', 'Windows holds the cwd handle briefly after the holder dies, so rename-to-self fails until it lets go', error);
      }
      await sleep(15);
    }
    logCaught('windows-directory-lock: release', `"${handle.path}" was still held 3000 ms after its holder was killed`);
  }
}

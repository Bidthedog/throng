/**
 * Real processes for the POSIX contract suites (070 T023–T025), shared by Linux's and macOS's test files so each
 * platform's run starts the same processes the same way.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A pid far above any the kernel hands out on either platform. */
export const UNUSED_PID = 0x7ffffff0;

const exited = (child: ChildProcess): Promise<void> =>
  child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise((resolve) => child.once('exit', () => resolve()));

function stopper(child: ChildProcess): () => Promise<void> {
  return async () => {
    child.kill('SIGKILL');
    await exited(child);
  };
}

const spawned = (child: ChildProcess): Promise<void> =>
  new Promise((resolve, reject) => {
    child.once('spawn', () => resolve());
    child.once('error', reject);
  });

/** Whether `pid` names a running process this user may signal. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A `sleep` started in a fresh folder; the folder is the OS's spelling of it (`/private/var` on macOS). */
export async function startInFolder(): Promise<{ pid: number; dir: string; stop(): Promise<void> }> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'throng-cwd-')));
  const child = spawn('sleep', ['30'], { cwd: dir, stdio: 'ignore' });
  await spawned(child);
  const stop = stopper(child);
  return {
    pid: child.pid!,
    dir,
    stop: async () => {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A process with exactly `argv`. */
export async function startWithArgv(argv: readonly string[]): Promise<{ pid: number; stop(): Promise<void> }> {
  const child = spawn(argv[0]!, argv.slice(1), { stdio: 'ignore' });
  await spawned(child);
  return { pid: child.pid!, stop: stopper(child) };
}

/** A long-running child of this process. */
export function startChild(): Promise<{ pid: number; stop(): Promise<void> }> {
  return startWithArgv(['sleep', '30']);
}

/** A `sleep` whose parent shell has exited, so init, systemd or launchd has adopted it. */
export async function startOrphan(): Promise<{ pid: number; stop(): Promise<void> }> {
  const shell = spawn('/bin/sh', ['-c', 'sleep 30 >/dev/null 2>&1 & echo $!'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const pid = await new Promise<number>((resolve, reject) => {
    let out = '';
    shell.stdout!.on('data', (chunk: Buffer) => (out += String(chunk)));
    shell.once('error', reject);
    shell.once('exit', () => resolve(Number(out.trim())));
  });
  // The shell has exited, and the kernel reparents a child as part of its parent's exit, so it is adopted already.
  return {
    pid,
    stop: async () => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already ended, which is what the orphan contract asks for.
      }
      for (let waited = 0; isAlive(pid) && waited < 2000; waited += 25) await new Promise((r) => setTimeout(r, 25));
    },
  };
}

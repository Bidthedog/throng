import { connect, createServer, type Server, type Socket } from 'node:net';
import {
  copyIdentity,
  formatLaunchMessage,
  isSameCopy,
  parseLaunchMessage,
  type DifferentCopyNotice,
  type LaunchMessage,
} from '@throng/core';

/**
 * One running throng per user (058 FR-018, FR-018b; contracts/instance-lock.md; research D5).
 *
 * Replaces the bare `requestSingleInstanceLock()` guard. Electron's lock is keyed to the userData
 * folder, so `--user-data-dir` (or a copy whose userData differs) ran a second instance beside the
 * first. The lock here is a named pipe derived from the daemon's namespace instead — `listen` on a
 * pipe that already has an instance fails with `EADDRINUSE`, atomically — and it carries the
 * launching copy's identity, which the different-copy notice needs.
 *
 * The primary ALSO takes Electron's lock, because that is the only lock a pre-058 release holds: an
 * older copy started second loses it and arrives here as `second-instance`; an older copy already
 * running makes this one yield.
 *
 * The OS edges that are not the pipe — Electron's lock, the window, the notice, the log — are
 * injected (Principle IX), so `tests/integration/instance-guard.test.ts` drives it on real pipes.
 */

/** Electron's single-instance lock, as the guard needs it. */
export interface LegacyInstanceLock {
  /** `app.requestSingleInstanceLock()`. */
  request(): boolean;
  /** `app.on('second-instance', (_e, argv) => …)` — `argv[0]` is the launched executable. */
  onSecondInstance(listener: (argv: readonly string[]) => void): void;
}

export interface InstanceGuardDeps {
  /** The instance-lock pipe — `instanceLockName(<namespace>)`. */
  readonly lockName: string;
  /** This copy: `process.execPath` and the product version. */
  readonly self: { readonly execPath: string; readonly version: string };
  readonly legacyLock: LegacyInstanceLock;
  /** Bring the main window forward (restore, onto a visible display, show, focus). */
  readonly bringForward: (launch: LaunchMessage) => void;
  /** Raise the different-copy notice in the main window. */
  readonly showDifferentCopyNotice: (notice: DifferentCopyNotice) => void;
  readonly log: (message: string) => void;
  /** How long a losing launch waits for the running instance to take its message (contract: 2 s). */
  readonly reachTimeoutMs?: number;
  /** Open a client connection to the lock pipe. Defaults to `net.connect`; injected by tests. */
  readonly connect?: (path: string) => InstanceSocket;
}

/** The part of a client socket the losing launch uses. */
export type InstanceSocket = Pick<Socket, 'on' | 'end' | 'destroy'>;

/**
 * - `primary` — this launch is the running instance; carry on starting.
 * - `secondary` — another copy of this feature is running and has been told; quit.
 * - `yields-to-legacy` — a pre-058 copy is running; quit, and it brings itself forward.
 * - `unreachable` — an instance is running that this launch may not connect to: one started as
 *   administrator, whose pipe a normal launch is refused. Still never a second instance — but
 *   nothing comes forward, so the caller must tell the user before it quits.
 */
export type InstanceRole = 'primary' | 'secondary' | 'yields-to-legacy' | 'unreachable';

/** Connect errors meaning "it is there, and you may not talk to it". */
const REFUSED = new Set(['EPERM', 'EACCES']);

export interface InstanceGuard {
  acquire(): Promise<InstanceRole>;
  /** Close the pipe, if held. Idempotent. */
  release(): Promise<void>;
}

const DEFAULT_REACH_TIMEOUT_MS = 2000;
/** One launch message is a short line; anything longer is not one, and is dropped. */
const MAX_LINE_BYTES = 64 * 1024;

export function createInstanceGuard(deps: InstanceGuardDeps): InstanceGuard {
  const self = copyIdentity(deps.self.execPath, deps.self.version);
  let server: Server | undefined;

  function onLaunch(launch: LaunchMessage): void {
    deps.bringForward(launch);
    const launched = copyIdentity(launch.execPath, launch.version ?? '');
    if (isSameCopy(self, launched)) return;
    deps.showDifferentCopyNotice({
      runningRoot: self.installRoot,
      runningVersion: self.version,
      launchedRoot: launched.installRoot,
    });
  }

  function serve(socket: Socket): void {
    let buffered = '';
    let handled = false;
    socket.setEncoding('utf8');
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk: string) => {
      if (handled) return;
      buffered += chunk;
      const newline = buffered.indexOf('\n');
      if (newline === -1 && buffered.length < MAX_LINE_BYTES) return;
      handled = true;
      const launch = parseLaunchMessage(newline === -1 ? buffered : buffered.slice(0, newline));
      // Closing is the acknowledgement the losing launch waits for.
      socket.end();
      if (launch) onLaunch(launch);
      else deps.log('instance guard: ignored a malformed launch message');
    });
    socket.on('end', () => {
      if (handled) return;
      handled = true;
      socket.end();
      const launch = parseLaunchMessage(buffered);
      if (launch) onLaunch(launch);
    });
  }

  function listen(): Promise<'listening' | 'in-use'> {
    return new Promise((resolve, reject) => {
      const candidate = createServer(serve);
      candidate.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') resolve('in-use');
        else reject(err);
      });
      candidate.listen(deps.lockName, () => {
        candidate.on('error', (err) => deps.log(`instance guard: pipe error: ${String(err)}`));
        server = candidate;
        resolve('listening');
      });
    });
  }

  /**
   * Tell the running instance about this launch, and say what happened — each outcome is logged
   * as what it is, so the log never claims a delivery that did not happen:
   *
   * - `told` — it took the message (closing the connection is its acknowledgement);
   * - `gone` — ENOENT: the holder exited between our failed listen and this connect;
   * - `refused` — EPERM/EACCES: it is running at a higher integrity (as administrator);
   * - `hung` — it did not answer in time. A crashed holder cannot hold a pipe, so it is hung, and
   *   is not overridden;
   * - `failed` — any other connect error.
   */
  function deliver(): Promise<'told' | 'gone' | 'refused' | 'hung' | 'failed'> {
    const timeoutMs = deps.reachTimeoutMs ?? DEFAULT_REACH_TIMEOUT_MS;
    const open = deps.connect ?? ((path: string): InstanceSocket => connect(path));
    return new Promise((resolve) => {
      let settled = false;
      const settle = (outcome: 'told' | 'gone' | 'refused' | 'hung' | 'failed', message: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        deps.log(`instance guard: ${message}`);
        resolve(outcome);
      };
      const socket = open(deps.lockName);
      const timer = setTimeout(() => {
        socket.destroy();
        settle('hung', `the running instance did not answer within ${timeoutMs} ms; not starting`);
      }, timeoutMs);
      socket.on('error', (err: NodeJS.ErrnoException) => {
        socket.destroy();
        if (err.code === 'ENOENT') settle('gone', 'the running instance exited before it could be told');
        else if (err.code && REFUSED.has(err.code)) {
          settle('refused', `the running instance refused this launch (${err.code}) - it is running as administrator`);
        } else settle('failed', `could not reach the running instance (${err.code ?? String(err)}); not starting`);
      });
      socket.on('close', () => settle('told', 'told the running instance about this launch'));
      socket.end(formatLaunchMessage({ execPath: deps.self.execPath, version: deps.self.version }));
    });
  }

  async function release(): Promise<void> {
    const held = server;
    server = undefined;
    if (held) await new Promise<void>((resolve) => held.close(() => resolve()));
  }

  async function acquire(): Promise<InstanceRole> {
    // Two attempts: a holder that quits between our failed listen and our connect leaves the pipe
    // free, and the right answer then is to take it rather than to quit with nobody running.
    for (let attempt = 0; attempt < 2; attempt++) {
      if ((await listen()) === 'listening') {
        if (!deps.legacyLock.request()) {
          await release();
          return 'yields-to-legacy';
        }
        deps.legacyLock.onSecondInstance((argv) => {
          const [execPath] = argv;
          if (typeof execPath === 'string' && execPath !== '') onLaunch({ execPath, version: null });
        });
        return 'primary';
      }
      const outcome = await deliver();
      if (outcome === 'refused') return 'unreachable';
      if (outcome !== 'gone') return 'secondary';
    }
    deps.log('instance guard: the instance lock was busy and then gone twice; not starting');
    return 'secondary';
  }

  return { acquire, release };
}

import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { HEALTH_PING_METHOD, type HealthPongResult, type JsonRpcResponse } from '@throng/ipc-contract';
import { shouldRespawnDaemonElevated } from '@throng/core';

/**
 * Persistent detached daemon lifecycle for the UI main (005 Phase C / US3,
 * research D8/D9). The daemon outlives the UI (Principle III: terminals keep
 * running), so the UI **connects if it is already up, else spawns it detached**
 * and waits until it answers `health.ping`. Single-instancing is handled by the
 * pipe itself: if two UIs spawn at once, only one daemon binds the pipe — the
 * loser exits on EADDRINUSE — and both UIs then connect to the survivor.
 */
export interface EnsureDaemonOptions {
  /** Named pipe the daemon listens on / the UI connects to. */
  pipeName: string;
  /** Absolute path to the daemon's built entry (`daemon/dist/main.js`). */
  daemonEntry: string;
  /**
   * SQLite path for a freshly-spawned daemon (THRONG_DATABASE_PATH). Omit in
   * production so the daemon uses its own default store location; tests pass it
   * to isolate each run.
   */
  databasePath?: string;
  /**
   * Executable that runs the daemon. MUST be host Node, not Electron: the daemon's
   * native modules (better-sqlite3, node-pty) are compiled against the host Node
   * ABI ("no electron-rebuild"), so running it under Electron's Node crashes with a
   * NODE_MODULE_VERSION mismatch. Defaults to `node` (on PATH). NOT `process.execPath`
   * — under Electron that is electron.exe.
   */
  nodePath?: string;
  /** Per-attempt `health.ping` timeout (ms). */
  pingTimeoutMs?: number;
  /** Total time to wait for a spawned daemon to become ready (ms). */
  readyTimeoutMs?: number;
  /** Extra environment for the spawned daemon. */
  env?: Record<string, string>;
  /**
   * Whether THIS app process is elevated (FR-025b). When the app is elevated but the
   * running daemon is not, the daemon is retired and respawned — an elevated app
   * spawns an elevated daemon — so terminals can run "as administrator". Default false.
   */
  appElevated?: boolean;
}

export interface EnsureDaemonResult {
  /** True if this call started the daemon; false if one was already running. */
  spawned: boolean;
  /** True if an outdated daemon was stopped and replaced (build id mismatch). */
  restarted?: boolean;
  /** The spawned child (only when `spawned`), so a caller/test can manage it. */
  child?: ChildProcess;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * One `health.ping` over the pipe. Resolves the pong (pid/buildId) on a well-formed
 * `ok` reply, else `null` (connection failure, malformed reply, or timeout). Never
 * throws or hangs.
 */
export function daemonInfo(pipeName: string, timeoutMs = 800): Promise<HealthPongResult | null> {
  return new Promise<HealthPongResult | null>((resolve) => {
    let settled = false;
    let buffer = '';
    const socket: Socket = connect(pipeName);

    const finish = (result: HealthPongResult | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: HEALTH_PING_METHOD, params: {} })}\n`);
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, nl).trim()) as JsonRpcResponse<HealthPongResult>;
        finish('result' in response && response.result?.status === 'ok' ? response.result : null);
      } catch {
        finish(null);
      }
    });
    socket.on('error', () => finish(null));
  });
}

/** True if the daemon answers `health.ping`. */
export async function pingDaemon(pipeName: string, timeoutMs = 800): Promise<boolean> {
  return (await daemonInfo(pipeName, timeoutMs)) !== null;
}

/** The current build id on disk (dist/BUILD_ID next to the daemon entry), or null. */
function currentBuildId(daemonEntry: string): string | null {
  try {
    return readFileSync(join(dirname(daemonEntry), 'BUILD_ID'), 'utf8').trim();
  } catch {
    return null; // not stamped — can't tell, so never force a restart on this basis
  }
}

/**
 * Connect to the daemon if it is already listening AND running the current build,
 * otherwise spawn it detached and wait until it answers `health.ping`. A running
 * daemon whose build id no longer matches the on-disk build (the code changed since
 * it started) is stopped and replaced — otherwise the UI would talk to stale daemon
 * code across an app update or rebuild. Throws only if a freshly-spawned daemon does
 * not become ready within `readyTimeoutMs`.
 */
export async function ensureDaemon(opts: EnsureDaemonOptions): Promise<EnsureDaemonResult> {
  const pingTimeout = opts.pingTimeoutMs ?? 800;
  const readyTimeout = opts.readyTimeoutMs ?? 15_000;

  const info = await daemonInfo(opts.pipeName, pingTimeout);
  let restarted = false;
  if (info) {
    const onDisk = currentBuildId(opts.daemonEntry);
    // Stale when the running daemon's build id doesn't match the on-disk build.
    // A daemon that reports NO build id at all (`info.buildId === undefined`) is
    // running code OLDER than the build-id handshake itself — it must be retired
    // too, otherwise the mechanism could never replace the very daemon it was
    // added to catch. When the on-disk build is unknown (`onDisk === null`, a
    // partial tsc-only build) we can't compare, so we never force a restart.
    const stale = onDisk !== null && info.buildId !== onDisk;
    // FR-025b: an elevated app must not keep talking to a non-elevated daemon — it
    // can't spawn elevated terminals. Retire it and respawn (an elevated app spawns an
    // elevated daemon). A process's integrity can't be raised in place, so this is the
    // only way; it ends the old daemon's terminals, which the mixed-mode design accepts.
    const elevate = shouldRespawnDaemonElevated(opts.appElevated === true, info.elevated === true);
    if (!stale && !elevate) return { spawned: false }; // up to date — reuse it (Principle III)

    // The running daemon is outdated (or must be replaced to gain elevation): stop it,
    // then wait for the pipe to free so the replacement can bind. Killing it ends its
    // terminals; a fresh one starts clean.
    restarted = true;
    try {
      if (typeof info.pid === 'number') process.kill(info.pid);
    } catch {
      /* already gone */
    }
    const freeBy = Date.now() + 5000;
    while (Date.now() < freeBy && (await daemonInfo(opts.pipeName, pingTimeout))) {
      await sleep(100);
    }
  }

  // Spawn detached + unref'd (host Node — see nodePath) so the daemon outlives this
  // UI process. Strip ELECTRON_RUN_AS_NODE from the inherited env: if the UI itself
  // was launched that way it must NOT leak to the daemon.
  const { ELECTRON_RUN_AS_NODE: _drop, ...inheritedEnv } = process.env;
  // Prefer the exact host Node that launched `npm start` (npm sets this), else
  // `node` on PATH. Never process.execPath — under Electron that is electron.exe,
  // whose Node ABI the daemon's native modules are not built for.
  const nodeExe = opts.nodePath ?? inheritedEnv.npm_node_execpath ?? 'node';
  const child = spawn(nodeExe, [opts.daemonEntry], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...inheritedEnv,
      THRONG_PIPE_NAME: opts.pipeName,
      ...(opts.databasePath ? { THRONG_DATABASE_PATH: opts.databasePath } : {}),
      ...opts.env,
    },
  });
  child.unref();

  // Poll until it (or the race winner) is answering, bounded by readyTimeout.
  const deadline = Date.now() + readyTimeout;
  while (Date.now() < deadline) {
    if (await pingDaemon(opts.pipeName, pingTimeout)) return { spawned: true, restarted, child };
    await sleep(150);
  }
  throw new Error(`Daemon did not become ready on "${opts.pipeName}" within ${readyTimeout}ms`);
}

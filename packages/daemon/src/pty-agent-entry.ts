/**
 * De-elevated PTY agent entry point (FR-025c). Runs as a SEPARATE process at the
 * interactive user's (medium) integrity — launched by the elevated daemon via the
 * OS de-elevated launcher — and hosts a real `NodePtyHost`, so every terminal it
 * spawns natively runs at medium integrity (it creates its own ConPTY). It connects
 * back to the daemon's named pipe (path in argv[2]) and speaks the line-JSON
 * {@link AgentCommand}/{@link AgentEvent} protocol. Plain Node (node-pty ABI), never
 * loaded in the UI/Electron process.
 *
 * DIAGNOSTICS (019 #94 follow-up): this process is detached, has no console, and its
 * stdout/stderr go nowhere — so a crash AFTER it connects (the observed failure) is
 * invisible. Everything below is wired to a durable `%TEMP%/throng-agent-<pid>.log`
 * (see {@link createAgentLogger}) so the next elevated run reveals the true cause. The
 * most likely crash is the native node-pty ConPTY spawn inside a borrowed-token
 * context — that path is bracketed with a BEFORE/AFTER marker so its signature in the
 * log is a `start` line with no following `started`/`exit`/`error` line.
 */
import 'reflect-metadata';
import { createServer, type Socket } from 'node:net';
import process from 'node:process';
import { NodePtyHost } from '@throng/platform-windows';
import type { PtyHandle } from '@throng/core';
import { encodeLine, type AgentCommand, type AgentEvent } from './pty-agent-protocol.js';
import { createAgentLogger } from './pty-agent-log.js';
import { probeErrorMeansDaemonGone } from './pty-agent-liveness.js';

const logger = createAgentLogger(process.pid);
const log = (message: string): void => logger.log(message);
const errText = (e: unknown): string =>
  e instanceof Error ? e.stack ?? e.message : String(e);

// Tee this process's own stdout/stderr into the durable log. The agent has no console,
// so a node warning or a JS-level banner would otherwise vanish. NOTE: a NATIVE
// access-violation banner is written below the JS layer (straight to fd 2) and cannot
// be captured here — its signature is instead the ABSENCE of a post-`start` line (see
// DEBUG-agent-crash.md).
function tee(stream: NodeJS.WriteStream, name: string): void {
  const original = stream.write.bind(stream) as (...a: unknown[]) => boolean;
  stream.write = function (chunk: unknown, ...rest: unknown[]): boolean {
    try {
      const trimmed = String(chunk).replace(/\r?\n$/, '');
      if (trimmed) log(`[${name}] ${trimmed}`);
    } catch {
      /* never let teeing break real output */
    }
    return original(chunk, ...rest);
  } as typeof stream.write;
}
tee(process.stdout, 'stdout');
tee(process.stderr, 'stderr');

process.on('uncaughtException', (err) => {
  log(`FATAL uncaughtException: ${errText(err)}`);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  log(`unhandledRejection: ${errText(reason)}`);
});
process.on('exit', (code) => {
  log(`process exit code=${code}`);
});

log(
  `agent start pid=${process.pid} argv=${JSON.stringify(process.argv)} cwd=${process.cwd()} ` +
    `execPath=${process.execPath} node=${process.version} platform=${process.platform} ` +
    `ELECTRON_RUN_AS_NODE=${process.env.ELECTRON_RUN_AS_NODE ?? '(unset)'} ` +
    `USERNAME=${process.env.USERNAME ?? '(unset)'} log=${logger.path}`,
);

const pipeName = process.argv[2];
if (!pipeName) {
  log('FATAL missing pipe name argument (argv[2]); exiting 2');
  process.stderr.write('pty-agent: missing pipe name argument\n');
  process.exit(2);
}

// No de-elevator here — the agent IS the de-elevated context, so its node-pty spawns
// natively at this process's (medium) integrity. The construction lazily loads the
// node-pty native module; if the ABI/borrowed-token context makes that fail, this is
// the first place it can, so it is bracketed and logged before we listen.
let pty: NodePtyHost;
try {
  log('constructing NodePtyHost (lazily loads the node-pty native module)');
  pty = new NodePtyHost();
  log('NodePtyHost constructed OK (node-pty loaded)');
} catch (error) {
  log(`FATAL constructing NodePtyHost: ${errText(error)}`);
  process.stderr.write(`pty-agent: failed to load node-pty: ${(error as Error).message}\n`);
  process.exit(3);
}

const handles = new Map<number, PtyHandle>();
// The AGENT owns the pipe server (it is created at medium integrity, so the elevated
// daemon can connect DOWN to it — a medium client can't connect up to an elevated
// server's pipe, No-Write-Up). One daemon connection at a time.
let sock: Socket | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;

function send(ev: AgentEvent): void {
  sock?.write(encodeLine(ev));
}

/**
 * Reap every terminal (closing each ConPTY host) and exit. Called when the daemon
 * disconnects OR is detected dead — so the agent never lingers holding orphaned
 * `conhost.exe` processes after its daemon is gone (the orphan we observed, T134).
 */
function shutdown(): never {
  log('shutdown: disposing pty host and exiting 0');
  if (heartbeat) clearInterval(heartbeat);
  try {
    pty.dispose();
  } catch (error) {
    log(`shutdown: pty.dispose threw (ignored): ${errText(error)}`);
  }
  process.exit(0);
}

/**
 * Self-terminate if the daemon process vanishes without a clean pipe close (e.g. a
 * hard kill). `process.kill(pid, 0)` is a no-op liveness probe that throws when it
 * can't be delivered — but the throw only means the daemon is GONE when its code is
 * `ESRCH`. When THIS agent is de-elevated (medium integrity) and the daemon is elevated
 * (high), the probe throws `EPERM` on every tick — Windows won't let a medium process
 * signal a high one — even though the daemon is alive. Treating that as death is what
 * made de-elevated terminals self-terminate ~3s after connecting (#94), so only `ESRCH`
 * shuts us down; the pipe-close handler remains the real cross-integrity death signal.
 * See {@link probeErrorMeansDaemonGone}.
 */
function watchDaemon(daemonPid: number): void {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = setInterval(() => {
    try {
      process.kill(daemonPid, 0);
    } catch (err) {
      if (!probeErrorMeansDaemonGone(err)) {
        // EPERM across the integrity boundary → the daemon is alive, we just can't
        // signal it. Keep running; the pipe close will tell us if it really dies.
        return;
      }
      log(`watchDaemon: daemon pid ${daemonPid} vanished; shutting down`);
      shutdown();
    }
  }, 3000);
  heartbeat.unref();
}

function onCommand(msg: AgentCommand): void {
  switch (msg.op) {
    case 'hello': {
      log(`cmd hello daemonPid=${msg.daemonPid}`);
      watchDaemon(msg.daemonPid);
      break;
    }
    case 'start': {
      log(
        `cmd start key=${msg.key} file=${msg.file} args=${JSON.stringify(msg.args)} ` +
          `cwd=${msg.cwd} cols=${msg.cols} rows=${msg.rows}`,
      );
      try {
        log(
          `about to pty.start (native ConPTY spawn) key=${msg.key} — if the log ENDS ` +
            `here with no 'started'/'exit'/'error' line, the crash is inside the native ` +
            `node-pty ConPTY spawn`,
        );
        const h = pty.start({
          file: msg.file,
          args: msg.args,
          cwd: msg.cwd,
          cols: msg.cols,
          rows: msg.rows,
          env: msg.env,
        });
        log(`pty.start returned key=${msg.key} pid=${h.pid}`);
        handles.set(msg.key, h);
        pty.onData(h, (data) => send({ ev: 'data', key: msg.key, data }));
        pty.onExit(h, (e) => {
          log(`terminal exit key=${msg.key} code=${e.code} signal=${e.signal ?? ''}`);
          send({ ev: 'exit', key: msg.key, code: e.code, signal: e.signal });
          handles.delete(msg.key);
        });
        send({ ev: 'started', key: msg.key, pid: h.pid });
        log(`sent started key=${msg.key} pid=${h.pid}`);
      } catch (error) {
        log(`ERROR pty.start threw key=${msg.key}: ${errText(error)}`);
        send({ ev: 'error', key: msg.key, message: (error as Error).message });
      }
      break;
    }
    case 'write': {
      const h = handles.get(msg.key);
      if (h) pty.write(h, msg.data);
      break;
    }
    case 'resize': {
      const h = handles.get(msg.key);
      if (h) pty.resize(h, msg.cols, msg.rows);
      break;
    }
    case 'kill': {
      log(`cmd kill key=${msg.key}`);
      const h = handles.get(msg.key);
      if (h) pty.kill(h);
      break;
    }
    case 'childpids': {
      const h = handles.get(msg.key);
      let pids: number[] = [];
      try {
        pids = h ? pty.listChildPids(h) : [];
      } catch (error) {
        log(`childpids error key=${msg.key}: ${errText(error)}`);
        pids = [];
      }
      send({ ev: 'childpids', key: msg.key, reqId: msg.reqId, pids });
      break;
    }
  }
}

const server = createServer((connection) => {
  log('daemon connected on pipe');
  sock = connection;
  let buffer = '';
  connection.setEncoding('utf8');
  send({ ev: 'ready' });
  connection.on('data', (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        onCommand(JSON.parse(line) as AgentCommand);
      } catch (error) {
        log(`ignored malformed line (${errText(error)}): ${line.slice(0, 200)}`);
      }
    }
  });
  connection.on('error', (error) => {
    log(`pipe connection error: ${errText(error)}`);
  });
  // When the daemon disconnects, reap every terminal (close each ConPTY host) then
  // exit — never leave orphaned conhost.exe processes behind.
  connection.on('close', () => {
    log('daemon pipe closed → shutdown');
    shutdown();
  });
});
server.on('error', (error) => {
  log(`FATAL pipe server error: ${errText(error)}; exiting 1`);
  process.exit(1);
});
server.listen(pipeName, () => log(`listening on pipe ${pipeName}`));
// Safety net: if no daemon connects within 30s, don't linger.
const idleExit = setTimeout(() => {
  if (!sock) {
    log('no daemon connected within 30s; exiting 0');
    process.exit(0);
  }
}, 30_000);
idleExit.unref();

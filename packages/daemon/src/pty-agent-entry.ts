/**
 * De-elevated PTY agent entry point (FR-025c). Runs as a SEPARATE process at the
 * interactive user's (medium) integrity — launched by the elevated daemon via the
 * OS de-elevated launcher — and hosts a real `NodePtyHost`, so every terminal it
 * spawns natively runs at medium integrity (it creates its own ConPTY). It connects
 * back to the daemon's named pipe (path in argv[2]) and speaks the line-JSON
 * {@link AgentCommand}/{@link AgentEvent} protocol. Plain Node (node-pty ABI), never
 * loaded in the UI/Electron process.
 *
 * DIAGNOSTICS (019 #94 follow-up, 066 FR-017): this process is detached, has no console, and
 * its stdout/stderr go nowhere when it is launched de-elevated — so a crash AFTER it connects
 * is invisible to everything but its own log. That log is a session file in throng's logs
 * folder, named by argv[3] because the de-elevated launch passes no environment (see
 * {@link openAgentLog}). The most likely crash is the native node-pty ConPTY spawn inside a
 * borrowed-token context — that path is bracketed with a BEFORE/AFTER marker so its signature
 * in the log is a `start` line with no following `started`/`exit`/`error` line.
 */
import 'reflect-metadata';
import { createServer, type Socket } from 'node:net';
import process from 'node:process';
import { clearStaleSocket, startPlatform, type PlatformPtyHost } from '@throng/platform';
import { logExpected, logFatal, resolveIpcAddress, type LogLevel } from '@throng/core';
import type { ChildProcess, PtyHandle } from '@throng/core';
import { encodeLine, type AgentCommand, type AgentEvent } from './pty-agent-protocol.js';
import { answerChildPids } from './pty-agent-childpids.js';
import { answerAttachedProcs } from './pty-agent-attached.js';
import { answerCwds } from './pty-agent-cwds.js';
import { describeAgentArgv, describeAgentStart, describeMalformedLine, openAgentLog } from './pty-agent-log.js';
import { probeErrorMeansDaemonGone } from './pty-agent-liveness.js';

// 062: traits first, since the pipe this agent serves is resolved through them.
const platform = startPlatform();
const agentLog = openAgentLog({ arg: process.argv[3], saltArg: process.argv[4], env: process.env, pid: process.pid, startedAt: new Date() });
// `console.*` — including `logFatal` below — lands in the log as well. With no log folder the console
// is left alone: stderr is what the daemon's `watchChild` reads for a plainly spawned agent.
agentLog?.attachConsole();
const log = (message: string, level: LogLevel = 'info'): void => {
  if (agentLog) agentLog.log(level, message);
  // No folder: a failure still reaches stderr, the tail the parent's `watchChild` records.
  else if (level === 'fatal' || level === 'error') console.error(`pty-agent: ${message}`);
};
const errText = (e: unknown): string =>
  e instanceof Error ? e.stack ?? e.message : String(e);

// Tee this process's own stdout/stderr into the durable log. The agent has no console,
// so a node warning or a JS-level banner would otherwise vanish. NOTE: a NATIVE
// access-violation banner is written below the JS layer (straight to fd 2) and cannot
// be captured here — its signature is instead the ABSENCE of a post-`start` line (see
// DEBUG-agent-crash.md). The file log reports its OWN failures to stderr (`throng log: …`);
// those are not fed back into it, or a failing write would loop.
function tee(stream: NodeJS.WriteStream, name: string, level: LogLevel): void {
  const original = stream.write.bind(stream) as (...a: unknown[]) => boolean;
  let teeing = false;
  stream.write = function (chunk: unknown, ...rest: unknown[]): boolean {
    if (!teeing) {
      teeing = true;
      try {
        const trimmed = String(chunk).replace(/\r?\n$/, '');
        if (trimmed && !trimmed.startsWith('throng log:')) log(`[${name}] ${trimmed}`, level);
      } catch (error) {
        logExpected('pty-agent tee', 'a chunk that cannot be read as text is still written to the stream', error);
      } finally {
        teeing = false;
      }
    }
    return original(chunk, ...rest);
  } as typeof stream.write;
}
if (agentLog) {
  tee(process.stdout, 'stdout', 'info');
  tee(process.stderr, 'stderr', 'warn');
}

process.on('uncaughtException', (err) => {
  logFatal('pty-agent', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  log(`unhandledRejection: ${errText(reason)}`, 'error');
});
process.on('exit', (code) => {
  log(`process exit code=${code}`);
  agentLog?.close();
});

log(
  `agent start pid=${process.pid} argv=${describeAgentArgv(process.argv)} cwd=${process.cwd()} ` +
    `execPath=${process.execPath} node=${process.version} platform=${process.platform} ` +
    `ELECTRON_RUN_AS_NODE=${process.env.ELECTRON_RUN_AS_NODE ?? '(unset)'} ` +
    `USERNAME=${process.env.USERNAME ?? '(unset)'} log=${agentLog?.path ?? '(none)'}`,
);

const pipeName = process.argv[2];
if (!pipeName) {
  log('missing pipe name argument (argv[2]); exiting 2', 'fatal');
  process.stderr.write('pty-agent: missing pipe name argument\n');
  process.exit(2);
}

// No de-elevator here — the agent IS the de-elevated context, so its node-pty spawns
// natively at this process's (medium) integrity. The construction lazily loads the
// node-pty native module; if the ABI/borrowed-token context makes that fail, this is
// the first place it can, so it is bracketed and logged before we listen.
let pty: PlatformPtyHost;
// Binds its OS calls lazily, on the first read — constructing it cannot fail here.
const processCwd = platform.processCwd();
try {
  log('constructing NodePtyHost (lazily loads the node-pty native module)');
  pty = platform.ptyHost();
  log('NodePtyHost constructed OK (node-pty loaded)');
} catch (error) {
  log(`constructing NodePtyHost failed: ${errText(error)}`, 'fatal');
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
let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log('shutdown: ending every terminal, escalating any that resist (051 FR-015a), then exiting 0');
  if (heartbeat) clearInterval(heartbeat);
  void pty
    .dispose()
    .catch((error: unknown) => log(`shutdown: pty.dispose failed (ignored): ${errText(error)}`, 'warn'))
    .finally(() => process.exit(0));
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
      log(describeAgentStart(msg));
      try {
        log(
          `about to pty.start (native ConPTY spawn) key=${msg.key} — if the log ENDS ` +
            `here with no 'started'/'exit'/'error' line, the crash is inside the native ` +
            `node-pty ConPTY spawn`,
        );
        const h = pty.start({
          file: msg.file,
          args: msg.args,
          ...(msg.commandLine !== undefined ? { commandLine: msg.commandLine } : {}),
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
        // 055 T101: the console host is attributed after the spawn; tell the daemon when it is known.
        void pty.conhostOf(h.pid).then((conhost) => {
          if (conhost !== null && handles.has(msg.key)) send({ ev: 'conhost', key: msg.key, pid: conhost });
        });
      } catch (error) {
        log(`pty.start threw key=${msg.key}: ${errText(error)}`, 'error');
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
    // 051: the agent's own host ends the terminal and the outcome goes back as `ended`; the agent
    // keeps serving its other terminals meanwhile.
    case 'end': {
      log(`cmd end key=${msg.key} limit=${msg.timeoutMs}ms`);
      const h = handles.get(msg.key);
      void (h ? pty.end(h, msg.timeoutMs) : Promise.resolve()).then(
        () => send({ ev: 'ended', reqId: msg.reqId, ok: true }),
        (error: unknown) => {
          log(`end failed key=${msg.key}: ${errText(error)}`, 'warn');
          send({ ev: 'ended', reqId: msg.reqId, ok: false, reason: (error as Error).message });
        },
      );
      break;
    }
    case 'forceEnd': {
      log(`cmd forceEnd key=${msg.key} limit=${msg.timeoutMs}ms`);
      const h = handles.get(msg.key);
      void (h ? pty.forceEnd(h, msg.timeoutMs) : Promise.resolve({ survivors: [] })).then(({ survivors }) =>
        send({ ev: 'forceEnded', reqId: msg.reqId, survivors }),
      );
      break;
    }
    // 046: async, so the agent keeps serving its other terminals while the snapshot is taken, and a
    // failure is reported as one rather than as an idle-looking empty list (pty-agent-childpids.ts).
    case 'attachedprocs': {
      void answerAttachedProcs(pty.listAttachedProcesses?.bind(pty), (key) => handles.get(key), msg, log).then(send);
      break;
    }
    // 012 / 053 FR-001: the shells' working directories, by key — the daemon cannot read them by pid (pty-agent-cwds.ts).
    case 'cwds': {
      void answerCwds(processCwd, (key) => handles.get(key), msg, log).then(send);
      break;
    }
    case 'childpids': {
      void answerChildPids((h) => pty.probeChildPids(h), handles.get(msg.key), msg, log).then(send);
      break;
    }
    // 025 FR-022: the same descendants, with command lines, for command memory. Async so the
    // agent keeps serving other terminals while the snapshot is taken (FR-019b).
    case 'childprocs': {
      const h = handles.get(msg.key);
      void (async (): Promise<void> => {
        let procs: ChildProcess[];
        let shellStartedAt: number | undefined;
        try {
          // The daemon knows this terminal only by its synthetic `key`, never by the shell's real
          // OS pid — `PtyAgentHost.start` returns `{ pid: key }`. The children we report carry
          // REAL ppids, so a direct child of the shell would never match `key` on the daemon side
          // and command memory would be silently dead for every de-elevated terminal (the normal
          // case on an elevated daemon). Re-parent direct children onto the key so the pure
          // "direct child of the shell" rule (FR-022a) still holds across the seam; grandchildren
          // keep their real ppids and so remain grandchildren.
          const raw = h ? await pty.listChildProcesses(h) : [];
          const shellPid = h?.pid;
          procs = raw.map((c) =>
            shellPid !== undefined && c.ppid === shellPid ? { ...c, ppid: msg.key } : c,
          );
          shellStartedAt = h ? await pty.shellStartedAt?.(h) : undefined;
        } catch (error) {
          log(`childprocs error key=${msg.key}: ${errText(error)}`, 'warn');
          procs = [];
        }
        send({ ev: 'childprocs', key: msg.key, reqId: msg.reqId, procs, ...(shellStartedAt !== undefined ? { shellStartedAt } : {}) });
      })();
      break;
    }
  }
}

const server = createServer((connection) => {
  log('daemon connected on pipe');
  sock = connection;
  let buffer = '';
  connection.setEncoding('utf8');
  send({ ev: 'ready', pid: process.pid });
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
        log(describeMalformedLine(errText(error), line), 'warn');
      }
    }
  });
  connection.on('error', (error) => {
    log(`pipe connection error: ${errText(error)}`, 'warn');
  });
  // When the daemon disconnects, reap every terminal (close each ConPTY host) then
  // exit — never leave orphaned conhost.exe processes behind.
  connection.on('close', () => {
    log('daemon pipe closed → shutdown');
    shutdown();
  });
});
server.on('error', (error) => {
  log(`pipe server error: ${errText(error)}; exiting 1`, 'fatal');
  process.exit(1);
});
void clearStaleSocket(resolveIpcAddress(pipeName)).then(() =>
  server.listen(resolveIpcAddress(pipeName), () => log(`listening on pipe ${pipeName}`)),
);
// Safety net: if no daemon connects within 30s, don't linger.
const idleExit = setTimeout(() => {
  if (!sock) {
    log('no daemon connected within 30s; exiting 0');
    process.exit(0);
  }
}, 30_000);
idleExit.unref();

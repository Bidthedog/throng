/**
 * De-elevated PTY agent entry point (FR-025c). Runs as a SEPARATE process at the
 * interactive user's (medium) integrity — launched by the elevated daemon via the
 * OS de-elevated launcher — and hosts a real `NodePtyHost`, so every terminal it
 * spawns natively runs at medium integrity (it creates its own ConPTY). It connects
 * back to the daemon's named pipe (path in argv[2]) and speaks the line-JSON
 * {@link AgentCommand}/{@link AgentEvent} protocol. Plain Node (node-pty ABI), never
 * loaded in the UI/Electron process.
 */
import 'reflect-metadata';
import { createServer, type Socket } from 'node:net';
import process from 'node:process';
import { NodePtyHost } from '@throng/platform-windows';
import type { PtyHandle } from '@throng/core';
import { encodeLine, type AgentCommand, type AgentEvent } from './pty-agent-protocol.js';

const pipeName = process.argv[2];
if (!pipeName) {
  process.stderr.write('pty-agent: missing pipe name argument\n');
  process.exit(2);
}

// No de-elevator here — the agent IS the de-elevated context, so its node-pty spawns
// natively at this process's (medium) integrity.
const pty = new NodePtyHost();
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
  if (heartbeat) clearInterval(heartbeat);
  try {
    pty.dispose();
  } catch {
    /* best-effort */
  }
  process.exit(0);
}

/**
 * Self-terminate if the daemon process vanishes without a clean pipe close (e.g. a
 * hard kill). `process.kill(pid, 0)` throws ESRCH once the pid is gone; until then it
 * is a no-op liveness probe.
 */
function watchDaemon(daemonPid: number): void {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = setInterval(() => {
    try {
      process.kill(daemonPid, 0);
    } catch {
      shutdown();
    }
  }, 3000);
  heartbeat.unref();
}

function onCommand(msg: AgentCommand): void {
  switch (msg.op) {
    case 'hello': {
      watchDaemon(msg.daemonPid);
      break;
    }
    case 'start': {
      try {
        const h = pty.start({
          file: msg.file,
          args: msg.args,
          cwd: msg.cwd,
          cols: msg.cols,
          rows: msg.rows,
          env: msg.env,
        });
        handles.set(msg.key, h);
        pty.onData(h, (data) => send({ ev: 'data', key: msg.key, data }));
        pty.onExit(h, (e) => {
          send({ ev: 'exit', key: msg.key, code: e.code, signal: e.signal });
          handles.delete(msg.key);
        });
        send({ ev: 'started', key: msg.key, pid: h.pid });
      } catch (error) {
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
      const h = handles.get(msg.key);
      if (h) pty.kill(h);
      break;
    }
    case 'childpids': {
      const h = handles.get(msg.key);
      let pids: number[] = [];
      try {
        pids = h ? pty.listChildPids(h) : [];
      } catch {
        pids = [];
      }
      send({ ev: 'childpids', key: msg.key, reqId: msg.reqId, pids });
      break;
    }
  }
}

const server = createServer((connection) => {
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
      } catch {
        /* ignore malformed line */
      }
    }
  });
  connection.on('error', () => {});
  // When the daemon disconnects, reap every terminal (close each ConPTY host) then
  // exit — never leave orphaned conhost.exe processes behind.
  connection.on('close', () => shutdown());
});
server.on('error', () => process.exit(1));
server.listen(pipeName);
// Safety net: if no daemon connects within 30s, don't linger.
const idleExit = setTimeout(() => {
  if (!sock) process.exit(0);
}, 30_000);
idleExit.unref();

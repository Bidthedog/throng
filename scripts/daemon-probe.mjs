// A standalone client for throng's daemon, for the verification harness (058 FR-021, FR-029).
//
// It is run by the INSTALLED copy's own bundled runtime, as whichever account the check is about, so
// it imports nothing: only Node's built-ins. It speaks the daemon's newline-delimited JSON-RPC over
// the named pipe (packages/ipc-contract), prints ONE JSON line, and exits 0 when everything it was
// asked to prove held, 1 otherwise.
//
//   node daemon-probe.mjs --pipe <name> [--spawn <install root> --config-root <dir> --db <file>]
//                         [--terminal echo|keep] [--list]
//
//   --spawn      start the daemon from <install root> under this runtime, detached, so it outlives the
//                probe (a second account's daemon must still be running when the next step looks).
//   --terminal   echo: run a command in a terminal and read its output back — a terminal works.
//                keep: start a shell that stays open, for another copy to reattach to (FR-021).
//   --list       list the daemon's terminal sessions.
//   --project    create a project of that name in the daemon's store, then list the project names.
//   --list-projects  list the project names in the daemon's store.
import { spawn, spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { existsSync, openSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const pipe = flag('--pipe');
if (!pipe) {
  console.log(JSON.stringify({ ok: false, error: '--pipe is required' }));
  process.exit(2);
}

let nextId = 1;

/** One JSON-RPC call on a fresh connection; rejects on a transport failure, error reply or timeout. */
function call(method, params = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const socket = connect(pipe);
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`${method} timed out`));
    }, timeoutMs);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
      for (const line of buffer.split('\n')) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id !== id) continue;
        clearTimeout(timer);
        socket.destroy();
        if (message.error) reject(new Error(`${method}: ${message.error.message}`));
        else resolve(message.result);
        return;
      }
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function waitForPing(totalMs) {
  const deadline = Date.now() + totalMs;
  let last;
  while (Date.now() < deadline) {
    try {
      return await call('health.ping', {}, 2000);
    } catch (err) {
      last = err;
      await delay(500);
    }
  }
  throw new Error(`the daemon did not answer on ${pipe}: ${last?.message ?? 'no attempt'}`);
}

const result = { ok: false };
let spawned;
let exit;
let daemonLog;
try {
  const root = flag('--spawn');
  if (root) {
    const main = join(root, 'resources', 'app', 'packages', 'daemon', 'dist', 'main.js');
    const env = { ...process.env, THRONG_PIPE_NAME: pipe };
    if (flag('--config-root')) env.THRONG_CONFIG_ROOT = flag('--config-root');
    if (flag('--db')) env.THRONG_DATABASE_PATH = flag('--db');
    // The same call the app makes: the bundled runtime running the packaged daemon, detached. Its
    // output goes to a file this account can write — with stdio ignored, a daemon that dies at start
    // leaves nothing but "connect ENOENT", which names no cause.
    daemonLog = flag('--log') ?? join(tmpdir(), `throng-probe-daemon-${process.pid}.log`);
    // A foreground start first, its output captured directly: a daemon that dies at once does so
    // here, where its exit and every byte it printed are seen, rather than detached where both have
    // been lost. One that is still running after a few seconds is ended and started for real below.
    const sanity = spawnSync(process.execPath, ['-e', 'process.stdout.write(process.version)'], { encoding: 'utf8', timeout: 10000 });
    const foreground = spawnSync(process.execPath, [main], { encoding: 'utf8', env, timeout: 6000, windowsHide: true });
    result.preflight = {
      node: { code: sanity.status, out: sanity.stdout, err: sanity.stderr, error: sanity.error?.message },
      daemon: {
        code: foreground.status,
        signal: foreground.signal,
        error: foreground.error?.message,
        out: (foreground.stdout ?? '').slice(-2000),
        err: (foreground.stderr ?? '').slice(-2000),
      },
    };
    console.error(`[daemon-probe] preflight: ${JSON.stringify(result.preflight)}`);
    const fd = openSync(daemonLog, 'w');
    spawned = spawn(process.execPath, [main], { detached: true, stdio: ['ignore', fd, fd], env, windowsHide: true });
    spawned.on('exit', (code, signal) => {
      exit = { code, signal };
    });
    spawned.unref();
    result.spawnedPid = spawned.pid;
    result.daemonLog = daemonLog;
  }

  let pong;
  try {
    pong = await waitForPing(30000);
  } catch (err) {
    // Say whether the daemon is still alive and what it printed, so a failure names its cause.
    const tail = daemonLog && existsSync(daemonLog) ? readFileSync(daemonLog, 'utf8').split(/\r?\n/).slice(-40).join('\n').trim() : '';
    const state = !spawned ? 'not spawned by this probe' : exit ? `exited (code ${exit.code}, signal ${exit.signal})` : 'still running';
    result.daemonState = state;
    result.daemonLogTail = tail;
    console.error(`[daemon-probe] ${err.message}; daemon ${state}; log ${daemonLog ?? 'none'}:\n${tail || '(empty)'}`);
    throw new Error(`${err.message} — daemon ${state}; its output: ${tail ? tail.slice(-1500) : '(none)'}`, { cause: err });
  }
  Object.assign(result, { pid: pong.pid, elevated: pong.elevated ?? null, buildId: pong.buildId ?? null });

  const cwd = process.env.USERPROFILE ?? homedir();
  const shell = process.env.ComSpec ?? 'cmd.exe';
  const mode = flag('--terminal');
  if (mode) {
    const keep = mode === 'keep';
    const panelId = keep ? 'verify-keep' : 'verify-echo';
    const params = {
      panelId,
      projectId: 'verify-project',
      rootless: true,
      viewId: 'verify-view',
      cols: 80,
      rows: 24,
      launch: { file: shell, args: keep ? ['/k'] : ['/c', 'echo THRONG_VERIFY_OK'], cwd },
    };
    let attached = await call('terminal.attach', params, 20000);
    if (!keep) {
      // The command is short-lived; an implicit re-attach returns what it printed.
      const deadline = Date.now() + 15000;
      while (!String(attached.scrollback ?? '').includes('THRONG_VERIFY_OK') && Date.now() < deadline) {
        await delay(500);
        attached = await call('terminal.attach', { ...params, explicit: false }, 10000);
      }
      result.terminalOutput = String(attached.scrollback ?? '').includes('THRONG_VERIFY_OK');
      result.terminal = result.terminalOutput;
    } else {
      result.terminal = attached.status === 'running';
    }
  }

  // Data in the daemon's own store, for the hand tests: a project made here lands in whichever data
  // folder this daemon was started with (the real %APPDATA%\throng when no --db was given).
  const projectName = flag('--project');
  if (projectName) {
    await call('projects.create', { name: projectName, colour: '#3b82f6', rootFolder: process.env.USERPROFILE ?? homedir() }, 10000);
  }
  if (projectName || argv.includes('--list-projects')) {
    const listed = await call('projects.list', {}, 10000);
    result.projectNames = (listed?.projects ?? []).map((p) => p.name);
  }

  if (argv.includes('--list')) {
    const sessions = await call('terminal.list', {}, 10000);
    result.sessions = JSON.stringify(sessions ?? null);
    result.keepSessionListed = result.sessions.includes('verify-keep');
  }

  result.ok = mode ? result.terminal === true : true;
} catch (err) {
  result.error = err instanceof Error ? err.message : String(err);
}

console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);

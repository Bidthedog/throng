// What the Linux and macOS package harnesses share (063 FR-017, 070 FR-010, research R26): talking to the app's own
// daemon, the core journey, the reattach check, the no-write snapshot, and the step runner both write their verdicts
// through. Extracted from verify-linux-package.mjs with nothing changed in what it does; each harness supplies what
// was module state there — the socket, the log, and how it opens and closes the app.
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** What the core journey's terminal prints, and then looks for in its scrollback. */
export const MARKER = 'THRONG_VERIFY_OK';

/** One JSON-RPC call at a time to the daemon listening on `pipe`, as the window makes them. */
export function createRpc(pipe) {
  return function rpc(method, params = {}, timeoutMs = 20_000) {
    return new Promise((settle, reject) => {
      const socket = connect(pipe);
      let buffer = '';
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      socket.setEncoding('utf8');
      socket.on('connect', () => socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })}\n`));
      socket.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      socket.on('data', (chunk) => {
        buffer += chunk;
        const newline = buffer.indexOf('\n');
        if (newline === -1) return;
        clearTimeout(timer);
        socket.destroy();
        const reply = JSON.parse(buffer.slice(0, newline));
        if (reply.error) reject(new Error(`${method}: ${reply.error.message}`));
        else settle(reply.result);
      });
    });
  };
}

/** The daemon's health, once it answers; a throw naming the last error when it does not within 30 seconds. */
export async function waitForDaemon(rpc) {
  const deadline = Date.now() + 30_000;
  let last;
  while (Date.now() < deadline) {
    try {
      return await rpc('health.ping', {}, 2000);
    } catch (err) {
      last = err;
      await delay(500);
    }
  }
  throw new Error(`the daemon did not answer: ${last?.message}`);
}

/** A folder for a project, under home, where a person keeps one. */
export const projectRoot = (name) => {
  const folder = join(homedir(), 'throng-verify', name);
  mkdirSync(folder, { recursive: true });
  return folder;
};

/** A project goes in, and a terminal runs a command in a real shell on the app's own daemon (SC-001). */
export async function coreJourney(rpc, name) {
  await rpc('projects.create', { name, colour: '#3b82f6', rootFolder: projectRoot(name) });
  const params = {
    panelId: 'verify-echo',
    projectId: 'verify-project',
    rootless: true,
    viewId: 'verify-view',
    cols: 80,
    rows: 24,
    // It stays open: the daemon forgets a session that has exited, scrollback and all, and the next attach starts another.
    launch: { file: '/bin/sh', args: ['-c', `echo ${MARKER}; exec sleep 300`], cwd: homedir() },
  };
  let attached = await rpc('terminal.attach', params);
  const deadline = Date.now() + 15_000;
  while (!String(attached.scrollback ?? '').includes(MARKER) && Date.now() < deadline) {
    await delay(500);
    attached = await rpc('terminal.attach', { ...params, explicit: false });
  }
  return String(attached.scrollback ?? '').includes(MARKER);
}

/** A shell that stays open, for a later step to look for. */
export async function keepTerminal(rpc) {
  const attached = await rpc('terminal.attach', {
    panelId: 'verify-keep',
    projectId: 'verify-project',
    rootless: true,
    viewId: 'verify-view',
    cols: 80,
    rows: 24,
    launch: { file: '/bin/sh', args: [], cwd: homedir() },
  });
  return attached.status === 'running';
}

export const keepIsListed = async (rpc) => JSON.stringify(await rpc('terminal.list', {})).includes('verify-keep');
export const projectNames = async (rpc) => ((await rpc('projects.list', {}))?.projects ?? []).map((p) => p.name);

/**
 * The daemon survives the window, and the next window reuses it, terminal and all (Principle III).
 *
 * @param {{rpc: Function, open: () => Promise<object>, close: (session: object) => Promise<void>, log: (m: string) => void}} io
 */
export async function reattaches({ rpc, open, close, log }) {
  const first = await open();
  const before = (await waitForDaemon(rpc)).pid;
  const kept = await keepTerminal(rpc);
  await close(first);
  const survived = (await waitForDaemon(rpc)).pid === before;
  const second = await open();
  const same = (await waitForDaemon(rpc)).pid === before;
  const listed = await keepIsListed(rpc);
  await rpc('terminal.killAll', {});
  await close(second);
  log(`reattach: kept=${kept} survived=${survived} same=${same} listed=${listed}`);
  return kept && survived && same && listed;
}

/** Every file's path and modified time, to prove a run wrote nothing there (FR-005). */
export function snapshot(...roots) {
  const lines = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else lines.push(`${path}:${statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 'link'}`);
    }
  };
  for (const root of roots) if (existsSync(root)) walk(root);
  return lines.sort().join('\n');
}

/**
 * Run one verification step and record what it established. A step that throws FAILED — it does not vanish from the
 * verdict, and it does not stop the steps after it from being tried — and the throw is logged with the step's name.
 * A step answers `true`, `false`, or `'unproven'` (which only a runner-limited step may keep; the verdict decides).
 *
 * @param {Record<string, boolean | 'unproven'>} results where the outcome is written
 * @param {string} step the step's name, from the verification vocabulary
 * @param {() => Promise<boolean | 'unproven'> | boolean | 'unproven'} run
 * @param {(m: string) => void} log
 */
export async function runStep(results, step, run, log) {
  try {
    const outcome = await run();
    results[step] = outcome === 'unproven' ? 'unproven' : outcome === true;
  } catch (err) {
    log(`${step}: stopped: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
    results[step] = false;
  }
  return results[step];
}

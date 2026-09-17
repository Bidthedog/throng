import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectService, type IUserContext } from '@throng/core';
import { openDatabase, runMigrations, ProjectRepository, type ThrongDatabase } from '@throng/persistence';
import { NodePtyHost, WindowsDirectoryLock } from '@throng/platform-windows';
import { IpcServer } from '../../src/ipc-server.js';
import { RpcRouter } from '../../src/rpc-router.js';
import { ProjectIpcService } from '../../src/project-service.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { TerminalService } from '../../src/terminal-service.js';

/**
 * REPRO — a folder stays undeletable after every terminal in it has closed.
 *
 * ══ WHAT THE USER SEES ══
 *
 * Open a terminal in a sub-folder of a project (a git worktree under `.claude/worktrees/`, say, via
 * Open In → Terminal on the folder), then open another terminal at the project root. Close the
 * worktree's terminal. Delete the worktree — from the tree, from Windows Explorer, or with
 * `git worktree remove` — and Windows refuses: "Could not delete 1 item". No terminal is anywhere near
 * that folder. It stays refused until EVERY terminal in the project has closed, which for a daemon
 * whose terminals survive restarts can be days.
 *
 * ══ WHY ══
 *
 * 005 FR-022 locks "that project's ROOT folder" while it has open terminals. `terminal-service.ts`
 * passes the FIRST terminal's `launch.cwd` to the ref-counted `TerminalLockManager`, so the lock
 * helper `chdir`s into wherever that one terminal happened to start, and stays there, under the
 * project's id, until the project's last terminal closes. Seen live on 2026-09-11: the helper for one
 * project was parked in one of its `.claude\worktrees\<branch>` folders from 04:48:15Z, and two deletes
 * of that worktree through the tree failed at 04:48:49Z and 06:20:30Z.
 *
 * The same harness as `terminal-root-lock.integration.test.ts`: a real daemon router over a real pipe,
 * real `cmd.exe` shells through `NodePtyHost`, and the real `WindowsDirectoryLock`.
 */

const CMD = process.env.ComSpec ?? 'cmd.exe';
const userContext: IUserContext = { currentUser: () => ({ userId: 'alice', userName: 'Alice' }) };

let counter = 0;
let server: IpcServer;
let db: ThrongDatabase;
let dataDir: string;
let projectRoot: string;
let pipeName: string;
let terminalService: TerminalService;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'throng-firstcwd-db-'));
  projectRoot = mkdtempSync(join(tmpdir(), 'throng-firstcwd-proj-'));
  db = openDatabase({ databasePath: join(dataDir, 'throng.db') });
  runMigrations(db);
  const store = new ProjectRepository(db);
  const projectService = new ProjectService({
    store,
    userContext,
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
  });
  const events = new TerminalEvents();
  // Wired as the composition root wires it: the lock resolves the project's root from the store.
  const lockManager = new TerminalLockManager(
    new WindowsDirectoryLock(),
    (projectId) => store.getById(userContext.currentUser().userId, projectId)?.rootFolder ?? null,
  );
  terminalService = new TerminalService(new NodePtyHost(), events, lockManager, {
    isElevated: () => false,
  });
  const router = new RpcRouter();
  new ProjectIpcService(projectService, undefined, (id) => terminalService.hasOpenTerminals(id)).register(
    router,
  );
  terminalService.register(router);
  counter += 1;
  pipeName = `\\\\.\\pipe\\throng-firstcwd-${process.pid}-${counter}`;
  server = new IpcServer({ pipeName, startupTimeoutMs: 5000 }, router, events);
  await server.start();
});

afterEach(async () => {
  for (const panelId of ['wt-term', 'root-term']) {
    await call('terminal.kill', { panelId }).catch(() => undefined);
  }
  await waitFor(async () => {
    const listed = await call('terminal.list', {});
    return listed.result.sessions.length === 0;
  });
  await server.stop();
  db.close();
  for (const d of [dataDir, projectRoot]) {
    rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

let rpcId = 0;
function call(method: string, params: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = connect(pipeName);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params })}\n`));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      try {
        resolve(JSON.parse(buffer.slice(0, nl)));
      } catch (e) {
        reject(e);
      } finally {
        socket.end();
      }
    });
    socket.on('error', reject);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(50);
  }
  return false;
}

/** One non-forced delete attempt, the way Explorer or `git worktree remove` makes it. */
function tryDelete(dir: string): string | null {
  try {
    rmSync(dir, { recursive: true });
    return null;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? String(error);
  }
}

describe('a folder a closed terminal started in is deletable again (005 FR-022 locks the ROOT)', () => {
  it('deletes a worktree once its own terminal has closed, while another terminal in the project stays open', async () => {
    const worktree = join(projectRoot, '.claude', 'worktrees', 'feature+x');
    mkdirSync(worktree, { recursive: true });
    const created = await call('projects.create', { name: 'Repo', colour: '#6aa3ff', rootFolder: projectRoot });
    const projectId = created.result.project.id as string;

    // The project's FIRST terminal starts in the worktree (Open In → Terminal on that folder)…
    const first = await call('terminal.attach', {
      panelId: 'wt-term',
      projectId,
      launch: { file: CMD, args: [], cwd: worktree },
      cols: 80,
      rows: 24,
    });
    expect(first.result?.status).toBe('running');
    // …and a second one at the project root.
    const second = await call('terminal.attach', {
      panelId: 'root-term',
      projectId,
      launch: { file: CMD, args: [], cwd: projectRoot },
      cols: 80,
      rows: 24,
    });
    expect(second.result?.status).toBe('running');

    // Close the worktree's terminal and wait until its shell has actually gone.
    await call('terminal.kill', { panelId: 'wt-term' });
    const shellGone = await waitFor(async () => {
      const listed = await call('terminal.list', {});
      return !listed.result.sessions.some((s: { panelId: string }) => s.panelId === 'wt-term');
    });
    expect(shellGone).toBe(true);

    // No terminal is in the worktree now. Delete it, retrying for a few seconds so the OS has time to
    // reclaim the dead shell's cwd handle — the bug does not clear with time, the fix clears in ms.
    let lastRefusal: string | null = 'not attempted';
    const deleted = await waitFor(() => {
      lastRefusal = tryDelete(worktree);
      return lastRefusal === null;
    }, 5000);

    expect({ deleted, lastRefusal, stillThere: existsSync(worktree) }).toEqual({
      deleted: true,
      lastRefusal: null,
      stillThere: false,
    });
  });

  /*
   * The control. Identical steps, but the ROOT terminal opens first, so the lock lands on the root.
   * This passes today, which is what shows the repro above is refused by the lock's target and not by
   * a dead shell's handle lingering: the only thing that differs is which terminal came first.
   */
  it('(control) deletes the worktree when the root terminal was the one opened first', async () => {
    const worktree = join(projectRoot, '.claude', 'worktrees', 'feature+x');
    mkdirSync(worktree, { recursive: true });
    const created = await call('projects.create', { name: 'Repo', colour: '#6aa3ff', rootFolder: projectRoot });
    const projectId = created.result.project.id as string;

    await call('terminal.attach', {
      panelId: 'root-term',
      projectId,
      launch: { file: CMD, args: [], cwd: projectRoot },
      cols: 80,
      rows: 24,
    });
    await call('terminal.attach', {
      panelId: 'wt-term',
      projectId,
      launch: { file: CMD, args: [], cwd: worktree },
      cols: 80,
      rows: 24,
    });

    await call('terminal.kill', { panelId: 'wt-term' });
    const shellGone = await waitFor(async () => {
      const listed = await call('terminal.list', {});
      return !listed.result.sessions.some((s: { panelId: string }) => s.panelId === 'wt-term');
    });
    expect(shellGone).toBe(true);

    let lastRefusal: string | null = 'not attempted';
    const deleted = await waitFor(() => {
      lastRefusal = tryDelete(worktree);
      return lastRefusal === null;
    }, 5000);

    expect({ deleted, lastRefusal, stillThere: existsSync(worktree) }).toEqual({
      deleted: true,
      lastRefusal: null,
      stillThere: false,
    });
  });
});

import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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

const CMD = process.env.ComSpec ?? 'cmd.exe';
const userContext: IUserContext = { currentUser: () => ({ userId: 'alice', userName: 'Alice' }) };

let counter = 0;
let server: IpcServer;
let db: ThrongDatabase;
let dataDir: string;
let projectRoot: string;
let otherRoot: string;
let pipeName: string;
let terminalService: TerminalService;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'throng-rootlock-db-'));
  projectRoot = mkdtempSync(join(tmpdir(), 'throng-rootlock-proj-'));
  otherRoot = mkdtempSync(join(tmpdir(), 'throng-rootlock-other-'));
  db = openDatabase({ databasePath: join(dataDir, 'throng.db') });
  runMigrations(db);
  const projectService = new ProjectService({
    store: new ProjectRepository(db),
    userContext,
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
  });
  const events = new TerminalEvents();
  const lockManager = new TerminalLockManager(new WindowsDirectoryLock());
  terminalService = new TerminalService(new NodePtyHost(), events, lockManager, {
    isElevated: () => false,
  });
  const router = new RpcRouter();
  new ProjectIpcService(projectService, undefined, (id) =>
    terminalService.hasOpenTerminals(id),
  ).register(router);
  terminalService.register(router);
  counter += 1;
  pipeName = `\\\\.\\pipe\\throng-rootlock-${process.pid}-${counter}`;
  server = new IpcServer({ pipeName, startupTimeoutMs: 5000 }, router, events);
  await server.start();
});

afterEach(async () => {
  await server.stop();
  db.close();
  for (const d of [dataDir, projectRoot, otherRoot]) {
    rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 8000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(25);
  }
  return false;
}

describe('project-root lock while terminals are open (FR-022)', () => {
  it('locks the root (external delete fails + root-edit refused) and releases on the last terminal', async () => {
    const created = await call('projects.create', {
      name: 'Locked',
      colour: '#6aa3ff',
      rootFolder: projectRoot,
    });
    const projectId = created.result.project.id as string;

    await call('terminal.attach', {
      panelId: 'p1',
      projectId,
      launch: { file: CMD, args: [], cwd: projectRoot },
      cols: 80,
      rows: 24,
    });
    expect(terminalService.hasOpenTerminals(projectId)).toBe(true);

    // The OS refuses to delete the locked root from outside.
    let deleteBlocked = false;
    try {
      rmSync(projectRoot, { recursive: true });
    } catch {
      deleteBlocked = true;
    }
    expect(deleteBlocked).toBe(true);
    expect(existsSync(projectRoot)).toBe(true);

    // The root-edit guard refuses to change the project's root path.
    const refused = await call('projects.update', { id: projectId, rootFolder: otherRoot });
    expect(refused.error).toBeTruthy();
    expect(String(refused.error.message)).toMatch(/open terminals/i);

    // Close the terminal → lock releases.
    await call('terminal.kill', { panelId: 'p1' });
    expect(await waitFor(() => !terminalService.hasOpenTerminals(projectId))).toBe(true);

    // Now the root path can change and the (old) folder can be deleted.
    const ok = await call('projects.update', { id: projectId, rootFolder: otherRoot });
    expect(ok.result?.project?.rootFolder).toBe(otherRoot);
    expect(() => rmSync(projectRoot, { recursive: true, force: true })).not.toThrow();
  });

  it('does NOT lock the cwd for a rootless (sub-workspace-owned) terminal (FR-028)', async () => {
    // A sub-workspace-owned terminal has no owning project and launches at the
    // user's home directory; it must not take a directory lock (locking the home
    // folder would be wrong), so hasOpenTerminals stays false for its synthetic id.
    const home = mkdtempSync(join(tmpdir(), 'throng-rootless-home-'));
    try {
      const subId = 'subworkspace:abc';
      const attached = await call('terminal.attach', {
        panelId: 'sp1',
        projectId: subId,
        rootless: true,
        launch: { file: CMD, args: [], cwd: home },
        cols: 80,
        rows: 24,
      });
      expect(attached.result?.status).toBe('running');
      expect(terminalService.hasOpenTerminals(subId)).toBe(false);

      // Terminate and wait for the process to fully exit (releasing its cwd handle)
      // before the temp dir is cleaned up.
      await call('terminal.kill', { panelId: 'sp1' });
      const gone = await waitFor(async () => {
        const listed = await call('terminal.list', {});
        return !listed.result.sessions.some((s: { panelId: string }) => s.panelId === 'sp1');
      });
      expect(gone).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CMD,
  openEventsSocket,
  rpcCall,
  startTerminalDaemon,
  waitFor,
  type EventsSocket,
  type TerminalDaemon,
} from './terminal-harness.js';

/**
 * 046 T056 — `terminal.closeIdle` and `terminal.killAll`, scoped to a project, as Unload calls them
 * (contracts/unload.md §3; FR-034, FR-034c, FR-037; Principle III).
 *
 * Unload releases the MAIN window's view of a project. Two kinds of session in that project are not
 * the main window's to end:
 *
 *   - a panel a sub-workspace window holds (FR-037). The renderer names these in `exceptPanelIds`.
 *   - a `rootless` session — a sub-workspace-owned terminal, which has no project root and belongs to
 *     that window rather than to the project (R7). The daemon knows this without being told.
 *
 * Both are spared ONLY when `projectId` is given. App close sends `killAll {}` (`main.ts`), and that
 * must stay "every session, no exceptions", or closing throng would leave shells behind.
 *
 * Real sessions, real busy children (`ping -n 30`), as `terminal-reattach.integration.test.ts` does,
 * and for the same reason: `isBusy` is a child-pid probe, and a fake host would test the fake.
 */

let daemon: TerminalDaemon;
let cwd: string;
let otherCwd: string;
let homeCwd: string;
let evt: EventsSocket;

beforeEach(async () => {
  daemon = await startTerminalDaemon();
  cwd = mkdtempSync(join(tmpdir(), 'throng-unload-'));
  otherCwd = mkdtempSync(join(tmpdir(), 'throng-unload-other-'));
  homeCwd = mkdtempSync(join(tmpdir(), 'throng-unload-rootless-'));
  evt = await openEventsSocket(daemon.pipeName);
});

afterEach(async () => {
  // App-close semantics: end EVERY session, spared or not, so no PTY or conhost outlives the test.
  try {
    await rpcCall(daemon.pipeName, 'terminal.killAll', {});
    // `killAll` returns once the kills are SENT; a shell still exiting holds its cwd open, and
    // removing the temp dirs below would then fail EPERM. A session leaves the list on its exit.
    await waitFor(
      async () => (await rpcCall(daemon.pipeName, 'terminal.list', {})).result.sessions.length === 0,
      10_000,
      'every session to exit before the temp dirs are removed',
    );
  } catch {
    /* server may already be stopping */
  }
  evt.close();
  await daemon.stop();
  for (const dir of [cwd, otherCwd, homeCwd]) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

const attach = (panelId: string, opts: { projectId?: string; cwd?: string; rootless?: boolean } = {}) =>
  rpcCall(daemon.pipeName, 'terminal.attach', {
    panelId,
    projectId: opts.projectId ?? 'proj',
    launch: { file: CMD, args: [], cwd: opts.cwd ?? cwd },
    cols: 80,
    rows: 24,
    ...(opts.rootless ? { rootless: true } : {}),
  });

/** Start a ~30 s child in the panel and wait until the daemon CLASSIFIES it busy (see the harness). */
async function makeBusy(panelId: string): Promise<void> {
  await rpcCall(daemon.pipeName, 'terminal.write', { panelId, data: 'ping -n 30 127.0.0.1\r\n' });
  await waitFor(
    async () => {
      const l = await rpcCall(daemon.pipeName, 'terminal.list', { includeBusy: true });
      return l.result.sessions.find((s: any) => s.panelId === panelId)?.busy === true;
    },
    15_000,
    `the daemon to classify ${panelId} as busy (its child pid to appear)`,
  );
}

async function runningPanelIds(): Promise<string[]> {
  const l = await rpcCall(daemon.pipeName, 'terminal.list', {});
  return l.result.sessions.filter((s: any) => s.status === 'running').map((s: any) => s.panelId);
}

const exited = (panelId: string) =>
  waitFor(
    () => evt.notifications.some((n) => n.method === 'terminal.exit' && n.params.panelId === panelId),
    8000,
    `a terminal.exit notification for ${panelId}`,
  );

/** The call must have succeeded — a thrown RPC is not "closed nothing". */
function resultOf(res: any): any {
  expect(res.error, `the RPC failed: ${JSON.stringify(res.error)}`).toBeUndefined();
  return res.result;
}

describe('closeIdle {projectId, exceptPanelIds} (FR-034c, FR-037)', () => {
  it('closes the idle session, and spares the busy one and the excepted one', async () => {
    await attach('idle1');
    await attach('busy1');
    await attach('spare1'); // idle — the exception is the ONLY thing that can save it
    await attach('other1', { projectId: 'other', cwd: otherCwd });
    await makeBusy('busy1');

    const res = resultOf(
      await rpcCall(daemon.pipeName, 'terminal.closeIdle', { projectId: 'proj', exceptPanelIds: ['spare1'] }),
    );

    expect(res.closed).toEqual(['idle1']);
    await exited('idle1');
    const running = await runningPanelIds();
    expect(running).toContain('busy1');
    expect(running).toContain('spare1');
    expect(running).toContain('other1'); // another project is never in scope
    expect(running).not.toContain('idle1');
  });

  it('an empty exceptPanelIds behaves as before: every idle session of the project closes', async () => {
    await attach('idleA');
    await attach('idleB');
    const res = resultOf(
      await rpcCall(daemon.pipeName, 'terminal.closeIdle', { projectId: 'proj', exceptPanelIds: [] }),
    );
    expect([...res.closed].sort()).toEqual(['idleA', 'idleB']);
  });
});

describe('killAll {projectId, exceptPanelIds} (FR-034, FR-037)', () => {
  it('ends every session of the project, busy or idle, except the excepted panel', async () => {
    await attach('idle1');
    await attach('busy1');
    await attach('spare1');
    await attach('other1', { projectId: 'other', cwd: otherCwd });
    await makeBusy('busy1');

    const res = resultOf(
      await rpcCall(daemon.pipeName, 'terminal.killAll', { projectId: 'proj', exceptPanelIds: ['spare1'] }),
    );

    expect([...res.killed].sort()).toEqual(['busy1', 'idle1']);
    await exited('idle1');
    await exited('busy1');
    const running = await runningPanelIds();
    expect(running).toContain('spare1');
    expect(running).toContain('other1');
  });

  it('a busy excepted panel survives too — the exception is not an idleness test', async () => {
    await attach('busySpare');
    await attach('idle1');
    await makeBusy('busySpare');

    const res = resultOf(
      await rpcCall(daemon.pipeName, 'terminal.killAll', { projectId: 'proj', exceptPanelIds: ['busySpare'] }),
    );

    expect(res.killed).toEqual(['idle1']);
    await exited('idle1');
    expect(await runningPanelIds()).toContain('busySpare');
  });
});

describe('rootless sessions are skipped when scoped to a project (R7, [derived])', () => {
  it('closeIdle {projectId} leaves an idle rootless session running', async () => {
    await attach('rootless1', { rootless: true, cwd: homeCwd });
    await attach('idle1');

    const res = resultOf(await rpcCall(daemon.pipeName, 'terminal.closeIdle', { projectId: 'proj' }));

    expect(res.closed).toEqual(['idle1']);
    await exited('idle1');
    expect(await runningPanelIds()).toContain('rootless1');
  });

  it('killAll {projectId} leaves a rootless session running', async () => {
    await attach('rootless1', { rootless: true, cwd: homeCwd });
    await attach('idle1');

    const res = resultOf(await rpcCall(daemon.pipeName, 'terminal.killAll', { projectId: 'proj' }));

    expect(res.killed).toEqual(['idle1']);
    await exited('idle1');
    expect(await runningPanelIds()).toContain('rootless1');
  });
});

describe('terminal.list names rootless sessions, so Unload neither counts nor names them (review #3)', () => {
  it('reports rootless: true for a rootless session and not for a project one', async () => {
    await attach('rootless1', { rootless: true, cwd: homeCwd });
    await attach('idle1');

    const l = await rpcCall(daemon.pipeName, 'terminal.list', { projectId: 'proj', includeBusy: true });
    const byId = new Map(resultOf(l).sessions.map((s: any) => [s.panelId, s]));

    expect((byId.get('rootless1') as any)?.rootless).toBe(true);
    expect((byId.get('idle1') as any)?.rootless).toBeFalsy();
  });
});

describe('killAll {} — app close — is unchanged', () => {
  it('ends every running session: every project, rootless included', async () => {
    await attach('a1');
    await attach('rootless1', { rootless: true, cwd: homeCwd });
    await attach('other1', { projectId: 'other', cwd: otherCwd });

    const res = resultOf(await rpcCall(daemon.pipeName, 'terminal.killAll', {}));

    expect([...res.killed].sort()).toEqual(['a1', 'other1', 'rootless1']);
    for (const id of ['a1', 'other1', 'rootless1']) await exited(id);
    await waitFor(
      () => !daemon.lockManager.hasOpenTerminals('proj') && !daemon.lockManager.hasOpenTerminals('other'),
      8000,
      'both projects to release their terminal locks',
    );
    expect(await runningPanelIds()).toEqual([]);
  });
});

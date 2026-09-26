import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectService } from '@throng/core';
import { ProjectIpcService } from '../../src/project-service.js';
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
 * 046 T124, daemon half — what "Keep Terminals Running" means once the renderer stops sending
 * `closeIdle` (FR-086, SC-011; contracts/unload.md §6; constitution v5.6.0 Principle III, stated
 * exception).
 *
 * After T128, an Unload that keeps terminals running sends the daemon NOTHING about its sessions: the
 * workspace unmounts, each terminal view detaches, and that is all. So the claim to pin is the daemon's
 * own behaviour on that path:
 *
 *   - an IDLE session outlives the loss of its last view, and the next `attach` for the panel joins the
 *     SAME process — same shell pid, its scrollback replayed, its environment intact ("nothing about
 *     the terminal may be lost: its process, working directory, environment and history");
 *   - and the Principle III guard around the exception: a kept session still ends when its project is
 *     deleted (`projects.delete` → `killForProject`, as `composition-root.ts` wires it) and under
 *     "terminate all" at app close (`killAll {}`, `main.ts`).
 *
 * THIS IS A GUARD, NOT A REPRO. The daemon already behaves this way — `detach` terminates only a
 * rootless session (`terminal-service.ts`, 008 FR-007) — and the defect lives in the renderer's
 * `closeIdle` call (`unload-keep-terminals.test.ts`). It is expected to pass before T128.
 *
 * The protocol has no session id and does not expose the shell pid, so identity is the panel id plus
 * the shell's pid, read from the service's session table — the only way to tell "the same process"
 * from "a new process in the same panel", which is exactly the distinction FR-086 draws.
 *
 * App close and FR-015b's idle rule (T124's [derived] note, FR-086's analyze note) are NOT asserted
 * here: no app-close path calls `closeIdle`, so there is nothing in the daemon to assert. See T153.
 *
 * Real sessions over a real pipe, as `terminal-unload-filters.integration.test.ts` does, for the same
 * reason: `isBusy` is a child-pid probe, and a fake host would test the fake.
 */

let daemon: TerminalDaemon;
let cwd: string;
let evt: EventsSocket;

beforeEach(async () => {
  daemon = await startTerminalDaemon();
  cwd = mkdtempSync(join(tmpdir(), 'throng-unload-keep-'));
  evt = await openEventsSocket(daemon.pipeName);
});

afterEach(async () => {
  // App-close semantics: end EVERY session, so no PTY or conhost outlives the test.
  try {
    await rpcCall(daemon.pipeName, 'terminal.killAll', {});
    await waitFor(
      async () => (await rpcCall(daemon.pipeName, 'terminal.list', {})).result.sessions.length === 0,
      10_000,
      'every session to exit before the temp dir is removed',
    );
  } catch {
    /* server may already be stopping */
  }
  evt.close();
  await daemon.stop();
  rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const attach = (panelId: string) =>
  rpcCall(daemon.pipeName, 'terminal.attach', {
    panelId,
    projectId: 'proj',
    launch: { file: CMD, args: [], cwd },
    cols: 80,
    rows: 24,
  });

/** The view going away — what an Unload that keeps terminals running does, and ALL it does. */
const detach = (panelId: string) => rpcCall(daemon.pipeName, 'terminal.detach', { panelId });

const write = (panelId: string, data: string) => rpcCall(daemon.pipeName, 'terminal.write', { panelId, data });

/** The shell's OS pid, from the service's own session table (the protocol does not expose it). */
function shellPid(panelId: string): number | undefined {
  const sessions = (daemon.service as unknown as { sessions: Map<string, { handle: { pid: number } }> }).sessions;
  return sessions.get(panelId)?.handle.pid;
}

/** Wait for `text` to appear in output published AFTER notification index `from`. */
const outputAfter = (from: number, text: string, what: string) =>
  waitFor(
    () =>
      evt.notifications
        .slice(from)
        .some((n) => n.method === 'terminal.output' && String(n.params.data).includes(text)),
    8000,
    what,
  );

async function sessionFor(panelId: string): Promise<any> {
  const l = await rpcCall(daemon.pipeName, 'terminal.list', { includeBusy: true });
  return l.result.sessions.find((s: any) => s.panelId === panelId);
}

const exited = (panelId: string) =>
  waitFor(
    () => evt.notifications.some((n) => n.method === 'terminal.exit' && n.params.panelId === panelId),
    8000,
    `a terminal.exit notification for ${panelId}`,
  );

describe('an idle session kept by Unload survives, and reattaches to the same process (FR-086)', () => {
  it('with no closeIdle, the idle shell outlives its view: same pid, scrollback replayed, environment intact', async () => {
    await attach('idle1');
    const pidBefore = shellPid('idle1');
    expect(pidBefore, 'the session has no shell pid').toBeGreaterThan(0);

    // Give the shell history and state that only the SAME process could still hold.
    const mark = evt.notifications.length;
    await write('idle1', 'set THRONG_KEPT_ENV=kept_env_4711\r\n');
    await write('idle1', 'echo KEEP_SCROLLBACK_MARK\r\n');
    await outputAfter(mark, 'KEEP_SCROLLBACK_MARK', 'the scrollback marker to be printed');

    // It is IDLE — the case FR-086 changed. A busy session was always kept.
    await waitFor(async () => (await sessionFor('idle1'))?.busy === false, 15_000, 'idle1 to be classified idle');

    // Unload with Keep Terminals Running: the view detaches, and nothing else is sent.
    await detach('idle1');
    await sleep(1500); // room for anything the daemon might do on its own; it must do nothing

    const kept = await sessionFor('idle1');
    expect(kept, 'the idle session was ended when its last view detached').toBeDefined();
    expect(kept.status).toBe('running');
    expect(evt.notifications.some((n) => n.method === 'terminal.exit' && n.params.panelId === 'idle1')).toBe(false);

    // The next load: the terminal panel mounts through attach, and joins the SAME session.
    const again = await attach('idle1');
    expect(again.error).toBeUndefined();
    expect(again.result.status).toBe('running');
    expect(String(again.result.scrollback)).toContain('KEEP_SCROLLBACK_MARK');
    expect(shellPid('idle1'), 'the panel was re-created with a new shell').toBe(pidBefore);
    const listed = await rpcCall(daemon.pipeName, 'terminal.list', {});
    expect(listed.result.sessions.filter((s: any) => s.panelId === 'idle1')).toHaveLength(1);

    // …and the shell's environment is the one it had: a new process would print the literal name.
    const beforeEcho = evt.notifications.length;
    await write('idle1', 'echo %THRONG_KEPT_ENV%\r\n');
    await outputAfter(beforeEcho, 'kept_env_4711', 'the kept shell to still hold its environment variable');
  });
});

describe('the Principle III guard: a kept session still ends (FR-086)', () => {
  it('when its project is deleted', async () => {
    const projects = { delete: vi.fn(() => ({ ok: true })) } as unknown as ProjectService;
    new ProjectIpcService(projects, undefined, undefined, (projectId) => daemon.service.killForProject(projectId)).register(
      daemon.router,
    );
    await attach('idle1');
    await attach('busy1');
    await write('busy1', 'ping -n 30 127.0.0.1\r\n');
    await detach('idle1');
    await detach('busy1');
    expect((await sessionFor('idle1'))?.status).toBe('running');

    const res = await rpcCall(daemon.pipeName, 'projects.delete', { id: 'proj' });
    expect(res.error, `projects.delete failed: ${JSON.stringify(res.error)}`).toBeUndefined();

    await exited('idle1');
    await exited('busy1');
    await waitFor(() => !daemon.lockManager.hasOpenTerminals('proj'), 8000, 'the project to release its terminal lock');
  });

  it('under "terminate all" at app close (killAll {})', async () => {
    await attach('idle1');
    await detach('idle1');
    expect((await sessionFor('idle1'))?.status).toBe('running');

    const res = await rpcCall(daemon.pipeName, 'terminal.killAll', {});
    expect(res.error).toBeUndefined();
    expect(res.result.killed).toContain('idle1');

    await exited('idle1');
    await waitFor(() => !daemon.lockManager.hasOpenTerminals('proj'), 8000, 'the project to release its terminal lock');
  });
});

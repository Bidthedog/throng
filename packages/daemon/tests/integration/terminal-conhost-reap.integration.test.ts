import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DetectedShell } from '@throng/core';
import { NodePtyHost, WindowsShellDetection } from '@throng/platform-windows';
import { TerminalService } from '../../src/terminal-service.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { RpcRouter } from '../../src/rpc-router.js';
import { waitFor } from './terminal-harness.js';

/**
 * Principle III (T134 / FR-015b / FR-018) — ending a terminal through `terminal.kill`, which is what destroying
 * its panel sends, releases the terminal's console host, for EVERY shell flavour this machine has.
 *
 * Moved down from `terminal-no-orphans.e2e.ts` ('panel-destroy reaps the conhost for EVERY detected terminal
 * flavour'), which opened and destroyed one terminal per flavour through the whole app. The renderer is not what
 * differs between flavours: the daemon's end path is, so it is asked here directly, and the app-level test keeps
 * one flavour to prove a panel destroy sends the call at all.
 *
 * Layer: integration — the claim is about a real OS process. A `conhost.exe --headless` exists only once a real
 * ConPTY does, and nothing lower than a real host can show one surviving its terminal.
 *
 * The host is a plain `NodePtyHost` and the assertion is made BEFORE `service.shutdown()`, because shutdown's own
 * final sweep (`dispose`) kills every console host this process owns and would hide a missing reap on the end path.
 */

const detected: DetectedShell[] = await new WindowsShellDetection().detectInstalledShells();

interface Probe {
  ok: boolean;
  pids: number[];
}

/** The `--headless` console hosts that are children of THIS process. A failed probe is reported, never read as "none". */
function conhostsOfThisProcess(): Probe {
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'conhost.exe' -or $_.Name -eq 'OpenConsole.exe') -and $_.ParentProcessId -eq ${process.pid} -and $_.CommandLine -match '--headless' } | ForEach-Object { $_.ProcessId }`,
      ],
      { encoding: 'utf8', timeout: 8000, windowsHide: true },
    );
    return {
      ok: true,
      pids: out
        .split(/\r?\n/)
        .map((l) => Number(l.trim()))
        .filter((n) => Number.isFinite(n) && n > 0),
    };
  } catch {
    return { ok: false, pids: [] };
  }
}

let cwd: string;
let service: TerminalService | undefined;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'throng-conhost-reap-'));
});

afterEach(async () => {
  await service?.shutdown();
  service = undefined;
  rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/*
 * Only Windows PowerShell's console host outlives its shell when the end path's reap is removed — observed with
 * the reap in `reapAfterExit` commented out: that row went red and cmd, pwsh and git-bash stayed green, because their
 * console hosts exit by themselves on this OS build. So the discriminating row runs on the PR path and the rest run
 * with the regression tier, where a host whose conhost stops exiting on its own would still be caught.
 */
const DISCRIMINATING = 'windows-powershell';
const prPath = detected.filter((s) => s.id === DISCRIMINATING);
const regressionRows = detected.filter((s) => s.id !== DISCRIMINATING);

async function endReapsConhost(shell: DetectedShell): Promise<void> {
  const host = new NodePtyHost();
  service = new TerminalService(
    host,
    new TerminalEvents(),
    new TerminalLockManager({ acquire: async (p) => ({ path: p }), release: async () => {} }),
    { isElevated: () => false },
  );
  const router = new RpcRouter();
  service.register(router);
  const call = (id: number, method: string, params: object) => router.handle({ jsonrpc: '2.0', id, method, params });

  const baseline = new Set(conhostsOfThisProcess().pids);

  const attached = (await call(1, 'terminal.attach', {
    panelId: 'p',
    projectId: 'proj',
    launch: { file: shell.file, args: shell.defaultArgs, cwd },
    cols: 80,
    rows: 24,
  })) as { result?: unknown };
  expect(attached.result, `${shell.id} did not start`).toBeDefined();

  // The terminal's console host exists and has been ATTRIBUTED to the session: the host attributes it
  // asynchronously, and ending before that would test the late-reap path rather than the ordinary one.
  await waitFor(() => host.rosterEntries().some((e) => e.conhostPid !== null), 20_000, `${shell.id}'s console host to be attributed`);
  const hostPid = host.rosterEntries().find((e) => e.conhostPid !== null)!.conhostPid!;
  expect(baseline.has(hostPid), 'the attributed host was already there before the terminal started').toBe(false);
  expect(conhostsOfThisProcess().pids, 'the terminal has a console host to reap').toContain(hostPid);

  // What destroying the panel sends.
  await call(2, 'terminal.kill', { panelId: 'p' });

  await waitFor(
    () => {
      const probe = conhostsOfThisProcess();
      return probe.ok && !probe.pids.includes(hostPid);
    },
    15_000,
    `${shell.id}'s console host ${hostPid} to be reaped by the end, not by the shutdown sweep`,
  );
}

describe('ending a terminal through terminal.kill reaps its console host, per shell flavour', () => {
  it.skipIf(prPath.length === 0).each(prPath.map((s) => [s.id, s] as const))('%s', async (_id, shell) => {
    await endReapsConhost(shell);
  }, 60_000);

  it.each(regressionRows.map((s) => [s.id, s] as const))(
    '%s',
    { tags: ['regression'], timeout: 60_000 },
    async (_id, shell) => {
      await endReapsConhost(shell);
    },
  );
});

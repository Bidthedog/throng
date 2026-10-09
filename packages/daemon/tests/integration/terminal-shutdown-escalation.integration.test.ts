import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PtyHandle } from '@throng/core';
import { NodePtyHost } from '@throng/platform-windows';
import { TerminalService } from '../../src/terminal-service.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { RpcRouter } from '../../src/rpc-router.js';
import { CMD, waitFor } from './terminal-harness.js';

/**
 * 051 FR-015 / FR-015a — shutdown leaves nothing behind even when an end FAILS: the failure is
 * escalated to a forced end of the shell's whole tree and its console host.
 *
 * Layer: integration — the claim is about real OS processes (the shell, the command it runs, the
 * conhost ConPTY created). A fake host has none, so nothing lower can show one surviving.
 *
 * The failure is injected: the host's FIRST `end` of each terminal rejects without touching the
 * process, as a refused or timed-out end does. What shutdown does next is the real code.
 */

/** A host whose first end of every terminal fails, leaving the terminal fully alive. */
class RefusingHost extends NodePtyHost {
  private readonly refused = new Set<number>();
  override async end(handle: PtyHandle, timeoutMs: number): Promise<void> {
    if (!this.refused.has(handle.pid)) {
      this.refused.add(handle.pid);
      throw new Error('did not end within 5 seconds');
    }
    return super.end(handle, timeoutMs);
  }
  /** Does nothing, so the host's own final sweep cannot hide a missing escalation. */
  override async dispose(): Promise<void> {}
}

interface Row {
  pid: number;
  ppid: number;
  name: string;
}

/** The whole process table — a test-side read, so it may block. */
function processTable(): Row[] {
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Get-CimInstance Win32_Process | ForEach-Object { '{0},{1},{2}' -f $_.ProcessId, $_.ParentProcessId, $_.Name }",
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  return out
    .split(/\r?\n/)
    .map((l) => l.trim().split(','))
    .filter((p) => p.length === 3)
    .map(([pid, ppid, name]) => ({ pid: Number(pid), ppid: Number(ppid), name: name! }));
}

/** Every live descendant of `roots`, plus this process's console hosts, by pid. */
function survivorsOf(roots: number[]): Row[] {
  const table = processTable();
  const live = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of table) {
      if (live.has(row.ppid) && !live.has(row.pid)) {
        live.add(row.pid);
        grew = true;
      }
    }
  }
  return table.filter(
    (r) => live.has(r.pid) || (/^(conhost|OpenConsole)\.exe$/i.test(r.name) && r.ppid === process.pid),
  );
}

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'throng-escalate-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('051 FR-015a — shutdown escalates an end that fails', () => {
  it('leaves no shell, command or console host of its terminals running', async () => {
    const before = new Set(survivorsOf([]).map((r) => r.pid));
    const host = new RefusingHost();
    const events = new TerminalEvents();
    const output = new Map<string, string>();
    events.publishOutput = (panelId: string, data: string) =>
      void output.set(panelId, (output.get(panelId) ?? '') + data);
    const locks = new TerminalLockManager({ acquire: async (p) => ({ path: p }), release: async () => {} });
    const service = new TerminalService(host, events, locks, { isElevated: () => false });
    const router = new RpcRouter();
    service.register(router);

    const shells: number[] = [];
    for (const panelId of ['a', 'b', 'c']) {
      const res = (await router.handle({
        jsonrpc: '2.0',
        id: 1,
        method: 'terminal.attach',
        params: { panelId, projectId: 'p', launch: { file: CMD, args: [], cwd }, cols: 80, rows: 24 },
      })) as { result?: unknown };
      expect(res.result).toBeDefined();
      await router.handle({ jsonrpc: '2.0', id: 2, method: 'terminal.write', params: { panelId, data: 'ping -n 60 127.0.0.1\r' } });
    }
    await waitFor(() => ['a', 'b', 'c'].every((p) => (output.get(p) ?? '').includes('127.0.0.1')), 15_000, 'every ping');
    // The shells are the children of this process that are cmd.exe and were not here before.
    for (const row of processTable()) {
      if (row.ppid === process.pid && /^cmd\.exe$/i.test(row.name) && !before.has(row.pid)) shells.push(row.pid);
    }
    expect(shells).toHaveLength(3);
    expect(survivorsOf(shells).some((r) => /^PING\.EXE$/i.test(r.name))).toBe(true);

    await service.shutdown();

    await waitFor(
      () => survivorsOf(shells).filter((r) => !before.has(r.pid)).length === 0,
      10_000,
      'every shell, ping and console host of the three terminals to be gone',
    );
  }, 60_000);
});

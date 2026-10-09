import { spawn, type ChildProcess as NodeChild } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import type { PtyHandle } from '@throng/core';
import { NodePtyHost } from '@throng/platform-windows';

/*
 * A terminal's running command is read from one snapshot of the WHOLE process table, so any process
 * on the machine is part of its input. Windows PowerShell's `ConvertTo-Json` leaves some control
 * characters raw — 0x1A (SUB) among them — and a raw one is invalid JSON. One such command line
 * anywhere (a Claude Code background session started with a multi-line prompt carries one) made
 * every terminal's command read as nothing.
 */
const SUB = String.fromCharCode(0x1a);
const cmd = process.env.ComSpec ?? 'cmd.exe';

let bystander: NodeChild | undefined;
let host: NodePtyHost | undefined;
let handle: PtyHandle | undefined;
let cwd: string | undefined;

afterEach(async () => {
  if (host && handle) await host.end(handle, 8000).catch(() => {});
  bystander?.kill();
  if (cwd) rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  bystander = host = handle = cwd = undefined;
});

describe('NodePtyHost — a process elsewhere with a control character in its command line', () => {
  it('still reports the shell’s running child', async () => {
    bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', `before${SUB}after`], {
      stdio: 'ignore',
      windowsHide: true,
    });
    cwd = mkdtempSync(join(tmpdir(), 'throng-pty-'));
    host = new NodePtyHost();
    handle = host.start({ file: cmd, args: [], cwd, cols: 80, rows: 24 });
    host.write(handle, 'ping -n 40 127.0.0.1\r\n');

    const started = Date.now();
    let direct: Array<{ ppid: number; commandLine: string }> = [];
    while (Date.now() - started < 15_000) {
      direct = (await host.listChildProcesses(handle)).filter((p) => p.ppid === handle!.pid);
      if (direct.length > 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(direct.map((p) => p.commandLine)).toEqual([expect.stringContaining('ping')]);
  }, 60_000);
});

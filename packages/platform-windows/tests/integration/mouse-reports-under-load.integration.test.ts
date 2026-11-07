import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import koffi from 'koffi';
import { afterEach, describe, expect, it } from 'vitest';
import { createMouseReportCoalescer, type PtyHandle } from '@throng/core';
import { NodePtyHost } from '@throng/platform-windows';

/**
 * REPRO (#544) — under CPU load, mouse reports reach a mouse-reporting program in a throng terminal split in two,
 * and the tail of each split report lands in its input as typed text.
 *
 * ══ WHAT THE USER SEES ══
 *
 * Claude Code at its prompt, every core pegged, the pointer moved and clicked over the terminal. When the load
 * lifts, Claude Code's input reads `8M` or `5;71;61M`: the tail of an SGR mouse report such as `ESC[<35;71;61M`.
 * The same steps in Windows Terminal leave nothing behind (the issue's thread, 2026-10-31).
 *
 * ══ WHY ══
 *
 * The pointer keeps moving while the input path is stalled, so motion reports queue up unread. The system console
 * host then reads that backlog in large fixed-size pieces, and a report that straddles two pieces reaches the program
 * in two reads; a program that stops waiting for the rest of an escape sequence types the tail. Measured here before
 * the fix (CI run 42365071115): 2,000 reports queued behind a suspended conhost were read as 10 + 23,040 + … bytes,
 * with one report cut across the boundary.
 *
 * ══ WHAT THIS DOES ══
 *
 * Writes the reports the way the daemon does — through `createMouseReportCoalescer` into `NodePtyHost.write`
 * (`terminal-service.ts` write) — while the terminal's own conhost is SUSPENDED, standing in for CPU starvation, then
 * resumes it. The program is `fixtures/vt-input-recorder.mjs`, which configures its console the way Claude Code does
 * (VT input, SGR mouse mode on) and records every raw chunk it reads. No report may straddle two reads, and nothing
 * but whole reports may arrive.
 *
 * Layer: integration — the split happens inside the real system conhost reading its input pipe; no fake has its read
 * boundaries.
 */

const onWindows = process.platform === 'win32';
const recorder = fileURLToPath(new URL('./fixtures/vt-input-recorder.mjs', import.meta.url));
const koffiUrl = pathToFileURL(createRequire(import.meta.url).resolve('koffi')).href;

/** Enough queued bytes (~70 KB) for several of conhost's read boundaries to fall inside the backlog. */
const REPORTS = 6000;
const STOP = 'ZQ';
// eslint-disable-next-line no-control-regex -- an SGR mouse report starts with ESC; matching one is the point.
const SGR_REPORT = /\x1b\[<\d+;\d+;\d+[Mm]/g;

/** A motion report with no button held (button code 35), walking the pointer across an 80×25 grid. */
function motionReport(i: number): string {
  return `\x1b[<35;${(i % 80) + 1};${(Math.floor(i / 80) % 25) + 1}M`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(50);
  }
  return predicate();
}

/** This process's conhost children. Each ConPTY session the process opens gets its own. */
function conhosts(): Set<number> {
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${process.pid} AND Name='conhost.exe'" | ForEach-Object { $_.ProcessId }`,
    ],
    { encoding: 'utf8', timeout: 15_000, windowsHide: true },
  );
  return new Set(
    out
      .split(/\r?\n/)
      .map((l) => Number(l.trim()))
      .filter((n) => n > 0),
  );
}

function processControl() {
  const kernel32 = koffi.load('kernel32.dll');
  const ntdll = koffi.load('ntdll.dll');
  const OpenProcess = kernel32.func('OpenProcess', 'void *', ['uint32', 'bool', 'uint32']);
  const CloseHandle = kernel32.func('CloseHandle', 'bool', ['void *']);
  const PROCESS_SUSPEND_RESUME = 0x0800;
  return {
    open: (pid: number) => OpenProcess(PROCESS_SUSPEND_RESUME, false, pid) as unknown,
    close: (h: unknown) => CloseHandle(h) as boolean,
    suspend: ntdll.func('NtSuspendProcess', 'int32', ['void *']) as (h: unknown) => number,
    resume: ntdll.func('NtResumeProcess', 'int32', ['void *']) as (h: unknown) => number,
  };
}

const host = new NodePtyHost();
let running: PtyHandle | undefined;
let dir: string | undefined;

afterEach(async () => {
  if (running) {
    const handle = running;
    let exited = false;
    host.onExit(handle, () => {
      exited = true;
    });
    void host.end(handle, 5000).catch(() => {});
    await waitFor(() => exited, 5000);
    running = undefined;
  }
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  dir = undefined;
});

interface Chunk {
  t: number;
  text: string;
}

function received(outFile: string): Chunk[] {
  return readFileSync(outFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [t, hex] = line.split(' ');
      return { t: Number(t), text: Buffer.from(hex ?? '', 'hex').toString('latin1') };
    });
}

function sawStop(outFile: string): boolean {
  try {
    return received(outFile)
      .map((c) => c.text)
      .join('')
      .includes(STOP);
  } catch {
    return false;
  }
}

/** Whole reports received, anything else received, and how many read boundaries fell inside a report. */
function analyse(chunks: Chunk[]) {
  const text = chunks.map((c) => c.text).join('');
  const inside = new Uint8Array(text.length + 1);
  let intact = 0;
  for (const m of text.matchAll(SGR_REPORT)) {
    intact++;
    for (let i = m.index + 1; i < m.index + m[0].length; i++) inside[i] = 1;
  }
  let splits = 0;
  let offset = 0;
  for (let i = 0; i < chunks.length - 1; i++) {
    offset += chunks[i]!.text.length;
    if (inside[offset]) splits++;
  }
  return {
    intact,
    stray: JSON.stringify(text.replace(SGR_REPORT, '').replace(STOP, '').slice(0, 200)),
    splits,
    sizes: chunks.map((c) => c.text.length).join(','),
  };
}

describe.skipIf(!onWindows)('mouse reports reach a mouse-reporting program whole (#544)', () => {
  it('no report is split across reads after the console host was starved while the pointer moved', async () => {
    dir = mkdtempSync(join(tmpdir(), 'throng-544-'));
    const outFile = join(dir, 'received.txt');
    const before = conhosts();
    let out = '';
    const handle = host.start({
      file: process.execPath,
      args: [recorder],
      cwd: dir,
      cols: 80,
      rows: 25,
      env: { KOFFI_URL: koffiUrl, RECORDER_OUT: outFile, RECORDER_STOP: STOP },
    });
    running = handle;
    host.onData(handle, (chunk) => {
      out += chunk;
    });
    const ready = await waitFor(() => out.includes('RECORDER-READY') || out.includes('RECORDER-FAILED'), 15_000);
    expect(ready && !out.includes('RECORDER-FAILED'), `the recorder did not start; it printed:\n${out}`).toBe(true);
    const added = [...conhosts()].filter((pid) => !before.has(pid));
    expect(added, 'expected exactly one new conhost for this terminal').toHaveLength(1);

    const input = createMouseReportCoalescer((data) => host.write(handle, data));
    const control = processControl();
    const conhost = control.open(added[0]!);
    expect(conhost, `could not open conhost ${added[0]} to suspend it`).toBeTruthy();
    try {
      expect(control.suspend(conhost), 'NtSuspendProcess failed').toBe(0);
      for (let i = 0; i < REPORTS; i++) input.write(motionReport(i));
      // The stall the user saw lasted seconds while the pointer kept moving. One second suspended, with every report
      // already handed over, is the stand-in: what matters is what queues up unread, not for how long.
      await sleep(1000);
    } finally {
      control.resume(conhost);
      control.close(conhost);
    }
    input.write(STOP);
    expect(await waitFor(() => sawStop(outFile), 20_000), `the recorder never saw the stop marker:\n${out}`).toBe(true);
    input.dispose();

    const v = analyse(received(outFile));
    expect({ splits: v.splits, stray: v.stray }, `read sizes: ${v.sizes}`).toEqual({ splits: 0, stray: '""' });
    expect(v.intact, 'at least the first and the latest report arrive').toBeGreaterThanOrEqual(2);
  });
});

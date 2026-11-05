import { skipUnlessLinux, skipUnlessWindows } from '@throng/core/testing';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_FLAVOUR_COMMAND_RECIPES, captureDecision, resolveLaunchSpec } from '@throng/core';
import { LinuxPtyHost } from '@throng/platform-linux';
import { NodePtyHost } from '@throng/platform-windows';
import { TerminalService } from '../../src/terminal-service.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { RpcRouter } from '../../src/rpc-router.js';
import { CMD, waitFor } from './terminal-harness.js';

/**
 * 051 FR-040 / FR-042 (#193) — command memory sees a command its shell started through a launcher
 * that has already exited, and forgets it once it is killed from outside throng.
 *
 * Layer: integration — the claim is about what Windows reports attached to a real console: a
 * re-parented process has no living parent in the process table, which no fake can stand in for.
 *
 * `cmd /c start /b ping …` is the launcher: the inner `cmd` starts `ping` on the SAME console and
 * exits at once, so the shell has no direct child while `ping` runs — the shape `docker` takes in
 * Git Bash (research.md R12), reproduced without Docker or Git Bash.
 */

let cwd: string;
let service: TerminalService;
const commands: Array<string | null> = [];

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'throng-attached-'));
  commands.length = 0;
});

afterEach(async () => {
  await service?.shutdown();
  rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** The pids of this marker's ping, read by the test from the process table. */
function pingPids(marker: string): number[] {
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='PING.EXE'" | Where-Object { $_.CommandLine -match '${marker}' } | ForEach-Object { $_.ProcessId }`,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  return out.split(/\r?\n/).map(Number).filter((n) => n > 0);
}

describe.skipIf(skipUnlessWindows('a launcher leaving a command on the same console is cmd and conhost behaviour'))('051 FR-040 — a command started through a launcher is remembered, and forgotten when killed', () => {
  it('reports the re-parented command, then nothing once it is killed from outside', async () => {
    const events = new TerminalEvents();
    events.publishCommand = (_panelId: string, command: string | null) => void commands.push(command);
    events.addSink({ write: () => {} }); // something is listening, so the observation runs (025 FR-019f)
    service = new TerminalService(
      new NodePtyHost(),
      events,
      new TerminalLockManager({ acquire: async (p) => ({ path: p }), release: async () => {} }),
      { isElevated: () => false },
      undefined,
      false,
      0,
      undefined,
      250,
    );
    const router = new RpcRouter();
    service.register(router);
    await router.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'terminal.attach',
      params: { panelId: 'p', projectId: 'proj', launch: { file: CMD, args: [], cwd }, cols: 120, rows: 30 },
    });
    // 127.0.0.7 marks this test's ping among anything else running on the machine.
    await router.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'terminal.write',
      params: { panelId: 'p', data: 'cmd /c start /b ping -n 120 127.0.0.7\r' },
    });

    await waitFor(() => commands.some((c) => c?.includes('127.0.0.7') ?? false), 15_000, 'the launched ping to be reported');
    expect(commands.find((c) => c?.includes('127.0.0.7'))).toMatch(/^ping\s+-n 120 127\.0\.0\.7$/i);

    const pids = pingPids('127\\.0\\.0\\.7');
    expect(pids).toHaveLength(1);
    execFileSync('taskkill', ['/PID', String(pids[0]), '/F'], { windowsHide: true });

    await waitFor(() => commands.at(-1) === null, 10_000, 'nothing to be reported once the ping is killed');
  }, 60_000);

  it('ending the terminal ends a command its launcher left behind (FR-014, Principle III)', async () => {
    // Found by the test above: `taskkill /T` of the shell cannot reach a re-parented command, so it
    // outlived the terminal. The end now also ends what is attached to the console.
    const events = new TerminalEvents();
    service = new TerminalService(
      new NodePtyHost(),
      events,
      new TerminalLockManager({ acquire: async (p) => ({ path: p }), release: async () => {} }),
      { isElevated: () => false },
    );
    const router = new RpcRouter();
    service.register(router);
    const call = (id: number, method: string, params: object) => router.handle({ jsonrpc: '2.0', id, method, params });
    await call(1, 'terminal.attach', { panelId: 'q', projectId: 'proj', launch: { file: CMD, args: [], cwd }, cols: 120, rows: 30 });
    await call(2, 'terminal.write', { panelId: 'q', data: 'cmd /c start /b ping -n 120 127.0.0.8\r' });
    await waitFor(() => pingPids('127\\.0\\.0\\.8').length === 1, 15_000, 'the launched ping to be running');

    await call(3, 'terminal.killAll', {});

    await waitFor(() => pingPids('127\\.0\\.0\\.8').length === 0, 10_000, 'the launched ping to end with its terminal');
  }, 60_000);
});

/** Layer: integration. FR-014 on Linux: a job the shell put in its own process group ends with the terminal. */
describe('ending a terminal on Linux', () => {
  /** The pids of a `sleep` with exactly this argument. */
  const sleepPids = (seconds: number): number[] =>
    readdirSync('/proc')
      .filter((name) => /^\d+$/.test(name))
      .filter((pid) => {
        try {
          return readFileSync(`/proc/${pid}/cmdline`, 'utf8') === ['sleep', String(seconds), ''].join(String.fromCharCode(0));
        } catch {
          return false;
        }
      })
      .map(Number);

  it.skipIf(skipUnlessLinux('the Linux end path'))('ends a job the shell left in the background (FR-014, Principle III)', async () => {
    const seconds = 1000 + (process.pid % 8000);
    service = new TerminalService(
      new LinuxPtyHost(),
      new TerminalEvents(),
      new TerminalLockManager({ acquire: async (p) => ({ path: p }), release: async () => {} }),
      { isElevated: () => false },
    );
    const router = new RpcRouter();
    service.register(router);
    const call = (id: number, method: string, params: object) => router.handle({ jsonrpc: '2.0', id, method, params });
    await call(1, 'terminal.attach', { panelId: 'q', projectId: 'proj', launch: { file: CMD, args: [], cwd }, cols: 120, rows: 30 });
    await call(2, 'terminal.write', { panelId: 'q', data: `sleep ${seconds} &\r` });
    await waitFor(() => sleepPids(seconds).length === 1, 15_000, 'the job to be running');

    await call(3, 'terminal.killAll', {});

    await waitFor(() => sleepPids(seconds).length === 0, 10_000, 'the job to end with its terminal');
  }, 60_000);
});

/**
 * Layer: integration. The claim is about two real clocks: the wall clock the daemon reads before a spawn, and the
 * start time Linux reports for the process a real shell then starts. A fake host would only report what it was told.
 */
describe('a remembered command on Linux', () => {
  it.skipIf(skipUnlessLinux('reads real start times from /proc'))('still counts as running when it is relaunched with its terminal, so the next launch keeps it (025 FR-019)', async () => {
    const seconds = 1000 + (process.pid % 8000);
    const remembered = `sleep ${seconds}`;
    const events = new TerminalEvents();
    events.publishCommand = (_panelId: string, command: string | null) => void commands.push(command);
    events.addSink({ write: () => {} }); // something is listening, so the observation runs (025 FR-019f)
    service = new TerminalService(
      new LinuxPtyHost(),
      events,
      new TerminalLockManager({ acquire: async (p) => ({ path: p }), release: async () => {} }),
      { isElevated: () => false },
      undefined,
      false,
      0,
      undefined,
      100,
    );
    const router = new RpcRouter();
    service.register(router);

    // The launch throng builds for a Bash panel holding a remembered command.
    const launch = resolveLaunchSpec(
      { id: 'bash', file: '/bin/bash', args: [], commandRecipe: BUILTIN_FLAVOUR_COMMAND_RECIPES.bash },
      '',
      cwd,
      remembered,
    );
    await router.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'terminal.attach',
      params: { panelId: 'p', projectId: 'proj', launch, cols: 120, rows: 30 },
    });

    // Polled rather than `waitFor`, so that running out of time reports what the panel was told.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && commands.at(-1) !== remembered) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(captureDecision(true, remembered, commands.at(-1) ?? null)).toEqual({ save: false, reason: 'unchanged' });
    expect(commands.at(-1)).toBe(remembered);

    // …and it ends with its terminal, shell included: the recipe's `exec bash -i` must not outlive the end.
    const listed = async (): Promise<unknown[]> => {
      const reply = (await router.handle({ jsonrpc: '2.0', id: 3, method: 'terminal.list', params: {} })) as {
        result: { sessions: unknown[] };
      };
      return reply.result.sessions;
    };
    const commandPid = Number(execFileSync('pgrep', ['-f', `^${remembered}$`], { encoding: 'utf8' }).trim());
    const shellPid = Number(readFileSync(`/proc/${commandPid}/stat`, 'utf8').split(') ')[1]?.split(' ')[1]);
    expect(await listed()).toHaveLength(1);

    await router.handle({ jsonrpc: '2.0', id: 4, method: 'terminal.killAll', params: { escalate: true } });

    expect(await listed()).toHaveLength(0);
    await waitFor(() => !existsSync(`/proc/${commandPid}`), 5000, 'the command to end with its terminal');
    await waitFor(() => !existsSync(`/proc/${shellPid}`), 5000, 'the shell to end with its terminal');
  }, 30_000);
});

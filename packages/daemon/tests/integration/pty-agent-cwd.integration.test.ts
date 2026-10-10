import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { DetectedShell, IPtyHost } from '@throng/core';
import { WindowsProcessCwd, WindowsShellDetection } from '@throng/platform-windows';
import { PtyAgentHost } from '../../src/pty-agent-host.js';
import { RpcRouter } from '../../src/rpc-router.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { TerminalService } from '../../src/terminal-service.js';

/**
 * REPRO (053 gate, terminal-title-template E2E on the elevated runner) — a terminal started through the PTY agent
 * never reports its working directory, so its title reads `Command Prompt` rather than `Command Prompt (<folder>)`.
 *
 * An elevated throng starts every ordinary terminal through the de-elevated agent. The daemon reads a shell's
 * directory from the shell process (012), by pid — but through the agent it knows the terminal only by the agent's
 * key (`PtyAgentHost.start` returns `{ pid: key }`), so it asked about a process that is not the shell.
 *
 * Real agent (`dist/pty-agent-entry.js`, started as the daemon starts it), real cmd, real cwd reader, and the
 * daemon's own `terminal.list { refreshCwd }`.
 */

const AGENT_ENTRY = fileURLToPath(new URL('../../dist/pty-agent-entry.js', import.meta.url));
const detected: DetectedShell[] = await new WindowsShellDetection().detectInstalledShells();
const cmd = detected.find((s) => s.id === 'cmd');
const unusedLocal = {} as IPtyHost;
const noopLock = { acquire: async () => ({ path: 'x' }), release: async () => {} };

let agent: ChildProcess | undefined;
let service: TerminalService | undefined;
let host: PtyAgentHost | undefined;
let root: string | undefined;

afterEach(async () => {
  await service?.shutdown();
  await host?.dispose();
  agent?.kill();
  if (root) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  service = undefined;
  host = undefined;
  agent = undefined;
  root = undefined;
});

describe('a terminal started through the PTY agent reports its directory', () => {
  it.skipIf(!cmd)('cmd, through the agent, reports the folder it moved to — not the one it was started in', async () => {
    expect(existsSync(AGENT_ENTRY), `build the daemon first: ${AGENT_ENTRY} is missing`).toBe(true);
    root = realpathSync(mkdtempSync(join(tmpdir(), 'throng-agent-cwd-')));
    // The shell moves itself; the launch directory is what the daemon falls back to when it cannot read one.
    const sub = join(root, 'moved');
    mkdirSync(sub);
    const pipe = `\\\\.\\pipe\\throng-agent-cwd-${process.pid}-${Date.now()}`;
    host = new PtyAgentHost(pipe, (p) => {
      agent = spawn(process.execPath, [AGENT_ENTRY, p], { stdio: 'ignore', windowsHide: true });
    });
    service = new TerminalService(
      unusedLocal,
      new TerminalEvents(),
      new TerminalLockManager(noopLock),
      { isElevated: () => false },
      host,
      true, // forceAgent — what an elevated throng does for every ordinary terminal
      0,
      new WindowsProcessCwd(),
    );
    const router = new RpcRouter();
    service.register(router);
    const call = async (method: string, params: object): Promise<any> => {
      const res = (await router.handle({ jsonrpc: '2.0', id: 1, method, params })) as { result?: any; error?: unknown };
      expect(res.error, `${method} failed: ${JSON.stringify(res.error)}`).toBeUndefined();
      return res.result;
    };

    await call('terminal.attach', {
      panelId: 'cwd1',
      projectId: 'proj',
      launch: { file: cmd!.file, args: ['/K', 'cd /d ' + sub], cwd: root },
      cols: 80,
      rows: 24,
    });

    let cwd: string | undefined;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const list = await call('terminal.list', { projectId: 'proj', refreshCwd: true });
      cwd = list.sessions.find((s: { panelId: string }) => s.panelId === 'cwd1')?.cwd;
      if (cwd?.toLowerCase() === sub.toLowerCase()) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(cwd?.toLowerCase(), 'the terminal reported no directory, or the wrong one').toBe(sub.toLowerCase());
  }, 40_000);
});

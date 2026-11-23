import { skipUnlessLinux } from '@throng/core/testing';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_FLAVOUR_COMMAND_RECIPES, resolveLaunchSpec } from '@throng/core';
import { LinuxPtyHost, LinuxProcessCwd } from '@throng/platform-linux';
import { TerminalService } from '../../src/terminal-service.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { RpcRouter } from '../../src/rpc-router.js';
import { waitFor } from './terminal-harness.js';

/**
 * 025 FR-004/FR-005/FR-027 (moved down from `terminal-startup-command-flavours.e2e.ts` and
 * `terminal-directory-memory.e2e.ts`) — every POSIX shell is handed a Startup Command by its own recipe, parses a
 * QUOTED executable path by its own rules, and reports its working directory after a `cd`.
 *
 * Layer: integration — the claims are about what a REAL shell does with the argv `resolveLaunchSpec` builds
 * (`-c … exec zsh -i`, fish's `--init-command`) and what the OS reports for its process. No window is involved, so
 * no E2E is needed; a fake host would only echo back what it was told. A shell that is not installed is skipped,
 * as the E2E skipped it. Bash's wiring through the real app stays covered by the E2E.
 */

const SHELLS = ['bash', 'zsh', 'fish', 'sh'] as const;

/** The absolute path of an installed shell, or undefined. */
function locate(shell: string): string | undefined {
  const found = spawnSync('sh', ['-c', `command -v ${shell}`], { encoding: 'utf8' });
  return found.status === 0 ? found.stdout.trim() || undefined : undefined;
}

/** A QUOTED absolute executable with a DASH argument; it prints QUOTED_RAN only when it really ran. */
const QUOTED_COMMAND = `"${process.execPath}" -p "'QUOTED_'+'RAN'"`;

let cwd: string;
let service: TerminalService;
let router: RpcRouter;
let output: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'throng-flavours-'));
  mkdirSync(join(cwd, 'deepdir'));
  output = '';
});

afterEach(async () => {
  await service?.shutdown();
  rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A daemon service over the real Linux host, collecting everything the terminal prints. */
function startService(): void {
  const events = new TerminalEvents();
  events.addSink({
    write: (frame: string) => {
      const note = JSON.parse(frame) as { method: string; params?: { data?: string } };
      if (note.method === 'terminal.output') output += note.params?.data ?? '';
    },
  });
  service = new TerminalService(
    new LinuxPtyHost(),
    events,
    new TerminalLockManager({ acquire: async (p) => ({ path: p }), release: async () => {} }),
    { isElevated: () => false },
    undefined,
    false,
    0,
    new LinuxProcessCwd(),
  );
  router = new RpcRouter();
  service.register(router);
}

const call = (id: number, method: string, params: object): Promise<any> =>
  router.handle({ jsonrpc: '2.0', id, method, params });

async function attach(shell: string, file: string, startupCommand?: string): Promise<void> {
  const launch = resolveLaunchSpec(
    { id: shell, file, args: [], commandRecipe: BUILTIN_FLAVOUR_COMMAND_RECIPES[shell] },
    '',
    cwd,
    startupCommand,
  );
  await call(1, 'terminal.attach', { panelId: 'p', projectId: 'proj', launch, cols: 120, rows: 30 });
}

async function sessions(refreshCwd = false): Promise<Array<{ status: string; cwd: string }>> {
  return (await call(2, 'terminal.list', { refreshCwd })).result.sessions;
}

describe.skipIf(skipUnlessLinux('drives the real POSIX shells through the Linux PTY host'))('POSIX shell flavours', () => {
  for (const shell of SHELLS) {
    const file = locate(shell);
    describe.skipIf(file === undefined)(shell, () => {
      it('runs a startup command and leaves a live shell (FR-004/FR-005)', async () => {
        startService();
        await attach(shell, file as string, 'echo SUC_MARKER_OK');
        await waitFor(() => output.includes('SUC_MARKER_OK'), 20_000, `${shell} to print the startup command's marker`);

        // The shell is STILL THERE reading its input: a recipe without the re-exec exits when the command ends.
        // The doubled quotes keep the typed line from matching its own echo.
        await call(3, 'terminal.write', { panelId: 'p', data: "echo LIVE_AF''TER\r" });
        await waitFor(() => output.includes('LIVE_AFTER'), 20_000, `${shell} to still run a typed command`);
        expect((await sessions()).map((s) => s.status)).toEqual(['running']);
      }, 60_000);

      it('runs a QUOTED executable path and reports no parse error', async () => {
        startService();
        await attach(shell, file as string, QUOTED_COMMAND);
        await waitFor(() => output.includes('QUOTED_RAN'), 20_000, `${shell} to run the quoted executable`);
        expect((await sessions()).map((s) => s.status)).toEqual(['running']);
      }, 60_000);

      it('reports its working directory after a cd (FR-027)', async () => {
        startService();
        await attach(shell, file as string);
        // Nothing has moved yet: the session reports where it was launched.
        expect((await sessions(true))[0]?.cwd).toBe(cwd);
        await waitFor(() => output.length > 0, 20_000, `${shell} to show a prompt`);

        await call(3, 'terminal.write', { panelId: 'p', data: 'cd deepdir\r' });
        await waitFor(async () => (await sessions(true))[0]?.cwd.endsWith('deepdir') === true, 20_000, `${shell} to report deepdir`);
      }, 60_000);
    });
  }
});

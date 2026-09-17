import { mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUILTIN_FLAVOUR_COMMAND_RECIPES,
  BUILTIN_FLAVOUR_DEFAULT_SHELL_ARGUMENTS,
  resolveLaunchSpec,
  resolveShellHistorySuppression,
  resolveShellIntegration,
  resolveShellIntegrationEnv,
  type DetectedShell,
  type PtyHandle,
} from '@throng/core';
import { NodePtyHost, WindowsShellDetection } from '@throng/platform-windows';

/**
 * REPRO (#387) — a terminal that has `cd`-ed OUT of a folder still stops that folder being deleted.
 *
 * ══ WHAT THE USER SEES ══
 *
 * A terminal opened in a worktree (Open In → Terminal on the folder). The user types `cd ..`; the
 * prompt, the panel and throng's own directory memory all say the terminal is at the parent now. Then
 * they delete the worktree — from the tree, from Explorer, with `git worktree remove` — and Windows
 * refuses: "Could not delete 1 item". Every terminal in sight says it is somewhere else.
 *
 * ══ WHY ══
 *
 * `Set-Location` moves PowerShell's PROVIDER location, never the process's working directory — which
 * `command-recipe.ts` already records ("after a `cd`, cmd's PEB working directory follows and
 * PowerShell's stays at its launch directory"). A process's working directory is an open handle
 * without delete sharing, so the folder the shell was LAUNCHED in stays undeletable for the shell's
 * whole life. throng's prompt hook reads the provider location and reports it through OSC 9;9, but
 * leaves the process where it started. Seen live on 2026-09-11: the four terminal panels of one project
 * all remembered the project root, and one of their `powershell.exe` processes still had
 * one of that project's `.claude\worktrees\<branch>` folders as its working directory.
 *
 * Every built-in flavour is covered, not only the one it was seen in: each is launched exactly as
 * `terminal-ipc` composes it — detected executable, shipped Shell Arguments, recipe, integration
 * snippet and environment — with history suppression on so this run writes nothing to the
 * developer's shell history (#339). A flavour not installed on this machine is skipped, not passed.
 * No directory lock is involved — this is `NodePtyHost` alone, so the only thing that can hold the
 * folder is the shell (or a launcher process standing in front of it).
 */

// eslint-disable-next-line no-control-regex -- OSC 9;9 is a control sequence; matching it is the point.
const OSC_CWD = /\x1b\]9;9;([^\x07]*)\x07/g;
const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();

const detected: DetectedShell[] = await new WindowsShellDetection().detectInstalledShells();
const shellFor = (id: string) => detected.find((s) => s.id === id);

interface Case {
  id: string;
  /** What the user types to move to `dir`. */
  cd: (dir: string) => string;
  /** Whether the terminal has visibly arrived in `dir`, read from what it printed. */
  arrived: (output: string, dir: string) => boolean;
}

const reportedDirs = (output: string) => [...output.matchAll(OSC_CWD)].map((m) => norm(m[1] ?? ''));
const byOsc = (output: string, dir: string) => reportedDirs(output).includes(norm(dir));
const byCmdPrompt = (output: string, dir: string) => output.toLowerCase().includes(`${norm(dir)}>`);

const CASES: Case[] = [
  { id: 'windows-powershell', cd: (d) => `Set-Location '${d}'`, arrived: byOsc },
  { id: 'pwsh', cd: (d) => `Set-Location '${d}'`, arrived: byOsc },
  { id: 'git-bash', cd: (d) => `cd '${d.replace(/\\/g, '/')}'`, arrived: byOsc },
  { id: 'cmd', cd: (d) => `cd /d "${d}"`, arrived: byCmdPrompt },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(50);
  }
  return false;
}

/** One non-forced delete attempt, the way Explorer or `git worktree remove` makes it. */
function tryDelete(dir: string): string | null {
  try {
    rmSync(dir, { recursive: true });
    return null;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? String(error);
  }
}

const host = new NodePtyHost();
let running: PtyHandle | undefined;
let base: string | undefined;

afterEach(async () => {
  if (running) {
    const handle = running;
    let exited = false;
    host.onExit(handle, () => {
      exited = true;
    });
    host.kill(handle);
    await waitFor(() => exited, 5000);
    running = undefined;
  }
  if (base) rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  base = undefined;
});

/** Start the shipped flavour in `start`, as the daemon spawns it, capturing everything it prints. */
function launch(shell: DetectedShell, start: string, startupCommand?: string) {
  const suppression = resolveShellHistorySuppression(shell.id, true);
  const spec = resolveLaunchSpec(
    {
      id: shell.id,
      file: shell.file,
      args: shell.defaultArgs,
      commandRecipe: BUILTIN_FLAVOUR_COMMAND_RECIPES[shell.id],
      shellIntegration: resolveShellIntegration(shell.id, true),
      shellIntegrationEnv: resolveShellIntegrationEnv(shell.id, true),
      historySuppression: suppression.snippet,
      historySuppressionEnv: suppression.env,
    },
    BUILTIN_FLAVOUR_DEFAULT_SHELL_ARGUMENTS[shell.id] ?? '',
    start,
    startupCommand,
  );
  let out = '';
  const handle = host.start({
    file: spec.file,
    args: spec.args,
    ...(spec.commandLine !== undefined ? { commandLine: spec.commandLine } : {}),
    cwd: spec.spawnCwd ?? spec.cwd,
    cols: 120,
    rows: 30,
    ...(spec.env ? { env: spec.env } : {}),
  });
  running = handle;
  host.onData(handle, (chunk) => {
    out += chunk;
  });
  return { handle, output: () => out };
}

describe('a terminal that has left a folder no longer holds it (#387)', () => {
  for (const c of CASES) {
    const shell = shellFor(c.id);
    it.skipIf(!shell)(`lets the worktree be deleted after a ${c.id} terminal launched in it has cd-ed to the parent`, async () => {
      base = mkdtempSync(join(tmpdir(), 'throng-leave-'));
      const worktree = join(base, 'feature+x');
      mkdirSync(worktree);

      const term = launch(shell!, worktree);

      // The terminal reports where it is, which is what the panel remembers.
      expect(await waitFor(() => c.arrived(term.output(), worktree), 30_000), 'the terminal never showed the start directory').toBe(true);

      host.write(term.handle, `${c.cd(base)}\r`);
      expect(await waitFor(() => c.arrived(term.output(), base!), 15_000), 'the terminal never showed the parent').toBe(true);

      // The terminal says it is at the parent. Delete the folder it left.
      let lastRefusal: string | null = 'not attempted';
      const deleted = await waitFor(() => {
        lastRefusal = tryDelete(worktree);
        return lastRefusal === null;
      }, 3000);

      expect({ deleted, lastRefusal, stillThere: existsSync(worktree) }).toEqual({
        deleted: true,
        lastRefusal: null,
        stillThere: false,
      });
    });
  }

  /*
   * A Git Bash spawned away from its start directory must still run a Startup Command IN it: the
   * command runs before any prompt, so the prompt hook has not entered the directory yet.
   */
  it.skipIf(!shellFor('git-bash'))('runs a git-bash Startup Command in the start directory, not where the launcher sits', async () => {
    base = mkdtempSync(join(tmpdir(), 'throng-leave-'));
    const worktree = join(base, 'feature+x');
    mkdirSync(worktree);

    const term = launch(shellFor('git-bash')!, worktree, 'echo "at:$(cygpath -w "$PWD")"');

    expect(
      await waitFor(() => term.output().toLowerCase().includes(`at:${norm(worktree)}`), 30_000),
      `the startup command did not run in the start directory: ${JSON.stringify(term.output().slice(-400))}`,
    ).toBe(true);
    // …and the interactive shell that follows is still there too.
    expect(await waitFor(() => byOsc(term.output(), worktree), 15_000), 'the shell never reported the start directory').toBe(true);
  });

  it('finds at least one PowerShell on this machine, so the case the bug was seen in is never skipped', () => {
    expect(shellFor('windows-powershell') ?? shellFor('pwsh')).toBeDefined();
  });
});

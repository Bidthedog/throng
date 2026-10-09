import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
 * REPRO (051 MT-04 step 5) — a remembered command does not run again in cmd when it starts with a quoted program
 * path and carries more quotes after it.
 *
 * ══ WHAT THE USER SEES ══
 *
 * With command memory on, a cmd terminal runs `npm run dev`. cmd runs `npm.cmd` itself, so the command throng
 * observes and saves is npm's own: `"C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run dev`.
 * The terminal is ended and opened again, and instead of `npm run dev` it prints
 *
 *     'C:\Program' is not recognized as an internal or external command,
 *
 * ══ WHY ══
 *
 * cmd is handed `/K <command>` verbatim. Its own rule for `/K`: when the text starts with a quote and does not
 * consist of exactly one quoted program name, it removes the FIRST and the LAST quote on the line — so the
 * command it runs is no longer the one that was saved.
 *
 * Launched here exactly as the daemon spawns it (detected cmd, shipped Shell Arguments, recipe, integration),
 * against a batch file standing in for the program, so the case runs on any machine.
 */

const detected: DetectedShell[] = await new WindowsShellDetection().detectInstalledShells();
const cmd = detected.find((s) => s.id === 'cmd');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(50);
  }
  return false;
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
    void host.end(handle, 5000).catch(() => {});
    await waitFor(() => exited, 5000);
    running = undefined;
  }
  if (base) rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  base = undefined;
});

function launch(shell: DetectedShell, start: string, startupCommand: string) {
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
    cols: 200,
    rows: 30,
    ...(spec.env ? { env: spec.env } : {}),
  });
  running = handle;
  host.onData(handle, (chunk) => {
    out += chunk;
  });
  return () => out;
}

/** A program in `dir` that prints its first two arguments, so the output proves what cmd actually ran. */
function program(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, '@echo ran:[%~1]:[%~2]\r\n');
  return path;
}

describe('a remembered cmd command runs again exactly as it was saved', () => {
  const cases = [
    { title: 'a quoted program path with a space, then a quoted argument', dir: 'Program Files', name: 'say it.cmd' },
    { title: 'a quoted program path without a space, then a quoted argument', dir: 'tools', name: 'say.cmd' },
  ];
  for (const c of cases) {
    it.skipIf(!cmd)(c.title, async () => {
      base = mkdtempSync(join(tmpdir(), 'throng-cmd-quoted-'));
      const exe = program(join(base, c.dir), c.name);
      const output = launch(cmd!, base, `"${exe}" "arg one" two`);
      const ran = await waitFor(() => output().includes('ran:[arg one]:[two]'), 20_000);
      expect(ran, `cmd did not run the saved command; it printed:\n${output()}`).toBe(true);
      expect(output()).not.toMatch(/is not recognized as an internal or external command/);
    });
  }
});

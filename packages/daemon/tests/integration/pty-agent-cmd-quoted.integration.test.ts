import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUILTIN_FLAVOUR_COMMAND_RECIPES,
  BUILTIN_FLAVOUR_DEFAULT_SHELL_ARGUMENTS,
  resolveLaunchSpec,
  resolveShellIntegration,
  type DetectedShell,
  type PtyHandle,
} from '@throng/core';
import { WindowsShellDetection } from '@throng/platform-windows';
import { PtyAgentHost } from '../../src/pty-agent-host.js';

/**
 * REPRO (051 gate, terminal-command-launcher E2E on the hosted runner) — a remembered command with quoted parts does
 * not run again in cmd when the terminal is started through the PTY agent.
 *
 * An ELEVATED daemon starts every unchecked terminal through the de-elevated agent. cmd is handed `/K <command>`
 * verbatim: `resolveLaunchSpec` builds a whole `commandLine` for it, because node-pty's per-argument quoting would
 * escape the command's own quotes into something cmd cannot read. The direct host passes that line through; this
 * path is the same terminal started through the agent, which is how every terminal starts for a user who runs throng
 * as administrator. `npm run spin` remembered as `"C:\Program Files\nodejs\node.exe" "…npm-cli.js" run spin` never ran
 * again there.
 *
 * The real agent (`dist/pty-agent-entry.js`, started as the daemon starts it) and a real cmd, against a batch file
 * standing in for the program.
 */

const AGENT_ENTRY = fileURLToPath(new URL('../../dist/pty-agent-entry.js', import.meta.url));
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

let host: PtyAgentHost | undefined;
let agent: ChildProcess | undefined;
let running: PtyHandle | undefined;
let base: string | undefined;

afterEach(async () => {
  if (host && running) {
    const h = running;
    let exited = false;
    host.onExit(h, () => {
      exited = true;
    });
    void host.end(h, 5000).catch(() => {});
    await waitFor(() => exited, 5000);
  }
  await host?.dispose();
  agent?.kill();
  host = undefined;
  agent = undefined;
  running = undefined;
  if (base) rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  base = undefined;
});

describe('a remembered cmd command runs again through the PTY agent', () => {
  it.skipIf(!cmd)('a quoted program path with a space, then a quoted argument', async () => {
    expect(existsSync(AGENT_ENTRY), `build the daemon first: ${AGENT_ENTRY} is missing`).toBe(true);
    base = mkdtempSync(join(tmpdir(), 'throng-agent-quoted-'));
    const dir = join(base, 'Program Files');
    mkdirSync(dir);
    const exe = join(dir, 'say it.cmd');
    writeFileSync(exe, '@echo ran:[%~1]:[%~2]\r\n');

    const pipe = `\\\\.\\pipe\\throng-agent-quoted-${process.pid}-${Date.now()}`;
    host = new PtyAgentHost(pipe, (p) => {
      agent = spawn(process.execPath, [AGENT_ENTRY, p], { stdio: 'ignore', windowsHide: true });
    });
    const spec = resolveLaunchSpec(
      {
        id: cmd!.id,
        file: cmd!.file,
        args: cmd!.defaultArgs,
        commandRecipe: BUILTIN_FLAVOUR_COMMAND_RECIPES[cmd!.id],
        shellIntegration: resolveShellIntegration(cmd!.id, true),
      },
      BUILTIN_FLAVOUR_DEFAULT_SHELL_ARGUMENTS[cmd!.id] ?? '',
      base,
      `"${exe}" "arg one" two`,
    );
    let out = '';
    running = host.start({
      file: spec.file,
      args: spec.args,
      ...(spec.commandLine !== undefined ? { commandLine: spec.commandLine } : {}),
      cwd: spec.spawnCwd ?? spec.cwd,
      cols: 200,
      rows: 30,
      ...(spec.env ? { env: spec.env } : {}),
    });
    host.onData(running, (chunk) => {
      out += chunk;
    });

    const ran = await waitFor(() => out.includes('ran:[arg one]:[two]'), 20_000);
    expect(ran, `cmd did not run the saved command through the agent; it printed:\n${out}`).toBe(true);
  }, 40_000);
});

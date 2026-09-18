import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUILTIN_FLAVOUR_COMMAND_RECIPES,
  BUILTIN_FLAVOUR_DEFAULT_SHELL_ARGUMENTS,
  flavourReportsDirectory,
  resolveLaunchSpec,
  resolveShellHistorySuppression,
  resolveShellIntegration,
  resolveShellIntegrationEnv,
  resolveStartDirectory,
  tokenizeParams,
} from '@throng/core';
import type { PtyHandle } from '@throng/core';
import { NodePtyHost } from '../../src/node-pty-host.js';
import { WindowsProcessCwd } from '../../src/windows-process-cwd.js';
import { WindowsShellDetection } from '../../src/windows-shell-detection.js';

/**
 * 045 T190, FR-141 / FR-142 / FR-144 / SC-018 — what each REAL flavour hands throng through ConPTY.
 *
 * Two facts a link depends on, and both are the SHELL's behaviour rather than throng's code:
 *
 *   - where the shell IS after `cd sub` — observed from outside for `cmd` (its `cd` moves the process
 *     directory, 025's live poll), reported through 025's OSC 9;9 integration for the other three —
 *     and that the value is comparable with the project root (025 FR-032f), because a relative link
 *     resolves against it (FR-142);
 *   - that an OSC 8 hyperlink a program prints arrives through ConPTY as an OSC 8 hyperlink (FR-141).
 *     ConPTY re-renders what it forwards, so "intact" means the TARGET and the TEXT survive; it may
 *     add an `id=` parameter and re-terminate the sequence, which xterm reads the same way.
 *
 * Spawned exactly as the daemon spawns them — the launch spec `terminal-ipc` builds, through the real
 * `NodePtyHost` — on 025's `shell-history.integration.test.ts` shape. Not an E2E: no window, renderer
 * or daemon is needed to ask a shell where it is.
 *
 * A flavour not installed here is SKIPPED WITH THE REASON PRINTED, never passed (FR-145). WSL is not a
 * built-in (005 FR-024); it runs where a distro is installed, and only its OSC 8 half applies — it
 * reports no directory by design (FR-144), so there is no directory claim to make of it.
 */

const OSC8_URI = 'https://example.com/osc8-through-conpty';
const OSC8_TEXT = 'OSC8FLAVOURTEXT';
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

/**
 * OSC 8 as it may leave ConPTY, which RE-RENDERS rather than forwarding bytes: the opener may gain an
 * `id=` parameter (measured: `ESC]8;id=37816-1;<uri>`), and the opener and closer may be separated
 * from the text by cursor movement — a CR/LF or a CSI sequence — because ConPTY emits the attribute
 * change where it paints, not where the program wrote it. What must hold is what xterm reads: the
 * opener names the target and precedes the text with no printable cell between, and a closer follows.
 */
function osc8Intact(output: string): boolean {
  const st = `(?:${ESC}\\\\|${BEL})`;
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const open = `${ESC}\\]8;[^;${BEL}${ESC}]*;${esc(OSC8_URI)}${st}`;
  const noCells = `(?:\\r|\\n|${ESC}\\[[0-9;?]*[A-Za-z])*`;
  const close = `${ESC}\\]8;[^;${BEL}${ESC}]*;${st}`;
  return new RegExp(`${open}${noCells}${OSC8_TEXT}[\\s\\S]*?${close}`).test(output);
}

/**
 * The command that makes THE SHELL print the hyperlink — its own `echo`/`Write-Host`/`printf`, not a
 * program it launches.
 *
 * That distinction was measured, not assumed. Printed by `node` instead, the hyperlink arrived intact
 * under `cmd` and both PowerShells and was STRIPPED under Git Bash — the text arrived, bracketed by
 * `ESC[K`, and no OSC 8 at all. Why is a HYPOTHESIS, not measured: MSYS leaves the console without
 * virtual-terminal processing for the native program it runs, so libuv falls back to its own ANSI
 * emulation, which drops OSC. The observation stands either way. So under
 * Git Bash an OSC 8 link from a NATIVE Windows program (node, and so Claude Code) reaches throng as
 * plain text, and only FR-141's detection fallback can make it a link; an MSYS program's (`printf`,
 * the corpus's `links-test.sh`) arrives intact.
 */
function printHyperlinkCommand(id: string): string {
  switch (id) {
    case 'cmd':
      // cmd cannot TYPE an escape, so it captures one from `prompt $E` first. Not a batch file: on
      // this workstation a `.cmd` written to %TEMP% was listed by `dir` and yet "not recognized"
      // when run, which would fail this for a reason that has nothing to do with ConPTY.
      return (
        `for /F %a in ('echo prompt $E ^| cmd') do @set "ESC=%a"\r` +
        `echo %ESC%]8;;${OSC8_URI}%ESC%\\${OSC8_TEXT}%ESC%]8;;%ESC%\\`
      );
    case 'windows-powershell':
    case 'pwsh':
      return (
        `Write-Host ([char]27 + ']8;;${OSC8_URI}' + [char]27 + '\\${OSC8_TEXT}' + ` +
        `[char]27 + ']8;;' + [char]27 + '\\')`
      );
    default:
      return `printf '\\033]8;;${OSC8_URI}\\033\\\\${OSC8_TEXT}\\033]8;;\\033\\\\\\n'`;
  }
}

/** Every OSC 9;9 directory report in `output`, in order. */
function reportedDirectories(output: string): string[] {
  const re = new RegExp(`${ESC}\\]9;9;([^${BEL}${ESC}]*)(?:${BEL}|${ESC}\\\\)`, 'g');
  return [...output.matchAll(re)].map((m) => m[1]);
}

/** One spelling for a directory: separators, case and a trailing separator do not matter. */
const same = (a: string, b: string): boolean =>
  a.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase() === b.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(what: string, check: () => boolean | Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(100);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
}

const host = new NodePtyHost();
const detected = await new WindowsShellDetection().detectInstalledShells();
const roots: string[] = [];

afterAll(() => {
  host.dispose();
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** A project root with a `sub` folder to `cd` into. */
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-flavour-links-'));
  roots.push(root);
  mkdirSync(join(root, 'sub'));
  return root;
}

interface Session {
  readonly handle: PtyHandle;
  output: () => string;
  write: (s: string) => void;
  stop: () => void;
}

/** Start a built-in flavour the way `terminal-ipc` + the daemon do, with shell integration ON. */
function startBuiltIn(id: string, file: string, root: string): Session {
  const history = resolveShellHistorySuppression(id, true);
  const spec = resolveLaunchSpec(
    {
      id,
      file,
      args: tokenizeParams(BUILTIN_FLAVOUR_DEFAULT_SHELL_ARGUMENTS[id] ?? ''),
      commandRecipe: BUILTIN_FLAVOUR_COMMAND_RECIPES[id],
      shellIntegration: resolveShellIntegration(id, true),
      shellIntegrationEnv: resolveShellIntegrationEnv(id, true),
      historySuppression: history.snippet,
      historySuppressionEnv: history.env,
    },
    '',
    root,
  );
  return startPty({
    file: spec.file,
    args: spec.args,
    cwd: spec.spawnCwd ?? spec.cwd,
    ...(spec.env ? { env: spec.env } : {}),
    ...(spec.commandLine !== undefined ? { commandLine: spec.commandLine } : {}),
  });
}

function startPty(opts: { file: string; args: string[]; cwd: string; env?: Record<string, string>; commandLine?: string }): Session {
  const handle = host.start({ ...opts, cols: 160, rows: 40 });
  let out = '';
  const off = host.onData(handle, (chunk) => {
    out += chunk;
  });
  return {
    handle,
    output: () => out,
    write: (s) => host.write(handle, s),
    stop: () => {
      off();
      host.kill(handle);
    },
  };
}

const BUILT_IN = ['cmd', 'windows-powershell', 'pwsh', 'git-bash'] as const;

describe('045 T190 — every installed built-in flavour, through ConPTY', () => {
  for (const id of BUILT_IN) {
    const shell = detected.find((s) => s.id === id);
    const reason = `${id} is not installed on this machine — not run (FR-145), never counted as a pass`;
    if (!shell) console.warn(`[T190] ${reason}`);

    it.skipIf(!shell)(
      `${id}: after \`cd sub\` the directory arrives comparable with the root, and OSC 8 arrives intact`,
      async () => {
        const root = makeRoot();
        const sub = join(root, 'sub');
        const session = startBuiltIn(id, shell!.file, root);
        try {
          // The shell is at its first prompt: an integration report for the three that report, the
          // prompt's `>` for cmd. Input typed before it would race the shell starting up.
          await until(`${id}'s first prompt`, () =>
            id === 'cmd' ? session.output().includes('>') : reportedDirectories(session.output()).length > 0,
          );
          session.write('cd sub\r');

          if (id === 'cmd') {
            // FR-142: cmd's `cd` moves the PROCESS directory — the value 025's live poll observes.
            expect(flavourReportsDirectory(id, true)).toBe(true);
            let observed = '';
            await until('cmd to be observed in sub', async () => {
              observed = (await new WindowsProcessCwd().read([session.handle.pid])).get(session.handle.pid) ?? '';
              return same(observed, sub);
            });
            expect(resolveStartDirectory(root, observed, existsSync), 'not comparable with the root').toBe(observed);
          } else {
            // FR-142: the other three REPORT it, through OSC 9;9, only because integration is on.
            expect(flavourReportsDirectory(id, true)).toBe(true);
            expect(flavourReportsDirectory(id, false)).toBe(false);
            await until(`${id} to report sub through OSC 9;9`, () =>
              reportedDirectories(session.output()).some((d) => same(d, sub)),
            );
            const reported = reportedDirectories(session.output()).find((d) => same(d, sub))!;
            // FR-032f: comparable with the project root — inside it, as 025's resolver judges.
            expect(resolveStartDirectory(root, reported, existsSync), `${reported} not comparable with ${root}`).toBe(
              reported,
            );
          }

          // FR-141: the shell prints an OSC 8 hyperlink; it arrives as one.
          session.write(`${printHyperlinkCommand(id)}\r`);
          await until(`${id}'s hyperlink to arrive intact`, () => osc8Intact(session.output()), 20_000).catch(() => {
            const out = session.output();
            const at = out.lastIndexOf(OSC8_TEXT);
            throw new Error(
              `${id}: the OSC 8 hyperlink did not survive ConPTY. ` +
                (at < 0
                  ? `The text never arrived; the output ends: ${JSON.stringify(out.slice(-400))}`
                  : `Around the text: ${JSON.stringify(out.slice(Math.max(0, at - 120), at + 60))}`),
            );
          });
        } finally {
          session.stop();
        }
      },
      90_000,
    );
  }
});

/** Is a WSL distro installed? `wsl.exe -l -q` lists them, in UTF-16. */
function wslDistro(): string | null {
  const wsl = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wsl.exe');
  if (!existsSync(wsl)) return null;
  try {
    const raw = execFileSync(wsl, ['-l', '-q'], { timeout: 20_000 });
    const names = raw
      .toString('utf16le')
      .split(/\r?\n/)
      .map((s) => s.replace(/\0/g, '').trim())
      .filter((s) => s.length > 0);
    return names[0] ?? null;
  } catch {
    return null;
  }
}

describe('045 T190 — a WSL flavour, where a distro is installed', () => {
  const distro = wslDistro();
  if (distro === null) console.warn('[T190] no WSL distro is installed — WSL not run (FR-145)');

  it.skipIf(distro === null)(
    'OSC 8 printed inside WSL arrives intact through ConPTY (FR-141)',
    async () => {
      const root = makeRoot();
      const wsl = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wsl.exe');
      // A user-defined flavour pointing at wsl.exe, no integration of any kind (025 FR-011).
      const session = startPty({ file: wsl, args: [], cwd: root });
      try {
        // Ready when the distro's shell has echoed something we typed.
        await until('the WSL shell to start', async () => {
          session.write('echo WSL_READY_$((20+22))\r');
          await sleep(1_000);
          return session.output().includes('WSL_READY_42');
        }, 60_000);
        session.write(`${printHyperlinkCommand('wsl')}\r`);
        await until('WSL to print the hyperlink', () => osc8Intact(session.output()), 20_000).catch(
          () => {
            const at = session.output().lastIndexOf(OSC8_TEXT);
            throw new Error(
              'WSL: the OSC 8 hyperlink did not survive ConPTY. Around the text: ' +
                JSON.stringify(session.output().slice(Math.max(0, at - 120), at + 60)),
            );
          },
        );
      } finally {
        session.stop();
      }
    },
    120_000,
  );
});

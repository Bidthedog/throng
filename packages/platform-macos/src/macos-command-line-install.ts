import { execFile } from 'node:child_process';
import { lstat, readlink, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path/posix';
import { logExpected, type CommandLineStatus, type ICommandLineInstall } from '@throng/core';

/** Where the command goes: on every Mac's default PATH, and where Homebrew on Intel and most installers put theirs. */
export const DEFAULT_LINK_PATH = '/usr/local/bin/throng';
/** The script inside the bundle the link points at (`electron-builder.yml` ships `packaging/macos/throng-cli.sh` here). */
const SCRIPT_IN_CONTENTS = join('Resources', 'bin', 'throng');
/** A link into any throng bundle's script, wherever the bundle is or was. */
const THRONG_SCRIPT = /\.app\/Contents\/Resources\/bin\/throng$/;

/** Run a shell command with the system's own administrator prompt. Rejects with `declined` set when the user cancels. */
export type PrivilegedRunner = (command: string) => Promise<void>;

/** `'…'` quoting for `sh`: the one character it cannot hold, `'`, closed, escaped and reopened. */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** An AppleScript string literal. */
export function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** AppleScript's "User canceled." (`-128`), which is what dismissing the administrator prompt answers. */
const USER_CANCELED = /\(-128\)|User canceled/i;

/** The system administrator prompt, through `osascript … with administrator privileges` (070 R20). */
export const osascriptAdministrator: PrivilegedRunner = (command) =>
  new Promise((resolve, reject) => {
    const script = `do shell script ${appleScriptString(command)} with administrator privileges`;
    // child-exempt: every failure rejects with its stderr, and MacosCommandLineInstall.run, the only caller, records each through logExpected; a declined prompt is routine, so logChildFailure's error line would be wrong.
    execFile('osascript', ['-e', script], { timeout: 5 * 60_000, encoding: 'utf8' }, (error, _stdout, stderr) => {
      if (!error) {
        resolve();
        return;
      }
      const words = String(stderr).trim() || error.message;
      reject(Object.assign(new Error(words), { declined: USER_CANCELED.test(words) }));
    });
  });

/**
 * The readable part of what `osascript` or a shell said: AppleScript's `0:83: execution error:` prefix and its
 * trailing `(1)` code dropped, one line, no trailing full stop (the caller ends the sentence). Empty when nothing is left.
 */
export function plainWords(message: string): string {
  const first = message.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return first
    .replace(/^\d+:\d+:\s*execution error:\s*/i, '')
    .replace(/\s*\(-?\d+\)\s*$/, '')
    .replace(/\b(E[A-Z]{3,}):\s*/g, '')
    .replace(/[.\s]+$/, '');
}

/** The `.app` folder holding `execPath`, or null when this copy is not running from a bundle. */
export function bundleOf(execPath: string): string | null {
  const contents = dirname(dirname(execPath));
  return contents.endsWith('.app/Contents') ? dirname(contents) : null;
}

export interface MacosCommandLineInstallOptions {
  readonly execPath: string;
  readonly linkPath?: string;
  readonly privileged?: PrivilegedRunner;
}

/**
 * The `throng` command (070 FR-024a, R20): `/usr/local/bin/throng` linked to the script in the running bundle, made
 * and removed through the system's own administrator prompt. A link that points elsewhere is replaced only when the
 * caller says the user agreed; a link into a throng bundle that has moved reads as broken, and installing again
 * repairs it; uninstall removes only a link into a throng bundle.
 */
export class MacosCommandLineInstall implements ICommandLineInstall {
  readonly available: boolean;
  readonly unavailableReason?: string;
  private readonly linkPath: string;
  private readonly script: string | null;
  private readonly privileged: PrivilegedRunner;

  constructor(opts: MacosCommandLineInstallOptions) {
    const bundle = bundleOf(opts.execPath);
    this.script = bundle === null ? null : join(bundle, 'Contents', SCRIPT_IN_CONTENTS);
    this.linkPath = opts.linkPath ?? DEFAULT_LINK_PATH;
    this.privileged = opts.privileged ?? osascriptAdministrator;
    this.available = this.script !== null;
    if (!this.available) this.unavailableReason = 'This copy of throng is not running from an app bundle, so it has no command to install.';
  }

  async status(): Promise<CommandLineStatus> {
    const linkPath = this.linkPath;
    const info = await lstat(linkPath).catch((error: unknown) => {
      logExpected('macos-command-line-install: look at the command', 'no command installed yet is the usual answer', error);
      return null;
    });
    if (info === null) return { kind: 'absent' };
    if (!info.isSymbolicLink()) return { kind: 'other', linkPath, target: linkPath };
    const raw = await readlink(linkPath);
    const target = isAbsolute(raw) ? raw : resolve(dirname(linkPath), raw);
    if (!THRONG_SCRIPT.test(target)) return { kind: 'other', linkPath, target };
    const present = await stat(target).then(
      () => true,
      () => false,
    );
    if (!present) return { kind: 'ours-broken', linkPath, target };
    return target === this.script ? { kind: 'ours', linkPath } : { kind: 'other', linkPath, target };
  }

  async install(opts: { readonly replaceOther: boolean }): Promise<CommandLineStatus> {
    const script = this.requireScript();
    const now = await this.status();
    if (now.kind === 'ours') return now;
    if (now.kind === 'other' && !opts.replaceOther) {
      throw new Error(`${this.linkPath} already points at another program.`);
    }
    const command = `mkdir -p ${shQuote(dirname(this.linkPath))} && ln -sfn ${shQuote(script)} ${shQuote(this.linkPath)}`;
    await this.run(command, 'install');
    return this.status();
  }

  async uninstall(): Promise<CommandLineStatus> {
    this.requireScript();
    const now = await this.status();
    if (now.kind !== 'ours' && now.kind !== 'ours-broken') return now;
    await this.run(`rm -f ${shQuote(this.linkPath)}`, 'uninstall');
    return this.status();
  }

  private requireScript(): string {
    if (this.script === null) throw new Error(this.unavailableReason);
    return this.script;
  }

  /** Every rejection is a sentence for the user's notice (070 FR-024a): no errno, no stack, the system's words cleaned. */
  private async run(command: string, what: 'install' | 'uninstall'): Promise<void> {
    const done = what === 'install' ? 'installed' : 'removed';
    try {
      await this.privileged(command);
    } catch (error) {
      logExpected(`macos-command-line-install: ${what}`, 'the user may decline the prompt, or the system may refuse; the notice says which', error);
      if ((error as { declined?: boolean }).declined) {
        throw Object.assign(new Error(`You declined the administrator prompt, so the command was not ${done}.`, { cause: error }), { declined: true });
      }
      const words = plainWords((error as Error).message);
      throw new Error(words ? `The 'throng' command could not be ${done}: ${words}.` : `The 'throng' command could not be ${done}.`, { cause: error });
    }
  }
}

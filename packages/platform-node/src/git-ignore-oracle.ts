import { join } from 'node:path';
import { logExpected, type IgnoreOracle } from '@throng/core';
import { execFileOffLoop, type ExecCallback, type OffLoopExecOptions } from './off-loop-exec.js';

/**
 * `IgnoreOracle` over `git check-ignore -z --stdin` (081 R11, contract `ignore-oracle.md`).
 *
 * Git answers, so its own rules apply: every `.gitignore`, `.git/info/exclude`, the global excludes file, and a
 * tracked file is never named even when a pattern matches it. The paths of one batch are grouped by their folder and
 * git runs in that folder, so an entry inside a nested repository is answered by that repository's rules rather than
 * the outer one's. A listing is one folder, so a listing is one git process, started off the event loop (XII).
 *
 * Exit 1 is git's "none ignored". Any other failure (not a repository, git missing, a folder gone) answers empty and
 * is logged once per root at debug (XIII, FR-073): a project that is not a repository asks on every listing.
 *
 * On macOS, `/usr/bin/git` without the Command Line Tools is a shim that opens Apple's install dialog each time it
 * runs, and an app started from the Finder finds that shim first. So `xcode-select -p` is asked once: with no developer
 * directory, git is unavailable for the session and is never started (FR-073: nothing fades, nothing is shown).
 */

export type ExecLike = (file: string, args: readonly string[], options: OffLoopExecOptions, callback: ExecCallback) => void;

export interface GitIgnoreOracleOptions {
  /** Where a failed question is written, once per root. Defaults to a debug line. */
  log?: (message: string) => void;
  /** The process runner. Defaults to `execFileOffLoop`. */
  exec?: ExecLike;
  /** The git executable. Defaults to `git` on PATH. */
  git?: string;
  /** The OS, which decides whether git's presence is checked first. Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
}

const MAX_OUTPUT = 16 * 1024 * 1024;

/** `a/b/c.txt` → [`a/b`, `c.txt`]; `a/b/` → [`a`, `b/`]; `c.txt` → [``, `c.txt`]. */
function splitParent(relPath: string): [string, string] {
  const folder = relPath.endsWith('/');
  const bare = folder ? relPath.slice(0, -1) : relPath;
  const cut = bare.lastIndexOf('/');
  const name = (cut < 0 ? bare : bare.slice(cut + 1)) + (folder ? '/' : '');
  return [cut < 0 ? '' : bare.slice(0, cut), name];
}

export class GitIgnoreOracle implements IgnoreOracle {
  private readonly loggedRoots = new Set<string>();
  private readonly log: (message: string) => void;
  private readonly exec: ExecLike;
  private readonly git: string;
  private readonly platform: NodeJS.Platform;
  /** Whether git can be started without a dialog: asked once, on macOS only. */
  private gitPresent: Promise<boolean> | null = null;

  constructor(options: GitIgnoreOracleOptions = {}) {
    this.log =
      options.log ??
      ((message) => logExpected('git ignore oracle', 'a project that is not a git repository, or a host without git, fades nothing', message));
    this.exec = options.exec ?? execFileOffLoop;
    this.git = options.git ?? 'git';
    this.platform = options.platform ?? process.platform;
  }

  async ignored(root: string, relPaths: readonly string[]): Promise<ReadonlySet<string>> {
    const groups = new Map<string, Map<string, string>>();
    for (const relPath of relPaths) {
      if (relPath === '' || relPath === '/') continue;
      const [parent, name] = splitParent(relPath);
      let names = groups.get(parent);
      if (!names) groups.set(parent, (names = new Map()));
      names.set(name, relPath);
    }
    const answer = new Set<string>();
    if (groups.size === 0 || !(await this.present(root))) return answer;
    // One folder at a time: a refresh after a .gitignore change asks every expanded folder, and nothing waits on it.
    for (const [parent, names] of groups) {
      for (const name of await this.ask(root, parent, [...names.keys()])) {
        const relPath = names.get(name);
        if (relPath !== undefined) answer.add(relPath);
      }
    }
    return answer;
  }

  private present(root: string): Promise<boolean> {
    if (this.platform !== 'darwin') return Promise.resolve(true);
    this.gitPresent ??= new Promise((resolve) => {
      // child-exempt: a failed start or a non-zero exit is the callback's error, answered as no git and logged once below.
      this.exec('xcode-select', ['-p'], { windowsHide: true }, (error) => {
        if (error) this.logOnce(root, `no developer tools (xcode-select -p: ${error.message.trim()}), so git is not started`);
        resolve(!error);
      });
    });
    return this.gitPresent;
  }

  private ask(root: string, parent: string, names: readonly string[]): Promise<string[]> {
    return new Promise((resolve) => {
      const cwd = parent === '' ? root : join(root, ...parent.split('/'));
      // child-exempt: a failed start or a non-zero exit is the callback's error, answered empty and logged once per root below.
      // `core.fsmonitor` off: a repository's own config can name a command for it, and opening a cloned project in
      // throng must never run one.
      this.exec(
        this.git,
        ['-c', 'core.fsmonitor=false', '-C', cwd, 'check-ignore', '-z', '--stdin'],
        { input: names.join('\0') + '\0', maxBuffer: MAX_OUTPUT, windowsHide: true },
        (error, stdout, stderr) => {
          if (!error) return resolve(stdout.split('\0').filter((name) => name !== ''));
          if (error.code !== 1) this.logOnce(root, `${error.message.trim()}${stderr.trim() ? ` — ${stderr.trim()}` : ''}`);
          resolve([]);
        },
      );
    });
  }

  private logOnce(root: string, why: string): void {
    if (this.loggedRoots.has(root)) return;
    this.loggedRoots.add(root);
    this.log(`git check-ignore for ${root} answered nothing: ${why}`);
  }
}

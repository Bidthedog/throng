import { rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
 * A folder no repository holds (exit 128) is asked again against an empty bare repository of the oracle's own, made
 * once in the temp folder, with the project root as the work tree (FR-073): the project's `.gitignore` files and the
 * global excludes apply, read from the project root, and nothing is written into the project.
 *
 * Exit 1 is git's "none ignored". Any other failure (git missing, a folder gone) answers empty and is logged once per
 * root at debug (XIII).
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
  /** Where the empty repository for projects outside any repository is made. Defaults to the OS temp folder. */
  scratchParent?: string;
}

const MAX_OUTPUT = 16 * 1024 * 1024;
/** git's exit code for "not a git repository", among other fatal errors. */
const NOT_A_REPOSITORY = 128;

/** The empty repositories this process made, removed when it exits. */
const scratchRepos = new Set<string>();
let removeOnExit = false;

function forgetOnExit(dir: string): void {
  scratchRepos.add(dir);
  if (removeOnExit) return;
  removeOnExit = true;
  process.once('exit', () => {
    for (const repo of scratchRepos) rmSync(repo, { recursive: true, force: true });
  });
}

/** `a/b/c.txt` → [`a/b`, `c.txt`]; `a/b/` → [`a`, `b/`]; `c.txt` → [``, `c.txt`]. */
function splitParent(relPath: string): [string, string] {
  const folder = relPath.endsWith('/');
  const bare = folder ? relPath.slice(0, -1) : relPath;
  const cut = bare.lastIndexOf('/');
  const name = (cut < 0 ? bare : bare.slice(cut + 1)) + (folder ? '/' : '');
  return [cut < 0 ? '' : bare.slice(0, cut), name];
}

type Outcome = { names: string[] } | { failed: number | null; why: string };

export class GitIgnoreOracle implements IgnoreOracle {
  private readonly loggedRoots = new Set<string>();
  private readonly log: (message: string) => void;
  private readonly exec: ExecLike;
  private readonly git: string;
  private readonly platform: NodeJS.Platform;
  private readonly scratchParent: string;
  /** Whether git can be started without a dialog: asked once, on macOS only. */
  private gitPresent: Promise<boolean> | null = null;
  /** The empty bare repository for folders outside any repository: made once, on first need. */
  private scratchRepo: Promise<string> | null = null;

  constructor(options: GitIgnoreOracleOptions = {}) {
    this.log =
      options.log ??
      ((message) => logExpected('git ignore oracle', 'a host without git, or a project folder that is gone, fades nothing', message));
    this.exec = options.exec ?? execFileOffLoop;
    this.git = options.git ?? 'git';
    this.platform = options.platform ?? process.platform;
    this.scratchParent = options.scratchParent ?? tmpdir();
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

  private async ask(root: string, parent: string, names: readonly string[]): Promise<string[]> {
    const cwd = parent === '' ? root : join(root, ...parent.split('/'));
    let outcome = await this.checkIgnore([], cwd, names);
    if ('failed' in outcome && outcome.failed === NOT_A_REPOSITORY) {
      // FR-073: no repository holds this folder, so the project's own `.gitignore` files answer, with the project root
      // standing in for a repository's.
      const scratch = await this.scratch();
      if (typeof scratch !== 'string') outcome = scratch;
      else outcome = await this.checkIgnore([`--git-dir=${scratch}`, `--work-tree=${root}`], cwd, names);
    }
    if ('names' in outcome) return outcome.names;
    if (outcome.failed !== 1) this.logOnce(root, outcome.why);
    return [];
  }

  private checkIgnore(repoArgs: readonly string[], cwd: string, names: readonly string[]): Promise<Outcome> {
    return new Promise((resolve) => {
      // child-exempt: a failed start or a non-zero exit is the callback's error, answered as an outcome the caller logs.
      // `core.fsmonitor` off: a repository's own config can name a command for it, and opening a cloned project in
      // throng must never run one.
      this.exec(
        this.git,
        ['-c', 'core.fsmonitor=false', ...repoArgs, '-C', cwd, 'check-ignore', '-z', '--stdin'],
        { input: names.join('\0') + '\0', maxBuffer: MAX_OUTPUT, windowsHide: true },
        (error, stdout, stderr) => {
          if (!error) return resolve({ names: stdout.split('\0').filter((name) => name !== '') });
          const code = typeof error.code === 'number' ? error.code : null;
          resolve({ failed: code, why: `${error.message.trim()}${stderr.trim() ? ` — ${stderr.trim()}` : ''}` });
        },
      );
    });
  }

  /** The empty bare repository, or why it could not be made. A failure stands for the session. */
  private scratch(): Promise<string | { failed: null; why: string }> {
    this.scratchRepo ??= mkdtemp(join(this.scratchParent, 'throng-git-ignore-')).then(
      (dir) =>
        new Promise<string>((resolve, reject) => {
          forgetOnExit(dir);
          // `--template=` empty: no sample hooks or info files, so the repository holds nothing but its skeleton.
          // child-exempt: a failed start or a non-zero exit is the callback's error, rejected and answered empty below.
          this.exec(this.git, ['init', '--bare', '-q', '--template=', dir], { windowsHide: true }, (error, _stdout, stderr) =>
            error ? reject(new Error(`git init of ${dir}: ${error.message.trim()} ${stderr.trim()}`.trim())) : resolve(dir),
          );
        }),
    );
    return this.scratchRepo.catch((error: unknown) => {
      logExpected('git ignore oracle: make the scratch repository', 'a project that is not a git repository fades nothing', error);
      return { failed: null, why: `no empty repository to ask against (${error instanceof Error ? error.message : String(error)})` };
    });
  }

  private logOnce(root: string, why: string): void {
    if (this.loggedRoots.has(root)) return;
    this.loggedRoots.add(root);
    this.log(`git check-ignore for ${root} answered nothing: ${why}`);
  }
}

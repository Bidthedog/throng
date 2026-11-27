import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitIgnoreOracle, execFileOffLoop, type GitIgnoreOracleOptions } from '@throng/platform-node';
import { skipOnWindows } from '@throng/core/testing';

/**
 * 081 US8, FR-070 / FR-073, contract `ignore-oracle.md` — git answers which explorer entries it ignores.
 *
 * Layer: integration — what is under test is git's own matching (`.gitignore`, `.git/info/exclude`, a tracked file a
 * pattern would match, a nested repository's rules); no fake reproduces it. One fixture repository, built once and
 * only read.
 */

let base: string;
let repo: string;
let plain: string;

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });
};
const write = (path: string, text = ''): void => {
  writeFileSync(path, text);
};

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'throng-ignore-'));
  repo = join(base, 'repo');
  plain = join(base, 'plain');
  for (const dir of [repo, join(repo, 'build'), join(repo, 'src'), join(repo, 'nested', 'out'), plain]) {
    mkdirSync(dir, { recursive: true });
  }
  git(repo, 'init', '-q');
  write(join(repo, '.gitignore'), 'build/\n*.log\n*.tmp\n');
  write(join(repo, 'build', 'app.js'));
  write(join(repo, 'src', 'main.ts'));
  write(join(repo, 'src', 'debug.log'));
  write(join(repo, 'kept.log'));
  git(repo, 'add', '-f', 'kept.log');
  write(join(repo, '.git', 'info', 'exclude'), 'secret.txt\n');
  write(join(repo, 'secret.txt'));
  git(join(repo, 'nested'), 'init', '-q');
  write(join(repo, 'nested', '.gitignore'), 'out/\n');
  write(join(repo, 'nested', 'scratch.tmp'));
  // A project that is not a repository, with a root and a nested `.gitignore`.
  mkdirSync(join(plain, 'docs', 'deep'), { recursive: true });
  write(join(plain, '.gitignore'), '*.txt\nstray\nout/\n');
  write(join(plain, 'docs', '.gitignore'), 'draft.md\n');
  write(join(plain, 'notes.txt'));
  write(join(plain, 'readme.md'));
  write(join(plain, 'docs', 'draft.md'));
  write(join(plain, 'docs', 'final.md'));
  write(join(plain, 'docs', 'deep', 'more.txt'));
});

/** Every path under `dir`, relative and sorted. */
function listTree(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[]).map((p) => p.split(sep).join('/')).sort();
}

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

interface Probe {
  oracle: GitIgnoreOracle;
  lines: string[];
  spawns: () => number;
  /** The arguments of every git process started. */
  gitArgs: (readonly string[])[];
}

function probe(): Probe {
  const lines: string[] = [];
  let spawns = 0;
  const gitArgs: (readonly string[])[] = [];
  const options: GitIgnoreOracleOptions = {
    log: (message) => lines.push(message),
    // The empty repository for a project outside any repository goes in the fixture, which afterAll removes.
    scratchParent: base,
    exec: (file, args, execOptions, callback) => {
      // Git starts only: on macOS the oracle first asks `xcode-select -p` whether the developer tools are installed.
      if (file === 'git') {
        spawns += 1;
        gitArgs.push(args);
      }
      execFileOffLoop(file, args, execOptions, callback);
    },
  };
  return { oracle: new GitIgnoreOracle(options), lines, spawns: () => spawns, gitArgs };
}

describe('GitIgnoreOracle', () => {
  it('names an ignored file and an ignored folder asked with a trailing /, and not their siblings', async () => {
    const { oracle } = probe();
    const answer = await oracle.ignored(repo, ['build/', 'src/', '.gitignore', 'src/main.ts', 'src/debug.log']);
    expect([...answer].sort()).toEqual(['build/', 'src/debug.log']);
  });

  it('does not name a tracked file a pattern matches', async () => {
    const { oracle } = probe();
    expect([...(await oracle.ignored(repo, ['kept.log']))]).toEqual([]);
  });

  it('names a path matched only by .git/info/exclude', async () => {
    const { oracle } = probe();
    expect([...(await oracle.ignored(repo, ['secret.txt']))]).toEqual(['secret.txt']);
  });

  it("answers a nested repository's entries by that repository's own rules", async () => {
    const { oracle } = probe();
    // The outer repository ignores *.tmp; the nested one does not, and ignores out/ instead.
    const answer = await oracle.ignored(repo, ['nested/out/', 'nested/scratch.tmp', 'nested/.gitignore']);
    expect([...answer]).toEqual(['nested/out/']);
  });

  it("applies a project's .gitignore files when the project is not a git repository (FR-073)", async () => {
    // The maintainer's report: a root `.gitignore` of `*.txt` and a stray line, in a folder no repository holds.
    const { oracle } = probe();
    expect([...(await oracle.ignored(plain, ['notes.txt', 'readme.md', '.gitignore', 'stray', 'out/']))].sort()).toEqual([
      'out/',
      'stray',
      'notes.txt',
    ].sort());
    // A nested `.gitignore` adds its own rules for its folder, and the root's still reach below it.
    expect([...(await oracle.ignored(plain, ['docs/draft.md', 'docs/final.md', 'docs/deep/more.txt']))].sort()).toEqual([
      'docs/deep/more.txt',
      'docs/draft.md',
    ]);
  });

  it('makes its empty repository once, and keeps the repository fsmonitor off when asking against it', async () => {
    const { oracle, gitArgs } = probe();
    await oracle.ignored(plain, ['notes.txt']);
    await oracle.ignored(plain, ['docs/draft.md']);
    expect(gitArgs.filter((args) => args.includes('init'))).toHaveLength(1);
    const against = gitArgs.filter((args) => args.some((arg) => arg.startsWith('--work-tree=')));
    expect(against).toHaveLength(2);
    for (const args of against) expect(args.slice(0, 2)).toEqual(['-c', 'core.fsmonitor=false']);
    expect(against[0]).toContain(`--work-tree=${plain}`);
  });

  it('writes nothing into a project that is not a git repository', async () => {
    const before = listTree(plain);
    const { oracle } = probe();
    await oracle.ignored(plain, ['notes.txt', 'docs/draft.md']);
    expect(listTree(plain)).toEqual(before);
  });

  it('answers empty for a root that cannot be asked, and logs it once however many times it is asked', async () => {
    const gone = join(base, 'gone');
    const { oracle, lines } = probe();
    expect([...(await oracle.ignored(gone, ['a.log']))]).toEqual([]);
    expect([...(await oracle.ignored(gone, ['b.log', 'c/']))]).toEqual([]);
    expect([...(await oracle.ignored(gone, ['d.log']))]).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(gone);
  });

  it('answers empty input without starting git', async () => {
    const { oracle, spawns } = probe();
    expect([...(await oracle.ignored(repo, []))]).toEqual([]);
    expect(spawns()).toBe(0);
  });

  it.skipIf(skipOnWindows('the fsmonitor hook is a /bin/sh script with an execute bit'))('never runs a command the repository configures as its fsmonitor', async () => {
    const hostile = join(base, 'hostile');
    const marker = join(base, 'fsmonitor-ran');
    mkdirSync(hostile, { recursive: true });
    git(hostile, 'init', '-q');
    write(join(hostile, '.gitignore'), '*.log\n');
    const hook = join(base, 'fsmonitor-hook.sh');
    write(hook, `#!/bin/sh\ntouch '${marker}'\n`);
    execFileSync('chmod', ['+x', hook]);
    write(join(hostile, 'a.log'));
    git(hostile, 'add', '.gitignore');
    git(hostile, 'config', 'core.fsmonitor', hook);

    const { oracle } = probe();
    expect([...(await oracle.ignored(hostile, ['a.log']))]).toEqual(['a.log']);
    expect(existsSync(marker), 'the repository-configured fsmonitor command ran').toBe(false);
  });

  it('asks git once for a listing of one folder', async () => {
    const { oracle, spawns } = probe();
    await oracle.ignored(repo, ['src/main.ts', 'src/debug.log', 'src/other.ts']);
    expect(spawns()).toBe(1);
  });
});

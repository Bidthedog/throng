import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitIgnoreOracle, execFileOffLoop, type GitIgnoreOracleOptions } from '@throng/platform-node';

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
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

interface Probe {
  oracle: GitIgnoreOracle;
  lines: string[];
  spawns: () => number;
}

function probe(): Probe {
  const lines: string[] = [];
  let spawns = 0;
  const options: GitIgnoreOracleOptions = {
    log: (message) => lines.push(message),
    exec: (file, args, execOptions, callback) => {
      spawns += 1;
      execFileOffLoop(file, args, execOptions, callback);
    },
  };
  return { oracle: new GitIgnoreOracle(options), lines, spawns: () => spawns };
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

  it('answers empty outside a repository, and logs it once for the root however many times it is asked', async () => {
    const { oracle, lines } = probe();
    expect([...(await oracle.ignored(plain, ['a.log']))]).toEqual([]);
    expect([...(await oracle.ignored(plain, ['b.log', 'c/']))]).toEqual([]);
    expect([...(await oracle.ignored(plain, ['d.log']))]).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(plain);
  });

  it('answers empty input without starting git', async () => {
    const { oracle, spawns } = probe();
    expect([...(await oracle.ignored(repo, []))]).toEqual([]);
    expect(spawns()).toBe(0);
  });

  it('asks git once for a listing of one folder', async () => {
    const { oracle, spawns } = probe();
    await oracle.ignored(repo, ['src/main.ts', 'src/debug.log', 'src/other.ts']);
    expect(spawns()).toBe(1);
  });
});

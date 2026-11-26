import { describe, expect, it } from 'vitest';
import { GitIgnoreOracle, type ExecLike } from '@throng/platform-node';

/**
 * 081 FR-073 — on macOS, `/usr/bin/git` without the Command Line Tools is a shim that opens Apple's "install the
 * command line developer tools" dialog every time it runs. The explorer asks after every listing, so the oracle
 * checks `xcode-select -p` once first and, when no developer directory is set, treats git as unavailable: nothing
 * fades, and the user sees no dialog.
 */

interface Call {
  file: string;
  args: readonly string[];
}

function fakeExec(answer: (call: Call) => { code: number | null; stdout?: string }): { exec: ExecLike; calls: Call[] } {
  const calls: Call[] = [];
  const exec: ExecLike = (file, args, _options, callback) => {
    const call = { file, args };
    calls.push(call);
    const { code, stdout = '' } = answer(call);
    queueMicrotask(() =>
      code === 0 ? callback(null, stdout, '') : callback(Object.assign(new Error(`${file} exited ${code}`), { code }), '', ''),
    );
  };
  return { exec, calls };
}

describe('GitIgnoreOracle on macOS', () => {
  it('never starts git when xcode-select names no developer directory, and logs that once', async () => {
    const lines: string[] = [];
    const { exec, calls } = fakeExec((c) => ({ code: c.file === 'xcode-select' ? 2 : 0 }));
    const oracle = new GitIgnoreOracle({ exec, platform: 'darwin', log: (m) => lines.push(m) });
    expect([...(await oracle.ignored('/p', ['a.log']))]).toEqual([]);
    expect([...(await oracle.ignored('/q', ['b.log']))]).toEqual([]);
    expect(calls.map((c) => c.file)).toEqual(['xcode-select']);
    expect(lines).toHaveLength(1);
  });

  it('asks git once the developer tools are present, checking for them only once', async () => {
    const { exec, calls } = fakeExec((c) =>
      c.file === 'xcode-select' ? { code: 0, stdout: '/Library/Developer/CommandLineTools\n' } : { code: 0, stdout: 'a.log\0' },
    );
    const oracle = new GitIgnoreOracle({ exec, platform: 'darwin' });
    expect([...(await oracle.ignored('/p', ['a.log', 'b.txt']))]).toEqual(['a.log']);
    await oracle.ignored('/p', ['c.log']);
    expect(calls.map((c) => c.file)).toEqual(['xcode-select', 'git', 'git']);
  });

  it('does not check for the developer tools anywhere else', async () => {
    const { exec, calls } = fakeExec(() => ({ code: 1 }));
    const oracle = new GitIgnoreOracle({ exec, platform: 'linux' });
    await oracle.ignored('/p', ['a.log']);
    expect(calls.map((c) => c.file)).toEqual(['git']);
  });
});

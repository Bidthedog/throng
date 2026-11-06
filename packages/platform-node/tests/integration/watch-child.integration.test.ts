import { execFile, spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogLevel } from '@throng/core';
import { logChildFailure, watchChild } from '@throng/platform-node';

/**
 * 066 FR-005 / FR-007 / FR-008 / FR-014 — every child throng starts is watched by its parent, which
 * is the only one that can speak for a child that died before it could log anything (#542: the
 * collector failed while resolving its imports and the log was empty).
 *
 * Real children, because what is under test is exactly the event ordering Node gives a parent:
 * `error` on a failed spawn, `close` after the stdio has drained.
 */

type Line = { level: LogLevel; message: string };

function recorder(): { log: (level: LogLevel, message: string) => void; lines: Line[]; settled: () => Promise<void> } {
  const lines: Line[] = [];
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  return {
    lines,
    log: (level, message) => {
      lines.push({ level, message });
      resolve();
    },
    settled: () => done,
  };
}

const node = (source: string) => spawn(process.execPath, ['-e', source], { stdio: ['ignore', 'ignore', 'pipe'] });

describe('watchChild', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs a child that dies while loading, with its exit code and the tail of its stderr (#542)', async () => {
    const r = recorder();
    watchChild(node("throw new Error('Cannot find module koffi')"), { name: 'collector', log: r.log, longLived: true });
    await r.settled();
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]?.level).toBe('fatal');
    expect(r.lines[0]?.message).toMatch(/^collector exited with code 1: /);
    expect(r.lines[0]?.message).toContain('Cannot find module koffi');
  });

  it("logs a long-lived child's unasked exit at fatal even with code 0", async () => {
    const r = recorder();
    watchChild(node('process.exit(0)'), { name: 'daemon', log: r.log, longLived: true });
    await r.settled();
    expect(r.lines).toEqual([{ level: 'fatal', message: 'daemon exited with code 0' }]);
  });

  it("logs a helper's failing exit at warn, and its success not at all", async () => {
    const failed = recorder();
    watchChild(node('process.exit(3)'), { name: 'reg query', log: failed.log, longLived: false });
    await failed.settled();
    expect(failed.lines).toEqual([{ level: 'warn', message: 'reg query exited with code 3' }]);

    const ok = recorder();
    const child = node('process.exit(0)');
    watchChild(child, { name: 'reg query', log: ok.log, longLived: false });
    await new Promise((r) => child.on('close', r));
    expect(ok.lines).toEqual([]);
  });

  it('logs an exit throng asked for at debug, with the reason, and not as a failure', async () => {
    const r = recorder();
    const child = node('setInterval(() => {}, 1000)');
    let stopping = false;
    watchChild(child, {
      name: 'collector',
      log: r.log,
      longLived: true,
      expectedExit: () => (stopping ? 'throng stopped it' : undefined),
    });
    stopping = true;
    child.kill();
    await r.settled();
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]?.level).toBe('debug');
    expect(r.lines[0]?.message).toMatch(/^collector exited (on signal SIGTERM|with code \d+): expected — throng stopped it$/);
  });

  it('logs a spawn that fails outright, and only once', async () => {
    const r = recorder();
    const child = spawn('/definitely/not/a/program-066', [], { stdio: ['ignore', 'ignore', 'pipe'] });
    watchChild(child, { name: 'helper', log: r.log, longLived: false });
    await new Promise((res) => child.on('close', res));
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]?.level).toBe('warn');
    expect(r.lines[0]?.message).toMatch(/^helper failed to start: .*ENOENT/);
  });

  it('an error from a child that DID start (an IPC send failing) is logged, and does not hide its exit', async () => {
    const r = recorder();
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(4), 200)'], { stdio: ['ignore', 'ignore', 'pipe'] });
    watchChild(child, { name: 'collector', log: r.log, longLived: true });
    child.emit('error', new Error('channel closed'));
    await new Promise((res) => child.on('close', res));
    expect(r.lines).toEqual([
      { level: 'fatal', message: 'collector error: channel closed' },
      { level: 'fatal', message: 'collector exited with code 4' },
    ]);
  });

  it('keeps only the last 4 KB of a noisy stderr (FR-014)', async () => {
    const r = recorder();
    watchChild(node("process.stderr.write('a'.repeat(100000) + 'THE-END'); process.exit(2)"), {
      name: 'noisy',
      log: r.log,
      longLived: false,
    });
    await r.settled();
    const message = r.lines[0]?.message ?? '';
    expect(message.endsWith('THE-END')).toBe(true);
    expect(message.length).toBeLessThanOrEqual('noisy exited with code 2: '.length + 4096);
  });
});

describe('logChildFailure', () => {
  it('logs an execFile failure with its name, error and stderr', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await new Promise<void>((resolve) => {
      execFile(process.execPath, ['-e', "process.stderr.write('bad key'); process.exit(1)"], (error, _out, stderr) => {
        logChildFailure('reg query', error, stderr);
        resolve();
      });
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/^reg query: .*: bad key$/);
  });
});

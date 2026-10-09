import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WindowsProcessCwd, type ProcessCwdFfi } from '../../src/windows-process-cwd.js';

/**
 * 051 R6 — a terminal's cwd is read through koffi's `.async`, so a slow or wedged process never stops
 * the daemon, and a read is bounded by the end limit (FR-013).
 *
 * The native calls are faked: what is proven here is the shape of the waiting. The real PEB walk is
 * the daemon's cwd integration test.
 */

/** The source with comments removed: a call named in prose is not a call. */
const source = readFileSync(fileURLToPath(new URL('../../src/windows-process-cwd.ts', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

/** A fake process whose cwd is `C:\\work`, each call answering on a later timer tick. */
function fakeFfi(opts: { hangOn?: number } = {}): ProcessCwdFfi {
  const later = <T>(value: T): Promise<T> => new Promise((r) => setTimeout(() => r(value), 1));
  const path = Buffer.from('C:\\work', 'utf16le');
  return {
    openProcess: (_a, _i, pid) => (pid === opts.hangOn ? new Promise(() => {}) : later({ pid })),
    closeHandle: () => later(true),
    ntQueryBasic: (_h, buf) => {
      buf.writeBigUInt64LE(0x1000n, 8);
      return later(0);
    },
    readMemory: (_h, address, buf) => {
      if (address === 0x1020n) buf.writeBigUInt64LE(0x2000n, 0); // ProcessParameters
      else if (address === 0x2038n) {
        buf.writeUInt16LE(path.length, 0);
        buf.writeBigUInt64LE(0x3000n, 8);
      } else path.copy(buf);
      return later(true);
    },
  };
}

describe('051 R6 — WindowsProcessCwd reads off the event loop', () => {
  it('calls every native function through .async', () => {
    for (const name of ['OpenProcess', 'NtQueryInformationProcess', 'ReadProcessMemory', 'CloseHandle']) {
      expect(source, name).toMatch(new RegExp(`callAsync\\(${name},`));
      expect(source, name).not.toMatch(new RegExp(`[^.\\w]${name}\\(`));
    }
  });

  it('yields to the event loop while it reads', async () => {
    let ticks = 0;
    const timer = setInterval(() => (ticks += 1), 0);
    const cwds = await new WindowsProcessCwd(fakeFfi()).read([10, 11, 12]);
    clearInterval(timer);
    expect([...cwds.values()]).toEqual(['C:\\work', 'C:\\work', 'C:\\work']);
    expect(ticks).toBeGreaterThan(0);
  });

  it('a process that never answers is left out after the limit; the others are still reported', async () => {
    const started = Date.now();
    const cwds = await new WindowsProcessCwd(fakeFfi({ hangOn: 11 }), 200).read([10, 11]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(190);
    expect(cwds.get(10)).toBe('C:\\work');
    expect(cwds.has(11)).toBe(false);
  });
});

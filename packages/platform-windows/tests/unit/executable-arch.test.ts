import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archFromHeader, createExecutableArchReader, readExecutableHead } from '../../src/executable-arch.js';
import { parseProcessTable } from '../../src/node-pty-host.js';

/**
 * 053 `{arch}` — the architecture of the program a terminal is running, read from its PE header's
 * machine field. Every header here is built in the test; no real executable is read.
 */
const E_LFANEW = 0x80;

/** A minimal image head: `MZ`, `e_lfanew` at 0x3C, `PE\0\0` there, the machine u16 after it. */
function peHead(machine: number, opts: { size?: number; lfanew?: number; signature?: string } = {}): Buffer {
  const lfanew = opts.lfanew ?? E_LFANEW;
  const buf = Buffer.alloc(opts.size ?? 512);
  buf.write('MZ', 0, 'latin1');
  buf.writeUInt32LE(lfanew, 0x3c);
  if (lfanew + 6 <= buf.length) {
    buf.write(opts.signature ?? 'PE\0\0', lfanew, 'latin1');
    buf.writeUInt16LE(machine, lfanew + 4);
  }
  return buf;
}

describe('053 — archFromHeader', () => {
  it.each([
    [0x8664, 'x64'],
    [0x014c, 'x86'],
    [0xaa64, 'arm64'],
  ])('maps machine %i to %s', (machine, arch) => {
    expect(archFromHeader(peHead(machine))).toBe(arch);
  });

  it('an unrecognised machine is null', () => {
    expect(archFromHeader(peHead(0x01c4))).toBeNull(); // ARMNT
  });

  it('a file that is not a PE image is null', () => {
    expect(archFromHeader(Buffer.from('#!/bin/sh\necho hi\n'))).toBeNull();
    expect(archFromHeader(peHead(0x8664, { signature: 'NE\0\0' }))).toBeNull();
    expect(archFromHeader(Buffer.alloc(0))).toBeNull();
  });

  it('a header whose e_lfanew points past the bytes read is null, not a throw', () => {
    expect(archFromHeader(peHead(0x8664, { size: 256, lfanew: 0x10000 }))).toBeNull();
  });
});

describe('053 — createExecutableArchReader', () => {
  it('reads the head once per path for the host\'s life', async () => {
    const read = vi.fn(async (_path: string) => peHead(0x8664));
    const arch = createExecutableArchReader(read);
    expect(await arch('C:/a.exe')).toBe('x64');
    expect(await arch('C:/a.exe')).toBe('x64');
    expect(read).toHaveBeenCalledTimes(1);
    expect(await arch('C:/b.exe')).toBe('x64');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('a read failure resolves null and never rejects', async () => {
    const arch = createExecutableArchReader(async () => {
      throw new Error('EACCES');
    });
    await expect(arch('C:/locked.exe')).resolves.toBeNull();
  });

  it('an empty path is null without a read', async () => {
    const read = vi.fn(async (_path: string) => peHead(0x8664));
    expect(await createExecutableArchReader(read)('')).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});

describe('053 — readExecutableHead', () => {
  it('reads only the first few KB of the file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'throng-arch-'));
    try {
      const file = join(dir, 'fixture.bin');
      const image = Buffer.concat([peHead(0xaa64), Buffer.alloc(64 * 1024, 0xcc)]);
      await writeFile(file, image);
      const head = await readExecutableHead(file);
      expect(head.length).toBeLessThanOrEqual(8 * 1024);
      expect(archFromHeader(head)).toBe('arm64');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('a missing file rejects, which the reader turns into null', async () => {
    await expect(readExecutableHead(join(tmpdir(), 'throng-arch-missing', 'none.exe'))).rejects.toThrow();
    await expect(createExecutableArchReader()(join(tmpdir(), 'throng-arch-missing', 'none.exe'))).resolves.toBeNull();
  });
});

describe('053 — parseProcessTable carries ExecutablePath', () => {
  it('each row carries the executable path the snapshot reported', () => {
    const json = JSON.stringify([
      { ProcessId: 10, ParentProcessId: 1, CommandLine: 'bash.exe', CreationDate: '/Date(5)/', ExecutablePath: 'C:\\Git\\bin\\bash.exe' },
      { ProcessId: 11, ParentProcessId: 10, CommandLine: 'ping localhost', CreationDate: '/Date(6)/', ExecutablePath: 'C:\\Windows\\System32\\PING.EXE' },
    ]);
    const table = parseProcessTable(json);
    expect(table.get(1)![0]).toMatchObject({ pid: 10, executablePath: 'C:\\Git\\bin\\bash.exe' });
    expect(table.get(10)![0]).toMatchObject({ pid: 11, commandLine: 'ping localhost', executablePath: 'C:\\Windows\\System32\\PING.EXE' });
  });

  it('an unreadable ExecutablePath is empty, and the row is kept', () => {
    const json = JSON.stringify([{ ProcessId: 4, ParentProcessId: 0, CommandLine: null, CreationDate: null, ExecutablePath: null }]);
    expect(parseProcessTable(json).get(0)).toEqual([{ pid: 4, ppid: 0, commandLine: '', startedAt: 0, executablePath: '' }]);
  });

  it('a single-row snapshot (an object, not an array) parses', () => {
    const json = JSON.stringify({ ProcessId: 4, ParentProcessId: 0, ExecutablePath: 'C:\\x.exe' });
    expect(parseProcessTable(json).get(0)![0]!.executablePath).toBe('C:\\x.exe');
  });

  it('a raw control character inside a command line still parses (81377037)', () => {
    const sub = String.fromCharCode(0x1a);
    const json = `[{"ProcessId":7,"ParentProcessId":1,"CommandLine":"claude -p a${sub}b","ExecutablePath":"C:\\\\c.exe"}]`;
    expect(parseProcessTable(json).get(1)![0]).toMatchObject({ pid: 7, executablePath: 'C:\\c.exe' });
  });
});

import { describe, expect, it } from 'vitest';
import { PROC_BSDINFO, PROC_PIDTBSDINFO, PROC_TASKINFO, RUSAGE_INFO_V4_LAYOUT, type LibSystem } from '../../src/libsystem.js';
import {
  listAllPids,
  parseBsdInfo,
  parseProcArgs2,
  readMacosArgv,
  readMacosMetrics,
  readMacosProcRow,
  readMacosProcTable,
} from '../../src/macos-proc-table.js';

/** A `struct proc_bsdinfo` laid out as `<sys/proc_info.h>` declares it. */
function bsdInfo(row: { pid: number; ppid: number; uid?: number; comm: string; sec: number; usec: number; status?: number }): Buffer {
  const buf = Buffer.alloc(PROC_BSDINFO.size);
  buf.writeUInt32LE(row.status ?? 2, PROC_BSDINFO.status);
  buf.writeUInt32LE(row.pid, PROC_BSDINFO.pid);
  buf.writeUInt32LE(row.ppid, PROC_BSDINFO.ppid);
  buf.writeUInt32LE(row.uid ?? 501, PROC_BSDINFO.uid);
  buf.write(row.comm.slice(0, 16), PROC_BSDINFO.comm, 'utf8');
  buf.writeUInt32LE(row.pid, PROC_BSDINFO.pgid);
  buf.writeBigUInt64LE(BigInt(row.sec), PROC_BSDINFO.startSec);
  buf.writeBigUInt64LE(BigInt(row.usec), PROC_BSDINFO.startUsec);
  return buf;
}

/** A libSystem that answers from a table of fake processes. */
function fakeLib(rows: Record<number, Buffer>, opts: { bsdBytes?: number; procargs?: Buffer } = {}): LibSystem {
  return {
    pathconf: () => 0,
    procListAllPids: (buf) => {
      const pids = Object.keys(rows).map(Number);
      pids.forEach((pid, i) => buf.writeInt32LE(pid, i * 4));
      return pids.length;
    },
    procPidInfo: (pid, flavor, _arg, buf) => {
      if (flavor === PROC_PIDTBSDINFO) {
        const row = rows[pid];
        if (!row) return 0;
        row.copy(buf);
        return opts.bsdBytes ?? PROC_BSDINFO.size;
      }
      buf.writeBigUInt64LE(2_000_000n, PROC_TASKINFO.residentSize);
      buf.writeBigUInt64LE(3_000_000n, PROC_TASKINFO.totalUser);
      buf.writeBigUInt64LE(1_000_000n, PROC_TASKINFO.totalSystem);
      return PROC_TASKINFO.size;
    },
    procPidPath: () => 0,
    procPidRusage: (_pid, _flavor, buf) => {
      buf.writeBigUInt64LE(5_000_000n, RUSAGE_INFO_V4_LAYOUT.physFootprint);
      buf.writeBigUInt64LE(700n, RUSAGE_INFO_V4_LAYOUT.diskioBytesRead);
      buf.writeBigUInt64LE(900n, RUSAGE_INFO_V4_LAYOUT.diskioBytesWritten);
      return 0;
    },
    sysctl: (mib, mibLength, buf, size) => {
      if (mibLength === 2) {
        buf?.writeInt32LE(4096, 0);
        return 0;
      }
      if (!opts.procargs || !buf) return -1;
      opts.procargs.copy(buf);
      size.writeBigUInt64LE(BigInt(opts.procargs.length));
      return 0;
    },
    // Apple silicon's time base: 125/3 ns per unit.
    machTimebase: () => [125, 3],
  };
}

const nul = String.fromCharCode(0);
const procArgs = (exec: string, argv: string[], env: string[] = []): Buffer => {
  const head = Buffer.alloc(4);
  head.writeInt32LE(argv.length, 0);
  return Buffer.concat([head, Buffer.from(`${exec}${nul}${nul}${nul}${argv.join(nul)}${nul}${env.join(nul)}${nul}`)]);
};

describe('the macOS process table (070 research R2)', () => {
  it('reads a row from proc_bsdinfo at the offsets <sys/proc_info.h> declares', () => {
    const row = parseBsdInfo(bsdInfo({ pid: 4321, ppid: 1, uid: 501, comm: 'zsh', sec: 1_700_000_000, usec: 456_789 }));
    expect(row).toEqual({ pid: 4321, ppid: 1, uid: 501, pgid: 4321, comm: 'zsh', startedAt: 1_700_000_000_456, zombie: false });
  });

  it('marks a zombie (SZOMB) as not live', () => {
    expect(parseBsdInfo(bsdInfo({ pid: 9, ppid: 1, comm: 'x', sec: 1, usec: 0, status: 5 }))?.zombie).toBe(true);
  });

  it('refuses a row whose size disagrees with the declared struct, rather than reading garbage', () => {
    const lib = fakeLib({ 7: bsdInfo({ pid: 7, ppid: 1, comm: 'x', sec: 1, usec: 0 }) }, { bsdBytes: 128 });
    expect(readMacosProcRow(7, lib)).toBeNull();
  });

  it('is absent for a pid the kernel does not describe', () => {
    expect(readMacosProcRow(99, fakeLib({}))).toBeNull();
    expect(readMacosProcRow(-1, fakeLib({}))).toBeNull();
  });

  it('lists every pid and reads each into the table', async () => {
    const lib = fakeLib({
      1: bsdInfo({ pid: 1, ppid: 0, uid: 0, comm: 'launchd', sec: 100, usec: 0 }),
      500: bsdInfo({ pid: 500, ppid: 1, comm: 'zsh', sec: 200, usec: 0 }),
    });
    expect(listAllPids(lib).sort()).toEqual([1, 500]);
    expect((await readMacosProcTable(lib)).map((r) => r.comm).sort()).toEqual(['launchd', 'zsh']);
  });

  it('reads argv from KERN_PROCARGS2, skipping the executable path and its padding, and never the environment', () => {
    const buf = procArgs('/bin/zsh', ['-zsh', '-l', 'a b'], ['SECRET=1']);
    expect(parseProcArgs2(buf, buf.length)).toEqual(['-zsh', '-l', 'a b']);
    expect(readMacosArgv(5, fakeLib({}, { procargs: buf }))).toEqual(['-zsh', '-l', 'a b']);
  });

  it('answers no argv for a buffer that is not KERN_PROCARGS2', () => {
    expect(parseProcArgs2(Buffer.alloc(2), 2)).toBeUndefined();
    const truncated = procArgs('/bin/zsh', ['a', 'b']);
    expect(parseProcArgs2(truncated, 12)).toBeUndefined();
  });

  it('scales CPU time by the Mach time base and reads memory and I/O from rusage', () => {
    const metrics = readMacosMetrics(5, fakeLib({}));
    // 4,000,000 units × 125/3 ns = 166.67 ms.
    expect(metrics?.cpuMs).toBeCloseTo(166.667, 2);
    expect(metrics).toMatchObject({ residentBytes: 2_000_000, privateBytes: 5_000_000, readBytes: 700, writeBytes: 900 });
  });
});

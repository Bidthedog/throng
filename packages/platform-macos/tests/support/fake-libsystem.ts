/**
 * A libSystem that answers from a table of fake processes, laid out as `<sys/proc_info.h>` and `<sys/resource.h>`
 * declare, so the macOS classes built on the process table run on any host.
 */
import {
  KERN_PROCARGS2,
  PROC_BSDINFO,
  PROC_PIDTASKINFO,
  PROC_PIDTBSDINFO,
  PROC_TASKINFO,
  RUSAGE_INFO_V4_LAYOUT,
  type LibSystem,
} from '../../src/libsystem.js';

export interface FakeProcess {
  pid: number;
  ppid: number;
  uid: number;
  comm: string;
  /** Epoch ms. */
  startedAt: number;
  zombie?: boolean;
  /** Mach units of CPU; with the fake's 1/1 time base, nanoseconds. Absent: the kernel refuses its figures. */
  cpuUnits?: bigint;
  footprint?: number;
  /** What `KERN_PROCARGS2` answers. Absent: the kernel refuses, as for another user's process. */
  argv?: string[];
}

export function fakeLibSystem(procs: FakeProcess[]): LibSystem & { procs: FakeProcess[]; argvReads: number[] } {
  const argvReads: number[] = [];
  const find = (pid: number): FakeProcess | undefined => procs.find((p) => p.pid === pid);
  return {
    procs,
    argvReads,
    pathconf: () => 0,
    procListAllPids: (buf) => {
      procs.forEach((p, i) => buf.writeInt32LE(p.pid, i * 4));
      return procs.length;
    },
    procPidInfo: (pid, flavor, _arg, buf) => {
      const p = find(pid);
      if (!p) return 0;
      if (flavor === PROC_PIDTBSDINFO) {
        buf.writeUInt32LE(p.zombie ? 5 : 2, PROC_BSDINFO.status);
        buf.writeUInt32LE(p.pid, PROC_BSDINFO.pid);
        buf.writeUInt32LE(p.ppid, PROC_BSDINFO.ppid);
        buf.writeUInt32LE(p.uid, PROC_BSDINFO.uid);
        buf.write(p.comm, PROC_BSDINFO.comm, 'utf8');
        buf.writeBigUInt64LE(BigInt(Math.floor(p.startedAt / 1000)), PROC_BSDINFO.startSec);
        buf.writeBigUInt64LE(BigInt((p.startedAt % 1000) * 1000), PROC_BSDINFO.startUsec);
        return PROC_BSDINFO.size;
      }
      if (flavor === PROC_PIDTASKINFO) {
        if (p.cpuUnits === undefined) return 0;
        buf.writeBigUInt64LE(p.cpuUnits, PROC_TASKINFO.totalUser);
        buf.writeBigUInt64LE(4096n, PROC_TASKINFO.residentSize);
        return PROC_TASKINFO.size;
      }
      return 0;
    },
    procPidPath: (pid, buf) => {
      const p = find(pid);
      return p ? buf.write(`/bin/${p.comm}`) : 0;
    },
    procPidRusage: (pid, _flavor, buf) => {
      const p = find(pid);
      if (!p || p.cpuUnits === undefined) return -1;
      buf.writeBigUInt64LE(BigInt(p.footprint ?? 1024), RUSAGE_INFO_V4_LAYOUT.physFootprint);
      buf.writeBigUInt64LE(10n, RUSAGE_INFO_V4_LAYOUT.diskioBytesRead);
      buf.writeBigUInt64LE(20n, RUSAGE_INFO_V4_LAYOUT.diskioBytesWritten);
      return 0;
    },
    sysctl: (mib, _length, buf, size) => {
      if (mib.readInt32LE(4) !== KERN_PROCARGS2 || buf === null) return -1;
      const pid = mib.readInt32LE(8);
      argvReads.push(pid);
      const argv = find(pid)?.argv;
      if (!argv) return -1;
      const body = Buffer.from(`/bin/x\0\0${argv.join('\0')}\0`, 'utf8');
      buf.writeInt32LE(argv.length, 0);
      body.copy(buf, 4);
      size.writeBigUInt64LE(BigInt(4 + body.length));
      return 0;
    },
    machTimebase: () => [1, 1],
  };
}

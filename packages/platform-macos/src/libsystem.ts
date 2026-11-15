import { createRequire } from 'node:module';
import { logCaught } from '@throng/core';

/**
 * The one place throng binds macOS's C library (070 R2, R4). Every symbol below is exported by `libSystem.B.dylib`,
 * which re-exports libproc (`<libproc.h>`), `sysctl` (`<sys/sysctl.h>`), `pathconf` (`<unistd.h>`) and the Mach time
 * base (`<mach/mach_time.h>`). Loaded once, lazily, so a Linux or Windows process that imports this package never
 * touches it.
 *
 * Constants and struct layouts are named here with the header each comes from. A wrong layout must fail loudly, which
 * is why every `proc_pidinfo` caller checks the size the kernel returned against the declared struct size.
 */

const require = createRequire(import.meta.url);

export const LIBSYSTEM_PATH = '/usr/lib/libSystem.B.dylib';

/** `<sys/unistd.h>`: `#define _PC_CASE_SENSITIVE 11`. `pathconf` answers 1 for a case-sensitive volume, 0 if not. */
export const PC_CASE_SENSITIVE = 11;

/** `<sys/proc_info.h>` flavours for `proc_pidinfo`. */
export const PROC_PIDTASKINFO = 4;
export const PROC_PIDTBSDINFO = 3;
export const PROC_PIDVNODEPATHINFO = 9;

/** `<libproc.h>`: `#define PROC_PIDPATHINFO_MAXSIZE (4 * MAXPATHLEN)`, MAXPATHLEN being 1024 (`<sys/param.h>`). */
export const PROC_PIDPATHINFO_MAXSIZE = 4096;
/** `<sys/param.h>` MAXPATHLEN, the size of `vip_path` in `struct vnode_info_path`. */
export const MAXPATHLEN = 1024;
/** `<sys/proc_info.h>`: `#define MAXCOMLEN 16`; `pbi_comm` is `MAXCOMLEN` bytes, `pbi_name` `2 * MAXCOMLEN`. */
export const MAXCOMLEN = 16;

/** `<sys/resource.h>`: `#define RUSAGE_INFO_V4 4`. */
export const RUSAGE_INFO_V4 = 4;

/** `<sys/sysctl.h>`: `CTL_KERN` 1, `KERN_ARGMAX` 8, `KERN_PROCARGS2` 49. */
export const CTL_KERN = 1;
export const KERN_ARGMAX = 8;
export const KERN_PROCARGS2 = 49;

/** `<sys/proc.h>` `p_stat` values carried in `pbi_status`: `SZOMB` is 5. */
export const SZOMB = 5;

/**
 * `struct proc_bsdinfo` (`<sys/proc_info.h>`), 136 bytes on arm64 and x86_64. Offsets of the fields read:
 *
 * ```c
 * uint32_t pbi_flags;          //   0
 * uint32_t pbi_status;         //   4
 * uint32_t pbi_xstatus;        //   8
 * uint32_t pbi_pid;            //  12
 * uint32_t pbi_ppid;           //  16
 * uid_t    pbi_uid;            //  20
 * gid_t    pbi_gid;            //  24
 * uid_t    pbi_ruid;           //  28
 * gid_t    pbi_rgid;           //  32
 * uid_t    pbi_svuid;          //  36
 * gid_t    pbi_svgid;          //  40
 * uint32_t rfu_1;              //  44
 * char     pbi_comm[16];       //  48
 * char     pbi_name[32];       //  64
 * uint32_t pbi_nfiles;         //  96
 * uint32_t pbi_pgid;           // 100
 * uint32_t pbi_pjobc;          // 104
 * uint32_t e_tdev;             // 108
 * uint32_t e_tpgid;            // 112
 * int32_t  pbi_nice;           // 116
 * uint64_t pbi_start_tvsec;    // 120
 * uint64_t pbi_start_tvusec;   // 128
 * ```
 */
export const PROC_BSDINFO = {
  size: 136,
  status: 4,
  pid: 12,
  ppid: 16,
  uid: 20,
  comm: 48,
  name: 64,
  pgid: 100,
  startSec: 120,
  startUsec: 128,
} as const;

/**
 * `struct proc_taskinfo` (`<sys/proc_info.h>`), 96 bytes. The CPU times are in Mach absolute time units, scaled to
 * nanoseconds by `mach_timebase_info` (1/1 on Intel, 125/3 on Apple silicon).
 *
 * ```c
 * uint64_t pti_virtual_size;   //  0
 * uint64_t pti_resident_size;  //  8
 * uint64_t pti_total_user;     // 16
 * uint64_t pti_total_system;   // 24
 * ...                          // ints to 96
 * ```
 */
export const PROC_TASKINFO = { size: 96, residentSize: 8, totalUser: 16, totalSystem: 24 } as const;

/**
 * `struct proc_vnodepathinfo` (`<sys/proc_info.h>`): two `struct vnode_info_path` (current and root directory), each a
 * 152-byte `struct vnode_info` followed by `vip_path[MAXPATHLEN]`. The cwd's path starts at 152.
 */
export const PROC_VNODEPATHINFO = { size: 2 * (152 + MAXPATHLEN), cdirPath: 152 } as const;

/**
 * `struct rusage_info_v4` (`<sys/resource.h>`), 296 bytes. Offsets of the fields read:
 *
 * ```c
 * uint8_t  ri_uuid[16];                 //   0
 * uint64_t ri_user_time;                //  16
 * uint64_t ri_system_time;              //  24
 * uint64_t ri_pkg_idle_wkups;           //  32
 * uint64_t ri_interrupt_wkups;          //  40
 * uint64_t ri_pageins;                  //  48
 * uint64_t ri_wired_size;               //  56
 * uint64_t ri_resident_size;            //  64
 * uint64_t ri_phys_footprint;           //  72
 * uint64_t ri_proc_start_abstime;       //  80
 * uint64_t ri_proc_exit_abstime;        //  88
 * uint64_t ri_child_user_time;          //  96
 * uint64_t ri_child_system_time;        // 104
 * uint64_t ri_child_pkg_idle_wkups;     // 112
 * uint64_t ri_child_interrupt_wkups;    // 120
 * uint64_t ri_child_pageins;            // 128
 * uint64_t ri_child_elapsed_abstime;    // 136
 * uint64_t ri_diskio_bytesread;         // 144
 * uint64_t ri_diskio_byteswritten;      // 152
 * ...                                   // to 296
 * ```
 */
export const RUSAGE_INFO_V4_LAYOUT = {
  size: 296,
  userTime: 16,
  systemTime: 24,
  residentSize: 64,
  physFootprint: 72,
  diskioBytesRead: 144,
  diskioBytesWritten: 152,
} as const;

/**
 * The libSystem calls throng makes. Synchronous: each is one syscall of microseconds (070 R2). Every buffer is a
 * `Buffer` the kernel writes into; koffi passes a Buffer to a `void *` parameter by address.
 */
export interface LibSystem {
  pathconf(path: string, name: number): number;
  /** Fills `pids` (4 bytes per pid) and returns how many pids it wrote, or 0 or less on failure. */
  procListAllPids(pids: Buffer): number;
  /** Fills `buf` and returns how many bytes it wrote; 0 or less is failure. */
  procPidInfo(pid: number, flavor: number, arg: number, buf: Buffer): number;
  /** Fills `buf` with the executable path and returns its length; 0 or less is failure. */
  procPidPath(pid: number, buf: Buffer): number;
  /** 0 on success. */
  procPidRusage(pid: number, flavor: number, buf: Buffer): number;
  /** 0 on success. `size` is an 8-byte `size_t` in and out: the buffer's length, then the length written. */
  sysctl(mib: Buffer, mibLength: number, buf: Buffer | null, size: Buffer): number;
  /** `[numer, denom]` of the Mach time base. */
  machTimebase(): readonly [number, number];
}

let bound: LibSystem | null | undefined;

/** libSystem, bound once. Null where it cannot be, which on macOS means a broken install, and is logged. */
export function libSystem(): LibSystem | null {
  if (bound !== undefined) return bound;
  try {
    const koffi = require('koffi') as KoffiModule;
    const lib = koffi.load(LIBSYSTEM_PATH);
    const pathconf = lib.func('long pathconf(const char *path, int name)');
    const listAll = lib.func('int proc_listallpids(void *buffer, int buffersize)');
    const pidInfo = lib.func('int proc_pidinfo(int pid, int flavor, uint64_t arg, void *buffer, int buffersize)');
    const pidPath = lib.func('int proc_pidpath(int pid, void *buffer, uint32_t buffersize)');
    const pidRusage = lib.func('int proc_pid_rusage(int pid, int flavor, void *buffer)');
    const sysctl = lib.func('int sysctl(void *name, uint32_t namelen, void *oldp, void *oldlenp, void *newp, size_t newlen)');
    const timebase = lib.func('int mach_timebase_info(void *info)');
    bound = {
      pathconf: (path, name) => Number(pathconf(path, name)),
      procListAllPids: (pids) => Number(listAll(pids, pids.length)),
      procPidInfo: (pid, flavor, arg, buf) => Number(pidInfo(pid, flavor, arg, buf, buf.length)),
      procPidPath: (pid, buf) => Number(pidPath(pid, buf, buf.length)),
      procPidRusage: (pid, flavor, buf) => Number(pidRusage(pid, flavor, buf)),
      sysctl: (mib, mibLength, buf, size) => Number(sysctl(mib, mibLength, buf, size, null, 0)),
      machTimebase: () => {
        // `struct mach_timebase_info { uint32_t numer; uint32_t denom; }` (`<mach/mach_time.h>`).
        const info = Buffer.alloc(8);
        const failed = Number(timebase(info)) !== 0;
        const numer = info.readUInt32LE(0);
        const denom = info.readUInt32LE(4);
        if (!failed && numer > 0 && denom > 0) return [numer, denom];
        // 1/1 is Intel's base; on Apple silicon it would misscale CPU, which the metrics contract would catch.
        logCaught('libsystem: mach_timebase_info', new Error(`mach_timebase_info gave ${numer}/${denom}`));
        return [1, 1];
      },
    };
  } catch (error) {
    logCaught('libsystem: bind libSystem through koffi', error);
    bound = null;
  }
  return bound;
}

/** What this module uses of koffi. */
interface KoffiModule {
  load(path: string): { func(signature: string): (...args: unknown[]) => unknown };
}

/** A NUL-terminated C string from `buf` at `offset`, at most `max` bytes. */
export function cString(buf: Buffer, offset: number, max: number): string {
  const end = buf.indexOf(0, offset);
  const stop = end < 0 || end > offset + max ? offset + max : end;
  return buf.toString('utf8', offset, stop);
}

import type { IProcessIdentity } from '@throng/core';
import { readArgv, readStartTicks } from './proc-table.js';

/** The argument vector and start ticks of a process, straight from `/proc` (068 FR-043). */
export class LinuxProcessIdentity implements IProcessIdentity {
  argv(pid: number): Promise<readonly string[] | undefined> {
    return readArgv(pid);
  }

  startMarker(pid: number): Promise<string | undefined> {
    return readStartTicks(pid);
  }
}

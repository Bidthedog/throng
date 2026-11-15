import { describe, it } from 'vitest';
import { runOrphanProcessesContract, skipUnlessLinux } from '@throng/core/testing';
import { LinuxOrphanProcesses } from '@throng/platform-linux';
import { UNUSED_PID, isAlive, startChild, startOrphan } from '../../../platform-node/tests/support/posix-processes.js';

/** Layer: contract. Adoption is the kernel's doing; only a real orphan shows it reported as parentless (062 FR-018). */
describe.skipIf(skipUnlessLinux('reads /proc and signals real processes'))('LinuxOrphanProcesses meets the shared contract', () => {
  it('reports an adopted process as parentless, a child by its parent, and ends one', { timeout: 30_000 }, async () => {
    await runOrphanProcessesContract({
      make: () => new LinuxOrphanProcesses(),
      selfPid: process.pid,
      startChild,
      startOrphan,
      isAlive,
      unusedPid: UNUSED_PID,
    });
  });
});

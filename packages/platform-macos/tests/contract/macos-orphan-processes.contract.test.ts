import { describe, it } from 'vitest';
import { runOrphanProcessesContract, skipUnlessMacos } from '@throng/core/testing';
import { MacosOrphanProcesses } from '../../src/macos-process-services.js';
import { UNUSED_PID, isAlive, startChild, startOrphan } from '../../../platform-node/tests/support/posix-processes.js';

/** Layer: contract. Adoption by launchd is the kernel's doing; only a real orphan shows it (070 FR-018, R10). */
describe.skipIf(skipUnlessMacos('reads libproc and signals real processes'))('MacosOrphanProcesses meets the shared contract', () => {
  it('reports a process launchd adopted as parentless, a child by its parent, and ends one', { timeout: 30_000 }, async () => {
    await runOrphanProcessesContract({
      make: () => new MacosOrphanProcesses(),
      selfPid: process.pid,
      startChild,
      startOrphan,
      isAlive,
      unusedPid: UNUSED_PID,
    });
  });
});

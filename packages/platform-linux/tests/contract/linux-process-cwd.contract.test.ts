import { describe, it } from 'vitest';
import { runProcessCwdContract, skipUnlessLinux } from '@throng/core/testing';
import { LinuxProcessCwd } from '@throng/platform-linux';
import { UNUSED_PID, startInFolder } from '../../../platform-node/tests/support/posix-processes.js';

/** Layer: contract. A process's working directory is the kernel's answer; only a real process shows it (070 FR-018). */
describe.skipIf(skipUnlessLinux('reads /proc/<pid>/cwd'))('LinuxProcessCwd meets the shared contract', () => {
  it('reads a live process’s folder and leaves a gone one absent', { timeout: 20_000 }, async () => {
    await runProcessCwdContract({ make: () => new LinuxProcessCwd(), startIn: startInFolder, unusedPid: UNUSED_PID });
  });
});

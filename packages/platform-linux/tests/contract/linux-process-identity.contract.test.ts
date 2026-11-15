import { describe, it } from 'vitest';
import { runProcessIdentityContract, skipUnlessLinux } from '@throng/core/testing';
import { LinuxProcessIdentity } from '@throng/platform-linux';
import { UNUSED_PID, startWithArgv } from '../../../platform-node/tests/support/posix-processes.js';

/** Layer: contract. The argument vector and start ticks are the kernel's; only a real process shows them (068 FR-043). */
describe.skipIf(skipUnlessLinux('reads /proc/<pid>/cmdline and stat'))('LinuxProcessIdentity meets the shared contract', () => {
  it('reads the real argv and a stable start marker', { timeout: 20_000 }, async () => {
    await runProcessIdentityContract({ make: () => new LinuxProcessIdentity(), start: startWithArgv, unusedPid: UNUSED_PID });
  });
});

import { describe, it } from 'vitest';
import { runProcessIdentityContract, skipUnlessMacos } from '@throng/core/testing';
import { MacosProcessIdentity } from '../../src/macos-process-services.js';
import { UNUSED_PID, startWithArgv } from '../../../platform-node/tests/support/posix-processes.js';

/** Layer: contract. The argument vector is the kernel's (KERN_PROCARGS2); only a real process shows it (068 FR-043). */
describe.skipIf(skipUnlessMacos('reads sysctl(KERN_PROCARGS2)'))('MacosProcessIdentity meets the shared contract', () => {
  it('reads the real argv', { timeout: 20_000 }, async () => {
    await runProcessIdentityContract({ make: () => new MacosProcessIdentity(), start: startWithArgv, unusedPid: UNUSED_PID });
  });
});

import { afterAll, describe, it } from 'vitest';
import { runFileAccessInfoContract, skipUnlessLinux } from '@throng/core/testing';
import { LinuxFileAccessInfo } from '@throng/platform-linux';
import { UNUSED_ID, scratchFiles } from '../../../platform-node/tests/support/posix-files.js';

/** Layer: contract. Names come from this machine's real account files (067 FR-121, 070 R11). */
describe.skipIf(skipUnlessLinux('reads /etc/passwd and /etc/group'))('LinuxFileAccessInfo meets the shared contract', () => {
  const files = scratchFiles();
  afterAll(() => files.cleanUp());

  it('names the owner and group, and shows an unknown id as its number', async () => {
    await runFileAccessInfoContract({
      make: () => new LinuxFileAccessInfo(),
      reportsOwners: true,
      ownStats: files.ownStats,
      userName: files.userName,
      unusedId: UNUSED_ID,
    });
  });
});

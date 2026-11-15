import { afterAll, describe, it } from 'vitest';
import { runFileAccessInfoContract, skipUnlessMacos } from '@throng/core/testing';
import { MacosFileAccessInfo } from '../../src/macos-file-info.js';
import { UNUSED_ID, scratchFiles } from '../../../platform-node/tests/support/posix-files.js';

/** Layer: contract. Names come from the runner's real Directory Services through `id` and `dscacheutil` (070 R11). */
describe.skipIf(skipUnlessMacos('asks Directory Services on macOS'))('MacosFileAccessInfo meets the shared contract', () => {
  const files = scratchFiles();
  afterAll(() => files.cleanUp());

  it('names the owner and group, and shows an unknown id as its number', { timeout: 20_000 }, async () => {
    await runFileAccessInfoContract({
      make: () => new MacosFileAccessInfo(),
      reportsOwners: true,
      ownStats: files.ownStats,
      userName: files.userName,
      unusedId: UNUSED_ID,
    });
  });
});

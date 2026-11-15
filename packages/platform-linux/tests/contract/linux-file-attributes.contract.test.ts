import { afterAll, describe, it } from 'vitest';
import { runFileAttributesContract, skipUnlessLinux } from '@throng/core/testing';
import { LinuxFileAttributes } from '@throng/platform-linux';
import { scratchFiles } from '../../../platform-node/tests/support/posix-files.js';

/** Layer: contract. The write bit is the file system's answer; only a real file shows it (067 FR-046, 070 R11). */
describe.skipIf(skipUnlessLinux('reads Linux file modes'))('LinuxFileAttributes meets the shared contract', () => {
  const files = scratchFiles();
  afterAll(() => files.cleanUp());

  it('reads read-only from the write bit and hidden from a leading dot', async () => {
    await runFileAttributesContract({
      make: () => new LinuxFileAttributes(),
      plainFile: files.plainFile,
      readOnlyFile: files.readOnlyFile,
      hiddenFile: files.dotFile,
      missingPath: files.missingPath,
    });
  });
});

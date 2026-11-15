import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { runVolumeRootsContract, skipUnlessLinux } from '@throng/core/testing';
import { LinuxVolumeRoots } from '@throng/platform-linux';

/** Layer: contract. The shared volume-roots suite (070 R11), against this machine's real mount table. */
describe.skipIf(skipUnlessLinux('reads /proc/self/mountinfo'))('LinuxVolumeRoots meets the shared contract', () => {
  it('gives a folder its mount and /proc a mount of its own', () => {
    const tmp = realpathSync(tmpdir());
    runVolumeRootsContract({
      make: () => new LinuxVolumeRoots(),
      localPaths: [join(tmp, 'a.txt'), join(tmp, 'b.txt')],
      // procfs is mounted on every Linux machine throng runs on, and never under the temporary folder.
      otherVolumePath: '/proc/self/status',
    });
  });
});

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { runVolumeRootsContract, skipUnlessWindows } from '@throng/core/testing';
import { WindowsVolumeRoots } from '../../src/windows-seams.js';

/** Layer: contract. The shared volume-roots suite (070 R11), against Windows' drive and UNC rules. */
describe.skipIf(skipUnlessWindows('drive letters and UNC shares are Windows paths'))('WindowsVolumeRoots meets the shared contract', () => {
  it('gives a drive its root and a UNC share its own, network, root', () => {
    runVolumeRootsContract({
      make: () => new WindowsVolumeRoots(),
      localPaths: [join(tmpdir(), 'a.txt'), join(tmpdir(), 'b.txt')],
      networkPath: '\\\\server\\share\\folder\\c.txt',
    });
  });
});

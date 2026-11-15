import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { runVolumeRootsContract, skipUnlessMacos } from '@throng/core/testing';
import { MacosVolumeRoots } from '../../src/macos-volume-roots.js';

/** Layer: contract. The shared volume-roots suite (070 R11), against the runner's real `mount` table. */
describe.skipIf(skipUnlessMacos('reads /sbin/mount on macOS'))('MacosVolumeRoots meets the shared contract', () => {
  it('gives a local folder a local root', { timeout: 15_000 }, async () => {
    const roots = new MacosVolumeRoots();
    await roots.refreshed();
    const tmp = realpathSync(tmpdir());
    runVolumeRootsContract({ make: () => roots, localPaths: [join(tmp, 'a.txt'), join(tmp, 'b.txt')] });
  });
});

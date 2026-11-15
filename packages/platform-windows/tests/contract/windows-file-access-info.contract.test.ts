import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, it } from 'vitest';
import { runFileAccessInfoContract, skipUnlessWindows } from '@throng/core/testing';
import { WindowsFileAccessInfo } from '../../src/windows-file-access-info.js';

/** Layer: contract. Windows shows owners in its own Properties dialog, so the seam reports none (067 FR-121). */
describe.skipIf(skipUnlessWindows('Windows has its own Properties dialog'))('WindowsFileAccessInfo meets the shared contract', () => {
  const dir = mkdtempSync(join(tmpdir(), 'throng-access-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reports no owners', async () => {
    await runFileAccessInfoContract({
      make: () => new WindowsFileAccessInfo(),
      reportsOwners: false,
      ownStats: async () => {
        const path = join(dir, 'own.txt');
        writeFileSync(path, 'x');
        return statSync(path);
      },
      userName: userInfo().username,
      unusedId: 2_147_483_000,
    });
  });
});

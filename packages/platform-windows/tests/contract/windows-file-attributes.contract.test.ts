import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, it } from 'vitest';
import { runFileAttributesContract, skipUnlessWindows } from '@throng/core/testing';
import { WindowsFileAttributes } from '../../src/windows-file-attributes.js';

/** Layer: contract. The attribute bits are NTFS's answer; only a real file shows them (067 FR-046, 070 R11). */
describe.skipIf(skipUnlessWindows('reads NTFS attributes through FindFirstFileW'))('WindowsFileAttributes meets the shared contract', () => {
  const dir = mkdtempSync(join(tmpdir(), 'throng-attrs-'));
  let n = 0;
  const fresh = (name: string): string => {
    n += 1;
    const path = join(dir, `${name}${n}.txt`);
    writeFileSync(path, 'x');
    return path;
  };
  afterAll(() => {
    execFileSync('attrib', ['-r', '-h', join(dir, '*'), '/s']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads the read-only and hidden attributes', async () => {
    await runFileAttributesContract({
      make: () => new WindowsFileAttributes(),
      plainFile: async () => fresh('plain'),
      readOnlyFile: async () => {
        const path = fresh('locked');
        chmodSync(path, 0o444); // Node sets FILE_ATTRIBUTE_READONLY on Windows.
        return path;
      },
      hiddenFile: async () => {
        const path = fresh('hidden');
        execFileSync('attrib', ['+h', path]);
        return path;
      },
      missingPath: () => join(dir, 'missing.txt'),
    });
  });
});

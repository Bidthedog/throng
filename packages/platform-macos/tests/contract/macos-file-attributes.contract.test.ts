import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { runFileAttributesContract, skipUnlessMacos } from '@throng/core/testing';
import { MacosFileAttributes } from '../../src/macos-file-info.js';
import { scratchFiles } from '../../../platform-node/tests/support/posix-files.js';

/** Layer: contract. The write bit and `UF_HIDDEN` are APFS's answer, read through the real `stat` (070 R11). */
describe.skipIf(skipUnlessMacos('reads st_flags through /usr/bin/stat on macOS'))('MacosFileAttributes meets the shared contract', () => {
  const files = scratchFiles();
  afterAll(() => files.cleanUp());

  it('reads read-only from the write bit and hidden from a dot or Finder’s flag', async () => {
    await runFileAttributesContract({
      make: () => new MacosFileAttributes(),
      plainFile: files.plainFile,
      readOnlyFile: files.readOnlyFile,
      hiddenFile: async () => {
        const path = await files.plainFile();
        execFileSync('chflags', ['hidden', path]);
        return path;
      },
      missingPath: files.missingPath,
    });
    expect((await new MacosFileAttributes().read(await files.dotFile())).hidden).toBe(true);
  });
});

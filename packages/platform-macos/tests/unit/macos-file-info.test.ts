import { afterAll, describe, expect, it } from 'vitest';
import { runFileAccessInfoContract, runFileAttributesContract, skipOnWindows } from '@throng/core/testing';
import { MacosFileAccessInfo, MacosFileAttributes, UF_HIDDEN, groupNameOf, type RunTool } from '../../src/macos-file-info.js';
import { UNUSED_ID, scratchFiles } from '../../../platform-node/tests/support/posix-files.js';

/**
 * The macOS tools are injected, so the rules run here against real files; the contract files run them against the
 * real `stat`, `id` and `dscacheutil` on the macOS runners.
 */
describe('MacosFileAttributes (070 FR-023, research R11)', () => {
  const files = scratchFiles();
  afterAll(() => files.cleanUp());
  const flagged = new Set<string>();
  const stat: RunTool = async (_file, args) => (flagged.has(args.at(-1)!) ? UF_HIDDEN.toString(16) : '0');

  it.skipIf(skipOnWindows('needs a POSIX filesystem: execute bits and /-rooted paths'))('passes the shared contract, hidden by a leading dot', async () => {
    await runFileAttributesContract({
      make: () => new MacosFileAttributes(stat),
      plainFile: files.plainFile,
      readOnlyFile: files.readOnlyFile,
      hiddenFile: files.dotFile,
      missingPath: files.missingPath,
    });
  });

  it('reads Finder’s hidden flag (UF_HIDDEN) on a name with no dot', async () => {
    const path = await files.plainFile();
    flagged.add(path);
    expect((await new MacosFileAttributes(stat).read(path)).hidden).toBe(true);
  });

  it('treats a flag it could not read as not hidden', async () => {
    const path = await files.plainFile();
    expect((await new MacosFileAttributes(async () => null).read(path)).hidden).toBe(false);
  });
});

describe('MacosFileAccessInfo (070 FR-023, research R11)', () => {
  const files = scratchFiles();
  afterAll(() => files.cleanUp());

  it('passes the shared contract, with names from Directory Services and numbers where it has none', async () => {
    const run: RunTool = async (file, args) => {
      const id = Number(args.at(-1));
      if (id === UNUSED_ID) return null;
      return file.endsWith('/id') ? files.userName : `name: staff\npassword: *\ngid: ${id}\n`;
    };
    await runFileAccessInfoContract({
      make: () => new MacosFileAccessInfo(run),
      reportsOwners: true,
      ownStats: files.ownStats,
      userName: files.userName,
      unusedId: UNUSED_ID,
    });
  });

  it('asks once per id', async () => {
    let calls = 0;
    const info = new MacosFileAccessInfo(async () => {
      calls += 1;
      return 'dev';
    });
    await info.read({ uid: 501, gid: 20, mode: 0o644 });
    await info.read({ uid: 501, gid: 20, mode: 0o600 });
    expect(calls).toBe(2);
  });

  it('reads the group name from dscacheutil’s answer', () => {
    expect(groupNameOf('name: staff\npassword: *\ngid: 20\nusers: dev\n')).toBe('staff');
    expect(groupNameOf('')).toBeUndefined();
  });
});

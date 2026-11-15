import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  runDirectoryLockContract,
  runElevationContract,
  runFontEnumerationContract,
  runPathFormsContract,
  runPlatformInfoContract,
  runShellDetectionContract,
  skipUnlessMacos,
} from '@throng/core/testing';
import { MACOS_SHELL_SEARCH_DIRS, PosixDirectoryLock, PosixElevation, PosixPathForms, PosixShellDetection } from '@throng/platform-node';
import { MacosFontEnumeration, MacosPlatformInfo } from '../../src/macos-simple-services.js';

/**
 * Layer: contract. Each class meets the same shared suite as the Windows and Linux ones, against the real macOS
 * (070 FR-012). The pure seams (executable extensions, refused schemes, user directories) run their contracts in the
 * unit layer, on every host, so they are not repeated here.
 */
const temp: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'throng-macos-'));
  temp.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tryIt = (fn: () => void): boolean => {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
};


describe.skipIf(skipUnlessMacos('drives real macOS shells, folders and the system'))('macOS platform services (070 FR-011, FR-012)', () => {
  it('platform info', () => {
    runPlatformInfoContract(() => new MacosPlatformInfo());
  });

  it('shell detection reports real shells, zsh among them, the login shell first (FR-017)', async () => {
    const make = (): PosixShellDetection => new PosixShellDetection({ extraSearchDirs: MACOS_SHELL_SEARCH_DIRS });
    await runShellDetectionContract(make, { fileExists: existsSync });
    const shells = await make().detectInstalledShells();
    expect(shells.map((s) => s.id)).toContain('zsh');
  });

  it('shell detection finds the Homebrew fish the runner setup installs, with launchd’s short PATH', async () => {
    const brewFish = MACOS_SHELL_SEARCH_DIRS.map((dir) => join(dir, 'fish')).find((file) => existsSync(file));
    expect(brewFish, 'scripts/ci-macos-setup.sh installs fish through Homebrew before this job tests').toBeDefined();
    const shells = await new PosixShellDetection({
      readShellsFile: async () => '/bin/bash\n/bin/zsh\n/bin/sh\n',
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
      extraSearchDirs: MACOS_SHELL_SEARCH_DIRS,
    }).detectInstalledShells();
    expect(shells.find((s) => s.id === 'fish')?.file).toBe(brewFish);
  });

  it('directory lock validates and records, and says it cannot hold a folder', async () => {
    await runDirectoryLockContract({
      make: () => new PosixDirectoryLock(),
      makeDir: tempDir,
      nonExistentPath: () => join(tempDir(), 'missing'),
      tryDelete: (dir) =>
        tryIt(() => {
          rmdirSync(dir);
          mkdirSync(dir);
        }),
      tryRename: (dir) =>
        tryIt(() => {
          renameSync(dir, `${dir}.moved`);
          renameSync(`${dir}.moved`, dir);
        }),
      tryWriteInside: (dir) =>
        tryIt(() => {
          writeFileSync(join(dir, 'f'), 'x');
          rmSync(join(dir, 'f'));
        }),
      cleanup: (dir) => rmSync(dir, { recursive: true, force: true }),
      holdsAgainstRemoval: false,
    });
  });

  it('elevation is never reported, as on Linux (062 FR-008)', () => {
    runElevationContract(() => new PosixElevation());
  });

  it('path forms', () => {
    runPathFormsContract(() => new PosixPathForms(), undefined, { hasDriveForms: false });
  });
});

describe.skipIf(skipUnlessMacos('asks AppKit for its font families'))('macOS font enumeration (070 research R8)', () => {
  runFontEnumerationContract('MacosFontEnumeration', () => new MacosFontEnumeration());

  it('lists Menlo, which every supported macOS ships', async () => {
    expect(await new MacosFontEnumeration().listInstalledFamilies()).toContain('Menlo');
  });
});

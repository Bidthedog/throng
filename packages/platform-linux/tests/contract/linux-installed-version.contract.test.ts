import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LinuxInstalledVersion } from '../../src/linux-installed-version.js';

// Layer: contract — the seam's answers against a real folder and symlink, which is what a package leaves on disk.
describe('LinuxInstalledVersion (063 FR-010)', () => {
  let root: string;
  let versions: string;

  function installVersion(version: string, manifest = JSON.stringify({ version })): void {
    const app = join(versions, version, 'resources', 'app');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'package.json'), manifest);
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'throng-installed-'));
    versions = join(root, 'throng-versions');
    mkdirSync(versions);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads what current points at, for a copy running from a version folder', () => {
    installVersion('1.0.0');
    installVersion('1.1.0');
    symlinkSync('1.1.0', join(versions, 'current'));

    expect(new LinuxInstalledVersion(join(versions, '1.0.0', 'throng-bin')).installed()).toEqual({
      version: '1.1.0',
      launcher: join(versions, 'current', 'throng'),
    });
  });

  it('answers null for a copy that is not a package, such as an extracted archive', () => {
    expect(new LinuxInstalledVersion(join(root, 'extracted', 'throng-bin')).installed()).toBeNull();
  });

  it('answers null once the package is gone', () => {
    expect(new LinuxInstalledVersion(join(versions, '1.0.0', 'throng-bin')).installed()).toBeNull();
  });

  it('answers null for a manifest it cannot use', () => {
    installVersion('1.1.0', '{ not json');
    symlinkSync('1.1.0', join(versions, 'current'));
    expect(new LinuxInstalledVersion(join(versions, '1.0.0', 'throng-bin')).installed()).toBeNull();
  });
});

import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { logCaught, type IInstalledVersion, type InstalledCopy } from '@throng/core';

/** The folder a package's version folders live in (063 research D2): `<here>/<version>/throng-bin`. */
const VERSIONS_FOLDER = 'throng-versions';

/**
 * Reads the version the package manager last installed, through `current` (063 FR-010).
 *
 * A copy anywhere else, an archive or a source run, is not a package's and answers null, as does a folder
 * that cannot be read: the package may be mid-upgrade or removed, and neither is worth a notice.
 */
export class LinuxInstalledVersion implements IInstalledVersion {
  constructor(private readonly execPath: string) {}

  installed(): InstalledCopy | null {
    const versions = dirname(dirname(this.execPath));
    if (basename(versions) !== VERSIONS_FOLDER) return null;
    const current = join(versions, 'current');
    try {
      const manifest = JSON.parse(readFileSync(join(current, 'resources', 'app', 'package.json'), 'utf8')) as {
        version?: unknown;
      };
      if (typeof manifest.version !== 'string' || manifest.version === '') return null;
      return { version: manifest.version, launcher: join(current, 'throng') };
    } catch (error) {
      logCaught('linux-installed-version: read current manifest', error);
      return null;
    }
  }
}

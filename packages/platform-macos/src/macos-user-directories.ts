import { homedir } from 'node:os';
import { join } from 'node:path/posix';
import type { IUserDirectories } from '@throng/core';
import { ensureOwnerOnlyDir } from '@throng/platform-node';

const name = (devMode: boolean): string => (devMode ? 'throng-dev' : 'throng');

/**
 * Apple's per-user folders (070 FR-014, R5): data in `~/Library/Application Support/throng`, settings in a folder of
 * their own inside it, logs in `~/Library/Logs/throng` so Console.app shows them. `-dev` keeps a source run apart from
 * an installed build (062 FR-005). The `THRONG_*` overrides apply above this, as on every platform.
 */
export class MacosUserDirectories implements IUserDirectories {
  constructor(private readonly home: () => string = homedir) {}

  dataDir(devMode: boolean): string {
    return join(this.home(), 'Library', 'Application Support', name(devMode));
  }

  configRoot(devMode: boolean): string {
    return join(this.dataDir(devMode), 'settings');
  }

  logDir(devMode: boolean): string {
    return join(this.home(), 'Library', 'Logs', name(devMode));
  }

  prepare(dir: string): void {
    ensureOwnerOnlyDir(dir);
  }
}

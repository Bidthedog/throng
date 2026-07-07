import os from 'node:os';
import path from 'node:path';
import type { IPlatformInfo, OsName } from '@throng/core';

/**
 * The Windows concrete implementation of the `IPlatformInfo` OS contract and
 * the only place in this package that reads OS-specific facts (Principle II
 * seam). Verified against the shared contract suite in tests/contract/.
 */
export class WindowsPlatformInfo implements IPlatformInfo {
  osName(): OsName {
    switch (os.platform()) {
      case 'win32':
        return 'windows';
      case 'darwin':
        return 'macos';
      default:
        return 'linux';
    }
  }

  pathSeparator(): string {
    return path.sep;
  }
}

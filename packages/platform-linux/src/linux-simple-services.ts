import { execFile } from 'node:child_process';
import path from 'node:path';
import type { IExecutableExtensions, IFontEnumeration, IPlatformInfo, IRefusedUriSchemes, OsName } from '@throng/core';
import { logChildFailure } from '@throng/platform-node';

/**
 * Elevation, the directory lock, the holder lookup and the root refusal are the shared POSIX ones (070 R1), under the
 * names Linux has always imported.
 */
export {
  NoDeElevatedLauncher,
  PosixDirectoryLock as LinuxDirectoryLock,
  PosixElevation as LinuxElevation,
  posixLookupHolder as lookupHolder,
  posixStartupRefusal as startupRefusal,
} from '@throng/platform-node';

export class LinuxPlatformInfo implements IPlatformInfo {
  osName(): OsName {
    return 'linux';
  }

  pathSeparator(): string {
    return path.sep;
  }
}

/** Font families from fontconfig. A machine without it gets an empty list, which the picker already handles. */
export class LinuxFontEnumeration implements IFontEnumeration {
  listInstalledFamilies(): Promise<string[]> {
    return new Promise((resolve) => {
      execFile(
        'fc-list',
        [':', 'family'],
        { timeout: 10_000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            logChildFailure('fc-list', error, stderr);
            resolve([]);
            return;
          }
          // A line may list a family's aliases, comma-separated; the first is the name a font stack uses.
          const families = String(stdout)
            .split('\n')
            .map((line) => line.split(',')[0]?.replace(/\\-/g, '-').trim() ?? '')
            .filter((name) => name.length > 0);
          resolve([...new Set(families)].sort((a, b) => a.localeCompare(b)));
        },
      );
    });
  }
}

/** File types the desktop's opener would run rather than show (045 FR-015's question, asked of Linux). */
const LINUX_EXECUTABLE_EXTENSIONS: readonly string[] = [
  '.appimage',
  '.bash',
  '.bin',
  '.csh',
  '.desktop',
  '.fish',
  '.ksh',
  '.pl',
  '.py',
  '.rb',
  '.run',
  '.sh',
  '.zsh',
];

export class LinuxExecutableExtensions implements IExecutableExtensions {
  isExecutable(filePath: string): boolean {
    if (typeof filePath !== 'string' || filePath.length === 0 || /[\\/]$/.test(filePath)) return false;
    const name = filePath.slice(filePath.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    if (dot <= 0 || dot === name.length - 1) return false;
    return LINUX_EXECUTABLE_EXTENSIONS.includes(name.slice(dot).toLowerCase());
  }

  executableExtensions(): readonly string[] {
    return LINUX_EXECUTABLE_EXTENSIONS;
  }
}

/** Schemes whose desktop handlers install or configure things: no allowlist may reach them (045 FR-159). */
const REFUSED: ReadonlySet<string> = new Set(['apt', 'appstream', 'snap', 'gnome-control-center', 'ghelp']);

export class LinuxRefusedUriSchemes implements IRefusedUriSchemes {
  refusedSchemes(): ReadonlySet<string> {
    return REFUSED;
  }
}

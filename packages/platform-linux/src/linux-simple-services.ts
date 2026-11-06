import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import type {
  Holder,
  IDirectoryLock,
  IElevationState,
  IExecutableExtensions,
  IFontEnumeration,
  IPlatformInfo,
  IRefusedUriSchemes,
  LockHandle,
  OsName,
} from '@throng/core';
import { logExpected } from '@throng/core';
import { logChildFailure } from '@throng/platform-node';

export class LinuxPlatformInfo implements IPlatformInfo {
  osName(): OsName {
    return 'linux';
  }

  pathSeparator(): string {
    return path.sep;
  }
}

/**
 * Linux has no elevation model throng takes part in: main refuses to start as root (062 FR-019), and `sudo` inside a
 * terminal is the user's own affair. The interface's answer is what hides every elevation control (FR-008).
 */
export class LinuxElevation implements IElevationState {
  isElevated(): boolean {
    return false;
  }
}

/** There is nothing to hand a process back to, because nothing is ever elevated. */
export class NoDeElevatedLauncher {
  isAvailable(): boolean {
    return false;
  }

  launch(_file: string, _args: string[], report?: (reason: string) => void): void {
    report?.('de-elevation does not exist on this platform');
  }
}

function fail(message: string, code: string): Error {
  const error: NodeJS.ErrnoException = new Error(message);
  error.code = code;
  return error;
}

/**
 * A folder cannot be held against deletion on Linux: a running process's working directory stops neither `rmdir` nor
 * `rename`. So `acquire` validates and records, with no helper process, and the difference is in `docs/linux.md`
 * (062 contracts/platform-services.md). The contract suite runs with its hold assertions off for this class.
 */
export class LinuxDirectoryLock implements IDirectoryLock {
  private readonly held = new Set<LockHandle>();

  async acquire(absPath: string): Promise<LockHandle> {
    // Async: a folder on a stuck mount must not stop the daemon's event loop.
    const info = await stat(absPath).catch((error: unknown) => {
      logExpected('linux-simple-services: stat folder to hold', 'a folder deleted or never created is refused just below with ENOENT, which the caller reports', error);
      return null;
    });
    if (info === null) throw fail(`Cannot use "${absPath}": the path does not exist`, 'ENOENT');
    if (!info.isDirectory()) throw fail(`Cannot use "${absPath}": not a directory`, 'ENOTDIR');
    const handle: LockHandle = { path: absPath };
    this.held.add(handle);
    return handle;
  }

  release(handle: LockHandle): Promise<void> {
    this.held.delete(handle);
    return Promise.resolve();
  }

  heldPids(): readonly { readonly path: string; readonly pid: number }[] {
    return [];
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

/** Who else holds a path: not identified, as on Windows today (#210). */
export function lookupHolder(_absPath: string): Promise<Holder | undefined> {
  return Promise.resolve(undefined);
}

/** The refusal main shows when started as root (062 FR-019), or null. */
export function startupRefusal(uid: number | undefined = process.getuid?.()): string | null {
  if (uid !== 0) return null;
  const user = os.userInfo().username;
  return (
    `throng will not run as ${user}. Start it as your normal user, and use sudo inside a terminal when a command needs it.`
  );
}

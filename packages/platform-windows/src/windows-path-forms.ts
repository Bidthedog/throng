import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IPathForms } from '@throng/core';

/**
 * Where Git for Windows is installed, or `null` when it is not. A function is accepted so the
 * composition root can hand over the shell detection's answer LAZILY: finding Git can mean a
 * registry query, and nothing should pay for that until a rooted path is actually asked about.
 */
export type GitInstallRoot = string | null | (() => string | null);

export interface WindowsPathFormsOptions {
  /** Git for Windows' install root (FR-151). Omitted or `null`: no mount table to consult. */
  readonly gitRoot?: GitInstallRoot;
}

/** One mount point: a POSIX prefix and the Windows folder it names. */
interface Mount {
  readonly point: string;
  readonly target: string;
}

/**
 * The Windows answers to `IPathForms` (045 FR-012, FR-025, FR-026, FR-151 – FR-153; Principle II
 * seam).
 *
 * Every spelling `@throng/core` refuses to know is settled here, and nowhere else: the Git Bash
 * `/d/x` and WSL `/mnt/d/x` drive forms, `~`, the three shapes of a `file:` URI, Git Bash's own mount
 * table, and which drive a rooted `\tmp` is on. Verified against the shared suite in
 * `core/src/testing/path-forms-contract.ts`, plus the Windows-only spellings in this package's
 * contract test.
 *
 * ══ TOTAL, BECAUSE THE INPUT IS WHATEVER A PROGRAM PRINTED ══
 *
 * These methods are fed text scraped off a terminal, so `null` is the answer for anything that does
 * not convert and a throw is never one. Two places earn that explicitly: `new URL` rejects a string
 * that is not a URL at all, and `decodeURIComponent` rejects a malformed escape like `%ZZ` — both are
 * caught, because a stray percent sign in a log line must make a candidate a non-link rather than
 * break the hover that found it.
 *
 * ══ /mnt/ IS CHECKED BEFORE THE PLAIN DRIVE FORM, AND NEITHER FALLS BACK ══
 *
 * `/mnt/hosts` is, read literally under the Git Bash convention, drive `m` followed by `nt/hosts`.
 * Nobody means that. So a path under `/mnt/` must name a single-letter drive in its next segment or
 * it is not a drive form at all — falling back to the plain reading is what would turn a WSL path
 * that names nothing into a confident mapping onto drive M.
 *
 * ══ GIT'S MOUNT TABLE: READ ONCE, LAZILY ══
 *
 * Git Bash mounts its install root at `/`, `usr\bin` again at `/bin`, and whatever its `etc\fstab`
 * declares — as shipped, `/tmp` as the user's temp folder (`usertemp`). The table is built on the
 * first rooted path asked about and kept: the install does not move while the app runs, and a
 * hover must not read a file.
 */
export class WindowsPathForms implements IPathForms {
  private readonly gitRoot: GitInstallRoot;
  private mounts: readonly Mount[] | undefined;

  constructor(options: WindowsPathFormsOptions = {}) {
    this.gitRoot = options.gitRoot ?? null;
  }

  homeDirectory(): string {
    return os.homedir();
  }

  fromDriveForm(posixPath: string): string | null {
    if (typeof posixPath !== 'string' || posixPath.length === 0) return null;
    if (/^\/mnt\//i.test(posixPath)) {
      return this.driveOf(/^\/mnt\/([A-Za-z])(?:[\\/](.*))?$/.exec(posixPath));
    }
    return this.driveOf(/^\/([A-Za-z])(?:[\\/](.*))?$/.exec(posixPath));
  }

  fromFileUrl(url: string): string | null {
    const parsed = this.parseFileUrl(url);
    if (parsed === null) return null;
    const { host, pathname } = parsed;
    if (host !== '' && host.toLowerCase() !== 'localhost') {
      // FR-012: a host names a network location.
      return `\\\\${host}${this.backslashes(pathname)}`;
    }

    // Hostless (or `localhost`): a local path. The leading separator is dropped only when what
    // follows is a drive designator — `file:///share/x` names the current drive's root, and eating
    // its separator would quietly turn an absolute path into a relative one.
    const local = pathname.replace(/^\//, '');
    if (/^[A-Za-z]:/.test(local)) return this.backslashes(local);
    return this.backslashes(pathname);
  }

  fromHomeForm(p: string): string | null {
    if (typeof p !== 'string') return null;
    if (p === '~') return this.homeDirectory();
    const m = /^~[\\/](.*)$/.exec(p);
    if (!m) return null;
    const rest = this.backslashes(m[1]).replace(/^\\/, '');
    return rest.length === 0 ? this.homeDirectory() : `${this.homeDirectory()}${path.sep}${rest}`;
  }

  fromMountTable(posixPath: string): string | null {
    if (typeof posixPath !== 'string' || !/^\/(?!\/)/.test(posixPath)) return null;
    // A drive form is `fromDriveForm`'s, and its answer is not Git's to give.
    if (this.fromDriveForm(posixPath) !== null) return null;
    for (const mount of this.mountTable()) {
      if (posixPath === mount.point) return mount.target;
      const prefix = mount.point === '/' ? '/' : `${mount.point}/`;
      if (posixPath.startsWith(prefix)) {
        const rest = this.backslashes(posixPath.slice(prefix.length));
        return rest.length === 0 ? mount.target : `${mount.target}\\${rest}`;
      }
    }
    return null;
  }

  qualifyRooted(rootedPath: string, anchor: string): string | null {
    if (typeof rootedPath !== 'string' || typeof anchor !== 'string') return null;
    // Rooted, and not a UNC form: `\tmp` or `/tmp`, never `\\server`.
    if (!/^[\\/](?![\\/])/.test(rootedPath)) return null;
    const volume = this.volumeOf(anchor);
    if (volume === null) return null;
    return `${volume}${this.backslashes(rootedPath)}`;
  }

  fileUrlLocalPath(url: string): string | null {
    const parsed = this.parseFileUrl(url);
    if (parsed === null) return null;
    if (parsed.host !== '' && parsed.host.toLowerCase() !== 'localhost') return null;
    const { pathname } = parsed;
    if (pathname.length <= 1 || /^\/[A-Za-z]:/.test(pathname)) return null;
    return pathname;
  }

  loopbackFromFileUrl(url: string): string | null {
    // The raw text, not the parsed host: WHATWG URL folds a `localhost` file host to the empty
    // string, and `file:///C$/x` must NOT be read as the loopback share.
    if (typeof url !== 'string' || !/^file:\/\/localhost\//i.test(url)) return null;
    const parsed = this.parseFileUrl(url);
    if (parsed === null) return null;
    const first = parsed.pathname.split('/')[1] ?? '';
    if (first.length === 0 || /^[A-Za-z]:$/.test(first)) return null;
    return `\\\\localhost${this.backslashes(parsed.pathname)}`;
  }

  /** A `file:` URI's host and percent-decoded path, or `null` for anything that is not one. */
  private parseFileUrl(url: string): { host: string; pathname: string } | null {
    if (typeof url !== 'string' || !/^file:/i.test(url)) return null;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    try {
      return { host: parsed.hostname, pathname: decodeURIComponent(parsed.pathname) };
    } catch {
      return null;
    }
  }

  /** `D:` for a drive-qualified anchor, `\\server\share` for a UNC one, else `null`. */
  private volumeOf(anchor: string): string | null {
    const drive = /^([A-Za-z]:)[\\/]/.exec(anchor);
    if (drive) return drive[1].toUpperCase();
    const unc = /^[\\/]{2}([^\\/]+)[\\/]([^\\/]+)/.exec(anchor);
    if (unc) return `\\\\${unc[1]}\\${unc[2]}`;
    return null;
  }

  /** Longest mount point first, so `/tmp` wins over `/`. Empty when Git is not installed. */
  private mountTable(): readonly Mount[] {
    if (this.mounts !== undefined) return this.mounts;
    const root = this.resolveGitRoot();
    if (root === null) {
      this.mounts = [];
      return this.mounts;
    }
    const byPoint = new Map<string, string>([
      ['/', root],
      ['/bin', path.win32.join(root, 'usr', 'bin')],
    ]);
    for (const mount of this.readFstab(root)) byPoint.set(mount.point, mount.target);
    this.mounts = [...byPoint.entries()]
      .map(([point, target]) => ({ point, target }))
      .sort((a, b) => b.point.length - a.point.length);
    return this.mounts;
  }

  private resolveGitRoot(): string | null {
    let root: string | null;
    try {
      root = typeof this.gitRoot === 'function' ? this.gitRoot() : this.gitRoot;
    } catch {
      return null;
    }
    if (root === null || root.length === 0) return null;
    return root.replace(/[\\/]+$/, '');
  }

  /**
   * Git's `etc\fstab`, in Cygwin's format: `<target> <mount point> <type> <options> 0 0`, with
   * `\040` for a space. The `cygdrive` line is the drive-prefix setting, not a mount — that is
   * `fromDriveForm`'s business. `usertemp` is the user's temp folder. A missing or unreadable file is
   * simply no extra mounts.
   */
  private readFstab(root: string): Mount[] {
    let text: string;
    try {
      text = readFileSync(path.win32.join(root, 'etc', 'fstab'), 'utf8');
    } catch {
      return [];
    }
    const mounts: Mount[] = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*$/, '').trim();
      if (line.length === 0) continue;
      const [target, point, type] = line.split(/\s+/).map((f) => f.replace(/\\040/g, ' '));
      if (target === undefined || point === undefined || type === undefined) continue;
      if (!point.startsWith('/') || type === 'cygdrive') continue;
      const normalisedPoint = point.length > 1 ? point.replace(/\/+$/, '') : point;
      if (type === 'usertemp') {
        mounts.push({ point: normalisedPoint, target: os.tmpdir() });
        continue;
      }
      if (/^[A-Za-z]:[\\/]/.test(target) || /^[\\/]{2}[^\\/]/.test(target)) {
        mounts.push({ point: normalisedPoint, target: this.backslashes(target).replace(/\\+$/, '') });
      }
    }
    return mounts;
  }

  private driveOf(m: RegExpExecArray | null): string | null {
    if (!m) return null;
    const rest = this.backslashes(m[2] ?? '').replace(/^\\/, '');
    return `${m[1].toUpperCase()}:${path.sep}${rest}`;
  }

  private backslashes(s: string): string {
    return s.replace(/\//g, '\\');
  }
}

import os from 'node:os';
import path from 'node:path';
import type { IPathForms } from '@throng/core';

/**
 * The Windows answers to `IPathForms` (045 FR-012, FR-025, FR-026; Principle II seam).
 *
 * Every spelling `@throng/core` refuses to know is settled here, and nowhere else: the Git Bash
 * `/d/x` and WSL `/mnt/d/x` drive forms, `~`, and the three shapes of a `file:` URI. Verified
 * against the shared suite in `core/src/testing/path-forms-contract.ts`, plus the Windows-only
 * spellings in this package's contract test.
 *
 * ══ TOTAL, BECAUSE THE INPUT IS WHATEVER A PROGRAM PRINTED ══
 *
 * These four methods are fed text scraped off a terminal, so `null` is the answer for anything that
 * does not convert and a throw is never one. Two places earn that explicitly: `new URL` rejects a
 * string that is not a URL at all, and `decodeURIComponent` rejects a malformed escape like `%ZZ` —
 * both are caught, because a stray percent sign in a log line must make a candidate a non-link
 * rather than break the hover that found it.
 *
 * ══ /mnt/ IS CHECKED BEFORE THE PLAIN DRIVE FORM, AND NEITHER FALLS BACK ══
 *
 * `/mnt/hosts` is, read literally under the Git Bash convention, drive `m` followed by `nt/hosts`.
 * Nobody means that. So a path under `/mnt/` must name a single-letter drive in its next segment or
 * it is not a drive form at all — falling back to the plain reading is what would turn a WSL path
 * that names nothing into a confident mapping onto drive M.
 */
export class WindowsPathForms implements IPathForms {
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
    if (typeof url !== 'string' || !/^file:/i.test(url)) return null;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(parsed.pathname);
    } catch {
      return null;
    }

    const host = parsed.hostname;
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

  private driveOf(m: RegExpExecArray | null): string | null {
    if (!m) return null;
    const rest = this.backslashes(m[2] ?? '').replace(/^\\/, '');
    return `${m[1].toUpperCase()}:${path.sep}${rest}`;
  }

  private backslashes(s: string): string {
    return s.replace(/\//g, '\\');
  }
}

import os from 'node:os';
import { logExpected, type IPathForms } from '@throng/core';

/**
 * How Linux spells a path (062 FR-021, FR-022). `/d/x` is an ordinary path here, so there is no drive form. A leading
 * `/` is already the platform's own meaning, so the mount-table step answers with the path itself: that step runs
 * with or without an anchor, which the qualifying step does not, so a panel with no project still resolves `/etc/hosts`.
 */
export class LinuxPathForms implements IPathForms {
  homeDirectory(): string {
    return os.homedir();
  }

  fromDriveForm(_posixPath: string): string | null {
    return null;
  }

  fromFileUrl(url: string): string | null {
    const parsed = parseFileUrl(url);
    if (parsed === null) return null;
    const { host, pathname } = parsed;
    if (host !== '' && host.toLowerCase() !== 'localhost') return `//${host}${pathname}`;
    return pathname;
  }

  fromHomeForm(p: string): string | null {
    if (typeof p !== 'string') return null;
    if (p === '~') return this.homeDirectory();
    if (!p.startsWith('~/')) return null;
    const rest = p.slice(2).replace(/^\/+/, '');
    return rest.length === 0 ? this.homeDirectory() : `${this.homeDirectory()}/${rest}`;
  }

  fromMountTable(posixPath: string): string | null {
    return posixPath.startsWith('/') ? posixPath : null;
  }

  qualifyRooted(rootedPath: string, anchor: string): string | null {
    return anchor.startsWith('/') && rootedPath.startsWith('/') ? rootedPath : null;
  }

  fileUrlLocalPath(url: string): string | null {
    const parsed = parseFileUrl(url);
    if (parsed === null) return null;
    if (parsed.host !== '' && parsed.host.toLowerCase() !== 'localhost') return null;
    return parsed.pathname.length <= 1 ? null : parsed.pathname;
  }

  loopbackFromFileUrl(_url: string): string | null {
    return null;
  }
}

function parseFileUrl(url: string): { host: string; pathname: string } | null {
  if (typeof url !== 'string' || !/^file:/i.test(url)) return null;
  try {
    const parsed = new URL(url);
    return { host: parsed.hostname, pathname: decodeURIComponent(parsed.pathname) };
  } catch (error) {
    logExpected('linux-path-forms: parse file URL', 'a file: URL from a link or a paste may be malformed; it names no path', error);
    return null;
  }
}

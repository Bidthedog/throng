import { execFile } from 'node:child_process';
import { logCaught, type IVolumeRoots } from '@throng/core';

const REFRESH_MS = 5000;

/** File systems whose `stat` can hang on someone else's server (`mount`'s type names). */
const NETWORK_TYPES = /^(?:smbfs|nfs|afpfs|webdav|cifs|ftp|osxfuse|macfuse)$/;

export interface MacosMount {
  readonly path: string;
  readonly network: boolean;
}

/**
 * `/` and the volumes under `/Volumes` from `/sbin/mount`'s listing (070 R11): `<device> on <mount point> (<type>,
 * <options>)`. The system's own volumes (`/System/Volumes/*`, `/dev`) are left out: they are firmlinked into `/` and
 * no path a user opens names them.
 */
export function parseMountOutput(text: string): MacosMount[] {
  const mounts: MacosMount[] = [];
  for (const line of text.split('\n')) {
    const match = /^.+? on (\/.*?) \(([^,)]+)/.exec(line.trim());
    if (!match) continue;
    const [, path, type] = match;
    if (path !== '/' && !path!.startsWith('/Volumes/')) continue;
    mounts.push({ path: path!, network: NETWORK_TYPES.test(type!.trim()) });
  }
  return mounts;
}

function readMountTable(): Promise<string> {
  return new Promise((resolve, reject) => {
    // child-exempt: every failure rejects, and refresh(), the only caller, records it through logCaught and keeps the last table.
    execFile('/sbin/mount', [], { timeout: 5000, encoding: 'utf8' }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))));
  });
}

/**
 * Volume roots on macOS (062 against 045 FR-121, 070 R11). `path.parse` answers `/` for every path, so without this one
 * stuck share under `/Volumes` would put the whole machine behind one root. The listing is `mount`'s, which reads the
 * kernel's table and never touches a mount, so it cannot itself hang; it is read off the loop and refreshed every few
 * seconds, and until it first arrives every path answers `/`, the rule it replaces.
 */
export class MacosVolumeRoots implements IVolumeRoots {
  private mounts: readonly MacosMount[] = [{ path: '/', network: false }];
  private readAt = 0;
  private reading: Promise<void> | null = null;

  constructor(private readonly read: () => Promise<string> = readMountTable) {
    this.refresh();
  }

  /** Resolves once the read in flight, if any, has landed. A test seam; callers never wait. */
  refreshed(): Promise<void> {
    return this.reading ?? Promise.resolve();
  }

  rootOf(path: string): string {
    if (Date.now() - this.readAt >= REFRESH_MS) this.refresh();
    return this.mountOf(path)?.path ?? '/';
  }

  isNetwork(root: string): boolean {
    return this.mounts.find((m) => m.path === root)?.network === true;
  }

  /** The deepest mount holding `path`. */
  private mountOf(path: string): MacosMount | undefined {
    let best: MacosMount | undefined;
    for (const mount of this.mounts) {
      const prefix = mount.path === '/' ? '/' : `${mount.path}/`;
      if (path !== mount.path && !path.startsWith(prefix)) continue;
      if (best === undefined || mount.path.length >= best.path.length) best = mount;
    }
    return best;
  }

  private refresh(): void {
    if (this.reading) return;
    this.reading = this.read()
      .then((text) => {
        const mounts = parseMountOutput(text);
        if (mounts.length > 0) this.mounts = mounts;
      })
      .catch((error: unknown) => logCaught('macos-volume-roots: read mount table', error))
      .finally(() => {
        this.readAt = Date.now();
        this.reading = null;
      });
  }
}

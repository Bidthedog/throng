import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { logCaught, type IVolumeRoots } from '@throng/core';

const REFRESH_MS = 5000;

/** Filesystems whose `stat` can hang on someone else's server. */
const NETWORK_TYPES = /^(?:nfs4?|cifs|smb3|smbfs|ceph|glusterfs|lustre|afs|9p|fuse\.(?:sshfs|davfs2?|rclone|glusterfs|s3fs))$/;

export interface MountPoint {
  readonly path: string;
  readonly network: boolean;
}

/** `\040` and friends: mountinfo octal-escapes the separators a mount point may hold. */
const unescapeOctal = (field: string): string =>
  field.replace(/\\([0-7]{3})/g, (_m, octal: string) => String.fromCharCode(parseInt(octal, 8)));

/** Parse `/proc/self/mountinfo`: the mount point is field 5, and the type follows the lone `-`. */
export function parseMountInfo(text: string): MountPoint[] {
  const mounts: MountPoint[] = [];
  for (const line of text.split('\n')) {
    const fields = line.split(' ');
    const dash = fields.indexOf('-');
    const mountPoint = fields[4];
    const type = fields[dash + 1];
    if (dash < 0 || mountPoint === undefined || type === undefined) continue;
    mounts.push({ path: unescapeOctal(mountPoint), network: NETWORK_TYPES.test(type) });
  }
  return mounts;
}

/**
 * Volume roots on Linux (062, against 045 FR-121). `path.parse` answers `/` for every path here, so without this one
 * stuck NFS mount would put the whole machine behind one root and every local link would read as unreachable. A
 * mount table read never touches a mount, so it cannot itself hang.
 */
export class LinuxVolumeRoots implements IVolumeRoots {
  private mounts: readonly MountPoint[];
  private readAt = Date.now();
  private refreshing = false;

  constructor(
    private readonly readNow: () => string = () => readFileSync('/proc/self/mountinfo', 'utf8'),
    private readonly readLater: () => Promise<string> = () => readFile('/proc/self/mountinfo', 'utf8'),
  ) {
    this.mounts = this.readInitial();
  }

  rootOf(path: string): string {
    this.refreshIfStale();
    return this.mountOf(path)?.path ?? '/';
  }

  isNetwork(root: string): boolean {
    return this.mounts.find((m) => m.path === root)?.network === true;
  }

  private readInitial(): readonly MountPoint[] {
    try {
      return parseMountInfo(this.readNow());
    } catch (error) {
      logCaught('linux-volume-roots: read mount table', error);
      return [];
    }
  }

  /** The deepest mount holding `path`. A later duplicate shadows an earlier one, as the kernel's stacking does. */
  private mountOf(path: string): MountPoint | undefined {
    let best: MountPoint | undefined;
    for (const mount of this.mounts) {
      const prefix = mount.path === '/' ? '/' : `${mount.path}/`;
      if (path !== mount.path && !path.startsWith(prefix)) continue;
      if (best === undefined || mount.path.length >= best.path.length) best = mount;
    }
    return best;
  }

  /** A mount made while throng runs is seen a few seconds later; the check asking never waits for it. */
  private refreshIfStale(): void {
    if (this.refreshing || Date.now() - this.readAt < REFRESH_MS) return;
    this.refreshing = true;
    void this.readLater()
      .then((text) => {
        this.mounts = parseMountInfo(text);
      })
      .catch((error: unknown) => logCaught('linux-volume-roots: refresh mount table', error))
      .finally(() => {
        this.readAt = Date.now();
        this.refreshing = false;
      });
  }
}

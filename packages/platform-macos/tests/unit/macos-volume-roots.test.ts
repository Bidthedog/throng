import { describe, expect, it } from 'vitest';
import { runVolumeRootsContract } from '@throng/core/testing';
import { MacosVolumeRoots, parseMountOutput } from '../../src/macos-volume-roots.js';

/** What `/sbin/mount` prints on a Mac with an external disk, a network share and the system's own volumes. */
const MOUNT = [
  '/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)',
  'devfs on /dev (devfs, local, nobrowse)',
  '/dev/disk3s5 on /System/Volumes/Data (apfs, local, journaled, nobrowse, protect, root data)',
  '/dev/disk4s1 on /Volumes/Work Disk (apfs, local, nodev, nosuid, journaled, noowners)',
  '//dev@nas._smb._tcp.local/share on /Volumes/share (smbfs, nodev, nosuid, mounted by dev)',
  'nas:/export on /Volumes/nfs (nfs, nodev, nosuid, mounted by dev)',
].join('\n');

describe('MacosVolumeRoots (070 research R11)', () => {
  it('reads / and the volumes mounted under /Volumes, and which of them are network shares', () => {
    expect(parseMountOutput(MOUNT)).toEqual([
      { path: '/', network: false },
      { path: '/Volumes/Work Disk', network: false },
      { path: '/Volumes/share', network: true },
      { path: '/Volumes/nfs', network: true },
    ]);
  });

  it('passes the shared contract', async () => {
    const roots = new MacosVolumeRoots(async () => MOUNT);
    await roots.refreshed();
    runVolumeRootsContract({
      make: () => roots,
      localPaths: ['/Users/dev/p/a.txt', '/Users/dev/p/b.txt'],
      networkPath: '/Volumes/share/x/y.txt',
      otherVolumePath: '/Volumes/Work Disk/z',
    });
  });

  it('answers the deepest volume holding a path, and / before the table is read', async () => {
    const roots = new MacosVolumeRoots(async () => MOUNT);
    expect(roots.rootOf('/Volumes/share/x')).toBe('/');
    await roots.refreshed();
    expect(roots.rootOf('/Volumes/share/x')).toBe('/Volumes/share');
    expect(roots.rootOf('/Volumes/shared/x')).toBe('/');
    expect(roots.isNetwork('/Volumes/share')).toBe(true);
    expect(roots.isNetwork('/')).toBe(false);
  });

  it('keeps answering / when the table cannot be read', async () => {
    const roots = new MacosVolumeRoots(() => Promise.reject(new Error('mount failed')));
    await roots.refreshed();
    expect(roots.rootOf('/Volumes/share/x')).toBe('/');
  });
});

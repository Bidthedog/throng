import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IExecutableExtensions, IFileSystem, LinkResolution, LinkResolutionRequest } from '@throng/core';
import { SHIPPED_PREVIEW_PROVIDERS } from '@throng/core';
import { skipUnlessLinux } from '@throng/core/testing';
import { LinuxPathForms, LinuxVolumeRoots, parseMountInfo } from '@throng/platform-linux';
import { FileLinkResolver, type FileLinkResolverDeps } from '../../src/main/file-link-resolver.js';

const MOUNTINFO = [
  '24 1 8:1 / / rw,relatime shared:1 - ext4 /dev/sda1 rw',
  '30 24 8:2 / /data rw,relatime shared:2 - ext4 /dev/sda2 rw',
  '31 24 0:40 / /mnt/nas rw,relatime shared:3 - nfs4 server:/export rw',
  '32 24 0:41 / /mnt/my\\040share rw,relatime - cifs //server/share rw',
].join('\n');

describe('parseMountInfo', () => {
  it('reads mount points and types, unescaping a space, and tells network from local', () => {
    expect(parseMountInfo(MOUNTINFO)).toEqual([
      { path: '/', network: false },
      { path: '/data', network: false },
      { path: '/mnt/nas', network: true },
      { path: '/mnt/my share', network: true },
    ]);
  });

  it('skips what is not a mount line', () => {
    expect(parseMountInfo('nonsense\n\n')).toEqual([]);
  });
});

describe('LinuxVolumeRoots', () => {
  const roots = new LinuxVolumeRoots(() => MOUNTINFO, () => Promise.resolve(MOUNTINFO));

  it('answers the deepest mount, on a path boundary', () => {
    expect(roots.rootOf('/mnt/nas/a/b.txt')).toBe('/mnt/nas');
    expect(roots.rootOf('/mnt/nasty/b.txt')).toBe('/');
    expect(roots.rootOf('/data')).toBe('/data');
    expect(roots.rootOf('/home/u/x')).toBe('/');
  });

  it('knows which roots are network ones', () => {
    expect(roots.isNetwork('/mnt/nas')).toBe(true);
    expect(roots.isNetwork('/')).toBe(false);
  });

  it('falls back to the one root when the table cannot be read', () => {
    const blind = new LinuxVolumeRoots(() => {
      throw new Error('no /proc');
    });
    expect(blind.rootOf('/any/where')).toBe('/');
  });
});

describe.skipIf(skipUnlessLinux('the resolver joins these as POSIX paths'))('a stuck mount gates only itself (045 FR-121 on Linux)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a local path answers while an NFS mount is stuck', async () => {
    vi.useFakeTimers();
    const fs = {
      stat: (path: string) =>
        path.startsWith('/mnt/nas')
          ? new Promise(() => {})
          : path === '/home/u/p/b.txt'
            ? Promise.resolve({ kind: 'file' as const })
            : Promise.reject(new Error('ENOENT')),
    } as unknown as IFileSystem;
    const resolver = new FileLinkResolver({
      fs,
      pathForms: new LinuxPathForms(),
      executables: { isExecutable: () => false } as unknown as IExecutableExtensions,
      projectRootFor: () => '/home/u/p',
      previewRegistry: SHIPPED_PREVIEW_PROVIDERS,
      readPreviewSettings: () => ({ providers: {} }),
      volumes: new LinuxVolumeRoots(() => MOUNTINFO, () => Promise.resolve(MOUNTINFO)),
    } as unknown as FileLinkResolverDeps);
    const request = (text: string): LinkResolutionRequest => ({ text, kind: 'detectedPath', panelId: 'p1' });
    const settled = async (running: Promise<LinkResolution>): Promise<LinkResolution> => {
      let got: LinkResolution | undefined;
      void running.then((r) => (got = r));
      await vi.advanceTimersByTimeAsync(60_000);
      return got!;
    };

    expect(await settled(resolver.resolve(request('/mnt/nas/a.txt')))).toMatchObject({ ok: false, reason: 'unreachable' });
    expect(await settled(resolver.resolve(request('/home/u/p/b.txt')))).toMatchObject({ ok: true });
  });
});

/**
 * A link inside the project is "in the project" when the project root and the shell reach it by different
 * spellings of the same folder (045 FR-170 row 2: Open In ▸ is offered for a file in the project).
 *
 * Measured on a hosted macOS runner: the temp directory is `/var/folders/…`, a symlink to `/private/var/folders/…`.
 * The project root was stored as `/var/…`, the shell's working directory reported `/private/var/…`, and a detected
 * `./menu-target.txt` resolved under the latter — so the plain prefix test said "outside the project", and the
 * Link menu offered no Open In row.
 */
import { describe, expect, it } from 'vitest';
import type { IExecutableExtensions, IFileSystem, LinkResolutionRequest } from '@throng/core';
import { SHIPPED_PREVIEW_PROVIDERS } from '@throng/core';
import { skipUnlessLinux } from '@throng/core/testing';
import { LinuxPathForms } from '@throng/platform-linux';
import { FileLinkResolver, type FileLinkResolverDeps } from '../../src/main/file-link-resolver.js';

const ROOT = '/var/folders/xy/T/throng-proj';
const REAL_ROOT = '/private/var/folders/xy/T/throng-proj';

/** A filesystem where `/var` is a symlink to `/private/var`: every path exists under its real spelling. */
const fs = {
  stat: (path: string) =>
    path === `${REAL_ROOT}/menu-target.txt` || path === `${ROOT}/menu-target.txt`
      ? Promise.resolve({ kind: 'file' as const })
      : Promise.reject(new Error('ENOENT')),
  realpath: (path: string) => Promise.resolve(path.startsWith('/var/') ? `/private${path}` : path),
} as unknown as IFileSystem;

function resolverWith(root: string): FileLinkResolver {
  return new FileLinkResolver({
    fs,
    pathForms: new LinuxPathForms(),
    executables: { isExecutable: () => false } as unknown as IExecutableExtensions,
    projectRootFor: () => root,
    previewRegistry: SHIPPED_PREVIEW_PROVIDERS,
    readPreviewSettings: () => ({ providers: {} }),
  } as unknown as FileLinkResolverDeps);
}

const request = (baseDirectory: string): LinkResolutionRequest => ({
  text: './menu-target.txt',
  kind: 'detectedPath',
  panelId: 'p1',
  baseDirectory,
});

describe.skipIf(skipUnlessLinux('the resolver joins these as POSIX paths'))('a project reached through a symlink (045 FR-170)', () => {
  it('a file the shell names by the real path is in a project stored by the symlinked one', async () => {
    const answer = await resolverWith(ROOT).resolve(request(REAL_ROOT));
    expect(answer).toMatchObject({ ok: true, link: { kind: 'file', inProject: true } });
  });

  it('and a file outside the project stays outside it', async () => {
    const answer = await resolverWith('/var/folders/xy/T/other-proj').resolve(request(REAL_ROOT));
    expect(answer).toMatchObject({ ok: true, link: { kind: 'file', inProject: false } });
  });
});

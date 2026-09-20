import { describe, expect, it } from 'vitest';
import {
  SHIPPED_PREVIEW_PROVIDERS,
  normaliseForCompare,
  previewSettingsDefaults,
  type IFileSystem,
  type IPathForms,
  type LinkResolutionRequest,
} from '@throng/core';
import { FileLinkResolver, type FileLinkResolverDeps } from '../../src/main/file-link-resolver.js';
import { linkFirstReadingByName } from '../../src/renderer/links/path-by-name.js';

/**
 * REPRODUCTION — the readout and the title name a place the click does not go.
 *
 * Reported against round five, twice: `/tmp` reads out as the project's own folder and opens
 * `…\AppData\Local\Temp`; `/etc/hosts` reads out the same way and opens the Git installation's
 * `etc\hosts`. The maintainer's rule is one line — "Title links and status bar text should always
 * represent where the link will take the user to."
 *
 * WHY IT HAPPENS, and it is not an oversight. `linkFirstReadingByName` is the renderer's guess at a
 * link's first reading, made with NO disk and NO platform, because FR-155 requires drawing, hovering
 * and wording a link to cost nothing. Its step 3 sends any rooted path that is not a drive form to
 * the project root (FR-024). But `/tmp` and `/etc` are neither: they are entries in the POSIX layer's
 * MOUNT TABLE (FR-151), which only `IPathForms.fromMountTable` can read, and the resolver tries that
 * before the project-root reading. By name the two are indistinguishable from `/help`, which really
 * does read against the project root — so the guess is not merely unlucky here, it is undecidable.
 *
 * `path-by-name.ts`'s own header already names this class as NOT decidable and says such a path is
 * "shown AS WRITTEN rather than joined onto a base they do not mean — the failure this module exists
 * to stop is a readout naming a file the click will never open". That is exactly the failure below,
 * so the module states the right rule and step 3 does not implement it.
 *
 * The fixture is a hand-written `IPathForms` rather than the real Windows one: the mount table is
 * read from a Git installation's `etc\fstab`, and a test that asserts where `/tmp` goes must not
 * depend on which machine it runs on.
 */

const ROOT = 'D:\\proj';
const TEMP = 'C:\\Users\\dev\\AppData\\Local\\Temp';
const GIT = 'C:\\Program Files\\Git';

/** Git Bash as shipped: `/` at the install root, `/tmp` at the user's temp folder. */
const MOUNTS: readonly (readonly [string, string])[] = [
  ['/tmp', TEMP],
  ['/', GIT],
];

const DISK = new Map<string, 'file' | 'folder'>(
  [
    [ROOT, 'folder'],
    [`${ROOT}\\src`, 'folder'],
    [TEMP, 'folder'],
    [`${GIT}\\etc`, 'folder'],
    [`${GIT}\\etc\\hosts`, 'file'],
  ].map(([p, k]) => [normaliseForCompare(p!), k as 'file' | 'folder']),
);

const pathForms: IPathForms = {
  homeDirectory: () => 'C:\\Users\\dev',
  fromDriveForm: (p) => {
    const m = /^\/(?:mnt\/)?([A-Za-z])(?=[\\/])/.exec(p);
    return m === null ? null : `${m[1]!.toUpperCase()}:${p.slice(m[0].length).replace(/\//g, '\\')}`;
  },
  fromFileUrl: () => null,
  fromHomeForm: (p) => (p === '~' || p.startsWith('~/') ? `C:\\Users\\dev${p.slice(1).replace(/\//g, '\\')}` : null),
  fromMountTable: (p) => {
    if (!p.startsWith('/')) return null;
    for (const [point, target] of MOUNTS) {
      if (p === point) return target;
      const prefix = point === '/' ? '/' : `${point}/`;
      if (p.startsWith(prefix)) {
        const rest = p.slice(prefix.length).replace(/\//g, '\\');
        return rest.length === 0 ? target : `${target}\\${rest}`;
      }
    }
    return null;
  },
  qualifyRooted: (rooted, anchor) => {
    const volume = /^([A-Za-z]:)/.exec(anchor);
    return volume === null || !rooted.startsWith('/') ? null : `${volume[1]}${rooted.replace(/\//g, '\\')}`;
  },
  fileUrlLocalPath: () => null,
  loopbackFromFileUrl: () => null,
};

const resolver = new FileLinkResolver({
  fs: {
    stat: async (p: string) => {
      const kind = DISK.get(normaliseForCompare(p.replace(/[\\/]+/g, '\\')));
      if (kind === undefined) throw new Error('ENOENT');
      return { kind, isSymlink: false };
    },
  } as unknown as IFileSystem,
  pathForms,
  executables: { isExecutable: () => false },
  projectRootFor: () => ROOT,
  previewRegistry: SHIPPED_PREVIEW_PROVIDERS,
  readPreviewSettings: () => previewSettingsDefaults(SHIPPED_PREVIEW_PROVIDERS),
} as unknown as FileLinkResolverDeps);

const request = (text: string): LinkResolutionRequest => ({
  text,
  kind: 'detectedPath',
  baseDirectory: ROOT,
  panelId: 'terminal-1',
  originProjectId: 'project-1',
});

/** Where a Ctrl+click actually goes. */
async function opens(text: string): Promise<string | null> {
  const resolution = await resolver.resolve(request(text));
  return resolution.ok ? resolution.link.path : null;
}

/** What the status bar and the hover title say it goes to. */
const reads = (text: string): string =>
  linkFirstReadingByName({ text, projectRoot: ROOT, baseDirectory: ROOT });

describe('the readout names where the click goes (reported 2026-09-20)', () => {
  it('/tmp opens the temp folder, and reads out as itself rather than under the project', async () => {
    expect(await opens('/tmp')).toBe(TEMP);
    expect(reads('/tmp'), 'the readout must not name a folder the click will not open').toBe('/tmp');
  });

  it('/etc/hosts opens the Git installation, and reads out as itself', async () => {
    expect(await opens('/etc/hosts')).toBe(`${GIT}\\etc\\hosts`);
    expect(reads('/etc/hosts')).toBe('/etc/hosts');
  });

  /*
   * The one that proves the rule rather than the symptom. `/src` DOES resolve to the project root
   * here — the R6 reading exists on the fixture's disk — and it still reads out as written, because
   * by name it is the same shape as `/tmp` and this function is not allowed to know which it is.
   * Naming the project root for this one would mean naming it for `/tmp` too.
   */
  it('a rooted path that really is in the project also reads out as written', async () => {
    expect(await opens('/src')).toBe(`${ROOT}\\src`);
    expect(reads('/src')).toBe('/src');
  });

  /*
   * The controls, which are the reason the fix cannot simply be "show every rooted path as written".
   * A drive form and a relative path ARE decidable without a platform, and their readouts are right
   * today; a rooted path with no mount entry really does read against the project root.
   */
  it('a drive form still reads as the drive it names', () => {
    expect(reads('/d/git/x.ts')).toBe('D:\\git\\x.ts');
  });

  it('a relative path still reads against the base directory', () => {
    expect(reads('src/foo.ts')).toBe(`${ROOT}\\src\\foo.ts`);
  });

  it('an absolute path still reads as itself', () => {
    expect(reads('C:\\Windows\\win.ini')).toBe('C:\\Windows\\win.ini');
  });
});

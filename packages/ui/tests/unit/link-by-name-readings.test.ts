import { describe, expect, it } from 'vitest';
import { clickTargetByName, linkDestinationByName } from '../../src/renderer/links/click-by-name.js';
import { hoveredLinkReadoutText, type HoveredLink } from '../../src/renderer/terminal/hovered-link.js';

/**
 * 045 review round four, I1 and I2 — the two by-name judgements a surface makes about a link BEFORE
 * anything is resolved: the status bar's readout (FR-167a) and where the click will land (FR-168).
 *
 * Both used to treat every spelling that is not `X:\…` or `\\…` as RELATIVE, so a Git Bash drive form
 * was joined onto the terminal's working directory. FR-176 is explicit that `/d/git/x.ts` is
 * `D:\git\x.ts` — decidable from the text alone, which is why the by-name trade FR-168a/FR-168b
 * accepts does not cover it — and FR-024 makes the FIRST reading of any other rooted path the project
 * root, never the cwd.
 *
 * The readings pinned here are exactly `resolveCandidate`'s first entries
 * (`packages/core/src/links/resolve.ts`), minus the ones that need the platform's own knowledge: the
 * home folder (`~`) has no by-name reading at all, so the text stands as written rather than being
 * joined onto something it does not mean.
 */

const ROOT = 'D:\\git\\throng';
const CWD = 'D:\\git\\throng\\packages\\ui';

const hoveredPath = (text: string): HoveredLink => ({
  kind: 'file',
  request: { text, kind: 'detectedPath', panelId: 'p1', baseDirectory: CWD },
});

describe('the status-bar readout names the link’s FIRST reading (FR-167a, FR-176, FR-024)', () => {
  it('a Git Bash drive form maps to its drive, not onto the working directory', () => {
    expect(hoveredLinkReadoutText(hoveredPath('/d/git/x.ts'), CWD, ROOT)).toBe('D:\\git\\x.ts');
  });

  it('a WSL-style drive form maps the same way', () => {
    expect(hoveredLinkReadoutText(hoveredPath('/mnt/d/git/x.ts'), CWD, ROOT)).toBe('D:\\git\\x.ts');
  });

  it('a drive form naming a volume root keeps its root', () => {
    expect(hoveredLinkReadoutText(hoveredPath('/d/'), CWD, ROOT)).toBe('D:\\');
  });

  /*
   * Round five, reported 2026-09-20 — SUPERSEDES the project-root reading this case used to assert.
   *
   * It expected `/help` to read out as `D:\git\throng\help`, on R6/FR-024's authority that a rooted
   * path tries the project root FIRST. That is true of the ORDER and false as a destination: when
   * that reading does not exist, `resolveCandidate` falls through to the POSIX layer's mount table,
   * which is how `/tmp` read out under the project and opened the user's temp folder, and
   * `/etc/hosts` read out under the project and opened the Git installation's own `etc`.
   *
   * By name the three are one shape. A hover resolves nothing, so the readout cannot tell which of
   * them it has — and the maintainer's rule is that the readout always names where the click goes.
   * Naming nothing is the only honest answer, and the text as written is always true.
   */
  it('a rooted path that is NOT a drive form reads out AS WRITTEN (round five)', () => {
    expect(hoveredLinkReadoutText(hoveredPath('/help'), CWD, ROOT)).toBe('/help');
    // `/dev/null` is not a drive form — `dev` is not a single-letter volume.
    expect(hoveredLinkReadoutText(hoveredPath('/dev/null'), CWD, ROOT)).toBe('/dev/null');
    // FR-174's note: a bare `/d` names no drive, because no separator follows the volume.
    expect(hoveredLinkReadoutText(hoveredPath('/d'), CWD, ROOT)).toBe('/d');
    // The two reported cases, at this layer.
    expect(hoveredLinkReadoutText(hoveredPath('/tmp'), CWD, ROOT)).toBe('/tmp');
    expect(hoveredLinkReadoutText(hoveredPath('/etc/hosts'), CWD, ROOT)).toBe('/etc/hosts');
  });

  it('a home form is shown as written — the home folder is not knowable by name', () => {
    expect(hoveredLinkReadoutText(hoveredPath('~/notes.md'), CWD, ROOT)).toBe('~/notes.md');
    expect(hoveredLinkReadoutText(hoveredPath('~'), CWD, ROOT)).toBe('~');
  });

  it('a relative path still resolves against the base directory (R5, unchanged)', () => {
    expect(hoveredLinkReadoutText(hoveredPath('src\\foo.ts'), CWD, ROOT)).toBe(`${CWD}\\src\\foo.ts`);
    expect(hoveredLinkReadoutText(hoveredPath('..\\core\\foo.ts'), CWD, ROOT)).toBe('D:\\git\\throng\\packages\\core\\foo.ts');
  });

  it('an absolute spelling still stands for itself (unchanged)', () => {
    expect(hoveredLinkReadoutText(hoveredPath('D:\\other\\x.ts'), CWD, ROOT)).toBe('D:\\other\\x.ts');
    expect(hoveredLinkReadoutText(hoveredPath('\\\\fileserver\\home\\x.ts'), CWD, ROOT)).toBe(
      '\\\\fileserver\\home\\x.ts',
    );
  });

  it('with no base and no root, the text stands as written', () => {
    expect(hoveredLinkReadoutText(hoveredPath('/help'), null, null)).toBe('/help');
    expect(hoveredLinkReadoutText(hoveredPath('src/foo.ts'), null, null)).toBe('src/foo.ts');
  });
});

describe('the tooltip and the hint word a drive form by its DRIVE (FR-168, FR-176)', () => {
  it('a drive form outside the project shows in OS Explorer, not "throng"', () => {
    expect(clickTargetByName('/d/temp/scratch.txt', ROOT, CWD)).toBe('osExplorer');
    expect(
      linkDestinationByName({ text: '/d/temp/scratch.txt', projectRoot: ROOT, baseDirectory: CWD, openTarget: 'lastActive' }),
    ).toEqual({ kind: 'osExplorer' });
  });

  it('a drive form INSIDE the project opens in throng', () => {
    expect(clickTargetByName('/d/git/throng/README.md', ROOT, CWD)).toBe('editor');
  });

  it('a rooted non-drive path keeps its project-root reading (FR-024, unchanged)', () => {
    expect(clickTargetByName('/help', ROOT, CWD)).toBe('editor');
  });

  it('a relative path is unchanged by any of this (FR-168a, unchanged)', () => {
    expect(clickTargetByName('src/foo.ts', ROOT, CWD)).toBe('editor');
    expect(clickTargetByName('src/foo.ts', ROOT, 'C:\\elsewhere')).toBe('osExplorer');
  });
});

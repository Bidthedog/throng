import { describe, expect, it } from 'vitest';
import type { IPathForms } from '../../src/abstractions/path-forms.js';
import { detectPathCandidates } from '../../src/links/detect.js';
import { resolveCandidate } from '../../src/links/resolve.js';
import type { LinkCandidate } from '../../src/links/types.js';

/**
 * REPRODUCTION — "UNC paths do not seem to be working at all — I cannot click any network paths"
 * (maintainer, hands-on test of PR #408, spec 045 FR-003c).
 *
 * ══ WHERE A NETWORK PATH IS LOST ══
 *
 * Traced stage by stage against a real remote share (`\\fileserver\home`, `\\fileserver\public`) and a loopback
 * one (`\\localhost\D`), through the BUILT modules the app loads:
 *
 *   detection            `\\fileserver\home\projects`             -> one candidate          OK
 *   resolveCandidate     an ABSOLUTE UNC path                    -> itself                 OK
 *   NodeFileSystem.stat  the same                                -> folder, 1-8 ms         OK
 *   isLinkInProject      the same                                -> false, no throw        OK
 *   FileLinkResolver     the same                                -> { ok: true }           OK
 *
 *   resolveCandidate     `README.md` against a UNC BASE          -> `\localhost\D\...`     LOST
 *   FileLinkResolver     the same                                -> { ok: false }          LOST
 *
 * An absolute UNC path survives every stage. What does not survive is the UNC ROOT of a BASE: a
 * relative path joined onto `\\server\share\dir` comes out as `\server\share\dir\x` — ONE leading
 * separator, which Windows reads as a folder called `server` at the root of the current drive. It
 * never exists, so the path is never a link.
 *
 * That base is not exotic. It is every terminal whose working directory is a network folder (the
 * shell's own OSC 9;9 reports it as plain `\\fileserver\home`, via `ProviderPath`), every editor showing a
 * file that lives on a share, and every project whose root is one. In a PowerShell sitting in a
 * network folder, `dir` lists relative names — so nearly every path on screen is resolved against
 * exactly this base, and nearly every path on screen is dead.
 *
 * The fake `IPathForms` below is never consulted by these cases (none is a drive, home or `file:`
 * form); it is here because the context requires one.
 */

const fakePathForms: IPathForms = {
  homeDirectory: () => 'C:\\Users\\dev',
  fromDriveForm: () => null,
  fromFileUrl: () => null,
  fromHomeForm: () => null,
};

const candidate = (text: string): LinkCandidate => ({ text, start: 0, end: text.length });

describe('control — an ABSOLUTE network path already resolves to itself', () => {
  // Anti-vacuity: if this failed, the cases below would be failing for a different reason.
  it('in either separator', () => {
    expect(
      resolveCandidate(candidate('\\\\fileserver\\home\\notes.txt'), {
        projectRoot: null,
        pathForms: fakePathForms,
      }),
    ).toEqual(['\\\\fileserver\\home\\notes.txt']);
    expect(
      resolveCandidate(candidate('//fileserver/home/notes.txt'), {
        projectRoot: null,
        pathForms: fakePathForms,
      }),
    ).toEqual(['//fileserver/home/notes.txt']);
  });
});

describe('a relative path printed while the terminal is in a NETWORK folder (FR-023, R5)', () => {
  it('is looked for inside that network folder, not at a drive-rooted look-alike', () => {
    expect(
      resolveCandidate(candidate('notes.txt'), {
        baseDirectory: '\\\\fileserver\\home\\projects',
        projectRoot: null,
        pathForms: fakePathForms,
      }),
    ).toEqual(['\\\\fileserver\\home\\projects\\notes.txt']);
  });

  it('keeps the network root through a `..` step, too — `..` never pops the share (R12)', () => {
    expect(
      resolveCandidate(candidate('../public/notes.txt'), {
        baseDirectory: '\\\\fileserver\\home\\projects',
        projectRoot: null,
        pathForms: fakePathForms,
      }),
    ).toEqual(['\\\\fileserver\\home\\public\\notes.txt']);
    expect(
      resolveCandidate(candidate('../public/notes.txt'), {
        baseDirectory: '\\\\fileserver\\home',
        projectRoot: null,
        pathForms: fakePathForms,
      }),
    ).toEqual(['\\\\fileserver\\home\\public\\notes.txt']);
  });
});

describe('a relative path in an editor showing a file that lives on a share (FR-022)', () => {
  it('is looked for beside that file, on the share', () => {
    expect(
      resolveCandidate(candidate('docs/b.md'), {
        baseDirectory: '//fileserver/work/project',
        projectRoot: null,
        pathForms: fakePathForms,
      }),
    ).toEqual(['//fileserver/work/project/docs/b.md']);
  });
});

describe('a path in a project whose ROOT is a network share (R5, R6)', () => {
  it('a relative path is looked for under that network root', () => {
    expect(
      resolveCandidate(candidate('src/foo.ts'), {
        projectRoot: '\\\\fileserver\\work\\throng',
        pathForms: fakePathForms,
      }),
    ).toEqual(['\\\\fileserver\\work\\throng\\src\\foo.ts']);
  });

  it('a leading-slash path is looked for under that network root first (#394 `/test.txt`)', () => {
    expect(
      resolveCandidate(candidate('/test.txt'), {
        projectRoot: '\\\\fileserver\\work\\throng',
        pathForms: fakePathForms,
      })[0],
    ).toBe('\\\\fileserver\\work\\throng\\test.txt');
  });
});

describe('what PowerShell PRINTS for a network location (measured: 5.1.26100 and 7.6.2)', () => {
  /*
   * Both PowerShells print a network location PROVIDER-QUALIFIED — in the prompt, in `pwd`, in
   * `Resolve-Path`:
   *
   *   PS Microsoft.PowerShell.Core\FileSystem::\\fileserver\home>
   *
   * The whole of that is one whitespace token, it contains `::`, and the grammar refuses any token
   * with a colon it cannot place, so the network path inside it is never even a candidate. Only the
   * `Directory: \\fileserver\home\x` header of a listing prints the plain form.
   *
   * SEPARATE from the base-directory defect above, and listed for the maintainer's confirmation:
   * FR-003c names the plain UNC forms only, so whether this spelling must be recognised is a spec
   * decision, not something this test can settle on its own.
   */
  it('finds the network path inside the provider-qualified prompt', () => {
    const line = 'PS Microsoft.PowerShell.Core\\FileSystem::\\\\fileserver\\home\\projects> ';
    expect(detectPathCandidates(line, []).map((c) => c.text)).toContain(
      '\\\\fileserver\\home\\projects',
    );
  });
});

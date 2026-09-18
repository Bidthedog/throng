import { describe, expect, expectTypeOf, it } from 'vitest';
import { resolveDefaultLinkAction } from '../../src/links/default-action.js';
import type { ClickTarget } from '../../src/links/default-action.js';
import type { ResolvedLink } from '../../src/links/types.js';

/**
 * 045 FR-110, FR-111, FR-114 — `data-model.md` §13.1, the CLICK RULE.
 *
 * ══ REWRITTEN 2026-09-18 (T155), AS THE SUPERSESSIONS PERMIT ══
 *
 * This file used to pin `data-model.md` §4: a `setting` argument over FR-050's five values, FR-039's
 * executable override running first, and FR-053's fallback order. FR-110 – FR-112 retire all three.
 * What Ctrl+click, the Open Link chord and the plain Open Link item do for a FILE link is now fixed:
 *
 *   1. a folder                                          → `osExplorer`
 *   2. anything outside the project                      → `osExplorer`
 *   3. previewIsDefault, no position, an enabled preview  → `preview`
 *   4. otherwise                                         → `editor`
 *
 * `link.executable` is not read (FR-114): an in-project `deploy.ps1` opens as its TEXT. FR-111 — no
 * gesture and no plain Open Link item ever hands a file to the OS default program — is a property of
 * the RESULT TYPE, so it is asserted on the type as well as over every input.
 */

const link = (over: Partial<ResolvedLink> = {}): ResolvedLink => ({
  path: 'C:\\throng\\src\\foo.ts',
  kind: 'file',
  inProject: true,
  executable: false,
  preview: 'none',
  ...over,
});

const act = (over: {
  link?: ResolvedLink;
  hasPosition?: boolean;
  previewIsDefault?: boolean;
}): string =>
  resolveDefaultLinkAction({
    link: over.link ?? link(),
    hasPosition: over.hasPosition ?? false,
    previewIsDefault: over.previewIsDefault ?? false,
  } as Parameters<typeof resolveDefaultLinkAction>[0]);

const PREVIEWS = ['none', 'enabled', 'disabled'] as const;

describe('resolveDefaultLinkAction — clause 1: a folder shows in OS Explorer', () => {
  it('in the project and out of it, whatever else is true', () => {
    for (const inProject of [true, false]) {
      for (const hasPosition of [true, false]) {
        for (const previewIsDefault of [true, false]) {
          expect(
            act({ link: link({ kind: 'folder', inProject }), hasPosition, previewIsDefault }),
            `inProject=${inProject} position=${hasPosition} previewDefault=${previewIsDefault}`,
          ).toBe('osExplorer');
        }
      }
    }
  });
});

describe('resolveDefaultLinkAction — clause 2: an out-of-project file shows in OS Explorer', () => {
  it('for every file type — plain, previewable, executable — with or without a position', () => {
    const offenders: string[] = [];
    for (const preview of PREVIEWS) {
      for (const executable of [true, false]) {
        for (const hasPosition of [true, false]) {
          for (const previewIsDefault of [true, false]) {
            const got = act({
              link: link({ inProject: false, preview, executable }),
              hasPosition,
              previewIsDefault,
            });
            if (got !== 'osExplorer') {
              offenders.push(`${preview}/exe=${executable}/pos=${hasPosition}/pd=${previewIsDefault} -> ${got}`);
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('resolveDefaultLinkAction — clause 3: an in-project file opens its preview only when all three hold', () => {
  it('previewIsDefault, no position and an enabled provider → preview', () => {
    expect(act({ link: link({ preview: 'enabled' }), previewIsDefault: true })).toBe('preview');
  });

  it('a position always opens an editor (FR-052)', () => {
    expect(
      act({ link: link({ preview: 'enabled' }), previewIsDefault: true, hasPosition: true }),
    ).toBe('editor');
  });

  it('a file whose default open action is not Preview opens an editor', () => {
    expect(act({ link: link({ preview: 'enabled' }), previewIsDefault: false })).toBe('editor');
  });

  it('a disabled or absent provider opens an editor', () => {
    expect(act({ link: link({ preview: 'disabled' }), previewIsDefault: true })).toBe('editor');
    expect(act({ link: link({ preview: 'none' }), previewIsDefault: true })).toBe('editor');
  });
});

describe('resolveDefaultLinkAction — clause 4: any other in-project file opens an editor', () => {
  it('a plain in-project file', () => {
    expect(act({})).toBe('editor');
    expect(act({ hasPosition: true })).toBe('editor');
  });

  it('FR-114: an in-project EXECUTABLE opens in an editor as its text — it is not diverted', () => {
    expect(act({ link: link({ path: 'C:\\throng\\deploy.ps1', executable: true }) })).toBe('editor');
    expect(
      act({ link: link({ path: 'C:\\throng\\build.bat', executable: true }), hasPosition: true }),
    ).toBe('editor');
  });
});

describe('resolveDefaultLinkAction — FR-111: never the OS default program', () => {
  it('no input of any shape answers osDefaultProgram', () => {
    const offenders: string[] = [];
    for (const kind of ['file', 'folder'] as const) {
      for (const inProject of [true, false]) {
        for (const preview of PREVIEWS) {
          for (const executable of [true, false]) {
            for (const hasPosition of [true, false]) {
              for (const previewIsDefault of [true, false]) {
                const got = act({
                  link: link({ kind, inProject, preview, executable }),
                  hasPosition,
                  previewIsDefault,
                });
                if (!['editor', 'preview', 'osExplorer'].includes(got)) {
                  offenders.push(`${kind}/${inProject}/${preview}/exe=${executable} -> ${got}`);
                }
              }
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the result TYPE excludes osDefaultProgram, so the compiler holds FR-111 too', () => {
    expectTypeOf<ReturnType<typeof resolveDefaultLinkAction>>().toEqualTypeOf<ClickTarget>();
    expectTypeOf<ClickTarget>().toEqualTypeOf<'editor' | 'preview' | 'osExplorer'>();
    expectTypeOf<'osDefaultProgram'>().not.toMatchTypeOf<ClickTarget>();
  });

  it('takes no setting argument', () => {
    expectTypeOf<Parameters<typeof resolveDefaultLinkAction>[0]>().toEqualTypeOf<{
      readonly link: ResolvedLink;
      readonly hasPosition: boolean;
      readonly previewIsDefault: boolean;
    }>();
  });
});

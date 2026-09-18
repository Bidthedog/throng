import { describe, expect, it } from 'vitest';
import { DEFAULT_LINK_ACTIONS, resolveDefaultLinkAction } from '../../src/links/default-action.js';
import type { DefaultLinkAction } from '../../src/links/default-action.js';
import type { LinkTarget } from '../../src/links/targets.js';
import type { ResolvedLink } from '../../src/links/types.js';

/**
 * 045 FR-039, FR-050 – FR-055 — `data-model.md` §4.
 *
 * This is what Ctrl+click, the Open Link chord and the plain Open Link item all do (FR-054), so it
 * is the one function in the feature a user meets without choosing to. Its clauses are tested in
 * the order they apply, because the order IS the requirement: FR-039 runs first and overrides
 * everything, and moving it after the setting is how an `.exe` gets launched by a click.
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
  setting?: DefaultLinkAction;
  link?: ResolvedLink;
  hasPosition?: boolean;
  previewIsDefault?: boolean;
}): LinkTarget =>
  resolveDefaultLinkAction({
    setting: over.setting ?? 'throng',
    link: over.link ?? link(),
    hasPosition: over.hasPosition ?? false,
    previewIsDefault: over.previewIsDefault ?? false,
  });

describe('resolveDefaultLinkAction — clause 1: FR-039 first, and it overrides EVERYTHING', () => {
  const runnable = link({ executable: true });

  it('an executable goes to the OS file manager at every setting', () => {
    for (const setting of DEFAULT_LINK_ACTIONS) {
      expect(act({ setting, link: runnable })).toBe('osExplorer');
    }
  });

  it('SC-010: not even Open in OS Default Program as the SETTING runs it', () => {
    expect(act({ setting: 'osDefaultProgram', link: runnable })).toBe('osExplorer');
  });

  it('a position, a preview provider and project membership do not rescue it', () => {
    expect(
      act({ setting: 'throng', link: link({ executable: true, preview: 'enabled' }), previewIsDefault: true }),
    ).toBe('osExplorer');
    expect(act({ setting: 'editor', link: runnable, hasPosition: true })).toBe('osExplorer');
    expect(act({ setting: 'throng', link: link({ executable: true, inProject: false }) })).toBe(
      'osExplorer',
    );
  });
});

describe("resolveDefaultLinkAction — clause 2: 'throng' is preview only when BOTH conditions hold", () => {
  it('FR-051: preview when the file\u2019s default open action is Preview', () => {
    expect(act({ setting: 'throng', link: link({ preview: 'enabled' }), previewIsDefault: true })).toBe(
      'preview',
    );
  });

  it('FR-051: editor when the file\u2019s default open action is not Preview', () => {
    expect(act({ setting: 'throng', link: link({ preview: 'enabled' }), previewIsDefault: false })).toBe(
      'editor',
    );
  });

  it('FR-052: a position always opens an editor, whatever the default open action', () => {
    expect(
      act({
        setting: 'throng',
        link: link({ preview: 'enabled' }),
        previewIsDefault: true,
        hasPosition: true,
      }),
    ).toBe('editor');
  });

  it('a disabled provider cannot be the throng destination, so the fallback takes over', () => {
    expect(
      act({ setting: 'throng', link: link({ preview: 'disabled' }), previewIsDefault: true }),
    ).toBe('editor');
  });
});

describe('resolveDefaultLinkAction — clause 3: a named target is used when it is offered', () => {
  it('each named value performs itself for a link that offers it', () => {
    const l = link({ preview: 'enabled' });
    expect(act({ setting: 'editor', link: l })).toBe('editor');
    expect(act({ setting: 'preview', link: l })).toBe('preview');
    expect(act({ setting: 'osExplorer', link: l })).toBe('osExplorer');
    expect(act({ setting: 'osDefaultProgram', link: l })).toBe('osDefaultProgram');
  });

  it('the setting is ignored when the link does not offer that target', () => {
    // A folder offers neither the editor nor the default program.
    expect(act({ setting: 'editor', link: link({ kind: 'folder' }) })).toBe('osExplorer');
    expect(act({ setting: 'osDefaultProgram', link: link({ kind: 'folder' }) })).toBe('osExplorer');
  });
});

describe('resolveDefaultLinkAction — clause 4: FR-053\u2019s fallback order', () => {
  it('preview before editor', () => {
    expect(act({ setting: 'preview', link: link({ preview: 'enabled' }) })).toBe('preview');
    // `osDefaultProgram` is not offered for a folder, so this falls through the whole order.
    expect(act({ setting: 'osDefaultProgram', link: link({ preview: 'enabled' }) })).toBe(
      'osDefaultProgram',
    );
  });

  it('a DISABLED preview counts as not offered and the fallback moves on to the editor', () => {
    expect(act({ setting: 'preview', link: link({ preview: 'disabled' }) })).toBe('editor');
  });

  it('an out-of-project file falls past both throng targets to the OS default program', () => {
    expect(act({ setting: 'editor', link: link({ inProject: false }) })).toBe('osDefaultProgram');
    expect(act({ setting: 'preview', link: link({ inProject: false, preview: 'enabled' }) })).toBe(
      'osDefaultProgram',
    );
  });

  it('a folder falls all the way to the OS file manager', () => {
    expect(act({ setting: 'preview', link: link({ kind: 'folder' }) })).toBe('osExplorer');
  });

  it("an executable's fallback lands on the OS file manager, never the default program", () => {
    expect(act({ setting: 'preview', link: link({ executable: true, inProject: false }) })).toBe(
      'osExplorer',
    );
  });
});

describe('resolveDefaultLinkAction — FR-055 as a consequence, over every input there is', () => {
  it('no combination of setting, shape, position and executability reaches editor or preview for an out-of-project target', () => {
    const offenders: string[] = [];
    for (const setting of DEFAULT_LINK_ACTIONS) {
      for (const kind of ['file', 'folder'] as const) {
        for (const preview of ['none', 'enabled', 'disabled'] as const) {
          for (const executable of [true, false]) {
            for (const hasPosition of [true, false]) {
              for (const previewIsDefault of [true, false]) {
                const got = resolveDefaultLinkAction({
                  setting,
                  link: link({ kind, preview, executable, inProject: false }),
                  hasPosition,
                  previewIsDefault,
                });
                if (got === 'editor' || got === 'preview') {
                  offenders.push(`${setting}/${kind}/${preview}/exe=${executable} -> ${got}`);
                }
              }
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('SC-010: no input runs an executable, at any setting', () => {
    const offenders: string[] = [];
    for (const setting of DEFAULT_LINK_ACTIONS) {
      for (const inProject of [true, false]) {
        for (const preview of ['none', 'enabled', 'disabled'] as const) {
          const got = resolveDefaultLinkAction({
            setting,
            link: link({ executable: true, inProject, preview }),
            hasPosition: false,
            previewIsDefault: true,
          });
          if (got !== 'osExplorer') offenders.push(`${setting}/${inProject}/${preview} -> ${got}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('always answers a target that the link actually offers', () => {
    for (const setting of DEFAULT_LINK_ACTIONS) {
      for (const kind of ['file', 'folder'] as const) {
        for (const inProject of [true, false]) {
          const got = resolveDefaultLinkAction({
            setting,
            link: link({ kind, inProject }),
            hasPosition: false,
            previewIsDefault: false,
          });
          expect(got).not.toBe('preview');
          if (kind === 'folder') expect(got).toBe('osExplorer');
        }
      }
    }
  });
});

describe('DEFAULT_LINK_ACTIONS', () => {
  it('is FR-050\u2019s list, in FR-050\u2019s order, with the shipped value first', () => {
    expect([...DEFAULT_LINK_ACTIONS]).toEqual([
      'throng',
      'editor',
      'preview',
      'osExplorer',
      'osDefaultProgram',
    ]);
  });
});

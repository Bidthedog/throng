import { describe, expect, it, vi } from 'vitest';
import {
  buildLinkMenu,
  type LinkMenuApplicable,
  type LinkMenuContext,
  type LinkMenuItem,
  type ResolvedTarget,
} from '../../src/links/menu.js';

/**
 * 045 FR-169 – FR-171, FR-170a – FR-170c, FR-175 — the one Link menu (data-model §16.7, amended by
 * §16.11, §16.12, §16.16, §16.21 and §16.22).
 *
 * SC-025 asks for "exactly FR-170's items" in every surface, so each fixture asserts the WHOLE menu —
 * ids, labels, enablement and order — rather than probing for one row. The surfaces never filter:
 * `buildLinkMenu` alone decides every state, including `'pending'` (before main answers) and `null`
 * (did not resolve).
 *
 * Row numbers follow FR-170's table: 1 Open Link, 2 Open In ▸, 3 Open Preview, 4 Open in OS Explorer,
 * 5 Open in OS Default Program, 6 Open Program, 7 Copy Link to Clipboard.
 */

const noop = (): void => undefined;

const applicable = (over: Partial<LinkMenuApplicable> = {}): LinkMenuApplicable => ({
  inProjectByName: true,
  previewByExtension: 'none',
  executableByExtension: false,
  folderByGrammar: false,
  ...over,
});

const file = (over: Partial<ResolvedTarget> = {}): ResolvedTarget => ({
  kind: 'file',
  inProject: true,
  executable: false,
  preview: 'none',
  ...over,
});

const ctx = (over: Partial<LinkMenuContext> = {}): LinkMenuContext => ({
  cls: 'onDevice',
  resolution: file(),
  applicable: applicable(),
  openEditors: [],
  openLink: noop,
  ...over,
});

/** `label` for an enabled row, `label (disabled)` for a disabled one; Open In rows are prefixed. */
const shape = (items: readonly LinkMenuItem[]): string[] =>
  items.map(
    (i) =>
      `${i.submenu !== undefined ? `${i.submenu} ▸ ` : ''}${i.label}${i.disabled ? ' (disabled)' : ''}`,
  );

const menu = (over: Partial<LinkMenuContext> = {}): string[] => shape(buildLinkMenu(ctx(over)));

describe('buildLinkMenu — FR-170: the rows, in order, for every SC-025 fixture', () => {
  it('an in-project file with an enabled provider', () => {
    expect(
      menu({
        resolution: file({ preview: 'enabled' }),
        applicable: applicable({ previewByExtension: 'enabled' }),
      }),
    ).toEqual([
      'Open Link',
      'Open In ▸ New Editor',
      'Open In ▸ Active Editor',
      'Open Preview',
      'Open in OS Explorer',
      'Open in OS Default Program',
      'Copy Link to Clipboard',
    ]);
  });

  it('an in-project file whose provider is disabled draws Open Preview disabled (FR-030)', () => {
    expect(
      menu({
        resolution: file({ preview: 'disabled' }),
        applicable: applicable({ previewByExtension: 'disabled' }),
      }),
    ).toEqual([
      'Open Link',
      'Open In ▸ New Editor',
      'Open In ▸ Active Editor',
      'Open Preview (disabled)',
      'Open in OS Explorer',
      'Open in OS Default Program',
      'Copy Link to Clipboard',
    ]);
  });

  it('an in-project file no provider accepts draws no Open Preview at all', () => {
    expect(menu()).toEqual([
      'Open Link',
      'Open In ▸ New Editor',
      'Open In ▸ Active Editor',
      'Open in OS Explorer',
      'Open in OS Default Program',
      'Copy Link to Clipboard',
    ]);
  });

  it('an executable is offered Open Program and NOT Open in OS Default Program (FR-039a, S8)', () => {
    const got = menu({
      resolution: file({ executable: true }),
      applicable: applicable({ executableByExtension: true }),
    });
    expect(got).toEqual([
      'Open Link',
      'Open In ▸ New Editor',
      'Open In ▸ Active Editor',
      'Open in OS Explorer',
      'Open Program',
      'Copy Link to Clipboard',
    ]);
  });

  it('an out-of-project file has no Open In ▸ and no Open Preview', () => {
    expect(
      menu({
        resolution: file({ inProject: false, preview: 'enabled' }),
        applicable: applicable({ inProjectByName: false, previewByExtension: 'enabled' }),
      }),
    ).toEqual([
      'Open Link',
      'Open in OS Explorer',
      'Open in OS Default Program',
      'Copy Link to Clipboard',
    ]);
  });

  it('a link in the project by name that resolves OUTSIDE it loses rows 2 and 3 (R35, FR-168a)', () => {
    expect(
      menu({
        resolution: file({ inProject: false, preview: 'enabled' }),
        applicable: applicable({ inProjectByName: true, previewByExtension: 'enabled' }),
      }),
    ).toEqual([
      'Open Link',
      'Open in OS Explorer',
      'Open in OS Default Program',
      'Copy Link to Clipboard',
    ]);
  });

  it('a folder offers Open Link, Open in OS Explorer and Copy Link to Clipboard', () => {
    expect(
      menu({ resolution: { kind: 'folder', inProject: true, executable: false, preview: 'none' } }),
    ).toEqual(['Open Link', 'Open in OS Explorer', 'Copy Link to Clipboard']);
  });

  it('a UNC file is treated like an on-device one', () => {
    expect(menu({ cls: 'unc' })).toEqual(menu({ cls: 'onDevice' }));
  });

  for (const cls of ['web', 'loopback', 'protocol', 'anchor'] as const) {
    it(`a ${cls} link offers Open Link and Copy Link to Clipboard only`, () => {
      expect(
        menu({
          cls,
          resolution: null,
          applicable: applicable({
            inProjectByName: true,
            previewByExtension: 'enabled',
            executableByExtension: true,
          }),
        }),
      ).toEqual(['Open Link', 'Copy Link to Clipboard']);
    });
  }
});

describe('buildLinkMenu — Open In ▸ has one row per open editor, by name', () => {
  it('New Editor, Active Editor, then each open editor in the order given', () => {
    const items = buildLinkMenu(
      ctx({ openEditors: [{ id: 'e1', name: 'notes.md' }, { id: 'e2', name: 'main.ts' }] }),
    );
    const openIn = items.filter((i) => i.submenu === 'Open In');
    expect(openIn.map((i) => [i.id, i.label, i.editorId])).toEqual([
      ['openInNew', 'New Editor', undefined],
      ['openInActive', 'Active Editor', undefined],
      ['openInEditor', 'notes.md', 'e1'],
      ['openInEditor', 'main.ts', 'e2'],
    ]);
  });

  it('the Open In rows are contiguous and sit between Open Link and the rest', () => {
    const items = buildLinkMenu(ctx({ openEditors: [{ id: 'e1', name: 'a' }] }));
    expect(items.map((i) => i.id).slice(0, 4)).toEqual([
      'openLink',
      'openInNew',
      'openInActive',
      'openInEditor',
    ]);
  });
});

describe('buildLinkMenu — FR-170a: an unresolved link draws its applicable rows DISABLED', () => {
  it('in the project by name, a previewable non-executable: rows 2, 3 and 5 disabled, 4 enabled', () => {
    expect(
      menu({
        resolution: null,
        applicable: applicable({ previewByExtension: 'enabled' }),
        openEditors: [{ id: 'e1', name: 'x.ts' }],
      }),
    ).toEqual([
      'Open Link',
      'Open In ▸ New Editor (disabled)',
      'Open In ▸ Active Editor (disabled)',
      'Open In ▸ x.ts (disabled)',
      'Open Preview (disabled)',
      'Open in OS Explorer',
      'Open in OS Default Program (disabled)',
      'Copy Link to Clipboard',
    ]);
  });

  it('an executable by extension draws Open Program disabled instead of the default program', () => {
    expect(
      menu({
        resolution: null,
        applicable: applicable({ inProjectByName: false, executableByExtension: true }),
      }),
    ).toEqual([
      'Open Link',
      'Open in OS Explorer',
      'Open Program (disabled)',
      'Copy Link to Clipboard',
    ]);
  });

  it('no provider accepts the extension → no Open Preview, even disabled', () => {
    expect(menu({ resolution: null }).some((l) => l.startsWith('Open Preview'))).toBe(false);
  });
});

describe("buildLinkMenu — FR-170c: 'pending' draws only the renderer-known rows", () => {
  it('in the project by name: rows 2 and 3 disabled, rows 5 and 6 NOT drawn', () => {
    expect(
      menu({
        resolution: 'pending',
        applicable: applicable({ previewByExtension: 'enabled', executableByExtension: true }),
      }),
    ).toEqual([
      'Open Link',
      'Open In ▸ New Editor (disabled)',
      'Open In ▸ Active Editor (disabled)',
      'Open Preview (disabled)',
      'Open in OS Explorer',
      'Copy Link to Clipboard',
    ]);
  });

  it('out of the project by name: Open Link, Open in OS Explorer, Copy Link to Clipboard', () => {
    expect(
      menu({ resolution: 'pending', applicable: applicable({ inProjectByName: false }) }),
    ).toEqual(['Open Link', 'Open in OS Explorer', 'Copy Link to Clipboard']);
  });

  it('a row that could never apply is not drawn even for a moment (an in-project .ts: no preview)', () => {
    expect(menu({ resolution: 'pending' }).some((l) => l.startsWith('Open Preview'))).toBe(false);
  });

  it('a web link while pending is still Open Link and Copy Link to Clipboard only', () => {
    expect(menu({ cls: 'web', resolution: 'pending' })).toEqual([
      'Open Link',
      'Copy Link to Clipboard',
    ]);
  });
});

describe('buildLinkMenu — a folder by grammar never draws Open In ▸ or Open Preview (FR-168b, §16.16)', () => {
  it("while 'pending'", () => {
    expect(
      menu({
        resolution: 'pending',
        applicable: applicable({ folderByGrammar: true, previewByExtension: 'enabled' }),
      }),
    ).toEqual(['Open Link', 'Open in OS Explorer', 'Copy Link to Clipboard']);
  });

  it('with its synthesised folder resolution (§16.22)', () => {
    expect(
      menu({
        resolution: { kind: 'folder', inProject: true, executable: false, preview: 'none' },
        applicable: applicable({ folderByGrammar: true }),
      }),
    ).toEqual(['Open Link', 'Open in OS Explorer', 'Copy Link to Clipboard']);
  });

  it('even if handed null, rows 2, 3, 5 and 6 stay absent', () => {
    expect(
      menu({
        resolution: null,
        applicable: applicable({ folderByGrammar: true, previewByExtension: 'enabled' }),
      }),
    ).toEqual(['Open Link', 'Open in OS Explorer', 'Copy Link to Clipboard']);
  });
});

describe('buildLinkMenu — Copy Link to Clipboard (FR-175, constitution 5.5.2)', () => {
  it("is labelled 'Copy Link to Clipboard' with id 'copyLink', last and enabled in every state", () => {
    for (const resolution of [file(), null, 'pending' as const]) {
      const items = buildLinkMenu(ctx({ resolution }));
      const last = items[items.length - 1]!;
      expect([last.id, last.label, last.disabled]).toEqual([
        'copyLink',
        'Copy Link to Clipboard',
        false,
      ]);
    }
  });

  it('no item carries the retired id (FR-175; the retired label is pinned negatively above by every fixture asserting the exact one)', () => {
    const items = buildLinkMenu(ctx({ resolution: file({ preview: 'enabled' }) }));
    expect(items.some((i) => (i.id as string) === 'copyLinkAddress')).toBe(false);
  });
});

describe("buildLinkMenu — Open Link runs the surface's own Ctrl+click (§16.11, FR-169)", () => {
  it('is first, enabled, and its run invokes the context openLink', () => {
    const openLink = vi.fn();
    const first = buildLinkMenu(ctx({ openLink }))[0]!;
    expect([first.id, first.label, first.disabled]).toEqual(['openLink', 'Open Link', false]);
    first.run?.();
    expect(openLink).toHaveBeenCalledTimes(1);
  });

  it('is enabled even when the link did not resolve', () => {
    expect(buildLinkMenu(ctx({ resolution: null }))[0]!.disabled).toBe(false);
  });
});

describe('buildLinkMenu — the chord, only where bound (FR-169 note, FR-046)', () => {
  it('shows the chord on Open Link when the surface passes one', () => {
    expect(buildLinkMenu(ctx({ chord: 'Ctrl+Enter' }))[0]!.shortcut).toBe('Ctrl+Enter');
  });

  it('shows none when the surface passes none (the terminal)', () => {
    expect(buildLinkMenu(ctx())[0]!.shortcut).toBeUndefined();
  });

  it('an empty chord is no chord', () => {
    expect(buildLinkMenu(ctx({ chord: '' }))[0]!.shortcut).toBeUndefined();
  });

  it('never puts the chord on any other row', () => {
    const items = buildLinkMenu(
      ctx({ chord: 'Ctrl+Enter', openEditors: [{ id: 'e', name: 'e' }] }),
    );
    for (const item of items.slice(1)) expect(item.shortcut).toBeUndefined();
  });
});

describe('buildLinkMenu — sections (FR-169, Principle VI)', () => {
  it('every row declares the contextual section, in every state', () => {
    for (const resolution of [file({ preview: 'enabled' }), null, 'pending' as const]) {
      for (const item of buildLinkMenu(ctx({ resolution }))) expect(item.section).toBe('contextual');
    }
  });
});

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
 *
 * 081 FR-053 moved rows 2 – 6 of a LOCAL file or folder (`onDevice`) into the File Explorer's Open In ▸, which
 * the renderer builds from the one `openIn` item's target state; the last describe block covers that. FR-054
 * keeps a UNC link's menu as 045 drew it, so the FR-170 fixtures below run on `unc`.
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
  cls: 'unc',
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
      'Find in File Explorer',
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
      'Find in File Explorer',
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
      'Find in File Explorer',
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
      'Find in File Explorer',
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

  it('an in-project folder offers Open Link, Find in File Explorer, Open in OS Explorer and Copy Link to Clipboard', () => {
    expect(
      menu({ resolution: { kind: 'folder', inProject: true, executable: false, preview: 'none' } }),
    ).toEqual(['Open Link', 'Find in File Explorer', 'Open in OS Explorer', 'Copy Link to Clipboard']);
  });

  it('a UNC file keeps these rows; an on-device one draws Open In ▸ from its target state instead (081 FR-053, FR-054)', () => {
    expect(menu({ cls: 'onDevice' })).not.toEqual(menu({ cls: 'unc' }));
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
      'Find in File Explorer (disabled)',
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
      'Find in File Explorer (disabled)',
      'Open in OS Explorer',
      'Copy Link to Clipboard',
    ]);
  });

  it('out of the project by name: Open Link, Open in OS Explorer, Copy Link to Clipboard (no Find in File Explorer)', () => {
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
    ).toEqual(['Open Link', 'Find in File Explorer (disabled)', 'Open in OS Explorer', 'Copy Link to Clipboard']);
  });

  it('with its synthesised folder resolution (§16.22)', () => {
    expect(
      menu({
        resolution: { kind: 'folder', inProject: true, executable: false, preview: 'none' },
        applicable: applicable({ folderByGrammar: true }),
      }),
    ).toEqual(['Open Link', 'Find in File Explorer', 'Open in OS Explorer', 'Copy Link to Clipboard']);
  });

  it('even if handed null, rows 2, 3, 5 and 6 stay absent', () => {
    expect(
      menu({
        resolution: null,
        applicable: applicable({ folderByGrammar: true, previewByExtension: 'enabled' }),
      }),
    ).toEqual(['Open Link', 'Find in File Explorer (disabled)', 'Open in OS Explorer', 'Copy Link to Clipboard']);
  });
});

describe('buildLinkMenu — Find in File Explorer (#714)', () => {
  const folder = (over: Partial<ResolvedTarget> = {}): ResolvedTarget => ({
    kind: 'folder',
    inProject: true,
    executable: false,
    preview: 'none',
    ...over,
  });
  const find = (over: Partial<LinkMenuContext> = {}): LinkMenuItem | undefined =>
    buildLinkMenu(ctx(over)).find((i) => i.id === 'findInExplorer');

  it('an in-project file draws it enabled, immediately before Open in OS Explorer', () => {
    const items = buildLinkMenu(ctx());
    const at = items.findIndex((i) => i.id === 'findInExplorer');
    expect(at).toBeGreaterThan(0);
    expect(items[at + 1]!.id).toBe('osExplorer');
    expect([items[at]!.label, items[at]!.disabled, items[at]!.section]).toEqual([
      'Find in File Explorer',
      false,
      'contextual',
    ]);
  });

  it('an in-project folder draws it enabled', () => {
    expect(find({ resolution: folder() })?.disabled).toBe(false);
  });

  it('a folder by grammar in the project draws it enabled', () => {
    expect(
      find({ resolution: folder(), applicable: applicable({ folderByGrammar: true }) })?.disabled,
    ).toBe(false);
  });

  it('a file or folder that resolves outside the project draws none', () => {
    expect(find({ resolution: file({ inProject: false }) })).toBeUndefined();
    expect(find({ resolution: folder({ inProject: false }) })).toBeUndefined();
  });

  it("'pending' or unresolved, in the project by name: drawn disabled (FR-170a, FR-170c)", () => {
    expect(find({ resolution: 'pending' })?.disabled).toBe(true);
    expect(find({ resolution: null })?.disabled).toBe(true);
  });

  it("'pending' or unresolved, out of the project by name: not drawn", () => {
    const outside = applicable({ inProjectByName: false });
    expect(find({ resolution: 'pending', applicable: outside })).toBeUndefined();
    expect(find({ resolution: null, applicable: outside })).toBeUndefined();
  });

  for (const cls of ['web', 'loopback', 'protocol', 'anchor'] as const) {
    it(`a ${cls} link never draws it, whatever the resolution says`, () => {
      expect(find({ cls, resolution: file() })).toBeUndefined();
    });
  }
});

describe('buildLinkMenu — FR-170e (#719): a binary file is offered no editor', () => {
  const NO_EDITOR = [
    'Open Link',
    'Open Preview (disabled)',
    'Find in File Explorer',
    'Open in OS Explorer',
    'Open in OS Default Program',
    'Copy Link to Clipboard',
  ];

  it('resolved as binary: no Open In ▸ row, every other row as for any file', () => {
    expect(
      menu({
        resolution: file({ preview: 'disabled', binary: true }),
        applicable: applicable({ previewByExtension: 'disabled' }),
        openEditors: [{ id: 'e1', name: 'notes.md' }],
      }),
    ).toEqual(NO_EDITOR);
  });

  it('binary by extension: no Open In ▸ once resolved, even if the resolution does not say so', () => {
    expect(
      menu({
        resolution: file({ preview: 'disabled' }),
        applicable: applicable({ previewByExtension: 'disabled', binaryByExtension: true }),
      }),
    ).toEqual(NO_EDITOR);
  });

  it("binary by extension, 'pending' or unresolved: no Open In ▸ even disabled", () => {
    for (const resolution of ['pending', null] as const) {
      const rows = menu({
        resolution,
        applicable: applicable({ previewByExtension: 'disabled', binaryByExtension: true }),
      });
      expect(rows.some((r) => r.startsWith('Open In ▸'))).toBe(false);
      expect(rows).toContain('Open Preview (disabled)');
    }
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

describe('buildLinkMenu — a local file or folder: one Open In ▸ item carrying its target state (081 FR-050 – FR-053)', () => {
  const local = (over: Partial<LinkMenuContext> = {}): LinkMenuContext => ctx({ cls: 'onDevice', ...over });
  /** The Open In item reads as its state; every other row as `shape` draws it. */
  const rows = (over: Partial<LinkMenuContext> = {}): string[] =>
    buildLinkMenu(local(over)).map((i) =>
      i.id === 'openIn' && i.openIn !== undefined
        ? `Open In ▸ ${i.openIn.kind}, ${i.openIn.inProject ? 'in project' : 'outside the project'}${i.openIn.binary ? ', binary' : ''}${i.openIn.pending ? ', pending' : ''}`
        : shape([i])[0]!,
    );

  it('an in-project file: Open Link, Open In ▸, Find in File Explorer, Copy Link to Clipboard', () => {
    expect(rows({ resolution: file({ preview: 'enabled' }), applicable: applicable({ previewByExtension: 'enabled' }) })).toEqual([
      'Open Link',
      'Open In ▸ file, in project',
      'Find in File Explorer',
      'Copy Link to Clipboard',
    ]);
  });

  it('no Open Preview, Open in OS Explorer, Open in OS Default Program or Open Program row at the top level', () => {
    for (const resolution of [file({ executable: true, preview: 'enabled' }), null, 'pending' as const]) {
      const ids = buildLinkMenu(local({ resolution, applicable: applicable({ executableByExtension: true }) })).map((i) => i.id);
      for (const gone of ['openPreview', 'osExplorer', 'osDefaultProgram', 'openProgram', 'openInNew', 'openInActive', 'openInEditor'])
        expect(ids).not.toContain(gone);
    }
  });

  it('a file that resolves outside the project: no Find in File Explorer, and the state says outside', () => {
    expect(rows({ resolution: file({ inProject: false }) })).toEqual([
      'Open Link',
      'Open In ▸ file, outside the project',
      'Copy Link to Clipboard',
    ]);
  });

  it('a folder, resolved or by grammar', () => {
    const folder: ResolvedTarget = { kind: 'folder', inProject: true, executable: false, preview: 'none' };
    for (const app of [applicable(), applicable({ folderByGrammar: true })]) {
      expect(rows({ resolution: folder, applicable: app })).toEqual([
        'Open Link',
        'Open In ▸ folder, in project',
        'Find in File Explorer',
        'Copy Link to Clipboard',
      ]);
    }
  });

  it("'pending' and unresolved read from the name: pending, in the project by name, Find in File Explorer disabled", () => {
    for (const resolution of ['pending', null] as const) {
      expect(rows({ resolution })).toEqual([
        'Open Link',
        'Open In ▸ file, in project, pending',
        'Find in File Explorer (disabled)',
        'Copy Link to Clipboard',
      ]);
      expect(rows({ resolution, applicable: applicable({ inProjectByName: false }) })).toEqual([
        'Open Link',
        'Open In ▸ file, outside the project, pending',
        'Copy Link to Clipboard',
      ]);
    }
  });

  it('a binary file, by extension before main answers or by the answer after (FR-170e)', () => {
    expect(rows({ resolution: 'pending', applicable: applicable({ binaryByExtension: true }) })[1]).toBe(
      'Open In ▸ file, in project, binary, pending',
    );
    expect(rows({ resolution: file({ binary: true }) })[1]).toBe('Open In ▸ file, in project, binary');
    expect(rows({ resolution: file(), applicable: applicable({ binaryByExtension: true }) })[1]).toBe(
      'Open In ▸ file, in project, binary',
    );
  });

  it('the Open In item is enabled in every state: OS File Explorer inside it needs no answer', () => {
    for (const resolution of [file(), null, 'pending' as const]) {
      expect(buildLinkMenu(local({ resolution })).find((i) => i.id === 'openIn')?.disabled).toBe(false);
    }
  });
});

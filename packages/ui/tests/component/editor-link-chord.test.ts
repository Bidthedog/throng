import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import type { LinkResolution, LinkResolutionRequest, ResolvedLink } from '@throng/core';
import {
  followLinkAtCaret,
  type EditorLinkDeps,
  type EditorLinkHit,
} from '../../src/renderer/editor/link-decorations.js';

/**
 * 045 FR-044, FR-045 — the Open Link chord in an editor (T094): G8 and G9 of
 * `contracts/menus-and-gestures.md` §3.
 *
 * ══ THE RETURN VALUE IS THE WHOLE OF G9 ══
 *
 * Ctrl+Enter in a CodeMirror editor already inserts a blank line, and FR-044 keeps that everywhere
 * but inside a link. The window handler that dispatches `preview.followLink` calls `preventDefault`
 * only when this function answers `true`; when it answers `false` the keypress carries on to
 * CodeMirror's `defaultKeymap` and does exactly what it did before. So "unchanged" is not a second
 * behaviour written here — it is what happens when nothing claims the key, and the only thing worth
 * asserting is that nothing claims it.
 *
 * ══ WHY A SELECTION AND A SECOND CARET DISQUALIFY ══
 *
 * Both are states in which the user is plainly doing something else. With a selection the chord is
 * about the selected text; with two carets it is about both of them, and following one link would
 * be an answer to a question nobody asked. FR-044 says "a single caret inside a file link and no
 * selection" and each of those three clauses has a case below.
 */

const DOC = 'see src/foo.ts here\nand nothing on this line\n';
const LINK_FROM = DOC.indexOf('src/foo.ts');
const LINK_TO = LINK_FROM + 'src/foo.ts'.length;

const resolved: ResolvedLink = {
  path: 'D:\\project\\src\\foo.ts',
  kind: 'file',
  inProject: true,
  executable: false,
  preview: 'none',
};

function deps(): EditorLinkDeps & { followed: EditorLinkHit[] } {
  const followed: EditorLinkHit[] = [];
  return {
    followed,
    site: () => ({ panelId: 'panel-1', originProjectId: 'project-1' }),
    ask: vi.fn(
      (request: LinkResolutionRequest): LinkResolution | undefined =>
        request.text === 'src/foo.ts' ? { ok: true, link: resolved } : { ok: false },
    ),
    follow: (hit) => followed.push(hit),
  };
}

function view(selection: EditorSelection): { state: EditorState; visibleRanges: never[] } {
  return {
    state: EditorState.create({
      doc: DOC,
      selection,
      extensions: [EditorState.allowMultipleSelections.of(true)],
    }),
    visibleRanges: [],
  };
}

describe('G8 — a single caret inside a link follows it (FR-044)', () => {
  it('follows, and says it claimed the key', () => {
    const d = deps();
    expect(followLinkAtCaret(view(EditorSelection.cursor(LINK_FROM + 3)), d)).toBe(true);
    expect(d.followed).toHaveLength(1);
    expect(d.followed[0]!.link.path).toBe(resolved.path);
  });

  it('counts a caret at either edge of the link as inside it', () => {
    for (const pos of [LINK_FROM, LINK_TO]) {
      const d = deps();
      expect(followLinkAtCaret(view(EditorSelection.cursor(pos)), d), `at ${pos}`).toBe(true);
    }
  });

  it('works regardless of the visible range — the caret is not a viewport question', () => {
    const d = deps();
    expect(followLinkAtCaret(view(EditorSelection.cursor(LINK_FROM + 1)), d)).toBe(true);
  });
});

describe('G9 — anywhere else the chord keeps its editor meaning (FR-044)', () => {
  it('a caret outside every link claims nothing', () => {
    const d = deps();
    expect(followLinkAtCaret(view(EditorSelection.cursor(DOC.indexOf('and nothing'))), d)).toBe(
      false,
    );
    expect(d.followed).toEqual([]);
  });

  it('a SELECTION claims nothing, even when it lies inside a link', () => {
    const d = deps();
    expect(
      followLinkAtCaret(view(EditorSelection.range(LINK_FROM, LINK_FROM + 4)), d),
    ).toBe(false);
    expect(d.followed).toEqual([]);
  });

  it('TWO carets claim nothing, even with one of them inside a link', () => {
    const d = deps();
    const selection = EditorSelection.create(
      [EditorSelection.cursor(LINK_FROM + 2), EditorSelection.cursor(DOC.length - 1)],
      0,
    );
    expect(followLinkAtCaret(view(selection), d)).toBe(false);
    expect(d.followed).toEqual([]);
  });

  it('a caret inside a path that does not RESOLVE claims nothing (FR-006)', () => {
    const doc = 'see nope/missing.ts here';
    const d = deps();
    const state = EditorState.create({ doc, selection: EditorSelection.cursor(6) });
    expect(followLinkAtCaret({ state, visibleRanges: [] }, d)).toBe(false);
    expect(d.followed).toEqual([]);
  });
});

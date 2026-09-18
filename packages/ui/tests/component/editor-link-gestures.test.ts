import { EditorState, type TransactionSpec } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BINDING_PLATFORM,
  shippedBindingsFor,
  type LinkResolution,
  type LinkResolutionRequest,
  type ResolvedLink,
} from '@throng/core';
import {
  createLinkPointerHandlers,
  linkModifierFromChord,
  linkModifierName,
  type EditorLinkDeps,
  type EditorLinkHit,
} from '../../src/renderer/editor/link-decorations.js';

/**
 * 045 FR-040, FR-041 — the pointer gestures in an editor (T092): G1, G3 and G4 of
 * `contracts/menus-and-gestures.md` §3.
 *
 * ══ G4 IS THE ONE THAT DECIDES THE DESIGN ══
 *
 * Ctrl+click in a CodeMirror editor ALREADY means something: it adds a cursor. That is not a
 * behaviour this feature may quietly take away, and FR-041 says so — anywhere but over a link, the
 * gesture keeps the meaning it has today. So the handler claims the event only when the modifier is
 * held AND the position lands inside a resolved link, and returns false otherwise, at which point
 * CodeMirror's own multi-cursor handler runs and G4 holds by default rather than by imitation.
 *
 * ══ AND G3 IS WHY THE FOLLOW HAPPENS ON MOUSEUP ══
 *
 * FR-040: a Ctrl+click that DRAGS selects. Following on mousedown would make a drag that happens to
 * begin on a link open the file instead of selecting — so the press is claimed, the position is
 * remembered, and the release decides: a release where the press was is a click, and a release
 * anywhere else is a drag, which selects from one to the other. Claiming the press is what keeps
 * CodeMirror from adding a cursor under the drag; performing the selection ourselves is the price of
 * having claimed it.
 *
 * ══ THE MODIFIER IS NOT SPELLED `Ctrl` HERE ══
 *
 * FR-040's "Cmd on macOS" clause has exactly one home: the shipped binding for the Open Link
 * command. Writing `ctrlKey` into this handler would be a second place for the platform answer to
 * live, and the two would disagree the day macOS bindings are added.
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

class FakeView {
  state = EditorState.create({ doc: DOC });
  readonly dispatched: TransactionSpec[] = [];
  readonly visibleRanges = [{ from: 0, to: DOC.length }];
  /** What `posAtCoords` answers next — jsdom measures nothing, so the position is supplied. */
  posAt: number | null = LINK_FROM + 2;

  dispatch(spec: TransactionSpec): void {
    this.dispatched.push(spec);
    this.state = this.state.update(spec).state;
  }

  posAtCoords(): number | null {
    return this.posAt;
  }
}

function deps(): EditorLinkDeps & { followed: EditorLinkHit[] } {
  const followed: EditorLinkHit[] = [];
  return {
    followed,
    site: () => ({ panelId: 'panel-1', originProjectId: 'project-1', baseDirectory: 'D:\\p' }),
    ask: vi.fn(
      (request: LinkResolutionRequest): LinkResolution | undefined =>
        request.text === 'src/foo.ts' ? { ok: true, link: resolved } : { ok: false },
    ),
    follow: (hit) => followed.push(hit),
  };
}

const press = (over: Partial<MouseEvent> = {}): MouseEvent =>
  ({ button: 0, ctrlKey: true, metaKey: false, clientX: 100, clientY: 50, ...over }) as MouseEvent;

describe('G1 — Ctrl+click over a resolved link follows it (FR-040)', () => {
  it('claims the press and follows on the release', () => {
    const d = deps();
    const view = new FakeView();
    const handlers = createLinkPointerHandlers(d);

    expect(handlers.mousedown(press(), view)).toBe(true);
    expect(d.followed, 'nothing happens until the button comes back up').toEqual([]);

    handlers.mouseup(press(), view);

    expect(d.followed).toHaveLength(1);
    expect(d.followed[0]!.link.path).toBe(resolved.path);
    expect(d.followed[0]!.request.text).toBe('src/foo.ts');
  });

  it('adds no cursor and dispatches nothing for a plain click-through', () => {
    const d = deps();
    const view = new FakeView();
    const handlers = createLinkPointerHandlers(d);
    handlers.mousedown(press(), view);
    handlers.mouseup(press(), view);

    expect(view.dispatched).toEqual([]);
  });
});

describe('G4 — Ctrl+click anywhere else is unchanged (FR-041)', () => {
  it('does not claim the press when the position is outside every link', () => {
    const d = deps();
    const view = new FakeView();
    view.posAt = DOC.indexOf('and nothing');

    expect(createLinkPointerHandlers(d).mousedown(press(), view)).toBe(false);
    expect(d.followed).toEqual([]);
  });

  it('does not claim a press CodeMirror could not place at all', () => {
    const d = deps();
    const view = new FakeView();
    view.posAt = null;

    expect(createLinkPointerHandlers(d).mousedown(press(), view)).toBe(false);
  });
});

describe('G2 — a plain click keeps its ordinary meaning (FR-040)', () => {
  it('is not claimed and follows nothing, even over a link', () => {
    const d = deps();
    const handlers = createLinkPointerHandlers(d);
    const view = new FakeView();

    expect(handlers.mousedown(press({ ctrlKey: false }), view)).toBe(false);
    handlers.mouseup(press({ ctrlKey: false }), view);
    expect(d.followed).toEqual([]);
  });

  it('a right-click over a link is not a follow either — the menu is its own route', () => {
    const d = deps();
    expect(createLinkPointerHandlers(d).mousedown(press({ button: 2 }), new FakeView())).toBe(false);
  });
});

describe('G3 — a Ctrl+click that DRAGS selects (FR-040, Principle VI)', () => {
  it('selects from the press to the release instead of following', () => {
    const d = deps();
    const view = new FakeView();
    const handlers = createLinkPointerHandlers(d);

    handlers.mousedown(press(), view);
    view.posAt = LINK_TO + 4;
    handlers.mouseup(press({ clientX: 260, clientY: 50 }), view);

    expect(d.followed, 'a drag is a selection, never an activation').toEqual([]);
    expect(view.state.selection.main.from).toBe(LINK_FROM + 2);
    expect(view.state.selection.main.to).toBe(LINK_TO + 4);
  });

  it('a release a pixel or two away is still a click, not a drag', () => {
    const d = deps();
    const view = new FakeView();
    const handlers = createLinkPointerHandlers(d);

    handlers.mousedown(press(), view);
    handlers.mouseup(press({ clientX: 101, clientY: 51 }), view);

    expect(d.followed).toHaveLength(1);
  });

  it('a release with no press before it does nothing', () => {
    const d = deps();
    createLinkPointerHandlers(d).mouseup(press(), new FakeView());
    expect(d.followed).toEqual([]);
  });
});

describe('the modifier comes from the shipped binding, not from a literal (FR-040)', () => {
  it('reads the Open Link command’s own chord', () => {
    const shipped = shippedBindingsFor(DEFAULT_BINDING_PLATFORM).bindings['preview.followLink'];
    expect(shipped, 'the Open Link command must still ship a chord').toBeDefined();
    expect(linkModifierName()).toBe(linkModifierFromChord(shipped![0]!));
  });

  it('answers Meta for a Cmd-based chord, which is FR-040’s macOS clause', () => {
    expect(linkModifierFromChord('Meta+Enter')).toBe('Meta');
    expect(linkModifierFromChord('Ctrl+Enter')).toBe('Ctrl');
  });

  it('a Meta+click is not a follow while the shipped chord is Ctrl-based', () => {
    const d = deps();
    const claimed = createLinkPointerHandlers(d).mousedown(
      press({ ctrlKey: false, metaKey: true }),
      new FakeView(),
    );
    expect(claimed).toBe(linkModifierName() === 'Meta');
  });
});

/**
 * The caret store is keyed by PANEL (040 US1 — FR-006, FR-005; data-model.md §3.1, research.md D5).
 *
 * ══ WHY THE KEY SCOPE IS THE WHOLE TEST ══
 *
 * Constitution Principle XI splits editor state in two: the document is ONE value however many
 * panels show it, and the caret/selection/scroll are per-view. The caret readouts are on the view
 * side of that line, so the store has to be keyed by panel id — not by document, and emphatically
 * not by a module-level "current caret" that the last update wins.
 *
 * A module-level single value passes every single-panel test anybody would think to write, and is
 * wrong the moment two editors are open, which is the ordinary case. So the assertion that matters
 * is the one below: two panels showing the SAME file report their own positions.
 *
 * ══ WHY THE SNAPSHOT IDENTITY IS ASSERTED ══
 *
 * The strip reads this through `useSyncExternalStore`, which compares snapshots by IDENTITY. A
 * getter that builds `{ position, selected }` fresh on every call returns a new object every render
 * and React re-renders forever — "The result of getSnapshot should be cached". That is not a style
 * point; it is an infinite loop that only appears once a component is wired to the store, several
 * tasks after the store was written.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  NO_CARET,
  forgetPanelCaret,
  panelCaret,
  setPanelCaret,
  subscribeCaret,
  __resetCaretStore,
} from '../../src/renderer/editor/caret-store.js';

beforeEach(() => {
  __resetCaretStore();
});

describe('the caret store is keyed by panel, not by document (FR-006)', () => {
  it('keeps two panels showing ONE file on their own caret positions', () => {
    /*
     * The defect this exists to catch: a store keyed by file path, or a single module-level value.
     * Both are indistinguishable from a correct store until a second panel opens the same document
     * — and a split view of one file is exactly what a user does when they want two places at once.
     */
    setPanelCaret('panel-a', { line: 412, column: 7 }, null);
    setPanelCaret('panel-b', { line: 3, column: 1 }, null);

    expect(panelCaret('panel-a').position).toEqual({ line: 412, column: 7 });
    expect(panelCaret('panel-b').position).toEqual({ line: 3, column: 1 });
  });

  it('does not let a later write to one panel disturb another', () => {
    setPanelCaret('panel-a', { line: 412, column: 7 }, null);
    setPanelCaret('panel-b', { line: 3, column: 1 }, null);

    setPanelCaret('panel-b', { line: 99, column: 12 }, null);

    expect(panelCaret('panel-a').position).toEqual({ line: 412, column: 7 });
    expect(panelCaret('panel-b').position).toEqual({ line: 99, column: 12 });
  });

  it('drops one panel’s caret without touching its neighbour’s', () => {
    // Called when a panel unmounts (data-model.md §3.1). A store that cleared everything would
    // blank the surviving editor's readouts the moment its neighbour closed.
    setPanelCaret('panel-a', { line: 412, column: 7 }, null);
    setPanelCaret('panel-b', { line: 3, column: 1 }, null);

    forgetPanelCaret('panel-b');

    expect(panelCaret('panel-a').position).toEqual({ line: 412, column: 7 });
    expect(panelCaret('panel-b')).toBe(NO_CARET);
  });
});

describe('what an unwritten panel reads', () => {
  it('reads line 1 column 1 rather than nothing (FR-002)', () => {
    // A strip mounted before its editor has adopted any content still has to say something true,
    // and an empty document's caret really is at line 1, column 1.
    expect(panelCaret('never-written')).toEqual({ position: { line: 1, column: 1 }, selected: null });
  });

  it('returns the SAME object every time, so useSyncExternalStore can cache it', () => {
    // See the file header: a fresh object per read is an infinite render loop, not a tidiness issue.
    expect(panelCaret('never-written')).toBe(panelCaret('never-written'));
  });
});

describe('the selected-character count rides with the caret (FR-004, FR-005)', () => {
  it('carries the figure a selection produced', () => {
    setPanelCaret('panel-a', { line: 412, column: 7 }, 63);
    expect(panelCaret('panel-a').selected).toBe(63);
  });

  it('carries NULL for a bare caret — never 0 (FR-005)', () => {
    /*
     * `0` and `null` are different answers. `0` claims a selection exists and is empty, which would
     * leave a "0 selected" readout on screen that never goes away; `null` is what makes the segment
     * ABSENT. The store must not launder one into the other.
     */
    setPanelCaret('panel-a', { line: 412, column: 7 }, 63);
    setPanelCaret('panel-a', { line: 412, column: 7 }, null);
    expect(panelCaret('panel-a').selected).toBeNull();
  });

  it('carries a 0 through as 0, and does not launder it into null', () => {
    /*
     * `0` used to have a producer: FR-004a excluded line endings, so a selection of exactly one
     * line ending counted zero. The 2026-08-25 reversal removed it — a break is now one character,
     * so `selectedCharacters` answers `null` or at least 1, and nothing in the app reaches here
     * with 0.
     *
     * The assertion stays because the store's job is to carry what it was given without
     * interpreting it, and `0` is the value most likely to be interpreted: a falsy check anywhere
     * on this path would turn it into `null` and make the readout VANISH. That defect would be
     * invisible until something produced a 0 again, which is precisely when nobody would be
     * looking.
     */
    setPanelCaret('panel-a', { line: 1, column: 1 }, 0);
    expect(panelCaret('panel-a').selected).toBe(0);
  });
});

describe('subscribers', () => {
  it('is notified when any panel’s caret moves, and hands back a fresh snapshot', () => {
    const seen: unknown[] = [];
    const unsubscribe = subscribeCaret(() => seen.push(panelCaret('panel-a')));

    setPanelCaret('panel-a', { line: 2, column: 5 }, null);
    expect(seen).toEqual([{ position: { line: 2, column: 5 }, selected: null }]);

    unsubscribe();
    setPanelCaret('panel-a', { line: 3, column: 1 }, null);
    expect(seen).toHaveLength(1);
  });

  it('gives a NEW snapshot object once the caret has actually moved', () => {
    // The mirror image of the caching assertion above: identity must be stable while nothing
    // changes and must CHANGE when something does, or the strip renders a stale position forever.
    setPanelCaret('panel-a', { line: 2, column: 5 }, null);
    const before = panelCaret('panel-a');
    setPanelCaret('panel-a', { line: 2, column: 6 }, null);
    expect(panelCaret('panel-a')).not.toBe(before);
  });
});

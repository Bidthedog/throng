/**
 * 044 T188 — the editor scroll store and its top-line helper (FR-113; data-model §14.4, research R23).
 *
 * The store is how a preview in this window learns where its parent editor is scrolled: `use-editor.ts`
 * publishes the view's top visible source line per EDITOR PANEL, and `preview-panel.tsx` reads the entry
 * for its update's `parent.panelId`. Keyed by panel for the reason `caret-store.test.ts` gives — scroll is
 * view state (Principle XI), and two editors showing one file are scrolled independently.
 *
 * 044 T229 (FR-121, FR-121g; data-model §15.1) — the snapshot is now `{ line, fromSync }`: whether the
 * publish was the editor following a preview's request, which the preview must not relay back. It is an
 * OBJECT, so `useSyncExternalStore`'s identity check holds only because the store replaces it exactly when
 * a field changes — asserted below as "the same snapshot". An unchanged value does not EMIT, because every
 * emit re-renders every subscribed preview and the publisher runs once per animation frame while the
 * editor scrolls.
 *
 * The store also carries the request direction (FR-121a): a preview asks an editor view in THIS window to
 * scroll through `requestEditorTopLine`, which answers `false` — and does nothing — when no view of that
 * editor registered a scroller here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetEditorScrollStore,
  editorTopLine,
  editorTopLineOf,
  forgetEditorTopLine,
  publishEditorTopLine,
  registerEditorScroller,
  requestEditorTopLine,
  subscribeEditorTopLine,
  type TopLineView,
} from '../../src/renderer/editor/editor-scroll-store.js';

beforeEach(() => {
  __resetEditorScrollStore();
});

describe('the editor scroll store is keyed by editor panel (FR-113)', () => {
  it('reads back the line published for a panel, and null for one nothing has published', () => {
    publishEditorTopLine('ed-1', 40);
    expect(editorTopLineOf('ed-1')).toEqual({ line: 40, fromSync: false });
    expect(editorTopLineOf('never-published')).toBeNull();
  });

  it('carries whether the publish followed a sync request (FR-121g)', () => {
    publishEditorTopLine('ed-1', 40, true);
    expect(editorTopLineOf('ed-1')).toEqual({ line: 40, fromSync: true });
  });

  it('emits when only fromSync changes, and replaces the snapshot then', () => {
    const listener = vi.fn();
    publishEditorTopLine('ed-1', 40, true);
    const synced = editorTopLineOf('ed-1');
    subscribeEditorTopLine(listener);

    publishEditorTopLine('ed-1', 40, false);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(editorTopLineOf('ed-1')).not.toBe(synced);
    expect(editorTopLineOf('ed-1')).toEqual({ line: 40, fromSync: false });
  });

  it('keeps the same snapshot object when the same value is published again', () => {
    publishEditorTopLine('ed-1', 40, true);
    const before = editorTopLineOf('ed-1');
    publishEditorTopLine('ed-1', 40, true);
    expect(editorTopLineOf('ed-1')).toBe(before);
  });

  it('emits once for a line published twice', () => {
    const listener = vi.fn();
    subscribeEditorTopLine(listener);

    publishEditorTopLine('ed-1', 40);
    publishEditorTopLine('ed-1', 40);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('returns the same snapshot for a panel whose line has not changed', () => {
    publishEditorTopLine('ed-1', 40);
    const before = editorTopLineOf('ed-1');
    publishEditorTopLine('ed-2', 7);
    expect(editorTopLineOf('ed-1')).toBe(before);
  });

  it('forgets a panel, and says so to subscribers', () => {
    publishEditorTopLine('ed-1', 40);
    const listener = vi.fn();
    subscribeEditorTopLine(listener);

    forgetEditorTopLine('ed-1');

    expect(editorTopLineOf('ed-1')).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    // Forgetting what was never there changes nothing, so it tells nobody.
    forgetEditorTopLine('ed-1');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps two panels independent', () => {
    publishEditorTopLine('ed-1', 40);
    publishEditorTopLine('ed-2', 7);
    publishEditorTopLine('ed-2', 9);
    forgetEditorTopLine('ed-2');

    expect(editorTopLineOf('ed-1')).toEqual({ line: 40, fromSync: false });
    expect(editorTopLineOf('ed-2')).toBeNull();
  });

  it('stops notifying a listener once it unsubscribes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeEditorTopLine(listener);
    publishEditorTopLine('ed-1', 1);
    unsubscribe();
    publishEditorTopLine('ed-1', 2);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('the request direction reaches only a view registered in this window (FR-121a)', () => {
  it('answers false, and calls nothing, when no scroller is registered for the panel', () => {
    const other = vi.fn();
    registerEditorScroller('ed-2', other);

    expect(requestEditorTopLine('ed-1', 40)).toBe(false);
    expect(other).not.toHaveBeenCalled();
  });

  it('calls the registered scroller with the line and answers true', () => {
    const scroller = vi.fn();
    registerEditorScroller('ed-1', scroller);

    expect(requestEditorTopLine('ed-1', 40)).toBe(true);
    expect(scroller).toHaveBeenCalledTimes(1);
    expect(scroller).toHaveBeenCalledWith(40);
  });

  it('drops the scroller when its unregister function runs', () => {
    const scroller = vi.fn();
    const unregister = registerEditorScroller('ed-1', scroller);

    unregister();

    expect(requestEditorTopLine('ed-1', 40)).toBe(false);
    expect(scroller).not.toHaveBeenCalled();
  });

  it('an unregister left over from a replaced scroller does not drop its successor', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = registerEditorScroller('ed-1', first);
    registerEditorScroller('ed-1', second);

    unregisterFirst();

    expect(requestEditorTopLine('ed-1', 40)).toBe(true);
    expect(second).toHaveBeenCalledWith(40);
    expect(first).not.toHaveBeenCalled();
  });

  it('forgetting the panel also drops its scroller (the view unmounted)', () => {
    const scroller = vi.fn();
    registerEditorScroller('ed-1', scroller);
    publishEditorTopLine('ed-1', 3);

    forgetEditorTopLine('ed-1');

    expect(requestEditorTopLine('ed-1', 40)).toBe(false);
    expect(scroller).not.toHaveBeenCalled();
  });
});

describe('editorTopLine reads the top visible source line of a view (R23)', () => {
  /** A view whose scroller's viewport starts at client y 120 and whose content starts at client x 48. */
  function fakeView(posAt: number | null, lineNumberAt: (pos: number) => number) {
    const posAtCoords = vi.fn((_coords: { x: number; y: number }, _precise: false): number | null => posAt);
    const lineAt = vi.fn((pos: number) => ({ number: lineNumberAt(pos) }));
    const view: TopLineView = {
      scrollDOM: { getBoundingClientRect: () => ({ top: 120, left: 0 }) },
      contentDOM: { getBoundingClientRect: () => ({ top: 124, left: 48 }) },
      posAtCoords,
      state: { doc: { lineAt } },
    };
    return { view, posAtCoords, lineAt };
  }

  it('asks for the position at the top-left of the viewport and answers its 0-based line', () => {
    const { view, posAtCoords, lineAt } = fakeView(512, () => 31);

    expect(editorTopLine(view)).toBe(30);
    // Inset by a pixel on both axes, as `use-editor.ts` anchors the gutter toggle: on the exact boundary
    // the point resolves to the row above. Imprecise, so a row outside the rendered viewport still answers.
    expect(posAtCoords).toHaveBeenCalledWith({ x: 49, y: 121 }, false);
    expect(lineAt).toHaveBeenCalledWith(512);
  });

  it('answers 0 when no position lies under that point', () => {
    // CodeMirror types the imprecise lookup as total; a null anyway is the top, never a throw on the scroll path.
    const { view, lineAt } = fakeView(null, () => 99);
    expect(editorTopLine(view)).toBe(0);
    expect(lineAt).not.toHaveBeenCalled();
  });
});

/**
 * MOVED DOWN from `component/find-in-files-open-result.test.ts` (pass 2): opening a result row through
 * `openFileInTab`, and landing on the match, render nothing (043 T072–T074, FR-037, FR-038).
 *
 *   2. The OPEN goes through `openFileInTab` with the user's "Open files in" preference and the
 *      match's range. That is what makes FR-037's one-buffer, dirty-editor and dedicated-editor
 *      rules true here — they are that function's rules, and this asserts the call reaches it
 *      rather than restating them a second time.
 *   3. The REVEAL waits. The open is async and, where it creates a panel, that panel arrives from a
 *      layout mutation React has not committed yet — so `getEditorView` is `undefined` when the
 *      open returns, and a reveal written as a straight-line call would silently do nothing.
 *
 * What stays end-to-end: that the highlight is VISIBLE. Layout has no jsdom answer either.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openResultRow } from '../../src/renderer/find-in-files/result-open.js';
import { revealRangeInEditor } from '../../src/renderer/editor/reveal-range.js';
import { registerEditorView, unregisterEditorView } from '../../src/renderer/editor/editor-views.js';

/**
 * The one-buffer / dirty-editor / dedicated-editor rules ARE `openFileInTab`, so it is mocked and
 * the call to it is what gets asserted — the alternative is a second copy of those rules here,
 * which would pass while the real ones were broken.
 */
const editorOpen = vi.hoisted(() => ({ openFileInTab: vi.fn(async () => true) }));
vi.mock('../../src/renderer/editor/editor-open.js', () => editorOpen);

const TAB_ID = 'tab-1';

beforeEach(() => {
  editorOpen.openFileInTab.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the open honours the "Open files in" preference (FR-037)', () => {
  const ws = { layout: { activeTabId: TAB_ID } } as unknown as Parameters<
    typeof openResultRow
  >[0]['ws'];

  it('routes through openFileInTab, with the preference and the match range', async () => {
    await openResultRow({
      ws,
      projectRoot: 'D:/proj',
      openTarget: 'lastActive',
      request: { relPath: 'src/app.ts', from: 120, to: 126 },
    });

    expect(editorOpen.openFileInTab).toHaveBeenCalledWith(
      ws,
      TAB_ID,
      'D:/proj/src/app.ts',
      'lastActive',
      { from: 120, to: 126 },
    );
  });

  it('passes "new" through unchanged, so a row lands where a tree click would', async () => {
    /*
     * The whole of FR-037's "honouring the same rules": this file makes no decision about the one
     * buffer, a dirty target or the dedicated editor — it hands the preference to the function that
     * owns all three. A branch here would be a second copy of rules that already have defects
     * behind them.
     */
    await openResultRow({
      ws,
      projectRoot: 'D:/proj',
      openTarget: 'new',
      request: { relPath: 'a.ts', from: 0, to: 3 },
    });

    expect(editorOpen.openFileInTab.mock.calls[0][3]).toBe('new');
  });

  it('opens nothing when there is no active tab', async () => {
    const none = { layout: null } as unknown as typeof ws;
    expect(
      await openResultRow({
        ws: none,
        projectRoot: 'D:/proj',
        openTarget: 'lastActive',
        request: { relPath: 'a.ts', from: 0, to: 3 },
      }),
    ).toBe(false);
    expect(editorOpen.openFileInTab).not.toHaveBeenCalled();
  });
});

describe('the match is SELECTED, and the reveal waits for a view (FR-038)', () => {
  /** A CodeMirror view, reduced to the two things the reveal actually touches. */
  function fakeView(docLength: number): { dispatch: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> } {
    const view = {
      state: { doc: { length: docLength } },
      dispatch: vi.fn(),
      focus: vi.fn(),
    };
    return view as unknown as { dispatch: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> };
  }

  it('selects the match, rather than only scrolling to it', async () => {
    const view = fakeView(500);
    registerEditorView('ed-1', view as never);
    try {
      expect(await revealRangeInEditor('ed-1', { from: 120, to: 126 })).toBe(true);
      const tr = view.dispatch.mock.calls[0][0];
      // A RANGE covering the match — `anchor` at its start and `head` at its end, which is what
      // makes the viewport follow the end of the match rather than its beginning. Read as anchor
      // and head rather than as an `EditorSelection`, because that is the shape `goto-line.tsx`
      // hands CodeMirror too: a `SelectionRange`, which the transaction spec accepts structurally.
      expect(tr.selection.anchor).toBe(120);
      expect(tr.selection.head).toBe(126);
      expect(tr.selection.from).toBe(120);
      expect(tr.selection.to).toBe(126);
      // Both halves of FR-038: a selection AND the viewport brought to it — centred on it since the
      // #526 follow-up, so the scroll is an explicit effect rather than `scrollIntoView: true`.
      expect((tr.effects as { value: { y: string } }).value.y).toBe('center');
      // Not an edit, so it must not join an undo run.
      expect(tr.userEvent).toBe('select');
    } finally {
      unregisterEditorView('ed-1');
    }
  });

  it('waits for a view that mounts AFTER the open returns', async () => {
    /*
     * The defect this exists for. The open is a promise, and where it creates a panel that panel
     * comes from a layout mutation React commits on a later turn — so at the moment the open
     * resolves there is no view at all, and a straight-line reveal would find `undefined` and give
     * up without a sound.
     */
    vi.useFakeTimers();
    const view = fakeView(500);
    const pending = revealRangeInEditor('ed-late', { from: 10, to: 14 });

    await vi.advanceTimersByTimeAsync(60);
    expect(view.dispatch).not.toHaveBeenCalled();

    registerEditorView('ed-late', view as never);
    await vi.advanceTimersByTimeAsync(60);

    await expect(pending).resolves.toBe(true);
    expect(view.dispatch).toHaveBeenCalledTimes(1);
    unregisterEditorView('ed-late');
  });

  it('waits for the DOCUMENT too, not merely for the view', async () => {
    /*
     * A view mounts before its file arrives — `openFile` reads over the bridge. Selecting against an
     * empty document would clamp both ends to zero and put the caret at the top of the file, which
     * looks exactly like a reveal that silently did nothing.
     */
    vi.useFakeTimers();
    const empty = fakeView(0);
    registerEditorView('ed-loading', empty as never);
    const pending = revealRangeInEditor('ed-loading', { from: 120, to: 126 });

    await vi.advanceTimersByTimeAsync(100);
    expect(empty.dispatch).not.toHaveBeenCalled();

    unregisterEditorView('ed-loading');
    registerEditorView('ed-loading', fakeView(500) as never);
    await vi.advanceTimersByTimeAsync(60);
    await expect(pending).resolves.toBe(true);
    unregisterEditorView('ed-loading');
  });

  it('gives up quietly when the view never arrives', async () => {
    // The file is open and the user is looking at it. A notice saying the highlight could not be
    // placed names a remedy they cannot act on — the pattern FR-057d rejects.
    vi.useFakeTimers();
    const pending = revealRangeInEditor('ed-never', { from: 1, to: 2 }, { attempts: 3, intervalMs: 5 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toBe(false);
  });
});

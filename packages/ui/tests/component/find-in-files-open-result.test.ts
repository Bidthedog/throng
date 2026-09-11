/**
 * 043 T072–T074 — opening a result row, and landing ON THE MATCH (FR-037, FR-038).
 *
 * Three claims, at the three layers that can each prove one of them:
 *
 *   1. The LIST decides which row. A double-click opens; so does Enter on the row the arrow keys
 *      landed on. Assertable on the rendered panel, and nowhere cheaper.
 *   2. The OPEN goes through `openFileInTab` with the user's "Open files in" preference and the
 *      match's range. That is what makes FR-037's one-buffer, dirty-editor and dedicated-editor
 *      rules true here — they are that function's rules, and this asserts the call reaches it
 *      rather than restating them a second time.
 *   3. The REVEAL waits. The open is async and, where it creates a panel, that panel arrives from a
 *      layout mutation React has not committed yet — so `getEditorView` is `undefined` when the
 *      open returns, and a reveal written as a straight-line call would silently do nothing.
 *
 * ══ WHAT STAYS END-TO-END ══
 *
 * That the highlight is VISIBLE. jsdom has no layout, so `scrollIntoView` moves nothing here and
 * "the user can see the match" is not a claim this tier can make. What it can prove is the one that
 * actually regresses: that a selection covering exactly the match is dispatched at all, and that it
 * is dispatched to a view that only appears later.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@throng/core';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  openResultRow,
  registerResultOpener,
  type ResultOpenRequest,
} from '../../src/renderer/find-in-files/result-open.js';
import { revealRangeInEditor } from '../../src/renderer/editor/reveal-range.js';
import {
  registerEditorView,
  unregisterEditorView,
} from '../../src/renderer/editor/editor-views.js';
import {
  PANEL_ID,
  PROJECT_ROOT,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

const config = vi.hoisted(() => ({ settings: null as unknown as AppSettings }));

vi.mock('../../src/renderer/config/config-store.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/renderer/config/config-store.js')>();
  return { ...actual, useAppSettings: () => config.settings };
});

/**
 * The one-buffer / dirty-editor / dedicated-editor rules ARE `openFileInTab`, so it is mocked and
 * the call to it is what gets asserted — the alternative is a second copy of those rules here,
 * which would pass while the real ones were broken.
 */
const editorOpen = vi.hoisted(() => ({ openFileInTab: vi.fn(async () => true) }));
vi.mock('../../src/renderer/editor/editor-open.js', () => editorOpen);

const TAB_ID = 'tab-1';
let bridge: FileSearchStub;

function mountPanel(): void {
  renderFindInFilesPanel();
}

/** Two matches in one file, so "the row that was double-clicked" is a distinguishable claim. */
function seedTwoRows(): void {
  bridge.emit({
    panelId: PANEL_ID,
    generation: 1,
    status: 'complete',
    rows: [resultRow('src/app.ts', 3, 120), resultRow('src/app.ts', 9, 400)],
    totalMatches: 2,
    filesScanned: 1,
  });
}

const row = (from: number): HTMLElement => screen.getByTestId(`fif-row-src/app.ts-${from}`);
const list = (): HTMLElement => screen.getByTestId(`fif-results-${PANEL_ID}`);

beforeEach(() => {
  config.settings = DEFAULT_APP_SETTINGS;
  __resetFindInFilesState();
  bridge = installFileSearchStub();
  editorOpen.openFileInTab.mockClear();
});

afterEach(() => {
  registerResultOpener(null);
  __resetFindInFilesState();
  removeFileSearchStub();
  vi.useRealTimers();
});

describe('the list decides which row (FR-037, Assumptions)', () => {
  it('a DOUBLE-click opens that row, at its offsets', () => {
    const opened: ResultOpenRequest[] = [];
    registerResultOpener((r) => opened.push(r));
    mountPanel();
    seedTwoRows();

    fireEvent.doubleClick(row(400));

    // 043 T236 — the request names the PANEL's root too: in a sub-workspace window the window has
    // none of its own, so the panel's is the only root the file can be resolved against.
    expect(opened).toEqual([{ relPath: 'src/app.ts', from: 400, to: 406, projectRoot: PROJECT_ROOT }]);
  });

  it('a single click opens nothing — stepping through a list is not a decision', () => {
    const opened: ResultOpenRequest[] = [];
    registerResultOpener((r) => opened.push(r));
    mountPanel();
    seedTwoRows();

    fireEvent.click(row(400));

    expect(opened).toEqual([]);
  });

  it('arrow keys then Enter open the row the keyboard landed on', () => {
    /*
     * The keyboard reaches the SAME opener the double-click does. FR-037 names double-click because
     * that is what the issue specified; the spec's Assumptions say it is not meant to be the only
     * way in, and a second path would be a second thing to keep in step.
     *
     * Two ArrowDowns: index 0 is the file's group HEADING, 1 and 2 are its rows.
     */
    const opened: ResultOpenRequest[] = [];
    registerResultOpener((r) => opened.push(r));
    mountPanel();
    seedTwoRows();

    fireEvent.keyDown(list(), { key: 'ArrowDown' });
    fireEvent.keyDown(list(), { key: 'ArrowDown' });
    fireEvent.keyDown(list(), { key: 'Enter' });

    // 043 T236 — the request names the PANEL's root too: in a sub-workspace window the window has
    // none of its own, so the panel's is the only root the file can be resolved against.
    expect(opened).toEqual([{ relPath: 'src/app.ts', from: 400, to: 406, projectRoot: PROJECT_ROOT }]);
  });

  it('Enter on a group HEADING collapses it rather than opening anything', () => {
    // There is no file under the cursor to open, and collapsing is what "open" means for a heading.
    const opened: ResultOpenRequest[] = [];
    registerResultOpener((r) => opened.push(r));
    mountPanel();
    seedTwoRows();

    fireEvent.keyDown(list(), { key: 'Enter' });

    expect(opened).toEqual([]);
    expect(screen.getByTestId('fif-group-toggle-src/app.ts')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('is harmless when no chrome is mounted to answer', () => {
    // A window mid-teardown. The double-click must not throw.
    mountPanel();
    seedTwoRows();
    expect(() => fireEvent.doubleClick(row(120))).not.toThrow();
  });
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
      // Both halves of FR-038: a selection AND the viewport brought to it.
      expect(tr.scrollIntoView).toBe(true);
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

/** Keeps the linter honest about the unused import in a file that mocks its module. */
void act;

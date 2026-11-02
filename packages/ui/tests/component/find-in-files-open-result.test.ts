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
  registerResultOpener,
  type ResultOpenRequest,
} from '../../src/renderer/find-in-files/result-open.js';
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
    // 054 FR-031 — the request also carries the match's line and text, so a preview can reveal it.
    expect(opened).toEqual([{ relPath: 'src/app.ts', from: 400, to: 406, line: 8, text: 'needle', projectRoot: PROJECT_ROOT }]);
  });

  it('a single click selects the row and opens nothing — selecting is not a decision (060 FR-020)', () => {
    const opened: ResultOpenRequest[] = [];
    registerResultOpener((r) => opened.push(r));
    mountPanel();
    seedTwoRows();

    fireEvent.click(row(400));

    expect(row(400)).toHaveAttribute('data-current', 'true');
    expect(opened).toEqual([]);
  });

  it('arrow keys then Enter open the row the keyboard landed on', () => {
    /*
     * The keyboard reaches the SAME opener the double-click does. FR-037 names double-click because
     * that is what the issue specified; the spec's Assumptions say it is not meant to be the only
     * way in, and a second path would be a second thing to keep in step.
     *
     * Three ArrowDowns: with nothing selected the first lands on index 0, the file's group HEADING;
     * 1 and 2 are its rows.
     */
    const opened: ResultOpenRequest[] = [];
    registerResultOpener((r) => opened.push(r));
    mountPanel();
    seedTwoRows();

    fireEvent.keyDown(list(), { key: 'ArrowDown' });
    fireEvent.keyDown(list(), { key: 'ArrowDown' });
    fireEvent.keyDown(list(), { key: 'ArrowDown' });
    fireEvent.keyDown(list(), { key: 'Enter' });

    // 043 T236 — the request names the PANEL's root too: in a sub-workspace window the window has
    // none of its own, so the panel's is the only root the file can be resolved against.
    // 054 FR-031 — the request also carries the match's line and text, so a preview can reveal it.
    expect(opened).toEqual([{ relPath: 'src/app.ts', from: 400, to: 406, line: 8, text: 'needle', projectRoot: PROJECT_ROOT }]);
  });

  it('Enter on a group HEADING collapses it rather than opening anything', () => {
    // There is no file under the cursor to open, and collapsing is what "open" means for a heading.
    const opened: ResultOpenRequest[] = [];
    registerResultOpener((r) => opened.push(r));
    mountPanel();
    seedTwoRows();

    // ArrowDown from nothing selects the heading; Enter then toggles it.
    fireEvent.keyDown(list(), { key: 'ArrowDown' });
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

// MOVED DOWN (pass 2): "the open honours the Open files in preference" (3 tests) and "the match is
// SELECTED, and the reveal waits for a view" (4 tests) render nothing; they are
// `unit/find-in-files-open-result-routing.test.ts`.

/** Keeps the linter honest about the unused import in a file that mocks its module. */
void act;

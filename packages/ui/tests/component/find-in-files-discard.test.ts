/**
 * 043 T102/T104 — a Find in Files panel's results die with the panel, and what comes back after a
 * restart is the QUERY and nothing else (FR-023, FR-027a–FR-027d, US5 scenarios 5, 9 and 10).
 *
 * ══ WHY THESE TWO BELONG IN ONE FILE ══
 *
 * They are the same requirement seen from either end. FR-023 says closing a panel discards its
 * results; FR-027b says restarting does not bring them back; FR-027d states the consequence — results
 * never outlive the panel that found them. A file that asserted only the first would leave the
 * obvious wrong fix (stash the results somewhere and restore them) passing.
 *
 * ══ WHY `destroyFindInFilesPanel` IS CALLED DIRECTLY ══
 *
 * `find-session-per-panel.test.ts` settles this idiom for the find bar's identical rule: the store
 * function is what the panel destroy, the tab close and the cross-window destroy cascade all call,
 * and mounting any of those three surfaces would need a workspace provider, a confirm dialog and a
 * detach context to assert something none of them owns. The call sites themselves are
 * `panel-placeholder.tsx`, `tab-group.tsx` and `panel-destroy-sync.tsx`.
 *
 * ══ WHAT FR-027c NEEDS NO CODE FOR ══
 *
 * There is no pending-preview object to discard. A preview is `replaceEnabled` plus the rows on
 * screen, derived at render time — so a panel restored with a replacement typed and NO rows is
 * previewing nothing, which is the requirement holding by construction rather than by a cleanup
 * step somebody has to remember. The test below asserts exactly that shape.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS, type AppSettings, type FindInFilesPanelConfig } from '@throng/core';
import {
  __resetFindInFilesState,
  destroyFindInFilesPanel,
  getFindInFilesPanel,
  runFindInFiles,
  setFindInFilesTerm,
} from '../../src/renderer/find-in-files/find-in-files-store.js';
import { __resetLastActiveFindInFiles } from '../../src/renderer/find-in-files/last-active-find-in-files.js';
import {
  PANEL_ID,
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

const OTHER_ID = 'p2';

let bridge: FileSearchStub;

/** A completed scan for one panel: two matches in one file. */
function completeScan(panelId: string): void {
  bridge.emit({
    panelId,
    generation: 1,
    status: 'complete',
    rows: [resultRow('src/a.ts', 1, 0), resultRow('src/a.ts', 2, 20)],
    totalMatches: 2,
    filesScanned: 1,
  });
}

const status = (id: string): string =>
  screen.getByTestId(`fif-status-${id}`).getAttribute('data-state') ?? '';
const rowsIn = (id: string): number =>
  screen.getByTestId(`fif-results-${id}`).querySelectorAll('.fif-row').length;

beforeEach(() => {
  config.settings = DEFAULT_APP_SETTINGS;
  __resetFindInFilesState();
  __resetLastActiveFindInFiles();
  bridge = installFileSearchStub();
});

afterEach(() => {
  __resetFindInFilesState();
  __resetLastActiveFindInFiles();
  removeFileSearchStub();
  vi.restoreAllMocks();
});

describe('closing a panel discards its results (FR-023, US5 scenario 5)', () => {
  it('drops the state and stops the scan', () => {
    const view = renderFindInFilesPanel();
    completeScan(PANEL_ID);
    expect(getFindInFilesPanel(PANEL_ID)?.results.rows).toHaveLength(2);

    view.unmount();
    act(() => destroyFindInFilesPanel(PANEL_ID));

    expect(getFindInFilesPanel(PANEL_ID)).toBeUndefined();
    /*
     * `drop`, not `cancel`. A panel closed mid-scan must not leave a walk running against a panel
     * nobody can see — but a panel closed AFTER its scan finished (the ordinary case) must release
     * the run too, and `cancel` is a no-op for a scan that is no longer running. Main then kept the
     * run's per-file stamps and re-stated them on every watcher tick for the life of the window.
     */
    expect(bridge.drop).toHaveBeenCalledWith(PANEL_ID);
  });

  it('gives a panel opened afterwards no results at all, even reusing the same id', () => {
    /*
     * The same id on purpose. Panel ids are unique in practice, so a store that kept a closed
     * panel's results would usually be caught by the NEW-id case below — but a store that keyed
     * retention by id and handed it back on re-creation would sail through that one, and this is
     * the case that names it.
     */
    const first = renderFindInFilesPanel();
    completeScan(PANEL_ID);
    expect(rowsIn(PANEL_ID)).toBe(2);

    first.unmount();
    act(() => destroyFindInFilesPanel(PANEL_ID));
    renderFindInFilesPanel();

    expect(status(PANEL_ID)).toBe('notRun');
    expect(rowsIn(PANEL_ID)).toBe(0);
    expect(screen.queryByTestId(`fif-total-${PANEL_ID}`)).toBeNull();
  });

  it('leaves a panel that is still open holding its own results', () => {
    renderFindInFilesPanel();
    renderFindInFilesPanel({ panelId: OTHER_ID });
    completeScan(PANEL_ID);
    completeScan(OTHER_ID);

    act(() => destroyFindInFilesPanel(PANEL_ID));

    expect(getFindInFilesPanel(PANEL_ID)).toBeUndefined();
    expect(getFindInFilesPanel(OTHER_ID)?.results.rows).toHaveLength(2);
    expect(rowsIn(OTHER_ID)).toBe(2);
  });
});

describe('a restored panel comes back with its query and nothing else (FR-027a–d, T104)', () => {
  const SAVED: FindInFilesPanelConfig = {
    term: 'needle',
    caseSensitive: true,
    wholeWord: true,
    scopeSubPath: 'src/renderer',
    replaceShown: true,
    replacement: 'pin',
  };

  it('restores all five parts of the query into the controls', () => {
    renderFindInFilesPanel({ config: SAVED });

    expect(screen.getByTestId(`fif-term-${PANEL_ID}`)).toHaveValue('needle');
    expect(screen.getByTestId(`fif-match-case-${PANEL_ID}`)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId(`fif-whole-word-${PANEL_ID}`)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId(`fif-scope-${PANEL_ID}`)).toHaveValue('src/renderer');
    expect(screen.getByTestId(`fif-toggle-replace-${PANEL_ID}`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId(`fif-replacement-${PANEL_ID}`)).toHaveValue('pin');
  });

  it('comes back NOT YET RUN — no results, no preview, and no scan started', () => {
    /*
     * 039's dormant terminal is the structural precedent: a panel that reopens configured and idle,
     * doing nothing until the user asks. Here "idle" has to be asserted three ways, because each
     * would be a different defect — matches on screen (FR-027b), a preview standing over files
     * nobody has re-read (FR-027c), and a filesystem walk on the startup path of every project
     * holding one of these panels.
     */
    renderFindInFilesPanel({ config: SAVED });

    expect(status(PANEL_ID)).toBe('notRun');
    expect(rowsIn(PANEL_ID)).toBe(0);
    expect(screen.queryByTestId('fif-replacement')).toBeNull();
    expect(bridge.start).not.toHaveBeenCalled();
  });

  it('writes nothing back when a restored panel is not touched', () => {
    // `updatePanelConfig` schedules a debounced layout save. A restore that immediately re-saved
    // would put a write on the startup path of every project holding one of these panels.
    const onConfigChange = vi.fn();
    renderFindInFilesPanel({ config: SAVED, onConfigChange });

    expect(onConfigChange).not.toHaveBeenCalled();
  });

  it('writes the WHOLE query back when any part of it changes', () => {
    /*
     * Whole, not partial: `updatePanelConfig` MERGES, so an omitted key keeps whatever the previous
     * write left — and a user who cleared their replacement text would reopen with the old one
     * still in the box.
     */
    const onConfigChange = vi.fn();
    renderFindInFilesPanel({ config: SAVED, onConfigChange });

    fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: 'haystack' } });

    expect(onConfigChange).toHaveBeenLastCalledWith({
      term: 'haystack',
      caseSensitive: true,
      wholeWord: true,
      scopeSubPath: 'src/renderer',
      replaceShown: true,
      replacement: 'pin',
    });
  });

  it('never writes results or a preview into what is persisted', () => {
    const onConfigChange = vi.fn();
    renderFindInFilesPanel({ config: SAVED, onConfigChange });
    completeScan(PANEL_ID);
    act(() => {
      setFindInFilesTerm(PANEL_ID, 'haystack');
      runFindInFiles(PANEL_ID);
    });

    expect(onConfigChange).toHaveBeenCalled();
    for (const [written] of onConfigChange.mock.calls as [FindInFilesPanelConfig][]) {
      expect(Object.keys(written).sort()).toEqual([
        'caseSensitive',
        'replaceShown',
        'replacement',
        'scopeSubPath',
        'term',
        'wholeWord',
      ]);
    }
  });

  it('persists an unscoped panel as the whole root rather than as the sub-directory ""', () => {
    const onConfigChange = vi.fn();
    renderFindInFilesPanel({ onConfigChange });

    fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: 'x' } });

    expect(onConfigChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ scopeSubPath: null, term: 'x' }),
    );
  });
});

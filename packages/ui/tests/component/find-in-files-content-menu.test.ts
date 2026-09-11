/**
 * 043 T075 — the Find in Files panel OPENS its own menu, and the rows in it act (FR-025a).
 *
 * ══ WHY THIS TIER, WHEN A UNIT TEST ALREADY COVERS THE BUILDER ══
 *
 * `tests/unit/find-in-files-menu.test.ts` settles what `findInFilesContentMenu` RETURNS — every row,
 * its section, its chord, its checked state. None of that is worth anything while nothing calls it,
 * and a builder nobody opens is precisely the shape Constitution VI's every-panel-action rule exists
 * to catch: the panel would satisfy the rule on paper and offer no menu at all.
 *
 * So what is asserted here is the JOIN, and only the join — a right-click on the panel puts the app's
 * real `ContextMenu` on screen with these rows in it, and clicking one moves the panel's state. The
 * provider is the real one (see `renderWithContextMenu`), because a stubbed `openMenu` could only
 * ever prove that a function was called with an array.
 *
 * The ORDER of the rows is deliberately not re-asserted: `withDividers`/`groupBySection` decide it
 * from the sections the builder declares, and `unit/menu-sections.test.ts` is what pins that.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  PANEL_ID,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

let bridge: FileSearchStub;

beforeEach(() => {
  __resetFindInFilesState();
  bridge = installFileSearchStub();
});

afterEach(() => {
  removeFileSearchStub();
  __resetFindInFilesState();
});

/** Right-click the panel body — the gesture that opens a content menu everywhere else in throng. */
function openPanelMenu(): void {
  fireEvent.contextMenu(screen.getByTestId(`fif-panel-${PANEL_ID}`));
}

const menu = (): HTMLElement => screen.getByTestId('context-menu');
const labels = (): string[] =>
  [...menu().querySelectorAll('.context-menu__label')].map((el) => el.textContent ?? '');

/** Two files, two folders — enough for grouping and collapse-all to be visible claims. */
function emitResults(): void {
  bridge.emit({
    panelId: PANEL_ID,
    generation: 1,
    status: 'complete',
    rows: [resultRow('src/a.ts', 1, 0), resultRow('lib/b.ts', 2, 20)],
    totalMatches: 2,
    filesScanned: 2,
  });
}

describe('the panel opens its own content menu (T075, FR-025a)', () => {
  it('draws every discrete command and state toggle the panel offers', () => {
    renderFindInFilesPanel();

    openPanelMenu();

    expect(labels()).toEqual(
      expect.arrayContaining([
        'Run search',
        'Replace',
        'Group by file ✓',
        'Group by folder and file',
        'Collapse all',
        'Expand all',
        'Change scope',
        'Replace All',
        'Replace in File',
        'Replace Match',
      ]),
    );
    // FR-073 — the withdrawn grouping has no row. `arrayContaining` above passes over an extra
    // item, so the absence has to be its own assertion or the removal would go unnoticed here.
    expect(labels()).not.toContain('Group by folder');
    expect(screen.queryByTestId('menu-item-Group by folder')).toBeNull();
  });

  it('offers Cancel search, and not Run, while a scan is running', () => {
    renderFindInFilesPanel();
    fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: 'needle' } });
    fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));

    openPanelMenu();

    expect(labels()).toContain('Cancel search');
    expect(labels()).not.toContain('Run search');
  });

  it('runs the search from the menu — the same command the toolbar control invokes', () => {
    renderFindInFilesPanel();
    fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: 'needle' } });

    openPanelMenu();
    fireEvent.click(screen.getByTestId('menu-item-Run search'));

    expect(bridge.start).toHaveBeenCalledTimes(1);
  });

  it('cancels from the menu', () => {
    renderFindInFilesPanel();
    fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: 'needle' } });
    fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));

    openPanelMenu();
    fireEvent.click(screen.getByTestId('menu-item-Cancel search'));

    expect(bridge.cancel).toHaveBeenCalledWith(PANEL_ID);
  });

  it('toggles replace from the menu, and shows its state on the row', () => {
    renderFindInFilesPanel();

    openPanelMenu();
    expect(labels()).toContain('Replace');
    fireEvent.click(screen.getByTestId('menu-item-Replace'));

    expect(screen.getByTestId(`fif-replace-row-${PANEL_ID}`)).toBeInTheDocument();
    openPanelMenu();
    expect(labels()).toContain('Replace ✓');
  });

  it('regroups from the menu without starting a second scan', () => {
    renderFindInFilesPanel();
    emitResults();

    openPanelMenu();
    fireEvent.click(screen.getByTestId('menu-item-Group by folder and file'));

    // Folder headings, each with its file heading beneath it.
    expect(
      screen.queryAllByTestId(/^fif-group-header-/).map((el) => el.dataset.groupKey),
    ).toEqual(['lib', 'lib/b.ts', 'src', 'src/a.ts']);
    expect(bridge.start).not.toHaveBeenCalled();
  });

  it('collapses and expands every group at once', () => {
    renderFindInFilesPanel();
    emitResults();

    openPanelMenu();
    fireEvent.click(screen.getByTestId('menu-item-Collapse all'));
    expect(screen.queryAllByTestId(/^fif-row-/)).toHaveLength(0);

    openPanelMenu();
    fireEvent.click(screen.getByTestId('menu-item-Expand all'));
    expect(screen.queryAllByTestId(/^fif-row-/)).toHaveLength(2);
  });

  it('hands the caret to the scope control — the field where the scope is changed (FR-030)', () => {
    renderFindInFilesPanel();

    openPanelMenu();
    fireEvent.click(screen.getByTestId('menu-item-Change scope'));

    expect(document.activeElement).toBe(screen.getByTestId(`fif-scope-${PANEL_ID}`));
  });

  it('draws the three commit granularities DISABLED rather than hiding them', () => {
    renderFindInFilesPanel();

    openPanelMenu();

    for (const label of ['Replace All', 'Replace in File', 'Replace Match']) {
      const row = screen.getByTestId(`menu-item-${label}`);
      // Constitution VI: a control whose action is temporarily unavailable is drawn and disabled.
      // The enabling state — the replace toggle — is two rows above it in this same menu.
      expect(row.className).toContain('context-menu__item--disabled');
    }
  });
});

describe('the menu closes and leaves the panel alone', () => {
  it('opens one menu at a time, replacing the previous', () => {
    renderFindInFilesPanel();

    openPanelMenu();
    openPanelMenu();

    expect(screen.getAllByTestId('context-menu')).toHaveLength(1);
    cleanup();
  });
});

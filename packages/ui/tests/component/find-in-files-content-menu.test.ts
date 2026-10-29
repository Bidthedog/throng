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
  it('draws the commands that have no other route (060 FR-042)', () => {
    renderFindInFilesPanel();

    openPanelMenu();

    expect(labels()).toEqual(
      expect.arrayContaining([
        'Collapse all',
        'Expand all',
        'Replace All',
        'Replace in File',
        'Replace Match',
        'Open In',
        'Exclude from Find in Files in this project',
      ]),
    );
  });

  it('carries no Replace, exclusions, Group by or Split row: each has its own route (060 FR-042)', () => {
    renderFindInFilesPanel();

    openPanelMenu();

    for (const id of [
      'Replace',
      'Replace ✓',
      'Use search exclusions',
      'Use search exclusions ✓',
      'Group by file',
      'Group by file ✓',
      'Group by folder and file',
      'Group by folder structure',
      'Group by folder',
      'Split',
    ]) {
      expect(labels(), id).not.toContain(id);
      expect(screen.queryByTestId(`menu-item-${id}`), id).toBeNull();
    }
    // The routes that replaced them are on the panel itself.
    expect(screen.getByTestId(`fif-toggle-replace-${PANEL_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`fif-use-excludes-${PANEL_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`fif-grouping-fileAndFolder-${PANEL_ID}`)).toBeInTheDocument();
  });

  it('carries no Run search, Cancel search or Change scope — idle or running (060 FR-022)', () => {
    // Each is reachable without the menu: the run/cancel control, Enter in the search input and the
    // find-in-files chord, and the scope input (Constitution v6.0.0, Principle VI).
    renderFindInFilesPanel();
    fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: 'needle' } });

    openPanelMenu();
    for (const gone of ['Run search', 'Cancel search', 'Change scope']) {
      expect(labels()).not.toContain(gone);
      expect(screen.queryByTestId(`menu-item-${gone}`)).toBeNull();
    }
    cleanup();

    renderFindInFilesPanel();
    fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: 'needle' } });
    fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));
    openPanelMenu();
    for (const gone of ['Run search', 'Cancel search', 'Change scope']) {
      expect(labels()).not.toContain(gone);
    }
  });

  it('still runs and cancels without the menu — through the toolbar control', () => {
    renderFindInFilesPanel();
    fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: 'needle' } });

    fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));
    expect(bridge.start).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId(`fif-cancel-${PANEL_ID}`));
    expect(bridge.cancel).toHaveBeenCalledWith(PANEL_ID);
  });

  it('toggles replace from the toolbar, which enables the commit rows in the menu', () => {
    renderFindInFilesPanel();

    fireEvent.click(screen.getByTestId(`fif-toggle-replace-${PANEL_ID}`));

    expect(screen.getByTestId(`fif-replace-row-${PANEL_ID}`)).toBeInTheDocument();
    openPanelMenu();
    expect(labels()).not.toContain('Replace ✓');
  });

  it('regroups from the toolbar without starting a second scan', () => {
    renderFindInFilesPanel();
    emitResults();

    fireEvent.click(screen.getByTestId(`fif-grouping-fileAndFolder-${PANEL_ID}`));

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

  it('draws the three commit granularities DISABLED rather than hiding them', () => {
    renderFindInFilesPanel();

    openPanelMenu();

    for (const label of ['Replace All', 'Replace in File', 'Replace Match']) {
      const row = screen.getByTestId(`menu-item-${label}`);
      // Constitution VI: a control whose action is temporarily unavailable is drawn and disabled.
      // The enabling state — the replace toggle — is on the panel's toolbar (060 FR-042).
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

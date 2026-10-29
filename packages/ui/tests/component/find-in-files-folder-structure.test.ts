/**
 * 060 US3 / FR-012–FR-018 — the Folder structure grouping: one heading per folder level, the way the
 * File Explorer draws the same tree.
 *
 * The shape itself (nothing merged, scope as the root, counts) is `groupRows`' and is proved in
 * `packages/core`. What only a mounted panel can show is the WIRING: that the control exists and
 * regroups without a scan, that the scope and the explorer's sort preference reach the grouping, that
 * every level opens expanded and answers the heading gestures, and that remembering carries the new
 * value like the other two.
 *
 * Layer: component — controls, headings and their order are DOM facts; no real window is needed.
 */
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@throng/core';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  PANEL_ID,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

/** The panel reads two search preferences and the explorer's sort order; the config store is the one seam. */
const config = vi.hoisted(() => ({ settings: null as unknown as AppSettings }));

vi.mock('../../src/renderer/config/config-store.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/renderer/config/config-store.js')>();
  return { ...actual, useAppSettings: () => config.settings };
});

let bridge: FileSearchStub;

function settings(
  inFiles: Partial<AppSettings['search']['inFiles']> = {},
  sortOrder: AppSettings['explorer']['sortOrder'] = DEFAULT_APP_SETTINGS.explorer.sortOrder,
): AppSettings {
  return {
    ...DEFAULT_APP_SETTINGS,
    search: {
      ...DEFAULT_APP_SETTINGS.search,
      inFiles: { ...DEFAULT_APP_SETTINGS.search.inFiles, ...inFiles },
    },
    explorer: { ...DEFAULT_APP_SETTINGS.explorer, sortOrder },
  };
}

const ROWS = [
  resultRow('src/app.ts', 1, 0),
  resultRow('src/app.ts', 5, 50),
  resultRow('src/deep/er/util.ts', 2, 20),
  resultRow('README.md', 3, 30),
];

function emit(rows = ROWS, generation = 1): void {
  bridge.emit({
    panelId: PANEL_ID,
    generation,
    status: 'complete',
    rows,
    totalMatches: rows.length,
  });
}

const headings = (): string[] =>
  screen.queryAllByTestId(/^fif-group-header-/).map((el) => el.getAttribute('data-group-key') ?? '');
const heading = (key: string): HTMLElement => screen.getByTestId(`fif-group-header-${key}`);
const control = (): HTMLElement => screen.getByTestId(`fif-grouping-folderTree-${PANEL_ID}`);

function chooseFolderTree(): void {
  fireEvent.click(control());
}

beforeEach(() => {
  config.settings = settings();
  __resetFindInFilesState();
  bridge = installFileSearchStub();
});

afterEach(() => {
  removeFileSearchStub();
  __resetFindInFilesState();
});

describe('the toolbar offers Folder structure (FR-012, FR-018)', () => {
  it('draws a third grouping control, titled and pressed like the other two', () => {
    renderFindInFilesPanel();

    expect(control()).toHaveAttribute('title', 'Group by folder structure');
    expect(control()).toHaveAttribute('aria-pressed', 'false');
    expect(control().querySelectorAll('.icon')).toHaveLength(1);

    chooseFolderTree();

    expect(control()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId(`fif-grouping-file-${PANEL_ID}`)).toHaveAttribute('aria-pressed', 'false');
  });

  it('regroups without a new scan, and every grouping reports the same total (FR-015)', () => {
    renderFindInFilesPanel();
    emit();
    const total = (): number => screen.getAllByTestId(/^fif-row-/).length;
    const counts = (): number[] =>
      screen
        .getAllByTestId(/^fif-group-count-/)
        .filter((el) => el.closest('[data-group-kind="file"]'))
        .map((el) => Number(el.textContent?.replace(/[()]/g, '')))
        .sort();

    fireEvent.click(screen.getByTestId(`fif-grouping-file-${PANEL_ID}`));
    const perFile = { total: total(), counts: counts() };
    fireEvent.click(screen.getByTestId(`fif-grouping-fileAndFolder-${PANEL_ID}`));
    const perFolder = { total: total(), counts: counts() };
    chooseFolderTree();
    const tree = { total: total(), counts: counts() };

    expect(bridge.start).not.toHaveBeenCalled();
    expect(tree).toEqual(perFile);
    expect(perFolder).toEqual(perFile);
    expect(tree.total).toBe(4);
  });
});

describe('every heading count reads in brackets, as a row’s position does (FR-013b)', () => {
  it.each(['file', 'fileAndFolder', 'folderTree'] as const)('under %s grouping', (grouping) => {
    renderFindInFilesPanel();
    emit();
    fireEvent.click(screen.getByTestId(`fif-grouping-${grouping}-${PANEL_ID}`));
    const counts = screen.getAllByTestId(/^fif-group-count-/);
    expect(counts.length).toBeGreaterThan(0);
    // The figure is digit-grouped by locale (FR-014); only the brackets around it are under test.
    for (const count of counts) expect(count.textContent).toMatch(/^\(\d[^()]*\)$/);
  });
});

describe('the tree is one heading per level, all open (FR-013, FR-013a, FR-016)', () => {
  it('draws src, src/deep and src/deep/er as three headings, not one merged chain', () => {
    renderFindInFilesPanel();
    emit();

    chooseFolderTree();

    expect(headings()).toEqual(
      expect.arrayContaining(['src', 'src/deep', 'src/deep/er', 'src/deep/er/util.ts', 'src/app.ts']),
    );
    expect(headings()).not.toContain('src/deep/er/');
    // Each level carries the count of everything beneath it.
    expect(screen.getByTestId('fif-group-count-src')).toHaveTextContent('3');
    expect(screen.getByTestId('fif-group-count-src/deep')).toHaveTextContent('1');
  });

  it('opens every level expanded, so every row is reachable without an expand action', () => {
    renderFindInFilesPanel();
    emit();

    chooseFolderTree();

    for (const key of ['src', 'src/deep', 'src/deep/er', 'src/app.ts']) {
      expect(screen.getByTestId(`fif-group-toggle-${key}`)).toHaveAttribute('aria-expanded', 'true');
    }
    expect(screen.getAllByTestId(/^fif-row-/)).toHaveLength(4);
  });

  it('gives a folder heading the .fif-group affordance a file heading has (043 FR-085)', () => {
    renderFindInFilesPanel();
    emit();
    chooseFolderTree();

    expect(heading('src')).toHaveClass('fif-group');
    expect(heading('src')).toHaveAttribute('data-group-kind', 'folder');
  });

  it('toggles a folder heading on double-click, and a folder’s whole subtree goes with it', () => {
    renderFindInFilesPanel();
    emit();
    chooseFolderTree();

    fireEvent.doubleClick(heading('src'));

    expect(screen.getByTestId('fif-group-toggle-src')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('fif-group-header-src/app.ts')).toBeNull();
    expect(screen.queryByTestId('fif-group-header-src/deep/er')).toBeNull();

    fireEvent.doubleClick(heading('src'));

    expect(screen.getByTestId('fif-group-header-src/deep/er')).toBeInTheDocument();
  });

  it('Collapse all and Expand all reach every level', async () => {
    const user = userEvent.setup();
    renderFindInFilesPanel();
    emit();
    chooseFolderTree();

    await user.pointer({ target: screen.getByTestId(`fif-status-${PANEL_ID}`), keys: '[MouseRight]' });
    await user.click(screen.getByTestId('menu-item-Collapse all'));

    // Collapsed at the top: only the two top-level headings remain mounted, each collapsed.
    expect(headings()).toEqual(['src', 'README.md']);
    expect(screen.getByTestId('fif-group-toggle-src')).toHaveAttribute('aria-expanded', 'false');

    await user.pointer({ target: screen.getByTestId(`fif-status-${PANEL_ID}`), keys: '[MouseRight]' });
    await user.click(screen.getByTestId('menu-item-Expand all'));

    expect(screen.getByTestId('fif-group-toggle-src/deep/er')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByTestId(/^fif-row-/)).toHaveLength(4);
  });
});

describe('the scope the search RAN with is the root of the tree (R3)', () => {
  const SCOPED = [resultRow('src/app.ts', 1, 0), resultRow('src/deep/util.ts', 2, 20)];

  /** Type a term and a scope, run, and deliver the rows that run produced. */
  function runScoped(scope: string): void {
    fireEvent.change(screen.getByTestId(`fif-term-${PANEL_ID}`), { target: { value: 'needle' } });
    fireEvent.change(screen.getByTestId(`fif-scope-${PANEL_ID}`), { target: { value: scope } });
    fireEvent.click(screen.getByTestId(`fif-run-${PANEL_ID}`));
    emit(SCOPED);
  }

  function expectRootedAtSrc(): void {
    expect(headings()).not.toContain('src');
    expect(heading('src/deep')).toHaveAttribute('data-depth', '0');
    expect(heading('src/app.ts')).toHaveAttribute('data-depth', '0');
  }

  it('starts the tree below the scope: the scope itself is not a heading', () => {
    renderFindInFilesPanel();
    runScoped('src');

    chooseFolderTree();

    expectRootedAtSrc();
  });

  it('roots the tree at the scope when it was typed as an absolute path', () => {
    renderFindInFilesPanel();
    runScoped('D:/proj/src');

    chooseFolderTree();

    expectRootedAtSrc();
  });

  it('roots the tree at the scope when it was typed with backslashes and a trailing slash', () => {
    renderFindInFilesPanel();
    runScoped('src\\');

    chooseFolderTree();

    expectRootedAtSrc();
  });

  it('leaves the tree alone when the box is edited but not run (FR-072)', () => {
    renderFindInFilesPanel();
    runScoped('src');
    chooseFolderTree();

    fireEvent.change(screen.getByTestId(`fif-scope-${PANEL_ID}`), { target: { value: 'src/deep' } });

    expectRootedAtSrc();
  });

  it('roots a MIRRORED view, which never ran the search, at the scope the run reports', () => {
    renderFindInFilesPanel();
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      snapshot: true,
      rows: SCOPED,
      totalMatches: SCOPED.length,
      scopeRel: 'src',
    });

    chooseFolderTree();

    expectRootedAtSrc();
  });

  it('roots a whole-project run at the project root', () => {
    renderFindInFilesPanel();
    runScoped('');

    chooseFolderTree();

    expect(headings()).toContain('src');
    expect(heading('src')).toHaveAttribute('data-depth', '0');
  });
});

describe('the explorer’s sort order orders the tree (FR-014)', () => {
  const FILES = [resultRow('a2.ts', 1, 0), resultRow('a10.ts', 1, 0)];

  it('puts a2.ts before a10.ts under natural order', () => {
    config.settings = settings({}, 'natural');
    renderFindInFilesPanel();
    emit(FILES);

    chooseFolderTree();

    expect(headings()).toEqual(['a2.ts', 'a10.ts']);
  });

  it('puts a10.ts before a2.ts under character order', () => {
    config.settings = settings({}, 'characters');
    renderFindInFilesPanel();
    emit(FILES);

    chooseFolderTree();

    expect(headings()).toEqual(['a10.ts', 'a2.ts']);
  });

  it('lists folders before files, as the explorer does', () => {
    renderFindInFilesPanel();
    emit([resultRow('a.ts', 1, 0), resultRow('z/b.ts', 1, 0)]);

    chooseFolderTree();

    expect(headings()[0]).toBe('z');
  });
});

describe('the grouping preference can name Folder structure (FR-017; 060 FR-046 retired remembering)', () => {
  it('opens in Folder structure when the default-grouping preference names it', () => {
    config.settings = settings({ defaultGrouping: 'folderTree' });

    renderFindInFilesPanel();

    expect(control()).toHaveAttribute('aria-pressed', 'true');
  });
});

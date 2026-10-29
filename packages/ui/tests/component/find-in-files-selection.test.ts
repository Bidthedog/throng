/**
 * 060 US4 / FR-003 — the selection is an ITEM, not a slot.
 *
 * The results list used to keep the reading position as an index into the flattened list. Three
 * things break an index (research R4): rows arriving mid-scan shift every later one (FR-003), a
 * regroup reorders everything (FR-015a), and a click has to name an item rather than a position
 * (FR-020). So the list keeps the selected item's KEY and derives the index each render.
 *
 * Layer: component — what is selected, what is focused and what the keys do are all DOM facts a
 * jsdom render answers; no real window is needed.
 */
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  registerResultOpener,
  type ResultOpenRequest,
} from '../../src/renderer/find-in-files/result-open.js';
import {
  PANEL_ID,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

let bridge: FileSearchStub;

const list = (): HTMLElement => screen.getByTestId(`fif-results-${PANEL_ID}`);
const rowEl = (relPath: string, from: number): HTMLElement =>
  screen.getByTestId(`fif-row-${relPath}-${from}`);
const heading = (key: string): HTMLElement => screen.getByTestId(`fif-group-header-${key}`);

type Batch = ReturnType<typeof resultRow>[];

function emit(
  generation: number,
  status: 'running' | 'complete',
  rows: Batch,
  total = rows.length,
): void {
  bridge.emit({ panelId: PANEL_ID, generation, status, rows, totalMatches: total });
}

function down(times = 1): void {
  for (let i = 0; i < times; i += 1) fireEvent.keyDown(list(), { key: 'ArrowDown' });
}

beforeEach(() => {
  __resetFindInFilesState();
  bridge = installFileSearchStub();
});

afterEach(() => {
  registerResultOpener(null);
  removeFileSearchStub();
  __resetFindInFilesState();
});

describe('the selected row survives rows arriving in the same scan (FR-003)', () => {
  it('keeps data-current on the selected row when a later batch lands above and below it', () => {
    renderFindInFilesPanel();
    emit(1, 'running', [resultRow('src/b.ts', 1, 10), resultRow('src/b.ts', 2, 20)]);
    // Nothing is selected yet, so the first press selects item 0: heading (0), b.ts:10 (1), b.ts:20 (2).
    down(3);
    expect(rowEl('src/b.ts', 20)).toHaveAttribute('data-current', 'true');

    // A file that sorts BEFORE b.ts, a match that sorts before b.ts:20 and one file after it.
    emit(1, 'running', [
      resultRow('src/a.ts', 1, 5),
      resultRow('src/b.ts', 1, 15),
      resultRow('src/c.ts', 1, 5),
    ]);

    expect(rowEl('src/b.ts', 20)).toHaveAttribute('data-current', 'true');
    expect(rowEl('src/b.ts', 20)).toHaveAttribute('aria-current', 'true');
    expect(document.querySelectorAll('[data-current="true"]')).toHaveLength(1);
  });

  it('leaves document.activeElement where it was', () => {
    renderFindInFilesPanel();
    emit(1, 'running', [resultRow('src/b.ts', 1, 10)]);
    list().focus();
    down();
    expect(document.activeElement).toBe(list());

    emit(1, 'running', [resultRow('src/a.ts', 1, 5), resultRow('src/c.ts', 1, 5)]);

    expect(document.activeElement).toBe(list());
  });

  it('keeps stepping from the selected row, not from the slot it used to occupy', () => {
    renderFindInFilesPanel();
    emit(1, 'running', [resultRow('src/b.ts', 1, 10), resultRow('src/b.ts', 2, 20)]);
    down(2); // heading, then b.ts:10
    expect(rowEl('src/b.ts', 10)).toHaveAttribute('data-current', 'true');
    emit(1, 'running', [resultRow('src/a.ts', 1, 5)]);

    down();

    expect(rowEl('src/b.ts', 20)).toHaveAttribute('data-current', 'true');
  });
});

describe('with nothing selected the keys start at the ends of the list (FR-021)', () => {
  function seed(): void {
    renderFindInFilesPanel();
    emit(1, 'complete', [
      resultRow('src/a.ts', 1, 1),
      resultRow('src/a.ts', 2, 2),
      resultRow('src/b.ts', 1, 3),
    ]);
  }

  it('ArrowDown selects the FIRST item, not the second', () => {
    seed();
    down();
    expect(heading('src/a.ts')).toHaveAttribute('data-current', 'true');
  });

  it('ArrowUp selects the first item', () => {
    seed();
    fireEvent.keyDown(list(), { key: 'ArrowUp' });
    expect(heading('src/a.ts')).toHaveAttribute('data-current', 'true');
  });

  it('Home selects the first item and End the last', () => {
    seed();
    fireEvent.keyDown(list(), { key: 'Home' });
    expect(heading('src/a.ts')).toHaveAttribute('data-current', 'true');
    // A fresh run clears the selection again.
    emit(2, 'complete', [resultRow('src/a.ts', 1, 1), resultRow('src/b.ts', 1, 3)]);
    fireEvent.keyDown(list(), { key: 'End' });
    expect(rowEl('src/b.ts', 3)).toHaveAttribute('data-current', 'true');
  });

  it('Enter does nothing: it does not open a row or toggle a heading nobody selected', () => {
    const opened: ResultOpenRequest[] = [];
    registerResultOpener((r) => opened.push(r));
    seed();

    fireEvent.keyDown(list(), { key: 'Enter' });

    expect(opened).toEqual([]);
    expect(screen.getByTestId('fif-group-toggle-src/a.ts')).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('keyboard navigation is unchanged (FR-021)', () => {
  function seed(): void {
    renderFindInFilesPanel();
    emit(1, 'complete', [
      resultRow('src/a.ts', 1, 1),
      resultRow('src/a.ts', 2, 2),
      resultRow('src/b.ts', 1, 3),
    ]);
  }

  it('ArrowDown and ArrowUp step through headings and rows alike', () => {
    seed();
    // Nothing is selected until the reader acts, so no item carries the marker yet.
    expect(document.querySelectorAll('[data-current="true"]')).toHaveLength(0);

    down();
    expect(heading('src/a.ts')).toHaveAttribute('data-current', 'true');
    down();
    expect(rowEl('src/a.ts', 1)).toHaveAttribute('data-current', 'true');
    down(2);
    expect(heading('src/b.ts')).toHaveAttribute('data-current', 'true');

    fireEvent.keyDown(list(), { key: 'ArrowUp' });
    expect(rowEl('src/a.ts', 2)).toHaveAttribute('data-current', 'true');
  });

  it('Home and End jump to the first and last items', () => {
    seed();

    fireEvent.keyDown(list(), { key: 'End' });
    expect(rowEl('src/b.ts', 3)).toHaveAttribute('data-current', 'true');

    fireEvent.keyDown(list(), { key: 'Home' });
    expect(heading('src/a.ts')).toHaveAttribute('data-current', 'true');
  });
});

describe('selection resets and follows collapse', () => {
  it('[derived] a new generation clears the selection (043’s shipped reset)', () => {
    renderFindInFilesPanel();
    emit(1, 'complete', [resultRow('src/a.ts', 1, 1), resultRow('src/a.ts', 2, 2)]);
    down(3);
    expect(rowEl('src/a.ts', 2)).toHaveAttribute('data-current', 'true');

    emit(2, 'complete', [resultRow('src/a.ts', 1, 1), resultRow('src/a.ts', 2, 2)]);

    expect(document.querySelectorAll('[data-current="true"]')).toHaveLength(0);
  });

  it('[derived] collapsing the heading over the selected row moves the selection to the heading', () => {
    renderFindInFilesPanel();
    emit(1, 'complete', [resultRow('src/a.ts', 1, 1), resultRow('src/a.ts', 2, 2)]);
    down(3);
    expect(rowEl('src/a.ts', 2)).toHaveAttribute('data-current', 'true');

    fireEvent.click(screen.getByTestId('fif-group-toggle-src/a.ts'));

    expect(heading('src/a.ts')).toHaveAttribute('data-current', 'true');
    expect(document.querySelectorAll('[data-current="true"]')).toHaveLength(1);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * 060 US4 — a single click selects; it does not open and it does not toggle
 * ────────────────────────────────────────────────────────────────────────── */

describe('a single click selects (FR-020, FR-020a)', () => {
  function seed(): void {
    renderFindInFilesPanel();
    emit(1, 'complete', [resultRow('src/a.ts', 1, 1), resultRow('src/a.ts', 2, 2)]);
  }

  it('selects a row and opens nothing (SC-006)', () => {
    const opened: ResultOpenRequest[] = [];
    registerResultOpener((r) => opened.push(r));
    seed();

    fireEvent.click(rowEl('src/a.ts', 2));

    expect(rowEl('src/a.ts', 2)).toHaveAttribute('data-current', 'true');
    expect(opened).toEqual([]);
  });

  it('still opens a row on double-click', () => {
    const opened: ResultOpenRequest[] = [];
    registerResultOpener((r) => opened.push(r));
    seed();

    fireEvent.doubleClick(rowEl('src/a.ts', 2));

    expect(opened).toHaveLength(1);
  });

  it('selects a heading from its label without collapsing or expanding it', () => {
    seed();

    fireEvent.click(heading('src/a.ts').querySelector('.fif-group__key') as HTMLElement);

    expect(heading('src/a.ts')).toHaveAttribute('data-current', 'true');
    expect(screen.getByTestId('fif-group-toggle-src/a.ts')).toHaveAttribute('aria-expanded', 'true');
  });

  it('toggles from the chevron in one click, without selecting the heading', () => {
    seed();

    fireEvent.click(screen.getByTestId('fif-group-toggle-src/a.ts'));

    expect(screen.getByTestId('fif-group-toggle-src/a.ts')).toHaveAttribute('aria-expanded', 'false');
    expect(heading('src/a.ts')).not.toHaveAttribute('data-current');
  });

  it('toggles a heading on double-click and on Enter', () => {
    seed();

    // A real double-click is two clicks then a dblclick; the first click selects the heading.
    fireEvent.click(heading('src/a.ts'));
    fireEvent.doubleClick(heading('src/a.ts'));
    expect(screen.getByTestId('fif-group-toggle-src/a.ts')).toHaveAttribute('aria-expanded', 'false');

    // The heading is selected, so Enter acts on it.
    fireEvent.keyDown(list(), { key: 'Enter' });
    expect(screen.getByTestId('fif-group-toggle-src/a.ts')).toHaveAttribute('aria-expanded', 'true');
  });

  it('ignores a modified click, as the double-click does', () => {
    seed();

    fireEvent.click(rowEl('src/a.ts', 2), { ctrlKey: true });
    fireEvent.click(heading('src/a.ts').querySelector('.fif-group__key') as HTMLElement, {
      shiftKey: true,
    });

    expect(document.querySelectorAll('[data-current="true"]')).toHaveLength(0);
  });
});

describe('a regroup keeps the selection and brings it into view (FR-015a)', () => {
  /** 60 one-match files in 60 folders: the flat list is 120 items, the grouped one 180. */
  function manyFolders(): ReturnType<typeof resultRow>[] {
    return Array.from({ length: 60 }, (_, i) =>
      resultRow(`d${String(i).padStart(2, '0')}/f.ts`, 1, 0),
    );
  }

  function scrollTo(px: number): void {
    Object.defineProperty(list(), 'scrollTop', { value: px, configurable: true });
    Object.defineProperty(list(), 'clientHeight', { value: 480, configurable: true });
    fireEvent.scroll(list());
  }

  it('keeps a selected row selected and mounts it after the list grows under it', () => {
    renderFindInFilesPanel();
    emit(1, 'complete', manyFolders());
    // Scroll to the end of the 120-item flat list and select the last row.
    scrollTo(120 * 22 - 480);
    fireEvent.click(rowEl('d59/f.ts', 0));
    expect(rowEl('d59/f.ts', 0)).toHaveAttribute('data-current', 'true');

    fireEvent.click(screen.getByTestId(`fif-grouping-fileAndFolder-${PANEL_ID}`));

    // 180 items now, and the row is at index 179 — far past the window the old offset mounts.
    expect(rowEl('d59/f.ts', 0)).toHaveAttribute('data-current', 'true');
  });

  it('hands a selected folder heading to its first row when the new grouping has no such heading', () => {
    renderFindInFilesPanel();
    emit(1, 'complete', [resultRow('src/a.ts', 1, 1), resultRow('src/a.ts', 2, 2)]);
    fireEvent.click(screen.getByTestId(`fif-grouping-fileAndFolder-${PANEL_ID}`));
    fireEvent.click(heading('src').querySelector('.fif-group__key') as HTMLElement);
    expect(heading('src')).toHaveAttribute('data-current', 'true');

    fireEvent.click(screen.getByTestId(`fif-grouping-file-${PANEL_ID}`));

    expect(rowEl('src/a.ts', 1)).toHaveAttribute('data-current', 'true');
    expect(document.querySelectorAll('[data-current="true"]')).toHaveLength(1);
  });

  it('keeps a selected file heading, which every grouping has', () => {
    renderFindInFilesPanel();
    emit(1, 'complete', [resultRow('src/a.ts', 1, 1)]);
    fireEvent.click(heading('src/a.ts').querySelector('.fif-group__key') as HTMLElement);

    fireEvent.click(screen.getByTestId(`fif-grouping-fileAndFolder-${PANEL_ID}`));

    expect(heading('src/a.ts')).toHaveAttribute('data-current', 'true');
  });

  it('with nothing selected, selects nothing', () => {
    renderFindInFilesPanel();
    emit(1, 'complete', [resultRow('src/a.ts', 1, 1)]);

    fireEvent.click(screen.getByTestId(`fif-grouping-fileAndFolder-${PANEL_ID}`));

    expect(document.querySelectorAll('[data-current="true"]')).toHaveLength(0);
  });
});

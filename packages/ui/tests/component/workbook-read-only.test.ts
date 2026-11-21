/**
 * 073 FR-050a, FR-050b — a workbook preview says it is read-only, and says it again when an edit is tried (maintainer's
 * design, approved 2026-11-20): a permanent **Read-only** marker with a padlock on its status bar, and every edit attempt
 * on the grid flashes that same marker — one condition, one notice, no toast and no second notice.
 *
 * Layer: component — the status bar, the shared grid and the flash store, as the workbook preview wires them.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGrid, type DataGridProps } from '../../src/renderer/grid/data-grid.js';
import { PreviewStatusBar } from '../../src/renderer/preview/preview-status-bar.js';
import {
  READ_ONLY_PULSE_MS,
  WORKBOOK_READ_ONLY_TITLE,
  requestReadOnlyFlash,
  subscribeReadOnlyFlash,
} from '../../src/renderer/preview/read-only-marker.js';
import { drawnIcon, iconMarkup } from './helpers/icon-markup.js';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

const bar = (readOnly: boolean) =>
  render(
    createElement(PreviewStatusBar, {
      panelId: 's1',
      providerKind: 'binary',
      parented: false,
      onEditorRoute: () => {},
      syncScroll: false,
      onToggleSyncScroll: () => {},
      readOnly,
    }),
  );

describe('the Read-only marker (073 FR-050a)', () => {
  it('a workbook preview\'s status bar carries it: a padlock, the words, and the hover saying how to edit', () => {
    bar(true);
    const marker = screen.getByTestId('preview-read-only-s1');
    expect(marker).toHaveTextContent('Read-only');
    expect(marker.getAttribute('title')).toBe(WORKBOOK_READ_ONLY_TITLE);
    expect(WORKBOOK_READ_ONLY_TITLE).toBe('Workbooks open read-only. Copy cells and paste them into a CSV to edit them.');
    expect(drawnIcon(marker)).toBe(iconMarkup('readOnly'));
  });

  it('a binary preview that is not read-only draws no bar for it', () => {
    bar(false);
    expect(screen.queryByTestId('preview-read-only-s1')).toBeNull();
  });

  it('an edit attempt flashes it; a repeat during the flash is absorbed, not a second flash', () => {
    vi.useFakeTimers();
    bar(true);
    const marker = screen.getByTestId('preview-read-only-s1');
    expect(marker.getAttribute('data-pulsing')).toBeNull();
    act(() => requestReadOnlyFlash('s1'));
    expect(marker.getAttribute('data-pulsing')).toBe('true');
    const pulses = Number(marker.getAttribute('data-pulse-count'));
    act(() => requestReadOnlyFlash('s1'));
    expect(Number(marker.getAttribute('data-pulse-count'))).toBe(pulses);
    act(() => void vi.advanceTimersByTime(READ_ONLY_PULSE_MS));
    expect(marker.getAttribute('data-pulsing')).toBeNull();
    act(() => requestReadOnlyFlash('s1'));
    expect(Number(marker.getAttribute('data-pulse-count'))).toBe(pulses + 1);
    // One marker, never a second notice.
    expect(document.querySelectorAll('[data-testid="preview-read-only-s1"]')).toHaveLength(1);
  });
});

describe('every edit attempt on a read-only grid is reported, and edits nothing (073 FR-050b)', () => {
  const mountGrid = () => {
    const onEditAttempt = vi.fn();
    const props: DataGridProps = {
      testId: 'g',
      rowCount: 3,
      colCount: 3,
      getCell: (r, c) => `v${r}.${c}`,
      editable: false,
      columnWidths: {},
      zoom: 1,
      onColumnWidthChange: () => {},
      onEditAttempt,
    };
    render(createElement(DataGrid, props));
    const root = screen.getByTestId('g');
    root.focus();
    return { root, onEditAttempt };
  };
  const noEditor = (): void => expect(document.querySelector('textarea')).toBeNull();

  const keys: [string, Parameters<typeof fireEvent.keyDown>[1]][] = [
    ['a printable key', { key: 'x' }],
    ['Enter', { key: 'Enter' }],
    ['F2', { key: 'F2' }],
    ['Delete', { key: 'Delete' }],
    ['Backspace', { key: 'Backspace' }],
    ['Ctrl+Z', { key: 'z', ctrlKey: true }],
    ['Ctrl+Y', { key: 'y', ctrlKey: true }],
    ['Cmd+Z', { key: 'z', metaKey: true }],
  ];
  for (const [name, init] of keys) {
    it(name, () => {
      const { root, onEditAttempt } = mountGrid();
      fireEvent.keyDown(root, init);
      expect(onEditAttempt).toHaveBeenCalledTimes(1);
      noEditor();
    });
  }

  it('a double-click on a cell', () => {
    const { onEditAttempt } = mountGrid();
    fireEvent.doubleClick(document.querySelector('[data-grid-cell][data-row="1"][data-col="1"]')!);
    expect(onEditAttempt).toHaveBeenCalledTimes(1);
    noEditor();
  });

  it('Cut and Paste (Ctrl/Cmd+X, Ctrl/Cmd+V), whose default is cancelled', () => {
    const { root, onEditAttempt } = mountGrid();
    const cut = new Event('cut', { bubbles: true, cancelable: true });
    root.dispatchEvent(cut);
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'z' } });
    root.dispatchEvent(paste);
    expect(onEditAttempt).toHaveBeenCalledTimes(2);
    expect([cut.defaultPrevented, paste.defaultPrevented]).toEqual([true, true]);
  });

  it('moving, selecting and copying are not edit attempts', () => {
    const { root, onEditAttempt } = mountGrid();
    fireEvent.keyDown(root, { key: 'ArrowDown' });
    fireEvent.keyDown(root, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(root, { key: 'Tab' });
    root.dispatchEvent(new Event('copy', { bubbles: true, cancelable: true }));
    expect(onEditAttempt).not.toHaveBeenCalled();
  });
});

describe('the flash store (073 FR-050b)', () => {
  it('tells only the panel it names', () => {
    const mine = vi.fn();
    const other = vi.fn();
    const stopMine = subscribeReadOnlyFlash('s1', mine);
    const stopOther = subscribeReadOnlyFlash('s2', other);
    requestReadOnlyFlash('s1');
    stopMine();
    stopOther();
    expect([mine.mock.calls.length, other.mock.calls.length]).toEqual([1, 0]);
  });
});

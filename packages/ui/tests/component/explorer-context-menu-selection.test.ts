/**
 * Right-clicking a row that is part of a multi-selection keeps the selection, so the context menu's
 * Cut and Copy act on every selected item (`context-menu-items.ts` already targets the selection when
 * the clicked row is in it). Right-clicking a row OUTSIDE the selection selects that row alone.
 *
 * Found in manual testing of 050 (MT-01): Ctrl+click two files, right-click one, Copy — only the
 * right-clicked file was left selected and copied.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  installResizeObserver,
  mountExplorer,
  standardHost,
  uninstallResizeObserver,
} from './helpers/explorer-harness.js';
import { asKeyboardMenu } from '../../src/renderer/workspace/keyboard-menu.js';

beforeAll(installResizeObserver);
afterAll(uninstallResizeObserver);
beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

const row = (tree: HTMLElement, name: string): HTMLElement =>
  within(tree).getByText(name).closest('.tree-row') as HTMLElement;

const selectedRows = (tree: HTMLElement): string[] =>
  [...tree.querySelectorAll('.tree-row--selected .tree-label')].map((el) => el.textContent ?? '');

async function chooseCopy(): Promise<void> {
  fireEvent.click(await screen.findByTestId('menu-item-Copy'));
}

describe('right-click on a multi-selection (050 MT-01)', () => {
  it('keeps both Ctrl+clicked files selected and copies both', async () => {
    const m = await mountExplorer(standardHost);
    await waitFor(() => row(m.tree, 'b.txt'));

    fireEvent.click(row(m.tree, 'a.txt'), { ctrlKey: true });
    fireEvent.click(row(m.tree, 'b.txt'), { ctrlKey: true });
    await waitFor(() => expect(selectedRows(m.tree).sort()).toEqual(['a.txt', 'b.txt']));

    fireEvent.contextMenu(row(m.tree, 'b.txt'));
    await chooseCopy();

    expect(selectedRows(m.tree).sort()).toEqual(['a.txt', 'b.txt']);
    await waitFor(() => expect(m.clipboard.api.set).toHaveBeenCalled());
    expect([...m.clipboard.api.set.mock.calls[0][1]].sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('keeps a Shift+click range selected when one of its rows is right-clicked', async () => {
    const m = await mountExplorer(standardHost);
    await waitFor(() => row(m.tree, 'b.txt'));

    fireEvent.click(row(m.tree, 'a.txt'));
    fireEvent.click(row(m.tree, 'b.txt'), { shiftKey: true });
    await waitFor(() => expect(selectedRows(m.tree).sort()).toEqual(['a.txt', 'b.txt']));

    fireEvent.contextMenu(row(m.tree, 'a.txt'));
    await chooseCopy();

    expect(selectedRows(m.tree).sort()).toEqual(['a.txt', 'b.txt']);
    await waitFor(() => expect(m.clipboard.api.set).toHaveBeenCalled());
    expect([...m.clipboard.api.set.mock.calls[0][1]].sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('keeps a Shift+Arrow selection when the menu is opened from the keyboard (Shift+F10)', async () => {
    const m = await mountExplorer(standardHost);
    await waitFor(() => row(m.tree, 'b.txt'));

    fireEvent.click(row(m.tree, 'a.txt'));
    fireEvent.keyDown(m.tree, { key: 'ArrowDown', shiftKey: true });
    await waitFor(() => expect(selectedRows(m.tree).sort()).toEqual(['a.txt', 'b.txt']));

    // What `menu.open` does (window-dispatcher.tsx): a keyboard contextmenu on the highlighted row.
    const focused = m.tree.querySelector('[data-tree-focused="true"]') as HTMLElement;
    asKeyboardMenu(() =>
      focused.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
    );
    await chooseCopy();

    expect(selectedRows(m.tree).sort()).toEqual(['a.txt', 'b.txt']);
    await waitFor(() => expect(m.clipboard.api.set).toHaveBeenCalled());
    expect([...m.clipboard.api.set.mock.calls[0][1]].sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('selects only the right-clicked file when it is outside the selection', async () => {
    const m = await mountExplorer(standardHost);
    await waitFor(() => row(m.tree, 'b.txt'));

    fireEvent.click(row(m.tree, 'a.txt'), { ctrlKey: true });
    fireEvent.click(row(m.tree, 'Docs'), { ctrlKey: true });
    await waitFor(() => expect(selectedRows(m.tree).sort()).toEqual(['Docs', 'a.txt']));

    fireEvent.contextMenu(row(m.tree, 'b.txt'));
    await chooseCopy();

    expect(selectedRows(m.tree)).toEqual(['b.txt']);
    await waitFor(() => expect(m.clipboard.api.set).toHaveBeenCalled());
    expect([...m.clipboard.api.set.mock.calls[0][1]]).toEqual(['b.txt']);
  });
});

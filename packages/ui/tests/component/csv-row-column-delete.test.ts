/**
 * T4 (Delete Row / Delete Column) and T5 (inserting into a blank CSV) — the CSV Preview Editor's menus.
 *
 * Layer: component — which menu rows the grid draws, whether each is enabled and why not, and the text the
 * document holds after one. The bridge stands in for main by resolving each grid operation against the current
 * text with the same core resolver main uses, one operation to one history step (as `csv-entry-row.test.ts` does);
 * main's own dirty state, undo and save are `csv-grid-service.integration.test.ts`'s, and the byte rules are
 * `csv-edit.test.ts`'s.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCsvChanges, resolveGridOperation, type CsvGridOperation } from '@throng/core/csv';
import { CsvBody } from '../../src/renderer/preview/providers/csv/csv-body.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';
import { __resetCopiedBlock } from '../../src/renderer/grid/copied-block.js';
import { __resetColumnWidthCache } from '../../src/renderer/preview/providers/csv/column-widths.js';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';
import { runCsvGridCommand } from '../../src/renderer/grid/grid-commands.js';
import { menuWithSubmenu } from './helpers/expand-submenus.js';

const props = (text: string): PreviewBodyProps => ({
  panelId: 'p1',
  content: { kind: 'text', text },
  filePath: 'D:/proj/data.csv',
  projectRoot: 'D:/proj',
  providerSettings: { enabled: true },
  initialViewState: undefined,
  onViewStateCapture: () => {},
  onFollow: () => {},
  onNotice: () => {},
  onDrawn: () => {},
  onBodyFailure: () => {},
});

const view = (text: string) => createElement(ContextMenuProvider, { children: createElement(CsvBody, props(text)) });

function mountDocument(initial: string) {
  const history: string[] = [];
  let text = initial;
  const h = render(view(text));
  const show = (next: string): void => {
    text = next;
    h.rerender(view(text));
  };
  const gridEdit = vi.fn(async ({ operation }: { operation: CsvGridOperation }) => {
    const resolved = resolveGridOperation(text, operation);
    if (!('changes' in resolved) || resolved.changes.length === 0) return { ok: false, reason: 'unchanged' };
    history.push(text);
    show(applyCsvChanges(text, resolved.changes));
    return { ok: true, dirty: true };
  });
  const gridUndo = vi.fn(async () => {
    const before = history.pop();
    if (before !== undefined) show(before);
    return { ok: true };
  });
  window.throng = {
    preview: { gridEdit, gridUndo, gridRedo: vi.fn(async () => ({ ok: true })), gridSave: vi.fn(async () => ({ ok: true })) },
    clipboard: { write: vi.fn(async () => {}), writeRich: vi.fn(async () => {}), paste: vi.fn(async () => ({ text: '' })) },
  } as unknown as typeof window.throng;
  return { gridEdit, gridUndo, text: () => text };
}

const rowHead = (r: number): HTMLElement => document.querySelector<HTMLElement>(`[role="rowheader"][data-row="${r}"]`)!;
const colHead = (c: number): HTMLElement => document.querySelector<HTMLElement>(`[role="columnheader"][data-col="${c}"]`)!;
const cellAt = (r: number, c: number): HTMLElement =>
  document.querySelector<HTMLElement>(`[data-grid-cell][data-row="${r}"][data-col="${c}"]`)!;
const item = (label: string): HTMLElement | null => screen.queryByTestId(`menu-item-${label}`);
const menuOn = (el: HTMLElement): void => {
  fireEvent.contextMenu(el, { clientX: 5, clientY: 5 });
};
/** Right-click `el` and open its Insert ▸ submenu, where every insert lives (T14). */
const insertMenuOn = (el: HTMLElement): void => {
  menuWithSubmenu(el, 'Insert');
};
const closeMenu = (): void => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
};
const expectDisabled = (label: string, reason: string): void => {
  const row = item(label);
  expect(row, label).not.toBeNull();
  expect(row?.getAttribute('aria-disabled'), label).toBe('true');
  expect(row?.getAttribute('title'), label).toBe(reason);
};
const expectEnabled = (label: string): void => {
  expect(item(label), label).not.toBeNull();
  expect(item(label)?.getAttribute('aria-disabled'), label).not.toBe('true');
};

beforeEach(() => {
  const range = Range.prototype as unknown as Record<string, unknown>;
  range.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  range.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetCopiedBlock();
  __resetPreviewStore();
  __resetColumnWidthCache();
  delete window.throng;
});

describe('Delete Row (T4)', () => {
  it('a row header deletes its record, as one undo step', async () => {
    const doc = mountDocument('a,b\n1,2\n3,4\n');
    menuOn(rowHead(1));
    fireEvent.click(item('Delete Row')!);
    await waitFor(() => expect(doc.text()).toBe('a,b\n3,4\n'));
    expect(doc.gridEdit).toHaveBeenCalledTimes(1);
    expect(doc.gridEdit.mock.calls[0]?.[0].operation).toEqual({ kind: 'deleteRows', from: 1, count: 1 });
    await doc.gridUndo();
    await waitFor(() => expect(doc.text()).toBe('a,b\n1,2\n3,4\n'));
  });

  it('is named for the count, and the row header menu offers it right after Clear Cells (T7)', async () => {
    const doc = mountDocument('a,b\n1,2\n3,4\n');
    fireEvent.mouseDown(rowHead(1), { button: 0 });
    fireEvent.mouseUp(window);
    fireEvent.mouseDown(rowHead(2), { button: 0, shiftKey: true });
    fireEvent.mouseUp(window);
    menuOn(rowHead(2));
    expectEnabled('Clear Cells');
    expectEnabled('Delete Rows');
    expect(item('Delete Row')).toBeNull();
    expect(item('Delete Column')).toBeNull();
    const labels = [...document.querySelectorAll('[data-testid^="menu-item-"]')].map((el) => el.getAttribute('data-testid'));
    expect(labels.indexOf('menu-item-Delete Rows')).toBe(labels.indexOf('menu-item-Clear Cells') + 1);
    fireEvent.click(item('Delete Rows')!);
    await waitFor(() => expect(doc.text()).toBe('a,b\n'));
    expect(doc.gridEdit).toHaveBeenCalledTimes(1);
  });

  it('is drawn disabled, saying why, on the entry row alone', () => {
    mountDocument('a,b\n1,2\n');
    menuOn(rowHead(2));
    expectDisabled('Delete Row', 'This row is not in the file yet. Type into it to add it.');
  });

  // T9 — at the maintainer's direction the deletes are offered on the row and column headers only.
  it("is not on a cell's menu or the select-all corner's, whole rows selected or not", () => {
    mountDocument('a,b\n1,2\n');
    menuOn(cellAt(1, 1));
    expectEnabled('Clear Cells');
    for (const label of ['Delete Row', 'Delete Rows', 'Delete Column', 'Delete Columns']) expect(item(label), label).toBeNull();
    closeMenu();
    fireEvent.mouseDown(rowHead(0), { button: 0 });
    fireEvent.mouseUp(window);
    menuOn(cellAt(0, 0));
    expect(item('Delete Row')).toBeNull();
    closeMenu();
    menuOn(document.querySelector<HTMLElement>('[data-grid-corner]')!);
    expectEnabled('Clear Cells');
    for (const label of ['Delete Row', 'Delete Rows', 'Delete Column', 'Delete Columns']) expect(item(label), label).toBeNull();
  });
});

describe('Clear Cells on a header (T7)', () => {
  it("a row header clears its record's values, keeping the row", async () => {
    const doc = mountDocument('a,b\n1,2\n3,4\n');
    menuOn(rowHead(1));
    fireEvent.click(item('Clear Cells')!);
    await waitFor(() => expect(doc.text()).toBe('a,b\n,\n3,4\n'));
    expect(doc.gridEdit).toHaveBeenCalledTimes(1);
  });

  it("a column header clears the column's values, header included, right before Delete Column", async () => {
    const doc = mountDocument('a,b,c\n1,2,3\n');
    menuOn(colHead(1));
    const labels = [...document.querySelectorAll('[data-testid^="menu-item-"]')].map((el) => el.getAttribute('data-testid'));
    expect(labels.indexOf('menu-item-Delete Column')).toBe(labels.indexOf('menu-item-Clear Cells') + 1);
    fireEvent.click(item('Clear Cells')!);
    await waitFor(() => expect(doc.text()).toBe('a,,c\n1,,3\n'));
    expect(doc.gridEdit).toHaveBeenCalledTimes(1);
  });
});

describe('Delete Column (T4)', () => {
  it('a column header deletes its field from every record, header included', async () => {
    const doc = mountDocument('id,name,n\n1,Ann,x\n');
    menuOn(colHead(1));
    fireEvent.click(item('Delete Column')!);
    await waitFor(() => expect(doc.text()).toBe('id,n\n1,x\n'));
    expect(doc.gridEdit).toHaveBeenCalledTimes(1);
    expect(doc.gridEdit.mock.calls[0]?.[0].operation).toEqual({ kind: 'deleteColumns', from: 1, count: 1 });
  });

  it('names several columns in the plural and deletes them together', async () => {
    const doc = mountDocument('a,b,c\n1,2,3\n');
    fireEvent.mouseDown(colHead(0), { button: 0 });
    fireEvent.mouseUp(window);
    fireEvent.mouseDown(colHead(1), { button: 0, shiftKey: true });
    fireEvent.mouseUp(window);
    menuOn(colHead(1));
    fireEvent.click(item('Delete Columns')!);
    await waitFor(() => expect(doc.text()).toBe('c\n3\n'));
  });

  it('is drawn disabled when it would take every column of the file', () => {
    mountDocument('a\n1\n');
    menuOn(colHead(0));
    expectDisabled('Delete Column', 'These are all of the file\u2019s columns. Delete its rows to empty it.');
  });
});

describe('the bindable Delete Rows / Delete Columns commands (T4)', () => {
  it('delete the rows, then the columns, the selection spans', async () => {
    const doc = mountDocument('a,b,c\n1,2,3\n4,5,6\n');
    fireEvent.mouseDown(cellAt(1, 1), { button: 0 });
    fireEvent.mouseUp(window);
    expect(runCsvGridCommand('p1', 'grid.deleteRows')).toBe(true);
    await waitFor(() => expect(doc.text()).toBe('a,b,c\n4,5,6\n'));
    expect(runCsvGridCommand('p1', 'grid.deleteColumns')).toBe(true);
    await waitFor(() => expect(doc.text()).toBe('a,c\n4,6\n'));
  });

  it('Delete Columns writes nothing when the selection spans every column', () => {
    const doc = mountDocument('a,b\n1,2\n');
    fireEvent.mouseDown(cellAt(0, 0), { button: 0 });
    fireEvent.mouseUp(window);
    fireEvent.mouseDown(cellAt(0, 1), { button: 0, shiftKey: true });
    fireEvent.mouseUp(window);
    runCsvGridCommand('p1', 'grid.deleteColumns');
    expect(doc.gridEdit).not.toHaveBeenCalled();
  });
});

describe('inserting into a blank CSV (T5)', () => {
  it('Insert Row Above on the entry row of an empty file writes one empty line', async () => {
    const doc = mountDocument('');
    insertMenuOn(rowHead(0));
    expectEnabled('Insert Row Above');
    fireEvent.click(item('Insert Row Above')!);
    await waitFor(() => expect(doc.text()).toBe('\n'));
  });

  it('Insert Row Below on an empty file writes one empty line', async () => {
    const doc = mountDocument('');
    insertMenuOn(cellAt(0, 0));
    fireEvent.click(item('Insert Row Below')!);
    await waitFor(() => expect(doc.text()).toBe('\n'));
  });

  it('Insert Column Right on an empty file writes one record of two empty fields', async () => {
    const right = mountDocument('');
    insertMenuOn(colHead(0));
    fireEvent.click(item('Insert Column Right')!);
    await waitFor(() => expect(right.text()).toBe(',\n'));
  });

  it('builds a table of empty fields from inserts alone, one undo step each', async () => {
    const doc = mountDocument('');
    insertMenuOn(cellAt(0, 0));
    fireEvent.click(item('Insert Column Left')!);
    await waitFor(() => expect(doc.text()).toBe(',\n'));
    insertMenuOn(rowHead(0));
    fireEvent.click(item('Insert Row Below')!);
    await waitFor(() => expect(doc.text()).toBe(',\n,\n'));
    expect(doc.gridEdit).toHaveBeenCalledTimes(2);
    await doc.gridUndo();
    await waitFor(() => expect(doc.text()).toBe(',\n'));
  });

  it('offers no Delete Column on an empty file, saying why', () => {
    mountDocument('');
    menuOn(colHead(0));
    expectDisabled('Delete Column', 'This file has no columns to delete yet.');
  });
});

describe('Insert Rows / Columns with a count (T8)', () => {
  const prompt = (): HTMLElement | null => screen.queryByTestId('csv-insert-p1');
  const countField = (): HTMLInputElement => prompt()!.querySelector('input')!;
  const typeCount = (value: string): void => {
    fireEvent.change(countField(), { target: { value } });
  };
  const submit = (): void => {
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
  };

  it("offers all four on a cell's menu, two on each header's, beside the single inserts", () => {
    mountDocument('a,b\n1,2\n');
    insertMenuOn(cellAt(1, 1));
    for (const label of ['Insert Rows Above…', 'Insert Rows Below…', 'Insert Columns Left…', 'Insert Columns Right…', 'Insert Row Above', 'Insert Column Right']) {
      expectEnabled(label);
    }
    closeMenu();
    insertMenuOn(rowHead(1));
    expectEnabled('Insert Rows Above…');
    expectEnabled('Insert Rows Below…');
    expect(item('Insert Columns Left…')).toBeNull();
    closeMenu();
    insertMenuOn(colHead(1));
    expectEnabled('Insert Columns Left…');
    expectEnabled('Insert Columns Right…');
    expect(item('Insert Rows Above…')).toBeNull();
  });

  it('asks how many rows, starting at 1, and inserts them above as one undo step', async () => {
    const doc = mountDocument('a,b\n1,2\n');
    insertMenuOn(rowHead(1));
    fireEvent.click(item('Insert Rows Above…')!);
    expect(screen.getByLabelText('Rows to insert', { selector: 'input' })).toBe(countField());
    expect(countField().value).toBe('1');
    typeCount('3');
    submit();
    await waitFor(() => expect(doc.text()).toBe('a,b\n,\n,\n,\n1,2\n'));
    expect(doc.gridEdit).toHaveBeenCalledTimes(1);
    expect(doc.gridEdit.mock.calls[0]?.[0].operation).toEqual({ kind: 'insertRows', at: 1, count: 3 });
    expect(prompt()).toBeNull();
    await doc.gridUndo();
    await waitFor(() => expect(doc.text()).toBe('a,b\n1,2\n'));
  });

  it('inserts rows below, and columns left and right, by the count given', async () => {
    const doc = mountDocument('a,b\n1,2\n');
    insertMenuOn(rowHead(0));
    fireEvent.click(item('Insert Rows Below…')!);
    typeCount('2');
    submit();
    await waitFor(() => expect(doc.text()).toBe('a,b\n,\n,\n1,2\n'));
    insertMenuOn(colHead(1));
    fireEvent.click(item('Insert Columns Right…')!);
    expect(screen.getByLabelText('Columns to insert', { selector: 'input' })).toBe(countField());
    typeCount('2');
    submit();
    await waitFor(() => expect(doc.text()).toBe('a,b,,\n,,,\n,,,\n1,2,,\n'));
    insertMenuOn(colHead(0));
    fireEvent.click(item('Insert Columns Left…')!);
    submit();
    await waitFor(() => expect(doc.text()).toBe(',a,b,,\n,,,,\n,,,,\n,1,2,,\n'));
    expect(doc.gridEdit).toHaveBeenCalledTimes(3);
  });

  it('names a value it cannot use as typed, and inserts nothing for it', () => {
    const doc = mountDocument('a,b\n1,2\n');
    insertMenuOn(rowHead(1));
    fireEvent.click(item('Insert Rows Below…')!);
    const insertButton = screen.getByRole('button', { name: 'Insert' });
    typeCount('abc');
    expect(prompt()!.textContent).toContain('Rows must be a whole number');
    expect(countField().getAttribute('aria-invalid')).toBe('true');
    expect(insertButton).toBeDisabled();
    typeCount('0');
    expect(prompt()!.textContent).toContain('Rows must be between 1 and 10,000');
    typeCount('20000');
    expect(prompt()!.textContent).toContain('Rows must be between 1 and 10,000');
    fireEvent.submit(prompt()!);
    expect(doc.gridEdit).not.toHaveBeenCalled();
    typeCount('2');
    expect(insertButton).not.toBeDisabled();
    expect(countField().getAttribute('aria-invalid')).toBeNull();
  });

  it('Cancel and Esc close it without inserting', () => {
    const doc = mountDocument('a,b\n1,2\n');
    insertMenuOn(rowHead(1));
    fireEvent.click(item('Insert Rows Below…')!);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(prompt()).toBeNull();
    insertMenuOn(rowHead(1));
    fireEvent.click(item('Insert Rows Below…')!);
    fireEvent.keyDown(countField(), { key: 'Escape' });
    expect(prompt()).toBeNull();
    expect(doc.gridEdit).not.toHaveBeenCalled();
  });

  it('works in a blank CSV, writing empty fields', async () => {
    const doc = mountDocument('');
    insertMenuOn(cellAt(0, 0));
    fireEvent.click(item('Insert Columns Right…')!);
    typeCount('2');
    submit();
    await waitFor(() => expect(doc.text()).toBe(',,\n'));
    insertMenuOn(cellAt(0, 0));
    fireEvent.click(item('Insert Rows Below…')!);
    typeCount('2');
    submit();
    await waitFor(() => expect(doc.text()).toBe(',,\n,,\n,,\n'));
  });

  it('is drawn disabled above the entry row of a file with rows, as Insert Row Above is', () => {
    mountDocument('a,b\n');
    insertMenuOn(rowHead(1));
    expectDisabled('Insert Rows Above…', 'This row is not in the file yet. Type into it to add it.');
    expectEnabled('Insert Rows Below…');
  });

  it('opens with its count selected, so typing replaces it, and Esc from a button closes it (T10)', () => {
    const doc = mountDocument('a,b\n1,2\n');
    insertMenuOn(rowHead(1));
    fireEvent.click(item('Insert Rows Below…')!);
    const field = countField();
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Insert' }), { key: 'Escape' });
    expect(prompt()).toBeNull();
    expect(doc.gridEdit).not.toHaveBeenCalled();
  });

  it('a press or right-click on the scrim keeps it open, leaves the grid alone, and keeps the keyboard in the field (T10)', () => {
    mountDocument('a,b\n1,2\n');
    insertMenuOn(rowHead(1));
    fireEvent.click(item('Insert Rows Below…')!);
    const active = document.querySelector('.data-grid__cell--active');
    expect(active).not.toBeNull();
    const scrim = screen.getByTestId('csv-insert-p1-scrim');
    expect(scrim).toHaveClass('preview-grid-prompt');
    expect(scrim.contains(prompt())).toBe(true);
    expect(fireEvent.mouseDown(scrim, { button: 0 }), 'the press reached its default').toBe(false);
    fireEvent.mouseUp(window);
    expect(fireEvent.contextMenu(scrim, { clientX: 5, clientY: 5 })).toBe(false);
    expect(screen.queryByTestId('context-menu')).toBeNull();
    expect(prompt()).not.toBeNull();
    expect(document.activeElement).toBe(countField());
    expect(document.querySelector('.data-grid__cell--active')).toBe(active);
  });

  it('opens from its bindable command at the active cell', async () => {
    const doc = mountDocument('a,b\n1,2\n');
    fireEvent.mouseDown(cellAt(1, 0), { button: 0 });
    fireEvent.mouseUp(window);
    act(() => {
      expect(runCsvGridCommand('p1', 'grid.insertColumnsLeft')).toBe(true);
    });
    typeCount('2');
    submit();
    await waitFor(() => expect(doc.text()).toBe(',,a,b\n,,1,2\n'));
  });
});

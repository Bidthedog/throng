/**
 * 081 FR-080 – FR-084 (US9, #732) — the CSV Preview Editor's entry row: one empty, unnumbered row after the last
 * record that the document does not hold until a value is written into it.
 *
 * Layer: component — what the grid draws and which operations it sends. The bridge stands in for main by resolving
 * each grid operation against the current text with the same core resolver main uses, one operation to one history
 * step; main's own undo grouping is `csv-grid-service.integration.test.ts`'s, and the padding rules are
 * `csv-edit.test.ts`'s.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCsvChanges, resolveGridOperation, type CsvGridOperation } from '@throng/core/csv';
import { CsvBody } from '../../src/renderer/preview/providers/csv/csv-body.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';
import { __resetCopiedBlock } from '../../src/renderer/grid/copied-block.js';
import { __resetColumnWidthCache } from '../../src/renderer/preview/providers/csv/column-widths.js';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';

const FILE = 'D:/proj/data.csv';

const props = (text: string): PreviewBodyProps => ({
  panelId: 'p1',
  content: { kind: 'text', text },
  filePath: FILE,
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

/** A document whose grid edits and undo behave as main's do: one operation, one undo step. */
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
  const clipboard = { write: vi.fn(async () => {}), writeRich: vi.fn(async () => {}), paste: vi.fn(async () => ({ text: '' })) };
  window.throng = {
    preview: { gridEdit, gridUndo, gridRedo: vi.fn(async () => ({ ok: true })), gridSave: vi.fn(async () => ({ ok: true })) },
    clipboard,
  } as unknown as typeof window.throng;
  return { gridEdit, gridUndo, text: () => text };
}

const grid = (): HTMLElement => screen.getByTestId('csv-grid-p1');
const rowHead = (r: number): HTMLElement | null => document.querySelector<HTMLElement>(`[role="rowheader"][data-row="${r}"]`);
const cellAt = (r: number, c: number): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-grid-cell][data-row="${r}"][data-col="${c}"]`);

/** Type `value` into cell (row, col) through the in-cell editor and commit it. */
function typeInto(row: number, col: number, value: string): void {
  fireEvent.mouseDown(cellAt(row, col)!, { button: 0 });
  fireEvent.mouseUp(window);
  fireEvent.keyDown(grid(), { key: 'Enter' });
  const editor = screen.getByLabelText('Cell value');
  fireEvent.change(editor, { target: { value } });
  fireEvent.keyDown(editor, { key: 'Enter' });
}

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

describe('the CSV entry row (081 US9)', () => {
  it('shows one empty row with no number after the last record, and writes nothing (FR-080, FR-083)', () => {
    const doc = mountDocument('a,b,c\n1,2,3\n');
    expect(rowHead(1)?.textContent).toBe('2');
    const entry = rowHead(2);
    expect(entry).not.toBeNull();
    expect(entry?.textContent).toBe('');
    expect(entry?.getAttribute('data-entry-row')).toBe('');
    expect(cellAt(2, 0)?.textContent).toBe('');
    expect(rowHead(3)).toBeNull();
    expect(doc.gridEdit).not.toHaveBeenCalled();
  });

  it('writes a typed value as one line of the file\'s width and shows a new entry row beneath (FR-081)', async () => {
    const doc = mountDocument('a,b,c\n1,2,3\n');
    typeInto(2, 1, 'x');
    await waitFor(() => expect(doc.text()).toBe('a,b,c\n1,2,3\n,x,\n'));
    expect(doc.gridEdit).toHaveBeenCalledTimes(1);
    expect(rowHead(2)?.textContent).toBe('3');
    expect(rowHead(3)?.getAttribute('data-entry-row')).toBe('');
  });

  it('removes the line and the value together on one undo (FR-081)', async () => {
    const doc = mountDocument('a,b\n1,2\n');
    typeInto(2, 0, 'x');
    await waitFor(() => expect(doc.text()).toBe('a,b\n1,2\nx,\n'));
    fireEvent.keyDown(grid(), { key: 'z', ctrlKey: true });
    await waitFor(() => expect(doc.text()).toBe('a,b\n1,2\n'));
    expect(doc.gridUndo).toHaveBeenCalledTimes(1);
    expect(rowHead(2)?.getAttribute('data-entry-row')).toBe('');
  });

  it('writes nothing when the entry row is clicked, selected, moved through or cleared (FR-082)', () => {
    const doc = mountDocument('a,b\n1,2\n');
    fireEvent.mouseDown(cellAt(2, 0)!, { button: 0 });
    fireEvent.mouseUp(window);
    fireEvent.keyDown(grid(), { key: 'ArrowRight' });
    fireEvent.keyDown(grid(), { key: 'ArrowUp' });
    fireEvent.keyDown(grid(), { key: 'ArrowDown' });
    fireEvent.keyDown(grid(), { key: 'Delete' });
    fireEvent.mouseDown(rowHead(2)!, { button: 0 });
    fireEvent.mouseUp(window);
    expect(doc.gridEdit).not.toHaveBeenCalled();
    expect(doc.text()).toBe('a,b\n1,2\n');
  });

  it('draws Cut and Insert Row Above disabled on the entry row\'s header, never hidden (FR-083)', async () => {
    mountDocument('a,b\n1,2\n');
    fireEvent.contextMenu(rowHead(2)!, { clientX: 5, clientY: 5 });
    const cut = await screen.findByTestId('menu-item-Cut');
    const above = screen.getByTestId('menu-item-Insert Row Above');
    expect(cut.getAttribute('aria-disabled')).toBe('true');
    expect(above.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('menu-item-Insert Row Below').getAttribute('aria-disabled')).not.toBe('true');
  });

  it('keeps Cut and Insert Row Above enabled on a real row\'s header', async () => {
    mountDocument('a,b\n1,2\n');
    fireEvent.contextMenu(rowHead(1)!, { clientX: 5, clientY: 5 });
    expect((await screen.findByTestId('menu-item-Cut')).getAttribute('aria-disabled')).not.toBe('true');
    expect(screen.getByTestId('menu-item-Insert Row Above').getAttribute('aria-disabled')).not.toBe('true');
  });

  it('writes every row of a multi-row paste into the entry row and leaves one entry row beneath', async () => {
    const doc = mountDocument('a,b\n1,2\n');
    fireEvent.mouseDown(cellAt(2, 0)!, { button: 0 });
    fireEvent.mouseUp(window);
    fireEvent.paste(grid(), { clipboardData: { getData: () => 'p\tq\nr\ts' } });
    await waitFor(() => expect(doc.text()).toBe('a,b\n1,2\np,q\nr,s\n'));
    expect(doc.gridEdit).toHaveBeenCalledTimes(1);
    expect(rowHead(3)?.textContent).toBe('4');
    expect(rowHead(4)?.getAttribute('data-entry-row')).toBe('');
    expect(rowHead(5)).toBeNull();
  });

  it('shows only the entry row for a CSV with no rows, and writes the first record into it', async () => {
    const doc = mountDocument('');
    expect(rowHead(0)?.getAttribute('data-entry-row')).toBe('');
    expect(rowHead(1)).toBeNull();
    typeInto(0, 0, 'hello');
    await waitFor(() => expect(doc.text()).toBe('hello'));
    expect(rowHead(0)?.textContent).toBe('1');
    expect(rowHead(1)?.getAttribute('data-entry-row')).toBe('');
  });

  it('keeps a file\'s missing final newline when the entry row is written (FR-081a)', async () => {
    const doc = mountDocument('a,b\r\n1,2');
    typeInto(2, 1, 'x');
    await waitFor(() => expect(doc.text()).toBe('a,b\r\n1,2\r\n,x'));
  });
});

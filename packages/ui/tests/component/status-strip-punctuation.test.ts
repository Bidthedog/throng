/**
 * 067 T129 (FR-125, FR-126), refined by T144 (FR-134) — the editor status bar's punctuation and the column range.
 *
 * `Ln 10, Col 45.` then `440 Lines.` `8,000 Chars.` `43 Words.`, digit-grouped; a selection on one line
 * reads `Ln 10, Cols 45-56.`, and a selected count ends in a full stop too. The comma belongs to the line only while the column it leads is drawn, and
 * the spoken forms stay words (`line 10`, `440 lines`).
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StatusStrip, statusReadouts } from '../../src/renderer/editor/status-strip.js';
import { setPanelCaret, __resetCaretStore } from '../../src/renderer/editor/caret-store.js';
import { __resetDocumentMetricsStore } from '../../src/renderer/editor/document-metrics-store.js';
import { removePanelLanguage } from '../../src/renderer/editor/editor-language.js';
import { mountEditor } from './helpers/mount-editor.js';

const PANEL = 'p1';
const METRICS = { totalCharacters: 8_000, totalWords: 43, totalLines: 440 };
type Lines = { first: number; last: number; column: number } | null;
const caret = (over: Partial<{ line: number; column: number; selected: number | null; columns: [number, number] | null; lines: Lines }> = {}) => ({
  position: { line: over.line ?? 10, column: over.column ?? 45 },
  selected: over.selected ?? null,
  columns: over.columns ?? null,
  lines: over.lines ?? null,
});
const text = (id: string, c = caret(), forms = {}, columnShown = true): string | undefined =>
  statusReadouts(c, METRICS, undefined, forms, columnShown).find((r) => r.id === id)?.text;

beforeEach(() => {
  __resetCaretStore();
  __resetDocumentMetricsStore();
});
afterEach(() => removePanelLanguage(PANEL));

describe('the sections are punctuated (FR-125)', () => {
  it('reads `Ln 10, Col 45.` and the three counts with a full stop', () => {
    expect(text('line')).toBe('Ln 10,');
    expect(text('column')).toBe('Col 45.');
    expect(text('lines')).toBe('440 Lines.');
    expect(text('chars')).toBe('8,000 Chars.');
    expect(text('words')).toBe('43 Words.');
  });

  it('ends a line whose column is not drawn in a full stop (FR-134)', () => {
    expect(text('line', caret(), { line: 'full' }, false)).toBe('Ln 10.');
  });

  it('keeps the comma while the column is drawn', () => {
    expect(text('line', caret(), { line: 'full', column: 'full' }, true)).toBe('Ln 10,');
  });

  it('reads `1 Line.` for a one-line document, and the short forms stay short', () => {
    const one = statusReadouts(caret(), { ...METRICS, totalLines: 1 }).find((r) => r.id === 'lines');
    expect(one?.text).toBe('1 Line.');
    expect(text('lines', caret(), { lines: 'short' })).toBe('440 Lns.');
    expect(text('chars', caret(), { chars: 'short' })).toBe('8,000 Ch.');
    expect(text('words', caret(), { words: 'short' })).toBe('43 W.');
  });

  it('keeps every figure grouped for the locale', () => {
    const out = statusReadouts(caret({ line: 12_345 }), METRICS, 'de-DE');
    expect(out.find((r) => r.id === 'line')?.text).toBe('Ln 12.345,');
    expect(out.find((r) => r.id === 'chars')?.text).toBe('8.000 Chars.');
  });

  it('is announced in words, as before', () => {
    const out = statusReadouts(caret(), METRICS);
    expect(out.find((r) => r.id === 'line')?.accessibleName).toBe('line 10');
    expect(out.find((r) => r.id === 'column')?.accessibleName).toBe('column 45');
    expect(out.find((r) => r.id === 'lines')?.accessibleName).toBe('440 lines');
    expect(out.find((r) => r.id === 'words')?.accessibleName).toBe('43 words');
  });
});

describe('a selection on one line reads as a column range (FR-126)', () => {
  it('reads `Cols 45-56.`', () => {
    const c = caret({ column: 56, selected: 11, columns: [45, 56] });
    expect(text('column', c)).toBe('Cols 45-56.');
    expect(text('line', c)).toBe('Ln 10,');
  });

  it('groups the range figures', () => {
    const out = statusReadouts(caret({ column: 2_000, selected: 1, columns: [1_000, 2_000] }), METRICS, 'en-US');
    expect(out.find((r) => r.id === 'column')?.text).toBe('Cols 1,000-2,000.');
  });

  it('is announced as columns', () => {
    const out = statusReadouts(caret({ column: 56, selected: 11, columns: [45, 56] }), METRICS);
    expect(out.find((r) => r.id === 'column')?.accessibleName).toBe('columns 45 to 56');
  });

  it('a selection across lines, or none, reads one column', () => {
    expect(text('column', caret({ selected: 30, columns: null }))).toBe('Col 45.');
    expect(text('column', caret())).toBe('Col 45.');
  });

  it('is what the bar draws', () => {
    setPanelCaret(PANEL, { line: 10, column: 56 }, 11, [45, 56]);
    render(createElement(StatusStrip, { panelId: PANEL, projectId: 'proj-1', relPath: null }));
    expect(screen.getByTestId(`editor-status-column-${PANEL}`)).toHaveTextContent('Cols 45-56.');
    expect(screen.getByTestId(`editor-status-line-${PANEL}`)).toHaveTextContent('Ln 10,');
  });

  it('the caret store carries the range, and a new range is a change', () => {
    setPanelCaret(PANEL, { line: 1, column: 5 }, 4, [1, 5]);
    setPanelCaret(PANEL, { line: 1, column: 6 }, 5, [1, 6]);
    render(createElement(StatusStrip, { panelId: PANEL, projectId: 'proj-1', relPath: null }));
    expect(screen.getByTestId(`editor-status-column-${PANEL}`)).toHaveTextContent('Cols 1-6.');
  });
});

describe('what the editor publishes (FR-126)', () => {
  const selectIn = async (text: string, anchor: number, head: number): Promise<void> => {
    const h = mountEditor({ panelId: 'p-ed', doc: { text, version: 1, absPath: 'C:/proj/notes.txt' } });
    await waitFor(() => expect(document.querySelector('.cm-editor')).not.toBeNull());
    const view = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
    act(() => view.dispatch({ selection: { anchor, head } }));
    void h;
  };

  it('a selection on one line gives the range, whichever way it was made', async () => {
    await selectIn('first line\nabcdefghij\nthird', 11 + 8, 11 + 3);
    await waitFor(() => expect(screen.getByTestId('editor-status-column-p-ed')).toHaveTextContent('Cols 4-9.'));
  });

  it('a selection across lines gives one column', async () => {
    await selectIn('first line\nabcdefghij\nthird', 3, 11 + 3);
    await waitFor(() => expect(screen.getByTestId('editor-status-column-p-ed')).toHaveTextContent(/^Col 4\.$/));
  });

  it('a bare caret gives one column', async () => {
    await selectIn('first line\nabcdefghij', 5, 5);
    await waitFor(() => expect(screen.getByTestId('editor-status-column-p-ed')).toHaveTextContent(/^Col 6\.$/));
  });
});

describe('the column and the selected count end in a full stop (FR-134)', () => {
  it('reads `Cols 9-15. 2 selected. 25 Lines.`', () => {
    const out = statusReadouts(caret({ column: 15, selected: 2, columns: [9, 15] }), { ...METRICS, totalLines: 25 });
    const drawn = ['column', 'selected', 'lines'].map((id) => out.find((r) => r.id === id)?.text).join(' ');
    expect(drawn).toBe('Cols 9-15. 2 selected. 25 Lines.');
  });

  it('reads `Ln 10, Col 45.` for a bare caret', () => {
    expect(`${text('line')} ${text('column')}`).toBe('Ln 10, Col 45.');
  });

  it('the short selected form reads `2 sel.`', () => {
    expect(text('selected', caret({ selected: 2 }), { selected: 'short' })).toBe('2 sel.');
  });

  it('groups the selected figure before its full stop', () => {
    expect(text('selected', caret({ selected: 12_345 }))).toBe('12,345 selected.');
  });

  it('is what the bar draws', () => {
    setPanelCaret(PANEL, { line: 3, column: 15 }, 2, [9, 15]);
    render(createElement(StatusStrip, { panelId: PANEL, projectId: 'proj-1', relPath: null }));
    expect(screen.getByTestId(`editor-status-column-${PANEL}`)).toHaveTextContent('Cols 9-15.');
    expect(screen.getByTestId(`editor-status-selected-${PANEL}`)).toHaveTextContent('2 selected.');
  });
});

describe('a selection across lines reads as a line range (FR-136)', () => {
  const across = caret({ line: 5, column: 2, selected: 30, lines: { first: 3, last: 5, column: 4 } });

  it('reads `Ln 3-5, Col 4.`', () => {
    expect(`${text('line', across)} ${text('column', across)}`).toBe('Ln 3-5, Col 4.');
  });

  it('is announced as lines', () => {
    const out = statusReadouts(across, METRICS);
    expect(out.find((r) => r.id === 'line')?.accessibleName).toBe('lines 3 to 5');
    expect(out.find((r) => r.id === 'column')?.accessibleName).toBe('column 4');
  });

  it('ends in a full stop when the column is not drawn', () => {
    expect(text('line', across, {}, false)).toBe('Ln 3-5.');
  });

  const select = async (anchor: number, head: number): Promise<void> => {
    mountEditor({ panelId: 'p-ln', doc: { text: 'one\ntwo\nabcdefgh\nfour\nfive five\nsix', version: 1, absPath: 'C:/proj/lines.txt' } });
    await waitFor(() => expect(document.querySelector('.cm-editor')).not.toBeNull());
    const view = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
    act(() => view.dispatch({ selection: { anchor, head } }));
  };
  // Line 3 starts at offset 8; its 4th column is offset 11. Line 5 starts at 22; line 6 at 32.
  const line = (): HTMLElement => screen.getByTestId('editor-status-line-p-ln');
  const column = (): HTMLElement => screen.getByTestId('editor-status-column-p-ln');

  it('what the editor publishes, selecting downwards', async () => {
    await select(11, 24);
    await waitFor(() => expect(line()).toHaveTextContent(/^Ln 3-5,$/));
    expect(column()).toHaveTextContent(/^Col 4\.$/);
  });

  it('the same, selecting upwards', async () => {
    await select(24, 11);
    await waitFor(() => expect(line()).toHaveTextContent(/^Ln 3-5,$/));
    expect(column()).toHaveTextContent(/^Col 4\.$/);
  });

  it('a selection ending at the start of a line does not count that line', async () => {
    await select(11, 32);
    await waitFor(() => expect(line()).toHaveTextContent(/^Ln 3-5,$/));
  });
});

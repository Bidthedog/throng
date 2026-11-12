/**
 * 067 T102 (FR-095, FR-098 to FR-100, SC-013) — the total-lines readout on the editor status bar.
 *
 * It reads `9,000 lines`, digit-grouped through the one formatter; is omitted (not zero) until the
 * document's counts have settled; says `1 line` for an empty document; is governed by the existing
 * counts setting; and is announced as `N lines` / `1 line`. It costs nothing per keystroke: it is read
 * from the figures the debounced scan already produces, and that scan is the same single pass.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusStrip, statusReadouts } from '../../src/renderer/editor/status-strip.js';
import { setPanelCaret, __resetCaretStore } from '../../src/renderer/editor/caret-store.js';
import {
  documentMetrics,
  scheduleDocumentMetrics,
  __resetDocumentMetricsStore,
} from '../../src/renderer/editor/document-metrics-store.js';
import { removePanelLanguage } from '../../src/renderer/editor/editor-language.js';
import { mountEditor } from './helpers/mount-editor.js';

const PANEL = 'p1';
const DOC_KEY = `panel:${PANEL}`;

beforeEach(() => {
  __resetCaretStore();
  __resetDocumentMetricsStore();
});
afterEach(() => {
  vi.useRealTimers();
  removePanelLanguage(PANEL);
  Reflect.deleteProperty(window, 'throng');
});

function strip(text?: string): void {
  vi.useFakeTimers();
  setPanelCaret(PANEL, { line: 1, column: 1 }, null);
  if (text !== undefined) {
    scheduleDocumentMetrics(DOC_KEY, text);
    act(() => {
      vi.advanceTimersByTime(200);
    });
  }
  render(createElement(StatusStrip, { panelId: PANEL, projectId: 'proj-1', relPath: null }));
}

const lines = (): HTMLElement | null => screen.queryByTestId(`editor-status-lines-${PANEL}`);

describe('what it says (FR-095, FR-099)', () => {
  it('reads `N lines`, digit-grouped, beside characters and words', () => {
    strip('x\n'.repeat(8_999) + 'x');
    expect(lines()).toHaveTextContent('9,000 Lines.');
    expect(screen.getByTestId(`editor-status-chars-${PANEL}`)).toBeInTheDocument();
    expect(screen.getByTestId(`editor-status-words-${PANEL}`)).toBeInTheDocument();
  });

  it('counts every line ending style as one break, as the character count does', () => {
    strip('a\r\nb\rc\nd');
    expect(lines()).toHaveTextContent('4 Lines.');
  });

  it('counts a trailing line ending as opening one more (empty) line, as the caret does', () => {
    strip('one\ntwo\n');
    expect(lines()).toHaveTextContent('3 Lines.');
  });

  it('reports `1 line` for an empty document, not `0 lines`', () => {
    strip('');
    expect(lines()).toHaveTextContent(/^1 Line\.$/);
  });

  it('is omitted, not shown as zero, until the counts have settled', () => {
    strip(undefined);
    expect(lines()).toBeNull();
    expect(screen.queryByText(/lines?$/)).toBeNull();
  });
});

describe('the forms (FR-096)', () => {
  it('draws `lines` at the full label and `lns` at the short one', () => {
    const metrics = { totalCharacters: 10, totalWords: 2, totalLines: 5 };
    const caret = { position: { line: 1, column: 1 }, selected: null };
    const full = statusReadouts(caret, metrics).find((r) => r.id === 'lines');
    const short = statusReadouts(caret, metrics, undefined, { lines: 'short' }).find((r) => r.id === 'lines');
    expect(full?.text).toBe('5 Lines.');
    expect(short?.text).toBe('5 Lns.');
  });

  it('is placed between selected and chars', () => {
    const metrics = { totalCharacters: 10, totalWords: 2, totalLines: 5 };
    const ids = statusReadouts({ position: { line: 1, column: 1 }, selected: 3 }, metrics).map((r) => r.id);
    expect(ids).toEqual(['line', 'column', 'selected', 'lines', 'chars', 'words']);
  });
});

describe('the announcement (FR-100)', () => {
  it('is `N lines`, and `1 line` for one', () => {
    const caret = { position: { line: 1, column: 1 }, selected: null };
    const many = statusReadouts(caret, { totalCharacters: 0, totalWords: 0, totalLines: 9000 }).find((r) => r.id === 'lines');
    const one = statusReadouts(caret, { totalCharacters: 0, totalWords: 0, totalLines: 1 }).find((r) => r.id === 'lines');
    expect(many?.accessibleName).toBe('9,000 lines');
    expect(one?.accessibleName).toBe('1 line');
    expect(one?.text).toBe('1 Line.');
  });

  it('is what a screen reader gets from the rendered readout, and nothing else on the bar changed', () => {
    strip('a\nb');
    expect(lines()).toHaveAttribute('aria-label', '2 lines');
    expect(screen.getByTestId(`editor-status-chars-${PANEL}`)).toHaveAttribute('aria-label', '3 characters');
    expect(screen.getByTestId(`editor-status-words-${PANEL}`)).toHaveAttribute('aria-label', '2 words');
  });
});

describe('governed by the counts setting, with no new setting (FR-098)', () => {
  it('is hidden with showCounts off and shown with it on', async () => {
    const off = mountEditor({
      panelId: 'p-ed',
      doc: { text: 'a\nb\nc', version: 1, absPath: 'C:/proj/notes.txt' },
      settings: { editor: { statusBar: { showCounts: false } } },
    });
    await waitFor(() => expect(off.settingsLoaded()).toBe(true));
    await waitFor(() => expect(documentMetrics('C:/proj/notes.txt') ?? documentMetrics('panel:p-ed')).not.toBeUndefined());
    expect(screen.queryByTestId('editor-status-lines-p-ed')).toBeNull();
    off.unmount();
  });

  it('is drawn on the shipped defaults', async () => {
    const on = mountEditor({ panelId: 'p-ed', doc: { text: 'a\nb\nc', version: 1, absPath: 'C:/proj/notes.txt' } });
    await waitFor(() => expect(screen.getByTestId('editor-status-lines-p-ed')).toHaveTextContent('3 Lines.'));
    on.unmount();
  });
});

describe('no new work per keystroke (SC-013)', () => {
  it('scans the text once for a burst of edits, and the figure comes out of that one scan', () => {
    vi.useFakeTimers();
    const text = vi.fn(() => 'a\nb\nc');
    for (let i = 0; i < 500; i += 1) scheduleDocumentMetrics(DOC_KEY, text);
    expect(text).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(text).toHaveBeenCalledTimes(1);
    expect(documentMetrics(DOC_KEY)?.totalLines).toBe(3);
  });
});

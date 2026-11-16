/**
 * #637 (044 FR-118a – FR-118c) — a Markdown preview's status bar reports the document's line, character and word
 * counts and, while text is selected, its character count and the source lines it spans.
 *
 * Layer: component — what the bar renders, its fit against a measured width, and the readouts a real rendered body's
 * selection produces all need a DOM; no window is needed. The counts' own
 * arithmetic is the editor's (`document-metrics-store.ts`, unit-tested there); this proves the preview reads the
 * SAME scan over the text it draws, so its figures equal the editor's for the same file.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countCharacters, countWords, formatGrouped } from '@throng/core';
import { countLines } from '../../src/renderer/editor/document-metrics-store.js';
import { BAR_GAP } from '../../src/renderer/editor/status-strip.js';
import { PreviewStatusBar, type PreviewStatusBarProps } from '../../src/renderer/preview/preview-status-bar.js';
import { sourceLineAt } from '../../src/renderer/preview/preview-readouts.js';
import { COLD, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const DOC = [
  '# Release notes', // 1
  '',
  'Read the site and the setup.', // 3
  '',
  '- first item', // 5
  '- second item', // 6
  '',
  '```ts', // 8
  'const answer: number = 42;', // 9
  '```',
  '',
].join('\n');

let m: MountedPreviewWindow | undefined;

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  m?.unmount();
  m = undefined;
  document.body.replaceChildren();
});

describe('the bar draws the editor strip’s readouts (FR-118a, FR-118b)', () => {
  const draw = (over: Partial<PreviewStatusBarProps> = {}) =>
    render(
      createElement(PreviewStatusBar, {
        panelId: 'pv',
        providerKind: 'text',
        parented: false,
        onEditorRoute: () => {},
        syncScroll: true,
        onToggleSyncScroll: () => {},
        ...over,
      }),
    );
  const shown = (): { id: string | null; text: string | null; name: string | null }[] =>
    [...screen.getByTestId('preview-status-bar-pv').querySelectorAll('[data-readout]')].map((el) => ({
      id: el.getAttribute('data-readout'),
      text: el.textContent,
      name: el.getAttribute('aria-label'),
    }));
  const METRICS = { totalLines: 1204, totalCharacters: 48_210, totalWords: 9001 };

  it('draws the document’s lines, characters and words in the editor’s forms, announced by their full names', () => {
    draw({ metrics: METRICS });
    expect(shown()).toEqual([
      { id: 'lines', text: `${formatGrouped(1204)} Lines.`, name: `${formatGrouped(1204)} lines` },
      { id: 'chars', text: `${formatGrouped(48_210)} Chars.`, name: `${formatGrouped(48_210)} characters` },
      { id: 'words', text: `${formatGrouped(9001)} Words.`, name: `${formatGrouped(9001)} words` },
    ]);
  });

  it('draws nothing for counts that have not settled — absent, never zero', () => {
    draw({ metrics: null });
    expect(shown()).toEqual([]);
  });

  it('with a mapped selection: its source lines alone, ending in a full stop, then its count, before the counts', () => {
    draw({ metrics: METRICS, selection: { selected: 12, lines: { first: 3, last: 5 } } });
    expect(shown().slice(0, 2)).toEqual([
      { id: 'line', text: 'Ln 3-5.', name: 'lines 3 to 5' },
      { id: 'selected', text: '12 selected.', name: '12 characters selected' },
    ]);
  });

  it('a selection on one source line names that line; an unmappable one shows its count alone', () => {
    const view = draw({ selection: { selected: 1, lines: { first: 7, last: 7 } } });
    expect(shown()).toEqual([
      { id: 'line', text: 'Ln 7.', name: 'line 7' },
      { id: 'selected', text: '1 selected.', name: '1 character selected' },
    ]);
    view.unmount();
    draw({ selection: { selected: 4, lines: null } });
    expect(shown().map((r) => r.id)).toEqual(['selected']);
  });

  it('follows the editor’s two readout preferences: the line by showCursorPosition, the counts by showCounts', () => {
    const selection = { selected: 3, lines: { first: 2, last: 2 } };
    const view = draw({ metrics: METRICS, selection, readoutPrefs: { showCursorPosition: false, showCounts: true } });
    expect(shown().map((r) => r.id)).toEqual(['selected', 'lines', 'chars', 'words']);
    view.unmount();
    draw({ metrics: METRICS, selection, readoutPrefs: { showCursorPosition: true, showCounts: false } });
    expect(shown().map((r) => r.id)).toEqual(['line']);
  });

  it('keeps the link readout after the counts, and its two controls unchanged (FR-118, FR-122c)', () => {
    draw({ metrics: METRICS, readout: 'https://example.com/page' });
    const readouts = screen.getByTestId('preview-status-bar-pv').querySelector('.editor-status-strip__group--readouts')!;
    expect(readouts.lastElementChild).toHaveTextContent('https://example.com/page');
    const controls = screen.getByTestId('preview-status-controls-pv');
    expect(within(controls).getAllByRole('button').map((b) => b.getAttribute('data-testid'))).toEqual([
      'preview-sync-scroll-pv',
      'preview-editor-pv',
    ]);
  });
});

describe('the bar gives way to width by the editor’s rules (FR-118c; 040 FR-021 – FR-023)', () => {
  // Each segment's measured width in each form, as the ruler would report it; the controls group is 80 wide.
  const WIDTH: Record<string, number> = {
    'lines:full': 50, 'lines:short': 36,
    'chars:full': 62, 'chars:short': 44,
    'words:full': 58, 'words:short': 38,
  };
  const CONTROLS = 80;
  let observed: ((width: number) => void) | null = null;

  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly cb: ResizeObserverCallback) {}
        observe(): void {
          observed = (width) => this.cb([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver);
        }
        disconnect(): void {}
        unobserve(): void {}
      },
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const key = this.getAttribute('data-measure');
      const width = key !== null ? (WIDTH[key] ?? 0) : this.getAttribute('data-testid') === 'preview-status-controls-pv' ? CONTROLS : 0;
      return { width, height: 16, top: 0, left: 0, right: width, bottom: 16, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    observed = null;
  });

  const at = (width: number): { id: string | null; label: string | null }[] => {
    act(() => observed?.(width));
    return [...screen.getByTestId('preview-status-bar-pv').querySelectorAll('[data-readout]')].map((el) => ({
      id: el.getAttribute('data-readout'),
      label: el.getAttribute('data-label'),
    }));
  };
  const full = CONTROLS + BAR_GAP + 50 + 62 + 58 + 2 * BAR_GAP;
  const short = CONTROLS + BAR_GAP + 36 + 44 + 38 + 2 * BAR_GAP;

  it('every label at full width; every label shortens before anything hides; then words go first', () => {
    render(
      createElement(PreviewStatusBar, {
        panelId: 'pv',
        providerKind: 'text',
        parented: false,
        onEditorRoute: () => {},
        syncScroll: true,
        onToggleSyncScroll: () => {},
        metrics: { totalLines: 3, totalCharacters: 40, totalWords: 8 },
      }),
    );
    expect(at(full).map((r) => r.label)).toEqual(['full', 'full', 'full']);
    expect(at(short)).toEqual([
      { id: 'lines', label: 'short' },
      { id: 'chars', label: 'short' },
      { id: 'words', label: 'short' },
    ]);
    expect(at(short - 1).map((r) => r.id)).toEqual(['lines', 'chars']);
  });
});

describe('a real preview: the counts are the editor’s figures for the same text (FR-118a)', () => {
  it('shows Lines, Chars and Words equal to the editor’s scan of the drawn source', async () => {
    m = await mountMarkdownPreview(DOC);
    await screen.findByText('Release notes', {}, COLD);
    const words = await screen.findByTestId(`preview-status-words-${m.id}`, {}, { timeout: 2000 });
    expect(words).toHaveTextContent(`${formatGrouped(countWords(DOC))} Words.`);
    expect(screen.getByTestId(`preview-status-chars-${m.id}`)).toHaveTextContent(
      `${formatGrouped(countCharacters(DOC))} Chars.`,
    );
    expect(screen.getByTestId(`preview-status-lines-${m.id}`)).toHaveTextContent(`${formatGrouped(countLines(DOC))} Lines.`);
  });
});

describe('a real preview: the selection readouts (FR-118b)', () => {
  const body = (): HTMLElement => screen.getByTestId(`preview-body-${m!.id}`);
  const select = (node: Node, from: number, endNode: Node, to: number): void => {
    body().focus();
    const range = document.createRange();
    range.setStart(node, from);
    range.setEnd(endNode, to);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  };

  it('a selection in one list item names its source line and counts its characters; clearing removes both', async () => {
    m = await mountMarkdownPreview(DOC);
    const item = (await screen.findByText('first item', {}, COLD)).firstChild!;
    select(item, 0, item, 5);
    expect(await screen.findByTestId(`preview-status-line-${m.id}`)).toHaveTextContent('Ln 5.');
    expect(screen.getByTestId(`preview-status-selected-${m.id}`)).toHaveTextContent('5 selected.');

    act(() => {
      document.getSelection()!.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
    });
    await waitFor(() => expect(screen.queryByTestId(`preview-status-selected-${m!.id}`)).toBeNull());
    expect(screen.queryByTestId(`preview-status-line-${m.id}`)).toBeNull();
  });

  it('a selection from the heading into the list spans those source lines', async () => {
    m = await mountMarkdownPreview(DOC);
    const heading = (await screen.findByText('Release notes', {}, COLD)).firstChild!;
    const second = screen.getByText('second item').firstChild!;
    select(heading, 0, second, 6);
    expect(await screen.findByTestId(`preview-status-line-${m.id}`)).toHaveTextContent('Ln 1-6.');
  });
});

describe('sourceLineAt: a rendered point back to its 1-based source line', () => {
  const lines = DOC.split('\n');
  const host = (html: string): HTMLElement => {
    const el = document.createElement('div');
    el.innerHTML = html;
    document.body.append(el);
    return el;
  };

  it('the innermost block’s data-source-line, plus the soft breaks before the point', () => {
    const h = host('<p data-source-line="2">one\ntwo\nthree</p>');
    const text = h.querySelector('p')!.firstChild!;
    expect(sourceLineAt(h, text, 0, lines)).toBe(3);
    expect(sourceLineAt(h, text, 'one\ntwo\nth'.length, lines)).toBe(5);
  });

  it('a fenced code block anchored on its fence starts its content on the next line', () => {
    const h = host('<pre data-source-line="7"><code>const answer: number = 42;</code></pre>');
    expect(sourceLineAt(h, h.querySelector('code')!.firstChild!, 3, lines)).toBe(9);
  });

  it('nothing to anchor on, or a line past the end of the source, does not map', () => {
    const h = host('<p>no anchor</p><p data-source-line="10">late\nlater</p>');
    expect(sourceLineAt(h, h.querySelector('p')!.firstChild!, 1, lines)).toBeNull();
    expect(sourceLineAt(h, h.querySelectorAll('p')[1]!.firstChild!, 'late\nla'.length, lines)).toBeNull();
  });
});

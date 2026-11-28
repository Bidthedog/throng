/**
 * 047 T065/T066 (R13) — the Markdown body's table layout wiring. `preview-table-layout.test.ts`
 * proves `applyTableLayout`'s own DOM logic with a stubbed measurer; this is the WIRING inside a
 * mounted body — that it calls `applyTableLayout` after every draw (jsdom has no real layout, so every
 * measured width is degenerate zero, but the `<colgroup>`/handles it built from that answer are not).
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialFold, setSection } from '@throng/core';
import { MarkdownBody } from '../../src/renderer/preview/providers/markdown/markdown-body.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';

const COLD = { timeout: 10_000 };

const props = (text: string, extra: Partial<PreviewBodyProps> = {}): PreviewBodyProps => ({
  panelId: 'p1',
  content: { kind: 'text', text },
  filePath: 'D:/proj/README.md',
  projectRoot: 'D:/proj',
  providerSettings: { enabled: true },
  initialViewState: undefined,
  onViewStateCapture: () => {},
  onFollow: () => {},
  onNotice: () => {},
  onDrawn: () => {},
  onBodyFailure: () => {},
  ...extra,
});

const TABLE_DOC = '| a | b |\n|---|---|\n| 1 | 2 |';

afterEach(() => vi.restoreAllMocks());

describe('MarkdownBody lays out tables after every draw (T065/T066)', () => {
  // A body on screen has a width; jsdom gives every element 0, which is what a body with no box reads (081 FR-020).
  beforeEach(() => void vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800));

  it('applies a colgroup to a rendered table', async () => {
    render(createElement(MarkdownBody, props(TABLE_DOC)));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelector('table')).not.toBeNull(), COLD);
    await waitFor(() => expect(host.querySelector('table > colgroup')?.children).toHaveLength(2));
    expect(host.querySelector('table')?.style.tableLayout).toBe('fixed');
  });

  it('draws a resize handle in every column but the last', async () => {
    render(createElement(MarkdownBody, props('| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |')));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelector('table')).not.toBeNull(), COLD);
    await waitFor(() => expect(host.querySelectorAll('.preview-table-resize-handle')).toHaveLength(2));
  });

  it('a document with no table calls nothing that touches it, and draws normally', async () => {
    render(createElement(MarkdownBody, props('# No table here')));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelector('h1')).not.toBeNull(), COLD);
    expect(host.querySelector('colgroup')).toBeNull();
  });

  it('re-rendering the SAME file keeps laying tables out without throwing', async () => {
    const { rerender } = render(createElement(MarkdownBody, props(TABLE_DOC)));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelector('table > colgroup')).not.toBeNull(), COLD);

    rerender(createElement(MarkdownBody, props('| a | b |\n|---|---|\n| 9 | 9 |')));
    await waitFor(() => expect(host.textContent).toContain('9'));
    // Laid out after the draw, not inside it (Principle XII).
    await waitFor(() => expect(host.querySelector('table > colgroup')?.children).toHaveLength(2));
  });

  /**
   * MT-07 round 3 — resizing a preview with tables was extremely slow (measured in the built app:
   * `docs/preferences.md`, 21 tables, ~176ms of long tasks and 120 forced layout reads per resize; the
   * 045 and 046 specs stopped answering). Every resize frame re-measured every table — a clone per
   * table, an `8ch` probe, a span per hyphenated token — and each read forces a layout of the whole
   * document. A resize changes only the width the columns share; nothing it measured depends on it.
   */
  it('a panel resize re-shares the columns without forcing a single layout read', async () => {
    let onResize: (() => void) | null = null;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          onResize = cb;
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const doc = '| ID | Title | Date |\n|---|---|---|\n| MT-01 | Find in a preview | 2026-09-29 |';
    render(createElement(MarkdownBody, props(doc)));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelector('table > colgroup')).not.toBeNull(), COLD);
    expect(onResize, 'the body observes its own size').not.toBeNull();

    const reads = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    onResize!();
    await new Promise((resolve) => setTimeout(resolve, 400)); // past any debounce the resize waits on

    expect(host.querySelector('table > colgroup')?.children).toHaveLength(3);
    expect(reads, 'layout reads forced by one resize').toHaveBeenCalledTimes(0);
    vi.unstubAllGlobals();
  });

  it('navigating to a different file re-lays out its own table too', async () => {
    const { rerender } = render(createElement(MarkdownBody, props(TABLE_DOC)));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelector('table > colgroup')).not.toBeNull(), COLD);

    rerender(
      createElement(
        MarkdownBody,
        props('| x | y | z |\n|---|---|---|\n| 1 | 2 | 3 |', { filePath: 'D:/proj/Other.md', navigationSeq: 1 }),
      ),
    );
    await waitFor(() => expect(host.textContent).toContain('x'));
    await waitFor(() => expect(host.querySelector('table > colgroup')?.children).toHaveLength(3));
  });
});

/**
 * 081 FR-020, FR-021, SC-004 (#730) — a preview redrawn while it has no box (its panel collapsed, its tab behind; the
 * file rewritten by another program) lays its tables out, once shown, as a fresh open of the same text does, and a
 * column's resize handle then drags from that width.
 *
 * jsdom has no layout, so the browser is played by stubs that answer as one does: every element is 800 px wide while
 * the preview is shown and 0 while it is not, and every width the shipped measurer reads (a clone's cells, `8ch`) is
 * 0 while hidden and its text at 8 px a character once shown. The ResizeObserver is a fake the test fires.
 */
describe('a body redrawn while it has no box (081 FR-020, FR-021)', () => {
  const PROSE = 'A long prose cell that wraps across the panel, as the generated report in the issue has. '.repeat(5);
  const TABLE = `| Field | Detail |\n|---|---|\n| MT-01 | ${PROSE} |\n| Owner | ${PROSE} |`;
  let shown = false;
  let fireResize: (() => void) | null = null;
  /** Called on every layout read the stubs answer; T024 counts the ones a browser would have to lay out for. */
  let onLayoutRead: () => void = () => {};

  const colWidthsOf = (colgroup: Element): number[] => [...colgroup.children].map((c) => parseFloat((c as HTMLElement).style.width) || 0);
  const colWidths = (host: HTMLElement): number[] =>
    [...host.querySelectorAll<HTMLElement>('table > colgroup > col')].map((c) => parseFloat(c.style.width));
  /** A `width: 100%` fixed-layout table shares any width its columns leave over out among them, in proportion. */
  const drawnWidths = (cols: readonly number[]): number[] => {
    const sum = cols.reduce((a, b) => a + b, 0);
    return cols.map((w) => (sum > 0 ? (w * Math.max(800, sum)) / sum : 0));
  };
  /** What `display: none` covers in the shipped CSS: a hidden block, a collapsed callout's body, a closed `<details>`. */
  const boxless = (el: Element): boolean =>
    !shown || el.closest('[hidden], [data-callout-collapsed] > [data-callout-body], details:not([open]) > :not(summary)') !== null;

  beforeEach(() => {
    shown = false;
    fireResize = null;
    onLayoutRead = () => {};
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function width(this: HTMLElement) {
      onLayoutRead();
      return boxless(this) ? 0 : 800;
    });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
      onLayoutRead();
      if (boxless(this)) return new DOMRect(0, 0, 0, 0);
      if (this.tagName === 'TD' || this.tagName === 'TH') {
        // A laid-out table's cell draws at its column's share of the 800 px table (T2: a drag starts from it); a
        // measuring clone's, at its text.
        const colgroup = this.closest('table')?.querySelector(':scope > colgroup');
        if (!colgroup) return new DOMRect(0, 0, (this.textContent ?? '').length * 8, 20);
        return new DOMRect(0, 0, drawnWidths(colWidthsOf(colgroup))[(this as HTMLTableCellElement).cellIndex] ?? 0, 20);
      }
      if (this instanceof HTMLElement && this.style.width.endsWith('ch')) return new DOMRect(0, 0, parseFloat(this.style.width) * 8, 20);
      return new DOMRect(0, 0, 0, 0);
    });
    const callbacks: (() => void)[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          callbacks.push(cb);
          fireResize = () => callbacks.forEach((c) => c());
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  /** Past the draw's table layout and any resize debounce. */
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 400));

  async function freshOpenWidths(): Promise<number[]> {
    shown = true;
    const { unmount } = render(createElement(MarkdownBody, props(TABLE, { panelId: 'fresh' })));
    const host = screen.getByTestId('preview-markdown-fresh');
    await waitFor(() => expect(host.querySelector('table > colgroup')).not.toBeNull(), COLD);
    const widths = colWidths(host);
    unmount();
    return widths;
  }

  async function redrawnHiddenThenShown(text = TABLE, aroundShow: (show: () => Promise<void>) => Promise<void> = (show) => show()): Promise<HTMLElement> {
    shown = false;
    render(createElement(MarkdownBody, props(text)));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelector('table')).not.toBeNull(), COLD);
    await settle();
    await aroundShow(async () => {
      shown = true;
      fireResize!();
      await settle();
    });
    return host;
  }

  /**
   * 081 T024, Principle XII "Measured, not assumed" — the re-measure on the 0 → W change costs a FIXED number of forced
   * layouts, however many tables the document has: the #730 report's shape (14 two-column tables, 182 rows, prose cells
   * up to ~500 characters) costs what one table does. A forced layout is a layout read with a DOM write pending since
   * the read before it (a MutationObserver's queue says whether one is), counted from the moment the body is shown.
   */
  it('re-measures the #730 document shape in a fixed number of forced layouts, the same as one table', async () => {
    const report = Array.from({ length: 14 }, (_, t) =>
      [`| Field | Detail |`, '|---|---|', ...Array.from({ length: 12 }, (_, r) => `| F${t}-${r} | ${'prose '.repeat(r * 7 + 1)}|`)].join('\n'),
    ).join('\n\n');
    expect((report.match(/^\|/gm) ?? []).length - 14 /* delimiter rows */).toBe(182);

    const forcedLayouts = async (text: string): Promise<{ layouts: number; reads: number }> => {
      let layouts = 0;
      let reads = 0;
      const mo = new MutationObserver(() => {});
      await redrawnHiddenThenShown(text, async (show) => {
        mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        let dirty = true; // showing the body is itself a change the first read lays out for
        onLayoutRead = () => {
          reads += 1;
          if (mo.takeRecords().length > 0) dirty = true;
          if (dirty) layouts += 1;
          dirty = false;
        };
        await show();
        onLayoutRead = () => {};
        mo.disconnect();
      });
      cleanup();
      return { layouts, reads };
    };

    const one = await forcedLayouts(TABLE);
    const fourteen = await forcedLayouts(report);
    // Measured 2026-11-26 for the PR (081 T024): 5 forced layouts for one table (8 reads), and 5 for the 14-table,
    // 182-row shape (240 reads, every one inside those 5). A change that reads per table or per token breaks the next line.
    expect(fourteen.layouts).toBe(one.layouts);
    expect(fourteen.layouts).toBeLessThanOrEqual(5);
  }, 30_000);

  it('lays its tables out, once shown, with a fresh open\'s column widths, each within 1 px (SC-004)', async () => {
    const expected = await freshOpenWidths();
    expect(expected.every((w) => w > 0), 'the fresh open measured real widths').toBe(true);
    const host = await redrawnHiddenThenShown();
    const got = colWidths(host);
    expect(got).toHaveLength(expected.length);
    got.forEach((w, i) => expect(Math.abs(w - expected[i]!), `column ${i}: ${w} vs ${expected[i]}`).toBeLessThanOrEqual(1));
  });

  it('drags a column from that width: 40 px right makes the first column 40 px wider (FR-021)', async () => {
    const expected = await freshOpenWidths();
    const host = await redrawnHiddenThenShown();
    const handle = host.querySelector<HTMLElement>('.preview-table-resize-handle')!;
    handle.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 300, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 340 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 340 }));
    // In the widths the reader sees: the fresh open's first column as drawn, plus the 40 px the pointer moved.
    expect(drawnWidths(colWidths(host))[0]).toBeCloseTo(drawnWidths(expected)[0]! + 40, 0);
  });

  /*
   * 081 FR-020 — the same zeros inside a fold that hides a table at the draw: a collapsed callout, or a closed
   * `<details>`. Opening it changes the body's height, not its width, so no resize says so: the open itself lays out
   * the tables that were waiting, and only those (Principle XII).
   */
  const quoted = (text: string): string => text.split('\n').map((line) => `> ${line}`).join('\n');

  async function drawnShown(text: string, panelId = 'p1'): Promise<HTMLElement> {
    shown = true;
    render(createElement(MarkdownBody, props(text, { panelId })));
    const host = screen.getByTestId(`preview-markdown-${panelId}`);
    await waitFor(() => expect(host.querySelector('table')).not.toBeNull(), COLD);
    await settle();
    return host;
  }

  it('a table in a callout collapsed at the draw gets a fresh open\'s widths and its handle once the callout opens', async () => {
    const open = await drawnShown(`> [!note]+ Report\n${quoted(TABLE)}`, 'open');
    const expected = colWidths(open);
    expect(expected.every((w) => w > 0), 'the open callout measured real widths').toBe(true);
    cleanup();

    const host = await drawnShown(`> [!note]- Report\n${quoted(TABLE)}`);
    host.querySelector<HTMLElement>('[data-callout-title]')!.click();
    await settle();

    const got = colWidths(host);
    expect(got).toHaveLength(expected.length);
    got.forEach((w, i) => expect(Math.abs(w - expected[i]!), `column ${i}: ${w} vs ${expected[i]}`).toBeLessThanOrEqual(1));
    expect(host.querySelectorAll('.preview-table-resize-handle')).toHaveLength(1);
  });

  it('a table in a closed <details> is laid out when it opens', async () => {
    const host = await drawnShown(`<details><summary>More</summary>\n\n${TABLE}\n\n</details>`);
    const details = host.querySelector('details')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await settle();
    expect(colWidths(host).every((w) => w > 0) && colWidths(host).length === 2, `widths ${colWidths(host).join(', ')}`).toBe(true);
  });

  it('a table in a section collapsed at the draw is laid out when the section opens', async () => {
    const doc = `## One\n\n${TABLE}\n\n## Two\n\nText.`;
    shown = true;
    const collapsed = setSection(initialFold('expanded'), 'one', true);
    const { rerender } = render(createElement(MarkdownBody, props(doc, { gutter: true, foldState: collapsed })));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelector('table')).not.toBeNull(), COLD);
    await settle();
    rerender(createElement(MarkdownBody, props(doc, { gutter: true, foldState: initialFold('expanded') })));
    await settle();
    expect(colWidths(host).length === 2 && colWidths(host).every((w) => w > 0), `widths ${colWidths(host).join(', ')}`).toBe(true);
  });

  it('opening a callout with no table waiting reads no layout at all', async () => {
    const host = await drawnShown(`> [!note]- Plain\n> Just text.\n\n${TABLE}`);
    let reads = 0;
    onLayoutRead = () => void (reads += 1);
    host.querySelector<HTMLElement>('[data-callout-title]')!.click();
    await settle();
    expect(reads, 'layout reads forced by opening a callout with nothing waiting').toBe(0);
  });
});

/**
 * 047 T065/T066 (R13) — the Markdown body's table layout wiring. `preview-table-layout.test.ts`
 * proves `applyTableLayout`'s own DOM logic with a stubbed measurer; this is the WIRING inside a
 * mounted body — that it calls `applyTableLayout` after every draw (jsdom has no real layout, so every
 * measured width is degenerate zero, but the `<colgroup>`/handles it built from that answer are not).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

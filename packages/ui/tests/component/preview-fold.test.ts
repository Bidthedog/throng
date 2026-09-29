/**
 * 047 T044/T045 (R6, FR-030 – FR-032b, FR-035) — the Markdown body's fold gutter, mounted the way
 * `markdown-body.test.ts` mounts the body directly (not through the full panel — `preview-panel.tsx`
 * owns wiring `foldState`/`onFoldChange` to main's fold channels, out of this boundary).
 * `fold-gutter.test.ts` already proves `applyFoldGutter`'s DOM logic in isolation; this is the WIRING:
 * that a mounted body actually draws the gutter from its props and calls back correctly.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialFold, setSection, type FoldState } from '@throng/core';
import { MarkdownBody } from '../../src/renderer/preview/providers/markdown/markdown-body.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';

const COLD = { timeout: 10_000 };

const baseProps = (text: string, extra: Partial<PreviewBodyProps> = {}): PreviewBodyProps => ({
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

const DOC = '# One\n\nBody of one.\n\n# Two\n\nBody of two.';

afterEach(() => vi.restoreAllMocks());

describe('gutter on (T044/T045, FR-032a)', () => {
  it('shifts the document and draws one toggle per heading, with aria-expanded, a name and an icon', async () => {
    render(createElement(MarkdownBody, baseProps(DOC, { gutter: true, foldState: initialFold('expanded') })));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelectorAll('h1')).toHaveLength(2), COLD);

    expect(host.classList.contains('preview-markdown--gutter')).toBe(true);
    const toggles = host.querySelectorAll('button.preview-fold-toggle');
    expect(toggles).toHaveLength(2);
    for (const toggle of toggles) {
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(toggle.getAttribute('aria-label')).toMatch(/^Collapse section /);
      expect(toggle.querySelector('.icon')).not.toBeNull();
    }
  });

  it('clicking a toggle calls onFoldChange with the section collapsed, and does not follow a link or raise a notice (FR-035)', async () => {
    const onFoldChange = vi.fn();
    const onFollow = vi.fn();
    const onNotice = vi.fn();
    render(
      createElement(
        MarkdownBody,
        baseProps(DOC, { gutter: true, foldState: initialFold('expanded'), onFoldChange, onFollow, onNotice }),
      ),
    );
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelectorAll('button.preview-fold-toggle')).toHaveLength(2), COLD);

    fireEvent.click(host.querySelectorAll('button.preview-fold-toggle')[0]!);

    expect(onFoldChange).toHaveBeenCalledTimes(1);
    const next = onFoldChange.mock.calls[0]![0] as FoldState;
    expect(next.base).toBe('expanded');
    expect(next.flipped.length).toBe(1);
    expect(onFollow).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();
  });

  it('a collapsed section (from the foldState prop) hides its body but keeps the heading and toggle visible', async () => {
    const collapsed = setSection(initialFold('expanded'), 'one', true);
    render(createElement(MarkdownBody, baseProps(DOC, { gutter: true, foldState: collapsed })));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelectorAll('h1')).toHaveLength(2), COLD);

    const h1s = [...host.querySelectorAll('h1')];
    expect((h1s[0] as HTMLElement).hidden).toBe(false);
    expect(host.querySelector('button.preview-fold-toggle')?.getAttribute('aria-expanded')).toBe('false');
    const paragraphs = [...host.querySelectorAll('p')];
    expect((paragraphs[0] as HTMLElement).hidden).toBe(true); // "Body of one."
    expect((paragraphs[1] as HTMLElement).hidden).toBe(false); // "Body of two." — untouched
  });

  it('re-rendering with a new foldState prop re-hides WITHOUT a fresh draw disturbing anything else', async () => {
    const { rerender } = render(createElement(MarkdownBody, baseProps(DOC, { gutter: true, foldState: initialFold('expanded') })));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelectorAll('p')).toHaveLength(2), COLD);
    expect((host.querySelectorAll('p')[0] as HTMLElement).hidden).toBe(false);

    const collapsed = setSection(initialFold('expanded'), 'one', true);
    rerender(createElement(MarkdownBody, baseProps(DOC, { gutter: true, foldState: collapsed })));
    await waitFor(() => expect((host.querySelectorAll('p')[0] as HTMLElement).hidden).toBe(true));
  });
});

describe('gutter off (FR-032b)', () => {
  it('draws no toggle and no shift, even with a collapsed section — folding stays applied', async () => {
    const collapsed = setSection(initialFold('expanded'), 'one', true);
    render(createElement(MarkdownBody, baseProps(DOC, { gutter: false, foldState: collapsed })));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelectorAll('h1')).toHaveLength(2), COLD);

    expect(host.classList.contains('preview-markdown--gutter')).toBe(false);
    expect(host.querySelectorAll('button.preview-fold-toggle')).toHaveLength(0);
    // Folding is still applied — the gutter only controls the CONTROL, not the fold itself (R6).
    expect((host.querySelectorAll('p')[0] as HTMLElement).hidden).toBe(true);
  });

  it('is the default when the prop is simply absent (a harness that predates this feature)', async () => {
    render(createElement(MarkdownBody, baseProps(DOC)));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelectorAll('h1')).toHaveLength(2), COLD);
    expect(host.classList.contains('preview-markdown--gutter')).toBe(false);
    expect(host.querySelectorAll('button.preview-fold-toggle')).toHaveLength(0);
  });
});

describe('onHeadings and onRevealSection (R2, FR-040)', () => {
  it('reports the heading tree after every draw, an empty array for a document with none', async () => {
    const onHeadings = vi.fn();
    const { rerender } = render(createElement(MarkdownBody, baseProps(DOC, { onHeadings })));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelectorAll('h1')).toHaveLength(2), COLD);
    await waitFor(() => expect(onHeadings).toHaveBeenCalledTimes(1));
    expect(onHeadings.mock.calls[0]![0]).toHaveLength(2);

    rerender(createElement(MarkdownBody, baseProps('no headings here', { onHeadings })));
    await waitFor(() => expect(host.textContent).toContain('no headings here'));
    await waitFor(() => expect(onHeadings).toHaveBeenCalledTimes(2));
    expect(onHeadings.mock.calls[1]![0]).toEqual([]);
  });

  it('registers a reveal function that expands a collapsed section and scrolls to it', async () => {
    const collapsed = setSection(initialFold('expanded'), 'one', true);
    const onFoldChange = vi.fn();
    let reveal: ((slug: string) => void) | null = null;
    render(
      createElement(
        MarkdownBody,
        baseProps(DOC, {
          gutter: true,
          foldState: collapsed,
          onFoldChange,
          onRevealSection: (fn) => {
            reveal = fn;
          },
        }),
      ),
    );
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelectorAll('h1')).toHaveLength(2), COLD);
    expect(reveal).not.toBeNull();

    reveal!('one');

    expect(onFoldChange).toHaveBeenCalledTimes(1);
    const next = onFoldChange.mock.calls[0]![0] as FoldState;
    expect(next.flipped).toEqual([]); // back to fully expanded — the only flipped slug was revealed
  });
});

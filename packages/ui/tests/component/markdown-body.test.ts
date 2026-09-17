/**
 * 044 T069 — the Markdown body renders through the production renderer, sanitised, as DOM
 * (FR-080, FR-081, contracts/security-policy.md Layer 2).
 *
 * The pipeline's string output and the sanitiser's profile have their own tests; what only a mounted
 * body can show is the WIRING: that the body reaches `createMarkdownRenderer` (by dynamic import) rather
 * than some unsanitised path, that it fills its host with the returned fragment, and that a new text
 * replaces the old rather than appending to it.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownBody } from '../../src/renderer/preview/providers/markdown/markdown-body.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';

const props = (text: string): PreviewBodyProps => ({
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
});

/*
 * The FIRST render in a file pays the dynamic import of markdown-it, DOMPurify and yaml through vite's
 * transform, which measured just over waitFor's 1 s default on this machine (the first test failed at
 * 1031 ms while the next two, importing nothing, passed). The wait is the import, not the render.
 */
const COLD = { timeout: 10_000 };

afterEach(() => vi.restoreAllMocks());

describe('MarkdownBody', () => {
  it('renders Markdown as elements in its host', async () => {
    render(createElement(MarkdownBody, props('# Title\n\nSome *emphasis*.')));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelector('h1')?.textContent).toBe('Title'), COLD);
    expect(host.querySelector('em')?.textContent).toBe('emphasis');
  });

  it('inserts what the sanitiser returns — a script in the source never reaches the DOM', async () => {
    render(
      createElement(
        MarkdownBody,
        props('# Safe\n\n<script>window.__pwned = 1</script>\n\n<img src=x onerror="window.__pwned = 2">\n\n<a href="javascript:alert(1)">click</a>'),
      ),
    );
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelector('h1')).not.toBeNull(), COLD);
    // Every one of these is present in markdown-it's own output (`html: true`), so each can only be
    // absent because the sanitiser's fragment is what was inserted. jsdom runs no scripts, so whether a
    // payload EXECUTED is not something this layer can observe; that half is T163's, in a real engine.
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('[onerror]')).toBeNull();
    expect(host.querySelector('a[href]')).toBeNull();
  });

  it('fills the host with replaceChildren, and a new text REPLACES the old', async () => {
    const replace = vi.spyOn(Element.prototype, 'replaceChildren');
    const { rerender } = render(createElement(MarkdownBody, props('# One')));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelector('h1')?.textContent).toBe('One'), COLD);
    expect(replace).toHaveBeenCalled();

    rerender(createElement(MarkdownBody, props('# Two')));
    await waitFor(() => expect(host.querySelector('h1')?.textContent).toBe('Two'));
    expect(host.querySelectorAll('h1')).toHaveLength(1);
  });

  it('044 US3 fix round 1 (item 3) — reports every draw through onDrawn, exactly once, and never a failure', async () => {
    const onDrawn = vi.fn();
    const onBodyFailure = vi.fn();
    const withReports = (text: string): PreviewBodyProps => ({ ...props(text), onDrawn, onBodyFailure });
    const { rerender } = render(createElement(MarkdownBody, withReports('No headings, no links.')));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.textContent).toContain('No headings'), COLD);
    await waitFor(() => expect(onDrawn).toHaveBeenCalledTimes(1));
    expect(onDrawn).toHaveBeenCalledWith('D:/proj/README.md');

    rerender(createElement(MarkdownBody, withReports('Still plain.')));
    await waitFor(() => expect(host.textContent).toContain('Still plain'));
    await waitFor(() => expect(onDrawn).toHaveBeenCalledTimes(2));
    expect(onBodyFailure).not.toHaveBeenCalled();
  });
});

describe('the front matter class lands only on the front matter table (fix round 1, item 12)', () => {
  it('marks the key/value table a front matter block rendered', async () => {
    render(createElement(MarkdownBody, props('---\ntitle: T\n---\n\n| a |\n|--|\n| 1 |\n')));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelectorAll('table')).toHaveLength(2), COLD);
    const [front, body] = [...host.querySelectorAll('table')];
    expect(front).toHaveClass('preview-markdown__front-matter');
    expect(body).not.toHaveClass('preview-markdown__front-matter');
  });

  it('marks nothing when the block is empty — the first element is the document’s own table', async () => {
    render(createElement(MarkdownBody, props('---\n   \n---\n\n| a |\n|--|\n| 1 |\n')));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelector('table')).not.toBeNull(), COLD);
    expect(host.querySelector('.preview-markdown__front-matter')).toBeNull();
  });
});

describe('Show front matter (FR-117, iteration 2026-09-15)', () => {
  const DOC = '---\ntitle: Hidden title\n---\n\n# Body heading\n';
  const withFrontMatter = (showFrontMatter: boolean): PreviewBodyProps => ({
    ...props(DOC),
    providerSettings: { enabled: true, showFrontMatter },
  });

  it('off draws no front matter table; turning it on redraws with the table', async () => {
    const view = render(createElement(MarkdownBody, withFrontMatter(false)));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelector('h1')?.textContent).toBe('Body heading'), COLD);
    expect(host.querySelector('table')).toBeNull();
    expect(host.textContent).not.toContain('Hidden title');
    expect(host.querySelector('h1')?.getAttribute('data-source-line')).toBe('4');

    view.rerender(createElement(MarkdownBody, withFrontMatter(true)));
    await waitFor(() => expect(host.querySelector('table')).not.toBeNull());
    expect(host.querySelector('table')).toHaveClass('preview-markdown__front-matter');
    expect(host.textContent).toContain('Hidden title');
  });
});

/*
 * 044 T085 — an UPDATE keeps the reader's place; a different FILE starts at the top (FR-024).
 *
 * jsdom has no layout, so the rects are supplied: every source-mapped block is drawn at 20px per source
 * line and 40px tall inside a scroll container whose viewport starts at client y 100 — the geometry
 * `scroll-anchor.test.ts` reasons about, applied to the blocks the real renderer produced. Paragraph `Pn`
 * sits on source line `2n`, so it is at y `40n`.
 */
describe('MarkdownBody keeps the reading position across live updates (FR-024)', () => {
  const paragraphs = (n: number): string => Array.from({ length: n }, (_, i) => `P${i}`).join('\n\n');

  function mountInScroller(text: string, filePath = 'D:/proj/README.md', navigationSeq?: number) {
    const scroller = document.createElement('div');
    scroller.className = 'preview-panel__body';
    document.body.append(scroller);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
      if (this === scroller) return { top: 100, height: 400 } as DOMRect;
      const line = Number(this.getAttribute('data-source-line'));
      return { top: 100 + line * 20 - scroller.scrollTop, height: 40 } as DOMRect;
    });
    const at = (t: string, f: string, n?: number): PreviewBodyProps => ({
      ...props(t),
      filePath: f,
      ...(n !== undefined ? { navigationSeq: n } : {}),
    });
    const view = render(createElement(MarkdownBody, at(text, filePath, navigationSeq)), { container: scroller });
    return {
      scroller,
      rerender: (t: string, f = filePath, n = navigationSeq) => view.rerender(createElement(MarkdownBody, at(t, f, n))),
    };
  }

  afterEach(() => document.body.replaceChildren());

  it('follows the paragraph being read down when a heading is typed at the top of the source', async () => {
    const { scroller, rerender } = mountInScroller(paragraphs(30));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelectorAll('p')).toHaveLength(30), COLD);

    scroller.scrollTop = 250; // reading P6 (line 12, y 240), a quarter of the way in

    rerender(`# Hello\n\n${paragraphs(30)}`);
    await waitFor(() => expect(host.querySelector('h1')?.textContent).toBe('Hello'));

    // P6 is now on line 14, y 280: the same quarter of the way into it is 290. Without the anchor the
    // container would still say 250 — now a quarter of the way into P5.
    expect(scroller.scrollTop).toBe(290);
  });

  it('leaves a reader at the very top at the top', async () => {
    const { scroller, rerender } = mountInScroller(paragraphs(30));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelectorAll('p')).toHaveLength(30), COLD);

    rerender(`# Hello\n\n${paragraphs(30)}`);
    await waitFor(() => expect(host.querySelector('h1')).not.toBeNull());
    expect(scroller.scrollTop).toBe(0);
  });

  it('shows a DIFFERENT file from its top — following a link is navigation, not an update', async () => {
    const { scroller, rerender } = mountInScroller(paragraphs(30));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelectorAll('p')).toHaveLength(30), COLD);
    scroller.scrollTop = 250;

    rerender(`# Other\n\n${paragraphs(30)}`, 'D:/proj/docs/other.md');
    await waitFor(() => expect(host.querySelector('h1')?.textContent).toBe('Other'));
    expect(scroller.scrollTop).toBe(0);
  });

  /*
   * 044 T177 (FR-024 with FR-013c) — the path changed with NO navigation behind it: an in-app rename or
   * move, or a Save As from the parent editor. `navigationSeq` is main's count of this run's navigations;
   * a file change that leaves it alone is a RE-POINT, and the reader keeps their place. Absent — a body
   * mounted without it, as every test above — every file change is still a navigation.
   */
  describe('a re-point keeps the reader’s place, a navigation does not (T177, FR-013c)', () => {
    it('a rename: the same document under a new path, at the same navigation count', async () => {
      const { scroller, rerender } = mountInScroller(paragraphs(30), 'D:/proj/README.md', 4);
      const host = screen.getByTestId('preview-markdown-p1');
      await waitFor(() => expect(host.querySelectorAll('p')).toHaveLength(30), COLD);
      scroller.scrollTop = 250; // reading P6 (line 12, y 240), a quarter of the way in

      rerender(paragraphs(30), 'D:/proj/GUIDE.md', 4);
      await waitFor(() => expect(host.querySelectorAll('p')).toHaveLength(30));
      expect(scroller.scrollTop).toBe(250);
    });

    it('a rename whose content also changed keeps the place, remapped like any update', async () => {
      const { scroller, rerender } = mountInScroller(paragraphs(30), 'D:/proj/README.md', 4);
      const host = screen.getByTestId('preview-markdown-p1');
      await waitFor(() => expect(host.querySelectorAll('p')).toHaveLength(30), COLD);
      scroller.scrollTop = 250;

      rerender(`# Hello\n\n${paragraphs(30)}`, 'D:/proj/GUIDE.md', 4);
      await waitFor(() => expect(host.querySelector('h1')?.textContent).toBe('Hello'));
      // P6 moved down two source lines, exactly as it does for an update under the same path.
      expect(scroller.scrollTop).toBe(290);
    });

    it('a NAVIGATION — the count moved — still shows the new file from its top', async () => {
      const { scroller, rerender } = mountInScroller(paragraphs(30), 'D:/proj/README.md', 4);
      const host = screen.getByTestId('preview-markdown-p1');
      await waitFor(() => expect(host.querySelectorAll('p')).toHaveLength(30), COLD);
      scroller.scrollTop = 250;

      rerender(`# Other\n\n${paragraphs(30)}`, 'D:/proj/docs/other.md', 5);
      await waitFor(() => expect(host.querySelector('h1')?.textContent).toBe('Other'));
      expect(scroller.scrollTop).toBe(0);
    });

    it('an ordinary update under the same path is unaffected by the count', async () => {
      const { scroller, rerender } = mountInScroller(paragraphs(30), 'D:/proj/README.md', 4);
      const host = screen.getByTestId('preview-markdown-p1');
      await waitFor(() => expect(host.querySelectorAll('p')).toHaveLength(30), COLD);
      scroller.scrollTop = 250;

      rerender(`# Hello\n\n${paragraphs(30)}`);
      await waitFor(() => expect(host.querySelector('h1')?.textContent).toBe('Hello'));
      expect(scroller.scrollTop).toBe(290);
    });
  });
});

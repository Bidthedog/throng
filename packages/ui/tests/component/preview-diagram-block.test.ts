/**
 * 054 T036 — a diagram in a Markdown preview (FR-040, FR-041, FR-044, FR-046, FR-046g, FR-047, FR-048,
 * research R5).
 *
 * Layer: component — what the body draws for a claimed fence and what `DiagramBlock` shows for each outcome
 * is all in the DOM. The renderer is a FAKE registered for `mermaid` through the same seam the real one
 * uses: jsdom cannot lay out SVG, and the real library is `preview-mermaid.e2e.ts`'s. The renderer's own
 * rules (strict mode, sanitiser, timeout) are `mermaid-renderer.test.ts`'s; here a timeout is simply the
 * rejection that renderer produces.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownBody } from '../../src/renderer/preview/providers/markdown/markdown-body.js';
import { DiagramBlock } from '../../src/renderer/preview/diagram/diagram-block.js';
import {
  registerBlockRenderer,
  type BlockRenderer,
  type BlockRendererEntry,
} from '../../src/renderer/preview/blocks/block-renderers.js';
import type { DiagramTheme } from '../../src/renderer/preview/diagram/diagram-theme.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';

const COLD = { timeout: 10_000 };
const SVG_NS = 'http://www.w3.org/2000/svg';

const THEME_A: DiagramTheme = {
  background: '#101010', foreground: '#eeeeee', muted: '#999999', accent: '#3388ff', border: '#444444',
  surface: '#202020', selection: '#304060', fontFamily: 'Fira Sans', key: 'A',
};
const THEME_B: DiagramTheme = { ...THEME_A, background: '#fafafa', foreground: '#111111', key: 'B' };

/** Draws its source as one `<text>`; INVALID is a parse error; SLOW is the renderer's timeout rejection. */
const fake: BlockRenderer & { render: ReturnType<typeof vi.fn> } = {
  render: vi.fn((source: string, { theme }: { theme: DiagramTheme }) => {
    if (source.includes('INVALID')) return Promise.reject(new Error('Parse error on line 1:'));
    if (source.includes('SLOW')) return Promise.reject(new Error('The diagram took longer than 5 seconds to draw.'));
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.setAttribute('viewBox', '0 0 200 100');
    const text = document.createElementNS(SVG_NS, 'text');
    text.textContent = `${source.trim()} @${theme.key}`;
    svg.appendChild(text);
    return Promise.resolve(svg);
  }),
};
const load = vi.fn(() => Promise.resolve(fake as BlockRenderer));
const ENTRY: BlockRendererEntry = { lang: 'mermaid', load };

let restoreRegistry: (() => void) | null = null;
beforeEach(() => {
  fake.render.mockClear();
  load.mockClear();
  restoreRegistry = registerBlockRenderer(ENTRY);
});
afterEach(() => {
  restoreRegistry?.();
});

const bodyProps = (text: string, settings: Record<string, unknown> = {}): PreviewBodyProps => ({
  panelId: 'p1',
  content: { kind: 'text', text },
  filePath: 'D:/proj/README.md',
  projectRoot: 'D:/proj',
  providerSettings: { enabled: true, ...settings },
  initialViewState: undefined,
  onViewStateCapture: () => {},
  onFollow: () => {},
  onNotice: () => {},
  onDrawn: () => {},
  onBodyFailure: () => {},
});

const host = (): HTMLElement => screen.getByTestId('preview-markdown-p1');
const notice = (i = 0): HTMLElement | null => screen.queryByTestId(`diagram-notice-p1-diagram-${i}`);
const frame = (i = 0): HTMLElement | null => screen.queryByTestId(`diagram-frame-p1-diagram-${i}`);

const DOC = '# Doc\n\n```mermaid\ngraph TD\n```\n\nAfter.';

describe('in a Markdown preview (FR-040, FR-041, FR-047)', () => {
  it('draws a mermaid fence as a diagram, through the registered renderer, and leaves the rest of the document', async () => {
    render(createElement(MarkdownBody, bodyProps(DOC)));
    await waitFor(() => expect(frame()?.querySelector('svg text')?.textContent).toMatch(/^graph TD @/), COLD);
    expect(host().querySelector('code[data-lang="mermaid"]')).toBeNull();
    expect(host().querySelector('h1')?.textContent).toBe('Doc');
    expect(host()).toHaveTextContent('After.');
  });

  it('with Render Mermaid diagrams off the fence is a code block again, and nothing is loaded (FR-041)', async () => {
    render(createElement(MarkdownBody, bodyProps(DOC, { renderMermaid: false })));
    await waitFor(() => expect(host().querySelector('code[data-lang="mermaid"]')?.textContent).toBe('graph TD\n'), COLD);
    expect(frame()).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('turning the setting on draws it without a restart', async () => {
    const { rerender } = render(createElement(MarkdownBody, bodyProps(DOC, { renderMermaid: false })));
    await waitFor(() => expect(host().querySelector('code[data-lang="mermaid"]')).not.toBeNull(), COLD);
    rerender(createElement(MarkdownBody, bodyProps(DOC, { renderMermaid: true })));
    await waitFor(() => expect(frame()?.querySelector('svg')).toBeTruthy());
  });

  it('a preview with no diagram never loads the renderer (FR-047)', async () => {
    render(createElement(MarkdownBody, bodyProps('# Plain\n\n```ts\nconst a = 1;\n```')));
    await waitFor(() => expect(host().querySelector('h1')).not.toBeNull(), COLD);
    await act(() => Promise.resolve());
    expect(load).not.toHaveBeenCalled();
  });
});

describe('a diagram that does not parse (FR-044)', () => {
  it('never rendered: one inline notice naming the error, alone, and the document still drawn', async () => {
    render(createElement(MarkdownBody, bodyProps('```mermaid\nINVALID\n```\n\nAfter.')));
    await waitFor(() => expect(notice()).not.toBeNull(), COLD);
    expect(notice()).toHaveTextContent('Parse error on line 1:');
    expect(frame()).toBeNull();
    expect(host()).toHaveTextContent('After.');
  });

  it('after a good render: the last good diagram stays, dimmed, under the notice; the next good render clears both', async () => {
    const { rerender } = render(createElement(MarkdownBody, bodyProps('```mermaid\ngraph TD\n```')));
    await waitFor(() => expect(frame()?.querySelector('svg')).toBeTruthy(), COLD);

    rerender(createElement(MarkdownBody, bodyProps('```mermaid\ngraph TD INVALID\n```')));
    await waitFor(() => expect(notice()).not.toBeNull());
    expect(frame()?.querySelector('svg text')?.textContent).toMatch(/^graph TD @/);
    expect(frame()!.classList.contains('preview-diagram-frame--dimmed')).toBe(true);
    // The notice is ABOVE the diagram.
    expect(notice()!.compareDocumentPosition(frame()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    rerender(createElement(MarkdownBody, bodyProps('```mermaid\ngraph LR\n```')));
    await waitFor(() => expect(frame()?.querySelector('svg text')?.textContent).toMatch(/^graph LR @/));
    expect(notice()).toBeNull();
    expect(frame()!.classList.contains('preview-diagram-frame--dimmed')).toBe(false);
  });

  it('a render that runs out of time shows the same inline notice (FR-048)', async () => {
    render(createElement(MarkdownBody, bodyProps('```mermaid\nSLOW\n```')));
    await waitFor(() => expect(notice()).toHaveTextContent('longer than 5 seconds'), COLD);
  });
});

describe('across live updates (FR-044, FR-046g)', () => {
  it('each diagram keeps its state by ordinal when the document changes elsewhere', async () => {
    const two = (lead: string): string => `${lead}\`\`\`mermaid\ngraph A\n\`\`\`\n\n\`\`\`mermaid\ngraph B\n\`\`\``;
    const { rerender } = render(createElement(MarkdownBody, bodyProps(two(''))));
    await waitFor(() => expect(frame(1)?.querySelector('svg')).toBeTruthy(), COLD);
    fireEvent.click(within(frame(1)!).getByTitle('Zoom in'));
    expect(frame(1)!.getAttribute('data-mode')).toBe('zoom');

    rerender(createElement(MarkdownBody, bodyProps(two('A new paragraph above.\n\n'))));
    await waitFor(() => expect(host()).toHaveTextContent('A new paragraph above.'));
    expect(frame(1)!.getAttribute('data-mode')).toBe('zoom');
    expect(frame(0)!.getAttribute('data-mode')).toBe('fit');
  });

  it('an edit that leaves a diagram unchanged does not render it again', async () => {
    const { rerender } = render(createElement(MarkdownBody, bodyProps(DOC)));
    await waitFor(() => expect(frame()?.querySelector('svg')).toBeTruthy(), COLD);
    const calls = fake.render.mock.calls.length;
    rerender(createElement(MarkdownBody, bodyProps(`${DOC}\n\nMore text.`)));
    await waitFor(() => expect(host()).toHaveTextContent('More text.'));
    expect(fake.render.mock.calls.length).toBe(calls);
    expect(frame()?.querySelector('svg')).toBeTruthy();
  });
});

describe('DiagramBlock follows the theme (FR-046)', () => {
  it('renders again with the new theme, without a remount', async () => {
    const props = { panelId: 'p1', sectionId: 'diagram-0', source: 'graph TD\n', entry: ENTRY };
    const { rerender } = render(createElement(DiagramBlock, { ...props, theme: THEME_A }));
    await waitFor(() => expect(frame()?.querySelector('svg text')?.textContent).toBe('graph TD @A'));
    rerender(createElement(DiagramBlock, { ...props, theme: THEME_B }));
    await waitFor(() => expect(frame()?.querySelector('svg text')?.textContent).toBe('graph TD @B'));
    expect(fake.render).toHaveBeenLastCalledWith('graph TD\n', { theme: THEME_B });
  });
});

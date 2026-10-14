/**
 * 054 — a Markdown preview draws an embedded Mermaid file (`![[x.mmd]]`, `![alt](x.mmd)`) as an inline diagram
 * from the text main reads for it, shows a refusal as one notice in its place, and picks up a changed file at
 * the next draw (manual test decision, 2026-10-11).
 *
 * Layer: component — the real `MarkdownBody` with a fake diagram renderer and a fake `readEmbeds`; what main
 * reads and confines is `integration/preview-embeds.integration.test.ts`, the spellings are unit.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewEmbedRead } from '@throng/core';
import { MarkdownBody } from '../../src/renderer/preview/providers/markdown/markdown-body.js';
import { registerBlockRenderer, type BlockRenderer, type BlockRendererEntry } from '../../src/renderer/preview/blocks/block-renderers.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const fake: BlockRenderer & { render: ReturnType<typeof vi.fn> } = {
  render: vi.fn((source: string) => {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.setAttribute('viewBox', '0 0 200 100');
    const label = document.createElementNS(SVG_NS, 'text');
    label.textContent = source.trim();
    svg.appendChild(label);
    return Promise.resolve(svg);
  }),
};
const ENTRY: BlockRendererEntry = { lang: 'mermaid', load: () => Promise.resolve(fake as BlockRenderer) };
let restoreRegistry: (() => void) | null = null;

beforeEach(() => {
  fake.render.mockClear();
  restoreRegistry = registerBlockRenderer(ENTRY);
});
afterEach(() => restoreRegistry?.());

const props = (text: string, readEmbeds: PreviewBodyProps['readEmbeds']): PreviewBodyProps => ({
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
  readEmbeds,
});

const answering = (files: Record<string, string>) =>
  vi.fn(async (refs: readonly string[]) => ({
    results: refs.map((ref): PreviewEmbedRead => (ref in files ? { ref, ok: true, text: files[ref]! } : { ref, ok: false, reason: 'missing' })),
  }));

const frameText = () => screen.getByTestId('diagram-frame-p1-diagram-0').querySelector('svg text')?.textContent;

describe('an embedded Mermaid file', () => {
  it('![[flow.mmd]] draws the file as an inline diagram', async () => {
    const read = answering({ 'flow.mmd': 'graph TD; A-->B\n' });
    render(createElement(MarkdownBody, props('# Doc\n\n![[flow.mmd]]\n', read)));
    await waitFor(() => expect(frameText()).toBe('graph TD; A-->B'), { timeout: 10_000 });
    expect(read).toHaveBeenCalledWith(['flow.mmd']);
  });

  // FR-046m (manual test change request, 2026-10-13) — the document sets the box height, for an embed and a fence.
  it('![[flow.mmd|300]] and ```mermaid height=240 draw in boxes of those heights', async () => {
    const read = answering({ 'flow.mmd': 'graph TD; A-->B\n' });
    render(createElement(MarkdownBody, props('![[flow.mmd|300]]\n\n```mermaid height=240\ngraph LR; C-->D\n```\n', read)));
    const viewportOf = (ordinal: number): HTMLElement | null =>
      screen.queryByTestId(`diagram-frame-p1-diagram-${ordinal}`)?.querySelector<HTMLElement>('.preview-diagram-frame__viewport') ?? null;
    await waitFor(() => expect(viewportOf(0)?.style.height).toBe('300px'), { timeout: 10_000 });
    await waitFor(() => expect(viewportOf(1)?.style.height).toBe('240px'), { timeout: 10_000 });
  });

  it('![Order flow](order.mmd) draws it too', async () => {
    render(createElement(MarkdownBody, props('![Order flow](order.mmd)\n', answering({ 'order.mmd': 'graph LR; X-->Y\n' }))));
    await waitFor(() => expect(frameText()).toBe('graph LR; X-->Y'), { timeout: 10_000 });
  });

  it('a missing file shows one notice naming it, and no diagram', async () => {
    render(createElement(MarkdownBody, props('![[gone.mmd]]\n', answering({}))));
    expect(await screen.findByText('Embedded diagram not found: gone.mmd', undefined, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.queryByTestId('diagram-frame-p1-diagram-0')).toBeNull();
  });

  it('a link to the same file stays a link', async () => {
    const read = answering({ 'flow.mmd': 'graph TD; A-->B\n' });
    render(createElement(MarkdownBody, props('[the flow](flow.mmd)\n', read)));
    expect(await screen.findByRole('link', { name: 'the flow' }, { timeout: 10_000 })).toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
  });

  it('a changed file is drawn at the next draw of the document', async () => {
    const files: Record<string, string> = { 'flow.mmd': 'graph TD; A-->B\n' };
    const read = vi.fn(async (refs: readonly string[]) => ({
      results: refs.map((ref): PreviewEmbedRead => ({ ref, ok: true, text: files[ref]! })),
    }));
    const view = render(createElement(MarkdownBody, props('![[flow.mmd]]\n', read)));
    await waitFor(() => expect(frameText()).toBe('graph TD; A-->B'), { timeout: 10_000 });
    files['flow.mmd'] = 'graph TD; A-->C\n';
    view.rerender(createElement(MarkdownBody, props('![[flow.mmd]]\n\nmore\n', read)));
    await waitFor(() => expect(frameText()).toBe('graph TD; A-->C'), { timeout: 10_000 });
  });
});

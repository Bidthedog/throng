/**
 * 054 (manual test change request, 2026-10-12) — a diagram's first draw can take a moment, so the block shows
 * "Drawing diagram…" with a spinner until the SVG arrives, and never once it has (or once it has failed).
 *
 * Layer: component — the real `DiagramBlock` over a renderer whose answer the test releases.
 */
import { render, screen } from '@testing-library/react';
import { act, createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { DiagramBlock } from '../../src/renderer/preview/diagram/diagram-block.js';
import type { BlockRendererEntry } from '../../src/renderer/preview/blocks/block-renderers.js';
import type { DiagramTheme } from '../../src/renderer/preview/diagram/diagram-theme.js';

const THEME = { key: 'dark' } as DiagramTheme;

function deferredEntry(): { entry: BlockRendererEntry; resolve: () => void; reject: () => void } {
  let resolve!: () => void;
  let reject!: () => void;
  const drawn = new Promise<SVGSVGElement>((ok, fail) => {
    resolve = () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
      svg.setAttribute('viewBox', '0 0 100 50');
      ok(svg);
    };
    reject = () => fail(new Error('bad'));
  });
  return { entry: { lang: 'mermaid', load: () => Promise.resolve({ render: () => drawn }) }, resolve, reject };
}

const block = (entry: BlockRendererEntry) =>
  createElement(DiagramBlock, { panelId: 'p1', sectionId: 'diagram-0', source: 'graph TD; A-->B', entry, theme: THEME });

describe('a diagram drawing for the first time', () => {
  it('shows the spinner until its SVG arrives', async () => {
    const d = deferredEntry();
    render(block(d.entry));
    expect(screen.getByTestId('diagram-loading-p1-diagram-0')).toHaveTextContent('Drawing diagram…');
    await act(async () => d.resolve());
    expect(screen.queryByTestId('diagram-loading-p1-diagram-0')).toBeNull();
    expect(screen.getByTestId('diagram-frame-p1-diagram-0')).toBeInTheDocument();
  });

  it('a failure replaces the spinner with its notice', async () => {
    const d = deferredEntry();
    render(block(d.entry));
    await act(async () => d.reject());
    expect(screen.queryByTestId('diagram-loading-p1-diagram-0')).toBeNull();
    expect(screen.getByTestId('diagram-notice-p1-diagram-0')).toHaveTextContent('bad');
  });
});

/**
 * 054 T042 — hostile diagrams (FR-045, 044 FR-093, research R5): a document that tries to make a diagram
 * run script, follow a `javascript:` URL, register a click callback or fetch a remote image gets none of
 * it, and the diagram sanitiser is in the path for every embedded diagram.
 *
 * Layer: component — the fixture goes through the REAL pipeline and document sanitiser, the REAL Mermaid
 * renderer module and the REAL diagram sanitiser. Only the mermaid library is faked: jsdom cannot lay out
 * SVG. The fake does the worst a compromised or buggy library could — it echoes the hostile source into the
 * SVG it returns, script, handlers, links, remote references and HTML included — so what this proves is
 * that NOTHING the library returns reaches the DOM unsanitised. Whether the real library at strict level
 * emits any of it is `preview-mermaid.e2e.ts`'s; whether anything executes in a real engine is the CSP's.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownBody } from '../../src/renderer/preview/providers/markdown/markdown-body.js';
import { registerBlockRenderer } from '../../src/renderer/preview/blocks/block-renderers.js';
import { createMermaidRenderer, type MermaidLike } from '../../src/renderer/preview/diagram/mermaid-renderer.js';
import { createDiagramSvgSanitiser } from '../../src/renderer/preview/diagram/svg-sanitise.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';

const FIXTURE = resolve(process.cwd(), 'packages/ui/tests/fixtures/preview/mermaid-hostile.md');
const COLD = { timeout: 10_000 };

/** What a hostile library could hand back: the source, raw, inside the SVG. */
function hostileSvg(source: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 100" onload="window.__pwned = 5">' +
    `<style>@import url("https://evil.example/a.css"); .n { fill: url(https://evil.example/f.png) }</style>` +
    `<script>window.__pwned = 6</script>` +
    `<a href="javascript:window.__pwned = 7"><text>link</text></a>` +
    `<image href="https://evil.example/i.png"/><use xlink:href="https://evil.example/u.svg#x"/>` +
    `<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">${source}</div></foreignObject>` +
    `<g class="n" onclick="window.__pwned = 8"><rect width="10" height="10"/><text>${source.replace(/</g, '&lt;')}</text></g>` +
    '</svg>'
  );
}

const mermaid: MermaidLike & { render: ReturnType<typeof vi.fn> } = {
  initialize: vi.fn(),
  parse: vi.fn(() => Promise.resolve(true)),
  render: vi.fn((_id: string, source: string) => Promise.resolve({ svg: hostileSvg(source) })),
};
const realSanitiser = createDiagramSvgSanitiser(window);
const sanitise = vi.fn(realSanitiser);

let text = '';
let restore: (() => void) | null = null;
const requests: string[] = [];

beforeAll(() => {
  text = readFileSync(FIXTURE, 'utf8');
  // A guard on the guard: if the fixture lost its vectors, every negative below would pass vacuously.
  for (const vector of ['<script>', 'click A callback', 'javascript:', 'https://evil.example/', 'securityLevel']) {
    expect(text).toContain(vector);
  }
});

beforeEach(() => {
  delete (window as unknown as Record<string, unknown>).__pwned;
  requests.length = 0;
  sanitise.mockClear();
  mermaid.render.mockClear();
  const renderer = createMermaidRenderer({ loadMermaid: () => Promise.resolve(mermaid), sanitise });
  restore = registerBlockRenderer({ lang: 'mermaid', load: () => Promise.resolve(renderer) });
  vi.spyOn(window, 'fetch').mockImplementation((input) => {
    requests.push(String(input));
    return Promise.reject(new Error('no network'));
  });
});

afterEach(() => {
  restore?.();
  vi.restoreAllMocks();
});

const props: PreviewBodyProps = {
  panelId: 'p1',
  content: { kind: 'text', text: '' },
  filePath: 'D:/proj/hostile.md',
  projectRoot: 'D:/proj',
  providerSettings: { enabled: true },
  initialViewState: undefined,
  onViewStateCapture: () => {},
  onFollow: () => {},
  onNotice: () => {},
  onDrawn: () => {},
  onBodyFailure: () => {},
};

async function mount(): Promise<HTMLElement> {
  render(createElement(MarkdownBody, { ...props, content: { kind: 'text', text } }));
  const body = screen.getByTestId('preview-markdown-p1');
  await waitFor(() => expect(body.querySelectorAll('.preview-diagram-frame svg')).toHaveLength(2), COLD);
  return body;
}

describe('hostile diagrams (FR-045)', () => {
  it('the diagram sanitiser is in the path for every embedded diagram, with what the library returned', async () => {
    await mount();
    expect(mermaid.render).toHaveBeenCalledTimes(2);
    expect(sanitise).toHaveBeenCalledTimes(2);
    for (const [i, call] of mermaid.render.mock.results.entries()) {
      const { svg } = await (call.value as Promise<{ svg: string }>);
      expect(sanitise.mock.calls[i]![0]).toBe(svg);
    }
  });

  it('leaves no script, handler, link, foreign HTML or external reference in the preview', async () => {
    const body = await mount();
    const diagrams = [...body.querySelectorAll('.preview-diagram-host')];
    expect(diagrams).toHaveLength(2);
    for (const host of diagrams) {
      expect(host.querySelector('script, foreignObject, iframe, a, image, use, img')).toBeNull();
      for (const el of host.querySelectorAll('*')) {
        for (const attr of el.attributes) {
          expect(attr.name, el.outerHTML).not.toMatch(/^on/i);
          expect(attr.value, `${attr.name} on ${el.tagName}`).not.toMatch(/javascript:|evil\.example/i);
        }
      }
      for (const style of host.querySelectorAll('style')) expect(style.textContent).not.toMatch(/evil\.example|@import/);
    }
  });

  it('executes nothing and requests nothing; the rest of the document is drawn', async () => {
    const body = await mount();
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
    expect(requests).toEqual([]);
    expect(body).toHaveTextContent('Plain text after the diagrams.');
  });

  it('the renderer still asks the library for its strictest level, whatever the document\'s init directive says', async () => {
    await mount();
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: 'strict', startOnLoad: false }));
  });
});

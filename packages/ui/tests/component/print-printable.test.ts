import { afterEach, describe, expect, it } from 'vitest';
import { PRINT_PALETTE } from '@throng/core';
import { buildPrintable, printableClone } from '../../src/renderer/preview/print/printable.js';

/**
 * 075 FR-066, FR-072, FR-074 – FR-079 — the printable document: a cleaned clone of what the preview shows, every
 * fold open, nothing throng drew, only images the preview had loaded.
 *
 * Layer: component — the subject is a DOM clone and its serialisation (jsdom).
 */
let mounted: HTMLElement[] = [];
afterEach(() => {
  for (const el of mounted) el.remove();
  mounted = [];
});

function body(html: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'preview-markdown';
  el.innerHTML = html;
  document.body.append(el);
  mounted.push(el);
  return el;
}

describe('the printable clone', () => {
  it('opens every collapsed section and callout (FR-074)', () => {
    const live = body('<h2>A</h2><p hidden>hidden body</p><div data-callout="note" data-callout-collapsed=""><div data-callout-body="" hidden>inside</div></div>');
    const { root } = printableClone(live, 'width');
    expect(root.querySelector('[hidden]')).toBeNull();
    expect(root.querySelector('[data-callout-collapsed]')).toBeNull();
    expect(live.querySelector('p')?.hidden).toBe(true);
    expect(live.querySelector('[data-callout-collapsed]')).not.toBeNull();
  });

  it('removes what throng drew, and the links\' roles and tab stops (FR-077)', () => {
    const live = body(
      '<h2>A<button class="preview-fold-toggle">v</button></h2><div data-callout="tip"><div data-callout-title="" role="button" tabindex="0" aria-expanded="true">T<span class="preview-callout__fold"></span></div></div><a href="#x" role="link" tabindex="0">x</a><div role="status">Link not found</div>',
    );
    const { root } = printableClone(live, 'width');
    expect(root.querySelector('.preview-fold-toggle, .preview-callout__fold')).toBeNull();
    expect(root.querySelector('[role], [tabindex], [aria-expanded]')).toBeNull();
    expect(root.textContent).not.toContain('Link not found');
  });

  it('prints a drawn diagram as its SVG, and a failed one as its notice', () => {
    const live = body(
      '<div class="preview-diagram-host"><div class="preview-diagram-frame__toolbar">tools</div><div class="preview-diagram-frame__layer" style="transform: scale(3)"><svg width="900" height="400" style="max-width:900px"><g></g></svg></div></div>' +
        '<div class="preview-diagram-host"><div class="preview-diagram__notice" role="status">Diagram error: bad</div></div>',
    );
    const { root } = printableClone(live, 'page');
    const figures = root.querySelectorAll('.throng-print__diagram');
    expect(figures).toHaveLength(2);
    const svg = figures[0]!.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBeNull();
    expect(svg.getAttribute('style')).toBeNull();
    expect(figures[0]!.classList.contains('throng-print__diagram--page')).toBe(true);
    expect(root.textContent).not.toContain('tools');
    expect(figures[1]!.textContent).toBe('Diagram error: bad');
  });

  it('keeps a remote image only when the preview loaded it (FR-079)', () => {
    const live = body('<img src="https://e.com/loaded.png" alt="L"><img src="https://e.com/blocked.png" alt="B"><img src="throng-preview://asset/p/a.png" alt="local">');
    const [loaded] = live.querySelectorAll('img');
    Object.defineProperty(loaded, 'complete', { value: true });
    Object.defineProperty(loaded, 'naturalWidth', { value: 10 });
    const { root, remoteImages } = printableClone(live, 'width');
    expect(remoteImages).toEqual(['https://e.com/loaded.png']);
    expect([...root.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(['https://e.com/loaded.png', 'throng-preview://asset/p/a.png']);
    expect(root.textContent).toContain('B');
  });
});

describe('the printable document', () => {
  it('runs nothing, requests only the loaded images, and carries the print palette and stylesheet (FR-072, FR-079)', () => {
    const output = buildPrintable(body('<h1>T</h1><pre><code>x</code></pre>'), { title: 'a.md', fit: 'width', stylesheets: '.x{}', baseHref: 'file:///app/' });
    if (output.kind !== 'document') throw new Error('expected a document');
    expect(output.html).toContain("default-src 'none'");
    expect(output.html).not.toMatch(/<script/i);
    expect(output.html).toContain(`--throng-colour-text:${PRINT_PALETTE.text};`);
    expect(output.html).toContain('break-after: avoid');
    expect(output.html).toContain('break-inside: avoid');
    expect(output.html).toContain('<title>a.md</title>');
    expect(output.fit).toBe('width');
  });
});

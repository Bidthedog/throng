import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { createDiagramSvgSanitiser } from '../../src/renderer/preview/diagram/svg-sanitise.js';

/**
 * 054 T030 — the diagram SVG profile (FR-045, research R5): what a rendered diagram may keep once mermaid
 * has drawn it, before it reaches the preview's DOM.
 *
 * Node, with a JSDOM window handed to the sanitiser as its root — DOMPurify needs a DOM to parse with, and
 * the sanitiser takes its window as a parameter exactly as the document sanitiser does.
 */
const { window } = new JSDOM('');
const sanitise = createDiagramSvgSanitiser(window as unknown as Window & typeof globalThis);

const svg = (inner: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">${inner}</svg>`;

function out(inner: string): SVGSVGElement {
  const result = sanitise(svg(inner));
  if (result === null) throw new Error('sanitiser returned nothing');
  return result;
}

describe('what a diagram keeps', () => {
  it('keeps shapes, text, groups, markers and local # references', () => {
    const el = out(
      '<defs><marker id="arrow"><path d="M0 0L1 1"/></marker></defs>' +
        '<g class="node"><rect x="1" y="1" width="5" height="5" fill="#fff"/><text x="2" y="2">Label</text></g>' +
        '<path d="M0 0L5 5" marker-end="url(#arrow)"/><textPath href="#arrow">t</textPath>',
    );
    expect(el.tagName.toLowerCase()).toBe('svg');
    expect(el.querySelector('rect')).not.toBeNull();
    expect(el.querySelector('text')?.textContent).toBe('Label');
    expect(el.querySelector('marker#arrow')).not.toBeNull();
    expect(el.querySelector('path[marker-end]')?.getAttribute('marker-end')).toBe('url(#arrow)');
    expect(el.querySelector('textPath')?.getAttribute('href')).toBe('#arrow');
  });

  it('keeps the diagram\'s own <style>, which carries its theme', () => {
    const el = out('<style>#m .node rect{fill:#123456;stroke:#abcdef;}</style><rect/>');
    expect(el.querySelector('style')?.textContent).toContain('fill:#123456');
  });
});

describe('what a diagram loses (FR-045)', () => {
  it('strips script, with its content', () => {
    const el = out('<script>alert(1)</script><rect/>');
    expect(el.querySelector('script')).toBeNull();
    expect(el.outerHTML).not.toContain('alert');
  });

  it('strips foreignObject, with its HTML', () => {
    const el = out('<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"></div></foreignObject>');
    expect(el.querySelector('foreignObject')).toBeNull();
    expect(el.outerHTML).not.toMatch(/img|onerror/);
  });

  it('strips every on* attribute', () => {
    const el = out('<rect onclick="alert(1)" onmouseover="x()"/><g onload="y()"/>');
    expect(el.outerHTML).not.toMatch(/\son[a-z]+=/i);
  });

  it('strips an external href and xlink:href, and a javascript: one', () => {
    const el = out(
      '<textPath href="https://evil.example/x.svg#a">a</textPath><textPath xlink:href="//evil.example/y#b">b</textPath>' +
        '<textPath href="javascript:alert(1)">c</textPath><use href="#ok"/><image href="https://evil.example/p.png"/>',
    );
    for (const path of el.querySelectorAll('textPath')) {
      expect(path.getAttribute('href')).toBeNull();
      expect(path.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBeNull();
    }
    // `use` can pull in an external document's content: never admitted, local or not.
    expect(el.querySelector('use')).toBeNull();
    expect(el.querySelector('image')).toBeNull();
    expect(el.outerHTML).not.toMatch(/evil|javascript:/);
  });

  it('strips links: a diagram is never a link surface', () => {
    const el = out('<a href="https://evil.example/"><text>click</text></a>');
    expect(el.querySelector('a')).toBeNull();
    expect(el.outerHTML).not.toContain('evil');
  });

  it('neutralises a remote url() and @import in a style element or attribute — no network (FR-045, 044 FR-093)', () => {
    const el = out(
      '<style>@import url("https://evil.example/a.css");.n{fill:url(https://evil.example/f.png)}.k{fill:url(#grad)}</style>' +
        '<rect style="fill:url(//evil.example/g.png);stroke:#fff"/>',
    );
    expect(el.outerHTML).not.toContain('evil');
    expect(el.querySelector('style')?.textContent).toContain('url(#grad)');
    expect(el.querySelector('rect')?.getAttribute('style')).toContain('stroke:#fff');
  });

  it('returns null for input that is not an SVG', () => {
    expect(sanitise('<div>not a diagram</div>')).toBeNull();
  });
});

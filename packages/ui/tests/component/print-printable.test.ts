import { afterEach, describe, expect, it } from 'vitest';
import { PRINT_PALETTE } from '@throng/core';
import { buildPrintable, printableClone } from '../../src/renderer/preview/print/printable.js';
import { registerRasterSource } from '../../src/renderer/preview/diagram/rasterise.js';
import { PRINT_STYLESHEET } from '../../src/renderer/preview/print/print-stylesheet.js';
import { SYNC_MARK_CLASS, SYNC_MARK_ON_CLASS } from '../../src/renderer/preview/sync-mark-classes.js';

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

  it('opens a raw <details> block, leaving the preview\'s own closed (FR-074, orchestrator decision 2026-11-21)', () => {
    // Walk-through: a `<details>` in a Markdown file printed only "► Folded section".
    const live = body('<details><summary>Folded section</summary><p>Hidden until printed.</p></details>');
    const { root } = printableClone(live, 'width');
    expect(root.querySelector('details')?.open).toBe(true);
    expect(live.querySelector('details')?.open).toBe(false);
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

  it('leaves out find\'s match frames: Print… while find is open prints no outlines (FR-076)', () => {
    // Print… hands over the panel body, and find draws its frames in a layer inside it, beside the content.
    const host = document.createElement('div');
    host.className = 'preview-panel__body';
    host.innerHTML =
      '<div class="preview-markdown"><p>needle here</p></div><div class="preview-match-frames" aria-hidden="true"><div class="preview-match-frame preview-match-frame--current"></div></div>';
    document.body.append(host);
    mounted.push(host);
    const { root } = printableClone(host, 'width');
    expect(root.querySelector('.preview-match-frames, .preview-match-frame')).toBeNull();
    expect(root.textContent).toContain('needle here');
  });

  it('prints a diagram still drawing as its source, not as a blank gap (FR-043a)', () => {
    const live = body(
      '<p>before</p><div class="preview-diagram-host" data-diagram-source="graph TD; A--&gt;B" data-diagram-lang="mermaid"><div class="preview-loading">Drawing…</div></div><p>after</p>',
    );
    const { root } = printableClone(live, 'width');
    const host = root.querySelector('.preview-diagram-host');
    expect(host?.querySelector('pre')?.textContent).toBe('graph TD; A-->B');
    expect(root.textContent).not.toContain('Drawing…');
  });

  it('leaves out the scroll-sync mark: a gutter bar on screen, never on paper (073 FR-033d)', () => {
    const live = body(`<p class="${SYNC_MARK_CLASS} ${SYNC_MARK_ON_CLASS}" data-source-line="3">synced</p>`);
    live.classList.add('preview-markdown--gutter');
    const { root } = printableClone(live, 'width');
    expect(root.querySelector(`.${SYNC_MARK_CLASS}`)).toBeNull();
    expect(root.querySelector(`.${SYNC_MARK_ON_CLASS}`)).toBeNull();
    expect(root.querySelector('p')?.textContent).toBe('synced');
    expect(live.querySelector('p')?.classList.contains(SYNC_MARK_ON_CLASS)).toBe(true);
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
    // The preview's own inline sizing is dropped; only the diagram's own width is carried, for a chosen scale.
    expect(svg.style.maxWidth).toBe('');
    expect(svg.getAttribute('style')).toBe('--throng-print-natural-width: 900px;');
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

  // Live and printed images are paired before anything is removed from the clone: an image inside a notice the
  // printout drops must not shift the pairs after it.
  it('pairs each printed image with its own on screen when an earlier one is left out', () => {
    const live = body(
      '<div role="status"><img src="https://e.com/in-notice.png" alt="N"></div><img src="https://e.com/loaded.png" alt="L"><img src="https://e.com/blocked.png" alt="B">',
    );
    const loaded = live.querySelectorAll('img')[1]!;
    Object.defineProperty(loaded, 'complete', { value: true });
    Object.defineProperty(loaded, 'naturalWidth', { value: 10 });
    const { root, remoteImages } = printableClone(live, 'width');
    expect(remoteImages).toEqual(['https://e.com/loaded.png']);
    expect([...root.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(['https://e.com/loaded.png']);
    expect(root.textContent).toContain('B');
  });
});

describe('an Image or SVG preview prints its picture fitted to the page, never past its own size (075 FR-075a)', () => {
  const picture = (attrs: string) =>
    body(
      `<div class="preview-diagram-host"><div class="preview-diagram-frame__layer" style="transform: scale(4)"><svg data-throng-picture="" ${attrs}><image href="throng-preview://source/p1" width="320" height="200"></image></svg></div></div>`,
    );

  // The Fit choice (maintainer, 2026-11-22) sizes it: printPageFitCss reads its cap, its own width and its shape, and
  // its box is drawn without letterboxing, so only Stretch to fill changes the shape.
  it('carries its own width as the Fit to page cap, and its shape, drawn to its box', () => {
    const { root } = printableClone(picture('viewBox="0 0 320 200" width="1280" height="800"'), 'page', true);
    const svg = root.querySelector<SVGSVGElement>('.throng-print__diagram--page svg')!;
    expect(svg.style.maxWidth).toBe('');
    expect(svg.style.getPropertyValue('--throng-print-cap')).toBe('320px');
    expect(svg.style.getPropertyValue('--throng-print-ratio')).toBe('1.600000');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
  });

  it('in a document keeps its letterboxing and its inline bound: Fit is a page-shaped printable\'s alone', () => {
    const { root } = printableClone(picture('viewBox="0 0 320 200" width="1280" height="800"'), 'width');
    const svg = root.querySelector<SVGSVGElement>('svg')!;
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(svg.style.getPropertyValue('--throng-print-ratio')).toBe('');
  });

  it('takes the width attribute when there is no viewBox', () => {
    const { root } = printableClone(picture('width="96" height="48"'), 'page', true);
    expect(root.querySelector<SVGSVGElement>('svg')!.style.maxWidth).toBe('96px');
  });

  it('a Mermaid diagram is not capped: it fills the page as before (FR-075)', () => {
    // A drawn diagram's SVG carries no `data-throng-picture`; only a picture does.
    const diagram = body(
      '<div class="preview-diagram-host"><div class="preview-diagram-frame__layer"><svg viewBox="0 0 320 200"><g></g></svg></div></div>',
    );
    const { root } = printableClone(diagram, 'page');
    expect(root.querySelector<SVGSVGElement>('svg')!.style.maxWidth).toBe('');
    expect(root.querySelector<SVGSVGElement>('svg')!.style.getPropertyValue('--throng-print-cap')).toBe('');
  });

  it('carries a diagram\'s own width, which a chosen scale lays it out at (maintainer, 2026-11-22)', () => {
    const diagram = body(
      '<div class="preview-diagram-host"><div class="preview-diagram-frame__layer"><svg viewBox="0 0 320 200"><g></g></svg></div></div>',
    );
    const { root } = printableClone(diagram, 'page');
    expect(root.querySelector<SVGSVGElement>('svg')!.style.getPropertyValue('--throng-print-natural-width')).toBe('320px');
  });

  it('a picture in a Markdown document is never printed larger than its own size (FR-076; MT-60 1r)', () => {
    // Walk-through 2026-11-21: a 64 × 64 image in a Markdown file printed as wide as the text column, a page tall.
    const { root } = printableClone(picture('viewBox="0 0 64 64" width="64" height="64"'), 'width');
    expect(root.querySelector<SVGSVGElement>('.throng-print__diagram--width svg')!.style.maxWidth).toBe('64px');
  });
});

describe('a picture drawn from a blob: an SVG block, or a reduced-motion first frame (074 x 075 FR-066)', () => {
  /** A diagram host holding a picture wrapper whose `<image>` is a `blob:` URL, its bytes registered as 074 does. */
  function pictureBody(): HTMLElement {
    const live = body(
      '<div class="preview-diagram-host"><div class="preview-diagram-frame__layer"><svg data-throng-picture="" viewBox="0 0 10 10" width="10" height="10"><image href="blob:file:///aa-bb" width="10" height="10"></image></svg></div></div>',
    );
    const wrapper = live.querySelector<SVGSVGElement>('svg[data-throng-picture]')!;
    registerRasterSource(wrapper, () => Promise.resolve(new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' })));
    return live;
  }

  it('prints the picture from its own bytes, inlined: a blob: URL loads in neither the print host nor its policy', async () => {
    const output = await buildPrintable(pictureBody(), { title: 'a.md', fit: 'width', stylesheets: '', baseHref: 'file:///app/' });
    if (output.kind !== 'document') throw new Error('not a document');
    expect(output.html).not.toContain('blob:');
    expect(output.html).toMatch(/<image href="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+"/);
  });

  it('prints nothing it cannot read: a picture with no registered bytes leaves no blob: behind', async () => {
    const live = body(
      '<div class="preview-diagram-host"><div class="preview-diagram-frame__layer"><svg data-throng-picture="" aria-label="A chart" viewBox="0 0 10 10"><image href="blob:file:///cc-dd"></image></svg></div></div>',
    );
    const output = await buildPrintable(live, { title: 'a.md', fit: 'width', stylesheets: '', baseHref: 'file:///app/' });
    if (output.kind !== 'document') throw new Error('not a document');
    expect(output.html).not.toContain('blob:');
    expect(output.html).toContain('A chart');
  });
});

describe('the printable document', () => {
  it('runs nothing, requests only the loaded images, and carries the print palette and stylesheet (FR-072, FR-079)', async () => {
    const output = await buildPrintable(body('<h1>T</h1><pre><code>x</code></pre>'), { title: 'a.md', fit: 'width', stylesheets: '.x{}', baseHref: 'file:///app/' });
    if (output.kind !== 'document') throw new Error('expected a document');
    // The policy as the page reads it: the attribute is escaped in the HTML.
    const csp = new DOMParser().parseFromString(output.html, 'text/html').querySelector('meta[http-equiv="Content-Security-Policy"]');
    expect(csp?.getAttribute('content')).toContain("default-src 'none'");
    expect(output.html).not.toMatch(/<script/i);
    expect(output.html).toContain(`--throng-colour-text:${PRINT_PALETTE.text};`);
    expect(output.html).toContain('break-after: avoid');
    expect(output.html).toContain('break-inside: avoid');
    expect(output.html).toContain('<title>a.md</title>');
    expect(output.fit).toBe('width');
  });

  it('lets a long document run onto as many pages as it needs (FR-073)', async () => {
    // theme.css holds the app's window to the viewport (`html, body, #root { height: 100%; overflow: hidden }`).
    // Copied into the printable, that clipped every print to its first page. The print stylesheet, applied last,
    // must release both. Asserted on the parsed rule: jsdom's cascade is not Chromium's, which the E2E lays out.
    const appRule = 'html,body,#root{height:100%;margin:0;overflow:hidden}';
    const output = await buildPrintable(body('<p>long</p>'), { title: 'a.md', fit: 'width', stylesheets: appRule, baseHref: 'file:///app/' });
    if (output.kind !== 'document') throw new Error('expected a document');
    const doc = new DOMParser().parseFromString(output.html, 'text/html');
    const sheets = [...doc.querySelectorAll('style')].map((s) => s.textContent ?? '');
    expect(sheets.at(-1)).toBe(PRINT_STYLESHEET);
    const frame = document.createElement('iframe');
    document.body.append(frame);
    mounted.push(frame);
    const style = frame.contentDocument!.createElement('style');
    style.textContent = PRINT_STYLESHEET;
    frame.contentDocument!.head.append(style);
    const root = [...style.sheet!.cssRules].find((r): r is CSSStyleRule => r instanceof frame.contentWindow!.CSSStyleRule && r.selectorText.replace(/\s+/g, '') === 'html,body');
    expect(root?.style.height).toBe('auto');
    expect(root?.style.overflow).toBe('visible');
  });

  it('is a white sheet of paper in every theme, margins included (FR-072, 2026-11-20)', () => {
    // A dark theme declares `color-scheme: dark`, which Chromium paints the page's margins with (#121212): the
    // preview showed a dark frame round a white column, and the printer would have inked it.
    const frame = document.createElement('iframe');
    document.body.append(frame);
    mounted.push(frame);
    const style = frame.contentDocument!.createElement('style');
    style.textContent = PRINT_STYLESHEET;
    frame.contentDocument!.head.append(style);
    // On `:root`, not `html`: theme.css declares `color-scheme: dark` on `:root`, which outranks an `html` selector
    // however late it comes.
    const root = [...style.sheet!.cssRules].find((r): r is CSSStyleRule => r instanceof frame.contentWindow!.CSSStyleRule && r.selectorText.trim() === ':root');
    expect(root?.style.getPropertyValue('color-scheme')).toBe('light');
  });

  it('holds an embedded picture or diagram to one page, so neither splits across two (FR-073; edge case: a diagram taller than a page)', () => {
    // Walk-through 2026-11-21: at 50 % on Letter landscape the text column is twice as wide in CSS pixels, and a
    // three-box flowchart sized to its width ran over a page break, through box B; a picture split the same way.
    // `vh` in a printed document is the page's printable height, as the standalone rule below already relies on.
    const frame = document.createElement('iframe');
    document.body.append(frame);
    mounted.push(frame);
    const style = frame.contentDocument!.createElement('style');
    style.textContent = PRINT_STYLESHEET;
    frame.contentDocument!.head.append(style);
    const rule = (selector: string): CSSStyleRule | undefined =>
      [...style.sheet!.cssRules].find((r): r is CSSStyleRule => r instanceof frame.contentWindow!.CSSStyleRule && r.selectorText.replace(/\s+/g, ' ').trim() === selector);
    expect(rule('.throng-print__diagram svg')?.style.maxHeight).toBe('95vh');
    expect(rule('.throng-print img')?.style.maxHeight).toBe('95vh');
  });

  it('releases the preview body\'s own containment, or the print sizes it to nothing (FR-073)', () => {
    // The copied body is the panel's scroller, which is `contain: strict` on screen (075 SC-006): its size the
    // panel's, never its content's. In a printable that is one empty page.
    const frame = document.createElement('iframe');
    document.body.append(frame);
    mounted.push(frame);
    const style = frame.contentDocument!.createElement('style');
    style.textContent = PRINT_STYLESHEET;
    frame.contentDocument!.head.append(style);
    const own = [...style.sheet!.cssRules].find((r): r is CSSStyleRule => r instanceof frame.contentWindow!.CSSStyleRule && r.selectorText.replace(/\s+/g, '') === '.throng-print>*');
    expect(own?.style.getPropertyValue('contain')).toBe('none');
    expect(own?.style.getPropertyValue('will-change')).toBe('auto');
  });
});

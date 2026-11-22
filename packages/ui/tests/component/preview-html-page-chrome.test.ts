import { afterEach, describe, expect, it } from 'vitest';
import { captureSelection, selectAllIn } from '../../src/renderer/preview/copy.js';
import { buildPreviewTextModel, defaultPreviewSearchExclusion, type TextModelNode } from '../../src/renderer/preview/preview-search-model.js';

/**
 * 074 R6d x 075 FR-043a, FR-049 — copy and find leave out what THRONG drew: a loading placeholder, a typeset equation,
 * a callout's controls. An HTML Preview's page is the author's document, in its own frame: an element there that
 * happens to carry one of those class names or attributes is the author's text, and is copied and found like any other.
 *
 * Layer: component — real DOM in a real (same-origin) frame document, as the HTML Preview has (jsdom).
 */
let frame: HTMLIFrameElement | null = null;
afterEach(() => {
  frame?.remove();
  frame = null;
});

/** An HTML Preview's page: `html` as the body of a same-origin frame's document. */
function page(html: string): HTMLElement {
  frame = document.createElement('iframe');
  document.body.append(frame);
  const doc = frame.contentDocument!;
  doc.body.innerHTML = html;
  return doc.body;
}

const PAGE = '<p><span class="preview-loading">Loading</span> the <span data-math-typeset="">x²</span> report<span class="preview-callout__fold">!</span></p>';

describe('the author\'s page in an HTML Preview', () => {
  it('copies every word of it, whatever its classes are called', () => {
    const body = page(PAGE);
    selectAllIn(body);
    expect(captureSelection(body)?.text).toBe('Loading the x² report!');
  });

  it('finds every word of it, whatever its attributes are called', () => {
    const body = page(PAGE);
    const model = buildPreviewTextModel(body as unknown as TextModelNode);
    expect(model.text).toContain('Loading the x² report!');
    const typeset = body.querySelector('[data-math-typeset]')!;
    expect(defaultPreviewSearchExclusion(typeset as unknown as TextModelNode)).toBe(false);
  });

  it('still leaves out throng\'s own placeholder and controls, and copies its equations as written', () => {
    const host = document.createElement('div');
    host.innerHTML = PAGE;
    document.body.append(host);
    try {
      expect(defaultPreviewSearchExclusion(host.querySelector('[data-math-typeset]') as unknown as TextModelNode)).toBe(true);
      selectAllIn(host);
      expect(captureSelection(host)?.text).toBe(' the $x²$ report');
    } finally {
      host.remove();
    }
  });
});

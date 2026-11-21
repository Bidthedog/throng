import { afterEach, describe, expect, it } from 'vitest';
import { createMarkdownRenderer } from '../../src/renderer/preview/providers/markdown/markdown-renderer.js';
import { typesetMath } from '../../src/renderer/preview/providers/markdown/math-typeset.js';
import { showMathPending } from '../../src/renderer/preview/providers/markdown/math-dom.js';
import {
  IMAGE_PENDING_ATTRIBUTE,
  PREVIEW_LOADING_CLASS,
  loadingPlaceholder,
  showImagesPending,
} from '../../src/renderer/preview/loading-placeholder.js';
import { MATH_PENDING_ATTRIBUTE, MATH_SOURCE_ATTRIBUTE, MATH_TYPESET_ATTRIBUTE, mathLiteralOf } from '../../src/renderer/preview/math-host.js';
import { buildPrintable } from '../../src/renderer/preview/print/printable.js';

/**
 * 075 FR-043a — whatever in a preview is still loading (an equation, an image) holds its place with the same
 * themed placeholder a diagram shows while it draws: the app's turning busy glyph, named for assistive technology.
 *
 * Layer: component — the subject is DOM the body draws into (jsdom).
 */
const BUSY = '<svg data-test="busy"></svg>';
const ENV = { panelId: 'p', docPath: '/proj/a.md', projectRoot: '/proj', remoteImages: false, typesetMath: true };

let mounted: HTMLElement[] = [];
afterEach(() => {
  for (const el of mounted) el.remove();
  mounted = [];
});

function mount(text: string): HTMLElement {
  const root = document.createElement('div');
  root.append(createMarkdownRenderer().render(text, ENV).fragment);
  document.body.append(root);
  mounted.push(root);
  return root;
}

describe('the shared placeholder', () => {
  it('is the app spinner — the busy glyph in its turning box — named for assistive technology', () => {
    const el = loadingPlaceholder(document, { label: 'Typesetting equation', busyIcon: BUSY, block: false });
    expect(el.classList.contains(PREVIEW_LOADING_CLASS)).toBe(true);
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-label')).toBe('Typesetting equation');
    expect(el.querySelector('.throng-spinner .busy-glyph .icon svg[data-test="busy"]')).not.toBeNull();
    expect(el.textContent).toBe('');
    // An icon set's markup is indented; none of that becomes text a selection around the placeholder picks up.
    const indented = loadingPlaceholder(document, { label: 'x', busyIcon: '<svg>\n  <path d="M0 0"/>\n</svg>\n', block: false });
    expect(indented.textContent).toBe('');
  });

  it('says what it is waiting for in words when it stands as a block', () => {
    const el = loadingPlaceholder(document, { label: 'Typesetting equation', busyIcon: BUSY, block: true });
    expect(el.classList.contains(`${PREVIEW_LOADING_CLASS}--block`)).toBe(true);
    expect(el.textContent).toBe('Typesetting equation…');
  });
});

describe('an equation still loading (FR-043a)', () => {
  it('shows the placeholder in its place, inline or as a block, keeping its source', () => {
    const root = mount('Inline $x^2$ here.\n\n$$\n\\frac{a}{b}\n$$\n');
    showMathPending(root, BUSY);
    const [inline, display] = [...root.querySelectorAll<HTMLElement>('[data-math]')];
    expect(inline!.hasAttribute(MATH_PENDING_ATTRIBUTE)).toBe(true);
    expect(inline!.getAttribute(MATH_SOURCE_ATTRIBUTE)).toBe('x^2');
    expect(inline!.querySelector(`.${PREVIEW_LOADING_CLASS}`)).not.toBeNull();
    expect(display!.querySelector(`.${PREVIEW_LOADING_CLASS}--block`)).not.toBeNull();
    // Copy and print still have the expression as written.
    expect(mathLiteralOf(inline!)).toBe('$x^2$');
  });

  it('gives way to the typeset equation', async () => {
    const root = mount('Inline $x^2$ here.\n');
    showMathPending(root, BUSY);
    await typesetMath(root, () => Promise.resolve());
    const el = root.querySelector<HTMLElement>('[data-math]')!;
    expect(el.hasAttribute(MATH_PENDING_ATTRIBUTE)).toBe(false);
    expect(el.hasAttribute(MATH_TYPESET_ATTRIBUTE)).toBe(true);
    expect(el.querySelector(`.${PREVIEW_LOADING_CLASS}`)).toBeNull();
    expect(el.getAttribute(MATH_SOURCE_ATTRIBUTE)).toBe('x^2');
  });

  it('gives way to the source, marked as an error, when the typesetter refuses it', async () => {
    const root = mount('$\\frac{a$\n');
    showMathPending(root, BUSY);
    await typesetMath(root, () => Promise.resolve());
    const el = root.querySelector<HTMLElement>('[data-math]')!;
    expect(el.hasAttribute(MATH_PENDING_ATTRIBUTE)).toBe(false);
    expect(el.textContent).toBe('$\\frac{a$');
  });

  it('prints as written, not as a spinner', async () => {
    const root = mount('Inline $x^2$ here.\n');
    showMathPending(root, BUSY);
    const output = await buildPrintable(root, { title: 'a.md', fit: 'width', stylesheets: '', baseHref: 'file:///app/' });
    if (output.kind !== 'document') throw new Error('expected a document');
    expect(output.html).toContain('$x^2$');
    expect(output.html).not.toContain(PREVIEW_LOADING_CLASS);
  });
});

describe('an image still loading (FR-043a)', () => {
  const pending = (root: HTMLElement): HTMLImageElement => {
    const img = root.querySelector('img')!;
    Object.defineProperty(img, 'complete', { configurable: true, value: false });
    return img;
  };

  it('holds its place with the placeholder until it loads', () => {
    const root = mount('![a cat](cat.png)\n');
    const img = pending(root);
    showImagesPending(root, BUSY);
    expect(img.hasAttribute(IMAGE_PENDING_ATTRIBUTE)).toBe(true);
    expect(img.previousElementSibling?.classList.contains(PREVIEW_LOADING_CLASS)).toBe(true);
    expect(img.previousElementSibling?.getAttribute('aria-label')).toBe('Loading image');
    img.dispatchEvent(new Event('load'));
    expect(img.hasAttribute(IMAGE_PENDING_ATTRIBUTE)).toBe(false);
    expect(root.querySelector(`.${PREVIEW_LOADING_CLASS}`)).toBeNull();
  });

  it('lets go of its place when it fails, for its alternative text', () => {
    const root = mount('![a cat](cat.png)\n');
    const img = pending(root);
    showImagesPending(root, BUSY);
    img.dispatchEvent(new Event('error'));
    expect(root.querySelector(`.${PREVIEW_LOADING_CLASS}`)).toBeNull();
    expect(img.hasAttribute(IMAGE_PENDING_ATTRIBUTE)).toBe(false);
  });

  it('shows no placeholder for an image already loaded', () => {
    const root = mount('![a cat](cat.png)\n');
    const img = root.querySelector('img')!;
    Object.defineProperty(img, 'complete', { configurable: true, value: true });
    showImagesPending(root, BUSY);
    expect(root.querySelector(`.${PREVIEW_LOADING_CLASS}`)).toBeNull();
  });
});

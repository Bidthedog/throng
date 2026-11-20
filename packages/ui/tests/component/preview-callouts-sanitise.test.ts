import { describe, expect, it, vi } from 'vitest';
import { createMarkdownPipeline } from '../../src/renderer/preview/providers/markdown/pipeline.js';
import { createMarkdownRenderer } from '../../src/renderer/preview/providers/markdown/markdown-renderer.js';
import { createSanitiser } from '../../src/renderer/preview/providers/markdown/sanitise.js';

/**
 * 075 FR-014, SC-007 — callouts through the REAL pipeline and the REAL sanitiser.
 *
 * Layer: component — DOMPurify needs a DOM (jsdom); what it keeps of the callout markup is the subject.
 */
const render = (text: string): DocumentFragment => createMarkdownRenderer().render(text).fragment;

describe('the sanitiser admits throng\'s callout markup (FR-014)', () => {
  it('keeps a pipeline callout\'s structure, canonical type and fold sign, and drops its nonce', () => {
    const fragment = render('> [!caution]- Look out\n> body\n');
    const callout = fragment.querySelector('[data-callout]') as HTMLElement;
    expect(callout.tagName).toBe('DIV');
    expect(callout.getAttribute('data-callout')).toBe('warning');
    expect(callout.getAttribute('data-callout-fold')).toBe('closed');
    expect(callout.hasAttribute('data-heading-nonce')).toBe(false);
    expect(callout.querySelector('[data-callout-title] [data-callout-icon]')).not.toBeNull();
    expect(callout.querySelector('[data-callout-title-text]')?.textContent).toBe('Look out');
    expect(callout.querySelector('[data-callout-body] p')?.textContent).toBe('body');
  });

  it('runs every callout through the sanitiser exactly once (the sanitiser is in the path)', () => {
    const sanitiser = createSanitiser();
    const spy = vi.fn(sanitiser);
    createMarkdownPipeline(spy).render('> [!note] T\n> x\n');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('data-callout="note"');
  });

  it('leaves nothing script-bearing from a hostile type or title', () => {
    const fragment = render('> [!<img src=x onerror=alert(1)>] <script>alert(2)</script><img src=y onerror=alert(3)>\n> x\n');
    expect(fragment.querySelector('script')).toBeNull();
    for (const el of fragment.querySelectorAll('*')) {
      for (const a of el.attributes) expect(a.name.startsWith('on'), `${el.tagName} ${a.name}`).toBe(false);
    }
    expect(fragment.querySelector('[data-callout]')?.getAttribute('data-callout')).toBe('note');
  });

  it('strips callout attributes from raw HTML that did not come from the pipeline', () => {
    const fragment = render('<div data-callout="warning" data-callout-fold="closed"><div data-callout-title>x</div></div>\n');
    expect(fragment.querySelector('[data-callout]')).toBeNull();
    expect(fragment.querySelector('[data-callout-fold]')).toBeNull();
    expect(fragment.querySelector('[data-callout-title]')).toBeNull();
  });

  it('strips a data-callout value that is not a registry id, even with a forged nonce', () => {
    const { fragment } = createMarkdownPipeline((html, context) =>
      createSanitiser()(html.replace('data-callout="note"', 'data-callout="javascript"'), context),
    ).render('> [!note]\n> x\n');
    expect(fragment.querySelector('[data-callout]')).toBeNull();
    expect(fragment.querySelector('[data-callout-body]')).toBeNull();
  });

  it('keeps the role only where it is the type\'s registry role', () => {
    expect(render('> [!bug]\n> x\n').querySelector('[data-callout]')?.getAttribute('data-callout-role')).toBe('danger');
    const { fragment } = createMarkdownPipeline((html, context) =>
      createSanitiser()(html.replace('data-callout-role="danger"', 'data-callout-role="success"'), context),
    ).render('> [!bug]\n> x\n');
    expect(fragment.querySelector('[data-callout]')).toBeNull();
    expect(fragment.querySelector('[data-callout-role]')).toBeNull();
  });

  it('keeps fold only as open or closed', () => {
    const { fragment } = createMarkdownPipeline((html, context) =>
      createSanitiser()(html.replace('data-callout-fold="open"', 'data-callout-fold="evil"'), context),
    ).render('> [!note]+\n> x\n');
    expect(fragment.querySelector('[data-callout]')?.hasAttribute('data-callout-fold')).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMarkdownRenderer } from '../../src/renderer/preview/providers/markdown/markdown-renderer.js';
import {
  MATH_ERROR_ATTRIBUTE,
  MATH_SOURCE_ATTRIBUTE,
  MATH_TYPESET_ATTRIBUTE,
  createMathSanitiser,
  typesetMath,
} from '../../src/renderer/preview/providers/markdown/math-typeset.js';
import { hasMath } from '../../src/renderer/preview/providers/markdown/math-dom.js';

/**
 * 075 FR-043 – FR-048, SC-006, SC-007 — typesetting the sanitised placeholders with KaTeX, through its own
 * sanitiser profile.
 *
 * Layer: component — KaTeX's output and DOMPurify's treatment of it need a DOM (jsdom).
 */
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

const noYield = (): Promise<void> => Promise.resolve();

describe('typesetting (FR-040, FR-043)', () => {
  it('typesets inline and display maths in place, keeping each source', async () => {
    const root = mount('Inline $x^2$ here.\n\n$$\n\\frac{a}{b}\n$$\n');
    await typesetMath(root, noYield);
    const [inline, display] = [...root.querySelectorAll<HTMLElement>('[data-math]')];
    expect(inline.hasAttribute(MATH_TYPESET_ATTRIBUTE)).toBe(true);
    expect(inline.getAttribute(MATH_SOURCE_ATTRIBUTE)).toBe('x^2');
    expect(inline.querySelector('.katex')).not.toBeNull();
    expect(display.querySelector('.katex-display')).not.toBeNull();
    expect(display.getAttribute('data-source-line')).toBe('2');
  });

  it('does nothing twice: an already typeset expression is left as it is', async () => {
    const root = mount('$x$\n');
    await typesetMath(root, noYield);
    const first = root.querySelector('.katex');
    await typesetMath(root, noYield);
    expect(root.querySelector('.katex')).toBe(first);
  });

  it('yields between batches, so a long document never holds the window (SC-006)', async () => {
    const root = mount(Array.from({ length: 120 }, (_, i) => `$x_{${i}}$`).join(' ') + '\n');
    const yieldFrame = vi.fn(() => Promise.resolve());
    await typesetMath(root, yieldFrame, 50);
    expect(yieldFrame).toHaveBeenCalledTimes(2);
    expect(root.querySelectorAll(`[${MATH_TYPESET_ATTRIBUTE}]`)).toHaveLength(120);
  });

  it('stops when the draw is superseded', async () => {
    const root = mount('$a$ $b$ $c$\n');
    const signal = { cancelled: true };
    await typesetMath(root, noYield, 50, signal);
    expect(root.querySelector(`[${MATH_TYPESET_ATTRIBUTE}]`)).toBeNull();
  });
});

describe('a long document stays responsive (SC-006)', () => {
  it('leaves the page alone until every expression is ready, then draws them all at once', async () => {
    // One layout for the lot, not one per batch: each batch drawn in place re-laid the whole document out.
    const root = mount(Array.from({ length: 120 }, (_, i) => `$x_{${i}}$`).join(' ') + '\n');
    const drawnAtEachYield: number[] = [];
    const yieldFrame = vi.fn(async () => {
      drawnAtEachYield.push(root.querySelectorAll(`[${MATH_TYPESET_ATTRIBUTE}]`).length);
    });
    await typesetMath(root, yieldFrame, 50);
    expect(drawnAtEachYield).toEqual([0, 0]);
    expect(root.querySelectorAll(`[${MATH_TYPESET_ATTRIBUTE}]`)).toHaveLength(120);
  });

  it('draws nothing when superseded while still preparing', async () => {
    const root = mount(Array.from({ length: 60 }, (_, i) => `$y_{${i}}$`).join(' ') + '\n');
    const signal = { cancelled: false };
    await typesetMath(root, async () => { signal.cancelled = true; }, 50, signal);
    expect(root.querySelector(`[${MATH_TYPESET_ATTRIBUTE}]`)).toBeNull();
  });

  it('names each equation by its source, since its MathML is kept out of layout', async () => {
    // KaTeX's drawing is aria-hidden, and its MathML is `display: none` (markdown.css) so 500 equations are not
    // laid out twice; the source is what a screen reader reads.
    const root = mount('$\\frac{1}{2}$\n');
    await typesetMath(root, noYield);
    const el = root.querySelector<HTMLElement>('[data-math]')!;
    expect(el.getAttribute('role')).toBe('math');
    expect(el.getAttribute('aria-label')).toBe('\\frac{1}{2}');
    expect(el.querySelector('.katex-mathml math')).not.toBeNull();
  });

  it('typesets each distinct expression once, however often it appears or is drawn again', async () => {
    const real = createMathSanitiser();
    const sanitise = vi.fn(real);
    await typesetMath(mount('$p$ $p$ $q$\n\n$$\np\n$$\n'), noYield, 50, { cancelled: false }, sanitise);
    // `p` inline, `q` inline and `p` displayed: a displayed expression is drawn differently, so it is its own.
    expect(sanitise).toHaveBeenCalledTimes(3);
    // The next draw — a keystroke in the editor — reuses every one of them.
    const again = mount('$p$ $q$ $p$\n');
    await typesetMath(again, noYield, 50, { cancelled: false }, sanitise);
    expect(sanitise).toHaveBeenCalledTimes(3);
    expect(again.querySelectorAll(`[${MATH_TYPESET_ATTRIBUTE}] .katex`)).toHaveLength(3);
    // Each is a copy of its own: no two placeholders share nodes.
    const [a, , c] = [...again.querySelectorAll<HTMLElement>('[data-math]')];
    expect(a!.firstChild).not.toBe(c!.firstChild);
  });
});

describe('errors (FR-044, FR-048)', () => {
  it('shows a malformed expression\'s source in place, marked, with the error in its hover', async () => {
    const root = mount('Before $\\frac{a$ after.\n');
    await typesetMath(root, noYield);
    const el = root.querySelector('[data-math]') as HTMLElement;
    expect(el.hasAttribute(MATH_ERROR_ATTRIBUTE)).toBe(true);
    expect(el.textContent).toBe('$\\frac{a$');
    expect(el.getAttribute('title')).toMatch(/^Maths error: /);
    expect(root.textContent).toContain('after.');
  });

  it('stops a macro that expands without end, as an error', async () => {
    const root = mount('$\\def\\x{\\x\\x}\\x$\n');
    await typesetMath(root, noYield);
    expect(root.querySelector('[data-math]')?.hasAttribute(MATH_ERROR_ATTRIBUTE)).toBe(true);
  });

  it('caps an oversized rule rather than drawing it thousands of ems wide', async () => {
    const root = mount('$\\rule{10000em}{1em}$\n');
    await typesetMath(root, noYield);
    const style = root.querySelector<HTMLElement>('.katex .rule')?.getAttribute('style') ?? '';
    expect(style).not.toContain('10000em');
  });
});

describe('nothing runs, nothing loads (FR-047, SC-007)', () => {
  it.each(['\\href{javascript:alert(1)}{x}', '\\url{https://example.com}', '\\includegraphics{https://example.com/a.png}', '\\htmlClass{evil}{x}', '\\htmlId{evil}{x}', '\\htmlStyle{background:url(https://e.com)}{x}', '\\htmlData{a=b}{x}'])(
    '%s renders as an error or as text, with no link or resource',
    async (expression) => {
      const root = mount(`$${expression}$\n`);
      await typesetMath(root, noYield);
      expect(root.querySelector('a, img, [href], [src]')).toBeNull();
      for (const el of root.querySelectorAll('[style]')) expect(el.getAttribute('style')).not.toContain('url(');
      expect(root.querySelector('.evil, #evil')).toBeNull();
    },
  );

  it('admits only what KaTeX emits, through its own sanitiser (the sanitiser is in the path)', () => {
    const sanitise = createMathSanitiser();
    const fragment = sanitise('<span class="katex"><a href="https://e.com">x</a><img src="https://e.com/a.png"><script>alert(1)</script><span style="background:url(https://e.com)">y</span></span>');
    const holder = document.createElement('div');
    holder.append(fragment);
    expect(holder.querySelector('a, img, script')).toBeNull();
    expect(holder.innerHTML).not.toContain('url(');
    expect(holder.textContent).toContain('x');
  });

  it('knows when a document has no maths, so the typesetter is never loaded for it (FR-046)', () => {
    expect(hasMath(mount('No maths, $5 and $10.\n'))).toBe(false);
    expect(hasMath(mount('Some $x$.\n'))).toBe(true);
  });
});

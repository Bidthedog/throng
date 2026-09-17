/**
 * 044 T089 — fenced code is highlighted AFTER it is inserted, with the editor's own highlight style,
 * built as DOM (FR-080, FR-083, FR-086; contracts/security-policy.md Layer 1, research R5).
 *
 * The rule under test is the one Layer 1 ends on: "no step after the sanitiser produces HTML from a
 * string". A highlighter that returned markup would need `innerHTML`, which is a second parse of text
 * the document controls — so `innerHTML` is spied on and must never be written.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StyleModule } from 'style-mod';
import { highlightCode } from '@lezer/highlight';
import { throngHighlightStyle, LONG_LINE_THRESHOLD } from '../../src/renderer/editor/highlight-style.js';
import { loadLanguage } from '../../src/renderer/editor/language-loaders.js';
import {
  HIGHLIGHT_BUDGET_CHARS,
  highlightCodeBlocks,
} from '../../src/renderer/preview/providers/markdown/highlight.js';
import { renderFence } from '../../src/renderer/preview/providers/markdown/pipeline.js';

// Pass-through spies: the real highlighter and loaders run, and the calls are counted.
vi.mock('@lezer/highlight', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lezer/highlight')>();
  return { ...actual, highlightCode: vi.fn(actual.highlightCode) };
});
vi.mock('../../src/renderer/editor/language-loaders.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/editor/language-loaders.js')>();
  return { ...actual, loadLanguage: vi.fn(actual.loadLanguage) };
});

const COLD = 10_000;

/** A body holding `<pre><code data-lang>` exactly as the sanitised fragment inserts it. */
function body(info: string, code: string): HTMLElement {
  const host = document.createElement('div');
  const pre = document.createElement('pre');
  // Parsed by the test to build the fixture, not by the code under test.
  pre.innerHTML = renderFence(info, code);
  host.append(pre);
  document.body.append(host);
  return host;
}

/** Every class the highlight style can put on a span. StyleModule's generated names are not ASCII (`ͼo`). */
function styleClasses(): Set<string> {
  const rules = (throngHighlightStyle.module as StyleModule).getRules();
  return new Set([...rules.matchAll(/\.([^\s.,:>{}()[\]]+)/g)].map((m) => m[1]));
}

let innerHtmlWrites: ReturnType<typeof vi.fn>;
const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!;

beforeEach(() => {
  innerHtmlWrites = vi.fn();
  Object.defineProperty(Element.prototype, 'innerHTML', {
    configurable: true,
    get: descriptor.get,
    set(this: Element, value: string) {
      innerHtmlWrites(this, value);
      descriptor.set!.call(this, value);
    },
  });
  // The fixtures above write innerHTML; only writes made by the code under test count.
  innerHtmlWrites.mockClear();
});

afterEach(() => {
  // Restore the jsdom accessor.
  Object.defineProperty(Element.prototype, 'innerHTML', descriptor);
  document.body.replaceChildren();
});

describe('a known language is highlighted after insertion (FR-080)', () => {
  it('wraps tokens of a ts fence in spans carrying throngHighlightStyle classes, text unchanged', async () => {
    const code = 'const answer: number = 42; // done\n';
    const host = body('ts', code);
    innerHtmlWrites.mockClear();

    await highlightCodeBlocks(host);

    const el = host.querySelector('code')!;
    expect(el.textContent).toBe(code);
    const spans = [...el.querySelectorAll('span')];
    expect(spans.length).toBeGreaterThan(0);
    const known = styleClasses();
    for (const span of spans) {
      for (const cls of span.classList) expect(known.has(cls), `class ${cls}`).toBe(true);
    }
    // The keyword and the comment are distinguished, not one flat colour.
    expect(new Set(spans.map((s) => s.className)).size).toBeGreaterThan(1);
    expect(innerHtmlWrites).not.toHaveBeenCalled();
    expect(el.getAttribute('data-highlighted')).toBe('true');
  }, COLD);

  it('resolves an info string through the editor language registry (`typescript`, `py`)', async () => {
    const host = body('py', 'def f():\n    return 1\n');
    await highlightCodeBlocks(host);
    expect(host.querySelectorAll('code span').length).toBeGreaterThan(0);
  }, COLD);

  it('a text the document wrote as markup inside the fence stays TEXT', async () => {
    const host = body('ts', 'const s = "<img src=x onerror=alert(1)>";\n');
    await highlightCodeBlocks(host);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('code')!.textContent).toContain('<img src=x onerror=alert(1)>');
  }, COLD);

  it('highlighting twice changes nothing the second time', async () => {
    const host = body('ts', 'let x = 1;\n');
    await highlightCodeBlocks(host);
    const first = host.querySelector('code')!.innerHTML;
    await highlightCodeBlocks(host);
    expect(host.querySelector('code')!.innerHTML).toBe(first);
  }, COLD);
});

describe('what stays plain (FR-086, FR-008a)', () => {
  it.each([
    ['an unknown language', 'nosuchlanguage'],
    ['mermaid', 'mermaid'],
    ['no info string', ''],
  ])('%s', async (_name, info) => {
    const host = body(info, 'graph TD\n  A --> B\n');
    await highlightCodeBlocks(host);
    const el = host.querySelector('code')!;
    expect(el.querySelectorAll('span')).toHaveLength(0);
    expect(el.textContent).toBe('graph TD\n  A --> B\n');
  });

  it(`a line longer than LONG_LINE_THRESHOLD (${LONG_LINE_THRESHOLD}) stays plain; the other lines still highlight`, async () => {
    const long = `const big = "${'x'.repeat(LONG_LINE_THRESHOLD + 10)}";`;
    const host = body('ts', `const a = 1;\n${long}\nconst b = 2;\n`);
    await highlightCodeBlocks(host);
    const el = host.querySelector('code')!;
    expect(el.textContent).toBe(`const a = 1;\n${long}\nconst b = 2;\n`);
    const spansWithBig = [...el.querySelectorAll('span')].filter((s) => (s.textContent ?? '').includes('xxxx'));
    expect(spansWithBig).toHaveLength(0);
    expect(el.querySelectorAll('span').length).toBeGreaterThan(0);
  }, COLD);

  it(`a block over HIGHLIGHT_BUDGET_CHARS (${HIGHLIGHT_BUDGET_CHARS}) stays plain, and its grammar is not even loaded (fix round 1, item 4)`, async () => {
    const line = 'const a = 1;\n';
    const code = line.repeat(Math.ceil((HIGHLIGHT_BUDGET_CHARS + 1) / line.length));
    const host = body('ts', code);
    vi.mocked(loadLanguage).mockClear();
    await highlightCodeBlocks(host);
    const el = host.querySelector('code')!;
    expect(el.querySelectorAll('span')).toHaveLength(0);
    expect(el.textContent).toBe(code);
    expect(loadLanguage).not.toHaveBeenCalled();
  }, COLD);

  it('the budget is per DOCUMENT: blocks each under it but together over it leave the rest plain (adversarial review M2)', async () => {
    // Three blocks of ~40% of the budget each: the first two fit (80%), the third would take it to 120%.
    const line = 'const a = 1;\n';
    const code = line.repeat(Math.floor((HIGHLIGHT_BUDGET_CHARS * 0.4) / line.length));
    const host = document.createElement('div');
    for (let i = 0; i < 3; i += 1) {
      const pre = document.createElement('pre');
      pre.innerHTML = renderFence('ts', code);
      host.append(pre);
    }
    document.body.append(host);

    await highlightCodeBlocks(host);

    const blocks = [...host.querySelectorAll('code')];
    expect(blocks.map((b) => b.textContent)).toEqual([code, code, code]);
    expect(blocks.map((b) => b.querySelectorAll('span').length > 0)).toEqual([true, true, false]);
  }, 60_000);
});

describe('the cost of a highlight (fix round 1, items 4 and 10)', () => {
  it('makes ONE highlightCode pass over a block with no over-long line, however many lines it has', async () => {
    const host = body('ts', Array.from({ length: 200 }, (_, i) => `const v${i} = ${i};`).join('\n') + '\n');
    vi.mocked(highlightCode).mockClear();
    await highlightCodeBlocks(host);
    expect(highlightCode).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('code span').length).toBeGreaterThan(200);
  }, COLD);

  it('makes one pass per range BETWEEN over-long lines', async () => {
    const long = `const big = "${'x'.repeat(LONG_LINE_THRESHOLD + 10)}";`;
    const code = ['const a = 1;', 'const b = 2;', long, 'const c = 3;', 'const d = 4;'].join('\n') + '\n';
    const host = body('ts', code);
    vi.mocked(highlightCode).mockClear();
    await highlightCodeBlocks(host);
    expect(highlightCode).toHaveBeenCalledTimes(2);
    expect(host.querySelector('code')!.textContent).toBe(code);
  }, COLD);

  it('loads a language’s grammar once per window, not once per block or per render', async () => {
    vi.mocked(loadLanguage).mockClear();
    // A language no earlier test in this file used, so the first call is a real miss.
    const first = body('rust', 'fn main() {}\n');
    await highlightCodeBlocks(first);
    const second = body('rust', 'fn other() {}\n');
    const third = body('rust', 'fn third() {}\n');
    await highlightCodeBlocks(document.body);
    expect(vi.mocked(loadLanguage).mock.calls.filter(([id]) => id === 'rust')).toHaveLength(1);
    for (const el of [first, second, third]) expect(el.querySelectorAll('code span').length).toBeGreaterThan(0);
  }, COLD);
});

describe('a theme change repaints without a re-render (FR-083, fix round 1 item 14)', () => {
  it('the whole highlight style names colours only as theme variables — no hex, rgb or hsl anywhere in it (fix round 2)', () => {
    const rules = (throngHighlightStyle.module as StyleModule).getRules();
    expect(rules).toMatch(/var\(--throng-colour-syntax/);
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it('every span carries only a class, and the rule that class resolves to in the document names a theme variable', async () => {
    const host = body('ts', 'const a = 1; // c\n');
    await highlightCodeBlocks(host);
    const spans = [...host.querySelectorAll('code span')];
    expect(spans.length).toBeGreaterThan(0);
    const sheets = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
    for (const span of spans) {
      expect(span.hasAttribute('style'), span.outerHTML).toBe(false);
      for (const cls of span.classList) {
        // The rule for this class, as mounted in the document — not the module's own copy.
        const rule = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`).exec(sheets);
        expect(rule, `no mounted rule for .${cls}`).not.toBeNull();
        expect(rule![1]).toMatch(/var\(--throng-colour-syntax[A-Za-z]+\)/);
        expect(rule![1]).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
      }
    }
  }, COLD);
});


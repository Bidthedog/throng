/**
 * 073 T075 — the Markdown body's block index answers the scroll-sync questions with the SAME answers as the full scan
 * (`scroll-anchor.ts`: `topBlockLine`, `centreBlockLine`, `blockLineFor`, `blockElementFor`, `restoreScrollAnchor`), but
 * reads a handful of rectangles instead of every block's, and no attributes at all once built. The maintainer's report:
 * scrolling a large file in step was extremely slow; the full scan was ~3,000 layout reads and ~12,000 attribute reads per
 * scrolled frame at 3,000 lines.
 *
 * Layer: component (jsdom) — a hand-built document with its own simulated layout; no React.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockIndex } from '../../src/renderer/preview/providers/markdown/block-index.js';
import {
  blockElementFor,
  blockLineFor,
  centreBlockLine,
  restoreScrollAnchor,
  topBlockLine,
} from '../../src/renderer/preview/providers/markdown/scroll-anchor.js';

interface Spec {
  line: number;
  height?: number;
  hidden?: boolean;
  children?: Spec[];
}

const VIEWPORT = { top: 100, height: 400 };
const GAP = 12;
let scroller: HTMLElement;
let body: HTMLElement;
/** Where each element sits in the content, by the layout this file simulates. */
const placed = new WeakMap<Element, { top: number; height: number }>();

/** Build `specs` under a fresh scroller, laying blocks out top to bottom; a container is as tall as its children. */
function build(specs: Spec[]): void {
  scroller = document.createElement('div');
  body = document.createElement('div');
  scroller.appendChild(body);
  document.body.appendChild(scroller);
  Object.defineProperty(scroller, 'scrollTop', { value: 0, writable: true, configurable: true });
  let cursor = 0;
  const place = (spec: Spec, parent: HTMLElement): number => {
    const el = document.createElement('div');
    el.setAttribute('data-source-line', String(spec.line));
    if (spec.hidden) el.setAttribute('hidden', '');
    parent.appendChild(el);
    const top = cursor;
    if (spec.children !== undefined) for (const c of spec.children) place(c, el);
    else cursor += spec.height ?? 40;
    placed.set(el, { top, height: Math.max(cursor - top, spec.height ?? 0) });
    return top;
  };
  for (const s of specs) {
    place(s, body);
    cursor += GAP;
  }
}

function geometry(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
    if (this === scroller) return { top: VIEWPORT.top, height: VIEWPORT.height, left: 0, width: 400 } as DOMRect;
    const at = placed.get(this);
    const scrolled = (scroller as unknown as { scrollTop: number }).scrollTop;
    return at === undefined
      ? ({ top: 0, height: 0 } as DOMRect)
      : ({ top: VIEWPORT.top + at.top - scrolled, height: at.height, left: 0, width: 400 } as DOMRect);
  });
}

const setScroll = (y: number): void => void ((scroller as unknown as { scrollTop: number }).scrollTop = y);
const scrollTopNow = (): number => (scroller as unknown as { scrollTop: number }).scrollTop;

beforeEach(() => geometry());
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** Paragraphs, a nested list, a tall code block, a collapsed (hidden) section, and a run of lines sharing one block. */
const MIXED: Spec[] = [
  { line: 0, height: 30 },
  { line: 2, height: 60 },
  { line: 4, children: [{ line: 4, children: [{ line: 4, height: 24 }, { line: 5, children: [{ line: 5, height: 24 }, { line: 6, height: 24 }] }] }, { line: 7, height: 24 }] },
  { line: 9, height: 300 },
  { line: 14, height: 20, hidden: true },
  { line: 15, height: 20, hidden: true, children: undefined },
  { line: 16, height: 50 },
  ...Array.from({ length: 30 }, (_, i) => ({ line: 20 + i * 2, height: 28 })),
];

describe('the same answers as the full scan', () => {
  it('names the block at the top, at the centre, and the block an editor line falls in, at every scroll offset', () => {
    build(MIXED);
    const index = new BlockIndex(() => body);
    const contentHeight = Math.max(...[...body.querySelectorAll('[data-source-line]')].map((e) => placed.get(e)!.top + placed.get(e)!.height));
    for (let y = 0; y <= contentHeight; y += 7) {
      setScroll(y);
      expect(index.topLine(scroller), `top at ${y}`).toBe(topBlockLine(scroller));
      expect(index.centreLine(scroller), `centre at ${y}`).toBe(centreBlockLine(scroller));
    }
  });

  it('finds the block holding a line, and its element, for every line from before the first to past the last', () => {
    build(MIXED);
    const index = new BlockIndex(() => body);
    for (let line = -2; line <= 90; line += 1) {
      expect(index.elementFor(line), `element for ${line}`).toBe(blockElementFor(body, line));
      const full = blockLineFor(body, line);
      const first = Number(body.querySelector('[data-source-line]')!.getAttribute('data-source-line'));
      expect(index.blockOf(line), `block for ${line}`).toBe(full ?? first);
    }
  });

  it('brings the deepest block on the nearest line at or before a line to the top, as restoreScrollAnchor does', () => {
    build(MIXED);
    const index = new BlockIndex(() => body);
    for (const line of [0, 3, 5, 6, 9, 12, 16, 21, 33, 48, 400]) {
      setScroll(0);
      restoreScrollAnchor(scroller, { line, offsetRatio: 0 });
      const expected = scrollTopNow();
      setScroll(0);
      index.scrollLineToTop(scroller, line);
      expect(scrollTopNow(), `line ${line}`).toBe(expected);
    }
  });

  it('skips a collapsed section\'s blocks for the top and centre, as the full scan does, once invalidated', () => {
    build(MIXED);
    const index = new BlockIndex(() => body);
    setScroll(0);
    index.topLine(scroller);
    // A fold hides the code block (the draw hides it, then the body invalidates).
    body.children[3]!.setAttribute('hidden', '');
    index.invalidate();
    for (let y = 0; y <= 700; y += 11) {
      setScroll(y);
      expect(index.topLine(scroller), `top at ${y}`).toBe(topBlockLine(scroller));
      expect(index.centreLine(scroller), `centre at ${y}`).toBe(centreBlockLine(scroller));
    }
  });

  it('says nothing for a body with no blocks', () => {
    build([]);
    const index = new BlockIndex(() => body);
    expect(index.topLine(scroller)).toBeNull();
    expect(index.centreLine(scroller)).toBeNull();
    expect(index.blockOf(3)).toBeNull();
    expect(index.elementFor(3)).toBeNull();
  });

  it('rebuilds by itself when its blocks were replaced without an invalidate', () => {
    build(MIXED);
    const index = new BlockIndex(() => body);
    index.topLine(scroller);
    body.replaceChildren();
    const fresh = document.createElement('div');
    fresh.setAttribute('data-source-line', '7');
    placed.set(fresh, { top: 0, height: 40 });
    body.appendChild(fresh);
    expect(index.elementFor(7)).toBe(fresh);
  });
});

/**
 * 075 FR-006 x 073 FR-033 — a collapsed callout, and a closed `<details>`, hide their content by CSS, not by `hidden`: the
 * blocks inside keep their `data-source-line` and measure as an empty box at the viewport's origin. Counted as shown,
 * they broke the bisection: the top and centre jumped past the callout, and scroll sync drove the editor there.
 */
describe('content a collapsed callout or a closed <details> hides', () => {
  const STEP = 40 + GAP;

  /** 40 paragraphs, a folded container on line 41 holding 100 source-mapped paragraphs, then 40 more paragraphs. */
  function buildFolded(kind: 'callout' | 'details'): HTMLElement {
    build([]);
    let cursor = 0;
    const para = (line: number, parent: HTMLElement): void => {
      const el = document.createElement('p');
      el.setAttribute('data-source-line', String(line));
      parent.appendChild(el);
      placed.set(el, { top: cursor, height: 40 });
      cursor += STEP;
    };
    for (let line = 1; line <= 40; line += 1) para(line, body);
    const folded = document.createElement(kind === 'callout' ? 'div' : 'details');
    folded.setAttribute('data-source-line', '41');
    let inner: HTMLElement;
    if (kind === 'callout') {
      folded.setAttribute('data-callout', 'note');
      folded.setAttribute('data-callout-collapsed', '');
      const title = document.createElement('div');
      title.setAttribute('data-callout-title', '');
      inner = document.createElement('div');
      inner.setAttribute('data-callout-body', '');
      folded.append(title, inner);
    } else {
      folded.appendChild(document.createElement('summary'));
      inner = folded;
    }
    body.appendChild(folded);
    placed.set(folded, { top: cursor, height: 40 });
    cursor += STEP;
    // Hidden by CSS: in the document, never laid out (no `placed` entry: an empty box at the origin).
    for (let line = 42; line <= 141; line += 1) {
      const el = document.createElement('p');
      el.setAttribute('data-source-line', String(line));
      inner.appendChild(el);
    }
    for (let line = 142; line <= 181; line += 1) para(line, body);
    return folded;
  }

  for (const kind of ['callout', 'details'] as const) {
    it(`names the block really at the top and centre, never one past the folded ${kind}`, () => {
      buildFolded(kind);
      const index = new BlockIndex(() => body);
      setScroll(0);
      expect(index.topLine(scroller)).toBe(1);
      expect(index.centreLine(scroller)).toBe(5);
      setScroll(STEP * 10);
      expect(index.topLine(scroller)).toBe(11);
      setScroll(STEP * 40);
      expect(index.topLine(scroller)).toBe(41);
      setScroll(STEP * 41);
      expect(index.topLine(scroller)).toBe(142);
    });

    it(`puts a line inside the folded ${kind} on the ${kind} itself, not on a block nobody can see`, () => {
      const folded = buildFolded(kind);
      const index = new BlockIndex(() => body);
      expect(index.shownElementFor(90)).toBe(folded);
      expect(index.shownElementFor(142)?.getAttribute('data-source-line')).toBe('142');
    });
  }

  it('counts the callout\'s content again once it is opened and the index invalidated', () => {
    const folded = buildFolded('callout');
    const index = new BlockIndex(() => body);
    expect(index.shownElementFor(90)).toBe(folded);
    folded.removeAttribute('data-callout-collapsed');
    index.invalidate();
    expect(index.shownElementFor(90)?.getAttribute('data-source-line')).toBe('90');
  });
});

describe('the work per scrolled frame is bounded, whatever the document\'s size', () => {
  const BIG = (n: number): Spec[] => Array.from({ length: n }, (_, i) => ({ line: i * 2, height: 40 }));

  it('reads a few rectangles and no attributes for the top and centre of a 5,000-block document', () => {
    build(BIG(5000));
    const index = new BlockIndex(() => body);
    index.topLine(scroller); // builds the index: the one whole-document pass
    const rect = Element.prototype.getBoundingClientRect as unknown as ReturnType<typeof vi.fn>;
    const attr = vi.spyOn(Element.prototype, 'getAttribute');
    const qsa = vi.spyOn(Element.prototype, 'querySelectorAll');
    rect.mockClear();
    for (let y = 1000; y < 1000 + 100 * 53; y += 53) {
      setScroll(y);
      index.topLine(scroller);
      index.centreLine(scroller);
      index.blockOf(Math.floor(y / 26));
      index.elementFor(Math.floor(y / 26));
    }
    // 100 frames: about 2 x log2(5000) = 26 reads per frame at most, never one per block.
    expect(rect.mock.calls.length / 100).toBeLessThanOrEqual(40);
    expect(attr).not.toHaveBeenCalled();
    expect(qsa).not.toHaveBeenCalled();
  });

  it('reads the same few rectangles at 500 blocks as at 5,000: independent of the document\'s size', () => {
    const reads = (n: number): number => {
      document.body.replaceChildren();
      build(BIG(n));
      const index = new BlockIndex(() => body);
      index.topLine(scroller);
      const rect = Element.prototype.getBoundingClientRect as unknown as ReturnType<typeof vi.fn>;
      rect.mockClear();
      setScroll(n * 20);
      index.topLine(scroller);
      index.centreLine(scroller);
      return rect.mock.calls.length;
    };
    const small = reads(500);
    const large = reads(5000);
    expect(large).toBeLessThanOrEqual(small + 8);
  });

  it('scans the document once per drawn version, however many frames ask', () => {
    build(BIG(2000));
    const qsa = vi.spyOn(Element.prototype, 'querySelectorAll');
    const index = new BlockIndex(() => body);
    for (let i = 0; i < 200; i += 1) {
      setScroll(i * 31);
      index.topLine(scroller);
      index.centreLine(scroller);
      index.blockOf(i);
    }
    expect(qsa).toHaveBeenCalledTimes(1);
    index.invalidate();
    index.topLine(scroller);
    expect(qsa).toHaveBeenCalledTimes(2);
  });
});

/**
 * 044 T076 — the Markdown preview's scroll anchor (FR-024).
 *
 * A live update replaces the body's children. Without an anchor the scroll container keeps its
 * `scrollTop` while everything under it moves, so a reader halfway down a long document is thrown
 * somewhere else on every keystroke in the editor beside it. The anchor names WHERE the reader is in
 * SOURCE terms — the block at the top of the viewport (`data-source-line`) and how far into it — and
 * restoring it scrolls that place back to the top of the viewport after the new content lands.
 *
 * ══ WHY FAKE ELEMENTS ══
 *
 * The unit project runs in Node, and jsdom has no layout anyway: every rect it answers is zero. The
 * anchor is a decision over measured rects, so the rects are the input and this file supplies them.
 * The two functions take a structural container (`scrollTop`, `getBoundingClientRect`,
 * `querySelectorAll`) that a real `HTMLElement` satisfies unchanged.
 */
import { describe, expect, it } from 'vitest';
import {
  blockLineFor,
  captureScrollAnchor,
  isTopOfDocument,
  remapAnchorLine,
  topBlockLine,
  restoreScrollAnchor,
  type AnchorContainer,
  type AnchorElement,
} from '../../src/renderer/preview/providers/markdown/scroll-anchor.js';

/** A block in DOCUMENT coordinates: `y` from the top of the content, `h` tall. */
interface Block {
  line: number;
  y: number;
  h: number;
}

/**
 * A scroll container over `blocks`, with the viewport's top at client y = 100. A block's client top
 * is therefore `100 + y - scrollTop` — exactly what `getBoundingClientRect` would answer in a browser.
 */
function container(blocks: Block[], scrollTop: number): AnchorContainer & { blocks: Block[] } {
  const VIEWPORT_TOP = 100;
  const self = {
    scrollTop,
    blocks,
    getBoundingClientRect: () => ({ top: VIEWPORT_TOP, height: 400 }),
    querySelectorAll: (selector: string): AnchorElement[] => {
      expect(selector).toBe('[data-source-line]');
      return self.blocks.map((b) => ({
        getAttribute: (name: string) => (name === 'data-source-line' ? String(b.line) : null),
        getBoundingClientRect: () => ({ top: VIEWPORT_TOP + b.y - self.scrollTop, height: b.h }),
      }));
    },
  };
  return self;
}

/** Ten 50px blocks, one per source line group: line 0 at y 0, line 2 at y 50, … line 18 at y 450. */
const tenBlocks = (): Block[] => Array.from({ length: 10 }, (_, i) => ({ line: i * 2, y: i * 50, h: 50 }));

describe('capturing where the reader is (FR-024)', () => {
  it('names the block at the top of the viewport and how far into it the viewport starts', () => {
    // scrollTop 225 → the viewport top is 25px into the block at y 200 (line 8).
    const c = container(tenBlocks(), 225);
    expect(captureScrollAnchor(c)).toEqual({ line: 8, offsetRatio: 0.5 });
  });

  it('prefers the DEEPEST block straddling the top — a list item over the list holding it', () => {
    const blocks: Block[] = [
      { line: 0, y: 0, h: 100 },
      { line: 4, y: 100, h: 300 }, // a list …
      { line: 4, y: 100, h: 100 }, // … its first item, on the same source line
      { line: 6, y: 200, h: 100 }, // … its second item
      { line: 10, y: 400, h: 100 },
    ];
    const c = container(blocks, 250);
    expect(captureScrollAnchor(c)).toEqual({ line: 6, offsetRatio: 0.5 });
  });

  it('captures nothing at the very top — a reader at the top stays at the top', () => {
    expect(captureScrollAnchor(container(tenBlocks(), 0))).toBeNull();
  });

  it('captures nothing from a body with no source-mapped blocks', () => {
    expect(captureScrollAnchor(container([], 120))).toBeNull();
  });
});

describe('following the anchor’s source line through the edit that caused the update (FR-024)', () => {
  /*
   * `data-source-line` numbers are the SOURCE's, so a line typed above the reader renumbers every block
   * below it. Restoring to the old number would land on whatever now sits there — one block up per line
   * typed, which is exactly "the preview jumps while I type at the top". The body holds the previous
   * text and the new one, so it can tell where the edit was and move the anchor's line with it.
   */
  const lines = (n: number): string => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');

  it('moves the anchor down by the lines inserted ABOVE it', () => {
    const before = lines(40);
    const after = `# Hello\n\n${before}`;
    expect(remapAnchorLine({ line: 20, offsetRatio: 0.3 }, before, after)).toEqual({ line: 22, offsetRatio: 0.3 });
  });

  it('moves it up by the lines deleted above it', () => {
    const before = lines(40);
    const after = before.split('\n').filter((_, i) => i !== 3 && i !== 4).join('\n');
    expect(remapAnchorLine({ line: 20, offsetRatio: 0 }, before, after).line).toBe(18);
  });

  it('leaves it alone for an edit BELOW it', () => {
    const before = lines(40);
    const after = `${before}\nmore\nand more`;
    expect(remapAnchorLine({ line: 20, offsetRatio: 0.5 }, before, after)).toEqual({ line: 20, offsetRatio: 0.5 });
  });

  it('leaves it alone for an edit that changes no line count above it (typing within a line)', () => {
    const before = lines(40);
    const after = before.replace('line 2', 'line 2 with more words typed into it');
    expect(remapAnchorLine({ line: 20, offsetRatio: 0.5 }, before, after).line).toBe(20);
  });

  it('counts lines the way the pipeline does for CRLF and CR-only sources (fix round 1, item 7)', () => {
    const crlf = lines(40).split('\n').join('\r\n');
    expect(remapAnchorLine({ line: 20, offsetRatio: 0 }, crlf, `# Hello\r\n\r\n${crlf}`).line).toBe(22);
    const cr = lines(40).split('\n').join('\r');
    expect(remapAnchorLine({ line: 20, offsetRatio: 0 }, cr, `# Hello\r\r${cr}`).line).toBe(22);
  });

  it('keeps the line where it is when the edit spans the anchor itself', () => {
    const before = lines(40);
    const after = before.replace('line 20', 'line twenty\nwas split');
    expect(remapAnchorLine({ line: 20, offsetRatio: 0.5 }, before, after).line).toBe(20);
  });
});

describe('restoring it after the content changes (FR-024)', () => {
  it('puts the same place back at the top of the viewport when nothing moved', () => {
    const c = container(tenBlocks(), 225);
    const anchor = captureScrollAnchor(c);
    restoreScrollAnchor(c, anchor!);
    expect(c.scrollTop).toBe(225);
  });

  it('follows the block down when content is inserted ABOVE it', () => {
    const c = container(tenBlocks(), 225);
    const anchor = captureScrollAnchor(c)!;

    // A heading typed at the top of the editor: 80px of new content above everything, and the
    // renderer has replaced the body, so every block is 80px further down. `scrollTop` is unchanged
    // by the replacement — which is the defect the anchor exists for.
    c.blocks = [{ line: 0, y: 0, h: 80 }, ...tenBlocks().map((b) => ({ ...b, y: b.y + 80 }))];

    restoreScrollAnchor(c, anchor);
    expect(c.scrollTop).toBe(305);
  });

  it('restores to the nearest data-source-line AT OR BEFORE the anchor when that line is gone', () => {
    const c = container(tenBlocks(), 225); // anchored on line 8, half way in
    const anchor = captureScrollAnchor(c)!;

    // Line 8's block was deleted; its neighbours at 6 (y 150) and 10 (y 200) close up.
    c.blocks = tenBlocks()
      .filter((b) => b.line !== 8)
      .map((b) => (b.line > 8 ? { ...b, y: b.y - 50 } : b));

    restoreScrollAnchor(c, anchor);
    // Line 6 — at or before 8, never line 10 after it — with the same ratio into it: 150 + 25.
    expect(c.scrollTop).toBe(175);
  });

  it('falls back to the first block when every line now starts after the anchor', () => {
    const c = container(tenBlocks(), 225);
    const anchor = captureScrollAnchor(c)!;
    c.blocks = [{ line: 40, y: 30, h: 60 }];
    restoreScrollAnchor(c, anchor);
    expect(c.scrollTop).toBe(60); // 30 + 0.5 × 60
  });

  /*
   * 044 T192 (FR-115) — `{ line: 0, offsetRatio: 0 }` is the top of the document: what a heading jump sends
   * for a reader at the top, and what Back to that entry restores. A document whose first block starts below
   * line 0 (blank lines first, or a hidden front matter block) must still return to the very top, not to its
   * first block.
   */
  it('restores the top of the document for { line: 0, offsetRatio: 0 }, even when the first block is below line 0', () => {
    const blocks: Block[] = [
      { line: 3, y: 30, h: 60 },
      { line: 6, y: 90, h: 60 },
    ];
    const c = container(blocks, 120);
    restoreScrollAnchor(c, { line: 0, offsetRatio: 0 });
    expect(c.scrollTop).toBe(0);
  });

  it('leaves the scroll position alone when the new body has no blocks at all', () => {
    const c = container(tenBlocks(), 225);
    const anchor = captureScrollAnchor(c)!;
    c.blocks = [];
    restoreScrollAnchor(c, anchor);
    expect(c.scrollTop).toBe(225);
  });
});

/*
 * 044 T230 (FR-121b, FR-121g; data-model §15.3) — the block-granular readings two-way sync compares: the
 * block at the preview's top, and the block an editor line falls in. The same block on both sides is
 * "already there", which is what stops the two mappings oscillating.
 */
describe('the blocks two-way sync compares (FR-121g)', () => {
  it('topBlockLine names the block containing the viewport top', () => {
    expect(topBlockLine(container(tenBlocks(), 225))).toBe(8);
    expect(topBlockLine(container(tenBlocks(), 0))).toBe(0);
  });

  it('topBlockLine names a block TALLER than the viewport while any part of it is at the top', () => {
    const blocks: Block[] = [
      { line: 0, y: 0, h: 50 },
      { line: 20, y: 50, h: 1000 }, // a long code block
      { line: 32, y: 1050, h: 50 },
    ];
    expect(topBlockLine(container(blocks, 700))).toBe(20);
  });

  /*
   * Between blocks this used to name the last block that started above the edge — one wholly scrolled away —
   * and that was the hands-on "off by one" (2026-09-16). It now names the block below the margin, the one the
   * reader sees; scrolled past every block, the last one still stands in.
   */
  it('topBlockLine prefers the deepest straddling block, between blocks the one below the margin, and past every block the last', () => {
    const nested: Block[] = [
      { line: 4, y: 0, h: 300 },
      { line: 6, y: 100, h: 100 },
    ];
    expect(topBlockLine(container(nested, 150))).toBe(6);
    const gap: Block[] = [
      { line: 0, y: 0, h: 50 },
      { line: 4, y: 80, h: 50 },
    ];
    expect(topBlockLine(container(gap, 60))).toBe(4);
    expect(topBlockLine(container(gap, 200))).toBe(4);
  });

  it('topBlockLine names the first block when the top is above every block, and nothing for an empty body', () => {
    expect(topBlockLine(container([{ line: 3, y: 30, h: 60 }], 0))).toBe(3);
    expect(topBlockLine(container([], 0))).toBeNull();
  });

  it('blockLineFor names the greatest block line at or before the line, and nothing before the first block', () => {
    const c = container(tenBlocks(), 0);
    expect(blockLineFor(c, 8)).toBe(8);
    expect(blockLineFor(c, 9)).toBe(8);
    expect(blockLineFor(c, 500)).toBe(18);
    expect(blockLineFor(container([{ line: 3, y: 0, h: 50 }], 0), 2)).toBeNull();
  });

  /*
   * 2026-09-16 hands-on report, "the preview and editor line sync is off by one occasionally". The block at the
   * top is the one the reader SEES there. When the viewport's top edge falls in the margin between two blocks,
   * the block above that margin is wholly scrolled away; and a block whose top is a fraction of a pixel below
   * the edge — where a sync scroll lands once the engine rounds `scrollTop` — is at the top.
   */
  it('topBlockLine names the block the reader sees when the top edge falls in the margin between two blocks', () => {
    const gap: Block[] = [
      { line: 0, y: 0, h: 40 },
      { line: 2, y: 60, h: 40 },
      { line: 4, y: 120, h: 40 },
    ];
    // The top edge is 12px into the 20px margin above line 2: line 0 ended 12px above it; line 2 starts 8px below.
    expect(topBlockLine(container(gap, 52))).toBe(2);
  });

  it('topBlockLine names a block whose top is a fraction of a pixel below the edge, not the block above it', () => {
    const adjacent: Block[] = [
      { line: 0, y: 0, h: 50 },
      { line: 2, y: 50, h: 50 },
      { line: 4, y: 100, h: 50 },
    ];
    // Line 0 shows 0.3px; line 2 starts 0.3px below the edge.
    expect(topBlockLine(container(adjacent, 49.7))).toBe(2);
    const gap: Block[] = [
      { line: 0, y: 0, h: 40 },
      { line: 2, y: 60, h: 40 },
    ];
    expect(topBlockLine(container(gap, 59.6))).toBe(2);
  });

  it('isTopOfDocument: null and { line: 0, offsetRatio: 0 } are the top; an absent place is not (analysis C2)', () => {
    expect(isTopOfDocument(null)).toBe(true);
    expect(isTopOfDocument({ line: 0, offsetRatio: 0 })).toBe(true);
    expect(isTopOfDocument(undefined)).toBe(false);
    expect(isTopOfDocument({ line: 0, offsetRatio: 0.5 })).toBe(false);
    expect(isTopOfDocument({ line: 2, offsetRatio: 0 })).toBe(false);
    expect(isTopOfDocument('top')).toBe(false);
  });
});

/*
 * 2026-09-16 hands-on report — a live update that changes nothing above the reader must leave the preview
 * exactly where it is (FR-024), including where the top edge sits in a margin or a fraction of a pixel above
 * a block. Measured in the app: a synced preview left block 80 0.2px below its edge, the next keystroke's
 * update captured the block above it at ratio 1, and the restore moved the preview up by the margin (11px).
 */
describe('a capture and restore over unchanged content moves nothing (FR-024)', () => {
  const roundTrip = (blocks: Block[], scrollTop: number): number => {
    const c = container(blocks, scrollTop);
    const anchor = captureScrollAnchor(c);
    expect(anchor).not.toBeNull();
    restoreScrollAnchor(c, anchor!);
    return c.scrollTop;
  };
  const gap: Block[] = [
    { line: 0, y: 0, h: 40 },
    { line: 2, y: 60, h: 40 },
    { line: 4, y: 120, h: 40 },
  ];

  it('with the top edge in the margin between two blocks', () => {
    expect(roundTrip(gap, 52)).toBeCloseTo(52, 6);
  });

  it('with a block a fraction of a pixel below the top edge', () => {
    expect(roundTrip(gap, 59.8)).toBeCloseTo(59.8, 6);
  });

  it('names a block exactly on the edge at ratio 0, never -0 (a place is compared as a value)', () => {
    expect(Object.is(captureScrollAnchor(container(gap, 60))?.offsetRatio, 0)).toBe(true);
  });

  it('and names the block the reader sees, not the one scrolled away above it', () => {
    expect(captureScrollAnchor(container(gap, 52))?.line).toBe(2);
    expect(captureScrollAnchor(container(gap, 59.8))?.line).toBe(2);
  });
});

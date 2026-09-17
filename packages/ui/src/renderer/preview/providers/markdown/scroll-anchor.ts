/**
 * The Markdown preview's scroll anchor (044, FR-024).
 *
 * A live update replaces the body's children. The scroll container keeps its `scrollTop` through that,
 * while everything under it moves — so without an anchor a reader halfway down a long document is put
 * somewhere else on every keystroke in the editor beside it. The anchor names the reader's place in
 * SOURCE terms: the block at the top of the viewport (its `data-source-line`, which the pipeline puts on
 * every block) and how far into that block the viewport starts. The body captures it immediately before
 * `replaceChildren` and restores it immediately after, in the same synchronous turn, so there is no
 * moment in which a user's own scroll could land between the two and be undone.
 *
 * ══ THE LINE FOLLOWS THE EDIT ══
 *
 * A line typed ABOVE the reader renumbers every block below it, so restoring to the old number would
 * land one block higher per line typed. `remapAnchorLine` compares the text before and after the update
 * — a common-prefix / common-suffix comparison, which is exact for the one contiguous edit that typing
 * produces — and moves the anchor's line by the lines inserted or removed above it.
 *
 * ══ STRUCTURAL, SO IT IS TESTABLE WITHOUT A LAYOUT ══
 *
 * The functions take the members of an element they use and nothing more. A real `HTMLElement`
 * satisfies both interfaces unchanged; `scroll-anchor.test.ts` supplies rects that jsdom cannot.
 */

export interface ScrollAnchor {
  /** The source line of the block at the top of the viewport. */
  line: number;
  /**
   * How far into that block the viewport's top edge is, 0 (its top) to 1 (its bottom); negative when the edge is
   * above the block (in the margin before it, or a fraction of a pixel above it).
   */
  offsetRatio: number;
}

/** What the anchor reads of a source-mapped block. */
export interface AnchorElement {
  getAttribute(name: string): string | null;
  getBoundingClientRect(): { top: number; height: number };
}

/** What the anchor reads and writes of the scroll container. */
export interface AnchorContainer {
  scrollTop: number;
  getBoundingClientRect(): { top: number };
  querySelectorAll(selector: string): Iterable<AnchorElement>;
}

const SELECTOR = '[data-source-line]';

interface Measured {
  line: number;
  /** The block's top relative to the viewport's top edge. */
  top: number;
  height: number;
}

/** Every source-mapped block, in document order, measured against the container's viewport. */
function measure(container: AnchorContainer): Measured[] {
  const viewportTop = container.getBoundingClientRect().top;
  const out: Measured[] = [];
  for (const el of container.querySelectorAll(SELECTOR)) {
    const line = Number(el.getAttribute('data-source-line'));
    if (!Number.isFinite(line)) continue;
    const rect = el.getBoundingClientRect();
    out.push({ line, top: rect.top - viewportTop, height: rect.height });
  }
  return out;
}

/**
 * How far past the viewport's top edge, in px, a block edge may sit and still count as AT the edge. A sync
 * scroll puts a block's top on the edge, and the engine rounds `scrollTop` to device pixels, so the block
 * lands a fraction of a pixel below it — and the block above then shows a sliver no reader can see.
 */
const EDGE_TOLERANCE_PX = 1;

/**
 * The block the READER sees at the top of the viewport (2026-09-16 hands-on report, "off by one"):
 *
 * 1. the DEEPEST block straddling the top edge — a list item rather than the list holding it, because a
 *    nested block names the place more precisely — where a block starting less than a pixel below the edge
 *    straddles it, and one ending less than a pixel below it does not;
 * 2. else, with the edge in a margin between blocks, the nearest block BELOW it (the deepest of those on the
 *    same top) — the block above the margin is wholly scrolled away;
 * 3. else, scrolled past every block, the last block that started above the edge.
 */
function blockAtTop(blocks: readonly Measured[]): Measured | undefined {
  let chosen: Measured | undefined;
  for (const b of blocks) {
    if (b.top <= EDGE_TOLERANCE_PX && b.top + b.height > EDGE_TOLERANCE_PX) chosen = b; // later = deeper
  }
  if (chosen !== undefined) return chosen;
  for (const b of blocks) {
    if (b.top > EDGE_TOLERANCE_PX && (chosen === undefined || b.top <= chosen.top)) chosen = b;
  }
  if (chosen !== undefined) return chosen;
  for (const b of blocks) if (b.top <= 0) chosen = b;
  return chosen;
}

/**
 * Where the reader is, or `null` when there is nothing to keep: a reader at the very top stays at the
 * top (content growing above the first block must not push them into the document), and a body with no
 * source-mapped blocks has no place to name.
 *
 * The block is {@link blockAtTop}'s. Its ratio is how far into it the viewport starts — NEGATIVE when the
 * block starts below the edge (a margin, or a sub-pixel landing), so that restoring over unchanged content
 * puts the viewport back exactly where it was rather than onto the block's top or the bottom of the one above.
 */
export function captureScrollAnchor(container: AnchorContainer): ScrollAnchor | null {
  if (container.scrollTop <= 0) return null;
  const chosen = blockAtTop(measure(container));
  if (chosen === undefined) return null;
  // `+ 0` turns the -0 of a block exactly on the edge into 0: a place is compared and stored as a value.
  const offsetRatio = chosen.height > 0 ? Math.min(1, -chosen.top / chosen.height) + 0 : 0;
  return { line: chosen.line, offsetRatio };
}

/**
 * Scroll `container` so the anchored place is at the top of its viewport again.
 *
 * The target is the block on the nearest `data-source-line` AT OR BEFORE the anchor's — never after it,
 * because a line that no longer exists was replaced by what precedes it — and the deepest block on that
 * line. When every block now starts after the anchor, the first block stands in. A body with no blocks
 * is left where it is.
 *
 * `{ line: 0, offsetRatio: 0 }` is the TOP OF THE DOCUMENT (044 FR-115, contracts/preview-ipc.md §1): the place
 * a heading jump records for a reader at the top, which Back restores. It scrolls to 0 outright, since a document
 * whose first block starts below line 0 would otherwise land on that block instead.
 */
export function restoreScrollAnchor(container: AnchorContainer, anchor: ScrollAnchor): void {
  if (anchor.line <= 0 && anchor.offsetRatio <= 0) {
    container.scrollTop = 0;
    return;
  }
  const blocks = measure(container);
  if (blocks.length === 0) return;
  let target: Measured | undefined;
  for (const b of blocks) {
    if (b.line > anchor.line) continue;
    if (target === undefined || b.line >= target.line) target = b;
  }
  target ??= blocks[0]!;
  container.scrollTop += target.top + anchor.offsetRatio * target.height;
}

/**
 * 044 FR-121b, FR-121g (data-model §15.3) — the source line of the block at the top of `container`'s
 * viewport: the block two-way sync reports to the editor, and compares with the block the editor's line
 * falls in.
 *
 * The same choice as {@link captureScrollAnchor} ({@link blockAtTop}): the block the reader sees there, so a
 * block taller than the viewport is named for as long as any visible part of it is at the top, and an edge in
 * the margin above a block names that block. At the very top, the first block. `null` for a body with no
 * source-mapped blocks.
 */
export function topBlockLine(container: AnchorContainer): number | null {
  const blocks = measure(container);
  if (blocks.length === 0) return null;
  return (blockAtTop(blocks) ?? blocks[0]!).line;
}

/** What {@link blockLineFor} reads: the source-mapped blocks, and nothing about where they are drawn. */
export interface BlockSource {
  querySelectorAll(selector: string): Iterable<{ getAttribute(name: string): string | null }>;
}

/**
 * 044 FR-121g — the block an editor line falls in: the greatest `data-source-line` at or before `line`, as
 * {@link restoreScrollAnchor} targets it. `null` when every block starts after the line.
 */
export function blockLineFor(body: BlockSource, line: number): number | null {
  let found: number | null = null;
  for (const el of body.querySelectorAll(SELECTOR)) {
    const at = Number(el.getAttribute('data-source-line'));
    if (!Number.isFinite(at) || at > line) continue;
    if (found === null || at > found) found = at;
  }
  return found;
}

/**
 * 044 FR-121e — whether a history step's place is the very top of its document. Defined beside the rule that
 * reads it (`scroll-sync-policy.ts`), which the panel chrome imports; re-exported here with the other
 * readings of this body's places, so the chrome never imports a provider module (contracts/
 * preview-provider-seam.md §3).
 */
export { isTopOfDocument } from '../../scroll-sync-policy.js';

/**
 * The anchor, with its line moved through the edit that turned `before` into `after`.
 *
 * Lines in the unchanged prefix keep their number; lines in the unchanged suffix move by the difference
 * in line count; a line inside the edited span keeps its number, since there is no better answer for a
 * line that was itself rewritten.
 */
export function remapAnchorLine(anchor: ScrollAnchor, before: string, after: string): ScrollAnchor {
  if (before === after) return anchor;
  // Every line-ending style counts as one break, as `front-matter.ts` counts them, so a CR-only source
  // numbers its lines the way the pipeline's `data-source-line` does.
  const a = before.split(/\r\n|\r|\n/);
  const b = after.split(/\r\n|\r|\n/);
  let prefix = 0;
  const limit = Math.min(a.length, b.length);
  while (prefix < limit && a[prefix] === b[prefix]) prefix += 1;
  if (anchor.line < prefix) return anchor;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  if (anchor.line < a.length - suffix) return anchor;
  return { ...anchor, line: anchor.line + (b.length - a.length) };
}

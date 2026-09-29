/**
 * The Go to Heading pop-down's pure logic (047 US4, research.md R7, data-model.md "HeadingOutline view
 * state"): flattening the `DocumentSymbol` tree for rendering, deciding which rows a query and the
 * tree's own (component-local) collapse state make VISIBLE, and finding the "current" entry from
 * measured heading positions. Kept apart from `heading-outline.tsx` for the same reason
 * `preview-search-model.ts` is apart from `preview-search.ts`: none of it touches the DOM, so none of
 * it needs one to test.
 */
import type { DocumentSymbol } from '@throng/core';

/** One heading, flattened out of the tree, with enough context to answer "is this visible". */
export interface FlatHeading {
  symbol: DocumentSymbol;
  depth: number;
  parentSlug: string | null;
}

/** Depth-first, document order — the order the pop-down's list renders in. */
export function flattenHeadings(tree: readonly DocumentSymbol[]): FlatHeading[] {
  const out: FlatHeading[] = [];
  const walk = (nodes: readonly DocumentSymbol[], depth: number, parentSlug: string | null): void => {
    for (const node of nodes) {
      out.push({ symbol: node, depth, parentSlug });
      walk(node.children, depth + 1, node.slug);
    }
  };
  walk(tree, 0, null);
  return out;
}

/** FR-043 — case-insensitive substring on the heading text. An empty query matches everything. */
export function matchesQuery(name: string, query: string): boolean {
  return query.length === 0 || name.toLowerCase().includes(query.toLowerCase());
}

/** One row the list draws: the heading, and whether it is itself a match (vs. shown only as an ancestor of one). */
export interface OutlineRow {
  readonly heading: FlatHeading;
  readonly matched: boolean;
}

/**
 * The rows to draw, in order — FR-043's rule:
 *
 * - No query: every heading not hidden by a COLLAPSED ancestor (manual tree-node collapse, FR-045 —
 *   never the document's own fold state, which this pop-down has nothing to do with).
 * - A query: every heading matching it, PLUS its ancestors (context — a match six levels deep with no
 *   visible parent would read as belonging to nothing), with collapse state overridden: "expands
 *   collapsed tree nodes holding a match" (FR-043) — a match must never be hidden by a fold the reader
 *   set before they started typing.
 */
export function visibleRows(
  flat: readonly FlatHeading[],
  query: string,
  collapsedNodes: ReadonlySet<string>,
): OutlineRow[] {
  if (flat.length === 0) return [];
  const bySlug = new Map(flat.map((f) => [f.symbol.slug, f] as const));
  const filtering = query.length > 0;
  const matchedSlugs = new Set(filtering ? flat.filter((f) => matchesQuery(f.symbol.name, query)).map((f) => f.symbol.slug) : []);

  const shown = new Set<string>();
  if (!filtering) {
    for (const f of flat) shown.add(f.symbol.slug);
  } else {
    for (const slug of matchedSlugs) {
      let cur: FlatHeading | undefined = bySlug.get(slug);
      while (cur) {
        shown.add(cur.symbol.slug);
        cur = cur.parentSlug !== null ? bySlug.get(cur.parentSlug) : undefined;
      }
    }
  }

  const isCollapsedByAncestor = (f: FlatHeading): boolean => {
    let parentSlug = f.parentSlug;
    while (parentSlug !== null) {
      if (collapsedNodes.has(parentSlug)) return true;
      parentSlug = bySlug.get(parentSlug)?.parentSlug ?? null;
    }
    return false;
  };

  const out: OutlineRow[] = [];
  for (const f of flat) {
    if (!shown.has(f.symbol.slug)) continue;
    // Manual collapse hides a row only OUTSIDE a filter — a filter's own ancestor-inclusion above
    // already decided which ancestors are visible, and FR-043 says a match overrides the fold.
    if (!filtering && isCollapsedByAncestor(f)) continue;
    out.push({ heading: f, matched: filtering ? matchedSlugs.has(f.symbol.slug) : true });
  }
  return out;
}

/** A heading's measured top, relative to the SAME origin as `viewportTop` (e.g. the body host's own top). */
export interface HeadingPosition {
  slug: string;
  top: number;
}

/**
 * The heading whose section contains the block at the top of the view (R7) — the LAST heading at or
 * above `viewportTop`, in document order. `null` above every heading (a preamble with no heading yet)
 * or with no headings at all.
 */
export function currentHeadingSlug(positions: readonly HeadingPosition[], viewportTop: number): string | null {
  let current: string | null = null;
  for (const p of positions) {
    if (p.top <= viewportTop) current = p.slug;
    else break;
  }
  return current;
}
